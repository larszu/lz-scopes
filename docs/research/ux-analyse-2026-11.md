# lz-scopes · UX-Analyse (Branch feat/profi-feedback-11, 15.11.2026)

Gattung: Werkzeug (lzm-web §0). Die Messflächen bleiben unangetastet. Fotos liegen im selben Ordner (`00`–`08-*.png`, 1440×900, DPR 2).

## 1 · Quellen anlegen, Geräte-Erkennung

**P1 · Elf gleichrangige Knöpfe, DeckLink doppelt.** Die Leiste „+ Quelle“ zeigt Testbild, RTSP/Netz, Resolve, DeckLink, AJA, Kamera, Bildschirm, Datei, Datei im Browser, Ordner, Audio und Aufnahme ungeordnet (`main.ts:918–932`, Foto 01). In der RTSP-Karte gibt es noch einmal `Gerät… DeckLink… AJA… NDI… Ordner…` (`main.ts:560`, Foto 02b), und der Menütitel nennt „RTSP, SRT, HLS, NDI, DeckLink, AJA“ (`i18n/de/menu.ts:9`). Der Kamera-Hinweis verweist sogar auf „RTSP / Netz → DeckLink…“ (`i18n/de/main.ts:152`). Das ist die Kritik aus #221.
→ **Änderung:** Den Knopf „+ Quelle“ öffnet ein Popover mit drei Gruppen: **Geräte** (erkannt: DeckLink-, AJA- und NDI-Kanäle, USB-Capture, jeweils mit Status), **Netz** (RTSP/SRT/HLS per URL) und **Datei & Rechner** (Datei, Ordner, Bildschirm, Resolve, Testbild, Audio, Aufnahme). Die Gerätewahl wandert aus der RTSP-Karte heraus, die Karte enthält nur noch URL und Transport. „Datei im Browser“ wird eine Option der Dateikarte (gibt es schon als `fileRoute`, `main.ts:800`). **M**

**P2 · Keine automatische Erkennung.** Geräte erscheinen erst nach einem Klick auf `deckLinkButton`/`ajaButton`/`ndiButton` (`bridgeInputs.ts:68–246`). `deviceLive` (`main.ts:492`) reagiert nur auf Quellen, die schon angelegt sind.
→ **Änderung:** Beim Start und dann alle 5 s `/api/decklink`, `/api/aja`, `/api/ndi` und `/api/devices` abfragen. Erkannte Eingänge stehen als graue „Vorschlag“-Zeile über der Quellenliste: Gerätename, Eingang, Format, Knopf „Hinzufügen“. Automatisch hinzugefügt wird nichts, weil Analyse Last kostet. Ein Eingang mit Signal bekommt einen Punkt. **M**

**P3 · Die Quellenleiste rutscht nach unten.** Schon bei zwei Testbildern ist „+ Quelle“ aus dem Bild gescrollt (Foto 03). Die Karten sind ganz aufgeklappt: Wandlung, Matrix und Gamut stehen in jeder Karte.
→ **Änderung:** „+ Quelle“ wird ein fester Knopf im Kopf der Seitenleiste. Die Karten sind zugeklappt (Punkt, Nummer, Name, Format, ✕) und klappen per Klick auf. Wandlung, Matrix und Gamut kommen in ein `details` namens „Farbe“, so wie heute schon „CST / LUT“. **S**

## 2 · Mehrere Signale gleichzeitig

**P4 · Die Quellenwahl im Panelkopf schaltet alle Panels um.** `switchSource` (`main.ts:1456–1460`) setzt jedes nicht angeheftete Panel mit. So lief der Test: Panel 1 auf „2 Testbild 2“ gestellt, danach zeigten auch Panel 3 und 4 Quelle 2 (Foto 03 → 03b). Dazu kommen drei weitere Stellen:
- Die Steuer-API arbeitet schon pro Panel: `source.select` mit `panel` setzt nur dieses eine (`main.ts:2221–2226`). UI und API verhalten sich also verschieden.
- `addSource` und `deviceLive` ziehen ebenfalls alle nicht angehefteten Panels auf die neue Quelle (`main.ts:494`).
- Das 📌 ist im dunklen Modus fast unsichtbar (Foto 04) und fehlt, solange es nur eine Quelle gibt (`main.ts:1013`).

