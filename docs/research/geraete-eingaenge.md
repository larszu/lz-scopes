# Geräte- und Programm-Eingänge – Recherche (#18, #26, #4)

Stand: 30.09.2026. Nur Quellen, die tatsächlich geöffnet wurden; Einschätzungen sind als solche markiert.

## 1. Capture-Karten über ffmpeg (`device:`)

Geöffnet: ffmpeg-Quellen `libavdevice/dshow.c`, `libavdevice/v4l2.c` (GitHub-Spiegel FFmpeg/FFmpeg, 30.09.2026) und die Ausgaben von ffmpeg 8 (Homebrew) mit der FaceTime-Kamera des Test-Macs.

- **avfoundation** (macOS): Eine unmögliche Bildrate (`-framerate 1`) lässt ffmpeg „Supported modes“ ausgeben, ein nicht unterstütztes Pixelformat (`-pixel_format gray`) „Supported pixel formats“. Ohne `-video_size` nimmt avfoundation einen beliebigen Modus – beim Test-Mac 1552×1552 statt 1920×1080. Ein nicht angebotenes Pixelformat wird **stillschweigend** durch das erste angebotene ersetzt („Overriding selected pixel format“), der Aufruf scheitert nicht. Die avfoundation-Tabelle kennt `yuv422p10`, `yuv422p16`, `yuv444p10`, `bgr48be`; `p010le` kennt sie nicht.
- **dshow** (Windows): `-list_options true` schreibt je Pin-Format `pixel_format=<fmt>` bzw. `vcodec=<codec>` und `min s=WxH fps=… max s=WxH fps=…`, bei gesetzten Farbangaben dahinter `(range, space/prim/trc, chroma)` (dshow.c, Zeilen um 929–946).
- **v4l2** (Linux): `-list_formats all` schreibt `Raw : <fmt> : <Beschreibung> : <Größen>` bzw. `Compressed: …` (v4l2.c, Zeilen 315–323).
- **Umsetzung:** `server/devices.mjs` liest diese Listen, wählt ohne Vorgabe das tiefste Rohformat (10/16 bit vor 8-bit-4:2:2, komprimierte nie freiwillig) und auf macOS den größten 16:9-Modus. Modus, Rate, Pixelformat, Matrix und Pegel lassen sich pro Quelle fest einstellen. Gemessen am Test-Mac: FaceTime-Kamera 1920×1080 uyvy422 bei 30 fps über die Bridge.
- **Befund swscale (betrifft die ganze Bridge, nicht nur Geräte):** 10-bit Y′ = 940 (100 % nach BT.709, begrenzter Bereich) kommt in `rgba64le` als 65283 statt 65535 an, Y′ = 502 als 32641 statt 32768 – ein Verstärkungsfehler von ≈ 255/256 (−0,39 %). Unabhängig von `accurate_rnd`/`full_chroma_int`. Gemessen mit ffmpeg 8 am 30.09.2026. Eine Umwandlung im Shader (roher Y′CbCr-Transport) würde das beheben.

## 2. Blackmagic DeckLink / UltraStudio (#18)

Geöffnet:
- blackmagicdesign.com/developer/products/capture-and-playback/sdk-and-software – „Desktop Video 16.0 SDK“, für macOS, Windows, Linux; Download über „Register and Download“. Lizenztext auf der Seite: keiner.
- sdk-doc.blackmagicdesign.com/decklink-sdk/ (nur Suchergebnis-Auszug): SDK für Windows, macOS, Linux.
- DeckLink-SDK-Header 12.0 (Kopie im OBS-Repository, `plugins/decklink/mac/decklink-sdk/`): eigene Lizenz von Blackmagic Design, „Permission is hereby granted, free of charge, to any person or organization … to use, reproduce, display, distribute, execute, and transmit the Software, and to prepare derivative works …“; der Hinweis muss in allen Kopien bleiben, außer in reinem Maschinencode. Gilt für die Header und `DeckLinkAPIDispatch.cpp`.
- ffmpeg `configure` (GitHub-Spiegel, 30.09.2026): `EXTERNAL_LIBRARY_NONFREE_LIST="decklink libfdk_aac libmpeghdec"` – ein ffmpeg mit `--enable-decklink` ist nonfree und nicht weitergebbar.
- github.com/amiaopensource/decklinksdk: inoffizielle Sammlung „openly-licensed SDK files“ aus einem früher öffentlichen SDK-Zip 10.1.4.

