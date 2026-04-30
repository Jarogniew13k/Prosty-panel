// Prosty Panel — appbutton.js (Wersja z natychmiastowym odświeżaniem podglądu okien)

import GObject  from 'gi://GObject';
import St       from 'gi://St';
import Clutter  from 'gi://Clutter';
import GLib     from 'gi://GLib';

import * as Main         from 'resource:///org/gnome/shell/ui/main.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';
import * as PopupMenu    from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { ICON_SIZE, HOVER_DELAY_MS, HIDE_DELAY_MS, PREVIEW_W, PREVIEW_H } from './constants.js';
import { openMenuAboveBar } from './utils.js';

function killAllTransitions(actor) {
    if (!actor) return;
    try { actor.remove_all_transitions(); } catch (e) {}
    if (typeof actor.get_children === 'function') {
        actor.get_children().forEach(killAllTransitions);
    }
}

export const AppButton = GObject.registerClass(
class AppButton extends St.Button {
    _init(app) {
        super._init({
            style_class : 'tb-app-btn',
            reactive    : true,
            can_focus   : true,
            track_hover : true,
            x_expand    : false,
            y_expand    : false,
            y_align     : Clutter.ActorAlign.CENTER,
        });
        this._app          = app;
        this._hoverTimeout = null;
        this._hideTimerId  = null;
        this._previewHoverTimer = null;
        this._isFavorite   = false;
        this._isDestroyed  = false; 

        const box = new St.BoxLayout({
            vertical : true,
            x_align  : Clutter.ActorAlign.CENTER,
            y_align  : Clutter.ActorAlign.CENTER,
        });
        this.set_child(box);
        box.add_child(app.create_icon_texture(ICON_SIZE));
        this._dot = new St.Widget({ style_class : 'tb-dot', x_align : Clutter.ActorAlign.CENTER, width : 0 });
        box.add_child(this._dot);

        this._tooltip = new St.Label({ style_class: 'tb-tooltip', opacity: 0, text: app.get_name() });
        Main.layoutManager.addTopChrome(this._tooltip);

        this.connect('notify::hover', this._onHover.bind(this));
        this.connect('button-press-event', this._onButtonPress.bind(this));
        this.connect('destroy',       this._onDestroy.bind(this));
    }

    _getThemeClass() {
        if (this._isDestroyed) return null;
        let p = this.get_parent();
        while (p) {
            if (p.has_style_class_name && p.has_style_class_name('bottom-taskbar')) {
                const classes = p.get_style_class_name().split(' ');
                return classes.find(c => c.startsWith('theme-')) || null;
            }
            p = p.get_parent ? p.get_parent() : null;
        }
        return null;
    }

    _onButtonPress(_a, ev) {
        if (this._isDestroyed) return Clutter.EVENT_PROPAGATE;
        const btn = ev.get_button();
        
        if (btn === 1) {
            const [sx, sy] = ev.get_coords();
            this._press = { x: sx, y: sy, dragging: false, motionId: 0, releaseId: 0 };
            this._press.motionId = global.stage.connect('motion-event', (_a2, mev) => {
                if (!this._press || this._isDestroyed) return Clutter.EVENT_PROPAGATE;
                const [mx, my] = mev.get_coords();
                if (!this._press.dragging) {
                    const dx = mx - this._press.x, dy = my - this._press.y;
                    if (dx * dx + dy * dy > 25) this._dragStart(mx, my);
                }
                if (this._press.dragging) this._dragMotion(mx, my);
                return Clutter.EVENT_PROPAGATE;
            });
            this._press.releaseId = global.stage.connect('button-release-event', (_a2, rev) => {
                if (this._press) { global.stage.disconnect(this._press.motionId); global.stage.disconnect(this._press.releaseId); }
                if (!this._press || this._isDestroyed) return Clutter.EVENT_PROPAGATE;
                if (this._press.dragging) this._dragEnd(rev.get_coords()[0], rev.get_coords()[1]);
                else this._onClick();
                this._press = null; return Clutter.EVENT_STOP;
            });
            return Clutter.EVENT_STOP;
        }
        
        if (btn === 2) {
            const state = ev.get_state();
            const isShift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
            if (isShift) {
                const wins = this._app.get_windows();
                for (const w of wins) w.delete(global.get_current_time());
            } else {
                if (this._app.can_open_new_window?.()) this._app.open_new_window(-1);
                else this._app.activate();
            }
            return Clutter.EVENT_STOP;
        }

        if (btn === 3) { 
            this._showContextMenu(); 
            return Clutter.EVENT_STOP; 
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _dragStart(mx, my) {
        if (this._isDestroyed) return;
        this._isFavorite = AppFavorites.getAppFavorites().isFavorite(this._app.get_id());
        this._press.dragging = true;
        this.opacity = 80;
        this._dragActor = new Clutter.Clone({ source: this, width: this.width, height: this.height, opacity: 200 });
        Main.uiGroup.add_child(this._dragActor);
        this._dragActor.set_position(mx - (this.width / 2), my - (this.height / 2));
        
        if (!this._dropMarker) {
            this._dropMarker = new St.Widget({ 
                style_class: 'tb-drop-marker', 
                style: 'background-color: rgba(255, 255, 255, 0.86);' 
            });
            this._dropMarker.hide();
        }
        Main.uiGroup.add_child(this._dropMarker);
        this._emitBarSignal('drag-start');
    }

    _dragMotion(mx, my) {
        if (this._isDestroyed) return;
        if (this._dragActor) this._dragActor.set_position(mx - (this.width / 2), my - (this.height / 2));
        const bar = this.get_parent()?.get_parent();
        if (!bar) return;
        const [bx, by] = bar.get_transformed_position();
        if (my < by || my > by + bar.height) { this._dropMarker?.hide(); this._dropTarget = { unfavorite: true }; return; }
        const appBox = this.get_parent();
        const buttons = appBox.get_children().filter(c => c instanceof AppButton);
        const favs = AppFavorites.getAppFavorites().getFavorites();
        const favIds = new Set(favs.map(f => f.get_id()));
        const favBtns = buttons.filter(b => favIds.has(b.app.get_id()));
        const runBtns = buttons.filter(b => !favIds.has(b.app.get_id()));
        let targetBtns = this._isFavorite ? favBtns : runBtns;
        let baseIndex = this._isFavorite ? 0 : favBtns.length;
        let localIdx = targetBtns.length;
        let markerX = 0;
        const [boxX, boxY] = appBox.get_transformed_position();
        if (targetBtns.length > 0) {
            markerX = targetBtns[0].get_transformed_position()[0];
            for (let i = 0; i < targetBtns.length; i++) {
                const b = targetBtns[i];
                if (b === this) continue;
                const [btnX] = b.get_transformed_position();
                if (mx < btnX + b.width / 2) { localIdx = i; markerX = btnX; break; }
                markerX = btnX + b.width;
            }
        } else { markerX = boxX; }
        if (this._dropMarker) {
            this._dropMarker.set_size(2, this.height - 12);
            this._dropMarker.set_position(Math.round(markerX - 1), Math.round(boxY + 6));
            this._dropMarker.show();
        }
        this._dropTarget = { unfavorite: false, insertIndex: baseIndex + localIdx };
    }

    _dragEnd() {
        if (this._isDestroyed) return;
        this.opacity = 255;
        if (this._dragActor) { this._dragActor.destroy(); this._dragActor = null; }
        if (this._dropMarker) { this._dropMarker.hide(); if (this._dropMarker.get_parent()) Main.uiGroup.remove_child(this._dropMarker); }
        this._emitBarSignal('drag-end');
        const target = this._dropTarget; this._dropTarget = null;
        if (!target) return;
        const appId = this._app.get_id();
        const favs = AppFavorites.getAppFavorites();
        if (target.unfavorite) { if (this._isFavorite) favs.removeFavorite(appId); return; }
        if (this._isFavorite) {
            if (typeof favs.moveFavoriteToPos === 'function') favs.moveFavoriteToPos(appId, target.insertIndex);
        } else {
            const favCount = favs.getFavorites().length;
            const relativePos = target.insertIndex - favCount;
            this._emitBarSignal('reorder-running', { appId, pos: relativePos });
        }
    }

    _emitBarSignal(name, data = null) {
        if (this._isDestroyed) return;
        let p = this.get_parent();
        while (p) {
            if (p.has_style_class_name && p.has_style_class_name('bottom-taskbar')) {
                try { data ? p.emit(name, data) : p.emit(name); } catch (e) {}
                return;
            }
            p = p.get_parent ? p.get_parent() : null;
        }
    }

    _showContextMenu() {
        if (this._isDestroyed) return;
        if (!this._menu) {
            this._menu = new PopupMenu.PopupMenu(this, 0.5, St.Side.BOTTOM);
            Main.uiGroup.add_child(this._menu.actor);
            this._menu.actor.hide();
            this._menuMgr = new PopupMenu.PopupMenuManager(this);
            this._menuMgr.addMenu(this._menu);
        }
        this._menu.removeAll();
        const app = this._app; const wins = app.get_windows(); const isRun = wins.length > 0;
        const favs = AppFavorites.getAppFavorites(); const appId = app.get_id(); const isFav = favs.isFavorite(appId);
        
        if (isRun) {
            const openItem = new PopupMenu.PopupMenuItem('Otwórz');
            openItem.connect('activate', () => { Main.activateWindow(wins[0]); });
            this._menu.addMenuItem(openItem);
        }
        
        const newItem = new PopupMenu.PopupMenuItem('Nowe okno');
        newItem.connect('activate', () => { app.can_open_new_window?.() ? app.open_new_window(-1) : app.activate(); });
        this._menu.addMenuItem(newItem);
        
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        const pinItem = new PopupMenu.PopupMenuItem(isFav ? 'Odepnij' : 'Przypnij');
        pinItem.connect('activate', () => { 
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                isFav ? favs.removeFavorite(appId) : favs.addFavorite(appId);
                return GLib.SOURCE_REMOVE;
            });
        });
        this._menu.addMenuItem(pinItem);
        
        if (isRun) {
            this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            const closeItem = new PopupMenu.PopupMenuItem('Zamknij');
            closeItem.connect('activate', () => { for (const w of app.get_windows()) w.delete(global.get_current_time()); });
            this._menu.addMenuItem(closeItem);
        }
        openMenuAboveBar(this._menu, this, 4, null, true);
    }

    _onHover() {
        if (this._isDestroyed) return;
        if (this._hideTimerId) { GLib.source_remove(this._hideTimerId); this._hideTimerId = null; }
        if (this._hoverTimeout) { GLib.source_remove(this._hoverTimeout); this._hoverTimeout = null; }
        if (this.hover) {
            this._hoverTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HOVER_DELAY_MS, () => {
                this._hoverTimeout = null;
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;
                this._refreshPreview();
                return GLib.SOURCE_REMOVE;
            });
        } else {
            this._hideTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
                this._hideTimerId = null; 
                if (this._isDestroyed) return GLib.SOURCE_REMOVE;
                if (this.hover || (this._previewPopup && this._previewPopup.hover)) return GLib.SOURCE_REMOVE;
                this._hideTooltip(); 
                this._hideWindowPreview(); 
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _refreshPreview() {
        if (this._isDestroyed) return;
        
        const ws = global.workspace_manager.get_active_workspace();
        // Zawsze upewniamy się, że omijamy okna w trakcie niszczenia (w.get_workspace() !== null)
        const wins = this._app.get_windows().filter(w => w.get_workspace() === ws && w.get_workspace() !== null);
        
        if (wins.length > 0) {
            this._showWindowPreview(wins);
            if (!this._winSignalId) {
                this._winSignalId = this._app.connect('windows-changed', () => {
                    if (this._isDestroyed) return;
                    if (this.hover && this._previewPopup) {
                        const currentWs = global.workspace_manager.get_active_workspace();
                        const currentWins = this._app.get_windows().filter(w => w.get_workspace() === currentWs && w.get_workspace() !== null);
                        if (currentWins.length > 0) {
                            this._showWindowPreview(currentWins);
                        } else {
                            this._hideWindowPreview();
                            if (this.hover) this._showTooltip();
                        }
                    }
                });
            }
        } else {
            this._showTooltip();
        }
    }

    _showWindowPreview(wins) {
        if (this._isDestroyed) return;

        if (!this._previewPopup) {
            this._emitBarSignal('menu-opened');
        } else {
            const oldPopup = this._previewPopup;
            if (this._previewHoverTimer) { 
                GLib.source_remove(this._previewHoverTimer); 
                this._previewHoverTimer = null; 
            }
            if (!oldPopup.get_stage()) {
                if (oldPopup.get_parent()) Main.uiGroup.remove_child(oldPopup);
                killAllTransitions(oldPopup);
                oldPopup.destroy();
            } else {
                oldPopup.ease({ 
                    opacity: 0, 
                    duration: 100, 
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD, 
                    onStopped: () => { 
                        killAllTransitions(oldPopup);
                        if (oldPopup.get_parent()) Main.uiGroup.remove_child(oldPopup); 
                        oldPopup.destroy(); 
                    } 
                });
            }
        }

        const popup = new St.BoxLayout({ style_class : 'tb-preview-popup', reactive : true, track_hover : true, y_align : Clutter.ActorAlign.CENTER });
        const tc = this._getThemeClass(); if (tc) popup.add_style_class_name(tc);
        const currentWs = global.workspace_manager.get_active_workspace();
        
        for (const win of wins) {
            const cell = new St.Button({ style_class : 'tb-preview-cell', reactive : true, can_focus : true, track_hover : true });
            const wrapper = new St.Widget({ layout_manager : new Clutter.BinLayout(), width : PREVIEW_W, height : PREVIEW_H });
            const actor = win.get_compositor_private();
            
            if (actor) {
                const [winW, winH] = win.get_frame_rect() ? [win.get_frame_rect().width, win.get_frame_rect().height] : actor.get_size();
                const scale = Math.min(1.0, (PREVIEW_W - 8) / Math.max(winW, 1), (PREVIEW_H - 30) / Math.max(winH, 1));
                const clone = new Clutter.Clone({ source: actor, width: winW * scale, height: winH * scale, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER, x_expand: true, y_expand: true });
                wrapper.add_child(clone);
            }
            
            const appName = this._app.get_name();
            const winTitle = win.get_title();
            const fullTitle = (winTitle && winTitle !== appName) ? `${appName} - ${winTitle}` : appName;
            const title = new St.Label({ text: fullTitle, style_class: 'tb-preview-title', x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.START, x_expand: true });
            title.clutter_text.ellipsize = 3; 
            wrapper.add_child(title);
            
            const closeBtn = new St.Button({ style_class: 'tb-preview-close-btn', child: new St.Icon({ icon_name: 'window-close-symbolic', icon_size: 14 }), x_align: Clutter.ActorAlign.END, y_align: Clutter.ActorAlign.START, x_expand: true, y_expand: true, reactive: true, can_focus: true, style: 'background-color: rgba(0,0,0,0.6); border-radius: 99px; padding: 4px; margin: 2px;' });
            
            // FUNKCJA ZAMYKAJĄCA POJEDYNCZE OKNO
            const closeWindow = () => {
                if (!win.get_workspace()) return; // Zapobiega błędom, gdy okno już jest usuwane
                win.delete(global.get_current_time());
                
                // Magia: natychmiastowe zniszczenie samej miniaturki dla płynności podglądu!
                if (cell.get_parent()) {
                    killAllTransitions(cell);
                    cell.destroy();
                }
                
                // Zamykamy całkowicie podgląd jeśli usunięto ostatnie okno
                const remainingWins = this._app.get_windows().filter(w => w !== win && w.get_workspace() === currentWs && w.get_workspace() !== null);
                if (remainingWins.length === 0) {
                    this._hideWindowPreview();
                    if (this.hover) this._showTooltip();
                }
            };

            closeBtn.connect('clicked', () => { closeWindow(); });
            wrapper.add_child(closeBtn);
            
            cell.set_child(wrapper);
            
            cell.connect('clicked', () => { 
                if (!win.get_workspace()) return; // FIX BŁĘDU: "TypeError: can't access property index"
                this._hideWindowPreview(); 
                Main.activateWindow(win); 
            });
            cell.connect('button-press-event', (_a, ev) => { 
                if (ev.get_button() === 2) { 
                    closeWindow();
                    return Clutter.EVENT_STOP; // Zatrzymujemy kliknięcie, aby nie aktywowało usuwanego okna
                } 
                return Clutter.EVENT_PROPAGATE; 
            });
            
            popup.add_child(cell);
        }
        
        Main.uiGroup.add_child(popup); popup.opacity = 0;
        
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._isDestroyed || !this._previewPopup || this._previewPopup !== popup) return GLib.SOURCE_REMOVE;
            
            const [ax, ay] = this.get_transformed_position();
            const [minW, pw] = popup.get_preferred_width(-1);
            const [minH, ph] = popup.get_preferred_height(-1);
            
            const mon = Main.layoutManager.primaryMonitor;
            let x = ax + (this.width / 2) - (pw / 2);
            x = Math.max(mon.x + 4, Math.min(x, mon.x + mon.width - pw - 4));
            
            popup.set_position(Math.floor(x), Math.floor(ay - ph - 6));
            popup.ease({ opacity: 255, duration: 120, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            return GLib.SOURCE_REMOVE;
        });

        popup.connect('notify::hover', () => {
            if (this._isDestroyed || !this._previewPopup || this._previewPopup !== popup) return;
            try {
                if (popup.get_parent() === null) return;
                if (!popup.hover && !this.hover) {
                    if (this._previewHoverTimer) GLib.source_remove(this._previewHoverTimer);
                    this._previewHoverTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HIDE_DELAY_MS, () => {
                        this._previewHoverTimer = null; 
                        if (this._isDestroyed || !this._previewPopup) return GLib.SOURCE_REMOVE;
                        this._hideWindowPreview(); 
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } catch (e) {}
        });
        
        this._previewPopup = popup;
    }

    _hideWindowPreview() {
        if (this._winSignalId) { 
            this._app.disconnect(this._winSignalId); 
            this._winSignalId = null; 
        }
        const popup = this._previewPopup; 
        if (!popup) return; 

        this._emitBarSignal('menu-closed');

        this._previewPopup = null;
        if (this._previewHoverTimer) { GLib.source_remove(this._previewHoverTimer); this._previewHoverTimer = null; }
        
        if (!popup.get_stage()) {
            if (popup.get_parent()) Main.uiGroup.remove_child(popup);
            killAllTransitions(popup);
            popup.destroy();
        } else {
            popup.ease({ 
                opacity: 0, 
                duration: 100, 
                mode: Clutter.AnimationMode.EASE_OUT_QUAD, 
                onStopped: () => { 
                    killAllTransitions(popup);
                    if (popup.get_parent()) Main.uiGroup.remove_child(popup); 
                    popup.destroy(); 
                } 
            });
        }
    }

    _showTooltip() {
        if (this._isDestroyed) return;
        const tc = this._getThemeClass();
        if (tc) {
            const classes = this._tooltip.get_style_class_name().split(' ');
            for (const c of classes) if (c.startsWith('theme-')) this._tooltip.remove_style_class_name(c);
            this._tooltip.add_style_class_name(tc);
        }
        const [ax, ay] = this.get_transformed_position();
        const tw = this._tooltip.get_preferred_width(-1)[1]; const th = this._tooltip.get_preferred_height(-1)[1];
        this._tooltip.set_position(Math.round(ax + (this.width - tw) / 2), Math.round(ay - th - 6));
        this._tooltip.ease({ opacity: 255, duration: 120 });
    }

    _hideTooltip() { if (this._isDestroyed) return; this._tooltip.ease({ opacity: 0, duration: 80 }); }

    updateState(running, active) {
        if (this._isDestroyed) return;
        this.remove_style_class_name('running'); 
        this.remove_style_class_name('active');
        
        const hasStage = this._dot && this._dot.get_stage() !== null;
        
        if (running) { 
            this.add_style_class_name('running'); 
            if (hasStage) this._dot.ease({ width: active ? 20 : 5, duration: 150 });
            else this._dot.width = active ? 20 : 5;
        } else { 
            if (hasStage) this._dot.ease({ width: 0, duration: 100 });
            else this._dot.width = 0;
        }
        if (active) this.add_style_class_name('active');
    }

    _onClick() {
        if (this._isDestroyed) return;
        const ws = global.workspace_manager.get_active_workspace();
        // Bezpiecznie sprawdzamy pulpity, omijając okna z null
        const wins = this._app.get_windows().filter(w => w.get_workspace() === ws && w.get_workspace() !== null);
        if (wins.length === 0) { const all = this._app.get_windows(); all.length > 0 ? Main.activateWindow(all[0]) : this._app.activate(); }
        else if (wins.length === 1) { const w = wins[0]; w.has_focus() ? w.minimize() : (w.unminimize(), Main.activateWindow(w)); }
        else { const f = wins.find(w => w.has_focus()); Main.activateWindow(f ? wins[(wins.indexOf(f) + 1) % wins.length] : wins[0]); }
    }

    _onDestroy() {
        this._isDestroyed = true; 
        
        killAllTransitions(this);
        
        if (this._press) { if (this._press.motionId) global.stage.disconnect(this._press.motionId); if (this._press.releaseId) global.stage.disconnect(this._press.releaseId); }
        if (this._dragActor) this._dragActor.destroy();
        if (this._dropMarker) { if (this._dropMarker.get_parent()) Main.uiGroup.remove_child(this._dropMarker); this._dropMarker.destroy(); }
        if (this._hideTimerId) GLib.source_remove(this._hideTimerId);
        if (this._previewHoverTimer) GLib.source_remove(this._previewHoverTimer);
        if (this._hoverTimeout) GLib.source_remove(this._hoverTimeout);
        if (this._winSignalId) this._app.disconnect(this._winSignalId);
        if (this._menu) this._menu.destroy();
        
        if (this._previewPopup) {
            this._emitBarSignal('menu-closed');
            killAllTransitions(this._previewPopup);
            if (this._previewPopup.get_parent()) Main.uiGroup.remove_child(this._previewPopup); 
            this._previewPopup.destroy();
            this._previewPopup = null;
        }
        
        if (this._tooltip) { 
            killAllTransitions(this._tooltip);
            if (this._tooltip.get_parent()) Main.layoutManager.removeChrome(this._tooltip); 
            this._tooltip.destroy(); 
        }
    }

    get app() { return this._app; }
});
