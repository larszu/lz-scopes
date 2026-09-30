# 10-bit-Ausgabe der Ausgabefenster (30.09.2026)

Wunsch: Die Ausgabefenster (`?out=` Testbilder, `?view=` Scope-/Bildausgaben) sollen mehr als 8 bit können. Vorarbeit: `ebu-video.md` Abschnitt (f).

## Geöffnete Quellen

- WHATWG HTML, Kapitel Canvas (`html.spec.whatwg.org/multipage/canvas.html`) und ImageData (`…/imagebitmap-and-animations.html`), abgerufen 30.09.2026
- Khronos WebGL 1.0 Specification, latest (`registry.khronos.org/webgl/specs/latest/1.0/`), Abschnitt zu `drawingBufferStorage`
- W3C WebGPU, Technical Report (`www.w3.org/TR/webgpu/`), §21.4 GPUCanvasConfiguration, GPUCanvasToneMappingMode
- chromestatus.com, Einträge 5086141338877952 (Canvas Floating Point Color Types), 5703719636172800 (HDR Support for HTMLCanvasElement), 5146687245123584 (WebGL drawingBufferStorage), 6196313866895360 (WebGPU extended range)
- Microsoft Learn: „Use DirectX with Advanced Color on high/standard dynamic range displays“
- Apple Developer: „Displaying HDR content in a Metal layer“
- lokal: `node_modules/ffmpeg-static/ffmpeg` 6.0 (ffmpeg-static 5.3.0, darwin-arm64) und dessen `ffmpeg.LICENSE`; `system_profiler SPDisplaysDataType`
- DeckLink: siehe `geraete-eingaenge.md` Abschnitt 2 (nicht erneut abgerufen)

Nicht geöffnet und deshalb ohne Beleg: die HDMI- und DisplayPort-Spezifikationen, NVIDIA- und AMD-Treiberseiten (der NVIDIA-Support-Artikel ließ sich nicht abrufen), die Lizenzbedingungen des DeckLink-SDK-Downloads.

## Browser-APIs

| Weg | Befund | Quelle |
|---|---|---|
| 2D-Canvas `colorType: 'float16'` | `enum CanvasColorType { "unorm8", "float16" }`: „16-bit floating point“ je Komponente; `getContextAttributes()` meldet den Typ zurück | WHATWG Canvas |
| ImageData float16 | `enum ImageDataPixelFormat { "rgba-unorm8", "rgba-float16" }`, Daten als `Float16Array`; `getImageData(…, { pixelFormat })` | WHATWG ImageData |
| PNG-Export | aus einem float16-Canvas „16 bits per sample“, Werte außerhalb 0–1 werden dabei geklemmt | WHATWG Canvas |
| WebGL `drawingBufferStorage` | legt Format und Größe des Drawing Buffers fest; RGBA8 immer, RGBA16F, wenn als Renderbuffer gültig (EXT_color_buffer_half_float/float). Mit `alpha: false` → INVALID_OPERATION. `readPixels` liefert dann RGBA/FLOAT | WebGL 1.0 Spec |
| WebGPU-Canvas | zulässige Formate nur `bgra8unorm`, `rgba8unorm`, `rgba16float` – **kein `rgb10a2unorm`**. `toneMapping.mode`: „standard“ (auf SDR begrenzt) oder „extended“ (Werte über 1 in den erweiterten Bereich des Bildschirms) | WebGPU §21.4 |
| Chrome-Status | drawingBufferStorage ab Chrome 122; WebGPU extended range ab 129; „Canvas Floating Point Color Types“ dort noch als „Proposed“, „HDR Support for HTMLCanvasElement“ „In development“ | chromestatus |

Eigene Messung (Chrome 154 und Electron 44 auf dem M1-Pro-MacBook, CDP-Skript im Scratchpad):

