// Prosty Panel — apps-list.js (Z obsługą zmiany kolejności uruchomionych)

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell   from 'gi://Shell';
import GLib    from 'gi://GLib';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import { AppButton } from './appbutton.js';

export function buildAppsList(host) {
    const appBox = new St.BoxLayout({
        style_class : 'tb-apps',
        y_align     : Clutter.ActorAlign.CENTER,
        y_expand    : false,
    });

    const rebuildApps = () => {
        const favs    = AppFavorites.getAppFavorites().getFavorites();
        const running = Shell.AppSystem.get_default().get_running();
        const favIds  = new Set(favs.map(a => a.get_id()));

        if (!host._runOrder) host._runOrder = [];

        const runningIds = new Set(running.map(a => a.get_id()));
        for (const a of running) {
            const id = a.get_id();
            if (!favIds.has(id) && !host._runOrder.includes(id))
                host._runOrder.push(id);
        }
        host._runOrder = host._runOrder.filter(id =>
            runningIds.has(id) && !favIds.has(id));

        const runById   = new Map(running.map(a => [a.get_id(), a]));
        const runOrdered = host._runOrder
            .map(id => runById.get(id))
            .filter(a => a);

        const all    = [...favs, ...runOrdered];
        const allIds = new Set(all.map(a => a.get_id()));

        for (const [id, btn] of host._buttons)
            if (!allIds.has(id)) { btn.destroy(); host._buttons.delete(id); }

        all.forEach((app, i) => {
            const id = app.get_id();
            if (!host._buttons.has(id)) {
                const btn = new AppButton(app);
                host._buttons.set(id, btn);
                appBox.insert_child_at_index(btn, i);
            } else {
                appBox.set_child_at_index(host._buttons.get(id), i);
            }
        });
        updateStates();
    };

    const updateStates = () => {
        const running   = new Set(Shell.AppSystem.get_default().get_running().map(a => a.get_id()));
        const focusedId = Shell.WindowTracker.get_default().focus_app?.get_id() ?? null;
        for (const [id, btn] of host._buttons)
            btn.updateState(running.has(id), id === focusedId);
    };

    const connectSignals = () => {
        const sys     = Shell.AppSystem.get_default();
        const tracker = Shell.WindowTracker.get_default();
        const favs    = AppFavorites.getAppFavorites();
        const wm      = global.window_manager;
        const display = global.display;

        host._signalIds.push([sys,     sys.connect('app-state-changed',     () => rebuildApps())]);
        host._signalIds.push([tracker, tracker.connect('notify::focus-app', () => updateStates())]);
        host._signalIds.push([favs,    favs.connect('changed',              () => rebuildApps())]);
        host._signalIds.push([display, display.connect('window-created',    () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { rebuildApps(); return GLib.SOURCE_REMOVE; });
        })]);
        host._signalIds.push([wm, wm.connect('minimize',  () => updateStates())]);
        host._signalIds.push([wm, wm.connect('unminimize',() => updateStates())]);

        // LOGIKA ZMIANY KOLEJNOŚCI NIEPRZYPIĘTYCH
        host._signalIds.push([host, host.connect('reorder-running', (_h, data) => {
            const { appId, pos } = data;
            if (!host._runOrder) return;
            const idx = host._runOrder.indexOf(appId);
            if (idx !== -1) {
                host._runOrder.splice(idx, 1);
                host._runOrder.splice(pos, 0, appId);
                rebuildApps();
            }
        })]);
    };

    return { actor: appBox, rebuildApps, updateStates, connectSignals };
}