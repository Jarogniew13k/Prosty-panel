// Prosty Panel — extension.js

import GLib from 'gi://GLib';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { ClassicPanel } from './classicpanel.js';
import { FloatPanel }   from './floatpanel.js';

export default class ProstyPanel extends Extension {
    enable() {
        this._enabled = true;
        this._settings = this.getSettings();
        this._rebuildPending = 0;

        this._createPanel();

        this._settingsIds = [
            this._settings.connect('changed::mode',      () => this._scheduleRebuild()),
            this._settings.connect('changed::auto-hide', () => this._scheduleRebuild()),
        ];
    }

    disable() {
        this._enabled = false;

        if (this._rebuildPending) {
            GLib.source_remove(this._rebuildPending);
            this._rebuildPending = 0;
        }
        if (this._settingsIds) {
            for (const id of this._settingsIds) this._settings.disconnect(id);
            this._settingsIds = null;
        }
        this._panel?.disable();
        this._panel = null;
        this._settings = null;
    }

    _createPanel() {
        const mode     = this._settings.get_string('mode');
        const autoHide = this._settings.get_boolean('auto-hide');

        if (mode === 'floating') {
            this._panel = new FloatPanel({ autoHide, settings: this._settings });
        } else {
            this._panel = new ClassicPanel(this._settings);
        }
        this._panel.enable();
    }

    _scheduleRebuild() {
        if (!this._enabled) return;
        if (this._rebuildPending) GLib.source_remove(this._rebuildPending);
        this._rebuildPending = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            if (!this._enabled) return GLib.SOURCE_REMOVE;
            this._rebuildPending = 0;
            this._panel?.disable();
            this._panel = null;
            this._createPanel();
            return GLib.SOURCE_REMOVE;
        });
    }
}
