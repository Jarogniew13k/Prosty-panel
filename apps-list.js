// Prosty Panel — apps-list.js (GNOME 45+ Ready, connectObject, Naprawiony błąd "Detached actors")

import St      from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell   from 'gi://Shell';
import GLib    from 'gi://GLib';

import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as DND          from 'resource:///org/gnome/shell/ui/dnd.js';
import { AppButton }     from './appbutton.js';

export function buildAppsList(host) {
    const appBox = new St.BoxLayout({
        style_class : 'tb-apps',
        y_align     : Clutter.ActorAlign.CENTER,
        y_expand    : false,
    });

    host._delegate = {
        handleDragOver(source, actor, x, y, time) {
            if (source && source.app && typeof source.app.get_id === 'function') {
                return DND.DragMotionResult.COPY_DROP;
            }
            return DND.DragMotionResult.NO_DROP;
        },
        acceptDrop(source, actor, x, y, time) {
            if (!source || !source.app || typeof source.app.get_id !== 'function') return false;
            
            const id = source.app.get_id();
            const favs = AppFavorites.getAppFavorites();
            
            let dropIndex = favs.getFavorites().length;
            const [hostX] = host.get_transformed_position();
            const globalX = hostX + x; 

            try {
                const children = appBox.get_children();
                for (let i = 0; i < children.length; i++) {
                    const child = children[i];
                    const [childX] = child.get_transformed_position();
                    if (globalX < childX + (child.width / 2)) { dropIndex = i; break; }
                }
            } catch (e) {}
            
            dropIndex = Math.min(dropIndex, favs.getFavorites().length);
            
            if (!favs.isFavorite(id)) favs.addFavorite(id, dropIndex);
            else if (typeof favs.moveFavoriteToPos === 'function') favs.moveFavoriteToPos(id, dropIndex);
            
            return true;
        }
    };

    const rebuildApps = () => {
        if (host._panelDestroyed) return;

        const favs    = AppFavorites.getAppFavorites().getFavorites();
        const running = Shell.AppSystem.get_default().get_running();
        const favIds  = new Set(favs.map(a => a.get_id()));

        if (!host._runOrder) host._runOrder = [];

        const runningIds = new Set(running.map(a => a.get_id()));
        for (const a of running) {
            const id = a.get_id();
            if (!favIds.has(id) && !host._runOrder.includes(id)) host._runOrder.push(id);
        }
        host._runOrder = host._runOrder.filter(id => runningIds.has(id) && !favIds.has(id));

        const runById = new Map(running.map(a => [a.get_id(), a]));
        const orderedRun = host._runOrder.map(id => runById.get(id)).filter(a => a);

        for (const a of running) {
            if (!favIds.has(a.get_id()) && !host._runOrder.includes(a.get_id())) orderedRun.push(a);
        }

        const toKeep = new Set();
        for (const app of favs) toKeep.add(app.get_id());
        for (const app of orderedRun) toKeep.add(app.get_id());

        // 1. Bezpiecznie niszczymy tylko NIEPOTRZEBNE przyciski aplikacji
        for (const [id, btn] of host._buttons.entries()) {
            if (!toKeep.has(id)) {
                if (typeof btn._cleanup === 'function') btn._cleanup();
                try { btn.remove_all_transitions(); } catch(e) {}
                try { btn.destroy(); } catch(e) {}
                host._buttons.delete(id);
            }
        }

        // 2. Dodajemy lub PRZESUWAMY pozostałe przyciski (zapobiega to usuwaniu ich ze sceny)
        let childIndex = 0;
        const addOrSortBtn = (app) => {
            const id = app.get_id();
            let btn = host._buttons.get(id);
            
            if (!btn) {
                btn = new AppButton(app);
                host._buttons.set(id, btn);
                try { appBox.insert_child_at_index(btn, childIndex); } catch(e) {}
            } else {
                try {
                    if (btn.get_parent() === appBox) {
                        appBox.set_child_at_index(btn, childIndex);
                    } else {
                        appBox.insert_child_at_index(btn, childIndex);
                    }
                } catch(e) {}
            }
            childIndex++;
        };

        for (const app of favs) addOrSortBtn(app);
        for (const app of orderedRun) addOrSortBtn(app);

        updateStates();
    };

    const updateStates = () => {
        if (host._panelDestroyed) return;
        const tracker = Shell.WindowTracker.get_default();
        const focusApp = tracker.focus_app;
        for (const [id, btn] of host._buttons.entries()) {
            if (btn._isDestroyed) continue;
            try {
                const app = btn.app;
                const running = app.get_state() === Shell.AppState.RUNNING;
                const active  = (focusApp && focusApp.get_id() === id);
                btn.updateState(running, active);
            } catch(e) {}
        }
    };

    // Debounce dla rebuildApps: wiele szybkich sygnałów (app-state-changed, changed,
    // window-created) składa się w jedno wywołanie po 100 ms. rebuildApps() pozostaje
    // dostępne do bezpośredniego wywołania tam, gdzie wymagana jest natychmiastowa
    // przebudowa (reorder-running, startup).
    let _rebuildDebounceId = 0;
    const queueRebuildApps = () => {
        if (_rebuildDebounceId) return;
        _rebuildDebounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            _rebuildDebounceId = 0;
            rebuildApps();
            return GLib.SOURCE_REMOVE;
        });
    };

    const connectSignals = () => {
        const sys     = Shell.AppSystem.get_default();
        const tracker = Shell.WindowTracker.get_default();
        const favs    = AppFavorites.getAppFavorites();
        const wm      = global.window_manager;
        const display = global.display;

        sys.connectObject('app-state-changed', () => queueRebuildApps(), appBox);
        tracker.connectObject('notify::focus-app', () => updateStates(), appBox);
        favs.connectObject('changed', () => queueRebuildApps(), appBox);
        
        display.connectObject('window-created', () => {
            // idle_add gwarantuje że okno jest zmapowane przed przebudową;
            // queueRebuildApps scala kolejne idle'e w jedno wywołanie.
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                if (host._panelDestroyed) return GLib.SOURCE_REMOVE;
                queueRebuildApps();
                return GLib.SOURCE_REMOVE;
            });
        }, appBox);
        
        wm.connectObject('minimize',  () => updateStates(), appBox);
        wm.connectObject('unminimize',() => updateStates(), appBox);

        host.connectObject('reorder-running', (_h, data) => {
            const { appId, pos } = data;
            if (!host._runOrder) return;
            const idx = host._runOrder.indexOf(appId);
            if (idx !== -1) {
                host._runOrder.splice(idx, 1);
                host._runOrder.splice(pos, 0, appId);
                rebuildApps(); // natychmiastowa przebudowa — jawna akcja użytkownika
            }
        }, appBox);
    };

    appBox._cleanup = () => {
        if (_rebuildDebounceId) { GLib.source_remove(_rebuildDebounceId); _rebuildDebounceId = 0; }
        for (const [id, btn] of host._buttons.entries()) {
            if (typeof btn._cleanup === 'function') btn._cleanup();
        }
        host._buttons.clear();
    };

    return { actor: appBox, rebuildApps, connectSignals };
}