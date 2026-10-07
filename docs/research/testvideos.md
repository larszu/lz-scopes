# Eigene Testbilder, Logo, Testvideos (#52)

Stand 06./07.10.2026.

## Lizenzen (geöffnete Quellen)

- **Big Buck Bunny** – peach.blender.org/about: „Creative Commons Attribution 3.0“. Namensnennung für Teile: „(c) copyright 2008, Blender Foundation / www.bigbuckbunny.org“; für Website/DVD-Dateien „Blender Foundation | www.blender.org“. Logos, Marken, DVD-Cover sind ausgenommen. Die Neuberechnung 2013 („sunflower“, 1080p/2160p, 30/60 fps) liegt unter download.blender.org/demo/movies/BBB/; wir behandeln sie als dasselbe Werk mit derselben Lizenz und Namensnennung.
- **Netflix Open Content** – opencontent.netflix.com: „Our open source content is available under the Creative Commons Attribution 4.0 International Public License.“ Meridian (2016, Dolby Vision, P3-D65, PQ; Fassung „UHD 4k 5994 HDR P3/PQ (mp4)“) und Cosmos Laundromat (2016, Open Movie von Blender Studio, HDR-Grading mit Netflix und Fotokem Keep Me Posted; Fassung „2k 24p HDR P3/PQ (mp4)“). Eine feste Namensnennungsformel nennt die Seite nicht; wir nennen Titel, Urheber, „Netflix Open Content“ und die Lizenz.
- Nicht aufgenommen: Sol Levante, Sparks, Nocturne (nur als Master/IMF mit 16–155 GB), EBU- und ITU-Testsequenzen (keine freie Weitergabe).

## Dateien und Prüfsummen

Alle Dateien vollständig geladen und mit `shasum -a 256` geprüft (06.10.2026); Codec per `ffprobe` (bei ZIP-Dateien über die ersten Megabytes des Eintrags). Werte in `src/testVideoCatalog.ts`. Die Blender-Dateien sind seit 2026 als ZIP mit genau einem Eintrag abgelegt (2008: gespeichert, 2013: Deflate); die App prüft den SHA-256 der ZIP-Datei und den CRC-32 des Eintrags.

Die HDR-Fassungen sind **8-bit-H.264 High 4:2:0 ohne Farbkennzeichnung** (color_transfer/primaries „unknown“). PQ und P3 stehen nur im Dateinamen und bei Netflix; die App setzt beim Öffnen Transfer PQ und Gamut P3. Für Pegel, PQ-Skalen und Gamut taugen sie, für Banding- und 10-bit-Tests nicht.

## Laden im Browser

Keiner der Server sendet `Access-Control-Allow-Origin` (geprüft mit `curl -I -H Origin:` am 06.10.2026: download.blender.org über Cloudflare, S3-Bucket von Netflix). Ein `fetch` aus der Seite scheitert daher, und ein `<video>` ohne CORS dürfte WebGL nicht auslesen. Entscheidung: Im Browser kein Laden in der App und kein Cache-Storage-Weg, sondern ein Link zur Originaldatei (Nutzer speichert, entpackt, öffnet als Quelle *Datei*). Die Desktop-App lädt im Hauptprozess (kein CORS), prüft und legt die Datei in `<userData>/testvideos` ab; abgespielt wird über `lzs-media://video/<datei>` mit Range-Anfragen und CORS-Kopf, damit die Scopes die Bilder lesen dürfen.

## Eigene Bilder und Logo

IndexedDB `lz-scopes-media` (Store `images`, Blob + Name), damit Bilder Neustarts überstehen; Ausgabefenster (`?out=img:…`) lesen dieselbe Datenbank. Höchstens 64 MB je Bild. Logo = eines dieser Bilder (Wahl in localStorage). *Eigenes Logo* zeigt es mittig auf Schwarz in höchstens halber Bildhöhe und -breite (innerhalb der Graphics-Safe-Area nach EBU R 95). *Testbild mit Kreis und Uhr + Logo* setzt es in das schwarze untere Kreissegment, die Uhr rückt darunter. Favoriten: Liste von Testbild-IDs in localStorage, oben in der Auswahl.

## Geprüft / ungeprüft

- Geprüft (Electron, macOS): Laden, SHA-256, Entpacken (gespeichert) und Abspielen von Big Buck Bunny 320×180; Hochladen, Logo, Favoriten und Neustart (E2E `e2e/testmedia.spec.ts`); Entpacken mit Deflate und CRC-Fehler (Unit-Test).
- Ungeprüft: die großen Dateien im Programm (nur Prüfsumme außerhalb berechnet), Wiedergabe der 2160p60- und HDR-Dateien unter Windows.
