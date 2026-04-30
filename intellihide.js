// Prosty Panel — intellihide.js 

import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta    from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js';

const CHECK_POINTER_MS   = 50;
const ANIMATION_TIME     = 150;
const HIDE_DELAY         = 400;
const SHOW_DELAY_MS      = 0;
const EDGE_THRESHOLD     = 1;
const HOVER_EXTEND_HORIZONTAL = 15;
const HOVER_EXTEND_BOTTOM     = 20;
const HOVER_EXTEND_TOP        = 10;

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

        this._holdCounter     = 0;
        this._hover           = false;
        this._visible         = true;
        this._proximityOverlap= false;
        this._enabled         = false;
        this._targetBox       = null;

        this._hideTimer        = null;
        this._showTimer        = null;
        this._pointerWatchId   = 0;
        
        // Tablice do trzymania sygnałów z proximity
        this._generalSignals   = [];
        this._trackedWin       = null;
        this._trackedWinSignals= [];
        this._checkDebounceId  = 0;
    }

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

        // -- PODPINAMY SIĘ POD EVENTY (jak w proximity.js) --
        const bind = (obj, sig, callback) => {
            const id = obj.connect(sig, callback);
            this._generalSignals.push({ obj, id });
        };

        bind(this._taskbar, 'menu-opened', () => this.revealAndHold());
        bind(this._taskbar, 'menu-closed', () => this.release());
        bind(this._taskbar, 'drag-start',  () => this.revealAndHold());
        bind(this._taskbar, 'drag-end',    () => this.release());

        bind(Main.overview, 'showing', () => { if (this._enabled) this._updatePanelVisibility(true); });
        bind(Main.overview, 'hidden',  () => { this._queueProximityCheck(); if (this._enabled) this._updatePanelVisibility(false); });

        // Główne sygnały okien
        bind(global.display, 'notify::focus-window', () => {
            this._updateTrackedWindow();
            this._queueProximityCheck();
        });
        bind(global.display, 'restacked', () => this._queueProximityCheck());
        bind(global.window_manager, 'switch-workspace', () => this._queueProximityCheck());

        this._updateTrackedWindow();
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
        if (this._hideTimer) { GLib.source_remove(this._hideTimer); this._hideTimer = null; }
        if (this._showTimer) { GLib.source_remove(this._showTimer); this._showTimer = null; }
        if (this._checkDebounceId) { GLib.source_remove(this._checkDebounceId); this._checkDebounceId = 0; }

        for (const sig of this._generalSignals) {
            try { sig.obj.disconnect(sig.id); } catch(e) {}
        }
        this._generalSignals = [];
        this._clearTrackedWindow();

        this._panel.remove_all_transitions();
        this._panel.show();
        this._panel.opacity = 255;
        this._panel.set_reactive(true);
        this._panel.translation_y = 0;
        this._visible = true;
        this._holdCounter = 0;
        this._hover = false;
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

    reset() {
        this.disable();
        this.enable();
    }

    // --- TRACKOWANIE AKTYWNEGO OKNA ---
    _updateTrackedWindow() {
        this._clearTrackedWindow();
        const win = global.display.focus_window;
        if (win) {
            this._trackedWin = win;
            // Dodano nasłuchiwanie na maksymalizację (błyskawiczna reakcja)
            const signals = [
                'size-changed', 
                'position-changed', 
                'notify::maximized-horizontally', 
                'notify::maximized-vertically',
                'notify::fullscreen'
            ];
            for (const sig of signals) {
                this._trackedWinSignals.push(win.connect(sig, () => this._queueProximityCheck()));
            }
        }
    }

    _clearTrackedWindow() {
        if (this._trackedWin) {
            for (const id of this._trackedWinSignals) {
                try { this._trackedWin.disconnect(id); } catch(e) {}
            }
        }
        this._trackedWin = null;
        this._trackedWinSignals = [];
    }

    _queueProximityCheck() {
        if (!this._enabled) return;
        if (this._checkDebounceId) return;
        this._checkDebounceId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._checkDebounceId = 0;
            this._checkProximity();
            return GLib.SOURCE_REMOVE;
        });
    }

    _isFullscreen() {
        const activeWin = global.display.focus_window;
        if (!activeWin) return false;
        if (activeWin.get_monitor() !== this._monitor.index) return false;

        // F11 lub czysty tryb pełnoekranowy (Gry, YouTube)
        if (activeWin.fullscreen) return true;

        const rect = activeWin.get_frame_rect();
        const mon = this._monitor;
        const isFullscreenSize = (rect.x <= mon.x && rect.y <= mon.y &&
                                  rect.width >= mon.width &&
                                  rect.height >= mon.height);

        if (isFullscreenSize) {
            // KLUCZOWA POPRAWKA: Rozróżniamy zmakymalizowaną przeglądarkę od gry.
            // Jeśli użytkownik "zmaksmalizował" okno, odblokowujemy hover.
            if (activeWin.maximized_horizontally && activeWin.maximized_vertically) {
                return false; 
            }

            const type = activeWin.get_window_type();
            if (type <= Meta.WindowType.SPLASHSCREEN && type !== Meta.WindowType.DESKTOP) {
                return true;
            }
        }
        return false;
    }

    _onPointerMove(x, y) {
        if (!this._enabled) return;
        
        // Zablokuj hover TYLKO jeśli to prawdziwa gra / F11, a nie zmaksymalizowana przeglądarka!
        if (this._isFullscreen()) return;

        const mon = this._monitor;
        const isAtBottomEdge = (y >= mon.y + mon.height - EDGE_THRESHOLD);

        let isOverPanel = false;
        if (this._panel) {
            const [px, py] = this._panel.get_transformed_position();
            const pw = this._panel.width;
            const ph = this._panel.height;
            isOverPanel = (x >= px - HOVER_EXTEND_HORIZONTAL && 
                           x <= px + pw + HOVER_EXTEND_HORIZONTAL && 
                           y >= py - HOVER_EXTEND_TOP && 
                           y <= py + ph + HOVER_EXTEND_BOTTOM);
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

    _checkProximity() {
        if (!this._enabled) return;
        if (this._isFullscreen()) return;
        if (!this._panel || this._panel.get_stage() === null || this._panel._panelDestroyed) return;
        
        const geom = this._getGeometry();
        if (!geom) return;

        let overlap = false;
        const ws = global.workspace_manager.get_active_workspace();
        const windows = ws.list_windows();

        for (const win of windows) {
            if (win.minimized || win.is_hidden()) continue;
            if (win.get_monitor() !== this._monitor.index) continue;
            
            const type = win.get_window_type();
            if (type > Meta.WindowType.SPLASHSCREEN || type === Meta.WindowType.DESKTOP) continue;

            const rect = win.get_frame_rect();
            if (rect.x < geom.x + geom.width &&
                rect.x + rect.width > geom.x &&
                rect.y < geom.y + geom.height &&
                rect.y + rect.height > geom.y) {
                overlap = true;
                break;
            }
        }

        if (overlap !== this._proximityOverlap) {
            this._proximityOverlap = overlap;
            this._updatePanelVisibility(false);
        }
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

    _shouldBeVisible() {
        if (Main.overview.visible) return true;
        if (this._holdCounter > 0) return true;
        if (this._isFullscreen()) return false;
        if (this._hover) return true;
        if (this._proximityOverlap) return false;
        return true;
    }

    _updatePanelVisibility(immediate) {
        if (!this._enabled) return;
        const wantVisible = this._shouldBeVisible();
        if (wantVisible === this._visible && !immediate) return;

        if (wantVisible) this._showPanel(immediate);
        else this._scheduleHide(immediate);
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
        if (current === targetY) {
            if (onComplete) onComplete();
            return;
        }
        this._panel.ease({
            translation_y : targetY,
            opacity       : targetY === 0 ? 255 : 0,
            duration      : ANIMATION_TIME,
            delay         : delay,
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
