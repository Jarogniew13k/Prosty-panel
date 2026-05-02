#!/usr/bin/env bash
# Gnome Bottom Panel — instalator (v2.3 Standalone)

set -e
UUID="gnome-panel@user.local"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "── Gnome Bottom Panel installer ──"

mkdir -p "$DEST"

# Kopiujemy wszystko (w tym appindicator-backend.js i podfoldery)
cp -r ./* "$DEST/"

# Kompilacja schem
if command -v glib-compile-schemas &>/dev/null; then
    glib-compile-schemas "$DEST/schemas/"
    echo "✓ Schemy skompilowane"
else
    echo "BŁĄD: brak glib-compile-schemas"
    exit 1
fi

echo "✓ Rozszerzenie zainstalowane w: $DEST"
echo "CRITICAL: Na Waylandzie MUSISZ SIĘ WYLOGOWAĆ, aby odświeżyć klucze GSettings!"