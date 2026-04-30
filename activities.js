// Prosty Panel — activities.js

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';

import { ICON_SIZE } from './constants.js';
import { openMenuAboveBar } from './utils.js';

export function buildActivities() {
    const btn = new St.Button({
        style_class : 'tb-act-btn', 
        reactive    : true,
        can_focus   : true,
        track_hover : true,
        x_expand    : false,
        y_expand    : false,
        y_align     : Clutter.ActorAlign.CENTER,
    });
    
    const box = new St.BoxLayout({
        vertical : true,
        x_align  : Clutter.ActorAlign.CENTER,
        y_align  : Clutter.ActorAlign.CENTER,
    });
    btn.set_child(box);

    const icon = new St.Icon({
        icon_name   : 'view-app-grid-symbolic',
        icon_size   : ICON_SIZE,
        style_class : 'tb-act-icon',
    });
    box.add_child(icon);

    // --- MENU KONTEKSTOWE ---
    btn._menu = new PopupMenu.PopupMenu(btn, 0.5, St.Side.BOTTOM);
    Main.uiGroup.add_child(btn._menu.actor);
    btn._menu.actor.hide();
    btn._menuMgr = new PopupMenu.PopupMenuManager(btn);
    btn._menuMgr.addMenu(btn._menu);

    const addMenuItem = (label, cmd) => {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
            btn._menu.close();
            if (cmd) Util.spawnCommandLine(cmd);
        });
        btn._menu.addMenuItem(item);
    };

    // Zwrócone opcje z NAPRAWIONĄ komendą dla GNOME 46+
    addMenuItem('Opcje zasilania', 'gnome-control-center power');
    addMenuItem('Dziennik zdarzeń', 'gnome-logs');
    addMenuItem('System', 'gnome-control-center system');
    addMenuItem('Zarządzanie dyskami', 'gnome-disks');
    
    btn._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    
    addMenuItem('System monitor', 'gnome-system-monitor');
    addMenuItem('Files', 'nautilus');
    
    btn._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    
    addMenuItem('Ustawienia GNOME', 'gnome-control-center');
    addMenuItem('Ustawienia panelu', 'gnome-extensions prefs gnome-panel@user.local');

    btn.connect('clicked', () => {
        if (btn._menu.isOpen) btn._menu.close();
        if (Main.overview.visible) {
            Main.overview.hide();
        } else {
            Main.overview.showApps();
        }
    });

    btn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === 3) {
            openMenuAboveBar(btn._menu, btn, 4, null, true);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    btn.connect('destroy', () => {
        if (btn._menu) {
            btn._menu.destroy();
            btn._menu = null;
        }
    });

    return btn;
}