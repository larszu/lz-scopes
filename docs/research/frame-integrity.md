# Ganze Bilder statt Zeilen: Wie LZ Scopes Frames verarbeitet

Stand: 01.10.2026. Frage von Lars: „Ist der CRT-Modus Bildlinie für Bildlinie aufgebaut? Er soll die Infos wie ein Global-Shutter-Sensor verarbeiten.“

## Befund im Code

| Stelle | Verhalten |
|---|---|
| Bridge, ffmpeg-Pipe (`server/index.mjs`) und Helfer (DeckLink/NDI, `server/helper-input.mjs`) | `FrameAssembler` (`server/frames.mjs`) sammelt die Pipe-Stücke und gibt erst ein vollständiges Bild als eigenen Puffer weiter. Kein Bild enthält Bytes eines anderen. Test: `test/frames.test.ts` (beliebige Stückelung, überschriebene Eingangspuffer). |
| WebSocket → Browser (`src/sources.ts`, Frame-Worker) | Jede Nachricht ist ein Bild; `Source.data` wird als Ganzes durch ein neues Array ersetzt, nie teilweise beschrieben. Der Worker übergibt Puffer per Transfer (Besitzwechsel), ältere wartende Bilder werden ganz verworfen, nicht gemischt. |
| GPU-Upload (`src/renderer.ts sourceTexture`) | Ein `texSubImage2D` pro Bild und Bildnummer; alle Panels eines Anzeige-Frames lesen dieselbe Textur. JavaScript läuft single-threaded, zwischen den Panels kann kein neues Bild eintreffen. |
| Scopes inkl. CRT | Jeder Scope streut alle Abtastpunkte des einen Bildes in einem Durchgang. Der CRT-Modus zeichnet die Strahlsegmente aller Zeilen dieses Bildes auf einmal (kein zeilenweiser Aufbau über die Zeit, kein Rolling Shutter). Das Nachleuchten mischt ganze Bilder zeitbasiert: exp(−Δt/τ) mit der echten Zeit zwischen Anzeige-Frames, unabhängig von der Bildwiederholrate (Test in `test/frames.test.ts`). |
| Statistik (CPU) | arbeitet auf dem jeweils aktuellen ganzen Bild (`lastFrame`). |

Ausnahme, unverändert: Browser-Quellen (Kamera, Datei) liefert der Browser selbst; deren GPU-Statistik läuft ein Bild versetzt zum Scope-Bild.

## Interlace (DeckLink/UltraStudio, Streams)

DeckLink liefert in `VideoInputFrameArrived` ganze Frames (bei interlaced Modi beide Halbbilder verwoben); der Helfer meldet `interlaced` aus `GetFieldDominance()`. Bisher hat die Bridge diese Angabe ignoriert und beim Verkleinern beide Halbbilder vertikal gemischt. Jetzt:

- Helfer `interlaced: true` bzw. ffprobe `field_order` tt/bb/tb/bt → Skalierung feldweise (`scale=…:interl=1`, ffmpeg-Option „set interlacing“, lokal geprüft: ffmpeg 9.0.1, Test mit verwobenen Halbbildern 235/16 bleibt getrennt statt grau gemischt).
- `info.interlaced` → Messwerte-Panel zeigt „interlaced – beide Halbbilder als ein Bild, feldweise skaliert“.
- Kein Deinterlacing: Scopes messen Signalwerte, ein Deinterlacer würde sie verändern. Das Bild enthält beide Halbbilder (zwei Zeitpunkte); innerhalb eines Halbbilds ist es gleichzeitig.

Ungeprüft: echte UltraStudio/DeckLink-Hardware (keine vorhanden). Laut Helfer-Code kommen auch dort ganze Frames; ob das mit einem UltraStudio so funktioniert, muss Lars mit Gerät bestätigen.
