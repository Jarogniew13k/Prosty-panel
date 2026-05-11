#!/usr/bin/env bash
# Gnome Bottom Panel — instalator (v2.4 z obsługą tłumaczeń gettext)

set -e
UUID="gnome-panel@user.local"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "── Gnome Bottom Panel installer ──"

mkdir -p "$DEST"

# Kopiujemy wszystko (w tym folder Języki i podfoldery)
cp -r ./* "$DEST/"

# ── Kompilacja schematów GSettings ──────────────────────────
if command -v glib-compile-schemas &>/dev/null; then
    glib-compile-schemas "$DEST/schemas/"
    echo "✓ Schematy skompilowane"
else
    echo "BŁĄD: brak glib-compile-schemas"
    exit 1
fi

# ── Kompilacja tłumaczeń gettext ────────────────────────────
# Pliki źródłowe .po leżą w Języki/<język>.po
# Skompilowane .mo trafiają do locale/<język>/LC_MESSAGES/gnome-panel.mo
# zgodnie ze standardem GNOME (Extension.initTranslations() szuka w locale/).

if command -v msgfmt &>/dev/null; then
    LANG_DIR="$DEST/Języki"
    shopt -s nullglob
    PO_FILES=("$LANG_DIR"/*.po)
    shopt -u nullglob

    if [ ${#PO_FILES[@]} -eq 0 ]; then
        echo "OSTRZEŻENIE: brak plików .po w $LANG_DIR — tłumaczenia pominięte"
    else
        for po in "${PO_FILES[@]}"; do
            lang=$(basename "$po" .po)
            mo_dir="$DEST/locale/$lang/LC_MESSAGES"
            mkdir -p "$mo_dir"
            msgfmt -o "$mo_dir/gnome-panel.mo" "$po"
            echo "  ✓ Skompilowano: $lang → locale/$lang/LC_MESSAGES/gnome-panel.mo"
        done
        echo "✓ Tłumaczenia skompilowane"
    fi
else
    echo "OSTRZEŻENIE: brak msgfmt (pakiet gettext) — tłumaczenia nie zostaną skompilowane."
    echo "  Zainstaluj: sudo apt install gettext  LUB  sudo dnf install gettext"
    echo "  Następnie uruchom install.sh ponownie."
fi

echo ""
echo "✓ Rozszerzenie zainstalowane w: $DEST"
echo "WAŻNE: Na Waylandzie MUSISZ SIĘ WYLOGOWAĆ, aby odświeżyć klucze GSettings!"
echo "       Tłumaczenia zadziałają po ponownym zalogowaniu."
