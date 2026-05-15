// Prosty Panel — system-group.js (Wydajne nasłuchiwanie + wsparcie ukrytego panelu)

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { openMenuAboveBar } from './utils.js';

export function buildSystemGroup(host) {
    const sysGroup = new St.Button({ style_class : 'tb-sys-group', reactive : true, can_focus : true, track_hover : true, y_align : Clutter.ActorAlign.CENTER });
    const sysBox = new St.BoxLayout({ style_class : 'tb-sys-group-box', y_align : Clutter.ActorAlign.CENTER });

    const mkSysCell = (iconName) => {
        const icon = new St.Icon({ icon_name: iconName, icon_size: 16, style_class: 'tb-sys-cell-icon', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        const bin = new St.Bin({ child: icon, style_class: 'tb-sys-cell', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
        return { bin, icon };
    };

    const volCell  = mkSysCell('audio-volume-high-symbolic');
    const wifiCell = mkSysCell('network-wireless-signal-good-symbolic');
    const vpnCell  = mkSysCell('network-vpn-symbolic');
    const btCell   = mkSysCell('bluetooth-active-symbolic');
    const batCell  = mkSysCell('battery-level-100-symbolic');
    const pwrCell  = mkSysCell('system-shutdown-symbolic');

    vpnCell.bin.visible = false;
    btCell.bin.visible = false;

    sysBox.add_child(volCell.bin); 
    sysBox.add_child(wifiCell.bin); 
    sysBox.add_child(vpnCell.bin); 
    sysBox.add_child(btCell.bin); 
    sysBox.add_child(batCell.bin); 
    sysBox.add_child(pwrCell.bin);
    sysGroup.set_child(sysBox);

    sysGroup.connect('clicked', () => { if (host._ready) openMenuAboveBar(Main.panel.statusArea.quickSettings?.menu, sysGroup, 8); });

    let volSrcIcon = null;
    sysGroup.connect('scroll-event', (_a, ev) => {
        if (volSrcIcon) { volSrcIcon.emit('scroll-event', ev); return Clutter.EVENT_STOP; }
        return Clutter.EVENT_PROPAGATE;
    });

    const bindSystemIndicators = () => {
        const qs = Main.panel.statusArea.quickSettings;
        if (!qs || typeof qs._indicators === 'undefined') {
            console.warn('[Prosty Panel] API GNOME uległo zmianie (brak quickSettings._indicators)!');
            return;
        }

        const bindAnchor = new Clutter.Actor(); 

        const findIndicatorIcons = () => {
            const result = { vol: [], net: [], vpn: [], bt: [], bat: [] };
            const walk = (actor) => {
                if (actor instanceof St.Icon) {
                    let n = actor.icon_name || '';
                    if (!n && actor.gicon && typeof actor.gicon.get_names === 'function') {
                        const names = actor.gicon.get_names();
                        if (names && names.length > 0) n = names[0];
                    }
                    if (n.startsWith('audio-volume') || n.startsWith('audio-output') || n === 'audio-headphones-symbolic') {
                        result.vol.push(actor);
                    } else if (n.includes('vpn')) {
                        result.vpn.push(actor);
                    } else if (n.startsWith('bluetooth')) {
                        result.bt.push(actor);
                    } else if (n.startsWith('network-') || n.includes('airplane') || n.includes('wireless') || n.includes('wired')) {
                        result.net.push(actor);
                    } else if (n.startsWith('battery-') || n.includes('ac-adapter')) {
                        result.bat.push(actor);
                    }
                } else if (typeof actor.get_children === 'function') {
                    for (const c of actor.get_children()) walk(c);
                }
            };
            walk(qs._indicators);
            return result;
        };

        const isIconTrulyVisible = (ico) => {
            // 🟢 FIX ZGODNIE Z POLECENIEM (WSPÓŁPRACA Z .hide()): 
            // Usunęliśmy ico.get_width() > 0.
            // Dzięki temu ikony odczytują się poprawnie nawet wtedy, 
            // gdy główny panel GNOME dostał komendę .hide() i ma zerową szerokość w silniku.
            return ico && ico.visible && ico.opacity > 0 && (typeof ico.is_destroyed !== 'function' || !ico.is_destroyed());
        };

        const resolveIconName = (srcIcon) => {
            let n = srcIcon.icon_name || '';
            if (!n && srcIcon.gicon && typeof srcIcon.gicon.get_names === 'function') {
                const names = srcIcon.gicon.get_names();
                if (names && names.length > 0) n = names[0];
            }
            return n;
        };

        const sync = (srcIcon, ourIcon, fallback, binActor = null, iconFilter = null) => {
            const update = () => {
                try {
                    if (iconFilter && binActor) {
                        const currentName = resolveIconName(srcIcon);
                        const isVisible   = isIconTrulyVisible(srcIcon);
                        if (!iconFilter(currentName) || !isVisible) {
                            ourIcon.set_icon_name('ac-adapter-symbolic');
                            binActor.visible = true;
                            return;
                        }
                    }
                    if (srcIcon.gicon) ourIcon.set_gicon(srcIcon.gicon);
                    else if (srcIcon.icon_name) ourIcon.set_icon_name(srcIcon.icon_name);
                    else ourIcon.set_icon_name(fallback);
                    
                    if (binActor) binActor.visible = isIconTrulyVisible(srcIcon);
                } catch (e) { ourIcon.set_icon_name(fallback); }
            };

            update();
            srcIcon.connectObject(
                'notify::icon-name', update,
                'notify::gicon', update,
                'notify::visible', update,
                'notify::opacity', update,
                bindAnchor
            );
        };

        const scanAndBind = () => {
            if (host._panelDestroyed) return;
            
            try { bindAnchor.disconnect_all(); } catch(e) {}
            
            const found = findIndicatorIcons();
            
            if (found.vol[0]) { sync(found.vol[0], volCell.icon, 'audio-volume-muted-symbolic'); volSrcIcon = found.vol[0]; }
            
            if (found.net.length > 0) {
                const updateNetworkIcon = () => {
                    let activeIcon = null;
                    for (const netIcon of found.net) {
                        let n = resolveIconName(netIcon);
                        if (n.includes('airplane') && isIconTrulyVisible(netIcon)) {
                            activeIcon = netIcon; break;
                        }
                    }
                    if (!activeIcon) {
                        for (const netIcon of found.net) {
                            if (isIconTrulyVisible(netIcon)) { activeIcon = netIcon; break; }
                        }
                    }
                    if (activeIcon) {
                        try {
                            if (activeIcon.gicon) wifiCell.icon.set_gicon(activeIcon.gicon);
                            else if (activeIcon.icon_name) wifiCell.icon.set_icon_name(activeIcon.icon_name);
                        } catch(e){}
                    }
                };

                updateNetworkIcon();
                found.net.forEach(icon => {
                    icon.connectObject('notify::visible', updateNetworkIcon, 'notify::gicon', updateNetworkIcon,
                        'notify::icon-name', updateNetworkIcon, 'notify::opacity', updateNetworkIcon, bindAnchor);
                });
            }
            
            if (found.vpn[0]) sync(found.vpn[0], vpnCell.icon, 'network-vpn-symbolic', vpnCell.bin);
            else vpnCell.bin.visible = false;
            
            if (found.bt[0]) sync(found.bt[0], btCell.icon, 'bluetooth-active-symbolic', btCell.bin);
            else btCell.bin.visible = false;

            if (found.bat[0]) sync(found.bat[0], batCell.icon, 'battery-missing-symbolic', batCell.bin, (name) => name.startsWith('battery-'));
            else batCell.bin.visible = false;
        };

        scanAndBind(); 
        
        let debounceId = 0;
        const queueRescan = () => {
            if (debounceId) return;
            debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                debounceId = 0;
                scanAndBind();
                return GLib.SOURCE_REMOVE;
            });
        };

        // Nasłuchiwanie na dodawanie/usuwanie sprzętu przez GNOME (Działa dla Bluetooth i VPN)
        qs._indicators.connectObject(
            'child-added', queueRescan,
            'child-removed', queueRescan,
            sysGroup
        );
        
        sysGroup.connect('destroy', () => {
            if (debounceId) { GLib.source_remove(debounceId); debounceId = 0; }
            try { bindAnchor.disconnect_all(); } catch(e) {}
            bindAnchor.destroy();
        });
    };

    return { actor : sysGroup, bindSystemIndicators };
}
