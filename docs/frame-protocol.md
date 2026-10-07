# LZ Scopes – Frame-Protokoll

Ein WebSocket liefert unkomprimierte Einzelbilder an den Browser. Die Bridge dieses Repos (`/stream?url=…`) spricht es, und jeder Host kann es nachbauen, zum Beispiel lz-camera-bridge unter `/scope/<n>`. Auf der Browserseite verbindet `Source.connectFrames(wsUrl)`.

| Richtung | Typ | Inhalt |
|---|---|---|
| Server → Client | Text | `{"type":"info","width":960,"height":540,"depth":8\|16,"fps":25,"sourceWidth":1920,"sourceHeight":1080,"codec":"h264","transfer":"smpte2084","primaries":"bt2020","matrix":"bt2020nc","range":"tv","decodeMatrix":"bt2020"}` vor dem ersten Bild |
| Server → Client | Binär | ein Bild: `width × height × 4` Samples R, G, B, A, zeilenweise von oben; `depth` 8 → Uint8, 16 → Uint16 LE |
| Server → Client | Text | `{"type":"stats","sent":n,"dropped":n}` (optional, 1 Hz) |
| Server → Client | Text | `{"type":"tc","tc":"10:00:07:05","tcPts":7.2,"pts":7.4,"first":0.96,"kind":"gop"\|"s12m"}` (optional, höchstens 25/s): letzter Timecode aus den Bild-Seitendaten und die PTS des neuesten decodierten Bildes; Resolve: `{"type":"tc","tc":…,"kind":"resolve","fps":25,"df":false}` vor jedem Bild |
| Server → Client | Text | `{"type":"error"\|"end","message":"…"}`, danach schließt der Server |

Die Werte sind Full-Range-R'G'B' (0 = 0 %, Maximum = 100 %). Die Transferfunktion bleibt unverändert, PQ und HLG kommen als Codewerte an. `transfer`, `matrix` und `primaries` entsprechen den ffprobe-Namen; fehlen sie, setzt der Client SDR und BT.709 bei HD beziehungsweise BT.601 bei SD an.

ffmpeg-Aufruf, der das Format erzeugt (siehe `server/index.mjs`):

```
ffmpeg -rtsp_transport tcp -i <url> -an -map 0:v:0 \
  -vf scale=960:540:flags=area:in_color_matrix=bt709:in_range=limited \
  -pix_fmt rgba -f rawvideo pipe:1          # rgba64le für 16 bit
```

`in_color_matrix` immer explizit setzen, sonst wandelt swscale ungetaggte HD-Streams mit BT.601. Kommt der Browser nicht hinterher, Bilder verwerfen statt puffern (`ws.bufferedAmount`).

## Ganze Bilder, Interlace

Jede Binärnachricht enthält genau ein vollständiges Bild (Bridge: `server/frames.mjs`, Test `test/frames.test.ts`). Teile zweier Bilder in einer Nachricht gibt es nicht; der Client tauscht das Bild nur als Ganzes aus. Bei interlaced Quellen (ffprobe `field_order` tt/bb/tb/bt bzw. DeckLink/NDI-Helfer `interlaced`) enthält ein Bild beide Halbbilder verwoben; die Bridge skaliert feldweise (`scale=…:interl=1`), damit die Halbbilder nicht vertikal vermischt werden, und meldet `"interlaced": true` im `info`.

## Y′CbCr unbeschnitten (`format=yuv`)

Opt-in über `/stream?url=…&format=yuv` (setzt `depth` auf 16). Die Bridge wandelt dann nicht nach R′G′B′, sondern skaliert Y′CbCr 4:4:4 ohne Range- und Matrixwandlung. Codes unter Schwarz und über Weiß (Sub-Black, Super-White, BT.2111 −7 %/109 %) kommen unverändert an; die Umrechnung nach R′G′B′ macht der Client (Shader), ohne zu begrenzen.

