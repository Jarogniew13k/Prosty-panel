// Prosty Panel — prefs.js

import Adw  from 'gi://Adw';
import Gtk  from 'gi://Gtk';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MODES = [
    { id: 'classic',  name: 'Klasyczny — pasek przyklejony do krawędzi' },
    { id: 'floating', name: 'Pływający — pasek z marginesem, tapeta widoczna pod nim' },
];

const THEMES = [
    { id: 'cyberpunk',       name: 'Cyberpunk — Głęboka czerń z neonowym różem' },
    { id: 'dracula',         name: 'Dracula — Klasyczny fiolet (Dracula Theme)' },
    { id: 'ubuntu-yaru',     name: 'Ubuntu Yaru — Ciemny grafit z pomarańczą' },
    { id: 'gruvbox',         name: 'Gruvbox — Retro ciemny z matową zielenią' },
    { id: 'nordic',          name: 'Nordic — Chłodny, arktyczny błękit (Nord)' },
    { id: 'solid-dark',      name: 'Onyx Black — Czysta, absolutna czerń z bielą' },
    { id: 'solid-light',     name: 'Solid Light — Jasny, neutralny motyw' },
    { id: 'gnome-dark',      name: 'GNOME Dark — Domyślny ciemny motyw systemu' },
];

export default class ProstyPanelPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title     : 'Ustawienia',
            icon_name : 'preferences-desktop-symbolic',
        });
        window.add(page);

        const modeGroup = new Adw.PreferencesGroup({ title: 'Tryb paska' });
        page.add(modeGroup);

        const modeRow = new Adw.ComboRow({ title: 'Tryb', subtitle: 'Zmiana wymaga ponownego przeładowania' });
        const modeModel = new Gtk.StringList();
        for (const m of MODES) modeModel.append(m.name);
        modeRow.model = modeModel;

        const currentMode = settings.get_string('mode');
        modeRow.selected = MODES.findIndex(m => m.id === currentMode);
        if (modeRow.selected < 0) modeRow.selected = 0;

        modeRow.connect('notify::selected', () => {
            const id = MODES[modeRow.selected]?.id;
            if (id) settings.set_string('mode', id);
        });
        modeGroup.add(modeRow);

        const ahGroup = new Adw.PreferencesGroup({ title: 'Auto-ukrywanie' });
        page.add(ahGroup);

        const ahRow = new Adw.SwitchRow({ title: 'Włącz auto-ukrywanie (tylko tryb pływający)' });
        ahRow.active = settings.get_boolean('auto-hide');
        ahRow.connect('notify::active', () => {
            settings.set_boolean('auto-hide', ahRow.active);
        });
        ahGroup.add(ahRow);

        const themeGroup = new Adw.PreferencesGroup({ title: 'Motyw paska' });
        page.add(themeGroup);

        const themeRow = new Adw.ComboRow({ title: 'Motyw' });
        const themeModel = new Gtk.StringList();
        for (const t of THEMES) themeModel.append(t.name);
        themeRow.model = themeModel;

        let currentTheme = settings.get_string('theme');
        let selectedIdx = THEMES.findIndex(t => t.id === currentTheme);
        if (selectedIdx < 0) selectedIdx = 0;
        themeRow.selected = selectedIdx;

        themeRow.connect('notify::selected', () => {
            const id = THEMES[themeRow.selected]?.id;
            if (id) settings.set_string('theme', id);
        });
        themeGroup.add(themeRow);

        const updateSensitivity = () => {
            ahRow.sensitive = (settings.get_string('mode') === 'floating');
        };
        updateSensitivity();
        settings.connect('changed::mode', updateSensitivity);
    }
}