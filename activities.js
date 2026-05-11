// Prosty Panel — activities.js

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ICON_SIZE } from './constants.js';
import { openMenuAboveBar } from './utils.js';
import { _ } from './i18n.js';

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

    const addMenuItem = (label, cmdArray) => {
        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
            if (cmdArray) {
                try {
                    Gio.Subprocess.new(cmdArray, Gio.SubprocessFlags.NONE);
                } catch (e) { console.warn('[ProstyPanel] Błąd wywołania:', e); }
            }
        });
        btn._menu.addMenuItem(item);
    };

    // Opcje systemowe z komendami
    addMenuItem(_('Opcje zasilania'), ['gnome-control-center', 'power']);
    addMenuItem(_('Dziennik zdarzeń'), ['gnome-logs']);
    addMenuItem(_('System'), ['gnome-control-center', 'system']);
    addMenuItem(_('Zarządzanie dyskami'), ['gnome-disks']);
    
    btn._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    
    addMenuItem(_('Monitor systemu'), ['gnome-system-monitor']);
    addMenuItem(_('Pliki'), ['nautilus']);
    
    btn._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    
    addMenuItem(_('Ustawienia GNOME'), ['gnome-control-center']);
    
    const prefsItem = new PopupMenu.PopupMenuItem(_('Ustawienia panelu'));
    prefsItem.connect('activate', () => {
        try {
            const ext = Extension.lookupByURL(import.meta.url);
            if (ext && typeof ext.openPreferences === 'function') {
                ext.openPreferences();
            } else {
                // 🟢 FIX: Dynamiczny, bezbłędny fallback UUID wyciągnięty ze ścieżki instalacji
                const match = import.meta.url.match(/extensions\/([^/]+)/);
                const extUuid = (ext && ext.uuid) ? ext.uuid : (match ? match[1] : 'gnome-panel@user.local');
                Gio.Subprocess.new(['gnome-extensions', 'prefs', extUuid], Gio.SubprocessFlags.NONE);
            }
        } catch(e) {}
    });
    btn._menu.addMenuItem(prefsItem);

    btn.connect('clicked', () => {
        if (btn._menu.isOpen) btn._menu.close();
        if (Main.overview.visible) {
            Main.overview.hide();
        } else {
            Main.overview.showApps();
        }
    });

    btn.connect('button-press-event', (_actor, event) => {
        if (event.get_button() === 3) { // Prawy Przycisk Myszy
            openMenuAboveBar(btn._menu, btn, 4, null, true);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    btn._cleanup = () => {
        if (btn._menu) {
            btn._menu.destroy();
            btn._menu = null;
        }
    };

    return btn;
}
