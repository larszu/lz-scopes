<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lzm_hauptlogo_offwhite.svg" />
    <img src="docs/brand/lzm_hauptlogo_navy.svg" alt="Lars Zumpe Medienproduktion" width="220" />
  </picture>
</p>

<h1 align="center">LZ Scopes</h1>

<p align="center">
  <b>Software-Messtechnik im Browser: Waveform, Parade, Vectorscope, Histogramm, CIE-Diagramm, Falschfarben und Messwerte, auch für RTSP-Streams.</b><br />
  Für macOS und Windows als Desktop-App oder direkt im Browser.
</p>

<p align="center">
  <a href="https://github.com/larszu/lz-scopes/releases/latest">
    <img src="https://img.shields.io/badge/Download-macOS%20%26%20Windows-1D324F?style=for-the-badge&logo=github&logoColor=white" alt="LZ Scopes für macOS und Windows herunterladen" height="40" />
  </a>
  &nbsp;
  <a href="https://larszu.github.io/lz-scopes/">
    <img src="https://img.shields.io/badge/Im%20Browser%20%C3%B6ffnen-Web--Fassung-5C6B85?style=for-the-badge" alt="Web-Fassung öffnen" height="40" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Plattform-macOS%20%7C%20Windows%20%7C%20Web-1D324F" alt="Plattformen" />
  <img src="https://img.shields.io/badge/Lizenz-propriet%C3%A4r%2C%20kostenlos%20nutzbar-5C6B85" alt="Lizenz" />
  <img src="https://img.shields.io/badge/node-%E2%89%A520-132040" alt="Node 20+" />
</p>

<p align="center"><sub><a href="README.md">English version</a></sub></p>

<p align="center">
  <img src="docs/screenshots/hero.png" alt="LZ Scopes: Bild, Luma-Waveform, Vectorscope, RGB-Parade, Histogramm und CIE-Diagramm in einem Fenster" width="860" />
</p>

Vorbilder: VMA Scope, Nobe OmniScope, HDRScopes, LiveScopes.tv, openrv-web.

## Screenshots

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/colorchecker.png" alt="Vier Panels mit ColorChecker" width="420" /><br /><b>ColorChecker, 2×2</b></td>
    <td width="50%" align="center"><img src="docs/screenshots/hdr-pq.png" alt="PQ-Graukeil mit Waveform in cd/m²" width="420" /><br /><b>HDR: PQ-Graukeil in cd/m²</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/lz-displaytest.png" alt="LZ Displaytestbild Gamma" width="420" /><br /><b>LZ Displaytestbilder</b></td>
    <td width="50%" align="center"><img src="docs/screenshots/gradbars.png" alt="Sättigungsverläufe im Vectorscope" width="420" /><br /><b>Sättigungsverläufe</b></td>
  </tr>
</table>

## Download und Installation

