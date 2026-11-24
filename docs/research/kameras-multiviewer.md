# Kameras aus einem Multiviewer (#217) und der Split als Quelle (#177)

## Stand (erste Stufe)

- **Kamera = Eingang oder Ausschnitt davon** (`src/cameras.ts`, `src/derived.ts` `CameraSource`).
  Eine Kamera ist eine eigene Quelle und taucht in jeder Quellenauswahl auf (Panels, Kacheln,
  Referenz, Farbtafel, Steuer-API). Farbe, Matrix und CST/LUT-Kette teilt sie mit dem Eingang:
  eine Kachel ist dasselbe Signal.
- **„Aufteilen …“** an jeder Videoquelle: Vorlagen 2×2, 3×3, 4×4, 2 + 8, 1 + 5, Kachel per Klick
  weglassen, Namen im Raster, Rand abziehen (Vorgabe 10 % der Kachelhöhe je Seite).
  Erneutes Aufteilen nutzt die vorhandenen Kameras der Reihe nach weiter, Panels behalten ihre Kamera.
- **Abzeichen „aus Multiviewer · B×H“** an Karte und Panelkopf; bei Rauschen und Fokus-Peaking als Warnung.
- **„Ersetzen durch Eingang …“** hängt eine Kamera auf einen anderen Eingang um (ganzes Bild), Name und Platz bleiben.
- **Split als Quelle (#177)**: Ein Bild-Panel mit A/B-Split liefert die Quelle „Split Panel N“
  (`SplitSource`): links der Linie A, rechts B auf A skaliert (nächstes Pixel, wie im Bild).
  Knopf ◧ im Kopf des Bild-Panels, im ⚙ „Andere Panels folgen beim Einschalten“.
  Jedes Panel kann einem Bild-Panel folgen („Folge Bild-Panel N“), Split eingeschlossen.
- Steuer-API: `source.split`, `panel.split`, `panel.follow` (docs/control-api.md).

## Warum die Vorlagen so aussehen

Kacheln behalten das Seitenverhältnis des Gesamtbildes (Breiten- und Höhenanteil gleich). ATEM-Multiviews
bestehen aus Quadranten, die entweder eine große Kachel oder vier kleine sind; daraus 2×2, 4×4 und 2 + 8
(Voreinstellung mit Preview/Program oben). Das im Issue genannte „1 groß + 6“ lässt sich mit
seitenrichtigen Kacheln nicht lückenlos legen; stattdessen 1 + 5 (große Kachel = 2×2 Zellen eines 3×3-Rasters).

## Grenzen (ehrlich)

- Der Ausschnitt entsteht **nach** dem Skalieren der Bridge auf die Analysebreite. Bei 960 Pixel
  Breite ist eine 2×2-Kachel 480 Pixel breit, eine 4×4-Kachel 240. Abhilfe heute: Analysebreite des
  Eingangs auf 1920 oder nativ.
- Der Split setzt A und B nur zusammen, wenn beide im selben Format ankommen (Bittiefe,
  RGB/Y′CbCr, beide aus der Bridge oder beide aus dem Browser). B wird mit der Dekodierung von A
  gemessen, ohne CST/LUT-Kette. Eine andere Stufe derselben Quelle als B gibt es nur im Bild.
- Geprüft mit Testbildern (Rampe, Balken) in Unit- und E2E-Tests, nicht mit einem echten
  Multiviewer (ATEM, Videohub, Decimator) und nicht mit DeckLink/AJA.

## Offen (nächste Wellen aus #217)

1. Bridge: `&crop=x,y,w,h` vor `scale=`, ein Dekoder je Eingang (`split` → N × `crop,scale`),
   Breite/Rate je Teilstrom änderbar.
2. Kamera-Leiste mit Vorschaubildern, Tasten 1–9 und ←/→ für die aktive Kamera, Wischen,
   `camera.next`/`camera.select`, gestaffelte Last (aktive Kamera voll, Leiste 160 px/5 fps).
3. Raster im Dialog ziehen, automatische Erkennung der Fugen (Zeilen-/Spaltenprofile), OCR der Labels.
4. Ansichten Vergleich (Referenzkamera als Geist) und Übersicht mit Ampel je Kamera.
5. „Dem Mischer folgen“ über lz-camera-bridge (Program/Preview).
6. Kamera-Set mit dem Layout speichern und mitnehmen.
