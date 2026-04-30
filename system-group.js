// Prosty Panel — system-group.js
// Scalony przycisk volume + wifi + battery + power.

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { openMenuAboveBar } from './utils.js';

export function buildSystemGroup(host) {
    const sysGroup = new St.Button({
        style_class : 'tb-sys-group',
        reactive    : true,
        can_focus   : true,
        track_hover : true,
        y_align     : Clutter.ActorAlign.CENTER,
    });
    const sysBox = new St.BoxLayout({
        style_class : 'tb-sys-group-box',
        y_align     : Clutter.ActorAlign.CENTER,
    });

    const mkSysCell = (iconName) => {
        const icon = new St.Icon({
            icon_name   : iconName,
            icon_size   : 16,
            style_class : 'tb-sys-cell-icon',
            x_align     : Clutter.ActorAlign.CENTER,
            y_align     : Clutter.ActorAlign.CENTER,
        });
        const bin = new St.Bin({
            child       : icon,
            style_class : 'tb-sys-cell',
            x_align     : Clutter.ActorAlign.CENTER,
            y_align     : Clutter.ActorAlign.CENTER,
        });
        return { bin, icon };
    };

    const volCell  = mkSysCell('audio-volume-high-symbolic');
    const wifiCell = mkSysCell('network-wireless-signal-good-symbolic');
    const batCell  = mkSysCell('battery-level-100-symbolic');
    const pwrCell  = mkSysCell('system-shutdown-symbolic');

    const volIcon  = volCell.icon;
    const wifiIcon = wifiCell.icon;
    const batIcon  = batCell.icon;
    const batBin   = batCell.bin;

    sysBox.add_child(volCell.bin);
    sysBox.add_child(wifiCell.bin);
    sysBox.add_child(batCell.bin);
    sysBox.add_child(pwrCell.bin);
    sysGroup.set_child(sysBox);

    sysGroup.connect('clicked', () => {
        if (!host._ready) return;
        openMenuAboveBar(Main.panel.statusArea.quickSettings?.menu, sysGroup, 8);
    });

    let volSrcIcon = null;
    sysGroup.reactive = true;
    sysGroup.connect('scroll-event', (_a, ev) => {
        if (volSrcIcon) {
            volSrcIcon.emit('scroll-event', ev);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    const bindSystemIndicators = () => {
        const qs = Main.panel.statusArea.quickSettings;
        if (!qs) return;

        const findIndicatorIcons = () => {
            const result = { vol: [], net: [], bat: [] };
            if (!qs._indicators) return result;

            const walk = (actor) => {
                if (actor instanceof St.Icon) {
                    let n = actor.icon_name || '';
                    if (!n && actor.gicon && typeof actor.gicon.get_names === 'function') {
                        const names = actor.gicon.get_names();
                        if (names && names.length > 0) n = names[0];
                    }

                    if (n.startsWith('audio-volume') ||
                        n.startsWith('audio-output') ||
                        n === 'audio-headphones-symbolic')
                        result.vol.push(actor);
                    else if (n.startsWith('network-') &&
                             !n.startsWith('network-vpn'))
                        result.net.push(actor);
                    else if (n.startsWith('battery-'))
                        result.bat.push(actor);
                } else if (typeof actor.get_children === 'function') {
                    for (const c of actor.get_children()) walk(c);
                }
            };
            walk(qs._indicators);
            return result;
        };

        const sync = (srcIcon, ourIcon, fallback) => {
            const update = () => {
                try {
                    // BEZPIECZNE nadpisywanie właściwości grafik
                    if (srcIcon.gicon) {
                        ourIcon.set_gicon(srcIcon.gicon);
                    } else if (srcIcon.icon_name) {
                        ourIcon.set_icon_name(srcIcon.icon_name);
                    } else {
                        ourIcon.set_icon_name(fallback);
                    }
                } catch (e) {
                    ourIcon.set_icon_name(fallback);
                }
            };
            
            update();
            
            const idName = srcIcon.connect('notify::icon-name', update);
            host._signalIds.push([srcIcon, idName]);
            
            const idGicon = srcIcon.connect('notify::gicon', update);
            host._signalIds.push([srcIcon, idGicon]);
            
            const visId = srcIcon.connect('notify::visible', update);
            host._signalIds.push([srcIcon, visId]);
        };

        const idleId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            if (!host.get_stage() || host._panelDestroyed) {
                host._sysBindIdleId = 0;
                return GLib.SOURCE_REMOVE;
            }

            const found = findIndicatorIcons();
            if (found.vol[0]) {
                sync(found.vol[0], volIcon, 'audio-volume-muted-symbolic');
                volSrcIcon = found.vol[0];
            }
            if (found.net[0]) {
                sync(found.net[0], wifiIcon, 'network-offline-symbolic');
            }

            if (found.bat[0]) {
                sync(found.bat[0], batIcon, 'battery-missing-symbolic');
                const updateVis = () => {
                    batBin.visible = found.bat[0].visible;
                };
                updateVis();
                const visId = found.bat[0].connect('notify::visible', updateVis);
                host._signalIds.push([found.bat[0], visId]);
            } else {
                batBin.visible = false;
            }

            host._sysBindIdleId = 0;
            return GLib.SOURCE_REMOVE;
        });
        host._sysBindIdleId = idleId;
    };

    return {
        actor                : sysGroup,
        bindSystemIndicators,
    };
}