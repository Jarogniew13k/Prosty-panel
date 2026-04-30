// Prosty Panel — floatpanel.js (Z zaawansowanym śledzeniem okien i Alt+Tab Fix)

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { PANEL_HEIGHT } from './constants.js';
import { BottomTaskbar } from './classicpanel.js';
import { Intellihide } from './intellihide.js';

const FLOAT_MARGIN = 8;
const STRUT_HEIGHT = 64; 
const NEW_WINDOW_RECHECK_DELAY = 800; // Opóźnienie dla gier z launcherami

export class FloatPanel {
    constructor({ autoHide = false, settings = null }) {
        this._autoHide = autoHide;
        this._settings = settings;
        this._bar = null;
        this._dummyStrut = null;
        this._intellihide = null;
        
        this._monitorId = 0;
        this._themeId = 0;
        this._unredirectDisabled = false;
        this._targetBox = null;
        this._wasVisible = true;
        
        // Zmienne do zaawansowanego śledzenia okien (gdy autoHide = false)
        this._checkDebounceId = 0;
        this._newWinRecheckId = 0;
        this._staticSignals = [];
        this._trackedWindows = new Map();
    }

    enable() {
        this._hideTopPanel();
        const mon = Main.layoutManager.primaryMonitor;

        if (!this._autoHide) {
            this._dummyStrut = new St.Widget({ width: mon.width, height: STRUT_HEIGHT, opacity: 0, reactive: false });
            Main.layoutManager.addChrome(this._dummyStrut, { affectsStruts: true, trackFullscreen: false });
            this._dummyStrut.set_position(mon.x, mon.y + mon.height - STRUT_HEIGHT);
        }

        this._disableUnredirect();

        this._bar = new BottomTaskbar(this._settings);
        this._bar.add_style_class_name('mode-floating');

        Main.layoutManager.addTopChrome(this._bar, { affectsStruts: false, trackFullscreen: false });

        this._reposition();
        this._updateTargetBox();

        this._monitorId = Main.layoutManager.connect('monitors-changed', () => {
            this._reposition();
            this._updateTargetBox();
            if (this._dummyStrut && !this._autoHide) {
                const m = Main.layoutManager.primaryMonitor;
                this._dummyStrut.set_size(m.width, STRUT_HEIGHT);
                this._dummyStrut.set_position(m.x, m.y + m.height - STRUT_HEIGHT);
            }
        });

        if (this._settings) {
            this._themeId = this._settings.connect('changed::theme', () => {
                if (this._bar && typeof this._bar._applyTheme === 'function') this._bar._applyTheme();
            });
        }

        this._bar.visible = true;
        this._bar.translation_y = 0;

        if (this._autoHide) {
            this._enableIntellihide();
        } else {
            // Uruchomienie zaawansowanego śledzenia okien dla trybu wyłączonego auto-hide
            this._enableStaticTracker();
        }
    }

    disable() {
        if (this._themeId && this._settings) { this._settings.disconnect(this._themeId); this._themeId = 0; }
        if (this._monitorId) { Main.layoutManager.disconnect(this._monitorId); this._monitorId = 0; }
        
        this._disableStaticTracker();
        
        if (this._intellihide) { this._intellihide.disable(); this._intellihide = null; }
        if (this._dummyStrut) { Main.layoutManager.removeChrome(this._dummyStrut); this._dummyStrut.destroy(); this._dummyStrut = null; }
        if (this._bar) { Main.layoutManager.removeChrome(this._bar); this._bar.destroy(); }
        
        this._enableUnredirect();
        this._showTopPanel();
    }

    // =========================================================================
    //   ZAAWANSOWANY TRACKER OKIEN (Wzorowany na logice Intellihide)
    // =========================================================================

    _enableStaticTracker() {
        const bind = (obj, sig, cb) => {
            const id = obj.connect(sig, cb);
            this._staticSignals.push({ obj, id });
        };

        // Kiedy Overview (Aktywności) jest włączane/wyłączane
        bind(Main.overview, 'showing', () => this._queueFullscreenCheck());
        bind(Main.overview, 'hidden', () => this._queueFullscreenCheck());

        bind(global.display, 'notify::focus-window', () => {
            this._rebuildTrackedWindows();
            this._queueFullscreenCheck();
        });

        bind(global.display, 'window-created', (_dpy, win) => {
            this._onWindowCreated(win);
        });

        bind(global.display, 'restacked', () => this._queueFullscreenCheck());
        
        bind(global.window_manager, 'switch-workspace', () => {
            this._rebuildTrackedWindows();
            this._queueFullscreenCheck();
        });
        
        bind(global.window_manager, 'map', () => {
            this._rebuildTrackedWindows();
            this._queueFullscreenCheck();
        });

        this._rebuildTrackedWindows();
        this._queueFullscreenCheck();
    }

