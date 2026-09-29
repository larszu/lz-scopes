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

Nicht eingesehen: die Lizenzbedingungen des SDK-Downloads selbst (hinter der Registrierung). Die Aussage im Issue „SDK-Lizenz erlaubt Weitergabe von Apps“ ist damit **nicht belegt**; belegt ist nur die freizügige Header-Lizenz.

Entscheidung: eigener Helfer `helpers/decklink/lz-decklink.cpp`, SDK nicht im Repository, Build mit `DECKLINK_SDK_DIR`. Zum Kompiliertest wurden die 12.0-Header nur in ein temporäres Verzeichnis geladen. Pixelformate laut Header `DeckLinkAPIModes.h`: `bmdFormat10BitYUV` = 'v210', `bmdFormat10BitRGB` = 'r210' „Big-endian RGB 10-bit per component with SMPTE video levels (64-960)“. HDR-EOTF-Kennung „in range 0-7 as per CEA 861.3“ (`bmdDeckLinkFrameMetadataHDRElectroOpticalTransferFunc`).

v210-Zeilenlänge: 48 Pixel je 128 Byte; nachgeprüft an ffmpegs v210-Encoder (1280×720 → 3456 Byte/Zeile). ffmpeg hat einen v210-Demuxer (`-f v210`), einen r210-Rohdemuxer nicht brauchbar (Paketgröße falsch) – daher wandelt der Helfer r210 selbst in `rgb48le`.

**AJA (Notiz):** NTV2-SDK ist laut Issue MIT-lizenziert; nicht recherchiert, nicht umgesetzt. Der Helfer-Weg (Helfer-Protokoll → Bridge) passt ohne Bridge-Änderung.