`info` bekommt drei Felder:

```json
{"type":"info", "...":"wie oben", "depth":16, "format":"yuv", "yuvRange":"limited"|"full", "bits":10}
```

- Jedes Pixel: 4 × Uint16 LE in der Reihenfolge **A, Y′, Cb, Cr** (ffmpeg `ayuv64le`), A = 65535.
- n-bit-Codes linksbündig: Wert · 2^(16−n), in beiden Ranges (ffmpeg 9.0.1 geprüft: 10 bit 943 → 60352, 8 bit full 255 → 65280). `bits` ist n der Quelle, aus `pix_fmt`.
- Narrow: Y′ = (D − 4096)/56064, Cb/Cr = (D − 32768)/57344. Full: Y′ = D/((2^n − 1)·2^(16−n)), Cb/Cr = (D − 2^(n−1)·2^(16−n))/((2^n − 1)·2^(16−n)) (BT.2100-3 Tab. 9).
- Matrix: `decodeMatrix` bzw. `matrix` wie oben; der Client nimmt die Matrix der Quelle (manuell überschreibbar).
- Ist die Quelle R′G′B′ (`gbrp`, `rgb24` …), antwortet die Bridge mit `"format":"rgb"`, 16 bit R′G′B′ und einem `note`.

```
ffmpeg … -i <url> -map 0:v:0 -an \
  -vf scale=960:540:flags=area:in_color_matrix=bt709:out_color_matrix=bt709:in_range=limited:out_range=limited \
  -pix_fmt ayuv64le -f rawvideo pipe:1
```

Andere Hosts dürfen statt `ayuv64le` planar `yuv444p16le` erzeugen, müssen dann aber vor dem Senden in A, Y′, Cb, Cr umsortieren.

## Protokoll 2: Bild und Ton (`audio=1`)

Opt-in über die Anfrage: `/stream?url=…&audio=1` (optional `&video=0` für reine Tonquellen). Ohne `audio=1` bleibt alles wie oben; Hosts, die nur Protokoll 1 sprechen, funktionieren unverändert weiter (der Client erkennt Protokoll 2 an `info.proto`).

`info` bekommt zwei Felder:

```json
{"type":"info", "...":"wie oben", "proto":2,
 "audio":{"sampleRate":48000,"channels":2,"format":"f32le","layout":"stereo",
          "codec":"aac","sourceSampleRate":48000,"sourceChannels":2}}
```

`"audio": null`, wenn die Quelle keinen Ton hat; dann kommen auch keine Tonpakete. Bei reinen Tonquellen sind `width` und `height` 0.

Jede Binärnachricht beginnt bei `proto: 2` mit einem 16-Byte-Kopf (Little Endian), die Nutzlast bleibt auf 4 Byte ausgerichtet:

| Offset | Typ | Bild `LZV1` | Ton `LZA1` |
|---|---|---|---|
| 0 | 4 × ASCII | `LZV1` | `LZA1` |
| 4 | uint32 | Bildnummer seit Start | Anzahl Sample-Frames n im Paket |
| 8 | float64 | PTS in s (NaN, wenn unbekannt) | Index des ersten Samples seit Start (lückenlos; ein Sprung = Lücke) |
| 16 | … | RGBA wie oben | n × channels float32, verschachtelt |

