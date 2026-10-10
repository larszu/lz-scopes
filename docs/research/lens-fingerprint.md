# Objektiv-Fingerabdruck

Stand 10.10.2026. Idee 9 aus [scope-wuensche.md](scope-wuensche.md). Code: `src/whiteShading.ts` (wiederverwendbarer Rechenkern White Shading, ohne DOM), `src/lensprint.ts` (Fingerabdruck, Vergleich, Speicher), `src/lensPanel.ts` (Panel *Objektiv-Fingerabdruck*), Tests `test/lensprint.test.ts`, `e2e/lens.spec.ts`.

Zum Zeitpunkt der Umsetzung war keine White-Shading-Karte eines anderen Zweigs in `main` (geprüft mit `git fetch && git log origin/main`). Der Kern ist darum eigenständig geschnitten: `shadingGrid` (Zellmittel R/G/B) → `shadingFit` (Säge/Parabel je Kanal, Luma-Karte) → `centreColour`; eine spätere White-Shading-Karte kann ihn direkt nutzen.

## Quellen

| Kürzel | Quelle | Was daraus übernommen ist |
|---|---|---|
| SONY | Sony „The Basics of Camera Technology“ (lokal `~/Desktop/Scopes/Cameratechnology.pdf`), Druckseite 10 „White Shading“, 34 „Lens File“, 45 „V Modulation“ | White Shading: Grün-/Magentastich oben und unten trotz Weißabgleich in der Mitte (Prisma, Einfallswinkel); häufiger ungleichmäßige Transmission des Objektivs, „center of the image being brighter than the edges“, korrigiert mit einer parabolischen Korrekturwelle. Lens File: jedes Objektiv bringt eigene „offset“-Eigenschaften mit, die Kamera speichert die Korrektur je Objektiv. V Modulation: Grün/Magenta oben/unten, verursacht durch Objektiv „and/or the different optical axis of each zoom position“, als Parameter des Lens File abgerufen |
| TEK | Tektronix Application Note 25W-27159-0 „Camera Setup, Matching and Alignment“ (lokal), S. 2–4 | Messung auf gleichmäßig beleuchtetem Diffusor (Abweichungen ±0,5 % typisch, 1 % nicht ungewöhnlich), Gain 0 dB, Knee und Gamma aus, leicht unscharf; Säge (saw) und Parabel (par) H/V je Kanal, Reihenfolge Grün, Rot, Blau; Prüfung im Vectorscope bei hoher Verstärkung; „store this setup as a new lens file preset“, je Objektiv und Filter wiederholen; ungleichmäßige Fläche verfälscht das Ergebnis |
| TVT | [TV Technology: White shading](https://tvtechnology.com/miscellaneous/white-shading) (gelesen 10.10.2026) | gleicher Inhalt wie TEK (saw 50 / par 0 als Ausgangswert, Speichern als Lens-File-Preset) |
| ROSS | [Ross Acid Cam: Lens White](https://help.rossvideo.com/acid/Tasks/Acid-Cam/Lens/Lens-White.html) (gelesen 10.10.2026) | H- und V-Shading je RGB am Waveform angleichen, Shutter aus, Gain 0 dB, mit und ohne Extender wiederholen |

## Rechnung

- Raster 16 × 9 Zellmittel von R, G, B über das Bild oder den Messrahmen; wahlweise Codewerte (Gamma aus, wie TEK) oder mit der inversen BT.709-OETF linearisiert.
- Je Kanal Ausgleichsfläche v = a + b·x + c·y + d·x² + e·y² über die Zellmitten, x und y von −1 (links/oben) bis +1. Angezeigt in % von a: Säge H/V = b, c (Änderung von der Mitte zum rechten/unteren Rand), Parabel H/V = d, e (Ränder gegen die Mitte, negativ = Randabfall), Rest = RMS dessen, was die vier Terme nicht erklären. Die Begriffe sind die Kamera-Regler aus TEK/SONY; Umrechnung in Reglerwerte einer bestimmten Kamera gibt es nicht (herstellerabhängig, nicht dokumentiert).
- Mittenfarbe R/G und B/G aus den angepassten Mittelwerten (Farbe des Objektivs bei gleichem Weißabgleich).
- Fingerabdruck = Objektivname, Zoomstellung (Zahl, z. B. Brennweite), Datum, Signalart, die Terme je Kanal, Mittenfarbe und Luma-Karte; gespeichert im Browser (`localStorage`), als JSON export- und importierbar.
- Vergleich live minus gespeichert in Prozentpunkten je Kanal und Term, Mittenfarbe in %, größte Abweichung benannt. Auswahl: fest gewählt, sonst gleiches Objektiv mit nächstem Zoom, sonst der ähnlichste gespeicherte Fingerabdruck (RMS der Termdifferenzen plus Farbänderung, eigene Festlegung).

„Farbabweichung“ ist hier die Mittenfarbe und die Farbschattierung über das Feld (unterschiedliche Säge/Parabel je Kanal). Laterale chromatische Aberration (Farbsäume an Kanten) braucht ein Kantenmuster und ist nicht enthalten.

## Prüfstand

- Synthetisch (`syntheticField`): flaches Feld ohne Shading; Rot-Säge 3 % und Randabfall −8/−5 % in allen Kanälen erkannt (± 0,1 Pp.); Grün/Magenta oben/unten als gegenläufige V-Sägen; Mittenfarbe; Vergleich benennt Kanal und Term; Erkennung von Objektiv und Zoom aus drei gespeicherten Fingerabdrücken; nächster Zoom.
- e2e: flaches Testbild, Fingerabdruck speichern, Vergleich zeigt Δ = 0.
- **Nicht geprüft:** mit echten Objektiven, Zoomfahrten, Extendern; ob die Fläche gleichmäßig genug ist, kann das Panel nicht unterscheiden (TEK: ungleichmäßiges Licht sieht aus wie Shading).
