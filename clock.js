// Prosty Panel — clock.js (Wykorzystanie GnomeDesktop.WallClock)

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
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
    
    const clockOverlay = new St.Widget({ layout_manager : new Clutter.BinLayout(), y_align : Clutter.ActorAlign.CENTER });
    const clockBox  = new St.BoxLayout({ vertical: true, style_class: 'tb-clock' });
    const dateLabel = new St.Label({ style_class: 'tb-clock-date' });

    const timeWrapper = new St.BoxLayout({ vertical : false, y_align : Clutter.ActorAlign.CENTER, x_align : Clutter.ActorAlign.CENTER });
    const timeLabel = new St.Label({ style_class : 'tb-clock-time', y_align : Clutter.ActorAlign.CENTER });

    const notifDot = new St.Widget({
        style_class : 'tb-notif-dot', width : 8, height : 8, opacity : 0,
        y_align : Clutter.ActorAlign.CENTER, x_align : Clutter.ActorAlign.CENTER, style : 'margin-right: 4px;',
    });

    timeWrapper.add_child(notifDot); timeWrapper.add_child(timeLabel);
    clockBox.add_child(timeWrapper); clockBox.add_child(dateLabel);
    clockOverlay.add_child(clockBox); clock.set_child(clockOverlay);

    clock.connect('clicked', () => {
        if (!host._ready) return;
        openMenuAboveBar(Main.panel.statusArea.dateMenu?.menu, clock, 2);
        notifDot.opacity = 0;
    });

    let wallClock = null;
    let clockSignalId = 0;
    let sourceSignals = new Map(); 

    const updateClock = () => {
        if (host._panelDestroyed) return;
        const now = GLib.DateTime.new_now_local();
        timeLabel.set_text(now.format('%H:%M'));
        dateLabel.set_text(now.format('%d/%m/%Y'));
    };

    const startClock = () => {
        if (!wallClock) {
            wallClock = new GnomeDesktop.WallClock();
            clockSignalId = wallClock.connect('notify::clock', updateClock);
            host._signalIds.push([wallClock, clockSignalId]);
        }
        updateClock();
    };

    const stopClock = () => {
        if (wallClock && clockSignalId) {
            try { wallClock.disconnect(clockSignalId); } catch(e) {}
            clockSignalId = 0;
        }
        wallClock = null;
        for (const [src, id] of sourceSignals.entries()) {
            try { src.disconnect(id); } catch(e) {}
        }
        sourceSignals.clear();
    };

    const bindNotifications = () => {
        const tray = Main.messageTray;
        if (!tray) return;

        const updateDot = () => {
            if (host._panelDestroyed) return;
            let count = 0;
            tray.getSources().forEach(src => { count += (src.count || 0); });
            notifDot.opacity = (count > 0) ? 255 : 0;
        };

        const onSourceAdded = (t, src) => {
            if (sourceSignals.has(src)) return;
            const id = src.connect('notify::count', updateDot);
            sourceSignals.set(src, id);
            updateDot();
        };

        const onSourceRemoved = (t, src) => {
            if (sourceSignals.has(src)) {
                try { src.disconnect(sourceSignals.get(src)); } catch(e) {}
                sourceSignals.delete(src);
            }
            updateDot();
        };

        host._signalIds.push([tray, tray.connect('source-added', onSourceAdded)]);
        host._signalIds.push([tray, tray.connect('source-removed', onSourceRemoved)]);
        host._signalIds.push([tray, tray.connect('queue-changed', updateDot)]);

        tray.getSources().forEach(src => onSourceAdded(null, src));
        updateDot();
    };

    return { actor: clock, startClock, stopClock, bindNotifications };
}