- **Zeitstempel (PTS)**: Liefert ein Stream Bild und Ton aus einem ffmpeg-Prozess, trägt jedes Bild seinen PTS (Sekunden, Zeitbasis der Quelle nach ffmpegs Startversatz). Der Ton bekommt Anker als Textnachricht `{"type":"apts","index":n,"pts":t}`: Sample `index` hat die Zeit `t`, spätere Samples zählen mit `1/sampleRate` weiter. Ein neuer Anker kommt beim ersten Paket, bei einem Sprung über 5 ms und spätestens alle 5 s. Bild-PTS und Ton-PTS sind vergleichbar (A/V-Versatz). Im Ersatzweg mit zwei Prozessen (unten) gibt es keine PTS, weil zwei Sitzungen verschiedene Zeitachsen haben. Die Bridge liest sie aus ffmpegs `showinfo`/`ashowinfo` (Log-Stufe `info`); ein Bild wartet höchstens 150 ms auf seine Zeile, sonst geht es mit NaN hinaus. Mit Bildraten-Begrenzung (`fps=`) stehen die PTS auf dem Raster des `fps`-Filters.
- Tonpakete zu 20 ms (960 Frames bei 48 kHz). Keine Abtastraten- oder Kanalwandlung: Rate und Layout wie in der Quelle.
- **Ton wird nie verworfen.** Die Drop-Regel über `bufferedAmount` gilt nur für Bilder.
- `stats` enthält zusätzlich `audioSent`, `audioDropped` (immer 0), `audioGaps` und `audioSplit` (Ersatzweg aktiv, siehe unten).
- Die Testbilder `test:*` liefern mit `audio=1` einen 1-kHz-Ton in Stereo mit Amplitude 1/8 (−18,06 dBFS, Ausrichtungspegel nach EBU R 68).

ffmpeg, ein Prozess mit zwei Ausgängen (Ton auf Dateideskriptor 3):

```
ffmpeg … -i <url> \
  -map 0:v:0 -an -vf scale=… -pix_fmt rgba -f rawvideo pipe:1 \
  -map 0:a:0 -vn -c:a pcm_f32le -f f32le pipe:3
```

Ersatzweg: Beendet sich ffmpeg in den ersten Sekunden mit einem Fehler zu `pipe:3` (möglich unter Windows, wenn der Deskriptor nicht vererbt wird), startet die Bridge einen zweiten ffmpeg-Prozess nur für den Ton (`-vn … pipe:1`). Der öffnet eine zweite Sitzung zur Quelle; manche Kameras vertragen das nicht. Mit `LZS_AUDIO_SPLIT=1` lässt sich der Ersatzweg erzwingen.

## Anfrage-Parameter für Geräte und Wandlung

Zusätzlich zu `url`, `width`, `fps`, `depth`, `transport`, `audio`:

| Parameter | Werte | gilt für |
|---|---|---|
| `size` | `1920x1080` | `device:` – Modus des Geräts (ohne Angabe auf macOS der größte 16:9-Modus) |
| `rate` | `50`, `59.94`, `30000/1001` | `device:` – Aufnahmerate des Geräts |
| `pixfmt` | ffmpeg-Name, z. B. `yuv422p10le`, `uyvy422` | `device:` – Rohformat (ohne Angabe das tiefste angebotene) |
| `pixel` | `8` | `decklink:` – 8 bit UYVY statt 10 bit v210 |
| `matrix` | `bt709`, `bt601`, `bt2020`, `smpte240m` | alle – feste Matrix für Y′CbCr → R′G′B′ statt Kennzeichnung/Größenregel |
| `range` | `tv`, `pc` | alle – fester Wertebereich |

`GET /api/devices/formats?url=device:…` liefert `{modes:[{width,height,fpsMin,fpsMax,pixfmt?}], pixfmts:[…], preferred, defaultSize}`, `GET /api/decklink` den Zustand des DeckLink-Helfers `{available, helper, devices, error}`, `GET /api/ndi` die NDI-Quellen `{available, runtime, version, sources:[{name,url}], error}`; eine NDI-Quelle heißt `ndi:<Name>`. `GET /api/folders` listet die freigegebenen Watch-Ordner `[{name,url}]` (`folder:<Name>`, freigegeben mit `--watch-dir`).

## Helfer-Protokoll (native Aufnahme-Helfer → Bridge)

Geräte ohne freien ffmpeg-Weg (DeckLink, NDI) laufen über einen eigenen Helfer-Prozess, den die Bridge startet. Er schreibt auf stdout Datensätze:

