// Prosty Panel — intellihide.js

import Clutter from 'gi://Clutter';
import GLib    from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta    from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PointerWatcher from 'resource:///org/gnome/shell/ui/pointerWatcher.js';

const CHECK_POINTER_MS   = 50;
const PROXIMITY_CHECK_MS = 300;
const ANIMATION_TIME     = 150;
const HIDE_DELAY         = 400;
const SHOW_DELAY_MS      = 0;
const EDGE_THRESHOLD     = 1;
const HOVER_EXTEND_HORIZONTAL = 15;
const HOVER_EXTEND_BOTTOM     = 20;
const HOVER_EXTEND_TOP        = 10;

export const Intellihide = GObject.registerClass({
    Signals: {
        'showing': {},
        'hiding': {},
    },
}, class Intellihide extends GObject.Object {
    _init(panel, monitor, taskbar) {
        super._init();
        this._panel    = panel;
        this._monitor  = monitor;
        this._taskbar  = taskbar;

        this._holdCounter     = 0;
        this._hover           = false;
        this._visible         = true;
        this._proximityOverlap= false;
        this._enabled         = false;
        this._targetBox       = null;

        this._hideTimer        = null;
        this._showTimer        = null;
        this._pointerWatchId   = 0;
        this._proximityTimer   = 0;
        this._signalIds        = [];
    }

    updateTargetBox(box) {
        this._targetBox = box;
        if (this._enabled) this._checkProximity();
    }

    enable() {
        if (this._enabled) return;
        this._enabled = true;

        this._panel.translation_y = 0;
        this._panel.visible = true;
        this._panel.opacity = 255;
        this._panel.set_reactive(true);
        this._visible = true;

        this._pointerWatchId = PointerWatcher.getPointerWatcher().addWatch(
            CHECK_POINTER_MS,
            (x, y) => this._onPointerMove(x, y)
        );

        this._proximityTimer = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            PROXIMITY_CHECK_MS,
            () => {
                this._checkProximity();
                return GLib.SOURCE_CONTINUE;
            }
        );

        this._signalIds.push([this._taskbar, this._taskbar.connect('menu-opened', () => {
            this.revealAndHold();
        })]);
        this._signalIds.push([this._taskbar, this._taskbar.connect('menu-closed', () => {
            this.release();
        })]);
        this._signalIds.push([this._taskbar, this._taskbar.connect('drag-start', () => {
            this.revealAndHold();
        })]);
        this._signalIds.push([this._taskbar, this._taskbar.connect('drag-end', () => {
            this.release();
        })]);

        this._signalIds.push([Main.overview, Main.overview.connect('showing', () => {
            if (this._enabled) this._updatePanelVisibility(true);
        })]);
        this._signalIds.push([Main.overview, Main.overview.connect('hidden', () => {
            if (this._enabled) this._updatePanelVisibility(false);
        })]);

        this._updatePanelVisibility(true);
    }

    disable() {
        if (!this._enabled) return;
        this._enabled = false;

        if (this._pointerWatchId) {
            try {
                PointerWatcher.getPointerWatcher().removeWatch(this._pointerWatchId);
            } catch (e) { console.debug('[Prosty Panel] Error removing pointer watch:', e); }
            this._pointerWatchId = 0;
        }
        if (this._proximityTimer) {
            GLib.source_remove(this._proximityTimer);
            this._proximityTimer = 0;
        }
        if (this._hideTimer) {
            GLib.source_remove(this._hideTimer);
            this._hideTimer = null;
        }
        if (this._showTimer) {
            GLib.source_remove(this._showTimer);
            this._showTimer = null;
        }
        for (const [obj, id] of this._signalIds) {
            try { obj.disconnect(id); } catch (e) { console.debug('[Prosty Panel] Error disconnecting signal:', e); }
        }
        this._signalIds = [];

        this._panel.remove_all_transitions();
        this._panel.show();
        this._panel.opacity = 255;
        this._panel.set_reactive(true);
        this._panel.translation_y = 0;
        this._visible = true;
        this._holdCounter = 0;
        this._hover = false;
    }

    revealAndHold(immediate = false) {
        if (!this._enabled) return;
        this._holdCounter++;
        this._updatePanelVisibility(immediate);
    }

    release(immediate = false) {
        if (!this._enabled) return;
        if (this._holdCounter > 0) {
            this._holdCounter--;
        }
        this._updatePanelVisibility(immediate);
    }

    reset() {
        this.disable();
        this.enable();
    }

    _isFullscreen() {
        const ws = global.workspace_manager.get_active_workspace();
        const windows = ws.list_windows();
        return windows.some(win => win.fullscreen && win.get_monitor() === this._monitor.index);
    }

    _onPointerMove(x, y) {
        if (!this._enabled) return;
        if (this._isFullscreen()) return;

        const mon = this._monitor;
        const isAtBottomEdge = (y >= mon.y + mon.height - EDGE_THRESHOLD);

        let isOverPanel = false;
        if (this._panel) {
            const [px, py] = this._panel.get_transformed_position();
            const pw = this._panel.width;
            const ph = this._panel.height;
            const left   = px - HOVER_EXTEND_HORIZONTAL;
            const right  = px + pw + HOVER_EXTEND_HORIZONTAL;
            const top    = py - HOVER_EXTEND_TOP;
            const bottom = py + ph + HOVER_EXTEND_BOTTOM;
            isOverPanel = (x >= left && x <= right && y >= top && y <= bottom);
        }

        if (!isOverPanel) {
            let actor = global.stage.get_actor_at_pos(Clutter.PickMode.ALL, x, y);
            while (actor) {
                if (actor.has_style_class_name && actor.has_style_class_name('tb-arrow')) {
                    isOverPanel = true;
                    break;
                }
                actor = actor.get_parent();
            }
        }

        const wantHover = (isAtBottomEdge || isOverPanel);

        if (wantHover === this._hover) return;

        if (wantHover) {
            if (this._showTimer) return;
            this._showTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SHOW_DELAY_MS, () => {
                this._showTimer = null;
                if (!this._enabled) return GLib.SOURCE_REMOVE;
                this._hover = true;
                this._updatePanelVisibility(false);
                return GLib.SOURCE_REMOVE;
            });
        } else {
            if (this._showTimer) {
                GLib.source_remove(this._showTimer);
                this._showTimer = null;
            }
            if (this._hover) {
                this._hover = false;
                this._updatePanelVisibility(false);
            }
        }
    }

    _checkProximity() {
        if (!this._enabled) return;
        if (this._isFullscreen()) return;
        if (!this._panel || this._panel.get_stage() === null || this._panel._panelDestroyed) return;
        const geom = this._getGeometry();
        if (!geom) return;

        let overlap = false;
        const ws = global.workspace_manager.get_active_workspace();
        const windows = ws.list_windows();

        for (const win of windows) {
            if (win.minimized || win.is_hidden()) continue;
            if (win.get_monitor() !== this._monitor.index) continue;
            const type = win.get_window_type();
            if (type === Meta.WindowType.DESKTOP || type === Meta.WindowType.DOCK) continue;

            const rect = win.get_frame_rect();
            if (rect.x < geom.x + geom.width &&
                rect.x + rect.width > geom.x &&
                rect.y < geom.y + geom.height &&
                rect.y + rect.height > geom.y) {
                overlap = true;
                break;
            }
        }

        if (overlap !== this._proximityOverlap) {
            this._proximityOverlap = overlap;
            this._updatePanelVisibility(false);
        }
    }

    _getGeometry() {
        if (this._targetBox) {
            return {
                x          : this._targetBox.x1,
                y          : this._targetBox.y1,
                width      : this._targetBox.x2 - this._targetBox.x1,
                height     : this._targetBox.y2 - this._targetBox.y1,
                bottomEdge : this._targetBox.y2,
            };
        }
        if (!this._panel || this._panel.get_stage() === null || this._panel._panelDestroyed) return null;
        const mon = this._monitor;
        const panelHeight = this._panel.height;
        if (!panelHeight) return null;
        const [px, py] = this._panel.get_transformed_position();
        return {
            x          : px,
            y          : py,
            width      : this._panel.width  || mon.width,
            height     : panelHeight,
            bottomEdge : mon.y + mon.height,
        };
    }

    _shouldBeVisible() {
        if (Main.overview.visible) return true;
        if (this._holdCounter > 0) return true;
        if (this._hover) return true;
        if (this._proximityOverlap) return false;
        return true;
    }

    _updatePanelVisibility(immediate) {
        if (!this._enabled) return;
        const wantVisible = this._shouldBeVisible();
        if (wantVisible === this._visible && !immediate) return;

        if (wantVisible) {
            this._showPanel(immediate);
        } else {
            this._scheduleHide(immediate);
        }
    }

    _showPanel(immediate) {
        if (this._hideTimer) {
            GLib.source_remove(this._hideTimer);
            this._hideTimer = null;
        }
        this.emit('showing');
        this._visible = true;
        this._cancelAnimation();
        this._panel.show();
        this._panel.set_reactive(true);
        if (immediate) {
            this._panel.translation_y = 0;
            this._panel.opacity = 255;
        } else {
            this._animateTo(0, 0);
        }
    }

    _scheduleHide(immediate) {
        if (this._hideTimer) GLib.source_remove(this._hideTimer);
        const delay = immediate ? 0 : HIDE_DELAY;
        if (delay === 0) {
            this._hidePanel();
        } else {
            this._hideTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._hideTimer = null;
                this._hidePanel();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _hidePanel() {
        this.emit('hiding');
        this._visible = false;
        this._cancelAnimation();
        const targetY = this._panel.height;
        this._animateTo(targetY, 0, () => {
            this._panel.opacity = 0;
            this._panel.set_reactive(false);
            Main.layoutManager._queueUpdateRegions();
        });
    }

    _animateTo(targetY, delay, onComplete) {
        const current = this._panel.translation_y;
        if (current === targetY) {
            if (onComplete) onComplete();
            return;
        }
        this._panel.ease({
            translation_y : targetY,
            opacity       : targetY === 0 ? 255 : 0,
            duration      : ANIMATION_TIME,
            delay         : delay,
            mode          : Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped     : () => {
                if (onComplete) onComplete();
                Main.layoutManager._queueUpdateRegions();
            },
        });
    }

    _cancelAnimation() {
        this._panel.remove_all_transitions();
    }
});