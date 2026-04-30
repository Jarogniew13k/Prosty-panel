// Prosty Panel — classicpanel.js (Z przywróconym sygnałem reorder-running i bezpiecznym zamykaniem)

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

function buildExtraStatus(host) {
    const box = new St.BoxLayout({
        style_class: 'tb-extra-status',
        y_align: Clutter.ActorAlign.CENTER,
        style: 'spacing: 4px;'
    });

    const recBtn = new St.Button({
        style_class: 'tb-rec-pill',
        reactive: true,
        can_focus: true,
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const recBox = new St.BoxLayout({
        y_align: Clutter.ActorAlign.CENTER,
        style: 'spacing: 6px;' 
    });
    const recIcon = new St.Icon({
        icon_name: 'media-record-symbolic',
        icon_size: 14,
        style_class: 'tb-rec-icon'
    });
    const recLabel = new St.Label({
        style_class: 'tb-rec-label',
        y_align: Clutter.ActorAlign.CENTER,
        text: '0:00'
    });
    recBox.add_child(recIcon);
    recBox.add_child(recLabel);
    recBtn.set_child(recBox);

    recBtn.connect('clicked', () => {
        const sr = Main.panel.statusArea.screenRecording;
        if (sr) {
            if (Main.screenshotUI && typeof Main.screenshotUI.stopScreencast === 'function') {
                Main.screenshotUI.stopScreencast();
            } else if (typeof sr._stopRecording === 'function') {
                sr._stopRecording();
            } else if (global.screencast && typeof global.screencast.stop === 'function') {
                global.screencast.stop();
            }
        }
    });

    const kbdBtn = new St.Button({
        style_class: 'tb-btn tb-kbd-btn',
        reactive: true,
        can_focus: true,
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const kbdLabel = new St.Label({
        style_class: 'tb-kbd-label',
        y_align: Clutter.ActorAlign.CENTER,
        text: ''
    });
    kbdBtn.set_child(kbdLabel);
    
    kbdBtn.connect('clicked', () => {
        const kbd = Main.panel.statusArea.keyboard;
        if (kbd && kbd.menu) {
            openMenuAboveBar(kbd.menu, kbdBtn, 4, null, true);
        }
    });

    box.add_child(recBtn);
    box.add_child(kbdBtn);

    let kbdLabelActor = null;
    let kbdTextSignal = 0;
    let recTimerId = 0;

    const findKbdLabel = () => {
        const kbd = Main.panel.statusArea.keyboard;
        if (!kbd) return null;
        if (kbd._label instanceof St.Label) return kbd._label;
        if (kbd._indicator instanceof St.Label) return kbd._indicator;
        
        let found = null;
        const walk = (actor) => {
            if (found) return;
            if (actor instanceof St.Label && actor.get_text()) { found = actor; return; }
            if (typeof actor.get_children === 'function') {
                for (const c of actor.get_children()) walk(c);
            }
        };
        walk(kbd);
        return found;
    };

    const syncRec = () => {
        if (host._panelDestroyed) return;
        const sr = Main.panel.statusArea.screenRecording;
        
        if (!sr || !sr.visible) {
            recBtn.visible = false;
            if (recTimerId) {
                GLib.source_remove(recTimerId);
                recTimerId = 0;
            }
            return;
        }
        
        recBtn.visible = true;

        const updateTime = () => {
            let foundLabel = null;
            const walk = (actor) => {
                if (foundLabel) return;
                if (actor instanceof St.Label && actor.get_text() && actor.get_text().includes(':')) {
                    foundLabel = actor;
                    return;
                }
                if (typeof actor.get_children === 'function') {
                    for (const c of actor.get_children()) walk(c);
                }
            };
            walk(sr);
            if (foundLabel) recLabel.set_text(foundLabel.get_text());
        };

        updateTime();

        if (!recTimerId) {
            recTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                if (host._panelDestroyed || !sr.visible) {
                    recTimerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                updateTime();
                return GLib.SOURCE_CONTINUE;
            });
        }
    };

    const syncKbd = () => {
        if (host._panelDestroyed) return;
        const kbd = Main.panel.statusArea.keyboard;
        if (!kbd) {
            kbdBtn.visible = false;
            return;
        }
        
        kbdBtn.visible = kbd.visible;

        if (!kbdLabelActor) {
            kbdLabelActor = findKbdLabel();
            if (kbdLabelActor) {
                kbdTextSignal = kbdLabelActor.connect('notify::text', () => {
                    if (!host._panelDestroyed) kbdLabel.set_text(kbdLabelActor.get_text());
                });
                host._signalIds.push([kbdLabelActor, kbdTextSignal]);
                kbdLabel.set_text(kbdLabelActor.get_text());
            }
        } else {
            kbdLabel.set_text(kbdLabelActor.get_text());
        }
    };

    GLib.idle_add(GLib.PRIORITY_LOW, () => {
        if (host._panelDestroyed) return GLib.SOURCE_REMOVE;
        
        const sr = Main.panel.statusArea.screenRecording;
        if (sr) host._signalIds.push([sr, sr.connect('notify::visible', syncRec)]);

        const kbd = Main.panel.statusArea.keyboard;
        if (kbd) host._signalIds.push([kbd, kbd.connect('notify::visible', syncKbd)]);
        
        syncRec();
        syncKbd();
        return GLib.SOURCE_REMOVE;
    });

    host._extraStatusCleanup = () => {
        if (recTimerId) {
            GLib.source_remove(recTimerId);
            recTimerId = 0;
        }
    };

    return box;
}

export const BottomTaskbar = GObject.registerClass({
    Signals: { 
        'menu-opened': {}, 
        'menu-closed': {}, 
        'drag-start': {}, 
        'drag-end': {},
        'reorder-running': { param_types: [GObject.TYPE_JSOBJECT] } // Przywrócony sygnał!
    },
}, class BottomTaskbar extends St.BoxLayout {
    _init(settings) {
        super._init({
            name: 'gnome-bottom-panel', style_class: 'bottom-taskbar',
            reactive: true, x_expand: true, y_align: Clutter.ActorAlign.CENTER,
        });
        console.log('[Prosty Panel] BottomTaskbar created');
        this._settings = settings;
        this._buttons   = new Map();
        this._signalIds = [];
        this._ready     = false;
        this._sysBindIdleId = 0;
        this._openMenus = new Set();

        this._buildLeft();
        this._buildCenterSpacer(); 
        this._buildRight();

        this._apps.rebuildApps();
        this._apps.connectSignals();
        this._clock.startClock();
        this._clock.bindNotifications();
        this._sys.bindSystemIndicators();
        this._applyTheme();

        this._readyTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
            this._ready = true; this._readyTimer = 0; return GLib.SOURCE_REMOVE;
        });
    }

    _applyTheme() {
        const theme = this._settings.get_string('theme');
        const classes = this.get_style_class_name().split(' ');
        for (const cls of classes) {
            if (cls.startsWith('theme-')) this.remove_style_class_name(cls);
        }
        this.add_style_class_name(`theme-${theme}`);
    }

    _buildLeft() {
        this.add_child(buildActivities()); this.add_child(makeSep());
        this._apps = buildAppsList(this); this.add_child(this._apps.actor);
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
            item.connect('activate', () => {
                this._spacerMenu.close();
                if (cmd) Util.spawnCommandLine(cmd);
                if (callback) callback();
            });
            this._spacerMenu.addMenuItem(item);
        };

        addSpacerMenuItem('System monitor', 'gnome-system-monitor');
        addSpacerMenuItem('Files', 'nautilus');
        
        this._spacerMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        addSpacerMenuItem('Ustawienia GNOME', 'gnome-control-center');
        addSpacerMenuItem('Ustawienia panelu', 'gnome-extensions prefs gnome-panel@user.local');
        
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
        this._extraStatusBox = buildExtraStatus(this);
        this.add_child(this._extraStatusBox);

        this.add_child(makeSep()); this.add_child(buildTrayArrow(this));
        this._sys = buildSystemGroup(this); this.add_child(this._sys.actor);
        this.add_child(makeSep()); this._clock = buildClock(this); this.add_child(this._clock.actor);
    }

    destroy() {
        console.log('[Prosty Panel] BottomTaskbar destroy start');
        
        if (this._extraStatusCleanup) this._extraStatusCleanup();

        if (this._trayPopup) { closeTrayPopup(this); this._trayPopup = null; this._trayPopupStageId = 0; }
        
        for (const menu of this._openMenus) {
            try {
                menu._tbForceClosing = true;
                if (menu.isOpen) menu.close(); 
            } catch(e) { console.log('[Prosty Panel] error closing menu', e); }
        }
        this._openMenus.clear();
        
        if (this._spacerMenu) {
            this._spacerMenu.destroy();
            this._spacerMenu = null;
        }

        if (this._sysBindIdleId) { 
            GLib.source_remove(this._sysBindIdleId); 
            this._sysBindIdleId = 0; 
        }
        for (const btn of this._buttons.values()) btn.destroy();
        this._buttons.clear();
        for (const [obj, id] of this._signalIds) { try { obj.disconnect(id); } catch(e) {} }
        this._signalIds = [];
        this._clock?.stopClock();
        if (this._readyTimer) { GLib.source_remove(this._readyTimer); this._readyTimer = 0; }
        this._panelDestroyed = true;
        super.destroy();
        console.log('[Prosty Panel] BottomTaskbar destroyed');
    }
});