→ **Bedienmodell:**
1. Die Quellenwahl im Panelkopf ändert **nur dieses Panel**. `pin` entfällt und wird beim Laden alter Profile ignoriert.
2. Jede Quelle bekommt eine feste **Kennfarbe und Nummer**. Sie erscheint als Pill im Panelkopf (`● 2 Kamera B`), am Rand der Quellenkarte und als 2-px-Linie an der Tab-Oberkante. Die Farbe kommt aus einer festen Achterpalette, die sich von den Grafikfarben unterscheidet. Sie liegt nur im Rahmen, nie auf der Messfläche.
3. Befehl **„Alle Panels auf Quelle X“** an drei Stellen: im Menü der Quellen-Pill im Panelkopf (letzter Eintrag), im Kontextmenü der Quellenkarte und als Tastenkürzel ⌥1…⌥9. Normale Zifferntasten wählen weiter nur im fokussierten Panel. Die API bekommt `source.select` ohne `panel`, das gibt es schon.
4. Eine **neue Quelle** belegt nur Panels, die noch keine Quelle haben. Läuft ein Gerät an, wird nicht umgeschaltet. Stattdessen erscheint ein Toast „Kamera B ist live · Alle Panels darauf“.
5. **Ebenen „Kamera/Eingang“ (#217/#177):** Eine Kamera hat Eingänge (SDI-Haupt, Rücklauf, Datei), und eine Quelle bekommt optional `camera`. Im Panelkopf stehen dann zwei Ebenen: Kamera und darunter der Eingang. „Durchschalten“ wechselt die Kamera und behält Eingangsart und Scope. Das ist die Grundlage für den Multiviewer-Split aus #217. Bis dahin genügt die flache Liste mit Farbe. **L**

## 3 · Auffindbarkeit von Panel-Einstellungen und Overlays

**P5 · Falschfarben stehen doppelt.** Die Overlays sind jetzt Einträge der Scope-Liste („Bild: Falschfarben“ …, im Test geprüft). Das ⚙ zeigt aber weiter eine eigene Auswahl „Overlay“ (`main.ts:1376`, Foto 05). Der Hilfetext sagt noch „im ⚙ Overlay ‚Zebra‘“ (`i18n/de/help.ts:19`) und widerspricht damit dem neuen Weg.
→ **Änderung:** Die Auswahl „Overlay“ im ⚙ entfällt. Im ⚙ bleiben nur die Parameter des gewählten Overlays (Palette, Zebra-Pegel), die `main.ts:1410` schon zeigt. `help.picture.try/read` werden in de und en angepasst. **S**

**P6 · Das ⚙ ist ein unbeschriftetes Glyph unter mehreren.** ? ⚙ ⤢ stehen ganz rechts im Panelkopf, klein und gleich grau (Foto 04). Der Kopf ist doppelt: Der Dock-Tab „1 · Bild ✕“ und die Kopfzeile „Bild ▾“ nennen dasselbe (Foto 03).
→ **Änderung:** Tab und Panelkopf werden zu **einer Zeile** zusammengelegt: links Scope-Auswahl und Quellen-Pill, rechts ⚙ mit Text „Einstellungen“ ab 360 px Panelbreite (Container-Query `panel`, gibt es schon), dazu ? und ⤢. Ein Rechtsklick auf den Panelkopf öffnet dasselbe Popover. Rechtsklick auf die Messfläche bleibt „Messpunkt löschen“. **M**

**P7 · Die Hilfekarte ist sehr lang** (Foto 06). Sie füllt das Panel und zählt „0 von 48 Aufgaben“. Das ist leise Gamification und erlaubt. Die Karte verdeckt aber die Messfläche, die sie erklärt.
→ **Änderung:** Die Karte zeigt zuerst nur zwei Sätze, „So liest man es“ und „Ausprobieren“ klappen auf. Die Karte öffnet sich neben dem Panel (`place()` kann das schon) statt darüber. **S**

## 4 · Kopfleiste, Layouts, Dichte, lzm-web

**P8 · Die Kopfleiste ist voll und gleichförmig** (Foto 01). Sieben Layout-Knöpfe, „+ Panel“, eine 270 px breite Skala „%“ als lange Select, „Alle aufnehmen“, „Einfrieren“, ⚙ und ⛶ sind alle gleich gewichtet. Die Skala braucht keine 270 px.
→ **Änderung:** Die Layouts werden ein Segment mit Icons und Tooltip (1, 1+1, 2×2 …) plus „Colorist“. Die Skala wird ein kompaktes Segment `% · bit · nits · Blende`. Aufnehmen und Einfrieren rücken als Paar nach rechts. „Einfrieren“ bekommt im Zustand an einen Akzent. **S**

**P9 · Der Hausstil fehlt.** Die Rundung ist im neutralen Skin `--radius: 2px` (`ui/tokens.css:93`), die Steuerhöhe `--control-h: 24px` (`:56`). lzm-web verlangt `--radius-s 6 / m 10 / l 20` und ≥ 32 px Klickfläche am Desktop. Die Kopf-Overline „QUELLEN“ ist in Versalien gesetzt, das ist erlaubt. Die Haarlinie um jede Karte ist zu viel Rahmen. Die primären Knöpfe („Verbinden“, „Ausgeben“) sind im dunklen Modus hellgrau gefüllt statt im Akzent (Foto 02b, 03). Einen sichtbaren Hell/Dunkel-Umschalter gibt es nur im Einstellungsfenster. Der helle Modus funktioniert und lässt die Messflächen schwarz (Foto 07), das ist richtig so.
→ **Änderung:** Neue Tokens `--radius-s/m/l` und `--control-h: 28px` mit 32-px-Trefferfläche über Padding. Karten bekommen eine Fläche statt einer Linie. Primärknöpfe nehmen `--accent`. In die Kopfleiste kommt das Segment Auto · Hell · Dunkel. Alles gilt nur für `.bar`, `.side`, `.phead`, Popover und Dialoge. `.body` mit den Canvas und `--scope-bg` bleiben, wie sie sind. Für das Testbild der Theme-Tests (`test/theme.test.ts`) müssen die Rundungswerte nachgezogen werden. **M**

**P10 · Dichte bei 1024 px** (Foto 08). Die Seitenleiste nimmt fast ein Drittel ein.
→ **Änderung:** Zugeklappte Karten (P3) und eine Seitenleiste mit 280 px statt rund 330 px. **S**

## 5 · Zoom- und Gestenhinweise

**P11 · Der Zoom bleibt unentdeckt.** Rad/Pinch, ⇧-Ziehen und Doppelklick werden nur im `title` des Zoom-Chips erklärt (`i18n/de/scope.ts:102`). Der Chip erscheint aber erst, *nachdem* gezoomt wurde (`main.ts:977`). Doppelklick bedeutet je nach Zustand „zurücksetzen“ oder „Solo“ (`main.ts:983`), das ist doppelt belegt und nicht sichtbar.
→ **Änderung:**
- Einmaliger Hinweis-Chip unten rechts in jedem Scope-Panel, solange noch nie gezoomt wurde: „Rad = Zoom · ⇧ ziehen = schieben“. Nach dem ersten Zoom verschwindet er dauerhaft (localStorage, wie bei `help.done`).
- Solo nur noch über ⤢ und den Doppelklick auf den Kopf. Der Doppelklick in die Messfläche setzt nur den Zoom zurück.
- Auf Touch zeigt der Chip „Pinch = Zoom“.

**S**

## Top 8 für die Umsetzung

1. **Quellenwahl pro Panel** (P4, Punkte 1, 3, 4): `switchSource` setzt nur das eigene Panel, Befehl „Alle Panels auf Quelle X“ dazu, `addSource`/`deviceLive` schalten nicht mehr um. **S–M**
2. **Kennfarbe und Nummer je Quelle** in Panelkopf, Tab-Kante und Karte (P4.2). **S**
3. **Overlay-Auswahl im ⚙ entfernen**, Hilfetexte angleichen (P5). **S**
4. **„+ Quelle“ als gruppiertes Popover** (Geräte / Netz / Datei & Rechner), Gerätewahl raus aus der RTSP-Karte (P1, #221). **M**
5. **Automatische Geräteerkennung** als Vorschlagszeile (P2, #221). **M**
6. **Ein Panelkopf statt zwei**, ⚙ beschriftet, Rechtsklick auf den Kopf (P6). **M**
7. **Zugeklappte Quellenkarten** mit fester „+ Quelle“-Leiste oben (P3, P10). **S**
8. **lzm-web-Tokens** für den Rahmen: Rundung, 28/32 px, Akzent-Primärknopf, Hell/Dunkel-Segment, Gesten-Hinweischip (P9, P11). **M**

Danach folgen die Ebenen Kamera/Eingang (#217/#177, **L**), aufbauend auf 1 und 2.
