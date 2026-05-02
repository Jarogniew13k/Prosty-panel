// Prosty Panel — clock.js (GNOME 45+ Ready, connectObject, Naprawiony Hover)

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
        track_hover : true, // 🟢 FIX: Ożywia podświetlenie na hover
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

    const updateClock = () => {
        if (host._panelDestroyed) return;
        const now = GLib.DateTime.new_now_local();
        timeLabel.set_text(now.format('%H:%M'));
        dateLabel.set_text(now.format('%d/%m/%Y'));
    };

    const startClock = () => {
        if (!wallClock) {
            wallClock = new GnomeDesktop.WallClock();
            wallClock.connectObject('notify::clock', updateClock, clock);
        }
        updateClock();
    };

    const stopClock = () => {
        if (wallClock) {
            wallClock.disconnectObject(clock);
            wallClock = null;
        }
        const tray = Main.messageTray;
        if (tray) {
            tray.disconnectObject(clock);
            tray.getSources().forEach(src => {
                try { src.disconnectObject(clock); } catch(e) {}
            });
        }
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
            src.connectObject('notify::count', updateDot, clock);
            updateDot();
        };

        tray.connectObject(
            'source-added', onSourceAdded,
            'source-removed', (t, src) => { src.disconnectObject(clock); updateDot(); },
            'queue-changed', updateDot,
            clock
        );

        tray.getSources().forEach(src => onSourceAdded(null, src));
        updateDot();
    };

    return { actor: clock, startClock, stopClock, bindNotifications };
}