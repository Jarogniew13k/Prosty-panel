// Prosty Panel — classicpanel.js (Bez monkey-patchingu, uszczelniony wyciek pamięci)

import GObject from 'gi://GObject';
import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import { PANEL_HEIGHT }       from './constants.js';
import { makeSep, openMenuAboveBar } from './utils.js';
import { buildActivities }    from './activities.js';
import { buildAppsList }      from './apps-list.js';
import { buildTrayArrow, closeTrayPopup } from './tray-popup.js';
import { buildSystemGroup }   from './system-group.js';
import { buildClock }         from './clock.js';
import { buildExtraStatus }   from './extra-status.js';

export const BottomTaskbar = GObject.registerClass({
    Signals: { 
        'menu-opened': {}, 'menu-closed': {}, 'drag-start': {}, 'drag-end': {},
        'reorder-running': { param_types: [GObject.TYPE_JSOBJECT] }
    },
}, class BottomTaskbar extends St.BoxLayout {
    _init(settings) {
        super._init({
            name: 'gnome-bottom-panel', style_class: 'bottom-taskbar',
            reactive: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER,
        });
        this._settings = settings;
        this._buttons   = new Map();
        this._ready     = false;
        this._sysBindIdleId = 0;
        this._startupId = 0;
        this._openMenus = new Set();
        
        this._buildLeft(); this._buildCenterSpacer(); this._buildRight();
        
        this._apps.rebuildApps(); this._apps.connectSignals();
        this._clock.startClock(); this._clock.bindNotifications();
        this._sys.bindSystemIndicators(); this._applyTheme();
        
        if (Main.layoutManager._startingUp) {
            this._startupId = Main.layoutManager.connect('startup-complete', () => {
                this._ready = true;
                Main.layoutManager.disconnect(this._startupId);
                this._startupId = 0;
            });
        } else {
            this._ready = true;
        }
    }

    _applyTheme() {
        const theme = this._settings.get_string('theme');
        const classes = this.get_style_class_name().split(' ');
        for (const cls of classes) if (cls.startsWith('theme-')) this.remove_style_class_name(cls);
        this.add_style_class_name(`theme-${theme}`);
    }

    _buildLeft() {
        this._activitiesBtn = buildActivities();
        this.add_child(this._activitiesBtn);
        this.add_child(makeSep());
        this._apps = buildAppsList(this);
        this.add_child(this._apps.actor);
    }

    _buildCenterSpacer() {
        this._spacer = new St.Widget({ x_expand: true, reactive: true });
        this.add_child(this._spacer);
        this._spacerMenu = new PopupMenu.PopupMenu(this._spacer, 0.5, St.Side.BOTTOM);
        Main.uiGroup.add_child(this._spacerMenu.actor);
        this._spacerMenu.actor.hide();
        this._spacerMenuMgr = new PopupMenu.PopupMenuManager(this);
        this._spacerMenuMgr.addMenu(this._spacerMenu);
        this._openMenus.add(this._spacerMenu);
        const addSpacerMenuItem = (label, cmd, callback) => {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => { if (cmd) Util.spawnCommandLine(cmd); if (callback) callback(); });
            this._spacerMenu.addMenuItem(item);
        };
        addSpacerMenuItem('System monitor', 'gnome-system-monitor');
        addSpacerMenuItem('Files', 'nautilus');
        this._spacerMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        addSpacerMenuItem('Ustawienia GNOME', 'gnome-control-center');
        
        addSpacerMenuItem('Ustawienia panelu', null, () => {
            const extensionObject = Main.extensionManager.lookup('gnome-panel@user.local');
            if (extensionObject && typeof extensionObject.openPreferences === 'function') extensionObject.openPreferences();
            else Util.spawnCommandLine('gnome-extensions prefs gnome-panel@user.local');
        });
        
        this._spacerMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        addSpacerMenuItem('Pokaż pulpit', null, () => {
            const ws = global.workspace_manager.get_active_workspace();
            const windows = ws.list_windows().filter(w => w.get_window_type() === 0);
            const allMinimized = windows.every(w => w.minimized);
            windows.forEach(w => allMinimized ? w.unminimize() : w.minimize());
        });
        this._spacer.connect('button-press-event', (_actor, event) => {
            if (event.get_button() === 3) { 
                const [x, y] = event.get_coords();
                openMenuAboveBar(this._spacerMenu, this._spacer, 4, null, false, x);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _buildRight() {
        this._extraStatusBox = buildExtraStatus(this); this.add_child(this._extraStatusBox);
        this.add_child(makeSep()); this.add_child(buildTrayArrow(this));
        this._sys = buildSystemGroup(this); this.add_child(this._sys.actor);
        this.add_child(makeSep()); this._clock = buildClock(this); this.add_child(this._clock.actor);
    }

    _cleanup() {
        this._panelDestroyed = true;
        this._ready = false;

        // 🟢 FIX: Zwolnienie PopupMenu przycisku Aktywności z UI Group
        if (this._activitiesBtn && typeof this._activitiesBtn._cleanup === 'function') {
            this._activitiesBtn._cleanup();
        }

        if (this._extraStatusCleanup) this._extraStatusCleanup();
        if (this._trayPopup) { closeTrayPopup(this); this._trayPopup = null; this._trayPopupStageId = 0; }
        for (const menu of this._openMenus) {
            try { menu._tbForceClosing = true; if (menu.isOpen) menu.close(); } catch(e) {}
        }
        this._openMenus.clear();
        if (this._spacerMenu) { this._spacerMenu.destroy(); this._spacerMenu = null; }
        if (this._sysBindIdleId) { GLib.source_remove(this._sysBindIdleId); this._sysBindIdleId = 0; }

        if (this._apps && typeof this._apps.actor._cleanup === 'function') this._apps.actor._cleanup();
        this._clock?.stopClock();

        if (this._startupId) {
            try { Main.layoutManager.disconnect(this._startupId); } catch(e) {}
            this._startupId = 0;
        }
        if (this._readyTimer) { GLib.source_remove(this._readyTimer); this._readyTimer = 0; }
    }
});

// UWAGA: Kod poniżej został celowo rozbity z floatpanel.js
// w celu ułatwienia przyszłej, niezależnej modyfikacji marginesów i styli.
export class ClassicPanel {
    constructor(settings) { this._settings = settings; this._bar = null; this._monitorId = 0; this._themeId = 0; }
    enable() {
        this._hideTopPanel();
        this._bar = new BottomTaskbar(this._settings);
        Main.layoutManager.addChrome(this._bar, { affectsStruts: true, trackFullscreen: true });
        this._reposition();
        this._monitorId = Main.layoutManager.connect('monitors-changed', () => this._reposition());
        this._themeId = this._settings.connect('changed::theme', () => { if (this._bar && typeof this._bar._applyTheme === 'function') this._bar._applyTheme(); });
    }
    disable() {
        if (this._themeId) { this._settings.disconnect(this._themeId); this._themeId = 0; }
        if (this._monitorId) { Main.layoutManager.disconnect(this._monitorId); this._monitorId = null; }
        this._showTopPanel();
        
        if (this._bar) {
            if (typeof this._bar._cleanup === 'function') this._bar._cleanup();
            Main.layoutManager.removeChrome(this._bar); 
            this._bar.destroy(); 
            this._bar = null;
        }
    }
    
    _hideTopPanel() {
        Main.panel.opacity = 0; 
        Main.layoutManager.panelBox.opacity = 0;
        
        const panelHeight = Main.layoutManager.panelBox.height || 40;
        Main.layoutManager.panelBox.translation_y = -panelHeight;
        
        let idx = Main.layoutManager._findActor(Main.layoutManager.panelBox);
        if (idx >= 0) {
            this._oldAffectsStruts = Main.layoutManager._trackedActors[idx].affectsStruts;
            Main.layoutManager._trackedActors[idx].affectsStruts = false;
            Main.layoutManager._queueUpdateRegions();
        }
        
        if (Main.overview?.dash) { 
            this._dashOrigOpacity = Main.overview.dash.opacity;
            this._dashOrigReactive = Main.overview.dash.reactive;
            Main.overview.dash.opacity = 0;
            Main.overview.dash.reactive = false;
        }
    }
    
    _showTopPanel() {
        Main.panel.opacity = 255; 
        Main.layoutManager.panelBox.opacity = 255;
        Main.layoutManager.panelBox.translation_y = 0;
        
        if (this._oldAffectsStruts !== undefined) {
            let idx = Main.layoutManager._findActor(Main.layoutManager.panelBox);
            if (idx >= 0) Main.layoutManager._trackedActors[idx].affectsStruts = this._oldAffectsStruts;
            this._oldAffectsStruts = undefined; 
            Main.layoutManager._queueUpdateRegions();
        }
        
        if (Main.overview?.dash) {
            if (this._dashOrigOpacity !== undefined) Main.overview.dash.opacity = this._dashOrigOpacity;
            if (this._dashOrigReactive !== undefined) Main.overview.dash.reactive = this._dashOrigReactive;
            this._dashOrigOpacity = undefined;
            this._dashOrigReactive = undefined;
        }
    }
    
    _reposition() {
        const mon = Main.layoutManager.primaryMonitor;
        this._bar.set_position(mon.x, mon.y + mon.height - PANEL_HEIGHT);
        this._bar.set_size(mon.width, PANEL_HEIGHT);
    }
}