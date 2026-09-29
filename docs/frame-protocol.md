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
| 8 | float64 | PTS in s (derzeit immer NaN) | Index des ersten Samples seit Start (lückenlos; ein Sprung = Lücke) |
| 16 | … | RGBA wie oben | n × channels float32, verschachtelt |

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
