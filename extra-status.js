// Prosty Panel — extra-status.js

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Keyboard from 'resource:///org/gnome/shell/ui/status/keyboard.js';
import { openMenuAboveBar } from './utils.js';

export function buildExtraStatus(host) {
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

    const kbdBtn = new St.Button({
        style_class: 'tb-btn tb-kbd-btn',
        reactive: true,
        can_focus: true,
        visible: false,
        y_align: Clutter.ActorAlign.CENTER,
    });
    const kbdLabel = new St.Label({ style_class: 'tb-kbd-label', y_align: Clutter.ActorAlign.CENTER, text: '' });
    kbdBtn.set_child(kbdLabel);
    
    kbdBtn.connect('clicked', () => {
        const kbd = Main.panel.statusArea.keyboard;
        if (kbd && kbd.menu) openMenuAboveBar(kbd.menu, kbdBtn, 4, null, true);
    });

    box.add_child(recBtn);
    box.add_child(kbdBtn);

    let kbdSourceSignal = 0;
    let recTimerId = 0;
    let isKbdTimeout = false; // NOWE: Śledzimy, czy kbdSourceSignal to Timeout czy GSignal

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

    const syncKbd = () => {
        if (host._panelDestroyed) return;
        const kbd = Main.panel.statusArea.keyboard;
        if (!kbd) { kbdBtn.visible = false; return; }
        kbdBtn.visible = kbd.visible;

        if (!kbdSourceSignal) {
            try {
                const ism = Keyboard.getInputSourceManager();
                if (ism) {
                    const updateLabel = () => {
                        if (host._panelDestroyed) return;
                        if (ism.currentSource && ism.currentSource.shortName) kbdLabel.set_text(ism.currentSource.shortName);
                    };
                    kbdSourceSignal = ism.connect('current-source-changed', updateLabel);
                    isKbdTimeout = false;
                    host._signalIds.push([ism, kbdSourceSignal]);
                    updateLabel();
                }
            } catch (e) {
                // Fallback na odpytywanie co 500ms
                isKbdTimeout = true;
                kbdSourceSignal = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    if (host._panelDestroyed) { kbdSourceSignal = 0; return GLib.SOURCE_REMOVE; } // FIX: Wyzerowanie zmiennej
                    if (kbd.visible) {
                        let text = '';
                        if (kbd._indicator && typeof kbd._indicator.get_text === 'function') text = kbd._indicator.get_text();
                        else if (kbd._label && typeof kbd._label.get_text === 'function') text = kbd._label.get_text();
                        if (text) kbdLabel.set_text(text);
                    }
                    return GLib.SOURCE_CONTINUE;
                });
                host._signalIds.push([null, kbdSourceSignal]);
            }
        }
    };

    GLib.idle_add(GLib.PRIORITY_LOW, () => {
        if (host._panelDestroyed) return GLib.SOURCE_REMOVE;
        const sr = Main.panel.statusArea.screenRecording;
        if (sr) host._signalIds.push([sr, sr.connect('notify::visible', syncRec)]);
        const kbd = Main.panel.statusArea.keyboard;
        if (kbd) host._signalIds.push([kbd, kbd.connect('notify::visible', syncKbd)]);
        syncRec(); syncKbd(); return GLib.SOURCE_REMOVE;
    });

    // 🟢 FIX: Ostateczne czyszczenie przy niszczeniu panelu
    host._extraStatusCleanup = () => { 
        if (recTimerId) { 
            GLib.source_remove(recTimerId); 
            recTimerId = 0; 
        }
        if (kbdSourceSignal && isKbdTimeout) { 
            GLib.source_remove(kbdSourceSignal); 
            kbdSourceSignal = 0; 
        }
    };

    return box;
}