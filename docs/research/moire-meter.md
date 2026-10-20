# Moiré-Messer für LED-Wände

Stand 10.10.2026. Idee 6 aus [scope-wuensche.md](scope-wuensche.md). Code: `src/led/moire.ts` (Rechnung, ohne DOM), `src/led/moireUi.ts` (im LED-Wand-Dialog, Kameraprüfung), Tests `test/moire.test.ts`, `e2e/ledfinder.spec.ts`.

## Quellen

| Kürzel | Quelle | Was daraus übernommen ist |
|---|---|---|
| IMA | [Imatest: „Nyquist frequency and aliasing“](https://docs.imatest.com/docs/nyquist-aliasing) (gelesen 10.10.2026) | „By definition fNyq is always 0.5 cycles/pixel“; Beispiel: ein Signal bei 3/2 Nyquist wird mit halber Nyquist-Frequenz (1 Zyklus in 4 Pixeln) aufgezeichnet; Bayer: Rot und Blau haben die halbe Nyquist-Frequenz des Gesamtbildes → Farbmoiré bei feinen, sich wiederholenden Mustern; Anti-Aliasing-Filter verringern Auflösung und Faltung; MTF bei Nyquist über etwa 0,2–0,25 als Warnzeichen, kein Beweis |
| SOU | Southern et al. 2022, [LED Comparison White Paper, Bournemouth University](https://eprints.bournemouth.ac.uk/36826/1/LED_Comparison_White_Paper(1).pdf), S. 2 (Punkt 1) und S. 4–5 (Orthogonal track test) | Kamerasensor (Raster) filmt LED-Wand (Raster) → vorhersehbare, gebogene Linien; „easily detectable when filming close to the screen when it is nearly or entirely in focus“; im Track-Test mit Schärfe 2 ft vor der Wand kaum sichtbar, bei der mobilen High-Frame-Rate-Aufnahme deutlich |
| NS | [Newsshooter 13.04.2023: Sony Virtual Production Tool Set](https://www.newsshooter.com/2023/04/13/sony-virtual-production-tool-set/) | Sonys Plugin zeigt eine Moiré-Warnung „depending on the pixel pitch and other specifications of the wall“ – keine Formel, keine Schwelle genannt; eine Messung im Bild beschreibt der Artikel nicht |

## Rechnung

- **Rasterfrequenz aus der Geometrie.** Die Homographie der LED-Prüfung bildet Wandpixel auf Bildpunkte ab. Der Gradient der Wandkoordinate im Bild (Zeilen der inversen Jacobi-Matrix) ist die Frequenz des LED-Rasters in Zyklen pro Bildpixel, für Spalten- und Zeilenraster getrennt, an Mitte und vier Ecken (Perspektive); die ungünstigste Stelle entscheidet. Umgerechnet auf die **Aufnahmeauflösung** (Eingabe, Standard: native Breite der Quelle), denn das Analysebild der Bridge ist oft kleiner als die Aufzeichnung.
- **Einordnung nach IMA:** ≥ 0,5 Zyklen/px → Faltung (Moiré), erwartete Alias-Frequenz = Rasterfrequenz minus nächster ganzzahliger Gitterpunkt (komponentenweise), Periode = 1/|Alias|; 0,25–0,5 → Rot/Blau des Bayer-Sensors falten (Farbmoiré möglich); < 0,25 → Raster aufgelöst. Die Grenzen sind die Nyquist-Grenzen aus IMA, keine Sichtbarkeitsschwellen; Tiefpassfilter, Debayering und Unschärfe (SOU) entscheiden, wie stark das Moiré wirklich wird.
- **Messung im Bild.** Quadratisches Fenster (128/256/512 px, 70 % der kleineren Seite der Wand-Bounding-Box) um die Wandmitte, Hann-Fenster, 2D-FFT von Luma und von R−B (Farbmoiré; IMA nutzt R und B für seine Farbmoiré-Kennzahl), stärkste Spitze außerhalb einer DC-Zone von 3 Bins, Amplitude in % vom mittleren Luma. Liegt die Spitze beim aus der Geometrie erwarteten Alias (± 3 Bins), ist es Moiré der Wand. Der Alias im Analysebild = Alias der Aufnahme geteilt durch den Maßstab Analyse/Aufnahme.
- Eigene Festlegungen (keine Norm): Fenstergröße, DC-Zone, Toleranz der Übereinstimmung, Amplitude als Vergleichswert.

## Prüfstand

- Synthetisch (`simulateGrid`): runde LED-Spots (Gauß, σ = 0,2 × Pitch als Ersatz für Emittergröße, Optik und Tiefpass), Flächenintegration je Pixel (8 × 8 Unterabtastung). Geprüft: IMA-Beispiel 0,75 → 0,25 Zyklen/px, Pitch 1,1 px → Alias 0,091 Zyklen/px (Periode 11 px) aus Geometrie und Spektrum übereinstimmend, gedrehtes Raster (5°), aufgelöstes Raster (6 px) zeigt seine eigene Frequenz, flaches Feld keine Spitze, Farbraster in R−B, Perspektive (fernes Ende entscheidet), Maßstab Analyse/Aufnahme.
- e2e: Testbild „Moiré“, Bild holen, vier Ecken setzen, messen, 390 px Breite ohne Querscrollen.
- **Nicht geprüft:** an einer echten LED-Wand und mit einer echten Kamera (Tiefpassfilter, Debayering, Schärfentiefe); ob die Amplitude mit sichtbarem Moiré korreliert, ist offen.
