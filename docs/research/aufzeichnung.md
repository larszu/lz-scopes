# Lokale Aufzeichnung der Quellen

Stand 10.10.2026. Umsetzung von Schritt 5 aus [kamera-abgleich.md](kamera-abgleich.md) (Issue #140). Zweck: einen Kamera-Abgleich nachträglich prüfen (vorher/nachher, Drift über die Show), Kameras ohne Live-Zugriff vergleichen, Belege für Kunden.

## Architektur

```
Quelle ──► ffmpeg der Quelle ──► Ausgang 1: Analysebild (rawvideo/H.264 → WebSocket)
                              └► Ausgang 2: Segment-Muxer (Kopie oder ProRes/DNxHR/HEVC/FFV1)
                                     └► Segmentliste (CSV) ──► Bridge: Begleitdatei (JSON)
```

- **Ein Prozess, zwei Ausgänge** (`server/recorder.mjs`, `server/record.mjs`). DeckLink, V4L2 und AVFoundation lassen sich nicht zweimal öffnen, Netzwerkkameras sollen keine zweite Sitzung bekommen. Die Aufnahme ist deshalb ein weiterer Ausgang desselben ffmpeg, der auch das Analysebild liefert (`ffmpegArgs({ extra })` in `server/index.mjs`, bei DeckLink/NDI in `server/helper-input.mjs`).
- **Start/Stopp = Neustart des ffmpeg.** ffmpeg kann einem laufenden Prozess keinen Ausgang hinzufügen. Der alte Prozess endet sauber (SIGINT bzw. Ende der Eingabe bei RTP-Eigenempfang und Helfern), damit der MOV-Index des letzten Segments geschrieben wird; der WebSocket bleibt offen, die Bilder laufen nach dem Neustart weiter. Die Segmentnummern laufen über Neustarts weiter (`-segment_start_number`).
- **Segment-Muxer** mit `-reset_timestamps 1`, Container Matroska oder MOV. Jedes fertige Segment meldet ffmpeg als CSV-Zeile `datei,start,ende` auf `pipe:4` (POSIX; mit `-segment_list_size 0` hängt ffmpeg an und spült nach jeder Zeile, die Liste wird nicht neu geschrieben). Unter Windows schreibt ffmpeg die Liste in eine Datei, die Bridge liest sie alle 100 ms nach.
- **Netzwerkquellen** `-map 0:v:0 -map 0:a:0? -c copy` (MOV: Ton als PCM, HEVC mit `hvc1`-Tag). Im RTP-Eigenempfang liest ffmpeg die Access Units als Matroska von stdin (`server/mkv.mjs`) und kopiert sie unverändert in die Datei.
- **Unkomprimierte Quellen** in der vollen Quellauflösung (der Analyse-Ausgang skaliert für sich):

| Wahl | ffmpeg | Bemerkung |
|---|---|---|
| ProRes 422 HQ | `prores_ks -profile:v 3 -vendor apl0 -pix_fmt yuv422p10le` | Standard, intra |
| DNxHR HQX | `dnxhd -profile:v dnxhr_hqx -pix_fmt yuv422p10le` | intra |
| HEVC 10 bit | `hevc_videotoolbox` / `hevc_nvenc` / `hevc_qsv` / `hevc_amf` / `hevc_vaapi`, `-profile:v main10 -pix_fmt p010le`, ≈ 0,5 bit je Pixel und Bild (1080p50 ≈ 52 Mbit/s) | Rückfall libx265 (`-crf 16`), sonst ProRes |
| FFV1 | `ffv1 -level 3 -g 1 -slices 16 -slicecrc 1`, Pixelformat der Quelle | verlustfrei, immer Matroska |

  Der HEVC-Encoder wird je ffmpeg einmal mit einer kurzen Testkodierung ausgewählt (`pickHevcEncoder`): ein gelisteter Hardware-Encoder kann ohne GPU oder Treiber trotzdem scheitern.
- **Browser-Quellen** (`src/record/browser.ts`): MediaRecorder (WebM VP9/VP8 bzw. MP4), Teile je Segmentlänge über `ws://…/record-upload`. Der Testbild-Generator zeichnet in eine Canvas außerhalb des Dokuments; `canvas.captureStream()` liefert dafür keine Bilder (Chromium erfasst nur gemalte Canvas). Die Quelle füttert deshalb einen `MediaStreamTrackGenerator` Bild für Bild mit `VideoFrame`s.

## Zeitbezug

- Die Segmentzeile kommt, wenn ffmpeg das nächste Segment beginnt, also wenn das Bild am Segmentende ankam. Wanduhr des Segmentanfangs = Zeitpunkt der Zeile − (Ende − Anfang). Der erste Wert ist der Start der Aufnahme (`start.utcMs`), dazu die PTP-Zeit desselben Augenblicks aus dem PTP-Monitor der Bridge (`start.ptp`, `start.clock` = `ptp` oder `system`).
- Bei Testbildern mit `-re` liest ffmpeg die ersten 0,5 s auf einmal (`-readrate_initial_burst`), die Zeit liegt dort bis 0,5 s zu früh; bei Live-Quellen entfällt das. Hardware-HEVC verzögert um einige Bilder.
- Timecode: der erste nach dem Start gefundene Timecode der Quelle (showinfo: GOP-Header bzw. SEI) in `start.timecode`.
- Latenz: die vom Analysepfad gemessene Latenz (gestempelte Testbilder, `src/latency.ts`) in `latencyMs`, sonst `null`.

## Begleitdatei

`<Name>.json` neben den Segmenten, atomar geschrieben (temporäre Datei + Umbenennen) bei Start, jedem Segment, Marker, Ereignis und Stopp:

```json
{
  "format": "lz-scopes-recording", "version": 1, "take": "20261010-213005",
  "source": { "name": "Kamera 1", "url": "rtsp://10.0.0.5/stream1" },
  "settings": { "transfer": "auto", "colorspace": "auto", "chain": { "lut1": "…" }, "effective": { "transfer": "sdr", "colorspace": "709", "gamut": "709" } },
  "latencyMs": 84,
  "video": { "mode": "copy", "codec": "copy (h264)", "encoder": null, "container": "mkv", "width": 1920, "height": 1080, "fps": 50, "audio": true, "segmentSeconds": 300 },
  "start": { "requestedUtcMs": 1791662672553, "utcMs": 1791662672518, "utc": "2026-10-10T20:04:32.518Z", "ptp": 1791662709.518, "clock": "system", "timecode": "10:00:00:00" },
  "segments": [{ "file": "Kamera_1_000.mkv", "start": 0, "end": 300, "utcMs": 1791662672518, "bytes": 375000000 }],
  "markers": [{ "t": 2.5, "utcMs": 1791662675053, "label": "M1" }],
  "events": [{ "t": 12.0, "utcMs": 1791662684518, "kind": "paint", "data": { "black": -0.5 } }],
  "end": { "utcMs": 1791662685054, "utc": "2026-10-10T20:04:45.054Z", "reason": "user" }
}
```

Zugangsdaten werden aus der URL entfernt. `t` ist in Sekunden ab dem ersten Bild. `events` nimmt über `record.event` (Steuer-API) bzw. die WebSocket-Nachricht `{type:"event", kind, data}` beliebige Ereignisse auf; Schritt 4 (Schleife über lz-camera-bridge) schreibt dort die Paint-Änderungen hinein.

## Sicherheit

- Zielordner wie die Watch-Ordner (`server/folder.mjs`): nur freigegebene (`--record-dir`, `LZS_RECORD_DIRS`, in der Desktop-App *Filme/Videos › LZ Scopes* und per nativem Dialog gewählte). Der Client nennt den Ordner beim Namen, Aufnahme- und Quellname werden bereinigt, das Ergebnis muss im freigegebenen Ordner liegen.
- Aufnahmen schreiben Dateien: Die Befehle auf `/stream` und `/record-upload` nimmt die Bridge nur von der lokalen App gleicher Herkunft (Loopback + Origin) oder mit Steuer-Token an.
- Größe begrenzt durch die Platzprüfung: Start nur mit Platz für zwei Segmente plus 1 GB, alle 5 s Prüfung, unter 1 GB endet die Aufnahme.

## Gemessen (MacBook, Apple Silicon, ffmpeg 9.0.2-lzs1)

| Fall | Ergebnis |
|---|---|
| `test:bars` → ProRes 422 HQ, 10-s-Segmente, 12,96 s | 2 Segmente, 250 + 74 Bilder (= 25 fps), PCM 24 bit, ffprobe liest beide |
| UDP/MPEG-TS H.264 + AAC → Kopie | 250 + 23 Bilder, AAC kopiert, keine Neukodierung |
| `test:testsrc` → HEVC 10 bit | `hevc_videotoolbox`, Main 10, `yuv420p10le` |
| ffmpeg mit SIGKILL mitten im 4. Segment (MOV) | Segmente 1–3 vollständig lesbar, Bildzahl = Dauer × 25 |
| Desktop-App: Testbild-Generator per MediaRecorder | WebM, ffprobe liest es |

Tests: `test/record.test.ts` (Zielordner, Argumente, Segmentliste, Begleitdatei, Platzprüfung, Steuerbefehle; mit dem mitgelieferten ffmpeg: Absturz kostet höchstens ein Segment, Bridge-Aufnahme mit lückenlosen Segmenten), `e2e/record.spec.ts` (Knopf der Quellenkarte, `record`/`record.mark` über die Steuer-API, Browser-Quelle).

## Ungeprüft

- NVENC, Quick Sync, AMF und VAAPI (keine Hardware am Prüfplatz); die Auswahl per Testkodierung fällt dort auf libx265 bzw. ProRes zurück.
- DeckLink- und NDI-Aufnahme mit echter Hardware bzw. echten Quellen im Netz. NDI kommt über den Helfer dekodiert an und wird neu kodiert; ein Kopieren von NDI|HX gibt es nicht.
- Die Bridge unter Windows (Segmentliste per Datei, Stopp ohne SIGINT: das letzte MOV-Segment kann dort fehlen, Matroska bleibt lesbar).
- RTP-Eigenempfang und getrennter Tonprozess (`LZS_AUDIO_SPLIT`, Windows-Ersatzweg): Aufnahme nur mit Bild, weil der Ton in einem anderen Prozess liegt.
