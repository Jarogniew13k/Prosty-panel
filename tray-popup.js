// Prosty Panel — tray-popup.js (final)

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { PANEL_HEIGHT } from './constants.js';
import { makeIconBtn, openMenuAboveBar } from './utils.js';

function getThemeClass(host) {
    if (host && host._settings && typeof host._settings.get_string === 'function') {
        const theme = host._settings.get_string('theme');
        if (theme) return `theme-${theme}`;
    }
    if (host && host.get_style_class_name) {
        const classes = host.get_style_class_name().split(' ');
        const themeClass = classes.find(c => c.startsWith('theme-'));
        if (themeClass) return themeClass;
    }
    return 'theme-gradient-dark';
}

export function buildTrayArrow(host) {
    const arrowBtn = makeIconBtn('pan-up-symbolic', 'tb-btn tb-arrow');
    arrowBtn.connect('clicked', () => {
        if (!host._ready) return;
        toggleTrayPopup(host, arrowBtn);
    });
    return arrowBtn;
}

function findTrayIndicators() {
    const out = [];
    const statusArea = Main.panel.statusArea;
    for (const key in statusArea) {
        if (!key.startsWith('appindicator-')) continue;
        const btn = statusArea[key];
        if (!btn) continue;
        let icon = null;
        const walk = (a) => {
            if (icon) return;
            if (a instanceof St.Icon) { icon = a; return; }
            if (typeof a.get_children === 'function') {
                for (const c of a.get_children()) walk(c);
            }
        };
        walk(btn);
        if (icon) out.push({ button: btn, icon });
    }
    return out;
}

function toggleTrayPopup(host, sourceButton) {
    if (host._trayPopup) {
        closeTrayPopup(host);
        return;
    }

    if (host._trayPopupStageId) {
        global.stage.disconnect(host._trayPopupStageId);
        host._trayPopupStageId = 0;
    }

    const items = findTrayIndicators();

    const popup = new St.Bin({
        style_class: 'tb-tray-popup',
        reactive: true,
    });

    const themeClass = getThemeClass(host);
    popup.add_style_class_name(themeClass);
    console.log('[Tray] Theme class added:', themeClass);

    const box = new St.BoxLayout({
        style_class: 'tb-tray-popup-box',
        y_align: Clutter.ActorAlign.CENTER,
    });

    const reparentedIcons = [];

    if (items.length === 0) {
        const lbl = new St.Label({
            text: 'Brak ukrytych ikon',
            style_class: 'tb-tray-empty',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(lbl);
    } else {
        for (const { button, icon } of items) {
            const cellBtn = new St.Button({
                style_class: 'tb-tray-cell',
                reactive: true,
                can_focus: true,
                track_hover: true,
                y_align: Clutter.ActorAlign.CENTER,
            });

            const originalParent = icon.get_parent();
            if (originalParent) {
                originalParent.remove_child(icon);
            }
            cellBtn.set_child(icon);
            reparentedIcons.push({ icon, originalParent });

            cellBtn.connect('button-press-event', (_a, ev) => {
                if (button.menu) {
                    if (button.menu.isOpen) {
                        button.menu.close();
                    } else {
                        if (host._trayAppMenu && host._trayAppMenu !== button.menu &&
                            host._trayAppMenu.isOpen) {
                            host._trayAppMenu.close();
                        }
                        openMenuAboveBar(button.menu, sourceButton, 4, popup);
                        host._trayAppMenu = button.menu;
                    }
                }
                return Clutter.EVENT_STOP;
            });

            box.add_child(cellBtn);
        }
    }
    popup.set_child(box);
    popup._reparentedIcons = reparentedIcons;
    popup._tbForceClosing = false;

    Main.uiGroup.add_child(popup);
    popup.opacity = 0;

    const mon = Main.layoutManager.primaryMonitor;

    let barTop;
    let panel = _getBarFor(sourceButton);
    if (panel && panel.has_style_class_name('mode-floating')) {
        const margin = 8;
        barTop = mon.y + mon.height - PANEL_HEIGHT - margin;
    } else {
        barTop = mon.y + mon.height - PANEL_HEIGHT;
    }

    if (!host._trayPopupPositionId) host._trayPopupPositionId = 0;

    host._trayPopupPositionId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (!host._trayPopup) {
            host._trayPopupPositionId = 0;
            return GLib.SOURCE_REMOVE;
        }
        const w = popup.width;
        const h = popup.height;
        const [bx] = sourceButton.get_transformed_position();
        const bw = sourceButton.get_width();
        let x = bx + (bw / 2) - (w / 2);
        const minX = mon.x + 4;
        const maxX = mon.x + mon.width - w - 4;
        if (x < minX) x = minX;
        if (x > maxX) x = maxX;
        const y = barTop - h - 4;
        popup.set_position(Math.floor(x), Math.floor(y));
        popup.ease({
            opacity: 255,
            duration: 150,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        host._trayPopupPositionId = 0;
        return GLib.SOURCE_REMOVE;
    });

    const stageId = global.stage.connect('button-press-event', (_a, ev) => {
        const [sx, sy] = ev.get_coords();
        const [px, py] = popup.get_transformed_position();
        const pw = popup.width, ph = popup.height;
        const insidePopup = (sx >= px && sx <= px + pw && sy >= py && sy <= py + ph);
        const [ax, ay] = sourceButton.get_transformed_position();
        const aw = sourceButton.get_width(), ah = sourceButton.get_height();
        const onArrow = (sx >= ax && sx <= ax + aw && sy >= ay && sy <= ay + ah);
        if (!insidePopup && !onArrow) {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (host._trayPopup) closeTrayPopup(host);
                return GLib.SOURCE_REMOVE;
            });
        }
    });

    host._trayPopupStageId = stageId;
    host._trayPopup = popup;
    if (host._openMenus) host._openMenus.add(popup);

    try { host.emit('menu-opened'); } catch (e) { console.debug('[Prosty Panel] Error:', e); }
}

export function closeTrayPopup(host) {
    const popup = host._trayPopup;
    if (!popup) return;
    host._trayPopup = null;

    if (host._trayPopupStageId) {
        global.stage.disconnect(host._trayPopupStageId);
        host._trayPopupStageId = 0;
    }

    try { host.emit('menu-closed'); } catch (e) { console.debug('[Prosty Panel] Error:', e); }

    if (host._trayPopupPositionId) {
        GLib.source_remove(host._trayPopupPositionId);
        host._trayPopupPositionId = 0;
    }

    popup._tbForceClosing = true;

    if (host._trayAppMenu && host._trayAppMenu.isOpen) {
        host._trayAppMenu.close();
    }
    host._trayAppMenu = null;

    const reparented = popup._reparentedIcons || [];
    for (const { icon, originalParent } of reparented) {
        try {
            const currentParent = icon.get_parent();
            if (currentParent) currentParent.remove_child(icon);
            if (originalParent) originalParent.add_child(icon);
        } catch (e) { console.debug('[Prosty Panel] Error reparenting icon:', e); }
    }
    popup._reparentedIcons = null;

    if (host._openMenus) host._openMenus.delete(popup);

    popup.ease({
        opacity: 0,
        duration: 150,
        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        onStopped: () => {
            if (popup.get_parent()) Main.uiGroup.remove_child(popup);
            popup.destroy();
        },
    });
}

function _getBarFor(sourceActor) {
    let p = sourceActor;
    while (p) {
        if (p.has_style_class_name && p.has_style_class_name('bottom-taskbar')) return p;
        p = p.get_parent ? p.get_parent() : null;
    }
    return null;
}