| Umgebung | float16-2D | Rundlauf 1024 Codes | RGBA16F | WebGPU rgba16float/extended | `screen.colorDepth` | `dynamic-range: high` |
|---|---|---|---|---|---|---|
| Chrome headless, SwiftShader | ja | 0 Fehler | ja | kein Adapter | 24 | nein |
| Chrome headless, GPU | ja | 0 Fehler | ja | ja | 24 | nein |
| Chrome mit Fenster, internes XDR-Display | ja | 0 Fehler | ja | ja | **30** | **ja** |
| Electron 44 (E2E-Test, Fenster) | ja | 1024 Codes der Rampe exakt | ja | – | – | – |

Außerdem gemessen: WebGL-RGBA16F-Buffer → `drawImage` in einen float16-2D-Canvas → `getImageData` float16: alle 1024 Codes unverändert. Damit bleibt auch die Zusammensetzung der Scope-Fenster für den Stream über 8 bit.

Rechnung: float16 hat 11 bit Mantisse (10 + 1 implizit); im Bereich 0,5–1 beträgt der Abstand 2⁻¹¹, feiner als 1/1023. Jeder 10-bit-Code überlebt als code/1023 (Test `test/deep.test.ts`, alle 1024 Codes).

**Entscheidung:** Testbildfenster auf 2D-Canvas float16 (die Muster brauchen exakte Codes und keine GPU), Scope-Fenster auf WebGL-RGBA16F (der Renderer ist WebGL2). WebGPU wäre ein dritter Renderer – kein Gewinn, `rgb10a2unorm` gibt es für Canvas nicht. Chromium-/Electron-Flags sind dafür keine nötig (gemessen).

## Betriebssystem, Grafikkarte, Kabel

- **Windows:** Ohne Advanced Color begrenzt der DWM Fenster-Apps auf 8 bit je Kanal, „even if the display supported a higher bit depth“. Mit Advanced Color setzt der DWM in FP16 zusammen. Für SDR-Displays gibt es das ab Windows 11 22H2 (entsprechend eingerichtete Displays); HDR-Signalisierung über HDMI/DP nutzt „primarily 10 bits per channel“ (Microsoft Learn). Folge: unter Windows ohne HDR/Advanced Color bleibt das Fenster 8 bit, auch wenn der Browser float16 rechnet.
- **macOS:** EDR = Pixelwerte über dem SDR-Bereich; Displays wie das Pro Display XDR haben immer Headroom, andere nur je nach Helligkeitseinstellung (Apple). Über die Bittiefe zum Panel sagt die Seite nichts. `system_profiler` zeigt auf Apple Silicon keine Framebuffer-Tiefe (hier geprüft). Chrome meldet am internen XDR-Display 30 bit und `dynamic-range: high`; das ist die Selbstauskunft des Systems, kein Nachweis am Panel.
- **Kabel, Grafikkarte, Treiber:** nicht aus Primärquellen belegt. Eigene Rechnung: 3840×2160p60 braucht 594 MHz Pixeltakt; bei 10 bit RGB/4:4:4 sind das 742,5 MHz TMDS, über den 600 MHz von HDMI 2.0 – dort gehen 10 bit bei 4K60 nur mit Chroma-Unterabtastung. Bei 4:2:2 liegt die Farbinformation nur halb aufgelöst vor; für Testbilder mit feinen Farbkanten ist 4:4:4/RGB bei niedrigerer Bildrate die bessere Wahl. Ob die Grafikkarte 10 bit ausgibt, stellt der Treiber ein (z. B. „Ausgabefarbtiefe“) – nicht geprüft.

## Nachweis, dass 10 bit am Monitor ankommen

