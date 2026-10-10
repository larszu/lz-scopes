# Kamera-Abgleich: Kameras übereinanderlegen, messen, aufzeichnen

Stand 10.10.2026. Plan, noch nichts davon umgesetzt. Marktbild aus Herstellerseiten und Presse, Herstellerangaben nicht nachgeprüft.

## Ausgangslage in lz-scopes

- **A/B im Bild-Panel** (`src/panel.ts`, `abSource`): Split, Wipe, Differenz gegen eine andere Quelle. Pixel auf Pixel, ohne Ausrichtung – brauchbar nur bei fast gleichem Bildausschnitt.
- **Farbabgleich-Panel** (#55): Messpunkt oder -rahmen auf dasselbe Objekt in zwei Kameras, ΔE00/ΔITP, Korrektur in Kamerabegriffen.
- **Overlay-Szenen**: Scopes mit eigener Quelle nebeneinander, nicht übereinander.
- **Bausteine, die sich wiederverwenden lassen**: 4-Punkt-Homographie (`src/led/analysis.ts`), Gesichtserkennung (`src/face.ts`), Paint-Bus über lz-camera-bridge (Touch Shading #54), Latenzmessung je Quelle (#16), Matroska-Schreiber des RTP-Eigenempfangs (`server/mkv.mjs`).
- **Keine Aufzeichnung**: Quellen lassen sich nur einfrieren, nicht mitschneiden.

## Marktbild

| Werkzeug | Kann | Fehlt |
|---|---|---|
| Pomfort Livegrade | Referenzbild/-clip je Slot als Swipe oder Überblendung, Mehrfachansicht | kein Scope-Overlay zwischen Kameras |
| Nobe OmniScope Live Pack (03/2026) | mehrere Eingänge im Raster, Snapshots als Live-Quelle zum Abgleich | nebeneinander statt übereinander |
| Leader LV5600/LV5490, Telestream PRISM | zwei Eingänge gleichzeitig, Kamera-ID/Tally | Hardware; Referenzspur im Handbuch nicht geprüft |
| Canon Camera Color Matching App (2025) | Farbtafel beider Kameras → 3D-LUT per IP in die Kamera | statisch, Ziel nur Canon-PTZ |
| Panasonic Image Adjust Pro AW-SF600 (angekündigt 10/2026) | Gamma/Matrix/Farbe automatisch auf eine Referenzkamera, auch Fremdmarke | Ziel nur Panasonic, Verfahren unveröffentlicht |
| Cyanview RCP/VP4 | Shading markenübergreifend, Multi-Matrix | keine Messung, Abgleich von Hand |
| vMix, TriCaster | Scopes je Eingang | „Referenzkamera per Knopf“ nur als Forumswunsch |

Lücke: ein markenoffenes Live-Werkzeug, das Scope-Spuren mehrerer Kameras übereinanderlegt, eine Farbtafel aller Kameras gegen die Referenz misst, die Korrektur an die Kamera gibt und den Abgleich aufzeichnet und nachträglich prüfbar macht.

## Grundsatz

Kameras sehen die Szene aus verschiedenen Winkeln. Verglichen werden deshalb **Verteilungen** (Scopes) und **dasselbe Objekt** (Tafel, Gesicht, Graukarte), nicht Pixel auf Pixel. Eine Kamera ist die **Referenz**; alle Vergleiche laufen gegen sie.

## Plan

### 1. Referenzkamera und Geisterspur (klein)

- Global „Referenz = Quelle X“; jedes Waveform-, Parade-, Vectorscope-, Diamond- und Histogramm-Panel kann die Referenzspur einblenden.
- Referenzspur in Zweitfarbe, Deckkraft einstellbar, **live oder eingefroren** („gestimmte Kamera als Vorlage“, Tektronix-App-Note).
- Technik: zweiter Akkumulations-Buffer im Renderer, beim Zeichnen eingefärbt addiert. Bei eingefrorener Referenz bleibt der Buffer stehen.
- Kennzahlen am Panel: Δ Schwarzschwerpunkt, Δ Median, Δ Spitzlicht je Kanal gegen die Referenz.

### 2. Gleichzeitig einfrieren (klein)

- Ein Tastendruck friert alle Quellen ein; die gemessene Latenz je Quelle wird ausgeglichen, damit alle Bilder aus demselben Moment stammen (LED-Licht, Bewegung).
- Baut auf dem Bildpuffer aus Schritt 5 auf, der ein paar Bilder je Quelle vorhält.

### 3. Dasselbe Objekt finden (mittel)

- **Farbtafel**: vier Ecken je Kamera klicken (Homographie aus der LED-Prüfung), Median je Feld. Ergebnis: **Match-Matrix** Feld × Kamera mit ΔE00 zur Referenz, dazu ein per kleinster Quadrate gefitteter 3×3- bzw. Multi-Matrix-Vorschlag. Später automatische Tafelerkennung (OpenCV `mcc`).
- **Hautton**: Gesichter je Kamera (MediaPipe), Hautverteilungen aller Kameras farbig in einem Vectorscope.
- **Ausschnitt-Vergleich**: Messrahmen in A und B, beide Ausschnitte nebeneinander bzw. als **Butterfly-Split** (B gespiegelt). Vergleicht dasselbe Gesicht trotz anderer Perspektive.
- Volle Bildüberlagerung mit Ausrichtung (Feature-Matching, Homographie) nur als Option für Kameras auf fast gleicher Achse.

### 4. Geschlossene Schleife über lz-camera-bridge (mittel)

- Abweichung in Schwarz, Weiß, Gamma, Matrix → Paint-Delta auf den Bus von Touch Shading, messen, wiederholen bis ΔE unter Toleranz. Schrittweite begrenzt, jeder Schritt sichtbar und rückgängig zu machen.
- Danach **Drift-Wächter**: Schwarzboden und Neutralstatistik je Kamera gegen das Gruppenmittel, Meldung bei Abweichung.
- Kameras ohne Steuerweg bekommen den Vorschlag als Text/Werte wie im Farbabgleich-Panel.

### 5. Lokale Aufzeichnung der Quellen (mittel)

Zweck: Abgleich nachträglich prüfen (vorher/nachher, Drift über die Show), Kameras ohne Live-Zugriff vergleichen, Belege für Kunden.

- **In der Bridge, im selben ffmpeg-Prozess** wie der Analyse-Strom (zweiter Ausgang). Geräte wie DeckLink oder V4L2 lassen sich nicht zweimal öffnen.
- **Netzwerkquellen (RTSP, SRT, NDI-H.264/HEVC)**: `-c:v copy` ohne Neukodierung, praktisch ohne CPU. Beim RTP-Eigenempfang die Access Units direkt in eine Datei schreiben (`server/mkv.mjs` kann das schon als Strom).
- **Unkomprimierte Quellen (DeckLink, Capture, Kamera am Rechner)**: wählbar ProRes 422 HQ bzw. DNxHR HQX (10 bit, schnittfähig), HEVC 10 bit mit Hardware-Encoder (VideoToolbox, NVENC, QSV) für lange Mitschnitte, FFV1 für verlustfreie Messung (auch 16-bit-Y′CbCr-Pfad mit Sub-Black/Super-White).
- **Browser-Quellen**: MediaRecorder (8 bit, WebM/MP4).
- **Container**: Matroska bzw. MOV in Segmenten (z. B. 5 min), damit ein Absturz höchstens ein Segment kostet. Ton mit, wenn die Quelle Ton hat.
- **Zeitbezug**: Wanduhr bzw. PTP-Zeit beim ersten Bild und Timecode der Quelle in den Metadaten, dazu die gemessene Latenz. So lassen sich mehrere Mitschnitte bildgenau nebeneinanderlegen.
- **Begleitdatei (JSON)** je Aufnahme: Quellen-Einstellungen (Transfer, Matrix, Gamut, LUT/CST), Paint-Änderungen aus Schritt 4, Messwerte, Marker per Taste. Die Paint-Änderungen erscheinen bei der Wiedergabe als Marken auf der Zeitleiste.
- **Ringpuffer** („die letzten 60 s sichern“) neben der Daueraufnahme: ffmpeg schreibt je Quelle Segmente von etwa 2 s reihum in einen festen Dateisatz (Segment-Muxer, `segment_wrap`), die älteste wird überschrieben. *Sichern* fügt die Segmente ohne Neukodierung zusammen (`concat`, `-c copy`), ab dem letzten Keyframe vor „jetzt − 60 s“, optional mit Nachlauf; ein Druck sichert alle Quellen mit derselben Zeitmarke, die Begleitdaten des Fensters kommen mit. Immer auf der Platte, nicht im RAM (ProRes 422 HQ 1080p50 ≈ 2,7 GB je Minute, H.264 mit 10 Mbit/s ≈ 75 MB, Richtwerte). Länge, Nachlauf, Quellen und Zielordner einstellbar; freien Platz prüfen und warnen. Auslösen per Taste, Kopfleiste, Control-API, Companion.
- **Wiedergabe**: Eine Aufnahme ist eine Dateiquelle; mehrere Aufnahmen laufen an einer gemeinsamen Uhr synchron. Damit gehen Geisterspur, Match-Matrix und A/B auch nachträglich.
- Bedienung: Aufnahme je Quelle in der Quellenkarte und „alle aufnehmen“ in der Kopfleiste, Steuerbefehl in der Control-API und für Companion.

### Reihenfolge

1 Geisterspur → 5 Aufzeichnung (Netzwerkquellen mit `copy` zuerst) → 2 gleichzeitig einfrieren → 3 Farbtafel-Matrix, Hautton, Ausschnitt-Vergleich → 4 Schleife und Drift-Wächter.

### Prüfung

- Geisterspur und Match-Matrix mit synthetischen Bildern in vitest (bekannte Verschiebung bzw. Matrix muss herauskommen).
- Aufzeichnung: e2e mit lavfi-Testquelle; die Datei muss mit ffprobe lesbar sein, Bildzahl und Zeitstempel müssen stimmen, Neustart mitten im Segment darf nur dieses Segment kosten.
- Ohne echte Kameras ungeprüft bleiben: Schleife über die Bridge, Hardware-Encoder, DeckLink-Aufnahme.

## Quellen

- [Pomfort: Referenzmedien](https://pomfort.com/article/consistent-looks-with-reference-media/), [Livegrade Single/Multi-View](https://kb.pomfort.com/livegrade/hands-on/monitoring/using-single-and-multi-view-modes/)
- [Nobe OmniScope Live Pack](https://digitalproduction.com/2026/03/11/nobe-omniscope-gets-live-pack-for-on-set-and-live-monitoring/)
- [Leader LV5490E](https://www.adorama.com/ldrlv5490e.html), [Colore mit Leader ZEN](https://www.broadcastbeat.com/colore-digital-imaging-goes-mobile-with-leader-lv5350-zen-series-video-waveform-monitor), [Tektronix App-Note 25W-27159](https://www.telestream.net/pdfs/app-notes/Camera-Setup-Matching-and-Alignment-Application-Note-25W271590.pdf)
- [Canon Color Matching App](https://www.sportsvideo.org/2025/01/16/canon-rolls-out-camera-color-matching-application-for-cr-n700-ptz-camera/)
- [Panasonic Auto-Match](https://news.panasonic.com/global/press/en260902-2)
- [Cyanview VP4](https://twist-cluster.com/members/cyanview.htm?lng=en)
- [vMix-Forum: Referenzkamera-Wunsch](https://forums.vmix.com/posts/m38635-X-Rite-color-correction-support-for-multicam)
- Vorarbeit: [scope-wuensche.md](scope-wuensche.md) (Wunsch 1, Ideen 1–3)
