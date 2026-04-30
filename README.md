# Prosty Panel 
<img width="2560" height="1440" alt="Zrzut ekranu z 2026-04-30 12-49-02" src="https://github.com/user-attachments/assets/97addf52-dff6-4666-92bb-4b562e13a873" />

Czysty, funkcjonalny pasek zadań na dole ekranu dla GNOME Shell.  
Łączy w sobie najpotrzebniejsze elementy – ikony aplikacji, tacę systemową, zegar i przycisk Aktywności.  
Działa od razu po instalacji, a ustawienia są minimalistyczne – żadnych zbędnych opcji.

---

## Funkcje

| Funkcja | Opis |
|---------|------|
| **Tryb klasyczny** | Pasek przyklejony do krawędzi, rezerwuje miejsce (okna go nie zasłaniają). |
| **Tryb pływający** | Pasek unosi się nad pulpitem (margines 8 px, zaokrąglone rogi, rozmycie tła). |
| **Auto-ukrywanie (pływający)** | Pasek znika przy nachodzeniu okna i pojawia się przy krawędzi (1 px) lub po najechaniu. |
| **Inteligentne wykrywanie** | Rozszerzone strefy, blokada w fullscreen, płynne animacje. |
| **Przycisk Aktywności** | Otwiera GNOME Overview; pasek widoczny także w tym widoku. |
| **Ikony aplikacji** | Ulubione + uruchomione, wskaźniki aktywności. |
| **Menu kontekstowe** | PPM: Otwórz, Nowe okno, Przypnij/Odepnij, Zamknij. |
| **Przeciąganie ikon** | Zmiana kolejności i odpinanie. |
| **Taca systemowa** | Popup z AppIndicator (Discord, Steam itd.). |
| **Grupa systemowa** | Szybkie ustawienia GNOME (Wi-Fi, dźwięk itd.). |
| **Zegar** | Data + powiadomienia. |
| **Motywy** | Gotowe schematy kolorów. |
| **Wayland** | disable-unredirect zapobiega znikaniu paska. |

---

## Wymagania

- GNOME Shell 45–48+
- GJS
- PulseAudio lub PipeWire

---

## Instalacja

### Metoda 1 - skrypt (zalecana)
Uruchom:
```bash
chmod +x install.sh
./install.sh
```

### Metoda 2 - ręczna
```bash
UUID="gnome-panel@user.local"
DEST="$HOME/.local/share/gnome-shell/extensions/$UUID"

mkdir -p "$DEST"
cp metadata.json extension.js stylesheet.css prefs.js *.js "$DEST/"

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
- Tryb: klasyczny / pływający  
- Auto-ukrywanie  
- disable-unredirect 
- Motyw  

---

## Odinstalowanie

```bash
gnome-extensions disable gnome-panel@user.local
rm -rf ~/.local/share/gnome-shell/extensions/gnome-panel@user.local
```

---

## Jak działa

- Pasek dodawany do Main.layoutManager  
- Klasyczny: affectsStruts  
- Pływający: disable-unredirect  
- Auto-hide: targetBox + strefy  
- Fullscreen: brak reakcji  
- Overview: pasek widoczny  

---

## 👏 Podziękowania (Credits)

Ten projekt czerpie garściami z niesamowitej pracy społeczności Open Source. Chciałbym z tego miejsca podziękować twórcom wspaniałych rozszerzeń:

* **[Dash to Panel](https://github.com/home-sweet-gnome/dash-to-panel)** – logika inteligentnego ukrywania paska (Intellihide) oraz mechanizm wykrywania kolizji z oknami (Proximity) w tym projekcie bazują bezpośrednio na zmodyfikowanym kodzie źródłowym Dash to Panel.
* **[Dash to Dock](https://github.com/micheleg/dash-to-dock)** – za ogromną inspirację do stworzenia trybu pływającego (Float) oraz ogólnego podejścia do zarządzania paskiem zadań w środowisku GNOME.

---

## Licencja

GPL-2.0-or-later
