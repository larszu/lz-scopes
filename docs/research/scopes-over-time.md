# Farbe über die Zeit, 3D-Würfel und Abgleich mit Nobe OmniScope

Stand: 01.10.2026. Nur geöffnete Quellen.

## Quellen

| Quelle | Befund |
|---|---|
| Nobe OmniScope Doku, Übersicht (docs.timeinpixels.com/nobe-omniscope) | Scopes: Source Signal, Waveform, Vectorscope, Sat/Lum, CIE Plot, Gamut Scope, Min Max, Histogram, False Color, Skintone, Neutral Scope, TwinPeaks, Channel Plot, Error Logger, 3D Color Cube, HectorScope, Snapshot, Timecode, Audio Meter, Goniometer, 3D LUT / ICC Profile, Text Display; dazu QC (Gamut, Luminanz-Grenzen, HDR-Statistik), SDI, 3D-LUTs, Overlays, Stream-Deck-Steuerung |
| OmniScope „3D Color Cube“ | Pixel als Punkte in RGB, CIE XYZ, CIE Lab, CHL (zylindrisch: Chroma/Hue/Lightness) oder HSV; Ziehen = drehen, Shift-Ziehen = verschieben, Mausrad = Zoom, Doppelklick = zurück; Punktgröße, Helligkeit, Downsampling, Farb-Pins als 3D-Marker |
| OmniScope „HectorScope“ | 3D-Waveform: Y′, Cb, Cr als drehbarer Würfel |
| OmniScope „Min Max“ | je Bildzeile hellstes und dunkelstes Pixel (kein Zeitverlauf), Fehlerschwellen, Zielmarken |
| OmniScope „Sat / Lum“ | x = Luma, y = Sättigung (Länge des CbCr-Vektors), Colorize, Matrix 601/709/2020 |
| OmniScope „TwinPeaks“ | Double Diamond (oben G/B, unten G/R) |
| OmniScope „Neutral Scope“ | markiert fast-neutrale Pixel mit leichtem Farbstich, Schwelle (Standard 5 %), Bereich Schatten/Mitten/Lichter |
| OmniScope „Channel Plot“ | zwei Kanäle als X/Y-Punktwolke: R/G, R/B, G/B, Y/Cb, Y/Cr, Cb/Cr |
| OmniScope „Error Logger“ | Liste mit Zeitcode: Gamut-Verletzungen, HDR-Gamut-Warnungen, Luminanzgrenzen, Blanking, Zeilenfehler, Schwarzbilder, tote Pixel, Audio-Stille; Filter und Export |
| Movie Barcode (z. B. github.com/timbennett/movie-barcodes, dmadison/FrameVis; ProVideo Coalition „A single picture reveals all the colors of a movie“) | je Bild eine senkrechte Linie in der Mittelfarbe, von links nach rechts – Farbe über die Zeit auf einen Blick |

In den geöffneten OmniScope-Seiten gibt es **keinen** Zeitverlauf-Scope (keine Historie, keine Spur über die Zeit); Zeitbezug hat nur der Error Logger (Liste mit Timecode).

## Umsetzung in LZ Scopes

- **Zeitverlauf** (neuer Scope, `src/history.ts`): zehnmal pro Sekunde ein 96×54-Raster; Spuren: Mittelfarbe (Movie-Barcode), Farbton-Anteile (Vectorscope über die Zeit, 24 Klassen à 15°, gewichtet mit der Sättigung), Sättigung (Mittel, 95 %), Luma (min–max-Band, Mittel). Zeitraum 10 s / 1 min / 5 min.
- **Nachleuchten** im Digitalmodus für Vectorscope, CIE, Diamond und 3D-Würfel (0,3 s … unendlich): ältere Bilder verblassen mit exp(−t/τ) – Bewegung als Spur.
- **3D-Würfel überarbeitet**: größere Punkte mit mehr Gewicht in ihrer Bildfarbe, Achsen mit Skalen (R′/G′/B′ 0–100 %, L* 0–100, a*/b* ±100, I 0–1, CT/CP ±0,25), 25-%-Hilfsgitter auf den Würfelflächen, kräftigere Kanten, Erklärtext im ⚙.

## Lücken zu OmniScope (Stand nach diesem PR)

| OmniScope | LZ Scopes |
|---|---|
| 3D Color Cube: Farbmodelle CIE XYZ, CHL, HSV; Pan/Zoom; Farb-Pins in 3D | nur R′G′B′, CIELAB, ICtCp; Drehen, kein Pan/Zoom; Messpunkt als Marker, keine Pins |
| HectorScope (Y′CbCr in 3D) | fehlt (als Raum im Würfel nachrüstbar) |
| Min Max (je Zeile) | fehlt |
| Sat / Lum | fehlt (Sättigung nur im Zeitverlauf) |
| Neutral Scope | fehlt |
| Channel Plot (Kanalpaare) | fehlt |
| Error Logger mit Timecode, Filter, Export | fehlt; es gibt Live-Warnungen (R 103, Gamut, Clipping), aber kein Protokoll |
| Snapshot / Text Display | teilweise (Standbild, PNG-Export, Overlay-Szenen) |
| 3D LUT / ICC Profile als Scope | LUTs in der Kette, keine LUT-Volumenansicht |
| Stream-Deck-Steuerung | Steuer-API (HTTP/WebSocket) vorhanden, keine fertige Stream-Deck-Anbindung |

## Umsetzung #67, Teil 1 (Scatter-Scopes)

- **3D-Farbvolumen**: zusätzlich Y′CbCr (3D-Waveform wie OmniScope „HectorScope“), HSV-Zylinder, CIE XYZ, CIE LCh (abgerollt: Farbton als Achse, entspricht OmniScopes „CHL“); Pan (⇧-Ziehen), Zoom (Mausrad), Doppelklick = Ausgangsansicht.
- **Sättigung über Luma** (OmniScope „Sat / Lum“): x = Y′, y = |CbCr| / 0,5; Farbe der Pixel optional.
- **Kanal-Plot** (OmniScope „Channel Plot“): R′/G′, R′/B′, G′/B′, Y′/Cb, Y′/Cr, Cb/Cr; Diagonale = gleiche Kanäle.
- Nachleuchten auch für diese Scopes.

## Umsetzung #67, Teil 2 (Min/Max, Neutral)

- **Min/Max je Zeile** (OmniScope „Min Max“): je Bildzeile dunkelstes und hellstes Y′ (bis 540 Zeilen, oben = Zeile 1), Grenzen R 103 −5/105 % oder legal 0/100 % (Überschreitungen rot), bis zu 4 Ziellinien, Min/Max-Anzeige.
- **Neutral** (OmniScope „Neutral Scope“) als Bild-Overlay: Pixel unter der Sättigungsschwelle (2/5/10 %, Standard 5 %) im gewählten Tonbereich (alles/Schatten/Mitten/Lichter) in ihrem verstärkten Farbstich, exakt Neutrales grau, Rest dunkel; dazu Flächenanteil und mittlerer Stich mit Richtung.
