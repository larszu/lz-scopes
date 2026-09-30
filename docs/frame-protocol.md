# LZ Scopes – Frame-Protokoll

Ein WebSocket liefert unkomprimierte Einzelbilder an den Browser. Die Bridge dieses Repos (`/stream?url=…`) spricht es, und jeder Host kann es nachbauen, zum Beispiel lz-camera-bridge unter `/scope/<n>`. Auf der Browserseite verbindet `Source.connectFrames(wsUrl)`.

| Richtung | Typ | Inhalt |
|---|---|---|
| Server → Client | Text | `{"type":"info","width":960,"height":540,"depth":8\|16,"fps":25,"sourceWidth":1920,"sourceHeight":1080,"codec":"h264","transfer":"smpte2084","primaries":"bt2020","matrix":"bt2020nc","range":"tv","decodeMatrix":"bt2020"}` vor dem ersten Bild |
| Server → Client | Binär | ein Bild: `width × height × 4` Samples R, G, B, A, zeilenweise von oben; `depth` 8 → Uint8, 16 → Uint16 LE |
| Server → Client | Text | `{"type":"stats","sent":n,"dropped":n}` (optional, 1 Hz) |
| Server → Client | Text | `{"type":"error"\|"end","message":"…"}`, danach schließt der Server |

Die Werte sind Full-Range-R'G'B' (0 = 0 %, Maximum = 100 %). Die Transferfunktion bleibt unverändert, PQ und HLG kommen als Codewerte an. `transfer`, `matrix` und `primaries` entsprechen den ffprobe-Namen; fehlen sie, setzt der Client SDR und BT.709 bei HD beziehungsweise BT.601 bei SD an.

ffmpeg-Aufruf, der das Format erzeugt (siehe `server/index.mjs`):

```
ffmpeg -rtsp_transport tcp -i <url> -an -map 0:v:0 \
  -vf scale=960:540:flags=area:in_color_matrix=bt709:in_range=limited \
  -pix_fmt rgba -f rawvideo pipe:1          # rgba64le für 16 bit
```

`in_color_matrix` immer explizit setzen, sonst wandelt swscale ungetaggte HD-Streams mit BT.601. Kommt der Browser nicht hinterher, Bilder verwerfen statt puffern (`ws.bufferedAmount`).

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

`GET /api/devices/formats?url=device:…` liefert `{modes:[{width,height,fpsMin,fpsMax,pixfmt?}], pixfmts:[…], preferred, defaultSize}`, `GET /api/decklink` den Zustand des DeckLink-Helfers `{available, helper, devices, error}`.

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

`--list` gibt stattdessen eine JSON-Zeile `{"ok":true,"devices":[…]}` bzw. `{"ok":false,"error":"…"}` aus. Die Bridge leitet die Bilder durch ffmpeg (`-f v210` bzw. `-f rawvideo -pix_fmt …` von stdin) und dieselbe Skalierung wie bei Streams; Richtung Browser gilt Protokoll 1. Zum Testen ohne Hardware: `test/fixtures/fake-helper.mjs`.

## Lokale Geräte

Die Bridge liest Capture- und Audiogeräte dieses Rechners über ffmpeg (Liste: `GET /api/devices` → `[{name, url, kind: "video"|"audio"}]`):

- `device:avfoundation|dshow|v4l2:<Videogerät>` – Bild; mit `#audio=<Audiogerät>` zusätzlich der Ton im selben ffmpeg-Prozess (macOS `"<Video>:<Audio>"`, Windows `video=…:audio=…`, Linux zweiter Eingang ALSA, z. B. `#audio=hw:1,0`).
- `audio:avfoundation|dshow|alsa:<Audiogerät>` – nur Ton, mit allen Kanälen, die der Treiber liefert. `#ch=<n>` fordert bei DirectShow/ALSA `n` Kanäle an.

Namen gehen als ein Argument an ffmpeg, nie über eine Shell. Bei AVFoundation darf kein `:` im Namen stehen (Trennzeichen zwischen Bild und Ton). Geprüft auf macOS mit Kamera und Mikrofon eines MacBook; DirectShow, ALSA, Mehrkanal-Interfaces und Dante Virtual Soundcard sind ungeprüft.
