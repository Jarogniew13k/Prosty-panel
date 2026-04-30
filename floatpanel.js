// Prosty Panel — floatpanel.js (hybryda: pływający wygląd + rezerwacja 70px)

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { PANEL_HEIGHT } from './constants.js';
import { BottomTaskbar } from './classicpanel.js';
import { Intellihide } from './intellihide.js';

const FLOAT_MARGIN = 8;
const STRUT_HEIGHT = 64; 

export class FloatPanel {
    constructor({ autoHide = false, settings = null }) {
        this._autoHide = autoHide;
        this._settings = settings;
        this._bar = null;
        this._dummyStrut = null;
        this._intellihide = null;
        this._focusId = 0;
        this._monitorId = 0;
        this._themeId = 0;
        this._unredirectDisabled = false;
        this._targetBox = null;
    }

    enable() {
        console.log('[Prosty Panel] FloatPanel enable, autoHide =', this._autoHide);
        this._hideTopPanel();

        const mon = Main.layoutManager.primaryMonitor;

        if (!this._autoHide) {
            this._dummyStrut = new St.Widget({
                width: mon.width,
                height: STRUT_HEIGHT,
                opacity: 0,
                reactive: false
            });
            Main.layoutManager.addChrome(this._dummyStrut, {
                affectsStruts: true,
                trackFullscreen: false
            });
            this._dummyStrut.set_position(mon.x, mon.y + mon.height - STRUT_HEIGHT);
        }

        // Zawsze wyłączamy direct scanout
        this._disableUnredirect();

        this._bar = new BottomTaskbar(this._settings);
        this._bar.add_style_class_name('mode-floating');

        if (this._autoHide) {
            Main.layoutManager.addTopChrome(this._bar, {
                affectsStruts: false,
                trackFullscreen: false
            });
        } else {
            Main.layoutManager.addChrome(this._bar, {
                affectsStruts: false,
                trackFullscreen: false
            });
        }

        this._reposition();
        this._updateTargetBox();

        this._focusId = global.display.connect('notify::focus-window', () => {
            if (this._bar) {
                Main.layoutManager._queueUpdateRegions();
            }
        });

        this._monitorId = Main.layoutManager.connect('monitors-changed', () => {
            this._reposition();
            this._updateTargetBox();
            const m = Main.layoutManager.primaryMonitor;
            if (this._dummyStrut && !this._autoHide) {
                this._dummyStrut.set_size(m.width, STRUT_HEIGHT);
                this._dummyStrut.set_position(m.x, m.y + m.height - STRUT_HEIGHT);
            }
        });

        if (this._settings) {
            this._themeId = this._settings.connect('changed::theme', () => {
                if (this._bar && typeof this._bar._applyTheme === 'function')
                    this._bar._applyTheme();
            });
        }

        this._bar.visible = true;
        this._bar.translation_y = 0;

        if (this._autoHide) this._enableIntellihide();
    }

    disable() {
        if (this._themeId && this._settings) {
            this._settings.disconnect(this._themeId);
            this._themeId = 0;
        }
        if (this._focusId) {
            global.display.disconnect(this._focusId);
            this._focusId = 0;
        }
        if (this._monitorId) {
            Main.layoutManager.disconnect(this._monitorId);
            this._monitorId = 0;
        }
        if (this._intellihide) {
            this._intellihide.disable();
            this._intellihide = null;
        }
        if (this._dummyStrut) {
            Main.layoutManager.removeChrome(this._dummyStrut);
            this._dummyStrut.destroy();
            this._dummyStrut = null;
        }
        if (this._bar) {
            Main.layoutManager.removeChrome(this._bar);
            this._bar.destroy();
        }
        this._enableUnredirect();
        this._showTopPanel();
    }

    setAutoHide(enabled) {
        this._autoHide = enabled;
        if (enabled) {
            this._enableIntellihide();
            if (this._dummyStrut && this._dummyStrut.get_parent()) {
                Main.layoutManager.removeChrome(this._dummyStrut);
                this._dummyStrut.destroy();
                this._dummyStrut = null;
            }
        } else {
            if (this._intellihide) {
                this._intellihide.disable();
                this._intellihide = null;
            }
            this._bar.translation_y = 0;
            this._disableUnredirect();
            const mon = Main.layoutManager.primaryMonitor;
            if (!this._dummyStrut) {
                this._dummyStrut = new St.Widget({
                    width: mon.width,
                    height: STRUT_HEIGHT,
                    opacity: 0,
                    reactive: false
                });
                Main.layoutManager.addChrome(this._dummyStrut, {
                    affectsStruts: true,
                    trackFullscreen: false
                });
                this._dummyStrut.set_position(mon.x, mon.y + mon.height - STRUT_HEIGHT);
            }
        }
    }

