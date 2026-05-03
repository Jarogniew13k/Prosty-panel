// Prosty Panel — extra-status.js (GNOME 49 Ready, connectObject, Naprawiony Hover)

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import { openMenuAboveBar } from './utils.js';

export function buildExtraStatus(host) {
    const box = new St.BoxLayout({
        style_class: 'tb-extra-status',
        y_align: Clutter.ActorAlign.CENTER,
        style: 'spacing: 4px;'
    });

    // 1. NAGRYWANIE EKRANU
    const recBtn = new St.Button({
        style_class: 'tb-rec-pill',
        reactive: true,
        can_focus: true,
        track_hover: true,
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const recBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, style: 'spacing: 6px;' });
    const recIcon = new St.Icon({ icon_name: 'media-record-symbolic', icon_size: 14, style_class: 'tb-rec-icon' });
    const recLabel = new St.Label({ style_class: 'tb-rec-label', y_align: Clutter.ActorAlign.CENTER, text: '0:00' });
    recBox.add_child(recIcon); recBox.add_child(recLabel); recBtn.set_child(recBox);

    recBtn.connect('clicked', () => {
        const sr = Main.panel.statusArea.screenRecording;
        if (sr) {
            if (Main.screenshotUI && typeof Main.screenshotUI.stopScreencast === 'function') Main.screenshotUI.stopScreencast();
            else if (typeof sr._stopRecording === 'function') sr._stopRecording();
            else if (global.screencast && typeof global.screencast.stop === 'function') global.screencast.stop();
        }
    });

    // 2. UDOSTĘPNIANIE EKRANU
    const shareBtn = new St.Button({
        style_class: 'tb-rec-pill tb-share-btn',
        reactive: true,
        can_focus: true,
        track_hover: true,
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
        style: 'background-color: #e66100;' 
    });
    const shareBox = new St.BoxLayout({ y_align: Clutter.ActorAlign.CENTER, style: 'spacing: 6px;' });
    const shareIcon = new St.Icon({ icon_name: 'camera-web-symbolic', icon_size: 14, style: 'color: #ffffff;' });
    const shareLabel = new St.Label({ style_class: 'tb-rec-label', y_align: Clutter.ActorAlign.CENTER, text: 'Udostępnianie' });
    shareBox.add_child(shareIcon); shareBox.add_child(shareLabel); shareBtn.set_child(shareBox);

    shareBtn.connect('clicked', () => {
        const indicator = Main.panel.statusArea.screenSharing;
        if (indicator && indicator.menu) openMenuAboveBar(indicator.menu, shareBtn, 4, null, true);
    });

    // 3. APLIKACJE W TLE
    const bgAppsBtn = new St.Button({
        style_class: 'tb-btn',
        reactive: true,
        can_focus: true,
        track_hover: true,
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const bgAppsIcon = new St.Icon({ icon_name: 'system-run-symbolic', icon_size: 16, style_class: 'tb-btn-icon' });
    bgAppsBtn.set_child(bgAppsIcon);

    bgAppsBtn.connect('clicked', () => {
        const indicator = Main.panel.statusArea.backgroundApps;
        if (indicator && indicator.menu) openMenuAboveBar(indicator.menu, bgAppsBtn, 4, null, true);
    });

    // 4. KLAWIATURA
    const kbdBtn = new St.Button({
        style_class: 'tb-btn tb-kbd-btn',
        reactive: true,
        can_focus: true,
        track_hover: true,
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const kbdLabel = new St.Label({ style_class: 'tb-kbd-label', y_align: Clutter.ActorAlign.CENTER, text: '' });
    kbdBtn.set_child(kbdLabel);
    
    kbdBtn.connect('clicked', () => {
        const kbd = Main.panel.statusArea.keyboard;
        if (kbd && kbd.menu) openMenuAboveBar(kbd.menu, kbdBtn, 4, null, true);
    });

    // 5. POZOSTAŁE GENERYCZNE WSKAŹNIKI
    const proxies = [
        { id: 'camera', fallback: 'camera-web-symbolic', color: '#ff7800' },
        { id: 'microphone', fallback: 'audio-input-microphone-symbolic', color: '#ff7800' },
        { id: 'location', fallback: 'location-services-active-symbolic', color: '#3584e4' },
        { id: 'a11y', fallback: 'preferences-desktop-accessibility-symbolic', color: null },
        { id: 'dwellClick', fallback: 'pointer-drag-symbolic', color: null }
    ].map(config => {
        const btn = new St.Button({ style_class: 'tb-btn', reactive: true, can_focus: true, track_hover: true, visible: false, y_align: Clutter.ActorAlign.CENTER });
        const icon = new St.Icon({ icon_name: config.fallback, icon_size: 16, style_class: 'tb-btn-icon' });
        
        if (config.color) icon.style = `color: ${config.color};`;
        btn.set_child(icon);

        btn.connect('clicked', () => {
            const indicator = Main.panel.statusArea[config.id];
            if (indicator && indicator.menu) openMenuAboveBar(indicator.menu, btn, 4, null, true);
        });

        const sync = () => {
            if (host._panelDestroyed) return;
            const indicator = Main.panel.statusArea[config.id];
            if (!indicator) { btn.visible = false; return; }
            btn.visible = indicator.visible;
            
            if (indicator.visible) {
                let foundIcon = null;
                const walk = (actor) => {
                    if (foundIcon) return;
                    if (actor instanceof St.Icon) { foundIcon = actor; return; }
                    if (typeof actor.get_children === 'function') for (const c of actor.get_children()) walk(c);
                };
                walk(indicator);
                if (foundIcon) {
                    try {
                        if (foundIcon.gicon) icon.set_gicon(foundIcon.gicon);
                        else if (foundIcon.icon_name) icon.set_icon_name(foundIcon.icon_name);
                    } catch(e) {}
                }
            }
        };

        return { btn, sync, id: config.id };
    });

    box.add_child(recBtn);
    box.add_child(shareBtn);
    box.add_child(bgAppsBtn);
    proxies.forEach(p => box.add_child(p.btn));
    box.add_child(kbdBtn);

    let recTimerId = 0;

    // --- KLAWIATURA: stałe referencje poza syncKbd ---
    // _ism ustawiamy raz przy pierwszym udanym wywołaniu; connectObject jest idempotentne
    // dla pary (sygnał, obiekt), ale stabilna referencja do kbdUpdateLabel eliminuje
    // tworzenie nowego domknięcia przy każdym notify::visible.
    let _ism = null;
    const kbdUpdateLabel = () => {
        if (host._panelDestroyed) return;
        if (_ism && _ism.currentSource && _ism.currentSource.shortName)
            kbdLabel.set_text(_ism.currentSource.shortName);
    };

    const syncRec = () => {
        if (host._panelDestroyed) return;
        const sr = Main.panel.statusArea.screenRecording;
        if (!sr || !sr.visible) {
            recBtn.visible = false;
            if (recTimerId) { GLib.source_remove(recTimerId); recTimerId = 0; }
            return;
        }
        recBtn.visible = true;
        const updateTime = () => {
            let foundLabel = null;
            const walk = (actor) => {
                if (foundLabel) return;
                if (actor instanceof St.Label && actor.get_text() && actor.get_text().includes(':')) { foundLabel = actor; return; }
                if (typeof actor.get_children === 'function') for (const c of actor.get_children()) walk(c);
            };
            walk(sr);
            if (foundLabel) recLabel.set_text(foundLabel.get_text());
        };
        updateTime();
        if (!recTimerId) {
            recTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                if (host._panelDestroyed || !sr.visible) { recTimerId = 0; return GLib.SOURCE_REMOVE; }
                updateTime(); return GLib.SOURCE_CONTINUE;
            });
        }
    };

    const syncShare = () => {
        if (host._panelDestroyed) return;
        const ind = Main.panel.statusArea.screenSharing;
        shareBtn.visible = ind ? ind.visible : false;
    };

    const syncBgApps = () => {
        if (host._panelDestroyed) return;
        const ind = Main.panel.statusArea.backgroundApps;
        bgAppsBtn.visible = ind ? ind.visible : false;
    };

    const syncKbd = () => {
        if (host._panelDestroyed) return;
        const kbd = Main.panel.statusArea.keyboard;
        if (!kbd) { kbdBtn.visible = false; return; }
        kbdBtn.visible = kbd.visible;

        // Jeśli ISM już zainicjalizowany — tylko zaktualizuj etykietę, nie łącz ponownie
        if (_ism !== null) {
            kbdUpdateLabel();
            return;
        }

        try {
            const ism = Keyboard.getInputSourceManager();
            if (ism) {
                _ism = ism;
                // Łączymy raz ze stabilną referencją — connectObject jest idempotentne,
                // ale dzięki hoistingowi nie tworzymy nowego domknięcia przy każdym wywołaniu.
                ism.connectObject('current-source-changed', kbdUpdateLabel, box);
                kbdUpdateLabel();
            }
        } catch (e) {
            if (box._kbdFallbackId) {
                GLib.source_remove(box._kbdFallbackId);
                box._kbdFallbackId = 0;
            }
            box._kbdFallbackId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                if (host._panelDestroyed || box.is_destroyed?.()) {
                    box._kbdFallbackId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                if (kbd.visible) {
                    let text = '';
                    if (kbd._indicator && typeof kbd._indicator.get_text === 'function') text = kbd._indicator.get_text();
                    else if (kbd._label && typeof kbd._label.get_text === 'function') text = kbd._label.get_text();
                    if (text) kbdLabel.set_text(text);
                }
                return GLib.SOURCE_CONTINUE;
            });
        }
    };

    GLib.idle_add(GLib.PRIORITY_LOW, () => {
        if (host._panelDestroyed) return GLib.SOURCE_REMOVE;
        
        const sr = Main.panel.statusArea.screenRecording;
        if (sr) sr.connectObject('notify::visible', syncRec, box);

        const shareInd = Main.panel.statusArea.screenSharing;
        if (shareInd) shareInd.connectObject('notify::visible', syncShare, box);

        const bgAppsInd = Main.panel.statusArea.backgroundApps;
        if (bgAppsInd) bgAppsInd.connectObject('notify::visible', syncBgApps, box);
        
        const kbd = Main.panel.statusArea.keyboard;
        if (kbd) kbd.connectObject('notify::visible', syncKbd, box);
        
        proxies.forEach(p => {
            const ind = Main.panel.statusArea[p.id];
            if (ind) ind.connectObject('notify::visible', p.sync, box);
            p.sync();
        });
        
        syncRec(); syncShare(); syncBgApps(); syncKbd(); 
        return GLib.SOURCE_REMOVE;
    });

    host._extraStatusCleanup = () => { 
        if (recTimerId) { GLib.source_remove(recTimerId); recTimerId = 0; }
        if (box._kbdFallbackId) { GLib.source_remove(box._kbdFallbackId); box._kbdFallbackId = 0; }
    };

    return box;
}
