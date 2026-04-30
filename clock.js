// Prosty Panel — clock.js
// Niezawodny wskaźnik powiadomień oparty bezpośrednio na głównym MessageTray

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { openMenuAboveBar } from './utils.js';

export function buildClock(host) {
    const clock = new St.Button({
        style_class : 'tb-clock-btn',
        reactive    : true,
        can_focus   : true,
        x_expand    : false,
        y_expand    : false,
        y_align     : Clutter.ActorAlign.CENTER,
    });
    
    const clockOverlay = new St.Widget({
        layout_manager : new Clutter.BinLayout(),
        y_align        : Clutter.ActorAlign.CENTER,
    });
    
    const clockBox  = new St.BoxLayout({ vertical: true, style_class: 'tb-clock' });
    const dateLabel = new St.Label({ style_class: 'tb-clock-date' });

    // Wrapper dla timeLabel — kropka obok godziny w poziomie (● 12:35)
    const timeWrapper = new St.BoxLayout({
        vertical : false,
        y_align  : Clutter.ActorAlign.CENTER,
        x_align  : Clutter.ActorAlign.CENTER,
    });
    const timeLabel = new St.Label({
        style_class : 'tb-clock-time',
        y_align     : Clutter.ActorAlign.CENTER,
    });

    // Kropka powiadomień — po lewej stronie godziny
    // opacity zamiast visible — kropka zawsze zajmuje miejsce, zegar się nie przesuwa
    const notifDot = new St.Widget({
        style_class : 'tb-notif-dot',
        width       : 8,
        height      : 8,
        opacity     : 0,
        y_align     : Clutter.ActorAlign.CENTER,
        x_align     : Clutter.ActorAlign.CENTER,
        style       : 'margin-right: 4px;',
    });

    timeWrapper.add_child(notifDot);
    timeWrapper.add_child(timeLabel);

    clockBox.add_child(timeWrapper);
    clockBox.add_child(dateLabel);
    clockOverlay.add_child(clockBox);
    clock.set_child(clockOverlay);

    clock.connect('clicked', () => {
        if (!host._ready) return;
        openMenuAboveBar(Main.panel.statusArea.dateMenu?.menu, clock, 2);
        notifDot.opacity = 0;
    });

    let timer = 0;
    let syncTimer = 0;

    const updateClock = () => {
        const now = GLib.DateTime.new_now_local();
        timeLabel.text = now.format('%H:%M');
        dateLabel.text = now.format('%d/%m/%Y');
    };

    const startClock = () => {
        updateClock();
        const now = GLib.DateTime.new_now_local();
        const seconds = now.get_seconds();
        const msToNextMinute = (60 - seconds) * 1000 + 10;

        syncTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, msToNextMinute, () => {
            syncTimer = 0;
            updateClock();
            timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
                updateClock();
                return GLib.SOURCE_CONTINUE;
            });
            return GLib.SOURCE_REMOVE;
        });
    };

    const stopClock = () => {
        if (syncTimer) { GLib.source_remove(syncTimer); syncTimer = 0; }
        if (timer) { GLib.source_remove(timer); timer = 0; }
    };

    const bindNotifications = () => {
        const tray = Main.messageTray;
        if (!tray) return;

        const updateDot = () => {
            if (host._panelDestroyed) return;
            let count = 0;
            const sources = tray.getSources();
            for (const src of sources) {
                count += (src.count || 0);
            }
            notifDot.opacity = (count > 0) ? 255 : 0;
        };

        const onSourceAdded = (t, src) => {
            const id = src.connect('notify::count', updateDot);
            host._signalIds.push([src, id]);
            updateDot();
        };

        host._signalIds.push([tray, tray.connect('source-added', onSourceAdded)]);
        host._signalIds.push([tray, tray.connect('source-removed', updateDot)]);
        host._signalIds.push([tray, tray.connect('queue-changed', updateDot)]);

        for (const src of tray.getSources()) {
            onSourceAdded(null, src);
        }
        
        updateDot();
    };

    return { actor: clock, startClock, stopClock, bindNotifications };
}