| Weg | Aussagekraft |
|---|---|
| Rücklesen aus dem Canvas (`getImageData` float16, `readPixels` FLOAT) | belegt die Pipeline bis zum Browser-Puffer – nicht den Monitor. Die App zeigt das als „Pipeline: …“ |
| OS-Anzeige (`screen.colorDepth`, Windows „Erweiterte Anzeige“ → Bittiefe) | Selbstauskunft, Hinweis; die App schreibt „Browser meldet … bit“ |
| Banding-Test (Muster „10-bit-Rampe“) | Sichtprüfung: obere Hälften 10 bit, untere dieselben Codes über einen 8-bit-Pfad. Gleiches Aussehen → 8 bit in der Kette. Braucht ein ruhiges Auge und einen Monitor ohne eigenes Dithering |
| 10-bit-Capture per HDMI-Loop/Splitter | echter Beleg: Rampe aufnehmen, Codes 504…519 müssen einzeln ankommen. Hier nicht vorhanden |
| DeckLink-Ausgabe / 10-bit-Stream | Bittiefe durch den Weg garantiert (v210) – prüfbar mit dem Empfänger, siehe unten |

**Die App behauptet deshalb nie „10 bit am Monitor“.** Sie zeigt die Pipeline, die Selbstauskunft des Browsers und „Monitor-Bittiefe unbekannt“.

## Garantierte Bittiefe: 10-bit-Stream über die Bridge

ffmpeg-static 5.3.0 (darwin-arm64, ffmpeg 6.0) hat `libx265` (yuv420p10le, yuv422p10le, yuv444p10le), `prores_ks` (yuv422p10le …), `v210`, `v410`, `r210`, aber **kein SRT** (Protokolle: tcp, udp, rtp, rtmp, …). Homebrew-ffmpeg hat SRT; die Bridge nimmt für `srt://` das erste ffmpeg mit SRT.

Umsetzung (`server/out10.mjs`): Das Fenster rechnet die Codes selbst nach Y′CbCr 4:2:2 10 bit (BT.2100-3 Tab. 9) und schickt yuv422p10le; ffmpeg bekommt keine Farbumrechnung mehr.

| Codec | Container | Ziel | Befund |
|---|---|---|---|
| `v210` | NUT | tcp, srt, udp | bit-exakt – gemessen im Test und in der E2E-Kette Fenster → Bridge → ffmpeg. **ffmpegs v210-Encoder begrenzt auf 4…1019**: 0–3 und 1020–1023 (Full-Range-Extreme) kommen als 4 bzw. 1019 an (gemessen) |
| `hevc10` | MPEG-TS/RTSP | udp, tcp, srt, rtp, rtsp | Empfänger meldet `hevc (Main 10)`, `yuv420p10le(tv, bt709…)` (Test) |
| `hevc422` | MPEG-TS/RTSP | wie oben | Main 4:2:2 10 – weniger Decoder |
| `prores` | NUT | tcp, srt, udp | 422 HQ; nicht mit Empfänger geprüft |

RTMP ist ausgeschlossen: ffmpeg 6.0 meldet „Video codec hevc not compatible with flv“ (gemessen).

**Lizenz:** `libx265` ist GPL wie das schon genutzte `libx264`; der Weg läuft über die Kommandozeile wie bisher (THIRD_PARTY.md). **Befund dabei:** `ffmpeg -L` des mitgelieferten ffmpeg-static meldet „This version of ffmpeg has nonfree parts compiled in. Therefore it is not legally redistributable.“ (Build mit `--enable-nonfree`). Das betrifft die ausgelieferte Desktop-App insgesamt, nicht nur diese Funktion – **Entscheidung für Lars**.

## DeckLink-Ausgabe (nächster Schritt, nicht gebaut)

Der vorhandene Helfer `helpers/decklink/lz-decklink.cpp` nimmt nur auf. Eine Ausgabe (IDeckLinkOutput, `bmdFormat10BitYUV` = v210) wäre derselbe Aufbau: yuv422p10le aus der Bridge → v210-Packung → `ScheduleVideoFrame`. Die Header-Lizenz ist freizügig, die Bedingungen des SDK-Downloads sind nicht eingesehen (siehe `geraete-eingaenge.md`). Solange das nicht geklärt ist und keine Karte zum Testen da ist, bleibt es beim 10-bit-Stream.
