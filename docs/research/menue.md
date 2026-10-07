# Menü und Einstellungen (#53)

Stand 06.10.2026. Frage: Wo gehören die globalen Einstellungen hin, die bisher hinter „⚙ sRGB auto“ in der Kopfleiste, in der Seitenleiste (Bridge, Tastatur) und als Einzelknöpfe (LED-Wand, PNG, Layouts, Ausgabe) verteilt waren?

## Quellen (geöffnet)

- **Apple HIG, The menu bar** (developer.apple.com/design/human-interface-guidelines/the-menu-bar, JSON-Fassung gelesen): Reihenfolge *App-Name, File, Edit, Format, View, app-spezifische Menüs, Window, Help*. App-Menü: *About* zuerst und allein in einer Gruppe, dann *Settings…* („Use only for app-level settings“), Services, Hide, Quit. „Always show the same set of menu items … disable the action instead of hiding it.“ „Prefer short, one-word menu titles.“ Standard-Tastenkürzel unterstützen, eigene nur wenn nötig.
- **Microsoft Learn, Menu flyout and menu bar** (learn.microsoft.com/en-us/windows/apps/design/controls/menus): Menüleiste „typically position[ed] at the top of the app window“; Beispiel-Struktur File/Edit/View/Help; Toggle- und Radio-Einträge für Ein/Aus bzw. exklusive Wahl.
- **OBS Studio, Overview** (obsproject.com/kb/obs-studio-overview): ein Einstellungsfenster mit Rubriken *General, Stream, Output, Audio, Video, Hotkeys, Advanced*. Wie es geöffnet wird, steht dort nicht.
- **ScopeBox, Application Overview** (docs.hedge.video/scopebox/application-overview): Hauptfenster = Palettenfläche + Seitenleiste mit Quellen- und Paletteneinstellungen; „Click the gear icon in the upper right corner of any palette to access its settings“; Seitenleiste per ⌘[ ausblendbar.
- **Nobe OmniScope** (docs.timeinpixels.com/nobe-omniscope/layouts, …/settings-and-preferences): Layouts werden „from the Layout menu, keyboard shortcut and even with a Stream Deck action“ gespeichert und geladen; die Einstellungsseite listet Rubriken (Tastenkürzel, Auto-Connect, Leistung, Fenster, Energie, Werkseinstellungen, Updater), ohne den Aufbau zu beschreiben.
- DaVinci Resolve: Handbuch nicht geöffnet, daher hier kein Beleg.

## Entscheidung

1. **Desktop-App: native Anwendungsmenüleiste.** macOS: App-Menü (Über, Einstellungen … ⌘,, Dienste, Ausblenden, Beenden), dann *Datei, Bearbeiten, Ansicht, Quellen, Scopes, Ausgabe, Fenster, Hilfe* – die HIG-Reihenfolge, app-spezifische Menüs zwischen Ansicht und Fenster. *Bearbeiten* ist nötig, damit Kopieren/Einsetzen in Eingabefeldern unter macOS funktioniert. Windows/Linux: dieselbe Leiste sichtbar im Fenster (`autoHideMenuBar: false`), *Einstellungen …* unter *Datei* mit Strg+,, *Über* unter *Hilfe*.
2. **Browser/Pages: Menüleiste links oben in der Kopfleiste**, dieselbe Struktur aus demselben Modell (`src/menu/appMenu.ts`), Tastaturbedienung nach dem WAI-ARIA-Menubar-Muster (Alt+F10, Pfeile, Esc). Unter 900 px Breite klappt sie hinter ☰ an derselben Stelle zusammen.
3. **Ein Einstellungsfenster** (Muster OBS, macOS „Settings…“): Rubriken Oberfläche, Display, Scopes, Messpunkt/CST, Latenz, Uhr/Timecode, Bridge/ffmpeg, Audio, Tastatur, Über/Lizenzen. Zusätzlich ⚙ rechts oben in der Kopfleiste, weil Browser-Nutzer dort suchen.
4. **Panel-⚙ bleibt für Panel-Spezifisches** (Muster ScopeBox). Uhr- und Audio-Optionen sind je Panel; deren Rubriken erklären das und führen zum Panel bzw. Tongenerator.
5. **Kopfleiste**: Marke, Menü, Seitenleiste, Layout-Vorlagen, Skala, fps, Einfrieren, Einstellungen, Vollbild. LED-Wand, PNG, Layouts und Ausgabe stehen in den Menüs (Ausgabe → LED-Wand …, Datei → Screenshot, Datei → Layouts …, Ausgabe → Ausgabe öffnen …). Keine Funktion entfällt.
6. **Einzeltasten** (F, S, B, 1–6, Leertaste, C) stehen im Menü nur als Anzeige; registriert würden sie in Eingabefeldern das Tippen verschlucken. Die Tastatur-Rubrik und *Hilfe → Tastenkürzel* zeigen dieselbe Liste (`src/menu/shortcuts.ts`).
7. **Erweiterbar ohne main.ts**: `registerSettingsSection` / `extendSettingsSection` (src/menu/settings.ts) und `registerMenuCommand` (src/menu/appMenu.ts) für andere Module (Uhr, LED, Testbilder). Die Resolve-Anleitung (#78) hat einen Hilfe-Eintrag; er zeigt auf das Issue, bis die Datei auf main liegt (Link dann in `GUIDES` ändern).

## Offen / ungeprüft

- Native Menüleiste unter Windows und Linux nur über die E2E-Tests (Linux, xvfb) geprüft, nicht von Hand.
- Im Browser kann Strg+, bzw. ⌘, vom Browser selbst belegt sein; dann über ⚙ oder Datei → Einstellungen.
