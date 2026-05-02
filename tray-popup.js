// Prosty Panel — tray-popup.js (Ostateczny Skaner sygnałowy bez błędów "already disposed")

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

        try {
            if (!btn.visible || btn.opacity === 0 || btn.get_width() === 0 || btn.get_parent() === null) continue;
        } catch(e) { continue; } // Omijamy bezpiecznie uśmiercone w tle obiekty
        
        let icon = null;
        const walk = (a) => {
            if (icon) return;
            try {
                if (!a || !a.visible || a.opacity === 0 || a.get_width() === 0) return; 
                
                if (a instanceof St.Icon) { 
                    // 🟢 FIX: Odrzucamy systemową ikonę awaryjną (Ghosta), która pojawia się przy restartach Discorda!
                    if (a.icon_name === 'image-loading-symbolic' && !a.gicon) {
                        return; 
                    }
                    if (a.gicon || a.icon_name) {
                         icon = a; 
                    }
                    return; 
                }
                if (typeof a.get_children === 'function') {
                    for (const c of a.get_children()) walk(c);
                }
            } catch(e) {}
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

    const box = new St.BoxLayout({
        style_class: 'tb-tray-popup-box',
        y_align: Clutter.ActorAlign.CENTER,
    });

    const renderedItems = [];

    if (items.length === 0) {
        const lbl = new St.Label({
            text: 'Brak ukrytych ikon',
            style_class: 'tb-tray-empty',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(lbl);
    } else {
        for (const { button, icon } of items) {
            
            let itemState = { dead: false, cellBtn: null };

            // 🟢 ZABEZPIECZENIE: Podpinamy natywne sygnały niszczenia, które automatycznie ustawiają flagę "dead"
            // bez wywoływania niebezpiecznych funkcji .is_destroyed() na umierających obiektach C++.
            try {
                button.connectObject('destroy', () => { itemState.dead = true; }, popup);
                icon.connectObject('destroy', () => { itemState.dead = true; }, popup);
            } catch(e) { continue; } // Jeśli padło w ułamku sekundy, pomijamy element

            const cellBtn = new St.Button({
                style_class: 'tb-tray-cell',
                reactive: true,
                can_focus: true,
                track_hover: true,
                x_expand: false,
                y_expand: false,
                width: 32,
                height: 32,
            });

            itemState.cellBtn = cellBtn;
            let displayIcon;

            try {
                if (icon.gicon || icon.icon_name) {
                    displayIcon = new St.Icon({
                        icon_size: 16,
                        gicon: icon.gicon,
                        icon_name: icon.icon_name,
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                    });

                    icon.connectObject(
                        'notify::gicon', () => { 
                            try { if (!displayIcon.is_destroyed?.()) displayIcon.gicon = icon.gicon; } catch(e){}
                        },
                        'notify::icon-name', () => { 
                            try { 
                                // Jeśli ikona zamienia się w systemowego "ducha", uśmiercamy ją na miejscu
                                if (icon.icon_name === 'image-loading-symbolic' && !icon.gicon) {
                                    itemState.dead = true;
                                } else if (!displayIcon.is_destroyed?.()) {
                                    displayIcon.icon_name = icon.icon_name; 
                                }
                            } catch(e){}
                        },
                        popup
                    );
                } else {
                    displayIcon = new Clutter.Clone({
                        source: icon,
                        width: 16,
                        height: 16,
                        x_align: Clutter.ActorAlign.CENTER,
                        y_align: Clutter.ActorAlign.CENTER,
                    });
                }
            } catch(e) { continue; } 

            const iconWrapper = new St.Bin({
                child: displayIcon,
                width: 16,
                height: 16,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
            });

            cellBtn.set_child(iconWrapper);

            cellBtn.connect('button-press-event', (_a, ev) => {
                try {
                    if (button.menu) {
                        if (button.menu.isOpen) {
                            button.menu.close();
                        } else {
                            if (host._trayAppMenu && host._trayAppMenu !== button.menu && host._trayAppMenu.isOpen) {
                                host._trayAppMenu.close();
                            }
                            openMenuAboveBar(button.menu, sourceButton, 4, popup);
                            host._trayAppMenu = button.menu;
                        }
                    } else {
                        button.emit('button-press-event', ev);
                    }
                } catch(e){}
                return Clutter.EVENT_STOP;
            });

            box.add_child(cellBtn);
            renderedItems.push({ state: itemState, button, icon });
        }
    }
    
    if (box.get_n_children() === 0 && items.length > 0) {
        const lbl = new St.Label({
            text: 'Brak ukrytych ikon',
            style_class: 'tb-tray-empty',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(lbl);
    }

    popup.set_child(box);
    popup._tbForceClosing = false;

    Main.uiGroup.add_child(popup);
    popup.opacity = 0;

    const mon = Main.layoutManager.primaryMonitor;
    let barTop;
    let panel = _getBarFor(sourceButton);
    if (panel && panel.has_style_class_name('mode-floating')) {
        barTop = mon.y + mon.height - PANEL_HEIGHT - 8;
    } else {
        barTop = mon.y + mon.height - PANEL_HEIGHT;
    }

    host._trayPopupPositionId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        if (!host._trayPopup) return GLib.SOURCE_REMOVE;
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

    if (host._trayRefreshId) {
        GLib.source_remove(host._trayRefreshId);
        host._trayRefreshId = 0;
    }

    host._trayRefreshId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
        if (!host._trayPopup || host._panelDestroyed) {
            host._trayRefreshId = 0;
            return GLib.SOURCE_REMOVE;
        }

        let anyRemoved = false;
        
        for (let i = renderedItems.length - 1; i >= 0; i--) {
            const item = renderedItems[i];
            
            // Reagujemy na natywny sygnał "destroy" otrzymany od systemu, bez wywoływania is_destroyed()
            if (item.state.dead) {
                if (item.state.cellBtn) {
                    try { item.state.cellBtn.destroy(); } catch(e) {}
                    item.state.cellBtn = null;
                }
                renderedItems.splice(i, 1);
                anyRemoved = true;
                continue;
            }

            // Miękkie skanowanie w poszukiwaniu ukrycia elementu (zabezpieczone try-catch)
            try {
                if (!item.button.visible || item.button.opacity === 0 || item.button.get_parent() === null || item.button.get_stage() === null ||
                    !item.icon.visible || item.icon.opacity === 0 || item.icon.get_width() === 0) {
                    
                    item.state.dead = true;
                    if (item.state.cellBtn) {
                        try { item.state.cellBtn.destroy(); } catch(e) {}
                        item.state.cellBtn = null;
                    }
                    renderedItems.splice(i, 1);
                    anyRemoved = true;
                }
            } catch(e) {
                // Skrypt trafi tutaj, jeśli obiekt w GJS zaczął się rozpadać (zabezpieczenie przed "already disposed")
                item.state.dead = true;
                if (item.state.cellBtn) {
                    try { item.state.cellBtn.destroy(); } catch(err) {}
                    item.state.cellBtn = null;
                }
                renderedItems.splice(i, 1);
                anyRemoved = true;
            }
        }

        if (anyRemoved) {
            let validChildren = 0;
            try {
                validChildren = box.get_children().filter(c => {
                    try { return c instanceof St.Button; } 
                    catch(e) { return false; }
                }).length;
            } catch(e) {}

            if (validChildren === 0) {
                closeTrayPopup(host);
                host._trayRefreshId = 0;
                return GLib.SOURCE_REMOVE;
            }
        }

        return GLib.SOURCE_CONTINUE;
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

    try { host.emit('menu-opened'); } catch (e) {}
}

export function closeTrayPopup(host) {
    const popup = host._trayPopup;
    if (!popup) return;
    host._trayPopup = null;

    if (host._trayRefreshId) {
        GLib.source_remove(host._trayRefreshId);
        host._trayRefreshId = 0;
    }

    if (host._trayPopupStageId) {
        global.stage.disconnect(host._trayPopupStageId);
        host._trayPopupStageId = 0;
    }

    try { host.emit('menu-closed'); } catch (e) {}

    if (host._trayPopupPositionId) {
        GLib.source_remove(host._trayPopupPositionId);
        host._trayPopupPositionId = 0;
    }

    popup._tbForceClosing = true;

    if (host._trayAppMenu && host._trayAppMenu.isOpen) {
        host._trayAppMenu.close();
    }
    host._trayAppMenu = null;

    if (host._openMenus) host._openMenus.delete(popup);

    if (host._panelDestroyed || !popup.get_stage()) {
        try {
            popup.remove_all_transitions();
            if (popup.get_parent()) Main.uiGroup.remove_child(popup);
            popup.destroy();
        } catch(e){}
    } else {
        try {
            popup.ease({
                opacity: 0,
                duration: 150,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: () => {
                    try {
                        popup.remove_all_transitions();
                        if (popup.get_parent()) Main.uiGroup.remove_child(popup);
                        popup.destroy();
                    } catch(e){}
                },
            });
        } catch(e){}
    }
}

function _getBarFor(sourceActor) {
    let p = sourceActor;
    while (p) {
        try {
            if (p.has_style_class_name && p.has_style_class_name('bottom-taskbar')) return p;
            p = p.get_parent ? p.get_parent() : null;
        } catch(e) { return null; }
    }
    return null;
}