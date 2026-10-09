# Windows-Leistung und NDI

Stand 09.10.2026. Anlass: Tester unter Windows meldeten NDI mit ca. 2 fps samt Fehlermeldung und eine Anzeige, die „nie über 30 fps“ kommt (#127). Der O(n²)-Fehler beim Zusammensetzen der Helfer-Daten ist mit #126 behoben. Alles Weitere unten ist Recherche, **nichts davon ist unter Windows gemessen**. „(Annahme)“ markiert eigene Ableitungen ohne Beleg.

## Maßnahmen nach Nutzen und Aufwand

| # | Maßnahme | Nutzen | Aufwand | Datei |
|---|---|---|---|---|
| 1 | Messwerte sammeln: Feedback-Bericht (#128) plus NDI-Zähler und Zeit je Stufe | hoch | klein | `helpers/ndi/lz-ndi.cpp`, `src/main.ts` |
| 2 | `preserveDrawingBuffer: false` | hoch | klein–mittel | `src/renderer.ts:415` |
| 3 | NDI: Empfang und Schreiben in getrennten Threads, „neuestes Bild gewinnt“ | hoch | klein | `helpers/ndi/lz-ndi.cpp` |
| 4 | NDI: Farbformat `fastest` (UYVY) als Standard, `best` (P216) als Präzisionsschalter | hoch | klein | `lz-ndi.cpp`, Quellenkarte |
| 5 | Synchrone Rücklesung (`cpuFrame`) aus dem Bildpfad nehmen, Statistik über `gpuStats` | hoch | mittel | `src/sources.ts` |
| 6 | NDI im Helfer verkleinern (Box-Filter auf ~960 px) statt in ffmpeg | hoch | mittel | `lz-ndi.cpp`, `server/helper-input.mjs` |
| 7 | iGPU erkennen und auf die Windows-Grafikeinstellungen hinweisen | mittel | klein | Feedback/Diagnose |
| 8 | Testschalter für das ANGLE-Backend und ohne Bildratenlimit (nur für Messungen) | mittel | klein | `electron/main.cjs` |
| 9 | Webcam: 60 fps anfordern, `getSettings()` anzeigen, Range-Übersteuerung | mittel | klein–mittel | `src/sources.ts` |
| 10 | Windows-Hinweise in der NDI-Fehlermeldung: Runtime-Link, Netzprofil „Privat“, Firewall | mittel | klein | `server/messages.mjs`, i18n |

## Anzeige bei 30 fps

**`preserveDrawingBuffer: true`** (`src/renderer.ts:415`). Mit `true` muss der Puffer vor jedem Tausch kopiert werden. Unter ANGLE/D3D11 kostet das eine Allokation und zwei Kopien je Bild; der Firefox-Bug nennt es „especially bad with ANGLE“ ([Bugzilla 1137876](https://bugzilla.mozilla.org/show_bug.cgi?id=1137876), [Khronos](https://www.khronos.org/webgl/public-mailing-list/public_webgl/1110/msg00011.php)). Mit `false` müssen Screenshots und Ausgabe-Rücklesungen im selben Task direkt nach dem Zeichnen passieren ([Babylon-Forum](https://forum.babylonjs.com/t/why-set-preservedrawingbuffer-as-true-in-example-code-but-keep-it-as-false/39282/2)). Vorher prüfen, ob `needClear`, Akkumulation oder `endFrame` auf den erhaltenen Puffer bauen.

**Synchrone GPU→CPU-Rücklesung.** `cpuFrame`, `sampleHistory` und `readbackFrame` in `src/sources.ts` holen das Bild per `drawImage(video)` + `getImageData`. Das wartet, bis die GPU fertig ist. PBO + Fence (wie `src/gpuStats.ts`) war in einer Messung etwa 3× schneller ([Babylon-Forum](https://forum.babylonjs.com/t/read-pixels-from-texture-asynchronously/19371)). Auf dem Mac teilt sich IOSurface den Speicher, darum fällt es dort nicht auf (Annahme). Alternative: `MediaStreamTrackProcessor` im Worker und `VideoFrame.copyTo` ([MDN](https://developer.mozilla.org/docs/Web/API/VideoFrame/copyTo)), nicht gemessen.

**Falsche GPU (Optimus/Hybrid).** Chromium nimmt unter Windows den ersten Adapter des Treibers; `powerPreference` blieb in Tests wirkungslos, seit Chrome 80 ist „low-power“ Standard ([Khronos](https://www.khronos.org/webgl/public-mailing-list/public_webgl/1912/msg00003.php)). `ForceDiscreteGPU` wirkt nur auf macOS ([gpu_switching.cc](https://chromium.googlesource.com/chromium/src.git/+/HEAD/gpu/config/gpu_switching.cc)). Wirksam: Windows-Einstellungen → Grafik → App auf „Hohe Leistung“ oder NVIDIA-Systemsteuerung ([NVIDIA](https://www.nvidia.com/content/Control-Panel-Help/vLatest/en-us/mergedProjects/nvcpl/Using_Optimus_Hybrid.htm), [AMD](https://amd.com/en/resources/support-articles/faqs/GPU-110.html)). `NvOptimusEnablement` müsste in die Electron-.exe kompiliert werden – nicht machbar ohne eigenen Build.

**Takt und Treiber.** DWM fällt bei hoher GPU-Last auf 30 Hz ([Bugzilla 1065233](https://bugzilla.mozilla.org/show_bug.cgi?id=1065233)); NVIDIA „Background Application Max Frame Rate“ kappte bei einem Nutzer auf 30 fps ([Brave-Forum](https://community.brave.app/t/hardware-acceleration-caps-fps-to-30/418811)); bei mehreren Monitoren zählt wohl der mit dem größten Fensteranteil ([Blur Busters](https://forums.blurbusters.com/viewtopic.php?p=25739)). Energiemodus „Beste Leistung“ beim Tester abfragen.

**Texturen.** `texSubImage2D` war unter ANGLE/D3D11 in einem Benchmark etwa 2× langsamer, `UpdateSubresource` blockiert auf Intel ab einer Datenmenge ([ANGLE](https://chromium.googlesource.com/angle/angle.git/+/refs/heads/chromium/2156), [WebRender](https://github.com/servo/webrender/wiki/Texture-Uploads)). Für RGBA16UI gibt es keinen Beleg – messen.

**Hintergrund-Drosselung.** Unter Windows gilt ein Fenster erst beim Minimieren als verborgen; Windows 11 kann bei verdeckten Fenstern Timer drosseln (EcoQoS, [Microsoft](https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-setprocessinformation)). `backgroundThrottling: false` für Ausgabefenster erwägen.

## NDI

**Empfangsschleife blockiert.** `recv_capture_v3` und `fwrite`+`fflush` laufen in einem Thread. Ist die Pipe voll, steht der Empfang; NDI hält nur eine kurze Warteschlange und verwirft dann ([NDI Recv](https://docs.ndi.video/all/developing-with-ndi/sdk/ndi-recv)). Abhilfe: Empfangs-Thread plus Schreib-Thread mit einem Platz „neuestes Bild“. Timeout 100 ms statt 1000 ms wie DistroAV ([ndi-source.cpp](https://github.com/DistroAV/DistroAV/blob/master/src/ndi-source.cpp)).

**Messwerte.** `NDIlib_recv_get_performance` (gesamt/verworfen), `recv_get_queue` und `recv_get_no_connections` je Sekunde als STAT melden – damit ist eindeutig, ob NDI, Helfer oder ffmpeg bremst ([NDI Recv](https://docs.ndi.video/all/developing-with-ndi/sdk/ndi-recv)).

**Farbformat und Bandbreite.** `fastest` liefert ohne Wandlung und ist der schnellste Weg; `best` gibt bei nativem NDI P216 (doppelte Datenmenge), bei HX ohnehin nur UYVY ([Performance](https://docs.ndi.video/all/developing-with-ndi/sdk/performance-and-implementation)). `bandwidth_lowest` holt den Proxy, meist 640×360 – als Sparmodus brauchbar, für 960-px-Waveform knapp ([Proxy](https://docs.ndi.video/all/getting-started/white-paper/bandwidth/ndi-proxy-and-bandwidth-optimization)). Umschalten zur Laufzeit nur mit Advanced SDK, sonst Empfänger neu anlegen.

**Datenmenge.** Ein 1080p-Bild geht als 4 MB (UYVY) bzw. 8 MB (P216) durch Helfer → Node → ffmpeg → Node → WebSocket; ffmpeg skaliert mit `-threads 1` und `flags=area`. libuv legt Windows-Pipes mit 64-KiB-Puffern an ([pipe.c](https://gemfury.com/squarecapadmin/python:gevent/-/content/deps/libuv/src/win/pipe.c)). Im Helfer auf ~960 px mitteln spart rund 4× Bytes; die Matrix-/Range-Logik muss dann mit Testbildern gegen den ffmpeg-Pfad geprüft werden (Annahme).

**framesync** dupliziert Bilder für die Anzeige ([Frame Sync](https://docs.ndi.video/all/developing-with-ndi/advanced-sdk/ndi-sdk-review/video-formats/frame-synchronization)) – verfälscht Bildzähler und fps. Bei `recv_capture` bleiben.

**Node-Addons** statt Helfer: `@stagetimerio/grandiose` 0.2.0 (Apache-2.0, Windows x64) ist gepflegt, braucht aber Electron-Rebuild und asar-Entpacken ([GitHub](https://github.com/stagetimerio/grandiose)); `@vygr-labs/ndi-node` steht unter GPL-3.0. Der eigene Helfer bleibt robuster (Absturzisolation).

**HX/HX3** dekodiert die Runtime selbst; manche Rechner schaffen nur einen Hardware-Stream ([Performance](https://docs.ndi.video/all/developing-with-ndi/sdk/performance-and-implementation)).

### Windows-Fallen bei NDI

- Runtime v6 liegt unter `C:\Program Files\NDI\NDI 6 Runtime\v6`, Variable `NDI_RUNTIME_DIR_V6` greift erst nach Neustart der App ([ofxNDI #49](https://github.com/leadedge/ofxndi/issues/49)). Fehlermeldung soll auf `ndi.link/NDIRedistV6` zeigen ([Dynamic Loading](https://docs.ndi.video/all/developing-with-ndi/sdk/dynamic-loading-of-ndi-libraries)).
- Reste alter Runtimes (6.0 → 6.1) verursachen Ladefehler; sauber neu installieren ([DistroAV-Wiki](https://github.com/DistroAV/DistroAV/wiki/2.-Troubleshooting)).
- Netzprofil „Öffentlich“ blockiert mDNS (224.0.0.251:5353), über Subnetze geht keine Suche; Firewall muss `lz-ndi.exe` freigeben ([NDI-Netzwerk-Whitepaper](https://avisystems.com/hubfs/website/partners/new-tek/ndi-networking-best-practice-white-paper.pdf), [Ross](https://documentation.rossvideo.com/files/Manuals/Routers/Ultrix/Application%20Notes/NDI_Networking_Appnote.pdf)).
- Nach Windows-Updates KB5063709/KB5063878 ruckelt NDI; Workaround Single-TCP oder UDP im Access Manager ([DistroAV-Wiki](https://github.com/DistroAV/DistroAV/wiki/2.-Troubleshooting)).
- **NDI Webcam Input** ist ein Empfänger, der NDI als Windows-Kamera bereitstellt ([NDI Tools](https://docs.ndi.video/using-ndi/ndi-tools/ndi-tools-for-windows/webcam-input)). Hat der Tester darüber eingespeist, lief der Kamera-Pfad, nicht der NDI-Helfer – beim Tester nachfragen.

## Webcam und Farbe

- Chrome erreicht niedrigere Bildraten durch Verwerfen; 30-fps-Grenzen kommen oft von YUY2 über USB 2 statt MJPEG oder von der Belichtungsautomatik bei wenig Licht ([W3C](https://lists.w3.org/Archives/Public/public-media-capture-logs/2017Jun/0061.html), [vMix](https://forums.vmix.com/posts/t8652-UVC-webcams-dropping-input-frames)).
- Bei MJPEG ist Full/Limited Range oft unklar; Media Foundation meldet teils falsch 16–235 ([Bugzilla 1161349](https://bugzilla.mozilla.org/show_bug.cgi?id=1161349)). OBS bietet Range je Quelle ([OBS](https://obsproject.com/forum/resources/full-vs-partial-color-ranges-explained-for-streaming.1029/)). Für lz-scopes: getUserMedia-Quellen als „RGB, Range angenommen“ kennzeichnen; für exakte Werte den Bridge-Pfad (dshow) nehmen.
- HDR in Windows: Chromium setzt den SDR-Weißwert auf 80 Nits; die Scopes messen Daten und sind nicht betroffen, der Bildmonitor schon ([Cobalt](https://cobalt.googlesource.com/cobalt/+/HEAD/ui/gfx/mojom/display_color_spaces.mojom)).

## Wie andere es machen

- **Nobe OmniScope** (Windows) teilt GPU-Texturen über Spout, statt Bilder durch CPU-Pipes zu schicken; NDI als eigener Eingang ([Digital Production](https://digitalproduction.com/2026/03/30/nobe-omniscope-is-a-live-act-now/)).
- **DistroAV (OBS)**: Empfangs-Thread, 100 ms Timeout, framesync wählbar, Hardware-Decode per Metadaten.
- **OBS**: Range und Farbraum je Quelle.

## Messplan für Windows

1. Feedback-Bericht (#128) von Testern: GPU-Renderer (SwiftShader? Intel statt NVIDIA?), Monitor-Hz, Energiemodus.
2. `chrome://gpu` und Perfetto-Mitschnitt; Task-Manager-Spalte „GPU-Engine“; PresentMon für die echte Darstellungsrate.
3. Vier Läufe mit rAF-Abstands-Histogramm: `preserveDrawingBuffer` aus · `cpuFrame` aus · `--use-angle=d3d11|d3d11on12|vulkan` · `--disable-frame-rate-limit`.
4. NDI getrennt: NDI-Zähler (Punkt 1), Bytes/s und Stücke je Bild in `helper-input.mjs`, Empfangsrate im Worker.
5. Webcam bei hellem Licht, `getSettings().frameRate` notieren.
