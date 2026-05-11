// Prosty Panel — i18n.js
// Helper tłumaczeń dla kontekstu powłoki (extension.js i pliki pochodne).
// W kontekście preferencji używaj this.gettext() z ExtensionPreferences.

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

/**
 * Zwraca przetłumaczony ciąg znaków.
 * Jeśli tłumaczenie jest niedostępne, zwraca oryginalny ciąg (angielski fallback).
 *
 * Użycie: import { _ } from './i18n.js';
 *         const label = _('Power Options');
 */
export function _(str) {
    try {
        return Extension.lookupByURL(import.meta.url)?.gettext(str) ?? str;
    } catch (_e) {
        return str;
    }
}