    _updateTargetBox() {
        if (!this._bar) return;
        const mon = Main.layoutManager.primaryMonitor;
        const margin = FLOAT_MARGIN;
        const x = mon.x + margin;
        const y = mon.y + mon.height - PANEL_HEIGHT - margin;
        const w = mon.width - 2 * margin;
        const h = PANEL_HEIGHT;

        if (!this._targetBox) {
            this._targetBox = new Clutter.ActorBox();
        }
        this._targetBox.set_origin(x, y);
        this._targetBox.set_size(w, h);

        if (this._intellihide && typeof this._intellihide.updateTargetBox === 'function') {
            this._intellihide.updateTargetBox(this._targetBox);
        }
    }

    _disableUnredirect() {
        if (this._unredirectDisabled) return;
        try {
            if (Meta.disable_unredirect_for_display) {
                Meta.disable_unredirect_for_display(global.display);
            } else if (global.compositor?.disable_unredirect) {
                global.compositor.disable_unredirect();
            } else {
                return;
            }
            this._unredirectDisabled = true;
        } catch(e) {
            console.log('[Prosty Panel] Failed to disable unredirect', e);
        }
    }

    _enableUnredirect() {
        if (!this._unredirectDisabled) return;
        try {
            if (Meta.enable_unredirect_for_display) {
                Meta.enable_unredirect_for_display(global.display);
            } else if (global.compositor?.enable_unredirect) {
                global.compositor.enable_unredirect();
            }
            this._unredirectDisabled = false;
        } catch(e) {
            console.log('[Prosty Panel] Failed to enable unredirect', e);
        }
    }

    _enableIntellihide() {
        if (!this._intellihide && this._bar) {
            const mon = Main.layoutManager.primaryMonitor;
            this._intellihide = new Intellihide(this._bar, mon, this._bar);
            this._bar._intellihide = this._intellihide;
            if (this._targetBox) {
                this._intellihide.updateTargetBox(this._targetBox);
            }
            this._intellihide.connect('showing', () => this._disableUnredirect());
            this._intellihide.connect('hiding', () => this._enableUnredirect());
            this._intellihide.enable();
        }
    }

    _hideTopPanel() {
        Main.panel.hide();
        Main.layoutManager.panelBox.hide();
        let idx = Main.layoutManager._findActor(Main.layoutManager.panelBox);
        if (idx >= 0) {
            this._oldAffectsStruts = Main.layoutManager._trackedActors[idx].affectsStruts;
            Main.layoutManager._trackedActors[idx].affectsStruts = false;
            Main.layoutManager._queueUpdateRegions();
        }
        
        // Zabezpieczenie na wyskakujący Dock w GNOME 49
        if (Main.overview?.dash) {
            this._dashOrigVisible = Main.overview.dash.visible;
            this._dashOrigShow = Main.overview.dash.show;
            Main.overview.dash.show = function() {};
            Main.overview.dash.hide();
        }
    }

    _showTopPanel() {
        Main.layoutManager.panelBox.show();
        Main.panel.show();
        if (this._oldAffectsStruts !== undefined) {
            let idx = Main.layoutManager._findActor(Main.layoutManager.panelBox);
            if (idx >= 0) Main.layoutManager._trackedActors[idx].affectsStruts = this._oldAffectsStruts;
            this._oldAffectsStruts = undefined;
            Main.layoutManager._queueUpdateRegions();
        }

        // Przywracanie oryginalnego zachowania Docka w GNOME 49
        if (Main.overview?.dash && this._dashOrigShow) {
            Main.overview.dash.show = this._dashOrigShow;
            Main.overview.dash.visible = this._dashOrigVisible;
            this._dashOrigShow = undefined;
            this._dashOrigVisible = undefined;
        }
    }

    _reposition() {
        if (!this._bar) return;
        const mon = Main.layoutManager.primaryMonitor;
        const margin = FLOAT_MARGIN;
        const x = mon.x + margin;
        const y = mon.y + mon.height - PANEL_HEIGHT - margin;
        const w = mon.width - 2 * margin;
        const h = PANEL_HEIGHT;

        this._bar.set_position(x, y);
        this._bar.set_size(w, h);
        this._bar.visible = true;
    }
}