| Offset | Typ | Inhalt |
|---|---|---|
| 0 | 4 × ASCII | Kennung `INFO`, `FRAM`, `STAT`, `ERR ` |
| 4 | uint32 LE | Länge n der Nutzlast |
| 8 | n Byte | Nutzlast |

- `INFO` (JSON, vor dem ersten Bild und bei jedem Formatwechsel): `{"width":1920,"height":1080,"fpsNum":50,"fpsDen":1,"pixel":"v210","matrix":"bt709","range":"tv","transfer":"unknown","primaries":"unknown","name":"1080i50","timecode":"10:00:00:00"}`
- `FRAM`: ein Bild im Format `pixel`, Zeilen ohne weiteres Padding. `pixel` ∈ `v210` (48 Pixel je 128 Byte), `uyvy422`, `p216le`, `rgb48le`, `bgra`, `bgr0`, `rgba`, `rgb0`, `nv12`, `yuv420p`.
- `STAT` (JSON `{"message":"…"}`): Zustand, z. B. „kein Eingangssignal“.
- `ERR `: Fehlertext; der Helfer beendet sich danach.
- `TIME` (JSON `{"tc":"10:00:00:00","df":false}`, optional, je Bild vor `FRAM`): Timecode der Quelle (DeckLink: RP 188). Die Bridge schickt ihn als `{"type":"tc","tc":…,"kind":"decklink","fps":…,"df":…}` weiter.

Bei Helfer-Quellen enthält `stats` zusätzlich `phase`: Lage der Bild-Ankunft im SMPTE-ST-2059-1-Raster `{periodMs, meanMs, sdMs, driftPpm, n, spanS, ref:"system"|"ptp"}` (server/phase.mjs). `GET /api/decklink/reference?index=n` liefert den Referenz-/Genlock-Status der Karte (`lz-decklink --reference n`, docs/research/genlock.md).

`--list` gibt stattdessen eine JSON-Zeile `{"ok":true,"devices":[…]}` bzw. `{"ok":false,"error":"…"}` aus. Die Bridge leitet die Bilder durch ffmpeg (`-f v210` bzw. `-f rawvideo -pix_fmt …` von stdin) und dieselbe Skalierung wie bei Streams; Richtung Browser gilt Protokoll 1. Zum Testen ohne Hardware: `test/fixtures/fake-helper.mjs`.

## Timecode (optional)

`info` kann `timecode` (Start-Timecode des Containers, ffprobe-Tag, z. B. MOV tmcd), `startTime` (s), `frameRate` (`"30000/1001"`) und `sourceFps` enthalten. Die Bridge hängt `showinfo=checksum=0` vor den Skalierer und liest daraus je Quellbild `pts_time` und die Seitendaten „GOP timecode“ (MPEG-2) bzw. „SMPTE 12-1 timecode“ (SEI). Der Client rechnet den aktuellen Timecode als `tc + (pts − tcPts) × fps`, ohne Seitendaten als `timecode + (pts − startTime) × fps`. Abschalten mit `&tc=0`. Hosts, die kein `tc` senden, bleiben kompatibel.

## Uhr: `/clock`

WebSocket nur von 127.0.0.1, für die UI gleicher Herkunft oder eine vom Nutzer freigegebene Web-Herkunft (`GET /allow?origin=…` zeigt die Freigabe-Seite der Bridge; `GET /api/clock-access` sagt einer Seite, ob sie freigegeben ist; Datei `allowed-origins.json` im Konfigurationsordner, CLI `--allow-origin`, `--config-dir`, `LZS_CONFIG_DIR`). Server → Client 4 Hz `{"type":"ptp", state, domain, gm, rates, offsetNs, meanPathDelayNs, pathDelayIncluded, sm, history, ifaces, rtp}`; Client → Server `{"type":"config","iface":"","delayReq":false}` und `{"type":"rtp","group":"239.1.1.1","port":5004,"rateNum":25,"rateDen":1}` bzw. `{"type":"rtp","off":true}`. Siehe `server/ptp.mjs` und `docs/research/clock-ptp.md`.

