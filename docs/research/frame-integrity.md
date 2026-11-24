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
- Standard ohne Deinterlacing: Scopes messen Signalwerte, ein Deinterlacer würde sie verändern. Das Bild enthält beide Halbbilder (zwei Zeitpunkte); innerhalb eines Halbbilds ist es gleichzeitig.

### Je Quelle umschaltbar (#219, `server/interlace.mjs`)

An der Quellkarte (Bridge-Quellen) zwei Auswahlfelder:

- **Halbbilder**: auto (wie gemeldet) / Progressiv / Oberes Halbbild zuerst / Unteres Halbbild zuerst. Fest eingestellt gilt die Quelle als interlaced (bzw. progressiv) unabhängig von der Meldung; Parameter `field=`.
- **Deinterlacing**: aus (Halbbilder getrennt, wie oben) / ein. Ein: `bwdif=mode=send_frame:parity=<tff|bff>:deint=all` vor dem Skalierer, auf dem vollen Bild; danach normales Skalieren ohne `interl`. Parameter `deint=1`. Bei Helfer-Quellen fällt damit der v210-Durchgang (#258) weg, weil ffmpeg rechnen muss.

Herkunft der Reihenfolge (zeitlich erstes Halbbild):

| Quelle | Wert | Grundlage |
|---|---|---|
| ffprobe `field_order` | tt, bt → oberes; bb, tb → unteres | libavutil `AVFieldOrder` (tb = „top coded first, bottom displayed first“); entscheidend ist die Anzeige-Reihenfolge. Gleiche Zuordnung wie das QuickTime-Atom `fiel` (9 = unteres zuerst angezeigt, 14 = oberes). |
| DeckLink-Helfer | `fieldOrder` aus `GetFieldDominance()` | DeckLink SDK, `BMDFieldDominance` (`bmdUpperFieldFirst` / `bmdLowerFieldFirst`) |
| AJA-/NDI-Helfer | ohne eigene Angabe: 480/486 Zeilen unteres, sonst oberes zuerst | übliche Digitalaufnahme von 525-Zeilen-Video (SMPTE ST 125 / BT.656; DV-NTSC und DeckLink-NTSC sind „lower first“), 625 Zeilen und 1080i (SMPTE ST 274) oberes zuerst. Annahme, an der Karte änderbar. |

Messwerte:

- Halbbilder getrennt: jede Zeile im Bild stammt aus genau einem Halbbild; durch `interl=1` mischt das Verkleinern keine Zeilen beider Halbbilder. Waveform, Vectorscope, Histogramm und Statistik zeigen beide Halbbilder zusammen (zwei Zeitpunkte), aber jeder Wert ist ein Signalwert. Die Reihenfolge ändert daran nichts; sie zählt erst beim Deinterlacing.
- Deinterlacing ein: bwdif (Bob Weaver, aus yadif und w3fdif abgeleitet) behält die Zeilen des ersten Halbbilds und errechnet die des zweiten in bewegten Stellen aus Nachbarzeilen und Nachbarbildern; in ruhigen Stellen bleiben die Zeilen erhalten. In bewegten Stellen sind die Werte also gerechnet, keine Messwerte. Falsche Reihenfolge = ruckelnde, zitternde Bewegung. bwdif braucht das nächste Bild: ein Bild mehr Verzögerung.
- Die QC-Messung (signalstats, #202) und der Timecode (showinfo) laufen immer vor dem Deinterlacer, also auf dem Signal selbst.
- Mit Bildraten-Begrenzung (fps-Feld) sieht der Deinterlacer bei Helfer-Quellen nur die durchgelassenen Bilder; seine zeitlichen Nachbarn liegen dann weiter auseinander, die errechneten Zeilen in Bewegung werden ungenauer.

Geprüft lokal mit ffmpeg (`test/interlace.test.ts`): Filterketten und ein verwobenes Testbild (Halbbilder 235/16) – getrennt bleibt jede Zeile 235 oder 16, deinterlaced entsteht ein Bild ohne Zeilenwechsel. Ungeprüft mit echter Hardware (DeckLink/AJA/NDI mit 1080i/576i/480i).

Ungeprüft: echte UltraStudio/DeckLink-Hardware (keine vorhanden). Laut Helfer-Code kommen auch dort ganze Frames; ob das mit einem UltraStudio so funktioniert, muss Lars mit Gerät bestätigen.
