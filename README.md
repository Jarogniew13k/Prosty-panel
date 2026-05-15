
# Prosty Panel 
<img width="2560" height="1440" alt="Zrzut ekranu z 2026-04-30 12-49-02" src="https://github.com/user-attachments/assets/97addf52-dff6-4666-92bb-4b562e13a873" />
<img width="2560" height="1440" alt="Zrzut ekranu z 2026-05-11 22-25-38" src="https://github.com/user-attachments/assets/9e3f4fba-f93e-4d74-8009-f020532144e8" />

Czysty, funkcjonalny pasek zadań na dole ekranu dla GNOME Shell.  
Łączy w sobie najpotrzebniejsze elementy – ikony aplikacji, tacę systemową, zegar i przycisk Aktywności.  
Działa od razu po instalacji, a ustawienia są minimalistyczne – żadnych zbędnych opcji. Posiada własny, lekki backend tacy systemowej i dba o minimalne zużycie pamięci.

---

## Funkcje

| Funkcja | Opis |
|---------|------|
| **Tryb klasyczny** | Pasek przyklejony do krawędzi, rezerwuje miejsce (okna go nie zasłaniają). |
| **Tryb pływający** | Pasek unosi się nad pulpitem (margines 8 px, zaokrąglone rogi, rozmycie tła). |
| **Auto-ukrywanie (pływający)** | Pasek znika przy nachodzeniu okna i pojawia się przy krawędzi (1 px) lub po najechaniu. |
| **Inteligentne wykrywanie** | Rozszerzone strefy, blokada w fullscreen, płynne animacje. Obejścia dla restrykcji Waylanda. |
| **Przycisk Aktywności** | Otwiera GNOME Overview; pasek widoczny także w tym widoku. Opcje zasilania pod PPM. |
| **Ikony aplikacji** | Ulubione + uruchomione, precyzyjne wskaźniki aktywności, podgląd okien. |
| **Menu kontekstowe** | PPM: Otwórz, Nowe okno, Przypnij/Odepnij, Zamknij. |
| **Przeciąganie ikon** | Zmiana kolejności, przypinanie i odpinanie (Drag & Drop). |
| **Zaawansowany Status** | Obsługa nagrywania ekranu, udostępniania, aplikacji w tle oraz układu klawiatury. |
| **Taca systemowa** | Zoptymalizowany popup SNI po D-Bus (Discord, Steam itd.) bez zewnętrznych zależności. |
| **Grupa systemowa** | Szybkie ustawienia GNOME (Wi-Fi, dźwięk, Bluetooth, VPN itd.). |
| **Zegar** | Data + powiadomienia (wskazanie kropką). |
| **Motywy** | 8 wbudowanych schematów kolorów (m.in. Cyberpunk, Dracula, Gruvbox, Nordic). |
| **Tłumaczenia (i18n)** | Obsługa wielu języków poprzez standard gettext. |

---

## Wymagania

- GNOME Shell 45–50
- GJS
- Pakiet `gettext` (do kompilacji tłumaczeń podczas instalacji)

---

## Instalacja

### Metoda 1 - skrypt (zalecana)
Skrypt automatycznie skompiluje schematy GSettings oraz pliki językowe `.po` na `.mo`. Uruchom:
```bash
chmod +x install.sh
./install.sh
```

### Metoda 2 - ręczna
```bash
UUID="gnome-panel@user.local"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$DEST"
cp -r metadata.json extension.js stylesheet.css prefs.js *.js Języki schemas "$DEST/"
glib-compile-schemas "$DEST/schemas/"

gnome-extensions enable "$UUID"
```

---

## Po instalacji

- Wayland: wyloguj się i zaloguj ponownie  
- X11: Alt + F2 → r → Enter  

---

## Konfiguracja

```bash
gnome-extensions prefs gnome-panel@user.local
```

Opcje:
-Tryb: klasyczny / pływający

-Auto-ukrywanie (dostępne tylko dla trybu pływającego)

-Motyw (aplikowany natychmiast)

---

## Znane ograniczenia i porady

Aplikacje z Wine/Lutris w tacy systemowej: Jeśli ikony aplikacji emulowanych przez Wine otwierają się jako osobne, małe okienka na pulpicie (zamiast pojawić się w panelu), wynika to z faktu, że Wine używa przestarzałego standardu XEmbed. Aby temu zaradzić, zainstaluj i uruchom w tle program xembed-sni-proxy, który przetłumaczy je na nowoczesny standard SNI obsługiwany przez ten panel.

---

## Odinstalowanie

```bash
gnome-extensions disable gnome-panel@user.local
rm -rf ~/.local/share/gnome-shell/extensions/gnome-panel@user.local
```

---

## 👏 Podziękowania (Credits)

Ten projekt czerpie garściami z pracy społeczności Open Source. Chciałbym z tego miejsca podziękować twórcom wspaniałych rozszerzeń:

* **[Dash to Panel](https://github.com/home-sweet-gnome/dash-to-panel)** – logika inteligentnego ukrywania paska (Intellihide) oraz mechanizm wykrywania kolizji z oknami (Proximity) w tym projekcie bazują bezpośrednio na zmodyfikowanym kodzie źródłowym Dash to Panel.
* **[Dash to Dock](https://github.com/micheleg/dash-to-dock)** – za ogromną inspirację do stworzenia trybu pływającego (Float) oraz ogólnego podejścia do zarządzania paskiem zadań w środowisku GNOME.
* **[AppIndicator and KStatusNotifierItem Support](https://github.com/ubuntu/gnome-shell-extension-appindicator)** – kod tego oficjalnego rozszerzenia posłużył jako nieocenione źródło wiedzy i inspiracji przy budowie naszego modułu tacy systemowej.
---

## Licencja

GPL-2.0-or-later