## H.264-Übertragung (`codec=h264`)

Für entfernte Bridges mit wenig Bandbreite: `/stream?url=…&codec=h264` (erzwingt Protokoll 2). Die Bridge skaliert wie oben, bleibt aber in Y′CbCr (Matrix der Quelle, schmaler Bereich, 4:2:0) und kodiert mit libx264 (`ultrafast`, `zerolatency`, keine B-Frames, GOP 2 s) in FLV auf der Pipe; `server/flv.mjs` zerlegt das in Access Units.

- `info` bekommt `"transport":"h264"`, `depth` ist immer 8. `format=yuv` wird ignoriert, PTS und `apts`-Anker entfallen (kein A/V-Versatz).
- Text `{"type":"video","codec":"avc1.42c01f","format":"annexb"}` vor dem ersten Bild (Codec-String nach RFC 6381 aus dem AVCDecoderConfigurationRecord).
- Binär mit dem 16-Byte-Kopf: `LZHK` (Keyframe, SPS/PPS vorangestellt) oder `LZHD` (abhängiges Bild), uint32 Bildnummer, float64 Bridge-Uhr in ms; danach eine Access Unit im Annex-B-Format (Startcodes).
- Kommt der Browser nicht hinterher, verwirft die Bridge bis zum nächsten Keyframe.
- Der Browser dekodiert mit WebCodecs im Worker (`src/frameWorker.ts`) und wandelt Y′CbCr selbst mit `decodeMatrix` in R′G′B′ (`src/yuv.ts`), nicht über ein Canvas mit Farbmanagement. Ergebnis: 8 bit, verlustbehaftet – für exakte Messungen `roh` verwenden.

## Latenz-Stempel

`scripts/latency-source.mjs` schreibt Uhrzeit (ms, mod 2³²) und Bildzähler als Schwarz-Weiß-Blöcke in die obersten zwei Zeilen des Bildes (Aufbau in `server/stamp.mjs`). Die App liest sie in jedem Bild und zeigt im Panel Messwerte: Stempel → Anzeige, bei H.264 zusätzlich Quelle → Bridge und Bridge → App (Bridge-Uhr im Kopf von `LZHK`/`LZHD`; im rohen Weg trägt der `LZV1`-Kopf die PTS, dort gibt es keine Aufteilung). Alle Werte setzen dieselbe Uhr voraus (ein Rechner oder NTP); die Verzögerung des Monitors ist nicht enthalten.

## Lokale Geräte

Die Bridge liest Capture- und Audiogeräte dieses Rechners über ffmpeg (Liste: `GET /api/devices` → `[{name, url, kind: "video"|"audio"}]`):

- `device:avfoundation|dshow|v4l2:<Videogerät>` – Bild; mit `#audio=<Audiogerät>` zusätzlich der Ton im selben ffmpeg-Prozess (macOS `"<Video>:<Audio>"`, Windows `video=…:audio=…`, Linux zweiter Eingang ALSA, z. B. `#audio=hw:1,0`).
- `audio:avfoundation|dshow|alsa:<Audiogerät>` – nur Ton, mit allen Kanälen, die der Treiber liefert. `#ch=<n>` fordert bei DirectShow/ALSA `n` Kanäle an.

Namen gehen als ein Argument an ffmpeg, nie über eine Shell. Bei AVFoundation darf kein `:` im Namen stehen (Trennzeichen zwischen Bild und Ton). Geprüft auf macOS mit Kamera und Mikrofon eines MacBook; DirectShow, ALSA, Mehrkanal-Interfaces und Dante Virtual Soundcard sind ungeprüft.
