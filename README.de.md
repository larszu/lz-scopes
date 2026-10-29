<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lzm_hauptlogo_offwhite.svg" />
    <img src="docs/brand/lzm_hauptlogo_navy.svg" alt="Lars Zumpe Medienproduktion" width="220" />
  </picture>
</p>

<h1 align="center">LZ Scopes</h1>

<p align="center">
  <b>Software-Messtechnik im Browser: Waveform, Parade, Vectorscope, Histogramm, CIE-Diagramm, Falschfarben und Messwerte, auch für RTSP-Streams.</b><br />
  Für macOS, Windows und Linux als Desktop-App oder direkt im Browser.
</p>

<p align="center">
  <a href="https://github.com/larszu/lz-scopes/releases/latest">
    <img src="https://img.shields.io/badge/Download-macOS%20%7C%20Windows%20%7C%20Linux-1D324F?style=for-the-badge&logo=github&logoColor=white" alt="LZ Scopes für macOS, Windows und Linux herunterladen" height="40" />
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

Scopes, die messen statt schätzen: Waveform, Parade, Vectorscope, Histogramm, CIE-Diagramm, Falschfarben und Messwerte – für Kamera, Capture-Karte, NDI, RTSP/SRT, DaVinci Resolve oder eine Datei. Bis 16 bit, Y′CbCr unbeschnitten, HDR und Log inklusive.

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

## Installieren

[Neuestes Release](https://github.com/larszu/lz-scopes/releases/latest) für macOS, Windows und Linux (x64 und arm64). Die Desktop-App bringt alles mit, auch ffmpeg – RTSP und SRT laufen sofort. Ohne Installation: [Web-Fassung](https://larszu.github.io/lz-scopes/) (Testbilder, Kamera, Bildschirm, Dateien).

Linux-Pakete, iPhone/iPad und die Feinheiten: [Einzelheiten → Installation](docs/details.de.md#download-und-installation).

## Schnellstart

1. App starten – die erste Quelle ist ein Testbild, alle Panels folgen ihr.
2. Je Panel eine Quelle wählen: *Testbild*, *Kamera*, *Bildschirm*, *Datei* oder *Stream*.
3. Für einen Stream die URL eintragen, z. B. `rtsp://user:pass@host:554/stream`.
4. Im Bild einen Rahmen ziehen, um nur diesen Bereich zu messen.
5. Fenster per Drag-and-drop anordnen, unter *Datei → Layouts …* speichern.

Tasten: `1`–`6` Layout · `Leertaste` Einfrieren bzw. Wiedergabe · `←`/`→` ein Bild · `J`/`K`/`L` Shuttle · `C` Messpunkt · `F` Vollbild · `S` PNG. Vollständig unter *Hilfe → Tastenkürzel*.

## Was es kann

- **Scopes**: Waveform (Luma, Farbe, RGB), RGB-/YRGB-/YCbCr-Parade, Vectorscope (auch nach Tonwert getrennt), HLS, CIE, Diamond, 3D-Farbvolumen, Histogramm, Sättigung über Luma, Kanal-Plot, Messwerte.
- **Eingänge**: Kamera, Bildschirm, Datei (über die Brücke bis 16 bit, mit Transport), Ordner, RTSP, SRT, RTMP, NDI, DeckLink/UltraStudio, SDI-VANC, DaVinci Resolve.
- **Richtig messen**: Y′CbCr unbeschnitten (Sub-Black, Super-White), EBU R 103, PQ/HLG in cd/m², Log-Kurven der Hersteller, CST und LUTs je Quelle, Skala in %, 8/10 bit, nits oder Blenden.
- **Kameras abgleichen**: Referenzkamera mit Geisterspur, Farbtafel-Match mit ΔE und Matrixvorschlag, Hautton aller Kameras in einem Vectorscope, Drift-Wächter, Touch Shading über die [LZ Camera Bridge](https://github.com/larszu/lz-camera-bridge). Kamera-Farbabgleich, der die Kamera selbst nachstellt (Blackmagic REST, Panasonic- und Sony-CGI, Sony VISCA over IP in der Desktop-App, Bridge oder Anleitung), gegen eingebaute oder importierte Kartendefinitionen (JSON, lokal gespeichert).
- **Im Betrieb**: Alarmrahmen je Panel mit Haltezeit, QC-Protokoll als CSV, Aufzeichnung mit Ringpuffer und synchroner Wiedergabe, Ausgabefenster für den zweiten Schirm, Steuerung über Companion.
- **Dazu**: Testbilder (SMPTE, PLUGE, Zonenplatte, HDR, LED-Wand), Display-Kalibrierung, Lichtmesser, Uhr und Timecode, Audio mit Lautheit und A/V-Versatz.

Jede Funktion im Einzelnen, mit dem, was an echter Hardware geprüft ist: **[docs/details.de.md](docs/details.de.md)**.

## Weiterlesen

| | |
|---|---|
| [Einzelheiten](docs/details.de.md) | alle Funktionen, Installation, Grenzen, Tests |
| [Anleitung: Eingänge](docs/manual/inputs.de.md) | Resolve, Fenster, Ordner, Capture-Karten, Dateien |
| [Steuer-API](docs/control-api.de.md) | HTTP und WebSocket, Companion-Modul |
| [Frame-Protokoll](docs/frame-protocol.de.md) | eigene Quellen an die Scopes anschließen |
| [docs/research](docs/research) | Messverfahren, Normen, Quellen |

## Autor

Von **Lars Zumpe**, Lars Zumpe Medienproduktion.

## Lizenz

Proprietär, © 2026 Lars Zumpe, alle Rechte vorbehalten. Nutzung der veröffentlichten Builds ist kostenlos; Weiterverbreitung und abgeleitete Werke sind es nicht ([LICENSE](LICENSE)). Kein Open Source: der Code ist öffentlich zum Lesen. Fremdkomponenten behalten ihre Lizenzen ([THIRD_PARTY.md](THIRD_PARTY.md)), Logo und Signet sind Marke und nicht frei verwendbar.

NDI® is a registered trademark of Vizrt NDI AB.
