// Prosty Panel — apps-list.js (Z obsługą przeciągania z Overview / App Grid i bezpiecznikiem tworzenia okien)

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

    // 🟢 NATYWNA STREFA ZRZUTU DLA IKON Z OVERVIEW 🟢
    // Podpinamy logikę Drop Zone pod cały pasek (host)
    host._delegate = {
        handleDragOver(source, actor, x, y, time) {
            // Sprawdzamy, czy przeciągany obiekt to ikona aplikacji GNOME
            if (source && source.app && typeof source.app.get_id === 'function') {
                // COPY_DROP daje wizualny znak "+" przy kursorze
                return DND.DragMotionResult.COPY_DROP;
            }
            return DND.DragMotionResult.NO_DROP;
        },
        acceptDrop(source, actor, x, y, time) {
            // Bezpiecznik: weryfikujemy czy to na pewno aplikacja
            if (!source || !source.app || typeof source.app.get_id !== 'function') {
                return false;
            }
            
            const id = source.app.get_id();
            const favs = AppFavorites.getAppFavorites();
            
            // Obliczamy, w którym miejscu upuszczono ikonę
            let dropIndex = favs.getFavorites().length;
            const [hostX] = host.get_transformed_position();
            const globalX = hostX + x; // Absolutna pozycja kursora X na ekranie

            const children = appBox.get_children();
            for (let i = 0; i < children.length; i++) {
                const child = children[i];
                const [childX] = child.get_transformed_position();
                
                // Jeśli kursor jest przed połową danej ikony, wstaw apkę tutaj
                if (globalX < childX + (child.width / 2)) {
                    dropIndex = i;
                    break;
                }
            }
            
            // Ogranicznik: nie pozwalamy przypiąć nowej apki dalej niż na końcu strefy przypiętych
            dropIndex = Math.min(dropIndex, favs.getFavorites().length);
            
            // Jeśli aplikacja nie jest przypięta - przypnij ją!
            if (!favs.isFavorite(id)) {
                favs.addFavorite(id, dropIndex);
            } else if (typeof favs.moveFavoriteToPos === 'function') {
                // Jeśli już jest przypięta, ale przeciągnąłeś ją z Overview, przenieś ją
                favs.moveFavoriteToPos(id, dropIndex);
            }
            return true;
        }
    };

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
        host._runOrder = host._runOrder.filter(id => runningIds.has(id) && !favIds.has(id));

        const runById = new Map(running.map(a => [a.get_id(), a]));
        const orderedRun = host._runOrder.map(id => runById.get(id)).filter(a => a);

        for (const a of running) {
            if (!favIds.has(a.get_id()) && !host._runOrder.includes(a.get_id())) {
                orderedRun.push(a);
            }
        }

        const toKeep = new Set();
        const addBtn = (app) => {
            const id = app.get_id();
            toKeep.add(id);
            if (!host._buttons.has(id)) {
                const btn = new AppButton(app);
                host._buttons.set(id, btn);
            }
            appBox.add_child(host._buttons.get(id));
        };

        appBox.remove_all_children();
        for (const app of favs) addBtn(app);
        for (const app of orderedRun) addBtn(app);

        for (const [id, btn] of host._buttons.entries()) {
            if (!toKeep.has(id)) {
                btn.destroy();
                host._buttons.delete(id);
            }
        }
        updateStates();
    };

    const updateStates = () => {
        const tracker = Shell.WindowTracker.get_default();
        const focusApp = tracker.focus_app;
        for (const [id, btn] of host._buttons.entries()) {
            const app = btn.app;
            const running = app.get_state() === Shell.AppState.RUNNING;
            const active  = (focusApp && focusApp.get_id() === id);
            btn.updateState(running, active);
        }
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
        
        // Zabezpieczone przed zniszczeniem paska
        host._signalIds.push([display, display.connect('window-created',    () => {
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { 
                if (host._panelDestroyed) return GLib.SOURCE_REMOVE; 
                rebuildApps(); 
                return GLib.SOURCE_REMOVE; 
            });
        })]);
        
        host._signalIds.push([wm, wm.connect('minimize',  () => updateStates())]);
        host._signalIds.push([wm, wm.connect('unminimize',() => updateStates())]);

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

    return { actor: appBox, rebuildApps, connectSignals };
}