    _disableStaticTracker() {
        if (this._newWinRecheckId) { GLib.source_remove(this._newWinRecheckId); this._newWinRecheckId = 0; }
        if (this._checkDebounceId) { GLib.source_remove(this._checkDebounceId); this._checkDebounceId = 0; }
        
        for (const sig of this._staticSignals) {
            try { sig.obj.disconnect(sig.id); } catch(e) {}
        }
        this._staticSignals = [];
        this._clearAllTrackedWindows();
    }

    _rebuildTrackedWindows() {
        const ws = global.workspace_manager.get_active_workspace();
        const current = new Set(ws.list_windows());

        for (const [win, ids] of this._trackedWindows) {
            if (!current.has(win)) {
                this._untrackWindow(win, ids);
                this._trackedWindows.delete(win);
            }
        }

        for (const win of current) {
            if (!this._trackedWindows.has(win)) {
                this._trackWindow(win);
            }
        }
    }

    _trackWindow(win) {
        const cb = () => this._queueFullscreenCheck();
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
            try { ids.push(win.connect(sig, cb)); } catch(e) {}
        }
        this._trackedWindows.set(win, ids);
    }

    _untrackWindow(win, ids) {
        if (!ids) ids = this._trackedWindows.get(win) || [];
        for (const id of ids) {
            try { win.disconnect(id); } catch(e) {}
        }
    }

    _clearAllTrackedWindows() {
        for (const [win, ids] of this._trackedWindows) {
            this._untrackWindow(win, ids);
        }
        this._trackedWindows.clear();
    }

    _onWindowCreated(win) {
        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._rebuildTrackedWindows();
            this._queueFullscreenCheck();
            return GLib.SOURCE_REMOVE;
        });

        if (this._newWinRecheckId) GLib.source_remove(this._newWinRecheckId);
        
        this._newWinRecheckId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, NEW_WINDOW_RECHECK_DELAY, () => {
            this._newWinRecheckId = 0;
            this._rebuildTrackedWindows();
            this._queueFullscreenCheck();
            return GLib.SOURCE_REMOVE;
        });
    }

    _queueFullscreenCheck() {
        if (this._checkDebounceId) return;
        
        // Zmieniono z idle_add na timeout 250ms, żeby przeczekać animację okna
        this._checkDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
            this._checkDebounceId = 0;
            this._updateStaticVisibility();
            return GLib.SOURCE_REMOVE;
        });
    }

    // =========================================================================
    //   LOGIKA WIDOCZNOŚCI (Z Z-INDEX I ALTTAB FIX)
    // =========================================================================

    _updateStaticVisibility() {
        if (!this._bar || this._autoHide) return;
        
        // Zawsze pokazuj pasek w Overview
        if (Main.overview.visible) {
            if (!this._bar.visible) { this._bar.visible = true; this._wasVisible = true; }
            return;
        }

        const mon = Main.layoutManager.primaryMonitor;
        const ws = global.workspace_manager.get_active_workspace();
        let windows = ws.list_windows();
        
        // Tak samo tutaj - sortujemy okna według warstw
        windows = global.display.sort_windows_by_stacking(windows);
        
        let foundFullscreen = false;
        let fullscreenZIndex = -1;
        let focusedZIndex = -1;

        for (let i = 0; i < windows.length; i++) {
            const win = windows[i];
            if (win.get_monitor() !== mon.index || win.minimized || win.is_hidden())
                continue;

            if (win.has_focus()) {
                focusedZIndex = i;
            }

            const rect = win.get_frame_rect();
            const isFullscreenSize = (rect.x <= mon.x && rect.y <= mon.y &&
                                      rect.width >= mon.width && rect.height >= mon.height);
            const type = win.get_window_type();
            
            if (win.fullscreen || (isFullscreenSize && 
                !(win.maximized_horizontally && win.maximized_vertically) &&
                type <= Meta.WindowType.SPLASHSCREEN && type !== Meta.WindowType.DESKTOP)) {
                
                foundFullscreen = true;
                fullscreenZIndex = i;
            }
        }

        let shouldHide = foundFullscreen;
        
        // Jeśli okno z focusem jest nad grą - pokazujemy pasek
        if (foundFullscreen && focusedZIndex > fullscreenZIndex) {
            shouldHide = false;
        }

        if (shouldHide) {
            if (this._bar.visible) { this._wasVisible = true; this._bar.visible = false; }
        } else {
            if (!this._bar.visible && this._wasVisible) { this._bar.visible = true; }
        }
    }

    // =========================================================================

    _updateTargetBox() {
        if (!this._bar) return;
        const mon = Main.layoutManager.primaryMonitor;
        const x = mon.x + FLOAT_MARGIN;
        const y = mon.y + mon.height - PANEL_HEIGHT - FLOAT_MARGIN;
        const w = mon.width - 2 * FLOAT_MARGIN;

        if (!this._targetBox) this._targetBox = new Clutter.ActorBox();
        this._targetBox.set_origin(x, y);
        this._targetBox.set_size(w, PANEL_HEIGHT);

        if (this._intellihide && typeof this._intellihide.updateTargetBox === 'function') {
            this._intellihide.updateTargetBox(this._targetBox);
        }
    }

    _disableUnredirect() {
        if (this._unredirectDisabled) return;
        try {
            if (Meta.disable_unredirect_for_display) Meta.disable_unredirect_for_display(global.display);
            else if (global.compositor?.disable_unredirect) global.compositor.disable_unredirect();
            this._unredirectDisabled = true;
        } catch(e) {}
    }

    _enableUnredirect() {
        if (!this._unredirectDisabled) return;
        try {
            if (Meta.enable_unredirect_for_display) Meta.enable_unredirect_for_display(global.display);
            else if (global.compositor?.enable_unredirect) global.compositor.enable_unredirect();
            this._unredirectDisabled = false;
        } catch(e) {}
    }

    _enableIntellihide() {
        if (!this._intellihide && this._bar) {
            const mon = Main.layoutManager.primaryMonitor;
            this._intellihide = new Intellihide(this._bar, mon, this._bar);
            this._bar._intellihide = this._intellihide;
            if (this._targetBox) this._intellihide.updateTargetBox(this._targetBox);
            this._intellihide.connect('showing', () => this._disableUnredirect());
            this._intellihide.connect('hiding', () => this._enableUnredirect());
            this._intellihide.enable();
        }
    }

    _hideTopPanel() {
        Main.panel.hide();
        Main.layoutManager.panelBox.hide();
        let idx = Main.layoutManager._findActor(Main.layoutManager.panelBox);
        if (idx >= 0) {
            this._oldAffectsStruts = Main.layoutManager._trackedActors[idx].affectsStruts;
            Main.layoutManager._trackedActors[idx].affectsStruts = false;
            Main.layoutManager._queueUpdateRegions();
        }
        if (Main.overview?.dash) {
            this._dashOrigVisible = Main.overview.dash.visible;
            this._dashOrigShow = Main.overview.dash.show;
            Main.overview.dash.show = function() {};
            Main.overview.dash.hide();
        }
    }

    _showTopPanel() {
        Main.layoutManager.panelBox.show();
        Main.panel.show();
        if (this._oldAffectsStruts !== undefined) {
            let idx = Main.layoutManager._findActor(Main.layoutManager.panelBox);
            if (idx >= 0) Main.layoutManager._trackedActors[idx].affectsStruts = this._oldAffectsStruts;
            this._oldAffectsStruts = undefined;
            Main.layoutManager._queueUpdateRegions();
        }
        if (Main.overview?.dash && this._dashOrigShow) {
            Main.overview.dash.show = this._dashOrigShow;
            Main.overview.dash.visible = this._dashOrigVisible;
            this._dashOrigShow = undefined;
            this._dashOrigVisible = undefined;
        }
    }

    _reposition() {
        if (!this._bar) return;
        const mon = Main.layoutManager.primaryMonitor;
        const x = mon.x + FLOAT_MARGIN;
        const y = mon.y + mon.height - PANEL_HEIGHT - FLOAT_MARGIN;
        const w = mon.width - 2 * FLOAT_MARGIN;
        this._bar.set_position(x, y);
        this._bar.set_size(w, PANEL_HEIGHT);
        this._bar.visible = true;
    }
}
