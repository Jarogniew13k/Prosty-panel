#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════
#  Gnome Bottom Panel — instalator
#  Obsługuje GNOME Shell 45, 46, 47, 48, 49
# ══════════════════════════════════════════════════════════

set -e

UUID="gnome-panel@user.local"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "── Gnome Bottom Panel installer ──"

# Sprawdź wersję GNOME Shell
GNOME_VER=$(gnome-shell --version 2>/dev/null | grep -oP '\d+' | head -1)
echo "Wykryta wersja GNOME Shell: $GNOME_VER"

if [ -z "$GNOME_VER" ] || [ "$GNOME_VER" -lt 45 ]; then
    echo "UWAGA: To rozszerzenie wymaga GNOME Shell 45 lub nowszego."
    echo "Twoja wersja: ${GNOME_VER:-nieznana}"
    exit 1
fi

# Utwórz katalog
mkdir -p "$DEST"

# Skopiuj pliki — wszystkie .js, .json, .css, .md
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/metadata.json"     "$DEST/"
cp "$SCRIPT_DIR/stylesheet.css"    "$DEST/"
cp "$SCRIPT_DIR/README.md"         "$DEST/" 2>/dev/null || true

# Wszystkie moduły JavaScript
cp "$SCRIPT_DIR/extension.js"      "$DEST/"
cp "$SCRIPT_DIR/prefs.js"          "$DEST/"
cp "$SCRIPT_DIR/classicpanel.js"   "$DEST/"
cp "$SCRIPT_DIR/floatpanel.js"     "$DEST/"
cp "$SCRIPT_DIR/intellihide.js"    "$DEST/"
cp "$SCRIPT_DIR/constants.js"      "$DEST/"
cp "$SCRIPT_DIR/utils.js"          "$DEST/"
cp "$SCRIPT_DIR/appbutton.js"      "$DEST/"
cp "$SCRIPT_DIR/apps-list.js"      "$DEST/"
cp "$SCRIPT_DIR/activities.js"     "$DEST/"
cp "$SCRIPT_DIR/clock.js"          "$DEST/"
cp "$SCRIPT_DIR/system-group.js"   "$DEST/"
cp "$SCRIPT_DIR/tray-popup.js"     "$DEST/"
cp "$SCRIPT_DIR/extra-status.js"   "$DEST/" # 🟢 DODANO NOWY PLIK

# Schemy + lokalna kompilacja
mkdir -p "$DEST/schemas"
cp "$SCRIPT_DIR/schemas/"*.gschema.xml "$DEST/schemas/"
if command -v glib-compile-schemas &>/dev/null; then
    glib-compile-schemas "$DEST/schemas/"
    echo "✓ Schemy skompilowane"
else
    echo "BŁĄD: brak glib-compile-schemas — zainstaluj pakiet glib2 / libglib2.0-bin"
    exit 1
fi

echo "✓ Pliki skopiowane do: $DEST"

# Włącz rozszerzenie
if command -v gnome-extensions &>/dev/null; then
    gnome-extensions enable "$UUID" 2>/dev/null && \
        echo "✓ Rozszerzenie włączone przez CLI" || \
        echo "  (Włącz ręcznie przez GNOME Extensions lub Extensions Manager)"
else
    echo "  Zainstaluj 'gnome-shell-extension-prefs' i włącz rozszerzenie ręcznie."
fi

echo ""
echo "══════════════════════════════════════════════"
echo "  Jeśli GNOME jest już uruchomiony:"
echo "  • Na Waylandzie: wyloguj się i zaloguj ponownie"
echo "  • Na X11:        naciśnij Alt+F2, wpisz 'r', Enter"
echo "  Ustawienia: gnome-extensions prefs $UUID"
echo "══════════════════════════════════════════════"
