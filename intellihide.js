// Prosty Panel — intellihide.js

import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta    from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js';

const CHECK_POINTER_MS        = 50;
const ANIMATION_TIME          = 150;
const HIDE_DELAY              = 400;
const SHOW_DELAY_MS           = 0;
const EDGE_THRESHOLD          = 1;
const HOVER_EXTEND_HORIZONTAL = 15;
const HOVER_EXTEND_BOTTOM     = 20;
const HOVER_EXTEND_TOP        = 10;

// Jak długo (ms) po window-created czekamy na resize gry borderless
// (niektóre gry robią: małe okno → fullscreen po ~500ms)
const NEW_WINDOW_RECHECK_DELAY = 800;

export const Intellihide = GObject.registerClass({
    Signals: {
        'showing': {},
        'hiding': {},
    },
}, class Intellihide extends GObject.Object {
    _init(panel, monitor, taskbar) {
        super._init();
        this._panel    = panel;
        this._monitor  = monitor;
        this._taskbar  = taskbar;

        this._holdCounter      = 0;
        this._hover            = false;
        this._visible          = true;
        this._proximityOverlap = false;
        this._enabled          = false;
        this._targetBox        = null;

        this._hideTimer       = null;
        this._showTimer       = null;
        this._pointerWatchId  = 0;

        this._generalSignals  = [];

        // Śledzimy WSZYSTKIE okna na workspace, nie tylko focus_window
        this._trackedWindows  = new Map(); // MetaWindow → [signalId, ...]

        this._checkDebounceId    = 0;
        this._newWinRecheckId    = 0;
    }

    // ─── public API ──────────────────────────────────────────────────────────

    updateTargetBox(box) {
        this._targetBox = box;
        if (this._enabled) this._queueProximityCheck();
    }

    enable() {
        if (this._enabled) return;
        this._enabled = true;

        this._panel.translation_y = 0;
        this._panel.visible = true;
        this._panel.opacity = 255;
        this._panel.set_reactive(true);
        this._visible = true;

        this._pointerWatchId = PointerWatcher.getPointerWatcher().addWatch(
            CHECK_POINTER_MS,
            (x, y) => this._onPointerMove(x, y)
        );

        const bind = (obj, sig, cb) => {
            const id = obj.connect(sig, cb);
            this._generalSignals.push({ obj, id });
        };

        bind(this._taskbar, 'menu-opened', () => this.revealAndHold());
        bind(this._taskbar, 'menu-closed', () => this.release());
        bind(this._taskbar, 'drag-start',  () => this.revealAndHold());
        bind(this._taskbar, 'drag-end',    () => this.release());

        bind(Main.overview, 'showing', () => {
            if (this._enabled) this._updatePanelVisibility(true);
        });
        bind(Main.overview, 'hidden', () => {
            this._queueProximityCheck();
            if (this._enabled) this._updatePanelVisibility(false);
        });

        // focus-window zmienia się → odśwież zestaw śledzonych okien
        bind(global.display, 'notify::focus-window', () => {
            this._rebuildTrackedWindows();
            this._queueProximityCheck();
        });

        // nowe okno pojawiło się (np. gra odpaliła się po launcherze)
        bind(global.display, 'window-created', (_dpy, win) => {
            this._onWindowCreated(win);
        });

        bind(global.display, 'restacked', () => this._queueProximityCheck());
        bind(global.window_manager, 'switch-workspace', () => {
            this._rebuildTrackedWindows();
            this._queueProximityCheck();
        });
        bind(global.window_manager, 'map', (_wm, _actor) => {
            // okno stało się widoczne (np. po unminimize)
            this._rebuildTrackedWindows();
            this._queueProximityCheck();
        });

        this._rebuildTrackedWindows();
        this._updatePanelVisibility(true);
        this._queueProximityCheck();
    }

    disable() {
        if (!this._enabled) return;
        this._enabled = false;

        if (this._pointerWatchId) {
            try { PointerWatcher.getPointerWatcher().removeWatch(this._pointerWatchId); } catch (e) {}
            this._pointerWatchId = 0;
        }
        if (this._hideTimer)        { GLib.source_remove(this._hideTimer);        this._hideTimer = null; }
        if (this._showTimer)        { GLib.source_remove(this._showTimer);        this._showTimer = null; }
        if (this._checkDebounceId)  { GLib.source_remove(this._checkDebounceId);  this._checkDebounceId = 0; }
        if (this._newWinRecheckId)  { GLib.source_remove(this._newWinRecheckId);  this._newWinRecheckId = 0; }

        for (const sig of this._generalSignals) {
            try { sig.obj.disconnect(sig.id); } catch (e) {}
        }
        this._generalSignals = [];

        this._clearAllTrackedWindows();

        this._panel.remove_all_transitions();
        this._panel.show();
        this._panel.opacity = 255;
        this._panel.set_reactive(true);
        this._panel.translation_y = 0;
        this._visible     = true;
        this._holdCounter = 0;
        this._hover       = false;
    }

    revealAndHold(immediate = false) {
        if (!this._enabled) return;
        this._holdCounter++;
        this._updatePanelVisibility(immediate);
    }

    release(immediate = false) {
        if (!this._enabled) return;
        if (this._holdCounter > 0) this._holdCounter--;
        this._updatePanelVisibility(immediate);
    }

    reset() { this.disable(); this.enable(); }

    // ─── window tracking ─────────────────────────────────────────────────────

    /**
     * Przebudowuje zestaw śledzonych okien.
     * Śledzimy WSZYSTKIE okna na aktywnym workspace, nie tylko focusowane.
     * Dzięki temu gra borderless/fullscreen jest wykrywana nawet jeśli
     * launcher lub inne małe okno ma focus.
     */
    _rebuildTrackedWindows() {
        const ws = global.workspace_manager.get_active_workspace();
        const current = new Set(ws.list_windows());

        // Odłącz sygnały od okien, które już nie istnieją lub nie są na workspace
        for (const [win, ids] of this._trackedWindows) {
            if (!current.has(win)) {
                this._untrackWindow(win, ids);
                this._trackedWindows.delete(win);
            }
        }

        // Podłącz sygnały do nowych okien
        for (const win of current) {
            if (!this._trackedWindows.has(win)) {
                this._trackWindow(win);
            }
        }
    }

    _trackWindow(win) {
        const cb = () => this._queueProximityCheck();
        const ids = [];

        const signals = [
            'size-changed',
            'position-changed',
            'notify::fullscreen',
            'notify::maximized-horizontally',
            'notify::maximized-vertically',
            'notify::minimized',
            'unmanaged',
        ];
        for (const sig of signals) {
            try { ids.push(win.connect(sig, cb)); } catch (e) {}
        }
        this._trackedWindows.set(win, ids);
    }

    _untrackWindow(win, ids) {
        if (!ids) ids = this._trackedWindows.get(win) || [];
        for (const id of ids) {
            try { win.disconnect(id); } catch (e) {}
        }
    }

    _clearAllTrackedWindows() {
        for (const [win, ids] of this._trackedWindows) {
            this._untrackWindow(win, ids);
        }
        this._trackedWindows.clear();
    }

    /**
     * Obsługa nowo tworzonego okna.
     * Gry często otwierają małe okno (launcher, splash) → potem dopiero
     * główne okno gry. Dodajemy je od razu do śledzenia i planujemy
     * opóźniony re-check (gra może resize-ować się do fullscreen z małym opóźnieniem).
     */
    _onWindowCreated(win) {
        if (!this._enabled) return;

        // Poczekaj chwilę aż okno dostanie właściwy typ/rozmiar
        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            if (!this._enabled) return GLib.SOURCE_REMOVE;
            this._rebuildTrackedWindows();
            this._queueProximityCheck();
            return GLib.SOURCE_REMOVE;
        });

        // Drugi re-check po NEW_WINDOW_RECHECK_DELAY ms
        // (dla gier które robią resize z opóźnieniem)
        if (this._newWinRecheckId) {
            GLib.source_remove(this._newWinRecheckId);
        }
        this._newWinRecheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, NEW_WINDOW_RECHECK_DELAY, () => {
            this._newWinRecheckId = 0;
            if (!this._enabled) return GLib.SOURCE_REMOVE;
            this._rebuildTrackedWindows();
            this._queueProximityCheck();
            return GLib.SOURCE_REMOVE;
        });
    }

    // ─── fullscreen detection ─────────────────────────────────────────────────

    /**
     * Sprawdza CZY JAKIEKOLWIEK okno na workspace jest fullscreen/borderless
     * ORAZ czy znajduje się ono na wierzchu (fix dla Alt+Tab).
     */
    _isAnyWindowFullscreen() {
        // Zawsze pokazuj pasek w trybie Overview (Aktywności)
        if (Main.overview.visible) return false;

        const ws = global.workspace_manager.get_active_workspace();
        let windows = ws.list_windows();
        
        // KLUCZOWA LINIA: Sortujemy okna według faktycznej kolejności na stosie (od spodu do góry)
        windows = global.display.sort_windows_by_stacking(windows);
        
        let foundFullscreen = false;
        let fullscreenZIndex = -1;
        let focusedZIndex = -1;

        for (let i = 0; i < windows.length; i++) {
            const win = windows[i];
            if (win.minimized || win.is_hidden()) continue;
            if (win.get_monitor() !== this._monitor.index) continue;

            // Zapisujemy pozycję aktywnego okna na stosie
            if (win.has_focus()) {
                focusedZIndex = i;
            }

            // Korzystamy z Twojej funkcji sprawdzającej wymiary gry
            if (this._windowIsFullscreen(win)) {
                foundFullscreen = true;
                fullscreenZIndex = i;
            }
        }

        // Jeśli nie ma żadnej gry na ekranie - pasek działa normalnie
        if (!foundFullscreen) return false;

        // Jeśli okno z focusem jest WYŻEJ niż gra (np. przeglądarka po Alt+Tab),
        // to odblokowujemy pasek, bo gra jest "pod spodem".
        if (focusedZIndex > fullscreenZIndex) {
            return false;
        }

        return true;
    }

    /**
     * Ocenia czy pojedyncze okno jest fullscreen lub borderless fullscreen (gra).
     */
    _windowIsFullscreen(win) {
        // Prawdziwy fullscreen (F11, exclusive fullscreen)
        if (win.fullscreen) return true;

        const rect = win.get_frame_rect();
        const mon  = this._monitor;
        const tol  = 2; // piksele tolerancji (niektóre gry mają 1px offset)

        const coversMonitor = (
            Math.abs(rect.x      - mon.x)      <= tol &&
            Math.abs(rect.y      - mon.y)      <= tol &&
            Math.abs(rect.width  - mon.width)  <= tol &&
            Math.abs(rect.height - mon.height) <= tol
        );
        if (!coversMonitor) return false;

        // Zmaksymalizowane poziomo+pionowo = normalna maksymalizacja, nie gra
        if (win.maximized_horizontally && win.maximized_vertically) return false;

        // Pokrywa monitor, nie jest zmaksymalizowane → borderless fullscreen (gra)
        return true;
    }

    // ─── proximity check ─────────────────────────────────────────────────────

    _queueProximityCheck() {
        if (!this._enabled) return;
        if (this._checkDebounceId) return;
        
        // KLUCZOWE: 250ms opóźnienia, aby przeczekać animację powiększania/minimalizacji okna GNOME
        this._checkDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._checkDebounceId = 0;
            this._checkProximity();
            return GLib.SOURCE_REMOVE;
        });
    }

    _checkProximity() {
        if (!this._enabled) return;
        if (!this._panel || this._panel.get_stage() === null || this._panel._panelDestroyed) return;

        // Jeśli jakiekolwiek okno jest fullscreen → ukryj panel bez dalszego sprawdzania
        if (this._isAnyWindowFullscreen()) {
            this._proximityOverlap = true;
            this._updatePanelVisibility(false); // BUG FIX: Zawsze aktualizuj stan, bez wględu na to, co było wcześniej
            return;
        }

        const geom = this._getGeometry();
        if (!geom) return;

        let overlap = false;
        const ws = global.workspace_manager.get_active_workspace();

        for (const win of ws.list_windows()) {
            if (win.minimized || win.is_hidden()) continue;
            if (win.get_monitor() !== this._monitor.index) continue;

            const type = win.get_window_type();
            if (type > Meta.WindowType.SPLASHSCREEN || type === Meta.WindowType.DESKTOP) continue;

            const rect = win.get_frame_rect();
            if (rect.x < geom.x + geom.width  &&
                rect.x + rect.width  > geom.x  &&
                rect.y < geom.y + geom.height  &&
                rect.y + rect.height > geom.y) {
                overlap = true;
                break;
            }
        }

        this._proximityOverlap = overlap;
        this._updatePanelVisibility(false); // Zawsze na nowo weryfikuj ukrywanie/pokazywanie
    }

    _getGeometry() {
        if (this._targetBox) {
            return {
                x      : this._targetBox.x1,
                y      : this._targetBox.y1,
                width  : this._targetBox.x2 - this._targetBox.x1,
                height : this._targetBox.y2 - this._targetBox.y1,
            };
        }
        if (!this._panel) return null;
        const [px, py] = this._panel.get_transformed_position();
        return {
            x      : px,
            y      : py,
            width  : this._panel.width || this._monitor.width,
            height : this._panel.height,
        };
    }

    // ─── pointer ─────────────────────────────────────────────────────────────

    _onPointerMove(x, y) {
        if (!this._enabled) return;

        // W fullscreen nie reagujemy na myszkę (gra wyłączna)
        if (this._isAnyWindowFullscreen()) return;

        const mon = this._monitor;
        const isAtBottomEdge = (y >= mon.y + mon.height - EDGE_THRESHOLD);

        let isOverPanel = false;
        if (this._panel) {
            const [px, py] = this._panel.get_transformed_position();
            const pw = this._panel.width;
            const ph = this._panel.height;
            isOverPanel = (
                x >= px - HOVER_EXTEND_HORIZONTAL &&
                x <= px + pw + HOVER_EXTEND_HORIZONTAL &&
                y >= py - HOVER_EXTEND_TOP &&
                y <= py + ph + HOVER_EXTEND_BOTTOM
            );
        }

        if (!isOverPanel) {
            let actor = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, x, y);
            while (actor) {
                if (actor.has_style_class_name && actor.has_style_class_name('tb-arrow')) {
                    isOverPanel = true; break;
                }
                actor = actor.get_parent();
            }
        }

        const wantHover = (isAtBottomEdge || isOverPanel);
        if (wantHover === this._hover) return;

        if (wantHover) {
            if (this._showTimer) return;
            this._showTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_DELAY_MS, () => {
                this._showTimer = null;
                if (!this._enabled) return GLib.SOURCE_REMOVE;
                this._hover = true;
                this._updatePanelVisibility(false);
                return GLib.SOURCE_REMOVE;
            });
        } else {
            if (this._showTimer) { GLib.source_remove(this._showTimer); this._showTimer = null; }
            if (this._hover) {
                this._hover = false;
                this._updatePanelVisibility(false);
            }
        }
    }

    // ─── visibility logic ─────────────────────────────────────────────────────

    _shouldBeVisible() {
        if (Main.overview.visible)      return true;
        if (this._holdCounter > 0)      return true;
        if (this._isAnyWindowFullscreen()) return false;
        if (this._hover)                return true;
        if (this._proximityOverlap)     return false;
        return true;
    }

    _updatePanelVisibility(immediate) {
        if (!this._enabled) return;
        const wantVisible = this._shouldBeVisible();
        if (wantVisible === this._visible && !immediate) return;
        wantVisible ? this._showPanel(immediate) : this._scheduleHide(immediate);
    }

    _showPanel(immediate) {
        if (this._hideTimer) { GLib.source_remove(this._hideTimer); this._hideTimer = null; }
        this.emit('showing');
        this._visible = true;
        this._cancelAnimation();
        this._panel.show();
        this._panel.set_reactive(true);
        if (immediate) {
            this._panel.translation_y = 0;
            this._panel.opacity = 255;
        } else {
            this._animateTo(0, 0);
        }
    }

    _scheduleHide(immediate) {
        if (this._hideTimer) GLib.source_remove(this._hideTimer);
        const delay = immediate ? 0 : HIDE_DELAY;
        if (delay === 0) {
            this._hidePanel();
        } else {
            this._hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._hideTimer = null;
                this._hidePanel();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _hidePanel() {
        this.emit('hiding');
        this._visible = false;
        this._cancelAnimation();
        const targetY = this._panel.height;
        this._animateTo(targetY, 0, () => {
            this._panel.opacity = 0;
            this._panel.set_reactive(false);
            Main.layoutManager._queueUpdateRegions();
        });
    }

    _animateTo(targetY, delay, onComplete) {
        const current = this._panel.translation_y;
        if (current === targetY) { if (onComplete) onComplete(); return; }
        this._panel.ease({
            translation_y : targetY,
            opacity       : targetY === 0 ? 255 : 0,
            duration      : ANIMATION_TIME,
            delay,
            mode          : Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped     : () => {
                if (onComplete) onComplete();
                Main.layoutManager._queueUpdateRegions();
            },
        });
    }

    _cancelAnimation() {
        this._panel.remove_all_transitions();
    }
});
