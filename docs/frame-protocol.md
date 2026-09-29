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
