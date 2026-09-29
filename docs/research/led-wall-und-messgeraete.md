# LED-Wand-Kalibrierung und Messgeräte – Recherche

Stand: 29.09.2026. Nur Recherche, kein Produktcode. Aussagen mit Quelle sind belegt; eigene Einschätzungen sind als **Einschätzung** markiert. Wo nichts gefunden wurde, steht das ausdrücklich da.

---

## Teil A – LED-Wände prüfen und kalibrieren

### A.1 Wer kalibriert was?

Die eigentliche Kalibrierung (Korrekturkoeffizienten je Pixel/Modul) läuft immer über die Empfangskarten des LED-Prozessors. Ein Browser-Tool kann sie **nicht ersetzen**, aber vorbereiten, prüfen und dokumentieren.

| Ebene | Werkzeug | Was es tut | Quelle |
|---|---|---|---|
| Werk/Pixel | **Brompton Hydra** (Tessera R2/R2+) | Kamerasystem mit mehreren Instrumenten, „full colourimetric data … in seconds“ je Panel, Abstand 4 m oder 8 m; Grundlage für Dynamic Calibration, PureTone, ThermaCal, Brompton HDR | [bromptontech.com/technology/hydra](https://www.bromptontech.com/technology/hydra/), [Dynamic Calibration](https://www.bromptontech.com/technology/dynamic-calibration/) |
| Pixel/Naht | **NovaStar NovaCLB-Screen** + NovaLCT | Kamera (Canon-DSLR oder Caliris) mittig vor der Wand, Winkel zu allen vier Wandkanten < 30°; Wand wird in Partitionen zerlegt (Kameraauflösung). Modi: Full-screen pixel level calibration, Seam brightness calibration, New module calibration, Uniformity evaluation (vorher/nachher). Default-Zielwert: 8 % Helligkeitsverlust | [NovaCLB Quick Start (PDF)](https://oss.novastar.tech/uploads/2021/02/NovaCLB-Screen-Quick-Start-Guide.pdf), [User Manual](https://oss.novastar.tech/uploads/2021/02/NovaCLB-Screen-Full-screen-Calibration-System-User-Manual.pdf) |
| Pixel/Naht | **Colorlight Calibration Pro** | Modi Brightness, Chroma, Repair Seam Only; „chip low brightness calibration“ (iterativ, ein oder mehrere Graustufen); Deseam passt die Randpixel an; Kameras Canon bzw. CCM1600/CCM6000 | [ManualsLib: Colorlight Calibration Pro](https://www.manualslib.com/manual/3011288/Colorlight-Calibration-Pro.html) |
| Kamera ↔ Wand (ICVFX) | **Unreal Engine** Camera Color Calibration | Mindestens R, G, B, W als Patches auf der Wand, zur Verifikation 5×5×5-Gitter in 0,25-Schritten; Kamera WB 6500, Belichtung so, dass Weiß sicher sitzt; Prozessor auf nativen Farbraum („Achievable“ bei Brompton); 3×3-Matrix aus R/G/B-Samples, invertiert und mit Weiß skaliert, landet in OCIO | [Epic Docs 5.7](https://dev.epicgames.com/documentation/en-us/unreal-engine/camera-color-calibration-for-in-camera-vfx-in-unreal-engine) |
| Kamera ↔ Wand | **disguise xR** Colour calibration | Kamerabasiert, zeigt inkrementelle Farbschritte, erzeugt 3D-LUT je Kamera/LED-Fläche; Voraussetzung: Spatial- und Delay-Kalibrierung vorher, Bild komplett mit LED gefüllt, Kamera fix | [help.disguise.one – Colour calibration](https://help.disguise.one/workflows/xr/colour-calibration), [Spatial calibration](https://help.disguise.one/workflows/xr/spatial-calibration) |
| Kamera ↔ Wand | **Light Illusion ColourSpace** + MatchLight | „Image Sequence Probe“ (Kamera als virtuelle Sonde über Bildsequenzen) plus klassische Sonden zur Vorkalibrierung (z. B. auf P3); Integration mit Brompton Tessera und Megapixel HELIOS | [lightillusion.com/virtual_sets.html](https://lightillusion.com/virtual_sets.html) |
| Multi-Display | **Calman Ultimate** (Portrait Displays) | Laut Hersteller eigener Workflow für „calibrating and perfectly matching multi-panel video walls“, 3D-LUTs | [portrait.com – Calman](https://www.portrait.com/calman-professional/) (Details zum Workflow nicht öffentlich gefunden) |
| Low-Level | **Brompton Extended Bit Depth** | bis zu 3,3 zusätzliche PWM-Bits; bei 24 fps und 180° Shutter +2,3 Bit; nur SX40/S8, mit ShutterSync | [Tessera Help: Extended Bit Depth](https://www.bromptontech.com/online-help/Content/Tessera%20User%20Manual/03.%20Feature%20Topics/12.1.5%20-%20Extended%20Bit%20Depth.htm) |
| Testbilder im Prozessor | **Brompton Tessera** | Prozessor-Testbilder, u. a. Scrollmuster, die sich „exactly one pixel“ bewegen, zum Prüfen von Layout und Bewegung; DMX-Auswahl u. a. „Brompton Glyph Pattern/Overlay“ | [Tessera Help: Processor Test Patterns](https://www.bromptontech.com/online-help/Content/Tessera%20User%20Manual/03.%20Feature%20Topics/11.1%20-%20Processor%20Test%20Patterns.htm), [Tessera Manual 3.4 (PDF)](https://www.bromptontech.com/wp-content/uploads/2022/11/Tessera-User-Manual-V3.4-Rev-B.pdf) |

Nicht gefunden bzw. nicht vertieft: eigene Kalibrier-Workflows von **ROE** und **INFiLED** (ROE verweist für Rekalibrierung auf Brompton Hydra: [roevisual.com](https://www.roevisual.com/nl-en/applications/brompton-hydra-update-calibration)); **Pomfort** (Livegrade) – keine LED-spezifische Kalibrierfunktion recherchiert.

### A.2 Messgrößen und ihre Ursachen

| Messgröße | Worum es geht | Beleg |
|---|---|---|
| Uniformität Luminanz/Farbe je Cabinet/Modul | Binning der LEDs, Modultausch, Alterung → Flecken, Karos | NovaCLB „Uniformity evaluation“, Southern 2022 (Binning, S. 5) |
| Nahtlinien | helle/dunkle Linien an Modul-/Cabinetgrenzen durch Montage | NovaCLB „Seam brightness calibration“, Colorlight „Deseam“ |
| Weißpunkt | Wand muss zur Kamera-WB/zum Set passen | Unreal: WB 6500 bei Kalibrierung |
| Gamma/EOTF bei niedriger Helligkeit, Graustufen-Bittiefe, Banding | PWM-Bittiefe reicht bei gedimmter Wand nicht; Farbstiche im Grau | Brompton Extended Bit Depth, [Low Brightness](https://www.bromptontech.com/solutions/low-brightness/), Colorlight „chip low brightness calibration“ |
| Farbraum/Primärfarben | native Primaries der Wand vs. Content-Farbraum | Unreal/disguise: R/G/B/W-Patches, Matrix/3D-LUT |
| Blickwinkel-Farbverschiebung | Farbe verschlechtert sich, je flacher die Kamera zur Wand steht | [Southern 2022, Bournemouth](https://eprints.bournemouth.ac.uk/36826/1/LED_Comparison_White_Paper(1).pdf) („Grazing angle“), ROE BP2V2 140°/140° ([roevisual.com](https://www.roevisual.com/en/products/black-pearl-2v2)), aktive Blickwinkelkorrektur Pixomondo/ROE ([British Cinematographer](https://britishcinematographer.co.uk/roe-visual-celebrates-virtual-production-landmark-with-black-pearl-2-series/)) |
| Scan-Linien / Refresh vs. Shutter | Wand refresht in Scan-Gruppen (typisch 1/8); ohne Sync Banding | Southern 2022; [Megapixel: Solving Scan Lines](https://support.megapixelvr.com/support/solutions/articles/103000307117-solving-scan-lines-with-icvfx): Genlock, Phasenversatz in µs, kleinerer Shutterwinkel, > 7680 Hz; „requiring proper testing and monitoring of recorded images“ |
| Moiré | Pixelraster der Wand auf Sensorraster, v. a. bei Schärfe nahe der Wand | Southern 2022, Abschnitt 3.4 |
| Tote/hängende Pixel, Modulausfall | Einzelpixel, Treiberchip-Zeilen, Datenkette | allgemein; Brompton-Testbilder zum Layout-Prüfen |
| Pixel-Mapping | stimmt die Prozessor-Zuordnung mit der physischen Wand? | Brompton: Testbilder „verify that a fixture layout is correct“ |

### A.3 Was ein Browser/Electron-Tool realistisch kann

- **Kann:** Testbilder pixelgenau ausgeben (schon vorhanden: `?out=`-Fenster, 1:1 in nativer Auflösung), Kamerabild/Capture/RTSP analysieren (ROI-Statistik, Scopes), Rasterauswertung je Cabinet, Berichte, Messgeräte per Web Bluetooth (Chrome/Electron), WebHID/WebSerial oder per Kindprozess (ArgyllCMS `spotread`) anbinden.
- **Kann nicht:** Korrekturkoeffizienten in Empfangskarten schreiben (proprietär, NovaLCT/Tessera/Colorlight). Absolute Farbmessung mit einer Videokamera (Kamera ist kein Kolorimeter; nur relativ/Vergleich). 10-bit-Ausgabe aus Canvas ist nicht garantiert (README: Canvas = 8-bit Full-Range-RGB) – für Low-Level-Banding-Tests ist das eine harte Grenze.
- **Einschätzung:** Stärke von LZ Scopes ist die **kamerabasierte relative Prüfung** vor Ort („Ist die Wand heute gleichmäßig? Wo ist die Naht? Welches Cabinet weicht ab?“) plus Protokoll – nicht die Kalibrierung selbst.

### A.4 Funktionsliste für LZ Scopes

**Muss**

1. **Wand-Konfiguration**: Wandauflösung, Cabinet-Auflösung (B×H in Pixeln, frei, z. B. 176×176, 192×192, 256×256), Anzahl Spalten/Reihen, Offset, optional Modulraster innerhalb des Cabinets. Speicherbar pro Wand.
2. **Testbild „Cabinet-Raster mit ID“**: Rahmen 1 px an jeder Cabinetgrenze, Nummer (Spalte/Reihe und laufende ID) mittig, abwechselnde Grautöne im Schachbrett je Cabinet, Pfeil/Ecke „oben links“ zur Orientierungsprüfung.
3. **Testbild „Pixel-Mapping“**: 1-px-Gitter, einzelne Pixel an den vier Ecken jedes Cabinets, diagonale Linie über die ganze Wand (Versatz zwischen Cabinets wird sofort sichtbar), Laufschrift/Scroll um genau 1 px/Frame (wie Brompton-Scrollmuster).
4. **Uniformitätsfelder**: Vollfeld Weiß, R, G, B, Grau in wählbaren Stufen (z. B. 5, 10, 25, 50, 75, 100 %) – vorhanden für Vollfelder, fehlt: frei einstellbarer Pegel.
5. **Kamera-Rasterauswertung** (Kern): Kamerabild der Wand, 4-Punkt-Entzerrung (Eckpunkte klicken), Raster aus der Wand-Konfiguration darüberlegen, je Cabinet (und optional Modul) Mittelwert, Median, Std-Abw. von Y' und Chroma (Cb/Cr bzw. xy relativ), Abweichung zum Wandmedian in %, als **Heatmap** mit ID-Beschriftung. Randzonen je Zelle ausblenden (Nähte getrennt auswerten). Mehrere Aufnahmen mitteln (Rauschen, Scan-Linien).
6. **Nahtauswertung**: Helligkeitsprofil quer zu jeder Cabinetgrenze (Randstreifen vs. Zellinneres), Liste der auffälligsten Nähte.
7. **Bericht/Export**: CSV/JSON je Cabinet, PNG der Heatmap, Datum, Wand, Kamera-Einstellungen (manuell eingetragen).

**Soll**

8. **Graurampen/Graukeil fein** für Low-Level: Stufen 0–10 % in 0,5-%-Schritten, Rampe über nur die untersten Codewerte, gespreizt über die ganze Breite (zeigt PWM-Bittiefe und Farbstich im Grau; Brompton/Colorlight adressieren genau das). Hinweis auf 8-bit-Grenze.
9. **Shutter/Refresh-Testmuster**: schnell bewegte vertikale/horizontale Balken, Vollfeld-Blinken im Framerhythmus, Frame-Zähler groß (Zeitcode/Frame-Nummer) für Genlock- und Latenzprüfung; dazu Auswertung im Kamerabild: **Zeilenprofil-Varianz** (horizontale Banding-Energie) als „Scan-Linien-Index“ zum Vergleich von Shutter/Phase-Einstellungen (Megapixel: „monitoring of recorded images“).
10. **Moiré-Muster**: Linienpaare 1/2/3/4 px, konzentrische Kreise, Zonenplatte (vorhanden) – bei gefilmter Wand zur Abstands-/Schärfeplanung.
11. **Farbfelder für Messgeräte**: großes zentriertes Patch (Fenstergröße 1/4/10/25/100 %) mit schwarzem oder grauem Umfeld, Patch-Sequenzer (Liste von RGB-Werten, Wartezeit, Weiterschalten per Taste oder automatisch) – für Sonde, Opple, spotread. Unreal-Satz (R, G, B, W; 5×5×5 in 0,25) als Vorlage.
12. **Tote-Pixel-Suche**: Vollfeld Schwarz/Weiß/R/G/B hintereinander; im Kamerabild Ausreißer-Pixel (lokaler Kontrast) markieren. **Einschätzung:** Erkennung einzelner LEDs nur bei Kameraauflösung > Wandauflösung im Ausschnitt realistisch.
13. **Vorher/Nachher-Vergleich** zweier Rasterauswertungen (Delta-Heatmap) – analog NovaCLB „Uniformity evaluation“.

**Kann**

14. **Blickwinkel-Serie**: gleiche Rasterauswertung aus mehreren Kamerapositionen, Plot mittlere Farbe/Helligkeit über Winkel.
15. **Messgeräte-Anbindung**: Opple LM3/LM4 per Web Bluetooth (siehe Teil B), ArgyllCMS `spotread -e -O` als Kindprozess in Electron (i1Display Pro/Calibrite, Klein K10, JETI; [argyllcms.com/doc/spotread.html](https://www.argyllcms.com/doc/spotread.html), [Instrumentliste](https://www.argyllcms.com/doc/instruments.html)); automatisches Patch→Messung-Protokoll.
16. **Kamera-Matrix wie Unreal**: aus R/G/B/W-Patches im Kamerabild eine 3×3-Matrix berechnen und als OCIO-Matrix/CSV exportieren (Mathematik laut Epic-Doku öffentlich).
17. **Ausgabe mehrerer Fenster** (je Prozessor-Eingang ein Ausschnitt der Wand), falls Wand über mehrere Ausgänge gespeist wird.

### A.5 Testbild-Spezifikationen (Vorschlag)

Alle Muster werden in Wandauflösung (nicht nur 720p–2160p) erzeugt; freie Auflösung ist Voraussetzung (bisher feste Liste `RESOLUTIONS`).

| ID | Inhalt | Parameter |
|---|---|---|
| `led-cabinet-grid` | Cabinetgrenzen 1 px Weiß, Schachbrett 20 %/30 % Grau je Cabinet, ID „C-R“ und laufende Nummer mittig, Höhe ≈ 30 % der Cabinethöhe, Eckmarke oben links in Rot | cabW, cabH, cols, rows, Startnummer, Zählrichtung (zeilen-/spaltenweise, Schlange) |
| `led-module-grid` | wie oben, zusätzlich Modulgrenzen gestrichelt | modW, modH |
| `led-pixelmap` | 1-px-Gitter alle n px, Diagonale über die Wand, Eckpixel je Cabinet in R/G/B/W | n |
| `led-scroll` | 1-px-Linie bzw. Text, bewegt 1 px/Frame horizontal/vertikal | Richtung, Geschwindigkeit |
| `led-flat` | Vollfeld beliebiger Pegel/Farbe | RGB 0–255 (bzw. %), Kanalwahl |
| `led-lowgray` | 21 Stufen 0–10 % bzw. Codewerte 0–20, groß, mit Beschriftung | Bereich, Stufenzahl |
| `led-lowramp` | Rampe über Codewerte 0–N, gestreckt über die ganze Breite, je Kanal eine Zeile | N |
| `led-shutter` | Frame-Zähler groß, bewegte Balken, schwarz/weiß-Wechsel je Frame, Laufband | Frame-Rate der Ausgabe |
| `led-moire` | Linienpaare 1–4 px horizontal/vertikal/diagonal, Kreise | Periode |
| `led-patch` | zentriertes Patch in Fenstergröße x %, Umfeld wählbar, Sequenzer | Patchliste, Dauer, Fenster % |

---

## Teil B – Opple Light Master per Bluetooth

### B.1 Befund: Ja, es gibt fertige offene Implementierungen

Kein offizielles SDK gefunden. Aber es gibt mehrere Open-Source-Projekte, die das BLE-Protokoll nachgebaut haben und im Browser laufen:

| Projekt | Modelle | Technik | Lizenz |
|---|---|---|---|
| [OlliV/open-light-master](https://github.com/OlliV/open-light-master) ([Web-App](https://open-light-master.vercel.app/)) | Light Master III (= G3 = „Pro“, laut [1lumen](https://1lumen.com/gear-review/opple-light-master-3-pro/) dasselbe Gerät) | Next.js, Web Bluetooth; Lux, CCT, Duv, Tint, CRI (Ra, R1–R14), SSI, SPD, Flicker-FFT, CSV-Export | GPL-3.0 |
| [natmart-in/sunday-light-meter](https://github.com/natmart-in/sunday-light-meter) | LM3 (advertised als `LightMaster`) und LM4 (`SigMesh`) | Web Bluetooth, Chrome/Edge Desktop + Android; iOS nur über Bluefy | MIT |
| [khromov/opple-light-master-4-web-ui](https://github.com/khromov/opple-light-master-4-web-ui) ([Web-App](https://khromov.github.io/opple-light-master-4-web-ui/)) | nur LM4 | Svelte, Web Bluetooth; Algorithmen und Koeffizientensatz `LightmasterⅣCoeff_20231115` aus der OPPLE-Smart-App nachgebildet, CSV/JSON-Export | MIT |
| [gabrielebaudo/opple-bridge](https://github.com/gabrielebaudo/opple-bridge) | LM3 (6 Kanäle) und LM4 (9 Kanäle), Autoerkennung | Python, bleak, FastAPI – BLE→WLAN-Brücke, Ziel Raspberry Pi Zero 2 W | MIT |

**Konsequenz für LZ Scopes:** Anbindung ist machbar ohne eigenes Reverse Engineering. Für eine Übernahme von Code ist die Lizenz entscheidend: die MIT-Projekte (sunday-light-meter, khromov, opple-bridge) sind unproblematisch mit Namensnennung; open-light-master ist GPL-3.0 (nur als Referenz lesen, nicht kopieren, wenn LZ Scopes nicht GPL werden soll).

### B.2 Protokoll (aus den Quellen gelesen)

Alles hier stammt aus dem Code von open-light-master (`lib/ble/lm3.ts`) und khromov (`src/lib/ble/protocol.ts`, `meter.ts`), beide am 29.09.2026 geklont und gelesen.

- **GATT-Service:** Nordic UART Service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`; Characteristic `6e400003-…` (TX/Notify) wird auch zum Schreiben der Kommandos benutzt, `6e400002-…` (RX) ist deklariert.
- **Gerätenamen (Filter):** `SigMesh` (LM4), `LightMaster`, `Light Master`, `LMaster`, `LM4` (khromov `meter.ts`). Opple-Company-ID in den Herstellerdaten: `0x0539`.
- **Rahmen:** 11-Byte-Header `[00 13 00 00 seq 00 len 00 00 opHi opLo]` + Nutzdaten, zerlegt in ≤ 20-Byte-Fragmente; erstes Byte je Fragment: `0x00` einzeln, `0x80` erstes (danach 2 Byte Gesamtlänge), `0xA0|i` mittleres, `0xC0|i` letztes.
- **Opcodes:** `0x0A00`/`0x0A01` Messung anfordern/Antwort; `0x0A04`/`0x0A05` Kalibrierdaten (Sensor-Korrekturfaktoren `kSensor`, 7 × float32); `0x0A0A`/`0x0A0B` Flicker-Aufnahme (gepackte 12-bit-Samples).
- **Messdaten LM3:** 6 Kanäle als uint16 big-endian (Code-Kommentare: 450, 500, 550, 570, 600, 650 nm) + Versorgungsspannung + ein Byte, das open-light-master als Temperatur deutet. Das Gerät liefert **Rohzählwerte**; XYZ, xy, CCT, Duv, CRI, EML rechnet **die App/der Client** über hinterlegte Matrizen (drei Lichtarten: monochromatisch, Glühlampe, allgemein).
- **Messdaten LM4:** Sensor **AS7341** (F1–F8, 415–680 nm, + Clear, + NIR) laut khromov `protocol.ts`/`lm4.ts` und sunday-light-meter-README; Umrechnung ebenfalls clientseitig.
- **„Spektrum“** ist bei beiden eine Rekonstruktion aus 6 bzw. 8 Filterkanälen (open-light-master: Spline-Interpolation in `lib/spd.ts`), keine spektrometrische Messung.
- **Verbindungsverhalten LM4** (khromov OMISSIONS.md): Gerät trennt eine untätige Verbindung nach ≈ 46 s, deshalb Poll alle 900 ms; bei > ≈ 4000 lx übersteuert der Flickersensor; Opple-App muss geschlossen sein, sonst ist das Gerät belegt.
- **Verschlüsselung/Pairing:** In keinem der Projekte erwähnt oder benötigt.

**App:** „OPPLE Smart“ (iOS 3.16.0, Android 3.3.1 als Referenz bei khromov). Laut khromov gehen Berichte der App in die Opple-Cloud (`/toolserviceapi/LightMaster/*`), Teilen per Cloud-Link; einen lokalen Datei-Export der offiziellen App habe ich **nicht belegt gefunden**.

**Einschätzung zur Eignung:** Filtersensoren mit 6–8 Kanälen und clientseitigen Matrizen sind für Raum-/Scheinwerferlicht (Lux, CCT, Flicker) gedacht. Für schmalbandige LED-Wand-Primärfarben sind die Farbwerte vermutlich unzuverlässig (der LM3-Code schaltet für „monochromatisches“ Licht sogar eine eigene Matrix). Für LED-Wände taugt der Opple als Luminanz-/Weißpunkt-**Trendmesser**, nicht als Referenz. Das ist nicht gemessen, nur abgeleitet.

### B.3 Firmware und Chip

- **Firmware-Dateien:** öffentlich keine gefunden. Laut khromov OMISSIONS.md läuft das Firmware-Update nur für LM4 über ein natives Android-Modul (`OPRNOTA2NativeModule`) mit Firmware aus der Opple-Cloud; in iOS 3.16.0 ist die Route nicht registriert.
- **Spektralsensor:** LM4 = ams AS7341 (belegt, s. o.). LM3: Kanalwellenlängen 450/500/550/570/600/650 nm aus Code-Kommentaren; welcher Sensor-Chip, **nicht belegt** (ein [Teardown-Video](https://www.youtube.com/watch?v=KXDEz91xCuk) existiert, nicht ausgewertet).
- **BLE-SoC:** **nicht belegt.** Der Nordic UART Service deutet auf eine Nordic-Herkunft des Profils hin, ist aber kein Beweis für einen nRF-Chip (NUS wird auch auf anderen Chips implementiert).
- Firmware-Reverse-Engineering ist für die Anbindung **unnötig**, weil das Protokoll bereits offen dokumentiert ist.

### B.4 Web Bluetooth in Chrome und Electron

- **Chrome/Edge:** `navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'SigMesh' }, { namePrefix: 'LightMaster' }], optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] })`, nur nach Nutzergeste, Geräteauswahl im Browser-Dialog. Safari/Firefox ohne Web Bluetooth ([sunday-light-meter](https://github.com/natmart-in/sunday-light-meter)).
- **Electron:** Ohne Handler für `webContents` → Event `select-bluetooth-device` werden alle Anfragen abgebrochen; der Handler bekommt die Geräteliste und ruft `callback(deviceId)` (leerer String = Abbruch) ([Electron-Doku web-contents](https://www.electronjs.org/docs/latest/api/web-contents)). Damit kann LZ Scopes einen eigenen Auswahl-Dialog bauen oder das erste passende Gerät nehmen.
- **Zu prüfen (nicht belegt recherchiert):** macOS verlangt für Bluetooth-Zugriff einen Usage-String in der Info.plist der gepackten App (`NSBluetoothAlwaysUsageDescription`) – vor der Umsetzung im electron-builder-Setup verifizieren.

### B.5 Anleitung: Protokoll selbst mitschneiden (falls ein Modell/Feature fehlt)

Nur nötig z. B. für Light Master 2, Light Spirit oder neue Firmware. Vorgehen:

1. **GATT-Struktur ansehen** – nRF Connect (Android/iOS): Gerät scannen (Name `SigMesh`/`LightMaster`), verbinden, Services/Characteristics notieren, Notify auf `…0003` einschalten. Opple-App vorher schließen.
2. **Android-HCI-Snoop-Log** ([AOSP: Verify and debug](https://source.android.com/docs/core/connect/bluetooth/verifying_debugging), [Gadgetbridge-Anleitung](https://gadgetbridge.org/internals/development/bluetooth/)):
   - Entwickleroptionen → „Bluetooth HCI-Snoop-Log aktivieren“, Bluetooth aus/an.
   - In der OPPLE-Smart-App gezielt einzelne Aktionen ausführen (Messung, Flicker, Kalibrierdaten), Uhrzeit oder Reihenfolge notieren.
   - Log holen: `adb bugreport` (ohne Root, Log liegt im ZIP) oder `adb pull /data/misc/bluetooth/logs/btsnoop_hci.log` (je nach Gerät), alternativ live in Wireshark über die Schnittstelle „Android Bluetooth Btsnoop“.
   - In Wireshark filtern: `btatt` bzw. `btatt.opcode == 0x52 || btatt.opcode == 0x12 || btatt.opcode == 0x1b` (Write Command, Write Request, Notification), Payloads nach Handle gruppieren, gegen den Header `00 13 00 00 …` aus B.2 legen.
3. **iOS/macOS – PacketLogger** (aus „Additional Tools for Xcode“): Bluetooth-Logging-Profil von Apples Developer-Seite aufs iPhone installieren, iPhone per Kabel, in PacketLogger „File → New iOS Trace“; Export als BTSnoop für Wireshark ([Novel Bits: iOS Bluetooth Debugging](https://novelbits.io/debugging-sniffing-secure-ble-ios/), [Bluetooth SIG Blog](https://www.bluetooth.com/blog/a-new-way-to-debug-iosbluetooth-applications/)). Auf dem Mac selbst zeichnet PacketLogger nur Verkehr des Macs auf – also nützlich, um die eigene Web-Bluetooth-Implementierung zu debuggen.
4. **Auswerten:** Anfrage/Antwort-Paare nach Opcode sortieren, Byte-Felder gegen Anzeige der App bei stabiler Lichtquelle korrelieren (zwei, drei Lichtquellen, jeweils mehrere Messungen), Fragmentierung beachten.
5. **Nachbauen:** Minimal-Client in Web Bluetooth, Rohdaten loggen, gegen App-Anzeige vergleichen.

### B.6 Rechtliche Einordnung (allgemein, keine Rechtsberatung)

- EU-Software-Richtlinie 2009/24/EG Art. 6 ist in Deutschland als **§ 69e UrhG** umgesetzt: Vervielfältigung/Codeübersetzung ohne Zustimmung erlaubt, wenn „unerläßlich …, um die erforderlichen Informationen zur Herstellung der Interoperabilität eines unabhängig geschaffenen Computerprogramms“ zu erhalten – nur durch Berechtigte, nur wenn die Informationen nicht schon zugänglich sind, beschränkt auf die nötigen Programmteile; die Informationen dürfen nicht für ein im Wesentlichen ähnliches Programm genutzt werden ([gesetze-im-internet.de/urhg/__69e](https://www.gesetze-im-internet.de/urhg/__69e.html)).
- **§ 69d Abs. 3 UrhG** (Art. 5 Abs. 3 der Richtlinie): Berechtigte dürfen das Funktionieren eines Programms beobachten, untersuchen und testen ([§ 69d](https://www.gesetze-im-internet.de/urhg/__69d.html)). Das Mitschneiden des eigenen Funkverkehrs mit dem eigenen Gerät fällt eher hierunter als unter Dekompilierung.
- Praktisch relevant: Das Protokoll ist bereits öffentlich dokumentiert (MIT-Projekte) – damit ist eigene Dekompilierung nach § 69e mangels Unerlässlichkeit eher **nicht** gedeckt und auch nicht nötig. Die aus der App extrahierten Koeffizienten (khromov/opple-bridge) sind eine eigene Frage (Urheberrecht an reinen Zahlen fraglich, AGB der App) – vor kommerzieller Nutzung klären.

### B.7 Alternativen mit offener Schnittstelle

| Gerät | Schnittstelle | Befund |
|---|---|---|
| **Konica Minolta CL-500A** | CL-SDK, ANSI-C, Windows 10/11 Pro, USB 2.0, nur für Käufer | [KM CL-SDK](https://www.konicaminolta.com/instruments/download/software/light/cl-sdk/index.html). **CL-70F** ist dort nicht als unterstützt gelistet. |
| **Sekonic C-7000** | „SDK for remote control“ auf Antrag über den Händler, ohne Support | [Sekonic C-7000](https://global.sekonic.com/sekonic-c-7000-spectrometer/). **C-800:** nur „C-800 Utility“ ([PDF](https://sekonic.com/content/Files/C-800_Utility_Software_Guide_en.pdf)), kein SDK gefunden. |
| **Calibrite/X-Rite i1Display Pro**, Klein K10-A, JETI specbos/spectraval, Spyder | ArgyllCMS `spotread` (`-e` emissiv, `-a` ambient, `-y` Displaytyp, `-x` Yxy, `-O` eine Messung und Ende → skriptbar), CCSS-Korrekturen | [Instrumente](https://www.argyllcms.com/doc/instruments.html), [spotread](https://www.argyllcms.com/doc/spotread.html). Für LED-Wände die sinnvollste offene Kette: Electron startet `spotread`, LZ Scopes zeigt den Patch. |
| **Asensetek Lighting Passport** | BLE (BT 4.0), eigene Apps (Spectrum Genius), PC-Software | Kein öffentliches SDK gefunden ([Allied Scientific FAQ](https://lightingpassport.alliedscientificpro.com/faq/)); asensetek.com war nicht erreichbar. |

**Einschätzung:** Für LED-Wand-Luminanz und -Weißpunkt ist ein Kolorimeter mit Spektral-Korrektur (i1Display Pro + CCSS aus einer Spektralmessung) über ArgyllCMS die offenste und günstigste Kette. Der Opple ergänzt für Umgebungslicht, Set-Licht und Flicker.

---

## Offene Fragen

1. Welche LED-Prozessoren nutzt Lars konkret (NovaStar, Colorlight, Brompton)? Davon hängt ab, ob Cabinet-Maße aus Konfigurationsdateien (z. B. NovaLCT-Export) importiert werden können.
2. Opple-Modell im Bestand: LM3 (G3/Pro) oder LM4? Für LM3 gibt es nur GPL-Code (open-light-master) und MIT-Code in sunday-light-meter.
3. Übernahme von Code/Koeffizienten aus den MIT-Projekten oder eigene Implementierung nach Protokollbeschreibung?
4. Reicht 8-bit-Canvas-Ausgabe für Low-Level-Tests, oder braucht es eine Ausgabe über DeckLink/Signalgenerator (README: kein SDI)?
5. Welche Kamera für die Rasterauswertung (Log/Rec.709, fixe Belichtung, RTSP oder Capture)? Linearisierung wird für Heatmap-Prozentwerte gebraucht.
6. Details zum Calman-Videowall-Workflow und zu Pomfort sind nicht öffentlich recherchiert.
7. macOS-Bluetooth-Berechtigung in der gepackten Electron-App (Info.plist) vor Umsetzung prüfen.