Installer im [neuesten Release](https://github.com/larszu/lz-scopes/releases/latest): macOS als Universal-`.dmg`/`.zip` (Apple Silicon und Intel), Windows als Installer und portable `.exe`. Die Desktop-App bringt Bridge und ein weitergebbares ffmpeg 9.0.2 mit (GPLv3, mit SRT; Lizenzen und Quelltext: [THIRD_PARTY.md](THIRD_PARTY.md)), RTSP, SRT und andere Netzwerkquellen funktionieren sofort, ohne System-ffmpeg. Welches ffmpeg läuft, steht unter *Bridge*. Die macOS-Builds sind ad-hoc signiert: beim ersten Start Rechtsklick, *Öffnen*.

**Web-Fassung:** <https://larszu.github.io/lz-scopes/>. Dort gehen Testbilder, Kamera, Bildschirm und Dateien. RTSP, SRT und andere Netzwerkstreams brauchen die Desktop-App oder `npm start`, weil ein Browser sie nicht öffnen kann.

**iPhone und iPad** (`ios/`, Capacitor): dieselbe App in einer nativen Hülle. Die CI baut sie und startet sie im iOS-Simulator; auf echten Geräten ist sie noch ungeprüft, im App Store oder per TestFlight gibt es sie noch nicht (dafür ist ein Apple-Developer-Konto nötig). Möglich sind Kamera, USB-C-Capture-Karten ab iPadOS 17, Dateien und der Opple über CoreBluetooth. Netzwerkstreams kommen von einer Bridge auf einem Rechner im selben Netz (`npm start -- --host 0.0.0.0`), die App findet sie per Bonjour. Siehe [docs/ios.md](docs/ios.md).

## Schnellstart

1. App starten. Die erste Quelle ist ein Testbild (SMPTE 75 %, Variante „(LZ)“ – deren Schwarzfeld lohnt einen Blick in die Waveform mit der Schwarz-Lupe), alle Panels folgen ihr.
2. Pro Panel eine andere Quelle wählen: *Testbild*, *Kamera*, *Bildschirm*, *Datei* oder *Stream*.
3. Für einen Stream die URL eintragen (z. B. `rtsp://user:pass@host:554/stream`) und verbinden.
4. Im Bild einen Rahmen ziehen, um nur diesen Bereich zu messen.
5. Fenster per Drag-and-drop anordnen und unter *Layouts* speichern.

## Aus dem Quelltext

```bash
npm install
npm run dev        # UI http://localhost:4191, Bridge auf 4192
# oder Produktion
npm run build && npm start   # alles auf http://127.0.0.1:4192
```

Für Netzwerkquellen ohne Desktop-App: `npm run ffmpeg:fetch` lädt dasselbe ffmpeg, das die App mitliefert (SHA-256-geprüft, nach `vendor/ffmpeg/`); sonst nimmt die Bridge `$FFMPEG` oder ein ffmpeg aus dem `PATH`. Ohne Bridge funktionieren nur Testbilder, Kamera, Bildschirm und Dateien.

## Quellen

| Quelle | Weg |
|---|---|
| `rtsp://`, `rtsps://`, `rtmp://`, `rtp://`, `udp://`, `srt://`, `tcp://`, `http(s)://` (auch HLS) | Bridge: ffprobe → ffmpeg → rohe RGBA-Frames per WebSocket |
| `test:bars`, `test:ramp`, `test:testsrc`, `test:colors` | Bridge: lavfi-Testbilder |
| Testbild-Generator (siehe unten) | direkt im Browser, auch als Ausgabefenster |
| Kamera, Bildschirm, Video-/Bilddatei | direkt im Browser |
| `device:` – Capture-Karten, die sich als Systemgerät melden (AVFoundation/DirectShow/V4L2) | Bridge: ffmpeg mit festem Modus, Rohformat (10 bit, wenn angeboten) und wählbarer Matrix; auch am entfernten Bridge-Rechner |
| `decklink:<n>` – Blackmagic DeckLink/UltraStudio | Bridge + eigener Helfer (DeckLink SDK, [helpers/decklink](helpers/decklink/README.md)); nur wenn gebaut und Desktop Video installiert, **mit Hardware ungeprüft** |
| `ndi:<Quelle>` – NDI® | Bridge + NDI-Helfer ([helpers/ndi](helpers/ndi/README.md)), lädt die vom Nutzer installierte NDI-Runtime ([ndi.video](https://ndi.video/)); UYVY bzw. 16 bit P216; nur im Loopback mit eigenem Testsender geprüft |
| `resolve:` – DaVinci Resolve (Studio, externes Scripting „Lokal“) | Bridge: gegradetes Bild über die Scripting-API in 16 bit; ein laufendes Resolve erscheint von selbst in der Quellenleiste („läuft: Projekt / Timeline – Verbinden“) |
| `folder:<Name>` – Watch-Ordner auf dem Bridge-Rechner (Exporte aus Lightroom, Capture One, Resolve) | Bridge: neuestes TIFF/DPX/PNG/JPEG/WebP/EXR in voller Tiefe; Ordner nur ausdrücklich freigegeben (`--watch-dir`, `LZS_WATCH_DIRS`, Desktop-App per Dialog) |

Mehrere Quellen gleichzeitig, jedes Panel wählt seine Quelle. Pro Stream einstellbar sind Analyseauflösung, Bildrate, 8 oder 16 bit (für 10-bit/HDR), RTSP über TCP oder UDP, Transfer, Matrix (709, 2020, 601 525 Zeilen/SMPTE-C, 601 625 Zeilen/EBU) und Gamut. „auto“ übernimmt die Stream-Metadaten (`bt470bg` → 625, `smpte170m` → 525).

- **Transfer**: SDR (BT.1886), PQ, HLG mit wählbarem Display-Spitzenwert Lw (500–10 000 cd/m², Presets nach EBU R 167; Systemgamma nach BT.2100 auf die Luminanz angewandt) und die **Kamera-Log-Kurven** ARRI LogC3/LogC4, Sony S-Log3, Panasonic V-Log, Blackmagic Film Gen 5, Canon Log 2/3, RED Log3G10, Fujifilm F-Log2, DJI D-Log, Nikon N-Log und Apple Log. Log wird nicht signalisiert und muss gewählt werden.
- **Gamut**: auto nimmt das Kamera-Gamut der Log-Kurve (AWG3/4, S-Gamut3.Cine, V-Gamut, BMD WG Gen5, Cinema Gamut, REDWideGamutRGB, D-Gamut, BT.2020 für F-/N-/Apple Log), sonst die Primaries der Matrix. S-Gamut3, DaVinci WG, ACES AP0/AP1 und P3 sind wählbar. Unterschiedliche Weißpunkte (ACES) werden per Bradford angepasst.
- **CST und LUTs je Quelle** (Karte „CST / LUT“): Farbraum-Transformation nach Rec.709, Rec.2020 PQ/HLG oder beliebigem Gamut/Transfer mit Bradford-Anpassung und Tone-Mapping (ACES-2.0-Tonescale, BT.2390-EETF, Reinhard erweitert, Clip), Kamera-Presets (Log → Rec.709), danach bis zu zwei LUTs (`.cube`, `.3dl`, `.spi3d`, `.spi1d`, `.csp`, tetraedrisch, per Drag & Drop auf die Karte, Umschalt = LUT 2). Jedes Panel misst wahlweise das Signal, nach der CST oder nach den LUTs (⚙ → Messpunkt, Taste `C` für den Standard); die Stufe steht im Panel-Kopf, auch wenn sie nichts anwendet. Hersteller-LUTs werden nicht mitgeliefert, die App verlinkt die offiziellen Download-Seiten ([docs/research/lut-cst.md](docs/research/lut-cst.md)).
- **Gamma**: BT.1886, Gamma 2,2/2,6/2,8, sRGB und linear sind wählbar. Erkannt wird die Kurve nur aus den Metadaten; fehlen sie, steht „nicht signalisiert, Annahme“ an der Quelle.
- Log wirkt in der Waveform-Skala „cd/m² / Szene“ (Szene-Reflexion in %, 18 % = Graukarte, Blendenschritte), im CIE-Diagramm, in der Bildansicht und bei den Vectorscope-Zielen (Rec.709-Balken in Kurve und Gamut der Quelle). Die Kurvenwerte gelten als 10-bit-Code/1023 im Narrow-Range-Signal, wie die Hersteller sie angeben.

## Scopes

- **Y′CbCr unbeschnitten und EBU R 103**: Bridge-Modus *16 bit Y′CbCr* liefert Y′CbCr 4:4:4 ohne Range-Wandlung, der Shader rechnet mit der Matrix der Quelle nach R′G′B′, Werte unter 0 % und über 100 % bleiben erhalten. R-103-v3.0-Prüfung mit Messfilter (1/16…1/16 × 1/4-1/2-1/4): Anteil außerhalb −5/105 % und außerhalb 4–1019 im Messwerte-Panel (Meldung ab 1 % der Fläche) und als Bild-Overlay „EBU R 103“. Testbilder BT.2111-3 (HLG narrow, PQ narrow, PQ full) und BT.814-PLUGE mit echten −2 % als 16-bit-Frames.
- **CRT-Look** je Scope (⚙ → Darstellung): Spur als analoger Strahl zwischen benachbarten Abtastwerten mit Gaußfleck (nach [woscope](https://github.com/m1el/woscope), MIT), Helligkeit fällt mit der Strahlgeschwindigkeit, Phosphor P31/P1/P7, Nachleuchten bis unendlich, Glow, Strahlbreite ([docs/research/crt-trace.md](docs/research/crt-trace.md)). Nur ein Look – die Pegel sind dieselben wie in der digitalen Darstellung.
- **Waveform** Luma, RGB-Overlay, RGB-, YRGB- und YCbCr-Parade, Bereich −7 … 110 %. Skala in %, 8 bit, 10 bit (Legal-Range-Codes) oder cd/m² (PQ absolut, HLG bezogen auf das eingestellte Lw, SDR nach BT.1886 mit 100 cd/m², Log als Szene-Reflexion). Marken nach BT.2408 bei HDR (75 % HLG bzw. 58 % PQ Referenzweiß, 38 % Graukarte) und 18 % Grau bei Log; die Grenzen −5/105 % nach EBU R 103 v3.0 lassen sich im ⚙ einblenden
- **Vectorscope** mit 75-%- und 100-%-Zielen passend zur Matrix (bei Log: 709-Balken in Kurve und Gamut der Quelle), Hautton-Linie, Zoom ×1/×2/×5, Spur optional in Bildfarbe
- **CIE-Diagramm** 1931 xy oder 1976 u′v′ (⚙) mit Spektralzug, Rec.709, P3-D65, Rec.2020, D65 und dem Gamut der Quelle
- **Histogramm** RGB, Luma, getrennt, linear oder log, mit Clipping-Anteil
- **Diamond (Gamut)** nach Tektronix: oben B′+G′ über B′−G′, unten −(R′+G′) über R′−G′; alles Legale liegt in beiden Rauten, ein Überschreiten zeigt sofort, welcher Kanal (Blau nur oben, Rot nur unten, Grün in beiden). Ohne den Tiefpass der Hardware-Geräte, kurze Überschwinger zählen also mit. Auch als CRT-Strahl
- **Zeitverlauf**: Farbe (Movie-Barcode), Farbton, Sättigung und Luma über die letzten 10 s bis 5 min; Nachleuchten (Spur) für Vectorscope, CIE, Diamond und 3D-Würfel
- **Farbziele und Farbabgleich (#55)**: Kunden-CI als Hex, RGB 8/10 bit oder Legal 16–235/64–940, gelesen als Videowert (Grafik-Workflow) oder als sRGB-Licht; aus Messpunkt, Messrahmen oder hochgeladenem Logo gepickt; in benannten Listen mit JSON-Export/-Import. Das Panel *Farbabgleich* vergleicht Messpunkt bzw. Rahmenmittel einer Quelle mit einem Ziel oder mit demselben Objekt in einer zweiten Kamera: Farbfelder nebeneinander fürs Display (sRGB/P3), ΔE00/ΔITP, ΔL/ΔC/ΔH, Farbton und Sättigung, dazu die Korrektur in Worten, Werten und Kamera-Begriffen (Multi-Matrix, Weißabgleich, Resolve). Messreihen für Effektlacke (mehrere Stellen bzw. Winkel). *Waveform Grüntöne*, Grün-Keil und Bild-Overlay für Rasen und Laub (BT.2408-Pegel als Vorgabe). Hex/RGB an jedem Messpunkt. Hintergrund: [docs/research/farbziele.md](docs/research/farbziele.md)
- **3D-Farbvolumen und ΔE**: Punktwolke im R′G′B′-Würfel, in CIELAB oder ICtCp mit Achsenskalen, drehbar per Ziehen, Zielgamut als Drahtgitter; ΔE 2000 (SDR) bzw. ΔE ITP (HDR) des Messpunkts gegen den nächsten Farbbalken oder ein eigenes Ziel. Weitere Kurven: Sony S-Log2, ACEScct, ARRI LogC3 für EI 160–1600 (ARRI-Whitepaper)
- **A/B-Vergleich und Gamut-Kompression** im Bild-Panel: Split, Wipe oder Differenz gegen einen anderen Messpunkt derselben Quelle (Signal / nach CST / nach LUT) oder eine andere Quelle; ACES-1.3-Reference-Gamut-Compression als Vorschau für Bild und Gamut-Warnung
- **Bild** mit Falschfarben (ARRI-Schema, RED „Video Mode“ nach docs.red.com, Sony-Paletten SDR und S-Log3 aus Monitor & Control; bis 12 Bänder), Zebra, Clipping-Anzeige, Luma und **Gamut-Warnung** (Pixel mit negativen Anteilen im Zielgamut 709/P3/2020, abgestuft nach der Distanz (max − c)/max). Ein Klick setzt einen Messpunkt, der zusätzlich in Waveform und Vectorscope markiert wird
- **Messwerte**: Quelle, Codec, Metadaten, Y' min/max/Mittel (bei HDR in cd/m²), Clipping je Kanal, verworfene Frames; bei PQ Content Light Level des Frames sowie **MaxCLL/MaxFALL** nach CTA-861.3 (max(R,G,B) je Pixel, auf den Analysepunkten, nur ganze Bilder, ⚙ setzt zurück)

**Anordnung:** Panels per Drag-and-drop am Tab verschieben, andocken, als Tabs stapeln und mit den Trennern skalieren (dockview, wie das Raster im multicam-planner). Die Vorlagen 1 bis 3×3 und „+ Panel“ dienen als Start. Ein Doppelklick vergrößert ein Panel, `Esc` holt es zurück.

**Einstellungen je Messwerkzeug** über das ⚙ in der Panel-Kopfzeile. **Layout-Konfigurationen** (Anordnung plus Einstellungen aller Scopes) werden unter *▦ Layouts* gespeichert, geladen und als JSON exportiert oder importiert.

**Quellen:** Wird die Quelle in einem Panel umgeschaltet, folgen alle Panels ohne 📌.

**Messrahmen:** Im Bild einen Rahmen ziehen; dieser Bereich leuchtet in allen Scopes hervor, und die Statistik gilt nur für ihn.

**Waveforms:**
- *Waveform Farbe* zeigt die Pixelfarben.
- *Waveform Hauttöne* zeigt Hauttöne in ihrer Quellfarbe, den Rest schwarz-weiß. Den Bereich stellt man ein, indem man die Linien zieht (Mausrad = Farbton-Toleranz) oder ihn „Aus Messrahmen“ übernimmt; das Vectorscope zeigt den Toleranzkeil.
- Parade, YRGB und RGB-Overlay wahlweise mono, in Kanalfarben oder in Bildfarben.

**Display-Farbraum** der Bildansicht wird automatisch erkannt (sRGB/P3, HDR-fähig) oder gewählt; die Scopes messen immer das Signal.

**HDR-Vorschau** (⚙ → HDR-Vorschau): HDR und Log zeigt die Bildansicht auf SDR-Displays per Display-Light-Down-Mapping in BT.2020. *BT.2408 hybrid-linear* (Standard): linear ×0,5 (BT.2408-8 § 5.2, SDR 100 cd/m² ≙ ≈ 203 cd/m²), die Lichter rollt die BT.2390-EETF (§ 5.4, je Kanal in PQ) in die 100-cd/m²-Spitze; HDR-Referenzweiß landet bei ≈ 93 % SDR (§ 7.1.3 nennt 86–95 %). *BT.2446 Methode A* (BT.2446-1 § 4.1, Tab. 2/3): 1000 → 100 cd/m² mit Farbkorrektur; Quellen über 1000 cd/m² bringt vorher die EETF auf 1000. Quellspitze: PQ 1000 cd/m² (Mastering, ohne Metadaten angenommen), HLG das eingestellte Lw, Log das Kurvenende.

**Videodateien** mit Playhead, Timecode, Start/Stopp, Frame ±1 und J/K/L wie in Resolve.

**Ausgaben** (*⧉ Ausgabe*): Gesamtansicht, einzelnes Panel, sauberes Quellbild oder Bild mit Scope-Overlay (auch auf Schwarz für den Luma-Key) auf einem Bildschirm dieses Rechners, optional als MJPEG-Stream (`/out/<name>.mjpeg`) oder per ffmpeg an RTMP/SRT/RTSP/UDP.

**Overlay-Szenen:** Das Overlay zeigt eine Szene aus beliebig vielen Scopes (Waveforms, Paraden, Vectorscope, CIE, Histogramm), jeder mit eigener Position, Größe, Deckkraft, Abdunklung des Bildes dahinter und wahlweise eigener Quelle. Im Ausgabefenster schaltet `E` den Bearbeiten-Modus ein: Scopes ziehen, an den Griffen skalieren, über die Leiste hinzufügen, umstellen oder entfernen (`Entf`), Pfeiltasten verschieben fein. Außerhalb des Bearbeitens gibt es weder Mauszeiger noch Griffe, und der Stream enthält die Bearbeitungsebene nie. Szenen werden im Ausgabe-Menü angelegt, kopiert, gewählt und gelöscht, bleiben gespeichert und sind Teil der Layout-Konfigurationen. Die Stream-Ausgabe eines Fensters zeigt dieselbe Szene.

Einfrieren, PNG-Export, Vollbild.

**Fernsteuerung** (Bitfocus Companion, curl): `POST /api/control` bzw. WebSocket `/control` an der Bridge; das Hauptfenster führt aus und meldet Quelle, Freeze, Clipping, Y′ min/max, Layout, Szene und Ausgaben zurück. Standardmäßig nur von 127.0.0.1, mit `LZS_CONTROL_TOKEN` auch aus dem Netz. Befehle und Beispiele: [docs/control-api.md](docs/control-api.md). Das Companion-Modul liegt in [`companion/`](companion).

**Tasten:** `1`–`6` Layout-Vorlage · `C` Messpunkt (Signal / nach CST / nach LUT) · `Leertaste` Play/Pause (Videodatei) bzw. Einfrieren · `←`/`→` Frame · `J`/`K`/`L` Shuttle · `F` Vollbild · `S` PNG · `B` Seitenleiste · `Esc` Vergrößerung beenden bzw. Messpunkt/Rahmen löschen · im Overlay-Ausgabefenster `E` Bearbeiten

## Testbilder

Die Quelle *Testbild* erzeugt die Muster selbst, in 720p bis 2160p oder in freier Auflösung (z. B. Wandauflösung einer LED-Wand). Rampen und Zonenplatte werden pixelgenau geschrieben, damit der Browser sie nicht dithert.

- **Vollfeld** Rot, Grün, Blau, Weiß, Grau 50 %, Grau 18 % (BT.709-OETF: 40,9 %), Schwarz
- **Grau** Verlauf, Verläufe W/R/G/B, 11 Graustufen, Graukeil in TE-165-Anordnung (lineare 10-%-Stufen), wandernder Verlauf, PLUGE nach ITU-R BT.814-4 (Streifen ±2 % = Codes 80/48, Positionen nach Tab. 4/5)
- **Geometrie** Schachbrett, Konvergenzgitter, Fadenkreuz, Kreisraster, Zonenplatte (auch bewegt), sichere Bereiche nach EBU R 95 (Action 3,5 %, Graphics 5 %, 4:3-Caption-Safe)
- **Farbe** SMPTE 75 % und 100 % mit PLUGE −2/0/+2/0/+4 % wie in BT.2111, EBU 100/0/75/0 und 100/0/100/0, Sättigungsverläufe, Farbkreis, ColorChecker (Näherung)
- **Animiert** Farbwechsel, Farbwechsel-Verlauf, dreigeteilt, bewegte Diagonalen, Regenbogenfluss, Chroma-Crawl
- **Testbild** mit Kreis, Balken, Frequenzgittern und Uhr
- **HDR** PQ-Graukeil 0–10 000 cd/m², HLG-Graukeil, PQ-Verlauf mit Referenzweiß 203, PLUGE nach BT.814-4 (Higher level 38,2 %) und Graukarte 38 % (BT.2408) jeweils für HLG und PQ; die Scopes schalten dabei automatisch auf PQ bzw. HLG
- **LZ Displaytest** die 20 Displaytestbilder (1920×1080) aus `Broadcast/displaytest`
- **LED-Wand** Cabinet-Raster mit ID (auch mit Modulraster), Pixel-Mapping (1-px-Gitter, Diagonale, R/G/B/W-Eckpixel je Cabinet), Scroll 1 px/Frame, Vollfeld mit freiem Pegel und Kanalwahl, feine Graustufen und Rampen für Low-Level, Shutter/Genlock mit Frame-Zähler, Moiré, Messfeld mit Patch-Sequenzer (u. a. Unreal-Sätze R/G/B/W und 5×5×5)
- **Eigene Bilder** über *+ Bilder*, gelten für die laufende Sitzung

Optional lässt sich eine Kennung einblenden. *⧉ Ausgeben* öffnet das Muster in einem eigenen Fenster (`?out=<id>&w=&h=&label=`) für Monitor, Beamer oder Capture: `←`/`→` wechseln, `F` Vollbild, `L` Label. In nativer Auflösung und im Vollbild wird 1:1 ausgegeben.

Grenze: Canvas arbeitet in Full-Range-RGB, deshalb gibt es keine Pegel unter 0 %. Die PLUGE-Stufen −2 % liegen dadurch auf 0 %.

### LED-Wand

*▦ LED-Wand* in der Kopfleiste: Wand- und Cabinet-Konfiguration (Cabinet-Pixel, Spalten/Reihen, Modulraster, Versatz, Zählung zeilen-/spaltenweise oder als Schlange; speicherbar), die LED-Testbilder in Wandauflösung und eine **relative Prüfung mit der Kamera**: Wandecken im Kamerabild anklicken, 4-Punkt-Entzerrung (Homographie), je Cabinet Median, Streuung und Farbabweichung (ΔCb/ΔCr) zum Wandmedian als Heatmap, Nahtprofile mit Kontrast je Cabinetgrenze, Mittelung mehrerer Bilder, Vorher/Nachher, Blickwinkelserie, Scan-Linien-Index (Zeilenprofil-Varianz zum Vergleich von Shutter und Genlock-Phase), Suche nach toten/hängenden Pixeln, Bericht als CSV und PNG. Dazu die 3×3-Kameramatrix nach dem Unreal-Verfahren (R/G/B/W-Felder, OCIO-Matrix). Mit dem Opple Light Master (siehe Lichtmesser) misst der Dialog außerdem je Cabinet über den Patch-Sequenzer (manuell bestätigt oder automatisch mit Einschwingzeit): Helligkeit, Δu′v′ und CCT zum Referenz-Cabinet als Karte, Weißpunkt Ist/Soll/Δ gegen D65, D50 oder eine Farbtemperatur mit Korrekturhinweisen je Prozessor (NovaLCT, NovaStar VX, Brompton Tessera mit Farbtemperatur-Vorschlag, DynaCal und OSCA) und Angleich-Werten je Cabinet an ein Referenz-Cabinet (aus gemessenen oder eingegebenen Primärvalenzen, mit Additivitätsprüfung) und Flimmern (Light Master 4); Bericht als gemeinsame CSV und PNG mit der Kamera-Auswertung. Der Light Master ist dabei ein Trendmessgerät, kein Kolorimeter für schmalbandige LEDs, und ohne Gerät ungeprüft (Recherche Teil C). Kalibriert wird die Wand im LED-Prozessor (Brompton, NovaStar, Colorlight); LZ Scopes schreibt keine Korrekturwerte, und eine Videokamera ist kein Kolorimeter. Die Auswertung ist mit synthetischen Bildern getestet, an einer echten Wand noch nicht erprobt. Recherche: [docs/research/led-wall-und-messgeraete.md](docs/research/led-wall-und-messgeraete.md).

## Audio

Messkern in `src/audio/dsp` (reines TypeScript, ohne DOM, in vitest gegen die Normtests geprüft). Normwerte und Quellen: [docs/research/audio.md](docs/research/audio.md).

**Quellen mit Ton**
- *RTSP / Netz*: Die Bridge liefert den Ton des Streams mit (Auswahl „Ton“ an der Quelle, [Protokoll 2](docs/frame-protocol.md)). Bild und Ton kommen aus demselben ffmpeg-Prozess, ohne Umrechnung von Abtastrate und Kanälen. Die Testbilder `test:*` bringen einen 1-kHz-Ton mit −18 dBFS mit.
- *Datei* (Video): Der Ton der Datei wird mitgemessen und ist nur mit 🎧 hörbar.
- *Audio*: Audiogerät im Browser (Echounterdrückung, Rauschunterdrückung und automatische Pegelregelung aus, Gerät wählbar: HDMI-Ton einer USB-Capture-Karte, Laptop-Mikrofon, USB-Interface, Dante Virtual Soundcard/Dante Via als Systemgerät – Chromium liefert höchstens 2 Kanäle), Audiogerät über die Bridge (ffmpeg liest alle Kanäle: `audio:avfoundation|dshow|alsa:<Name>`), Audiodatei (mit „Ganze Datei messen“, schneller als Echtzeit) oder der Generator als Rückweg.
- *Gerät…* an einer Netz-Quelle: Capture-Gerät über die Bridge, auf Wunsch mit Ton (`device:…#audio=<Name>`), Bild und Ton dann aus einem ffmpeg-Prozess.
- *Dante*: kein eigenes Dante-Protokoll (proprietär). Dante Virtual Soundcard oder Dante Via stellen Dante-Kanäle als normales Audiogerät bereit; Mehrkanal über den Bridge-Eingang. Mit echter Dante-Hardware ungeprüft.

Jede Quelle mit Ton zeigt eine ♪-Zeile: Abtastrate, Kanäle, I/LRA anhalten und zurücksetzen (gemeinsam mit Max M, Max S und Max TP, wie Tech 3341 verlangt), Protokoll als CSV oder PNG, Mithören. Bridge-Ton wird über einen Ringpuffer mit Taktausgleich (AudioWorklet) abgehört, Ausgabegerät und Kanalpaar wählbar. Steuer-API/Companion: `audio.reset`, `audio.pause`, `generator`.

**Audio-Scopes** (im Panel-Menü, im Dock und in Layout-Konfigurationen wie alle anderen, Einstellungen über ⚙)
- *Audio Pegel & Lautheit*: Sample-Peak je Kanal (Balken über 100 ms), True Peak (weiße Marke, 4-fach überabgetastet mit dem FIR aus BS.1770-5 Annex 2), Peak-Hold 3 s, Übersteuerungszähler, Marken bei −18 dBFS (R 68) und −1 dBTP (R 128). Dazu M, S und I auf der Skala EBU +9 oder EBU +18, absolut in LUFS oder relativ in LU, und die Kennwerte I, LRA (in den ersten 60 s als „unstabil“ markiert), Max M, Max S, Max TP, PLR, PSR. Zielwerte R 128, R 128 s1 (Max S ≤ −18 LUFS) und R 128 s2.
- *Audio Lautheitsverlauf*: M und S der letzten 1 bis 60 min mit Zielband ±1 LU, True-Peak-Marken (> −1 dBTP).
- *Audio Ident & A/V-Versatz*: erkennt EBU-Stereo-Ident (R 49), GLITS, BLITS, EBU-Mehrkanal-Ident (Tech 3304) und den eigenen Kanal-Ident; meldet „L/R vertauscht“, „Polarität invertiert“, „Kanal fehlt“, falsche Kanalfolge und den Pegel gegen −18 dBFS. Misst den A/V-Versatz zwischen Blitz und Piep mit den Zeitstempeln der Bridge und bewertet ihn nach ITU-R BT.1359-1.
- *Bild*: kompakter Pegelbalken am rechten Rand, wenn die Quelle Ton hat (⚙ → Ton).
- *Audio Spektrum*: FFT 1024 bis 32768, logarithmische Frequenzachse, Neigung 0/3/4,5 dB/Okt., Linie oder Terzbänder, L/R, Mitte oder einzeln.
- *Audio Goniometer*: M/S-Darstellung (Mono senkrecht, L links oben, R rechts oben), Korrelationsgradmesser mit wählbarem Fenster, Polaritätsanzeige beim Polaritätstest.

Lautheit nach ITU-R BS.1770-5 und EBU Tech 3341: K-Filter für jede Abtastrate, M (0,4 s) und S (3 s) in 10-ms-Schritten, I mit absolutem (−70 LUFS) und relativem Gate (−10 LU), LRA nach Tech 3342. Kanalgewichte nach BS.1770-5 Tabelle 3, über 5.1 nach Annex 3 Tabelle 4/5 (LFE wird nicht gemessen); unbekannte Layouts mit Gewicht 1,0 und Hinweis.

**Tongenerator** (Seitenleiste): Sinus, Rechteck, Dreieck, Sägezahn (bandbegrenzt), weißes und rosa Rauschen (auch 500–2000 Hz für Tech 3343), Log-Sweep, Stufen-Sweep auf Terzmitten, EBU-Stereo-Ident, GLITS, BLITS und EBU-Mehrkanal-Ident (Tech 3304), Kanal-Ident L/R, Polaritätstest und A/V-Sync-Piep. Stereo, 5.1 oder 7.1. Pegel als Spitzenpegel in dBFS mit Schnellwahl −18 (R 68), −20, −23, −9, 0; über −6 dBFS nur nach Rückfrage. Je Kanal an/aus, Polarität und Pegel, Schnellwahl L, R, L+R, L−R. Ein- und Ausblenden in 10 ms. Ausgabegerät per `AudioContext.setSinkId`. Beim Sinus zeigt er an, was ein Messgerät anzeigen muss (dBTP und LUFS). „→ als Messquelle“ schleift den Generator ohne Soundkarte in den Analyser.

**A/V-Sync**: Das Testbild „A/V-Sync“ blitzt zu jeder vollen Sekunde 80 ms weiß, der Generator piept mit „A/V-Sync-Piep“ zu denselben Zeitpunkten (gemeinsame Uhr aller Fenster). Den Piep legt der Browser mit seiner eigenen Schätzung der Ausgabelatenz (`getOutputTimestamp`/`outputLatency`) auf die volle Sekunde; für das Bild gibt es keinen solchen Wert. Deshalb ist die Bildausgabe **ohne Kalibrierung nicht garantiert synchron**: einmal über dieselbe Strecke messen (z. B. HDMI dieses Rechners → Capture-Karte → Bridge) und im Generator „Messwert übernehmen“. Danach bleiben etwa ±½ Bildwechsel der Anzeige und ±½ Bild der Capture. Details: [docs/research/audio.md](docs/research/audio.md), Abschnitt h.

**Selbsttest** (im Generator): schickt die erzeugbaren Testsignale aus EBU Tech 3341 (#1–#6, #9–#23) und Tech 3342 (#1–#4) durch den Messkern und zeigt Soll und Ist.

Eigene Festlegungen (nicht genormt): Kanal-Ident L/R (L ein Ton, R zwei Töne, Zyklus 3 s), Polaritätstest (positiver Halbsinus-Puls, 1 ms alle 20 ms), Rauschen mit dem Effektivwert eines Sinus gleichen Spitzenpegels, Korrelationsfenster Standard 600 ms. GLITS-Zeitplan nur nach Sekundärquelle.

## Display-Kalibrierung und Verifikation

⚙ → *Kalibrierung / Verifikation …*. Die Abläufe folgen DisplayCAL, der Code ist eigen. Details: [docs/research/display-kalibrierung.md](docs/research/display-kalibrierung.md).

- **Messfeld-Sequenzer**: Das Testbild-Ausgabefenster (`?out=`) zeigt die Messfelder. Einstellbar sind Feldgröße, konstanter APL-Hintergrund und Vollbild-Einschub gegen ABL. Der Sequenzer (`src/patchSequencer.ts`) ist auch für die LED-Wand-Werkzeuge gedacht.
- **Messgerät**: ArgyllCMS `spotread` läuft als eigener Prozess über die Bridge (Desktop-App oder `npm start`), mit CCMX/CCSS-Korrektur und Displaytyp. ArgyllCMS wird nicht mitgeliefert. Fehlt es, meldet der Dialog „ArgyllCMS nicht gefunden“ und nimmt XYZ oder xyY von Hand an. *Mit echtem Messgerät noch nicht geprüft.*
- **Eigene Testfeldsätze**: Graukeil 21, Video 47, Video 81, HDR PQ bis zur gewählten Spitze. Untethered-Modus für externe Generatoren: neues Feld bei ΔE00 > 1,5, zweimal bestätigt.
- **Bericht**: ΔE00 und ΔITP (Mittel, Median, 95. Perzentil, Max) gegen BT.1886 mit gemessenem Schwarz, Gamma, sRGB oder PQ. Dazu Graukurve mit effektivem Gamma, CCT und Duv, Kontrast. Export als CSV und HTML, Druck als PDF.
- **Uniformität** 3×3 bis 9×9 in 100/75/50/25 %: ΔE00 zum Mittelfeld (≤ 4 / ≤ 2, ISO 14861 wie von DisplayCAL zitiert) und Kontrastabweichung.
- **3D-LUT** `.cube` 33/65 aus einem Matrix/Shaper-Modell der Messungen. Sie entsteht nur, wenn das Modell die gemessenen Felder gut genug vorhersagt, und nur für SDR.
- **Systemprofil (Desktop-App)**: ⚙ → *Systemprofil mitschalten* setzt das Display-Profil des Betriebssystems passend zum gewählten Display-Farbraum (sRGB, Display P3 oder Rec.709, das Profil je Farbraum ist wählbar). Das vorherige Profil wird vorher gesichert und zurückgesetzt: beim Beenden, mit *Zurücksetzen* und nach einem Absturz beim nächsten Start. Unter macOS läuft das über einen kleinen Swift-Helfer auf der öffentlichen ColorSync-API (`npm run build:helpers`, am eingebauten Display geprüft). Unter Windows läuft es über mscms (ungeprüft). Monitor-Preset und Helligkeit per DDC/CI (VCP 0x14 / 0x10) gehen, wo ein Werkzeug vorhanden ist, ebenfalls ungeprüft. Im Browser nicht verfügbar ([docs/research/systemprofil.md](docs/research/systemprofil.md)).

## Lichtmesser

*Lichtmesser (Opple)* in der Seitenleiste verbindet einen oder mehrere Opple Light Master 3 oder 4 per Web Bluetooth (Chrome/Edge oder Desktop-App) und zeigt Beleuchtungsstärke, CCT, Duv und xy, mit Verlauf und CSV-Export. **Keine Kopplung nötig**, das Gerät erscheint nicht in den Bluetooth-Einstellungen des Systems: einschalten, *Light Master suchen …*, in der Liste anklicken. Geräte bekommen einen Namen und werden gemerkt (*Verbinden* ohne erneute Auswahl). *▦ Licht-Ansichten* legt ein eigenes Layout an: Farbort (CIE 1976/1931 mit Planck-Kurve, Isothermen, Duv-Linien, Spur und Messpunkten), Vectorscope des Lichts (Farbton und Sättigung nach CIELUV um ein Zielweiß, Mired und CTO/CTB-Folienvorschlag), Filterkanäle (6 bzw. 8 Stützstellen, kein Spektrum), Zeitverlauf (Lux, CCT, Duv mit Streuung) und Messfeld (Punkte nacheinander in ein Raster aufnehmen: Gleichmäßigkeit, Δu′v′, Vergleich zweier Lichter mit Mired und Grün/Magenta-Richtung). Der Light Master misst einen Wert an einer Stelle, kein Bild. Die Werte rechnet LZ Scopes aus den Rohkanälen des Filtersensors; für LED-Primärfarben und Displays nur ein Trendmesser, zur Display-Kalibrierung nicht geeignet. **Geprüft** mit einem Light Master 3 in der Desktop-App (Geräteliste, Verbinden, Wiederverbinden, Messung); Light Master 4, Flimmern und mehrere Geräte gleichzeitig ohne zweites Gerät ungeprüft. Dazu: *Licht: Farbfläche* zeigt den gemessenen Farbort mit Duv auf dem Display (sRGB/P3, außerhalb des Gamuts schraffiert), *Licht: Wellenlängen* beim Opple die Filterkanäle (kein Spektrum), bei Spektrometern das echte Spektrum. *Weitere Messgeräte* bindet Spektrometer und Kolorimeter über ArgyllCMS `spotread` an der Bridge an (Spektrum, CRI/TLCI/TM-30 so, wie ArgyllCMS sie berechnet; ungeprüft) und lädt Spektrum-Dateien (Argyll .sp, CSV). Folienvorschläge nach Lee- und Rosco-Herstellerangaben, Grün/Magenta mit Lee Plus/Minus Green. Details: [docs/research/opple-light-master.md](docs/research/opple-light-master.md).

## Uhr und Timecode

Panel-Typ **Uhr / Timecode**, dazu wahlweise eine Einblendung im Bild-Panel (⚙ → Uhr). Quellen und Befunde: [docs/research/clock-ptp.md](docs/research/clock-ptp.md).

- **Über 30 fps** zählt der Timecode 0…49/59 wie Schnittprogramme und FFmpeg; Frame-Paare nach ST 12-1 als Option. LTC läuft dort mit 25/30 Codewörtern (Paare).
- **Tageszeit** nach SMPTE ST 2059-1: Systemzeit → TAI (IERS Bulletin C 72, TAI − UTC = 37 s) → Timecode mit Daily Jam, 23,98 … 60 fps, DF/NDF, Frame-Phase zur SMPTE-Epoche. Gekennzeichnet als „Systemuhr – keine Referenz“, solange kein PTP die Uhr korrigiert.
- **Quell-Timecode**: Start-Timecode des Containers (ffprobe-Tag), GOP-/SEI-Timecode je Bild (ffmpeg `showinfo`), Timeline-Timecode aus DaVinci Resolve, Videodateien im Browser aus `currentTime`; Differenz zur Tageszeit in Frames.
- **LTC** aus dem Ton jeder Quelle: eigener Biphase-Mark-Leser (24–30 fps, vorwärts und rückwärts).
- **PTP-Monitor** in der Bridge (eigener Code, UDP 319/320, 224.0.1.129): Grandmaster, Domain, clockClass, Nachrichtenraten, SMPTE-SM-TLV (Lock, Lokal-Offset, nächster Jam), Offset und auf Wunsch Mean Path Delay – als Schätzung mit Software-Zeitstempeln. Ohne PTP im Netz: „kein PTP empfangen“. Die UI aus Bridge oder Desktop-App darf das direkt; eine andere Web-Oberfläche (z. B. GitHub Pages) erst nach Freigabe auf der Seite `/allow` der Bridge (⚙ → „In der Bridge zulassen …“).
- **ST-2110-RTP-Prüfung**: RTP-Zeitstempel (90 kHz, Offset 0 zur Epoche) gegen Ankunftszeit und Frame-Raster.

## Einbetten

`src/index.ts` exportiert `ScopeView`: ein WebGL-Canvas mit wählbaren Scopes, ohne Framework.

```ts
import { ScopeView, Source } from 'lz-scopes/src';
const view = new ScopeView(el, { scopes: ['wf-luma', 'vector', 'parade', 'hist'] });
const src = new Source('stream', 'Kamera 1');
src.connectFrames('ws://bridge/scope/1');  // Frame-Protokoll: docs/frame-protocol.md
view.setSource(src);
```

## Integration

- **lz-camera-bridge** (Nachfolger von av-control-center): Scopes an den RTSP-Kacheln der Ansicht *Video*, Bridge-Endpunkt `/scope/<n>`
- **cable-planner**: Konzept in [docs/cable-planner-integration.md](docs/cable-planner-integration.md), Scopes am Gerät im Canvas, Frames per Electron-IPC (`Source.pushFrame`)

## Technik

- Die **Bridge** (`server/index.mjs`) ermittelt mit ffprobe Auflösung und Farbmetadaten und startet dann ffmpeg: Skalierung auf die Analysebreite, Ausgabe `rgba` oder `rgba64le` als Rohdaten. Hinkt der Browser hinterher, verwirft sie Frames, statt eine Warteschlange aufzubauen. Die Y'CbCr-Matrix gibt sie ffmpeg explizit vor, weil swscale bei ungetaggten Streams sonst BT.601 annimmt und HD-Kameras verfälscht. Die Transferfunktion bleibt unangetastet, PQ- und HLG-Codewerte kommen also unverändert an.
- **Empfang und Latenz** (#16): Der WebSocket eines Streams läuft in einem Worker (`src/frameWorker.ts`), der nur das jeweils neueste Bild weitergibt. Für entfernte Bridges gibt es H.264 als Übertragung (Quellenkarte: `H.264 · 8 bit`; etwa 1/50 der Datenrate, aber 8 bit 4:2:0 und verlustbehaftet, dekodiert per WebCodecs). Histogramm und Clip-Anteile von im Browser dekodiertem Video rechnet die GPU (`src/gpuStats.ts`). `node scripts/latency-source.mjs rtsp://…` sendet ein Testbild mit Zeitstempel; das Panel Messwerte zeigt dann die Latenz. Messwerte: [docs/research/latency.md](docs/research/latency.md). **Low Latency** (je Quelle in der Quellenkarte oder global unter Einstellungen), jeder Teil einstellbar: Obergrenze der Analysebreite (320–960 px oder nativ), Zeichnen bei Bildankunft, eigener RTP-Empfang der Bridge für `rtsp://` (H.264/HEVC über TCP oder UDP; ein Bild endet am RTP-Markerbit statt ein Bild später im Parser von ffmpeg; ffmpeg bleibt Rückfall) und die Statistik-Rate. Der Panel-Kopf zeigt `Low Latency · … ms`; [docs/research/rtp-eigenempfang.md](docs/research/rtp-eigenempfang.md). Die Rohbild-Ausgabe von ffmpeg läuft ohne Encoder-Frame-Threads (`-threads 1`, alle Quellen) und gibt jedes Bild sofort weiter. `node scripts/latency-bench.mjs` vergleicht ffmpeg-Varianten. Messwerte und priorisierte Vorschläge: [docs/research/low-latency.md](docs/research/low-latency.md).
- Der **Renderer** (`src/renderer.ts`) ist ein einziger WebGL2-Kontext hinter allen Panels. Jeder abgetastete Pixel wird als Punkt additiv in ein Float-Target gestreut (bis 4 Mio. Punkte pro Scope und Frame) und danach per `1 − e^(−k·x)` dargestellt. 16-bit-Frames liegen als `RGBA16UI`-Textur vor.
- Die Bridge lauscht standardmäßig nur auf `127.0.0.1` und akzeptiert ausschließlich Netzwerk-URLs, die Testbilder und lokale Capture-/Audiogeräte: keine lokalen Dateien, keine ffmpeg-Optionen, keine Shell. Für Zugriff aus dem Netz gibt es `--host 0.0.0.0`.

Konfiguration: `--port`/`PORT` (4192; nicht 4190 – steht auf der Sperrliste des Fetch-Standards), `--host`/`HOST`, `--control-token`/`LZS_CONTROL_TOKEN`, `FFMPEG`, `FFPROBE`. Die Desktop-App nimmt Port 4192, wenn er frei ist (feste Adresse für Companion), sonst einen freien; `LZS_PORT`, `LZS_HOST` und `LZS_CONTROL_TOKEN` überschreiben das.

## Desktop-App

`npm run dist:mac` bzw. `npm run dist:win` baut die App mit eingebetteter Bridge und mitgeliefertem ffmpeg (Mac: Universal). Release: Tag `v*` → `release.yml` baut Windows und macOS, prüft das ffmpeg im Paket und hängt Installer und ffmpeg-Quelltext ans Release; `workflow_dispatch` ist ein Probelauf. Das mitgelieferte ffmpeg ist GPLv3 ohne nonfree-Teile, siehe [THIRD_PARTY.md](THIRD_PARTY.md) und [docs/research/ffmpeg-lizenz.md](docs/research/ffmpeg-lizenz.md).

## Offene Punkte

Siehe [Issues](https://github.com/larszu/lz-scopes/issues) und die Recherchen in [docs/research](docs/research). Zum Online-Stellen: [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Grenzen

- Sub-Black und Super-White bleiben nur im Bridge-Modus *16 bit Y′CbCr* und bei den 16-bit-Testbildern erhalten. R′G′B′-Streams (8/16 bit) und Browser-Quellen sind auf 0–100 % beschnitten; die R-103-Prüfung weist dann darauf hin.
- Die R-103-Prüfung misst am Analysebild. Bei skalierter Analysebreite ist sie nicht normgerecht (Breite „nativ“ wählen).
- Die Ausgabefenster rechnen über 8 bit, wo der Browser es erlaubt (Testbilder: float16-Canvas mit exakten 10-bit-Codes, `R` wechselt zwischen Pegel 0–100 % und Codes 1:1 für einen Monitor in Limited Range; Scope-Fenster: WebGL-Puffer RGBA16F). Das Fenster zeigt, was die Pipeline liefert; ob die Verbindung zum Monitor 10 bit trägt, ist unbekannt – Prüfmuster *10-bit-Rampe* oder Capture-Karte. Ein 10-bit-Stream (`codec=hevc10|hevc422|v210|prores`, v210 bit-exakt) läuft über die Bridge. Siehe [docs/research/10bit-ausgabe.md](docs/research/10bit-ausgabe.md).
- Kein AJA. NDI nur mit installierter NDI-Runtime, ohne Ton, mit echten Quellen im Netz ungeprüft. DeckLink nur über den selbst zu bauenden Helfer (ffmpegs eigener DeckLink-Weg ist „nonfree“ und nicht weitergebbar) und noch nie mit Hardware gelaufen.
- Audio: Browser liefern über `getUserMedia` höchstens 2 Kanäle; Mehrkanal kommt nur über die Bridge. Ungeprüft: Mehrkanal-Interfaces und Dante mit echter Hardware, die Bridge unter Windows (Ersatzweg für `pipe:3`, DirectShow-Ton), der A/V-Versatz gegen eine echte Kamera.
- Browser-Quellen (Kamera, Datei) liefern immer 8 bit und durchlaufen das Farbmanagement des Browsers.

## Tests

```bash
npm test        # Farbmathematik (PQ, HLG, Matrizen, XYZ), Statistik, Bridge-Eingabeprüfung, Steuerbefehle, Overlay-Szenen
                # Audio: K-Filter, Tech 3341/3342 bei 44,1 und 48 kHz, Generator, Bridge-Protokoll 2
npm run typecheck
npm run test:e2e  # Desktop-App per Playwright: Waveform-Pixel, RTSP über mediamtx, Ausgabefenster/MJPEG, Layouts, CST/LUT-Messpunkte
npm --prefix companion ci && npm run companion:test && npm run companion:build   # Companion-Modul
```

Die CI (`ci.yml`) prüft bei jedem PR und Push auf main Typen, Unit-Tests, Build und E2E und testet die mitgelieferten ffmpeg-Builds auf macOS und Windows (Lizenz, SRT, 10-bit-Push); die RTSP-/SRT-Empfangstests werden ohne `mediamtx` übersprungen.

Zum Ausprobieren mit echtem RTSP: `brew install mediamtx`, dann `mediamtx` starten und z. B. `ffmpeg -re -f lavfi -i testsrc2=size=1920x1080:rate=25 -c:v libx264 -f rtsp rtsp://127.0.0.1:8554/test` veröffentlichen.

## Autor

Von **Lars Zumpe**, Lars Zumpe Medienproduktion.

## Lizenz

Proprietär, © 2026 Lars Zumpe, alle Rechte vorbehalten. Nutzung der veröffentlichten Builds ist kostenlos; Weiterverbreitung und abgeleitete Werke sind es nicht. Siehe [LICENSE](LICENSE). Kein Open Source: Der Code ist öffentlich zum Lesen. Fremdkomponenten behalten ihre Lizenzen: [THIRD_PARTY.md](THIRD_PARTY.md).

Logo, Signet und App-Icon der Lars Zumpe Medienproduktion sind eigene Marke und nicht frei verwendbar (LICENSE, Abschnitt 10). Die Oberfläche hat drei Varianten (⚙ → Oberfläche): *Neutral* (unbunte Grautöne für farbkritische Arbeit, Standard), *LZM* (Brand Guide 2.0, Navy) und *Original* (fast schwarz). Scope-Spuren und Messfarben sind in allen gleich. Begründung: [docs/research/ui-farben.md](docs/research/ui-farben.md).

NDI® is a registered trademark of Vizrt NDI AB.