**SDK-EULA** (geöffnet am 06.10.2026: https://www.blackmagicdesign.com/EULA/DeckLinkSDK leitet auf das PDF „End User License Agreement for the Software Development Kit“ weiter):
- §0.1: „Clauses 1, 4.3, 4.4, 5, 7, 8 of these terms and conditions do not apply to those files of the SDK contained in the following sub-folders …: /Mac/Include /Win/Include /Linux/Include“. Für diese Dateien gilt die Header-Lizenz oben.
- §1.2: Erlaubt ist unter anderem „creating software that will be compatible with the Licensor’s products“.
- §6.2: Erlaubte Bezeichnungen sind nur „XXX compatible with Blackmagic Design YYY“ und „XXX for Blackmagic Design YYY“ (YYY u. a. „DeckLink“). UltraStudio steht nicht in dieser Liste; UI und README schreiben deshalb „kompatibel mit Blackmagic Design DeckLink“.
- Der Treiber (Desktop Video) wird nicht mitgeliefert. `DeckLinkAPIDispatch.cpp` (macOS/Linux) bzw. COM (Windows) lädt ihn zur Laufzeit.

Folge (06.10.2026): CI baut den Helfer für macOS (universal) und Windows und packt ihn in die Installer. Die Include-Dateien holt `scripts/decklink-sdk-fetch.mjs` aus dem OBS-Repository (Commit `a93fae1`). Jede Datei wird per Git-Blob-Hash geprüft (`scripts/decklink-sdk.json`); im Repository liegen die Dateien nicht. Ohne Desktop Video meldet der Helfer „Blackmagic Desktop Video ist nicht installiert (DeckLink-Treiber fehlt)“, und die Oberfläche zeigt genau das an.

Entscheidung: eigener Helfer `helpers/decklink/lz-decklink.cpp`, SDK nicht im Repository. Gebaut wird mit den Include-Dateien 12.0 aus `npm run decklink:fetch` oder mit `DECKLINK_SDK_DIR`. Pixelformate laut Header `DeckLinkAPIModes.h`: `bmdFormat10BitYUV` = 'v210', `bmdFormat10BitRGB` = 'r210' „Big-endian RGB 10-bit per component with SMPTE video levels (64-960)“. HDR-EOTF-Kennung „in range 0-7 as per CEA 861.3“ (`bmdDeckLinkFrameMetadataHDRElectroOpticalTransferFunc`).

v210-Zeilenlänge: 48 Pixel je 128 Byte; nachgeprüft an ffmpegs v210-Encoder (1280×720 → 3456 Byte/Zeile). ffmpeg hat einen v210-Demuxer (`-f v210`), einen r210-Rohdemuxer nicht brauchbar (Paketgröße falsch) – daher wandelt der Helfer r210 selbst in `rgb48le`.

**AJA (Notiz):** NTV2-SDK ist laut Issue MIT-lizenziert; nicht recherchiert, nicht umgesetzt. Der Helfer-Weg (Helfer-Protokoll → Bridge) passt ohne Bridge-Änderung.

## 3. NDI® (#26)

Geöffnet (30.09.2026):
- docs.ndi.video/all/developing-with-ndi/sdk/licensing – SDK „royalty-free, subject to the SDK terms and conditions“; Pflichten: Link auf ndi.video „in a location close to all locations where NDI is used/selected“, Schreibweise „NDI®“ mit dem Satz „NDI® is a registered trademark of Vizrt NDI AB“ nahe der ersten Nennung und in der About-Box; NDI-DLLs im eigenen App-Ordner, nicht im Systempfad; NDI Tools nicht selbst verteilen, sondern auf ndi.video/tools verlinken; „NDI“ im Produktnamen nur nach Rückfrage. Die 5- bzw. 30-Minuten-Testlaufzeit gilt nur für das **Advanced SDK**.
- docs.ndi.video/all/developing-with-ndi/sdk/software-distribution – Runtime darf mit eigenem Installer verteilt werden, wenn die eigene EULA die NDI-Bedingungen abdeckt; alternativ Link auf die offizielle Runtime. **Header:** „open-source projects have the right to include the header files within their distributions, which may then be used with dynamic loading of the NDI libraries“ (MIT).
- NDI-SDK-Header 6.3 (Kopie im Repository DistroAV/DistroAV, `lib/ndi/`): MIT-Hinweis „applies to this file ONLY and not to the SDK as a whole“; Bibliotheksnamen `libndi.dylib`, `libndi.so.6`, `Processing.NDI.Lib.x64.dll`, Umgebungsvariable `NDI_RUNTIME_DIR_V6`. Zu `NDIlib_recv_color_format_best`: „P216, or UYVY“, Halbbilder können einzeln kommen.
- ffmpeg: Commit 4b32f8b3eb (09.03.2019) „lavd: Remove libndi_newtek“ – ffmpeg hat keinen NDI-Eingang mehr (eingeführt 2634927fe3, 2017). Den Hintergrund (Lizenzstreit) nicht selbst gelesen.
- Homebrew-Cask `libndi` (Paket `libNDI_for_Mac.pkg`, Version 6.3.2.0, Installationsort `/usr/local/lib`), Lizenzdatei `libndi_licenses.txt` im Paket.

Entscheidung: kein NDI-Code und keine Runtime im Repository oder in der App. Eigener Helfer `helpers/ndi/lz-ndi.cpp`, der die vom Nutzer installierte Runtime dynamisch lädt; nötige Deklarationen in `helpers/ndi/ndi-min.h` aus den MIT-Headern (Hinweis in `licenses/ndi-sdk-headers-MIT.txt`). UI: „NDI®“, Link auf ndi.video und Markenhinweis an der Quellenkarte, Markenhinweis in der About-Box der Desktop-App. Ein Node-Addon war nicht nötig.

Test: Runtime 6.3.2 nur in ein temporäres Verzeichnis entpackt (nicht installiert, `NDI_RUNTIME_DIR_V6`), eigener Testsender (`--send-test`, P216) → Suche → Empfang → Bridge → 16-bit-RGBA, Loopback auf einem Rechner. NDI Tools (Test Patterns) nicht installiert. Nicht geprüft: echte Quellen im Netz, NDI HX, Windows, Linux.

## 4. DaVinci Resolve, Lightroom, Capture One (#4)

Bestand vor #4-Abschluss: Quelle *DaVinci Resolve* (Scripting-API, `server/resolve_helper.py`, 16-bit-TIFF, getestet mit Resolve Studio 21.1), *Bildschirm/Fenster* mit Zuschnitt auf den Viewer, *Ordner* im Browser (File System Access API, nur 8-bit-Formate des Browsers).

Ergänzt:
- **Watch-Ordner in der Bridge** (`server/folder.mjs`, `folder:<Name>`): neuestes Standbild (TIFF, DPX, PNG, JPEG, WebP, EXR) in voller Tiefe über ffmpeg, auch auf entfernten Bridges. Freigabe nur ausdrücklich (`--watch-dir`, `LZS_WATCH_DIRS`, in der Desktop-App per Ordnerdialog); Clients sehen nur den Namen, nie den Pfad. Eine Datei wird erst gelesen, wenn Größe und Zeit über einen Abfragetakt (500 ms) gleich bleiben. Geprüft in vitest: 16-bit-TIFF 0x8000 kommt als 0x8000 an, 10-bit-DPX als 514/1023.
- **Export-Wege in der Oberfläche** (Karte *Ordner* → „Lightroom, Capture One, Resolve“): Lightroom-Classic-Export mit Vorgabe, Capture-One-Verarbeitungsrezept, Resolve-Standbild aus der Galerie. Diese Menüwege sind aus der Produktkenntnis beschrieben und **nicht** an den installierten Programmen (Lightroom Classic, Capture One 20/21 auf dem Test-Mac) nachgeklickt.
- **Resolve-Scripting-Weg** (vorhanden, dokumentiert): `Project.ExportCurrentFrameAsStill(path)` im Helfer, Voraussetzung Resolve Studio mit *Einstellungen → System → Allgemein → Externes Scripting: Lokal* und Python 3. Die Scripting-Module liegen unter `…/Developer/Scripting/Modules`, die Bibliothek `fusionscript.so/.dll` (Pfade im Helfer).

Grenzen: eingebettete ICC-Profile werden nicht gelesen (Adobe RGB/ProPhoto-Exporte erscheinen als Rec.709-Primaries, sofern nicht an der Quelle umgestellt). Der Resolve-MCP-Server dieser Arbeitsumgebung war nicht verbunden (venv fehlt) und wurde nicht repariert.

## 5. Laufende Resolve-Instanzen erkennen (06.10.2026)

Geöffnet: `Developer/Scripting/README.md` und `Modules/DaVinciResolveScript.py` der lokalen Installation (Resolve Studio 21.1.1, Changelog „Last Updated: 1 Sep 2026“).

- „In DaVinci Resolve Studio, Preferences > System > General, you can configure: External scripting … (None, Local, or Network).“ Ohne diese Einstellung liefert `scriptapp("Resolve")` nichts.
- „DaVinci Resolve Studio and Fusion Studio scripting listens on port 1144 (registered with IANA for this purpose)“; mit „Network“ ist Zugriff aus dem LAN möglich. `fusionscript.scriptapp("Resolve", "<ip>")` nimmt eine Adresse an (geprüft mit 127.0.0.1).
- Lokal gemessen: `scriptapp` antwortet in 0,14 s mit Produkt, Version, Seite, Projekt und Timeline, während Resolve läuft; ohne laufendes Resolve sofort leer.

Entscheidung:
- Die Bridge prüft zuerst die Prozessliste (`pgrep -x Resolve` bzw. `tasklist`) und fragt erst dann die Scripting-API (`resolve_helper.py --probe`, Ergebnis 3 s zwischengespeichert). `/api/resolve` liefert den Zustand, die Seitenleiste zeigt „DaVinci Resolve Studio 21.1.1 läuft · Projekt / Timeline · Verbinden“. Läuft Resolve ohne externes Scripting, sagt sie, wo man es einschaltet, und bietet kein Verbinden an.
- **Kein Netzwerk-Scan:** Über Port 1144 wäre eine entfernte Instanz erreichbar, aber `ExportCurrentFrameAsStill` schreibt das Standbild auf deren Platte. Für ein Resolve auf einem anderen Rechner läuft dort eine Bridge (Feld *Bridge* der App); deren Seitenleiste zeigt dann diese Instanz.