export class ClassicPanel {
    constructor(settings) {
        this._settings = settings;
        this._bar = null;
        this._monitorId = 0;
        this._themeId = 0;
    }

    enable() {
        console.log('[Prosty Panel] ClassicPanel enable');
        this._hideTopPanel();
        this._bar = new BottomTaskbar(this._settings);
        Main.layoutManager.addChrome(this._bar, { affectsStruts: true, trackFullscreen: true });
        this._reposition();
        this._monitorId = Main.layoutManager.connect('monitors-changed', () => this._reposition());
        this._themeId = this._settings.connect('changed::theme', () => {
            if (this._bar && typeof this._bar._applyTheme === 'function')
                this._bar._applyTheme();
        });
    }

    disable() {
        console.log('[Prosty Panel] ClassicPanel disable');
        if (this._themeId) {
            this._settings.disconnect(this._themeId);
            this._themeId = 0;
        }
        if (this._monitorId) { Main.layoutManager.disconnect(this._monitorId); this._monitorId = null; }
        this._showTopPanel();
        Main.layoutManager.removeChrome(this._bar); this._bar.destroy(); this._bar = null;
    }

    _hideTopPanel() {
        console.log('[Prosty Panel] hiding top panel');
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
        console.log('[Prosty Panel] showing top panel');
        Main.layoutManager.panelBox.show();
        Main.panel.show();
        if (this._oldAffectsStruts !== undefined) {
            let idx = Main.layoutManager._findActor(Main.layoutManager.panelBox);
            if (idx >= 0) Main.layoutManager._trackedActors[idx].affectsStruts = this._oldAffectsStruts;
            this._oldAffectsStruts = undefined;
            Main.layoutManager._queueUpdateRegions();
        }
        if (Main.overview?.dash && this._dashOrigShow !== undefined) {
            Main.overview.dash.show = this._dashOrigShow;
            Main.overview.dash.visible = this._dashOrigVisible;
            this._dashOrigShow = undefined;
            this._dashOrigVisible = undefined;
        }
    }

    _reposition() {
        const mon = Main.layoutManager.primaryMonitor;
        this._bar.set_position(mon.x, mon.y + mon.height - PANEL_HEIGHT);
        this._bar.set_size(mon.width, PANEL_HEIGHT);
    }
}