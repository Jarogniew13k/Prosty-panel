// Prosty Panel — tray-popup.js (Poprawka dla opóźnień z DBus Menu)

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { TrayBackend } from './appindicator-backend.js';
import { makeIconBtn, openMenuAboveBar } from './utils.js';
import { PANEL_HEIGHT, ICON_SIZE } from './constants.js';

function getThemeClass(host) {
    if (host && host._settings) {
        try {
            const keys = host._settings.list_keys();
            if (keys.includes('theme')) {
                const theme = host._settings.get_string('theme');
                if (theme) return `theme-${theme}`;
            }
        } catch (e) { }
    }
    if (host && host.get_style_class_name) {
        const classes = host.get_style_class_name().split(' ');
        const themeClass = classes.find(c => c.startsWith('theme-'));
        if (themeClass) return themeClass;
    }
    return 'theme-gnome-dark';
}

export function buildTrayArrow(host) {
    const arrowBtn = makeIconBtn('pan-up-symbolic', 'tb-btn tb-arrow');
    arrowBtn.visible = false;

    host._trayBackend = new TrayBackend();

    const popup = new St.Bin({
        style_class: 'tb-tray-popup',
        reactive: true, opacity: 0, visible: false
    });

    const box = new St.BoxLayout({
        style_class: 'tb-tray-popup-box',
        reactive: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    popup.set_child(box);

    host._trayPopup = popup;
    host._trayPopupIsOpen = false;

    arrowBtn.connect('clicked', () => {
        if (host._trayPopupIsOpen) {
            closeTrayPopup(host);
        } else {
            const themeClass = getThemeClass(host);
            const classes = popup.get_style_class_name().split(' ');
            classes.filter(c => c.startsWith('theme-')).forEach(c => popup.remove_style_class_name(c));
            popup.add_style_class_name(themeClass);

            if (!popup.get_parent()) Main.uiGroup.add_child(popup);
            popup.visible = true;

            const [ax, ay] = arrowBtn.get_transformed_position();
            const [minW, pw] = popup.get_preferred_width(-1);
            const [minH, ph] = popup.get_preferred_height(-1);

            const mon = Main.layoutManager.primaryMonitor;
            let x = ax + (arrowBtn.width / 2) - (pw / 2);
            if (x < mon.x + 4) x = mon.x + 4;
            if (x > mon.x + mon.width - pw - 4) x = mon.x + mon.width - pw - 4;

            let barTop = (host && host.has_style_class_name('mode-floating'))
                ? mon.y + mon.height - PANEL_HEIGHT - 8
                : mon.y + mon.height - PANEL_HEIGHT;

            popup.set_position(Math.floor(x), Math.floor(barTop - ph - 4));
            popup.ease({ opacity: 255, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            host._trayPopupIsOpen = true;

            if (host._intellihide) host._intellihide.block();

            if (!host._trayPopupStageId) {
                host._trayPopupStageId = global.stage.connect('button-press-event', (_a, ev) => {
                    const [sx, sy] = ev.get_coords();
                    const [px, py] = popup.get_transformed_position();
                    const insidePopup = (sx >= px && sx <= px + popup.width && sy >= py && sy <= py + popup.height);
                    const [bx, by] = arrowBtn.get_transformed_position();
                    const onArrow = (sx >= bx && sx <= bx + arrowBtn.width && sy >= by && sy <= by + arrowBtn.height);

                    if (!insidePopup && !onArrow && (!host._activeAppMenu || !host._activeAppMenu.isOpen)) {
                        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                            if (host._trayPopupIsOpen) closeTrayPopup(host);
                            return GLib.SOURCE_REMOVE;
                        });
                    }
                    return Clutter.EVENT_PROPAGATE;
                });
            }
        }
    });

    host._trayBackend.connect('item-added', (b, service, item) => {
        const existing = box.get_children().find(c => c._service === service);
        if (existing) existing.destroy();

        const cellBtn = new St.Button({
            style_class: 'tb-tray-cell',
            reactive: true, can_focus: true, track_hover: true,
            x_expand: false, y_expand: false, width: 32, height: 32
        });

        const iconWrapper = new St.Bin({
            width: 16,
            height: 16,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER
        });

        let icon;

        if (item.pixbuf) {
            icon = new St.Icon({
                gicon: item.pixbuf,
                icon_size: ICON_SIZE,
                style_class: 'tb-tray-cell-icon'
            });
        } else if (item.absoluteIconPath) {
            try {
                const gfile = Gio.File.new_for_path(item.absoluteIconPath);
                const gicon = new Gio.FileIcon({ file: gfile });
                icon = new St.Icon({ gicon, icon_size: ICON_SIZE, style_class: 'tb-tray-cell-icon' });
            } catch (e) {
                icon = null;
            }
        } else if (item.fallbackGIcon) {
            try {
                icon = new St.Icon({ gicon: item.fallbackGIcon, icon_size: ICON_SIZE, style_class: 'tb-tray-cell-icon' });
            } catch (e) { icon = null; }
        }

        if (!icon) {
            const names = (item.iconNames && item.iconNames.length > 0) ? item.iconNames : ['image-missing'];
            const themed = Gio.ThemedIcon.new_from_names(names);
            icon = new St.Icon({ gicon: themed, icon_size: ICON_SIZE, style_class: 'tb-tray-cell-icon' });
        }

        iconWrapper.set_child(icon);
        cellBtn.set_child(iconWrapper);
        cellBtn._service = service;

        cellBtn.connect('button-press-event', (actor, event) => {
            const btn = event.get_button();
            const [mouseX, mouseY] = event.get_coords();

            if (btn === 1) {
                if (item.itemIsMenu) {
                    if (item.menuProxy) _buildAndOpenDBusMenu(item, cellBtn, host, popup);
                    else item.contextMenu(Math.floor(mouseX), Math.floor(mouseY));
                } else {
                    item.activate(Math.floor(mouseX), Math.floor(mouseY));
                }
                closeTrayPopup(host);
                return Clutter.EVENT_STOP;
            } else if (btn === 3) {
                if (item.menuProxy) {
                    _buildAndOpenDBusMenu(item, cellBtn, host, popup);
                } else {
                    item.contextMenu(Math.floor(mouseX), Math.floor(mouseY));
                    closeTrayPopup(host);
                }
                return Clutter.EVENT_STOP;
            } else if (btn === 2) {
                if (item.secondaryActivate) item.secondaryActivate(Math.floor(mouseX), Math.floor(mouseY));
                closeTrayPopup(host);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        cellBtn.connect('scroll-event', (actor, event) => {
            if (item.scroll) {
                const direction = event.get_scroll_direction();
                if (direction === Clutter.ScrollDirection.UP) {
                    item.scroll(-1, 'vertical');
                } else if (direction === Clutter.ScrollDirection.DOWN) {
                    item.scroll(1, 'vertical');
                }
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        box.add_child(cellBtn);
        arrowBtn.visible = true;
    });

    host._trayBackend.connect('item-removed', (b, service) => {
        box.get_children().forEach(c => { if (c._service === service) c.destroy(); });
        if (box.get_n_children() === 0) { arrowBtn.visible = false; closeTrayPopup(host); }
    });

    return arrowBtn;
}

async function _buildAndOpenDBusMenu(item, sourceActor, host, popup) {
    // Zabezpieczenie przed race condition: async funkcja mogłaby być wywołana dwukrotnie
    // przy szybkim podwójnym kliknięciu zanim pierwsze wywołanie dobiegnie końca.
    if (host._dbusMenuPending) return;
    host._dbusMenuPending = true;

    try {
        if (host._activeAppMenu) {
            host._activeAppMenu.close();
            host._activeAppMenu.destroy();
            host._activeAppMenu = null;
        }

        const res = await new Promise((resolve, reject) => {
            item.menuProxy.call(
                'GetLayout', new GLib.Variant('(iias)', [0, -1, []]),
                Gio.DBusCallFlags.NONE, 
                500, // 🟢 FIX: Skrócenie czasu oczekiwania do zaledwie 500 ms (ułamek sekundy zamiast 25 sekund)!
                null,
                (p, r) => {
                    try { resolve(p.call_finish(r)); } catch(e) { reject(e); }
                }
            );
        });

        if (host._panelDestroyed || !popup || !popup.get_parent()) return;

        const unpacked = res.deep_unpack();
        const rootChildren = unpacked[1][2];

        if (!rootChildren || rootChildren.length === 0) {
            closeTrayPopup(host);
            const [mouseX, mouseY] = sourceActor.get_transformed_position();
            item.contextMenu(Math.floor(mouseX), Math.floor(mouseY));
            return;
        }

        const menu = new PopupMenu.PopupMenu(sourceActor, 0.5, St.Side.BOTTOM);
        Main.uiGroup.add_child(menu.actor);
        host._activeAppMenu = menu;

        if (!host._trayMenuManager) host._trayMenuManager = new PopupMenu.PopupMenuManager(host);
        host._trayMenuManager.addMenu(menu);

        const buildMenuLevel = (childrenArray, parentMenu) => {
            for (const childVar of childrenArray) {
                let child = childVar;
                try {
                    while (child instanceof GLib.Variant) {
                        child = (typeof child.deep_unpack === 'function') ? child.deep_unpack() : child.unpack();
                    }
                } catch(e) {}

                const id = child[0], props = child[1], subChildren = child[2];

                const getProp = (key, defaultVal) => {
                    let v = props[key];
                    if (v === undefined) return defaultVal;
                    try {
                        while (v instanceof GLib.Variant) {
                            v = (typeof v.deep_unpack === 'function') ? v.deep_unpack() : v.unpack();
                        }
                        return v;
                    } catch(e) { return defaultVal; }
                };

                if (!getProp('visible', true)) continue;
                if (getProp('type', 'standard') === 'separator') {
                    parentMenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
                    continue;
                }

                let label = String(getProp('label', 'Opcja')).replace(/_/g, '');
                const toggleType = getProp('toggle-type', ''), toggleState = getProp('toggle-state', 0);
                if ((toggleType === 'checkmark' || toggleType === 'radio') && toggleState === 1) label = '✓ ' + label;

                if (subChildren && subChildren.length > 0) {
                    const subMenuItem = new PopupMenu.PopupSubMenuMenuItem(label);
                    buildMenuLevel(subChildren, subMenuItem.menu);
                    parentMenu.addMenuItem(subMenuItem);
                } else {
                    const menuItem = new PopupMenu.PopupMenuItem(label);
                    if (!getProp('enabled', true)) menuItem.setSensitive(false);
                    menuItem.connect('activate', () => {
                        item.menuProxy.call(
                            'Event', new GLib.Variant('(isvu)', [id, 'clicked', new GLib.Variant('s', ''), 0]),
                            Gio.DBusCallFlags.NONE, -1, null,
                            (p, r) => {
                                try { p.call_finish(r); } catch(e) { console.warn('[ProstyPanel:Tray] Menu item event error:', e.message); }
                            }
                        );
                        closeTrayPopup(host);
                    });
                    parentMenu.addMenuItem(menuItem);
                }
            }
        };

        buildMenuLevel(rootChildren, menu);
        menu.connect('menu-closed', () => {
            menu.destroy();
            if (host._activeAppMenu === menu) host._activeAppMenu = null;
        });

        openMenuAboveBar(menu, sourceActor, 4, popup);
        menu.open(true);

    } catch (e) {
        // Zepsute Electronowe Menu błyskawicznie wejdzie tutaj i poprawnie włączy awaryjne ContextMenu
        closeTrayPopup(host);
        const [mouseX, mouseY] = sourceActor.get_transformed_position();
        item.contextMenu(Math.floor(mouseX), Math.floor(mouseY));
    } finally {
        host._dbusMenuPending = false;
    }
}

export function closeTrayPopup(host) {
    if (!host._trayPopup || !host._trayPopupIsOpen) return;
    host._trayPopupIsOpen = false;

    if (host._intellihide) host._intellihide.unblock();
    if (host._trayPopupStageId) { global.stage.disconnect(host._trayPopupStageId); host._trayPopupStageId = 0; }
    if (host._activeAppMenu) { host._activeAppMenu.close(); }

    host._trayPopup.ease({
        opacity: 0,
        duration: 150,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onStopped: () => { if (host._trayPopup) host._trayPopup.visible = false; } 
    });
}