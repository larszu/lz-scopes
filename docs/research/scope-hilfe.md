# LZ Scopes – Hilfetexte je Scope / Help texts per scope

Stand 09.10.2026. Entwurf für die In-App-Hilfe. Deutsch zuerst, Englisch darunter. Texte beschreiben nur, was lz-scopes laut Code/README zeigt (geprüft: `src/graticule.ts`, `src/panel.ts`, `src/renderer.ts`, `src/main.ts`, `src/patterns.ts`, `src/egg.ts`, `src/qclog.ts`, `src/minmax.ts`, `src/history.ts`, `src/deltae.ts`, `src/match/*`, `src/audio/*`, `src/opple/*`, `src/genlock.ts`, `src/clock/*`, `src/i18n/de/*.ts`, `README.de.md`; HLS-Vectorscope auf Branch `feat/hls-vectorscope`).

## Quellenschlüssel

| Kürzel | Quelle |
|---|---|
| BBC57 | BBC Research Dept. Report 1970/30 „BBC Test Chart 57“ (`~/Desktop/Scopes/1970-30.pdf`), PDF-S. 7–11 (= Berichtsseiten 1–5) |
| TEK | Tektronix Application Note „Camera Setup, Alignment and Matching Measurements“, 25W-27159-0, 2011 (`…/Camera-Setup-Matching-and-Alignment-Application-Note-25W271590.pdf`), PDF-Seite |
| SONY | Sony „The Basics of Camera Technology“ (`…/Cameratechnology.pdf`), Druckseite (PDF-Seite) |
| R103 | EBU R 103 v3.0 (2020), Tab. 1 p5, Filter p5, 1-%-Regel p5 – Werte geprüft in `lz-scopes/docs/research/ebu-video.md` |
| BT.2408 | ITU-R BT.2408-8 (2024), Tab. 1 p9 (203 cd/m², 75 % HLG, 58 % PQ, Graukarte 38 %), Tab. 2 p11 (Haut, Rasen) – via `ebu-video.md` |
| BT.814 | ITU-R BT.814-4, Tab. 2 p7, Annex 3 p10–11 – via `ebu-video.md` |
| BT.2111 | ITU-R BT.2111-3, Tab. 2 p9–10 (PLUGE −2/0/+2/+4 % = 48/64/80/99) – via `ebu-video.md` |
| BT.709 / BT.2020 / BT.2100 / BT.1886 | ITU-R-Grundnormen (Primärvalenzen, Luma-Koeffizienten, Quantisierung, EOTF) |
| R128 / T3341 / T3342 / R68 / BS.1770 / BT.1359 | EBU R 128 (2023), s1, s2; EBU Tech 3341/3342; EBU R 68; ITU-R BS.1770-5; ITU-R BT.1359-1 – Seitenangaben in `lz-scopes/docs/research/audio.md` |
| RD-1 | reddit r/VIDEOENGINEERING „Video shading“ https://www.reddit.com/r/VIDEOENGINEERING/comments/13ik5e1/video_shading/ (per RSS gelesen) |
| RD-2 | reddit „EIC/Camera Shading“ https://www.reddit.com/r/VIDEOENGINEERING/comments/1behzp2/ (RSS) |
| RD-3 | reddit „Black Shading Question“ https://www.reddit.com/r/VIDEOENGINEERING/comments/1qtm2oq/ (RSS) |
| RD-4 | reddit „Can someone explain to me color matrix …“ https://www.reddit.com/r/VIDEOENGINEERING/comments/16hdoql/ (RSS) |
| RD-5 | reddit „TV White“ https://www.reddit.com/r/VIDEOENGINEERING/comments/15uxd9m/ (RSS) |
| RD-6 | reddit „Colour correction“ https://www.reddit.com/r/VIDEOENGINEERING/comments/1jjmwmu/ (RSS) |
| YT-1 | „White Balance – Color Correction for Broadcast!“ (Sold out Media) https://www.youtube.com/watch?v=yxceiOl5VJ4 – nur Titel/Beschreibung/Kapitel, Transkript nicht abrufbar |
| YT-2 | „Multi-camera Set Up for High End Production | Tektronix“ https://www.youtube.com/watch?v=dnT-zRhWVK4 – nur Titel/Beschreibung |
| PL-Q3 | Playlist „Television Studio Mixer/Switcher & Camera Racking/Shading“ (Q3 Media Training, BCU 2020) – nur Videotitel (Camera Line up Auto/Manual YCrCb/Manual RGB, Camera Racking YCrCb/RGB) |

Alle Zielwerte für die Testbild-Aufgaben sind aus BT.709 berechnet (Y′ = 0,2126 R′ + 0,7152 G′ + 0,0722 B′) und gelten für das Testbild „SMPTE 75 % Balken + PLUGE“ in lz-scopes: obere Reihe 75 % Grau, Gelb, Cyan, Grün, Magenta, Rot, Blau (je 75 %); darunter ein schmaler Streifen Blau, Schwarz, Magenta, Schwarz, Cyan, Schwarz, Grau; unten −I, 100 % Weiß, +Q, Schwarz und PLUGE −2/0/+2/0/+4 % (`src/patterns.ts`). Luma der oberen Balken: **75,0 / 69,6 / 59,1 / 53,6 / 21,4 / 15,9 / 5,4 %**. Die Testbild-Quelle arbeitet in Full-Range-R′G′B′: Der −2-%-Streifen landet dort auf 0 %, die Balken auf 191/255 ≈ 74,9 %. Echte −2 % gibt es nur bei den Testbildern mit exakten 10-bit-Codes (z. B. „SMPTE 75 % Balken + PLUGE (LZ)“, BT.814-PLUGE, BT.2111-Balken) bzw. im Bridge-Modus *16 bit Y′CbCr* (README „Testbilder“, „Grenzen“).

---

## Video – Bild und Waveforms

### picture – Bild / Picture

**DE**
- **title:** Bild
- **oneLiner:** Das Quellbild, wahlweise mit Overlay: Falschfarben, Zebra, Clipping, Hautton, Grün, Luma, Gamut, EBU R 103 oder Neutral.
- **whatFor:** Erste Kontrolle, ob Bild, Schärfe und Ausschnitt stimmen, und Belichtung direkt im Bild prüfen. Zebra und Falschfarben zeigen, wo Lichter clippen oder Haut liegt, ohne den Blick vom Motiv zu nehmen. Ein Klick setzt einen Messpunkt, ein gezogener Rahmen einen Messbereich für alle Scopes; Rechtsklick löscht.
- **howToRead:**
  - Overlay Zebra: Streifen auf allem, dessen Luma Y′ den eingestellten Pegel erreicht (Vorgabe 95 %).
  - Falschfarben (Paletten ARRI, Belichtung, RED Video, Sony SDR, Sony S-Log3) färben Pegelbänder; die Legende unten links nennt die Bänder der gewählten Palette.
  - Gamut-Warnung: Pixel mit negativen Anteilen im Zielgamut (709/P3/2020), in drei Stufen gelb/orange/magenta.
  - Overlay „EBU R 103“: gelb = außerhalb −5/105 %, rot = außerhalb des Gesamtbereichs (Codes 4–1019).
  - Gut: Zebra nur auf Spitzlichtern, nicht auf Gesichtern oder großen Flächen.
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“, im ⚙ Overlay „Zebra“, Pegel 95 % (Vorgabe). **Erfolg:** Streifen erscheinen nur auf dem 100-%-Weißfeld unten, nicht auf dem 75-%-Grau oben links.
- **pitfall:** Das Bild zeigt das Signal über den Display-Farbraum des Rechners; Monitor-Helligkeit sagt nichts über den Pegel. Gemessen wird immer das Signal (README).
- **sources:** SONY S. 47 (PDF 52, Zebra); TEK PDF 3 (Zebra 95 % für Shading-Aufbau); R103; README.de.md „Bild“.

**EN**
- **title:** Picture
- **oneLiner:** The source picture, optionally with an overlay: false colour, zebra, clipping, skin tone, green, luma, gamut, EBU R 103 or neutral.
- **whatFor:** First check of picture, focus and framing, and exposure right in the image. Zebra and false colour show where highlights clip or where skin sits without looking away from the subject. A click sets a probe point, a dragged box a measurement area for every scope; right-click clears.
- **howToRead:**
  - Zebra overlay: stripes on everything whose luma Y′ reaches the set level (default 95 %).
  - False colour (palettes ARRI, Exposure, RED Video, Sony SDR, Sony S-Log3) colours level bands; the legend at bottom left lists the bands of the chosen palette.
  - Gamut warning: pixels with negative components in the target gamut (709/P3/2020), in three steps yellow/orange/magenta.
  - "EBU R 103" overlay: amber = outside −5/105 %, red = outside the total range (codes 4–1019).
  - Good: zebra only on speculars, not on faces or large areas.
- **tryIt:** "SMPTE 75 % bars + PLUGE" test pattern, in ⚙ overlay "Zebra", level 95 % (default). **Success:** stripes appear only on the 100 % white patch at the bottom, not on the 75 % grey at top left.
- **pitfall:** The picture passes through the computer's display colour space; monitor brightness says nothing about level. Scopes always measure the signal.
- **sources:** as above.

### wf-luma – Waveform Luma

**DE**
- **title:** Waveform Luma
- **oneLiner:** Helligkeit (Y′) jedes Pixels, von links nach rechts wie im Bild.
- **whatFor:** Das Grundwerkzeug für Belichtung, Schwarz- und Weißpegel. Beim Shading stellt man hier Iris und Master Black (Pedestal) ein und vergleicht Kameras auf einem Graukeil. Für die Legalität zeigt sie, ob Pegel über 100 % oder unter 0 % gehen.
- **howToRead:**
  - Waagerecht: Bildposition links → rechts; senkrecht: Pegel −7 … 110 % (Skala auch 8/10 bit, cd/m²).
  - 0 % = Schwarz (Code 64 bei 10 bit), 100 % = Nennweiß (Code 940).
  - Lupen: Schwarz-Lupe −5 … 15 %, Lichter-Lupe 85 … 110 %.
  - Optional Grenzlinien −5/105 % (EBU R 103); Marken bei HDR 75 % HLG / 58 % PQ Referenzweiß und 38 % Graukarte, bei Log 18 % Grau.
  - Gut: Schwarz knapp über 0 %, Weiß bei ≤ 100 %, Graukeil als gleichmäßige Treppe.
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“, Lupe „voll“; danach im ⚙ Lupe „Schwarz-Lupe“. **Erfolg:** In voller Ansicht stehen die Balken bei 75,0 / 69,6 / 59,1 / 53,6 / 21,4 / 15,9 / 5,4 %; in der Schwarz-Lupe zeigt das PLUGE-Feld rechts unten +2 % und +4 % als zwei Stufen über 0 %.
- **pitfall:** Hautton „auf 70 IRE“ ist eine Faustregel, kein Normwert; das Publikum sieht das Bild, nicht die Waveform (RD-1). Für SDR gibt es keinen genormten Hautpegel.
- **sources:** TEK PDF 15 (Waveform-Anhang); SONY S. 38–39 (PDF 43–44, Pedestal); BBC57 PDF 8–9 (Graukeil, Kontrastgesetz); R103; BT.2408; RD-1.

**EN**
- **title:** Luma waveform
- **oneLiner:** Brightness (Y′) of every pixel, left to right as in the picture.
- **whatFor:** The basic tool for exposure, black and white level. When shading, iris and master black (pedestal) are set here and cameras are compared on a grey scale. For legality it shows whether levels go above 100 % or below 0 %.
- **howToRead:**
  - Horizontal: picture position left → right; vertical: level −7 … 110 % (scale also in 8/10 bit or cd/m²).
  - 0 % = black (code 64 at 10 bit), 100 % = nominal white (code 940).
  - Magnifiers: black magnifier −5 … 15 %, highlight magnifier 85 … 110 %.
  - Optional limit lines −5/105 % (EBU R 103); markers for HDR at 75 % HLG / 58 % PQ reference white and 38 % grey card, for log at 18 % grey.
  - Good: black just above 0 %, white ≤ 100 %, grey scale as an even staircase.
- **tryIt:** "SMPTE 75 % bars + PLUGE" pattern, zoom "full"; then in ⚙ zoom "black magnifier". **Success:** in the full view the bars sit at 75.0 / 69.6 / 59.1 / 53.6 / 21.4 / 15.9 / 5.4 %; in the black magnifier the PLUGE area at bottom right shows +2 % and +4 % as two steps above 0 %.
- **pitfall:** "Skin at 70 IRE" is a rule of thumb, not a standard; viewers watch the picture, not the waveform (RD-1). There is no standardised SDR skin level.
- **sources:** as above.

### wf-color – Waveform Farbe / Colour waveform

**DE**
- **title:** Waveform Farbe
- **oneLiner:** Luma-Waveform, jeder Punkt in seiner Bildfarbe.
- **whatFor:** Zeigt auf einen Blick, welche Bildteile welchen Pegel haben – nützlich, wenn mehrere Objekte auf ähnlicher Höhe liegen (z. B. Gesicht vor heller Wand). Ersetzt beim schnellen Belichten oft den Wechsel zwischen Bild und Waveform.
- **howToRead:**
  - Achsen und Skala wie Waveform Luma.
  - Farbe = Pixelfarbe (Helligkeit angeglichen, damit dunkle Pixel sichtbar bleiben), Höhe = Luma; Farbe verändert die Messung nicht.
  - Gut: das wichtige Objekt (Gesicht, Logo) ist an seiner Farbe erkennbar und liegt im gewünschten Band.
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“. **Erfolg:** Der gelbe Balken erscheint gelb bei 69,6 %, der blaue blau bei 5,4 %.
- **pitfall:** Farbe heißt nicht Kanalpegel: ein roter Punkt bei 16 % bedeutet Luma 16 %, nicht R′ = 16 %. Für Kanäle die RGB-Parade nehmen.
- **sources:** README.de.md „Waveforms“; TEK PDF 15.

**EN**
- **title:** Colour waveform
- **oneLiner:** Luma waveform with every dot drawn in its picture colour.
- **whatFor:** Shows at a glance which part of the picture sits at which level – useful when several objects share a level (face against a bright wall). Often replaces switching between picture and waveform during quick exposure.
- **howToRead:**
  - Axes and scale as the luma waveform.
  - Colour = pixel colour (brightness normalised so dark pixels stay visible), height = luma; colour does not change the measurement.
  - Good: the key object (face, logo) is recognisable by colour and sits in the intended band.
- **tryIt:** "SMPTE 75 % bars + PLUGE". **Success:** the yellow bar appears yellow at 69.6 %, the blue one blue at 5.4 %.
- **pitfall:** Colour is not channel level: a red dot at 16 % means luma 16 %, not R′ = 16 %. Use the RGB parade for channels.
- **sources:** as above.

### wf-skin – Waveform Hauttöne / Skin-tone waveform

**DE**
- **title:** Waveform Hauttöne
- **oneLiner:** Luma-Waveform, in der nur Hauttöne farbig sind, der Rest grau.
- **whatFor:** Findet Gesichter in der Waveform, auch in vollen Bildern, und zeigt, ob sie zwischen Kameras auf gleicher Höhe liegen. Hilft beim Racking von Moderation und Talk, wo Haut das wichtigste Bildelement ist.
- **howToRead:**
  - Band mit zwei Linien = Luma-Bereich (Vorgabe 30–80 %), Linien ziehen verstellt ihn; Mausrad = Farbton-Toleranz um die Hautton-Linie 123° (Vorgabe ±14°).
  - Farbig erscheinen nur Pixel innerhalb von Luma-Bereich und Farbton-Toleranz, alle anderen grau.
  - Das Vectorscope zeigt dazu den Toleranzkeil um die Hautton-Linie.
  - Bereich auch per ⚙ „Bereich aus Messrahmen“ übernehmbar (vorher Rahmen im Bild aufs Gesicht ziehen).
  - Gut: farbige Punkte gebündelt, bei mehreren Kameras auf ähnlicher Höhe.
- **tryIt:** Testbild „ColorChecker (Näherung)“, Vorgaben unverändert. **Erfolg:** Die beiden Hautfelder (obere Reihe, Feld 1 und 2) erscheinen farbig; Blau-, Grün-, Cyan- und Graufelder bleiben grau. Das Feld Orange liegt knapp an der Toleranzgrenze und kann mitgefärbt sein.
- **pitfall:** Feste Hautpegel gibt es nur für HDR (BT.2408: HLG 55–65 % bzw. PQ 45–55 % für helle Haut, dunklere Haut tiefer). Für SDR sind Werte wie „70–80 IRE“ Erfahrungswerte aus der NTSC-Zeit [unsicher als Zielwert].
- **sources:** BT.2408 Tab. 2 p11; SONY S. 47 (PDF 52, 70–90-IRE-Zebra, „Caucasian skin ~80 IRE“); TEK PDF 14 (TandemVu: Hautpegel und Vectorscope gleichzeitig); RD-1.

**EN**
- **title:** Skin-tone waveform
- **oneLiner:** Luma waveform where only skin tones are coloured, the rest grey.
- **whatFor:** Finds faces in the waveform, even in busy pictures, and shows whether they sit at the same level across cameras. Helps racking presenters and talk shows, where skin is the most important element.
- **howToRead:**
  - Band with two lines = luma range (default 30–80 %), drag the lines to change it; mouse wheel = hue tolerance around the 123° skin-tone line (default ±14°).
  - Only pixels inside both luma range and hue tolerance are coloured, all others grey.
  - The vectorscope shows the matching tolerance wedge around the skin-tone line.
  - The range can also be taken via ⚙ "Range from measuring frame" (first drag a measuring frame onto a face in the picture).
  - Good: coloured dots grouped; with several cameras, at a similar height.
- **tryIt:** "ColorChecker (approximation)" pattern, defaults unchanged. **Success:** the two skin patches (top row, patches 1 and 2) appear in colour; blue, green, cyan and grey patches stay grey. The orange patch sits right at the tolerance limit and may be coloured too.
- **pitfall:** Fixed skin levels exist only for HDR (BT.2408: HLG 55–65 % / PQ 45–55 % for light skin, darker skin lower). SDR figures like "70–80 IRE" are NTSC-era practice [uncertain as a target].
- **sources:** as above.

### wf-green – Waveform Grüntöne / Green-tone waveform

**DE**
- **title:** Waveform Grüntöne
- **oneLiner:** Luma-Waveform, die nur Grüntöne (Rasen, Laub) farbig zeigt.
- **whatFor:** Sport und Außenübertragung: Rasen soll über alle Kameras gleich hell und gleich grün wirken. Zeigt Pegel und Lage des Grüns, ohne dass Trikots oder Werbebanden stören.
- **howToRead:**
  - Band = Luma-Bereich des Grün-Qualifiers (Vorgabe 40–55 %), Linien ziehen verstellt ihn; Farbton 198° ± 20° (Vorgabe), Mausrad = Toleranz. Im Vectorscope als „Grün-Keil“ einblendbar.
  - Gut: Rasenpunkte als enges Band, bei allen Kameras auf gleicher Höhe.
- **tryIt:** Testbild „ColorChecker (Näherung)“; die untere Band-Linie von 40 % auf etwa 35 % ziehen. **Erfolg:** Vorher ist kein Feld farbig (Laub liegt bei 39,4 % Luma), danach erscheint nur das Feld Laub (obere Reihe, Feld 4) farbig.
- **pitfall:** Die Vorgabe 40–55 % stammt aus BT.2408 für **HLG**-HDR; für SDR gibt es keinen Normwert. Unter LED-Flutlicht kann der Farbton wandern (RD-1).
- **sources:** BT.2408 Tab. 2 p11 (Rasen HLG 40–55 %, PQ 40–45 %); `src/match/core.ts` GREEN_DEFAULT; RD-1 (LED-Stadionlicht).

**EN**
- **title:** Green-tone waveform
- **oneLiner:** Luma waveform that colours only greens (grass, foliage).
- **whatFor:** Sport and OB: grass should look equally bright and equally green across all cameras. Shows the level and hue of the green without shirts or boards getting in the way.
- **howToRead:**
  - Band = luma range of the green qualifier (default 40–55 %), drag the lines to change it; hue 198° ± 20° (default), mouse wheel = tolerance. Can be shown in the vectorscope as the "green wedge".
  - Good: grass dots as a tight band, at the same height on all cameras.
- **tryIt:** "ColorChecker (approximation)"; drag the lower band line from 40 % to about 35 %. **Success:** before, no patch is coloured (foliage sits at 39.4 % luma); afterwards only the foliage patch (top row, patch 4) appears in colour.
- **pitfall:** The 40–55 % default comes from BT.2408 for **HLG** HDR; SDR has no standard value. Under LED floodlights the hue can drift (RD-1).
- **sources:** as above.

### wf-rgb – Waveform RGB (Overlay)

**DE**
- **title:** Waveform RGB
- **oneLiner:** R′, G′ und B′ übereinander in einer Waveform.
- **whatFor:** Schneller Neutralitäts-Check: Bei Grau und Weiß müssen alle drei Kanäle deckungsgleich sein. Beim Weiß- und Schwarzabgleich sieht man sofort, welcher Kanal vorsteht.
- **howToRead:**
  - Achsen wie Waveform Luma; drei Spuren in Kanalfarben (mono/Bildfarben wählbar), Kanäle einzeln abschaltbar.
  - Wo sich alle drei decken, entsteht Weiß = neutral.
  - Gut: Graukeil als eine weiße Treppe ohne farbige Säume.
- **tryIt:** Testbild „Graustufen 11 (0–100 %)“. **Erfolg:** Jede Stufe erscheint als eine weiße Linie, kein roter, grüner oder blauer Rand.
- **pitfall:** Bei bunten Bildern überlagern sich die Spuren und verdecken sich; zum Einstellen einzelner Kanäle die Parade nehmen.
- **sources:** TEK PDF 4–5 (Parade/Kanäle beim Shading), PDF 15; SONY S. 46 (PDF 51, R:G:B = 1:1:1 für Weiß).

**EN**
- **title:** RGB waveform
- **oneLiner:** R′, G′ and B′ overlaid in one waveform.
- **whatFor:** Quick neutrality check: on grey and white all three channels must coincide. During white and black balance it shows at once which channel sticks out.
- **howToRead:**
  - Axes as the luma waveform; three traces in channel colours (mono/picture colours selectable), channels can be switched off individually.
  - Where all three coincide the trace turns white = neutral.
  - Good: the grey scale as one white staircase without coloured fringes.
- **tryIt:** "Grey steps 11 (0–100 %)". **Success:** each step shows as one white line, no red, green or blue edge.
- **pitfall:** On colourful pictures the traces overlap and hide each other; use the parade to adjust single channels.
- **sources:** as above.

### parade – RGB-Parade / RGB parade

**DE**
- **title:** RGB-Parade
- **oneLiner:** R′, G′ und B′ nebeneinander, je ein Drittel der Breite.
- **whatFor:** Das Hauptwerkzeug für Weiß-/Schwarzabgleich und Shading: Auf einer Graukarte oder einem Graukeil müssen die drei Kanäle gleich hoch stehen. White Shading (Saw/Par) stellt man kanalweise so ein, dass jede Spur flach wird. Mit *Touch Shading* (Kamera über lz-camera-bridge oder Simulator) lassen sich Black und White je Kanal direkt hier ziehen.
- **howToRead:**
  - Drei Felder R | G | B, jedes mit Bildposition links → rechts und Pegel −7 … 110 %.
  - Gleiche Höhe in allen drei Feldern = neutral (Grau/Weiß).
  - Flache Spur auf gleichmäßiger Weißfläche = Shading in Ordnung; Bogen = Hotspot/Randabfall, Schräge = Saw-Fehler.
  - Gut: Schwarz aller Kanäle auf gleicher Höhe knapp über 0 %, Weiß gleich hoch.
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“. **Erfolg:** In R stehen Grau, Gelb, Magenta, Rot auf 75 % und Cyan, Grün, Blau auf 0 %; G und B entsprechend (G: Grau, Gelb, Cyan, Grün; B: Grau, Cyan, Magenta, Blau).
- **pitfall:** Black Balance mit ganz hochgezogenem Pedestal verfälscht den Abgleich; Pedestal nur so weit anheben, dass nichts clippt (RD-3). Weißabgleich auf Papier mit Aufheller oder unter ungleichmäßigem Licht verfälscht alle Kanäle (TEK PDF 6). Graukarten sind nicht immer neutral (BBC57: ±4 % Reflexionsgleichheit nötig).
- **sources:** TEK PDF 3–5 (White Shading in Parade, Reihenfolge G, R, B), PDF 6; BBC57 PDF 7–8 (Neutralität, 4 % sichtbar); SONY S. 10 (PDF 16, White Shading), S. 25 (PDF 30, Black Balance), S. 46 (PDF 51); PL-Q3 („Camera Racking RGB“); RD-3; RD-6 (Werkseinstellung, Black Balance verschlossen, Weiß auf Vectorscope-Mitte).

**EN**
- **title:** RGB parade
- **oneLiner:** R′, G′ and B′ side by side, one third of the width each.
- **whatFor:** The main tool for white/black balance and shading: on a grey card or grey scale the three channels must stand equally high. White shading (saw/par) is adjusted per channel until each trace is flat. With *Touch Shading* (camera via lz-camera-bridge or the simulator) black and white per channel can be dragged right here.
- **howToRead:**
  - Three cells R | G | B, each with picture position left → right and level −7 … 110 %.
  - Same height in all three = neutral (grey/white).
  - Flat trace on an even white field = shading OK; bow = hotspot/edge fall-off, slope = saw error.
  - Good: black of all channels level just above 0 %, white equally high.
- **tryIt:** "SMPTE 75 % bars + PLUGE". **Success:** in R, grey, yellow, magenta, red sit at 75 % and cyan, green, blue at 0 %; G and B accordingly (G: grey, yellow, cyan, green; B: grey, cyan, magenta, blue).
- **pitfall:** Black balancing with pedestal fully raised skews the result; raise it only enough that nothing clips (RD-3). White balancing on paper with optical brighteners or under uneven light skews all channels (TEK p6). Grey cards are not always neutral (BBC57: ±4 % reflectance uniformity needed).
- **sources:** as above.

### yrgb – YRGB-Parade

**DE**
- **title:** YRGB-Parade
- **oneLiner:** Luma und R′, G′, B′ nebeneinander in vier Feldern.
- **whatFor:** Verbindet Belichtung (Y′) und Kanalbalance in einer Ansicht – praktisch beim Shading, wenn man Iris/Pedestal und Farbbalance gleichzeitig führt.
- **howToRead:**
  - Felder Y | R | G | B, Skala wie Waveform Luma.
  - Y′ zeigt die Helligkeit, R/G/B die Balance; bei Grau alle vier gleich hoch.
  - Gut: Graukarte in allen vier Feldern auf gleicher Höhe.
- **tryIt:** Testbild „Grau 50 %“. **Erfolg:** Alle vier Spuren liegen als flache Linie bei 50 %.
- **pitfall:** Y′ ist gewichtet (Grün zählt 71,5 %, Blau 7,2 % bei BT.709); ein blauer Fehler fällt im Y-Feld kaum auf, nur im B-Feld.
- **sources:** BT.709 (Luma-Koeffizienten); TEK PDF 15.

**EN**
- **title:** YRGB parade
- **oneLiner:** Luma and R′, G′, B′ side by side in four cells.
- **whatFor:** Combines exposure (Y′) and channel balance in one view – handy when shading iris/pedestal and colour balance at the same time.
- **howToRead:**
  - Cells Y | R | G | B, scale as the luma waveform.
  - Y′ shows brightness, R/G/B the balance; on grey all four are equally high.
  - Good: grey card at the same height in all four cells.
- **tryIt:** "Grey 50 %" pattern. **Success:** all four traces sit as a flat line at 50 %.
- **pitfall:** Y′ is weighted (green counts 71.5 %, blue 7.2 % in BT.709); a blue error barely shows in the Y cell, only in B.
- **sources:** as above.

### ycbcr – YCbCr-Parade

**DE**
- **title:** YCbCr-Parade
- **oneLiner:** Luma Y′ und die Farbdifferenzen Cb und Cr nebeneinander.
- **whatFor:** Zeigt das Signal so, wie es auf SDI übertragen wird. Grau muss in Cb und Cr genau auf der Nulllinie liegen; Abweichung = Farbstich. Klassische Ansicht für „Camera Line up / Racking YCrCb“.
- **howToRead:**
  - Y′-Feld wie Waveform Luma; Cb und Cr sind um 50 % versetzt auf derselben Skala gezeichnet, die 50-%-Linie ist ihr Nullpunkt.
  - Oberhalb von 50 %: Cb = Richtung Blau, Cr = Richtung Rot; unterhalb: Gelb bzw. Cyan/Grün.
  - Gut: alle neutralen Flächen exakt auf der 50-%-Linie von Cb und Cr.
- **tryIt:** Testbild „Graustufen 11 (0–100 %)“. **Erfolg:** Cb und Cr sind über die ganze Breite eine flache Linie bei 50 % (= 0), Y′ eine Treppe von 0 bis 100 %.
- **pitfall:** HD- und SD-Signale sehen bei gleichen Balken in Y′ und Cb/Cr verschieden aus (andere Matrix BT.709 vs. BT.601) – das ist kein Fehler (TEK PDF 8).
- **sources:** TEK PDF 8 (HD/SD-Unterschied), PDF 16; SONY S. 56 (PDF 61, Y/R−Y/B−Y); BT.709; PL-Q3 („Camera Line up Manual YCrCb“).

**EN**
- **title:** YCbCr parade
- **oneLiner:** Luma Y′ and the colour differences Cb and Cr side by side.
- **whatFor:** Shows the signal as it travels on SDI. Grey must sit exactly on the Cb and Cr zero line; any offset is a colour cast. The classic view for "camera line-up / racking YCrCb".
- **howToRead:**
  - Y′ cell as the luma waveform; Cb and Cr are drawn offset by 50 % on the same scale, the 50 % line is their zero.
  - Above 50 %: Cb = towards blue, Cr = towards red; below: yellow and cyan/green respectively.
  - Good: every neutral area exactly on the 50 % line of Cb and Cr.
- **tryIt:** "Grey steps 11 (0–100 %)". **Success:** Cb and Cr are one flat line at 50 % (= 0) across the whole width, Y′ a staircase from 0 to 100 %.
- **pitfall:** HD and SD signals look different in Y′ and Cb/Cr for the same bars (BT.709 vs BT.601 matrix) – not a fault (TEK p8).
- **sources:** as above.

---

## Video – Farbe

### vector – Vectorscope

**DE**
- **title:** Vectorscope
- **oneLiner:** Farbton als Winkel, Farbsättigung als Abstand von der Mitte (Cb waagerecht, Cr senkrecht).
- **whatFor:** Prüft Farbbalken, Weißabgleich und Matrix-Einstellungen und vergleicht Kameras farblich. Weiß und Grau gehören in die Mitte; jeder Versatz ist ein Farbstich. Beim White Shading zeigt hohe Verstärkung, ob die Weißfläche als kleiner Punkt in der Mitte liegt.
- **howToRead:**
  - Kästchen = 75-%-Ziele, kleine Kreise = 100-%-Ziele (nur bei ×1), passend zur Matrix der Quelle.
  - Gestrichelte Linie = Hautton-Linie (123°), mit Toleranzkeil der Hautton-Waveform.
  - Zoom ×1/×2/×5; Ziele außerhalb erscheinen als Dreieck am Rand, oben rechts „×2 ZOOM“ bzw. „×5 ZOOM“.
  - Im ⚙ einblendbar: Gamut-Grenzen 709/P3/2020, Grün-Keil, eigene Farbziele.
  - Gut: Balkenpunkte in den Kästchen, Grau als Punkt in der Mitte.
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“, Zoom ×1. **Erfolg:** Die sechs Farbpunkte liegen in den sechs 75-%-Kästchen; Grau, Weiß und Schwarz bilden einen Punkt in der Mitte. (Zwei zusätzliche Punkte außerhalb der Kästchen stammen von −I und +Q aus der unteren Reihe.) Winkel zur Kontrolle (Teilstriche alle 10°, 0° = +Cb rechts, gegen den Uhrzeigersinn): Gelb ≈ 175°, Rot ≈ 103°, Magenta ≈ 50°, Blau ≈ 355°, Cyan ≈ 283°, Grün ≈ 230°.
- **pitfall:** Echte Farbtafeln (z. B. DSC ChromaDuMonde) sind weniger gesättigt als Balken und erreichen die Kästchen erst mit ×2 (TEK PDF 9). Die Hautton-Linie ist Praxis, kein Normwert [unsicher, keine Primärquelle für 123°].
- **sources:** TEK PDF 1/9 (DSC-Tabelle „Vector Angle“ für BT.709-Primärfarben: 175,0/282,6/229,5/51,0/103,4/355,4°; eigene BT.709-Rechnung 174,8/282,9/229,7/49,7/102,9/354,8°, Abweichung bei Magenta 1,3°, sonst ≤ 0,5°); TEK PDF 4–5 (Vector-Gain 20× für Shading), PDF 9–10 (75 %, ×2, Matrix), PDF 16 (Aufbau, Kästchen); SONY S. 27 (PDF 32, Farbbalken); YT-1 (Kapitel „vectro scope“); `docs/research/ebu-video.md` (123° ohne Beleg).

**EN**
- **title:** Vectorscope
- **oneLiner:** Hue as angle, saturation as distance from centre (Cb horizontal, Cr vertical).
- **whatFor:** Checks colour bars, white balance and matrix settings and compares cameras for colour. White and grey belong in the centre; any offset is a cast. During white shading, high gain shows whether a white field stays a small dot in the centre.
- **howToRead:**
  - Boxes = 75 % targets, small circles = 100 % targets (only at ×1), matching the source matrix.
  - Dashed line = skin-tone line (123°), with the tolerance wedge of the skin waveform.
  - Zoom ×1/×2/×5; off-screen targets become triangles at the rim, "×2 ZOOM" or "×5 ZOOM" badge top right.
  - Optional in ⚙: gamut limits 709/P3/2020, green wedge, own colour targets.
  - Good: bar dots inside the boxes, grey as a dot in the centre.
- **tryIt:** "SMPTE 75 % bars + PLUGE", zoom ×1. **Success:** the six colour dots sit in the six 75 % boxes; grey, white and black form one dot in the centre. (Two extra dots outside the boxes come from −I and +Q in the bottom row.) Angles to check (ticks every 10°, 0° = +Cb to the right, counter-clockwise): yellow ≈ 175°, red ≈ 103°, magenta ≈ 50°, blue ≈ 355°, cyan ≈ 283°, green ≈ 230°.
- **pitfall:** Real charts (e.g. DSC ChromaDuMonde) are less saturated than bars and only reach the boxes at ×2 (TEK p9). The skin-tone line is practice, not a standard value [uncertain, no primary source for 123°].
- **sources:** as above.

### hls – HLS-Vectorscope

> Implementierung auf Branch `feat/hls-vectorscope` (`src/graticule.ts` hsl/hlsPoint/drawHlsGraticule, Shader `src/renderer.ts` uMode 12), noch nicht in `main`.

**DE**
- **title:** HLS-Vectorscope
- **oneLiner:** Farbton (HSL) als Winkel, HSL-Sättigung als Abstand zur Mitte.
- **whatFor:** Zeigt die Sättigung unabhängig davon, wie hell eine Farbe ist. Hilft, dunkle oder sehr helle Farben zu beurteilen, die im normalen Vectorscope nahe der Mitte zusammenrücken, und liest sich wie das Vectorscope: Rot liegt an derselben Stelle, die Farbtöne laufen in dieselbe Richtung.
- **howToRead:**
  - Winkel = HSL-Farbton; Rot an der Stelle, an der das Vectorscope Rot für die Matrix der Quelle zeigt (BT.709: ≈ 103°), danach Gelb, Grün, Cyan, Blau, Magenta in 60°-Schritten gegen den Uhrzeigersinn (Speichen R, Yl, G, Cy, B, Mg).
  - Radius = HSL-Sättigung S = (max − min) / (1 − |max + min − 1|) der R′G′B′-Werte (auf 0–100 % begrenzt); Ringe bei 25/50/75/100 %.
  - Mitte = unbunt (Grau, Weiß, Schwarz).
  - Keine Zielkästchen und keine Hautton-Linie.
  - Gut: Neutrales in der Mitte; dieselbe Farbe bei verschiedener Helligkeit am selben Radius.
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“. **Erfolg:** Die sechs Farbbalken liegen auf dem 100-%-Ring, jeweils auf ihrer Speiche (R, Yl, G, Cy, B, Mg); Grau, Weiß und Schwarz liegen in der Mitte. Obwohl die Balken nur 75 % Pegel haben, erreichen sie den äußeren Ring, weil die HSL-Sättigung nicht von der Helligkeit abhängt. (Zwei weitere Punkte auf dem Ring stammen von −I und +Q aus der unteren Reihe.)
- **pitfall:** Nahe Schwarz und Weiß reicht ein winziger Kanalunterschied für hohe HSL-Sättigung; Rauschen in den Tiefen erscheint dann als „gesättigt“. Werte unter 0 % und über 100 % werden vorher abgeschnitten. Für Legalität und Balkenpegel das normale Vectorscope nehmen.
- **sources:** keine der Vorgabequellen behandelt HLS; Formel = Standard-HSL-Definition, im Code `hsl()` und Shader uMode 12, Test `test/hls.test.ts` (Branch `feat/hls-vectorscope`); Abgrenzung zu TEK PDF 19 (Spearhead: Sättigung/Helligkeit aus max/min, nicht in lz-scopes).

**EN**
- **title:** HLS vectorscope
- **oneLiner:** Hue (HSL) as angle, HSL saturation as distance from the centre.
- **whatFor:** Shows saturation independent of how bright a colour is. Helps judging dark or very bright colours that crowd towards the centre of the normal vectorscope, and reads like the vectorscope: red sits in the same place and the hues run the same way round.
- **howToRead:**
  - Angle = HSL hue; red where the vectorscope shows red for the source matrix (BT.709: ≈ 103°), then yellow, green, cyan, blue, magenta in 60° steps counter-clockwise (spokes R, Yl, G, Cy, B, Mg).
  - Radius = HSL saturation S = (max − min) / (1 − |max + min − 1|) of R′G′B′ (limited to 0–100 %); rings at 25/50/75/100 %.
  - Centre = neutral (grey, white, black).
  - No target boxes and no skin-tone line.
  - Good: neutrals in the centre; the same colour at different brightness at the same radius.
- **tryIt:** "SMPTE 75 % bars + PLUGE". **Success:** the six colour bars sit on the 100 % ring, each on its spoke (R, Yl, G, Cy, B, Mg); grey, white and black sit in the centre. Although the bars are only at 75 % level they reach the outer ring, because HSL saturation does not depend on brightness. (Two further dots on the ring come from −I and +Q in the bottom row.)
- **pitfall:** Near black and white a tiny channel difference produces high HSL saturation; shadow noise then looks "saturated". Values below 0 % and above 100 % are clipped first. Use the normal vectorscope for legality and bar levels.
- **sources:** as above.

### cie – CIE-Diagramm / CIE diagram

**DE**
- **title:** CIE-Diagramm
- **oneLiner:** Farbort jedes Pixels im CIE 1931 xy oder 1976 u′v′, mit Gamut-Dreiecken.
- **whatFor:** Zeigt, welchen Farbraum das Material tatsächlich nutzt und ob Farben über Rec.709 hinausgehen (HDR/WCG, Kamera-Gamuts). Hilft bei der Prüfung von Konvertierungen (CST, LUT) und Grafiken.
- **howToRead:**
  - Hufeisen = Spektralzug (reine Spektralfarben, mit nm-Beschriftung); Dreiecke Rec.709, P3-D65, Rec.2020, dazu das Gamut der Quelle, wenn es keines davon ist; Kreis bei D65.
  - Helligkeit fehlt: Hell und dunkel gleicher Farbe fallen auf denselben Punkt.
  - Gut: Punkte innerhalb des Zielgamuts; Grau auf D65.
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“. **Erfolg:** Rot, Grün, Blau liegen genau auf den Ecken des Rec.709-Dreiecks (R x 0,640/y 0,330, G 0,300/0,600, B 0,150/0,060), Gelb, Cyan, Magenta auf dessen Kanten, Grau auf D65 (0,3127/0,3290).
- **pitfall:** 75-%- und 100-%-Balken liegen am selben Ort – das Diagramm zeigt keine Pegel. u′v′ (im ⚙ umschaltbar) ist für Farbabstände gleichmäßiger als xy. −I und +Q der unteren Reihe erscheinen als zusätzliche Punkte.
- **sources:** BT.709 (Primärvalenzen, D65); BT.2020; TEK PDF 7 (Normfarbtafel); RD-4 (BT.709-Koordinaten genannt, stimmen mit BT.709 überein).

**EN**
- **title:** CIE diagram
- **oneLiner:** Chromaticity of every pixel in CIE 1931 xy or 1976 u′v′, with gamut triangles.
- **whatFor:** Shows which colour space the material actually uses and whether colours exceed Rec.709 (HDR/WCG, camera gamuts). Helps checking conversions (CST, LUT) and graphics.
- **howToRead:**
  - Horseshoe = spectral locus (labelled in nm); triangles Rec.709, P3-D65, Rec.2020, plus the source gamut when it is none of these; circle at D65.
  - Lightness is missing: light and dark versions of one colour land on the same point.
  - Good: points inside the target gamut; grey on D65.
- **tryIt:** "SMPTE 75 % bars + PLUGE". **Success:** red, green, blue sit exactly on the Rec.709 corners (R x 0.640/y 0.330, G 0.300/0.600, B 0.150/0.060), yellow, cyan, magenta on its edges, grey on D65 (0.3127/0.3290).
- **pitfall:** 75 % and 100 % bars land on the same spot – the diagram shows no level. u′v′ (switchable in ⚙) is more uniform for colour differences than xy. −I and +Q from the bottom row show as extra points.
- **sources:** as above.

### diamond – Diamond (Gamut)

**DE**
- **title:** Diamond (Gamut)
- **oneLiner:** Zwei Rauten nach Tektronix: zeigen R′G′B′-Balance und Gamut-Verstöße je Kanal.
- **whatFor:** Ideal für Graubalance beim Shading: eine richtig abgeglichene Kamera auf Graukeil oder Weißfläche erzeugt eine senkrechte Linie. Gleichzeitig zeigt die Raute, wie viel Reserve bis zur Gamutgrenze bleibt.
- **howToRead:**
  - Oben: B′+G′ (senkrecht) über B′−G′ (waagerecht); unten: −(R′+G′) über R′−G′.
  - Mitte = Schwarz, obere/untere Spitze = Weiß; Grau = senkrechte Linie; gestrichelte innere Raute = 50 %.
  - Knick nach links/rechts oben → Blau/Grün-Fehler, unten → Rot/Grün-Fehler; Grünfehler zeigen sich in beiden Rauten.
  - Alles Legale liegt innerhalb beider Rauten.
  - Gut: senkrechte, gerade Linie; nichts außerhalb.
- **tryIt:** Testbild „Grauverlauf 0–100 %“. **Erfolg:** In beiden Rauten eine senkrechte Linie von der Mitte bis zur Spitze.
- **pitfall:** Hardware-Geräte filtern kurze Überschwinger heraus, lz-scopes nicht: scharfe Kanten können knapp außerhalb erscheinen, ohne dass das Signal im Sinne von R 103 (mit Messfilter) illegal ist.
- **sources:** TEK PDF 6 (Weißabgleich mit Diamond), PDF 8 (Rot-Fehler), PDF 13 (oben Blau, unten Rot), PDF 17–18 (Aufbau, Tiefpass); README.de.md „Diamond“; R103 (Messfilter); RD-3 (Schwarz im Diamond auf die Mitte legen trifft besser als Vectorscope-Zoom; Gegenstimme: Diamond nur im Betrieb nützlich); RD-2 (Doppel-Diamond zum Kamera-Matching).

**EN**
- **title:** Diamond (gamut)
- **oneLiner:** Two Tektronix-style diamonds showing R′G′B′ balance and per-channel gamut errors.
- **whatFor:** Ideal for grey balance when shading: a correctly balanced camera on a grey scale or white field gives a vertical line. At the same time the diamond shows how much headroom remains to the gamut limit.
- **howToRead:**
  - Top: B′+G′ (vertical) vs B′−G′ (horizontal); bottom: −(R′+G′) vs R′−G′.
  - Centre = black, top/bottom apex = white; grey = vertical line; dashed inner diamond = 50 %.
  - Bend in the top diamond → blue/green error, bottom → red/green error; green errors show in both.
  - Everything legal stays inside both diamonds.
  - Good: straight vertical line; nothing outside.
- **tryIt:** "Grey ramp 0–100 %". **Success:** a vertical line from centre to apex in both diamonds.
- **pitfall:** Hardware scopes low-pass filter short overshoots, lz-scopes does not: sharp edges can poke just outside without the signal being illegal under R 103 (which uses a measurement filter).
- **sources:** as above.

### cube – 3D-Farbvolumen / 3D colour volume

**DE**
- **title:** 3D-Farbvolumen
- **oneLiner:** Punktwolke aller Pixel als 3D-Volumen (R′G′B′-Würfel, Y′CbCr, HSV, CIE XYZ, CIELAB, LCh oder ICtCp), frei drehbar.
- **whatFor:** Zeigt das ganze Farbvolumen auf einmal: welche Ecken (Primär-, Sekundärfarben, Weiß, Schwarz) erreicht oder abgeschnitten werden und ob ein Farbstich die Grauachse verschiebt. Nützlich bei LUT- und Konvertierungsprüfung, die Vectorscope und Diamond nur als Projektion zeigen.
- **howToRead:**
  - Drahtgitter = Zielgamut (im R′G′B′-Würfel der 0–100-%-Würfel, dazu ein 25-%-Raster); gestrichelte Grauachse von Schwarz nach Weiß.
  - Ziehen = drehen, ⇧+ziehen = schieben, Rad oder Pinch = Zoom, Doppelklick = zurücksetzen.
  - Der Messpunkt aus dem Bild erscheint als Kreis im Volumen. Optional zeigt der Würfel das Volumen einer geladenen LUT.
  - Gut: Grau auf der Achse, Farben innerhalb des Gitters.
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“, Raum R′G′B′-Würfel, Messpunkt im Bild auf den gelben Balken. **Erfolg:** Die Balken liegen auf den Ecken eines kleineren Würfels mit 75 % Kantenlänge (an den 75-Marken der Achsen); der Messpunkt-Kreis sitzt auf der Ecke R′ 75 / G′ 75 / B′ 0.
- **pitfall:** In R′G′B′ ist der Abstand nicht wahrnehmungsgleich; für „wie stark sieht man den Unterschied“ CIELAB/ICtCp und ΔE verwenden (Einstellungen → „ΔE am Messpunkt“, angezeigt im Bild- und im Messwerte-Panel).
- **sources:** `src/i18n/de/panel.ts` (panel.cube.hint); `src/cube.ts` (Räume); README.de.md „3D-Farbvolumen“.

**EN**
- **title:** 3D colour volume
- **oneLiner:** Point cloud of all pixels as a 3D volume (R′G′B′ cube, Y′CbCr, HSV, CIE XYZ, CIELAB, LCh or ICtCp), freely rotatable.
- **whatFor:** Shows the whole colour volume at once: which corners (primaries, secondaries, white, black) are reached or clipped and whether a cast shifts the grey axis. Useful for LUT and conversion checks that vectorscope and diamond only show as projections.
- **howToRead:**
  - Wireframe = target gamut (in the R′G′B′ cube the 0–100 % cube, plus a 25 % grid); dashed grey axis from black to white.
  - Drag = rotate, ⇧+drag = pan, wheel or pinch = zoom, double-click = reset.
  - The probe point from the picture shows as a circle in the volume. Optionally the cube shows the volume of a loaded LUT.
  - Good: grey on the axis, colours inside the wireframe.
- **tryIt:** "SMPTE 75 % bars + PLUGE", space R′G′B′ cube, probe point in the picture on the yellow bar. **Success:** the bars sit on the corners of a smaller cube with 75 % edge length (at the 75 ticks of the axes); the probe circle sits on the corner R′ 75 / G′ 75 / B′ 0.
- **pitfall:** Distance in R′G′B′ is not perceptually uniform; for "how visible is the difference" use CIELAB/ICtCp and ΔE (settings → "ΔE at probe", shown in the picture and measurements panels).
- **sources:** as above.

### satlum – Sättigung über Luma / Saturation vs luma

**DE**
- **title:** Sättigung über Luma
- **oneLiner:** Jeder Pixel als Punkt: waagerecht Luma Y′, senkrecht Sättigung |CbCr|.
- **whatFor:** Zeigt, wo im Helligkeitsbereich Farbe sitzt: gesättigte Lichter (Gefahr für Gamut) oder farbige Schatten (Stich in den Tiefen, z. B. falscher Black Balance). Hilft beim Abgleich von Black und Knee/Low-Key-Saturation.
- **howToRead:**
  - x = Y′ in % (Bereich wie die Waveform), y = Sättigung |CbCr|/0,5 in %, Skala bis 120 % (100 % ≈ voll gesättigte Primärfarbe).
  - Unbunte Pixel liegen unten; Ausbuchtung rechts oben = gesättigte Lichter, links oben = farbige Schatten.
  - Gut: unten links (Schwarz) und unten rechts (Weiß) keine Punkte in der Höhe.
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“. **Erfolg:** Die Balken liegen zwischen etwa 75 % (Gelb, Blau) und 89 % Sättigung (Grün, Magenta), jeweils bei ihrer Luma (z. B. Gelb bei 69,6 %); Grau, Weiß und Schwarz auf 0 % (Werte aus BT.709 berechnet).
- **pitfall:** Die Skala ist |CbCr|/0,5 und keine HSL-Sättigung; dunkle Farben haben hier kleine Werte, auch wenn sie „satt“ aussehen.
- **sources:** `src/graticule.ts` drawSatLumGraticule; SONY S. 36 (PDF 41, Low Key Saturation); SONY S. 25 (PDF 30, Black Balance).

**EN**
- **title:** Saturation vs luma
- **oneLiner:** Each pixel as a dot: horizontal luma Y′, vertical saturation |CbCr|.
- **whatFor:** Shows where in the tonal range colour sits: saturated highlights (gamut risk) or coloured shadows (cast in the blacks, e.g. wrong black balance). Helps with black balance and knee/low-key saturation.
- **howToRead:**
  - x = Y′ in % (same range as the waveform), y = saturation |CbCr|/0.5 in %, scale up to 120 % (100 % ≈ fully saturated primary).
  - Neutral pixels lie at the bottom; bulge top right = saturated highlights, top left = coloured shadows.
  - Good: no raised dots at bottom left (black) or bottom right (white).
- **tryIt:** "SMPTE 75 % bars + PLUGE". **Success:** bars between about 75 % (yellow, blue) and 89 % saturation (green, magenta), each at its luma (e.g. yellow at 69.6 %); grey, white, black at 0 % (values computed from BT.709).
- **pitfall:** The scale is |CbCr|/0.5, not HSL saturation; dark colours show small values here even if they look rich.
- **sources:** as above.

### chplot – Kanal-Plot / Channel plot

**DE**
- **title:** Kanal-Plot
- **oneLiner:** Zwei Kanäle gegeneinander (R′/G′, R′/B′, G′/B′, Y′/Cb, Y′/Cr, Cb/Cr).
- **whatFor:** Zeigt Kanalbalance über den ganzen Pegelbereich: Bei Grau liegen R′/G′-Punkte auf der Diagonale. Ein Gamma- oder Black-Fehler eines Kanals erscheint als Kurve oder Versatz – entspricht dem „Tracking“ eines Graukeils.
- **howToRead:**
  - Gestrichelte Diagonale = gleiche Kanäle (nur bei den R′G′B′-Paaren).
  - Versatz parallel zur Diagonale = Black/Pedestal-Fehler; anderer Winkel = Gain-Fehler; Bogen = Gamma-Fehler.
  - Cb/Cr-Achsen sind −0,50 … +0,50 beschriftet, Mitte = 0.
  - Gut: Graukeil als gerade Linie auf der Diagonale.
- **tryIt:** Testbild „Grauverlauf 0–100 %“, Paar R′/G′. **Erfolg:** Eine durchgehende Linie genau auf der Diagonale.
- **pitfall:** Bunte Bildinhalte liegen naturgemäß neben der Diagonale; die Aussage gilt nur für neutrale Vorlagen.
- **sources:** `src/graticule.ts` drawChannelPlotGraticule; BBC57 PDF 8 (Tracking über den Graukeil); TEK PDF 9 (Tracking prüfen); SONY S. 25 (PDF 30, Black Gamma).

**EN**
- **title:** Channel plot
- **oneLiner:** Two channels plotted against each other (R′/G′, R′/B′, G′/B′, Y′/Cb, Y′/Cr, Cb/Cr).
- **whatFor:** Shows channel balance across the whole range: on grey, R′/G′ dots fall on the diagonal. A gamma or black error in one channel shows as a curve or offset – the grey-scale "tracking" check.
- **howToRead:**
  - Dashed diagonal = equal channels (only for the R′G′B′ pairs).
  - Offset parallel to the diagonal = black/pedestal error; different slope = gain error; bow = gamma error.
  - Cb/Cr axes are labelled −0.50 … +0.50, centre = 0.
  - Good: the grey scale as a straight line on the diagonal.
- **tryIt:** "Grey ramp 0–100 %", pair R′/G′. **Success:** one continuous line exactly on the diagonal.
- **pitfall:** Colourful content naturally lies off the diagonal; the reading is only valid on neutral targets.
- **sources:** as above.

---

## Video – Pegel, QC, Statistik

### minmax – Min/Max je Zeile / Min/max per line

**DE**
- **title:** Min/Max je Zeile
- **oneLiner:** Dunkelstes und hellstes Y′ jeder Bildzeile, von oben nach unten wie im Bild.
- **whatFor:** Findet schnell Zeilen mit Überschreitungen (Super-White, Sub-Black) und zeigt den Kontrastumfang über die Bildhöhe, z. B. bei Black Shading oder Himmel/Boden-Verläufen.
- **howToRead:**
  - Senkrecht: Bildzeile (oben = Zeile 1); waagerecht: Y′ −7 … 110 %. Blaue Spur = Minimum, grüne = Maximum.
  - Grenzen wahlweise EBU R 103 (−5/105 %, Vorgabe) oder legal (0/100 %) als rote gestrichelte Linien; Überschreitungen färben die Spur rot.
  - Bis zu vier eigene Ziellinien (⚙, in %).
  - Gut: keine roten Bereiche; Abstand min–max zeigt Kontrast der Zeile.
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“, ⚙ Grenzen legal. **Erfolg:** Im oberen Bereich min ≈ 5,4 % (Blau) und max ≈ 75 %, unten min = 0 % und max = 100 % (Weißfeld); nichts rot.
- **pitfall:** Bei R′G′B′-Quellen und Browser-Quellen sind Werte unter 0/über 100 % schon abgeschnitten; Überschreitungen sind nur im Bridge-Modus *16 bit Y′CbCr* und bei Testbildern mit exakten 10-bit-Codes sichtbar.
- **sources:** `src/minmax.ts`; `docs/research/scopes-over-time.md`; R103.

**EN**
- **title:** Min/max per line
- **oneLiner:** Darkest and brightest Y′ of each picture line, top to bottom as in the picture.
- **whatFor:** Quickly finds lines with excursions (super-white, sub-black) and shows contrast across the picture height, e.g. for black shading or sky/ground gradients.
- **howToRead:**
  - Vertical: picture line (top = line 1); horizontal: Y′ −7 … 110 %. Blue trace = minimum, green = maximum.
  - Limits EBU R 103 (−5/105 %, default) or legal (0/100 %) as red dashed lines; excursions turn the trace red.
  - Up to four custom target lines (⚙, in %).
  - Good: no red; the min–max gap shows the line's contrast.
- **tryIt:** "SMPTE 75 % bars + PLUGE", ⚙ limits legal. **Success:** in the top area min ≈ 5.4 % (blue) and max ≈ 75 %, at the bottom min = 0 % and max = 100 % (white patch); nothing red.
- **pitfall:** With R′G′B′ and browser sources values below 0/above 100 % are already clipped; excursions only show in the bridge mode *16 bit Y′CbCr* and with test patterns carrying exact 10-bit codes.
- **sources:** as above.

### qclog – QC-Protokoll / QC log

**DE**
- **title:** QC-Protokoll
- **oneLiner:** Zeitgestempelte Liste von Pegel-, Bild- und Tonfehlern aller Live-Quellen.
- **whatFor:** Läuft während Sendung oder Aufzeichnung mit und hält fest, wann und wie lange etwas schiefging: R-103-Verstoß (−5/105 % und Gesamtbereich 4–1019), Weiß-Clipping, Super-White, Sub-Black, Schwarzbild, Standbild, Tonstille. Export als CSV.
- **howToRead:**
  - Jede Zeile = ein Ereignis von Beginn bis Ende, mit Uhrzeit, Quell-Timecode und schlimmstem Wert.
  - Prüfung viermal pro Sekunde; Schwellen im ⚙ (Vorgaben: Clipping ab 0,5 % der Pixel, Schwarzbild Y′ max < 2 %, Stille < −60 dBFS für 2 s, Standbild 2 s); Ereignistypen einzeln ein- und ausblendbar.
  - R 103 meldet erst ab 1 % der Fläche außerhalb −5/105 %.
  - Gut: leere Liste.
- **tryIt:** Testbild „Grau 50 %“, für einige Sekunden auf Testbild „Schwarz“ umschalten und zurück. **Erfolg:** Ein Ereignis „Schwarzbild“ mit Beginn, Ende und Dauer erscheint.
- **pitfall:** Standbilder zählen nur bei Live-Quellen und laufenden Dateien, nicht bei Testbildern oder angehaltenen Dateien. R 103 wird nur im Y′CbCr-Pfad geprüft. Testbilder mit 100-%-Weiß (z. B. SMPTE-Balken) lösen bereits „Weiß-Clipping“ aus.
- **sources:** `src/qclog.ts` (DEFAULT_QC); R103 (1-%-Regel, −5/105 %).

**EN**
- **title:** QC log
- **oneLiner:** Time-stamped list of level, picture and audio faults on all live sources.
- **whatFor:** Runs during a show or recording and records when and for how long something went wrong: R 103 violation (−5/105 % and total range 4–1019), white clipping, super-white, sub-black, black frame, freeze, silence. Export as CSV.
- **howToRead:**
  - Each row = one event from start to end, with clock time, source time code and worst value.
  - Checked four times a second; thresholds in ⚙ (defaults: clipping from 0.5 % of pixels, black frame Y′ max < 2 %, silence < −60 dBFS for 2 s, freeze 2 s); event types can be shown or hidden individually.
  - R 103 reports only from 1 % of the area outside −5/105 %.
  - Good: an empty list.
- **tryIt:** "Grey 50 %" pattern, switch to the "Black" pattern for a few seconds and back. **Success:** a "black frame" event with start, end and duration appears.
- **pitfall:** Freezes count only for live sources and playing files, not for test patterns or paused files. R 103 is only checked in the Y′CbCr path. Patterns with 100 % white (e.g. SMPTE bars) already trigger "white clipping".
- **sources:** as above.

### timeline – Zeitverlauf / Timeline

**DE**
- **title:** Zeitverlauf
- **oneLiner:** Farbe, Farbton, Sättigung und Luma der letzten 10 s, 1 min oder 5 min als Streifen.
- **whatFor:** Zeigt Änderungen über die Zeit: Blendensprünge, wandernder Weißabgleich (ATW), Flackern, Lichtwechsel bei Events. Ein „Movie-Barcode“ macht Schnitte und Stimmungen sichtbar.
- **howToRead:**
  - Waagerecht: Zeit (rechts = jetzt). Oben die mittlere Farbe (Movie-Barcode), darunter Farbtonanteile (hell = viel von diesem Farbton), Sättigung (Mittel und 95 %) und Luma (Bereich min–max, Linie = Mittel).
  - Abtastung zehnmal pro Sekunde auf einem 96×54-Raster (feiner wählbar) oder je Bild.
  - Gut: ruhige, gleichmäßige Streifen, wo das Bild ruhig sein soll.
- **tryIt:** Zwischen „SMPTE 75 % Balken + PLUGE“ und „Grau 50 %“ hin- und herschalten. **Erfolg:** Im Luma- und Sättigungsstreifen erscheinen die Wechsel als scharfe Kanten; bei Grau fällt die Sättigung auf 0.
- **pitfall:** Der Verlauf wertet immer das ganze Bild aus, ein Messrahmen wirkt hier nicht; ein kleiner, falsch belichteter Bildteil fällt kaum auf – dafür Waveform oder Messwerte mit Messrahmen nehmen.
- **sources:** README.de.md „Zeitverlauf“; `src/history.ts`; SONY S. 24 (PDF 29, ATW).

**EN**
- **title:** Timeline
- **oneLiner:** Colour, hue, saturation and luma of the last 10 s, 1 min or 5 min as strips.
- **whatFor:** Shows change over time: iris jumps, drifting auto white balance (ATW), flicker, lighting changes at events. A "movie barcode" reveals cuts and moods.
- **howToRead:**
  - Horizontal: time (right = now). Top the mean colour (movie barcode), below it hue shares (bright = a lot of this hue), saturation (mean and 95 %) and luma (min–max range, line = mean).
  - Sampled ten times a second on a 96×54 grid (finer selectable) or once per frame.
  - Good: calm, even strips where the picture should be steady.
- **tryIt:** Toggle between "SMPTE 75 % bars + PLUGE" and "Grey 50 %". **Success:** the luma and saturation strips show the changes as sharp edges; on grey the saturation drops to 0.
- **pitfall:** The timeline always evaluates the whole frame, a measurement box has no effect here; a small badly exposed area barely shows – use the waveform or measurements with a box for that.
- **sources:** as above.

### hist – Histogramm / Histogram

**DE**
- **title:** Histogramm
- **oneLiner:** Wie viele Pixel auf welchem Pegel liegen – RGB, Luma oder getrennt.
- **whatFor:** Schneller Überblick über Belichtung und Clipping, ohne Bildposition. Zeigt, ob Lichter oder Tiefen abgeschnitten sind (Stapel am Rand) und wie viel Prozent clippen.
- **howToRead:**
  - Waagerecht: Pegel 0–100 %; senkrecht: Anzahl Pixel (linear oder log).
  - Oben links der Clipping-Anteil unten (▼) und oben (▲), jeweils der höchste Wert der Kanäle; je Kanal im Panel *Messwerte*.
  - Darstellung RGB, Luma oder getrennt; im ⚙ umschaltbar.
  - Gut: kein hoher Stapel genau bei 0 % oder 100 %, außer im Motiv gewollt.
- **tryIt:** Testbild „Grauverlauf 0–100 %“, Darstellung Luma. **Erfolg:** Die Verteilung ist über den ganzen Bereich annähernd gleich hoch (flach).
- **pitfall:** Das Histogramm sagt nicht, *wo* im Bild etwas clippt; ein Clipping-Anteil von 0,1 % kann ein Gesicht sein. Mit Zebra oder Waveform gegenprüfen.
- **sources:** README.de.md „Histogramm“; YT-1 (Kapitel „Histogram“).

**EN**
- **title:** Histogram
- **oneLiner:** How many pixels sit at which level – RGB, luma or split.
- **whatFor:** Quick overview of exposure and clipping without picture position. Shows whether highlights or shadows are clipped (pile-up at the edge) and what percentage clips.
- **howToRead:**
  - Horizontal: level 0–100 %; vertical: pixel count (linear or log).
  - Top left the clipping share at the bottom (▼) and top (▲), each the highest of the channels; per channel in the *Measurements* panel.
  - Display RGB, luma or split; switchable in ⚙.
  - Good: no tall pile exactly at 0 % or 100 % unless intended.
- **tryIt:** "Grey ramp 0–100 %", display luma. **Success:** the distribution is roughly equally high across the whole range (flat).
- **pitfall:** The histogram does not say *where* clipping happens; 0.1 % clipping can be a face. Cross-check with zebra or waveform.
- **sources:** as above.

### stats – Messwerte / Measurements

**DE**
- **title:** Messwerte
- **oneLiner:** Zahlen zur Quelle: Format, Y′ min/max/Mittel, Clipping, R 103, MaxCLL/MaxFALL.
- **whatFor:** Liefert die harten Zahlen für Protokoll und Abnahme: ob Pegel im erlaubten Bereich liegen, wie viel Fläche R 103 verletzt, bei PQ-HDR die Content-Light-Level. Zeigt auch Übertragungsweg und verworfene Frames.
- **howToRead:**
  - Y′ min/max/Mittel in % (bei HDR und Log zusätzlich in cd/m² bzw. Szene-%); Clipping je Kanal; MaxCLL/MaxFALL nur bei PQ.
  - R 103: Anteil außerhalb −5/105 % (Meldung ab 1 %) und außerhalb 4–1019 (harte Grenze).
  - Hinweise, wenn die Quelle R′G′B′ (beschnitten) oder Full Range ist.
  - Gut: Y′ min ≥ −5 %, Y′ max ≤ 105 %, R 103 ohne Warnung.
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“. **Erfolg:** Y′ max = 100 %, Y′ min = 0 %, Hinweis auf R′G′B′-Quelle (beschnitten). Mit „SMPTE 75 % Balken + PLUGE (LZ)“ (exakte 10-bit-Codes) zeigt Y′ min −2 % durch den PLUGE-Streifen.
- **pitfall:** R 103 ist für Narrow Range definiert; bei Full-Range-Quellen und R′G′B′-Streams ist das Ergebnis nur ein Prozentvergleich (App meldet das).
- **sources:** R103 (Tab. 1 p5, 1 %, Messfilter); `src/i18n/de/scope.ts` (scope.r103.*); CTA-861.3 (MaxCLL/MaxFALL, laut README); BT.2111 (PLUGE −2 %).

**EN**
- **title:** Measurements
- **oneLiner:** Numbers for the source: format, Y′ min/max/mean, clipping, R 103, MaxCLL/MaxFALL.
- **whatFor:** Provides hard numbers for logs and acceptance: whether levels are in range, how much area violates R 103, and for PQ HDR the content light levels. Also shows transport and dropped frames.
- **howToRead:**
  - Y′ min/max/mean in % (for HDR and log also in cd/m² or scene %); clipping per channel; MaxCLL/MaxFALL for PQ only.
  - R 103: share outside −5/105 % (reported from 1 %) and outside 4–1019 (hard limit).
  - Notes when the source is R′G′B′ (clipped) or full range.
  - Good: Y′ min ≥ −5 %, Y′ max ≤ 105 %, no R 103 warning.
- **tryIt:** "SMPTE 75 % bars + PLUGE". **Success:** Y′ max = 100 %, Y′ min = 0 %, note that the source is R′G′B′ (clipped). With "SMPTE 75 % bars + PLUGE (LZ)" (exact 10-bit codes) Y′ min shows −2 % because of the PLUGE stripe.
- **pitfall:** R 103 is defined for narrow range; with full-range sources and R′G′B′ streams the result is only a percentage comparison (the app says so).
- **sources:** as above.

### match – Farbabgleich / Colour match

**DE**
- **title:** Farbabgleich
- **oneLiner:** Vergleicht Messpunkt oder Rahmenmittel mit einem Ziel oder einer zweiten Kamera.
- **whatFor:** Kamera-Matching und CI-Farben: zeigt, wie weit eine Farbe vom Ziel (Kunden-Hex, Logo) oder vom selben Objekt in einer anderen Kamera entfernt ist, und übersetzt die Korrektur in Kamera-Begriffe (Multi-Matrix, Weißabgleich) und Resolve-Werte.
- **howToRead:**
  - Farbfelder nebeneinander; ΔE00 (SDR) bzw. ΔITP (HDR), dazu ΔL/ΔC/ΔH, Farbton, Sättigung.
  - Ampel: grün bis ΔE 1 (eben merklich), gelb bis zur eingestellten Toleranz, darüber rot; ΔE00 ≈ 1 ist eine Faustregel, keine feste Schwelle.
  - Korrekturvorschlag in Worten und Werten.
  - Gut: ΔE00 nahe 0, ΔH nahe 0 (Farbton stimmt).
- **tryIt:** Testbild „SMPTE 75 % Balken + PLUGE“, im Bild-Panel Messpunkt auf den gelben Balken; im ⚙ des Farbabgleichs „+ Messpunkt“, dann unter „Vergleich mit“ dieses Ziel wählen. **Erfolg:** ΔE00 ≈ 0, Urteil „kaum unterscheidbar“; mit dem Messpunkt auf dem Cyan-Balken ein großer Wert und „deutlich verschieden“.
- **pitfall:** Kamera-Matching ist nur unter gleichem Licht auf derselben Tafel verlässlich; Einstellungen einfach von Kamera zu Kamera kopieren reicht nicht (TEK PDF 11). Multi-Matrix verschiebt angrenzende Farbbereiche mit.
- **sources:** TEK PDF 10–12 (Matrix, Matching, Freeze-Vergleich); SONY S. 38 (PDF 43, Multi Matrix), S. 36 (PDF 41, Linear Matrix); RD-4 (Multi-Matrix für kleine Abweichungen zwischen Kameras); README.de.md „Farbziele und Farbabgleich“.

**EN**
- **title:** Colour match
- **oneLiner:** Compares a probe point or box mean with a target or a second camera.
- **whatFor:** Camera matching and brand colours: shows how far a colour is from the target (client hex, logo) or from the same object in another camera, and translates the correction into camera terms (multi-matrix, white balance) and Resolve values.
- **howToRead:**
  - Swatches side by side; ΔE00 (SDR) or ΔITP (HDR), plus ΔL/ΔC/ΔH, hue, saturation.
  - Traffic light: green up to ΔE 1 (just noticeable), yellow up to the set tolerance, red above; ΔE00 ≈ 1 is a rule of thumb, not a fixed threshold.
  - Correction suggested in words and values.
  - Good: ΔE00 near 0, ΔH near 0 (hue matches).
- **tryIt:** "SMPTE 75 % bars + PLUGE" pattern, probe point on the yellow bar in the picture panel; in the colour match ⚙ "+ Measuring point", then pick this target under "Compare with". **Success:** ΔE00 ≈ 0, verdict "barely distinguishable"; with the probe on the cyan bar a large value and "clearly different".
- **pitfall:** Camera matching is only reliable under the same light on the same chart; copying settings from camera to camera is not enough (TEK p11). Multi-matrix also moves neighbouring hue ranges.
- **sources:** as above.

---

## Audio

### audio-meter – Audio Pegel & Lautheit / Audio level & loudness

**DE**
- **title:** Audio Pegel & Lautheit
- **oneLiner:** Sample-Peak, True Peak und Lautheit (M, S, I, LRA) nach EBU R 128.
- **whatFor:** Pegel und Lautheit für Sendung und Stream einhalten: Programm auf −23 LUFS, Spitzen nicht über −1 dBTP. Zeigt auch Übersteuerungen und den Ausrichtungspegel −18 dBFS.
- **howToRead:**
  - Balken je Kanal: Sample-Peak (100 ms), weiße Marke = True Peak, Peak-Hold 3 s; Marken bei −18 dBFS (R 68) und −1 dBTP (R 128).
  - M (400 ms), S (3 s), I (integriert, gegated) auf Skala EBU +9 oder +18, absolut LUFS oder relativ LU (0 LU = −23 LUFS).
  - LRA in den ersten 60 s als „unstabil“ markiert.
  - Gut: I = −23,0 LUFS (±0,5 LU; ±1 LU bei Live-Programmen, wo enger nicht erreichbar), Max TP ≤ −1 dBTP.
- **tryIt:** Tongenerator: Sinus 1 kHz, Stereo, −18 dBFS, „→ als Messquelle“. **Erfolg:** Peak −18 dBFS auf beiden Kanälen; M und S zeigen den Wert, den der Generator als Soll anzeigt (für diesen Stereo-Sinus etwa −18 LUFS = +5 LU).
- **pitfall:** dBFS (Spitzenpegel) und LUFS (Lautheit) sind verschiedene Größen; ein Programm kann bei −1 dBTP trotzdem viel zu laut oder zu leise sein.
- **sources:** R128 (−23 LUFS, −1 dBTP); T3341 (M 0,4 s, S 3 s, Skalen +9/+18); T3342 (LRA); BS.1770 (K-Filter, Gating −70 LUFS/−10 LU, True Peak); R68 (−18 dBFS) – Seiten in `docs/research/audio.md`.

**EN**
- **title:** Audio level & loudness
- **oneLiner:** Sample peak, true peak and loudness (M, S, I, LRA) to EBU R 128.
- **whatFor:** Keep level and loudness for broadcast and streaming: programme at −23 LUFS, peaks not above −1 dBTP. Also shows overs and the −18 dBFS alignment level.
- **howToRead:**
  - Bar per channel: sample peak (100 ms), white mark = true peak, 3 s hold; marks at −18 dBFS (R 68) and −1 dBTP (R 128).
  - M (400 ms), S (3 s), I (integrated, gated) on EBU +9 or +18 scale, absolute LUFS or relative LU (0 LU = −23 LUFS).
  - LRA flagged "unstable" during the first 60 s.
  - Good: I = −23.0 LUFS (±0.5 LU; ±1 LU for live programmes where tighter is not achievable), max TP ≤ −1 dBTP.
- **tryIt:** Tone generator: 1 kHz sine, stereo, −18 dBFS, "→ as measurement source". **Success:** peak −18 dBFS on both channels; M and S show the value the generator states as target (about −18 LUFS = +5 LU for this stereo sine).
- **pitfall:** dBFS (peak) and LUFS (loudness) are different quantities; a programme peaking at −1 dBTP can still be far too loud or too quiet.
- **sources:** as above.

### audio-loudness – Audio Lautheitsverlauf / Loudness history

**DE**
- **title:** Audio Lautheitsverlauf
- **oneLiner:** Momentary- und Short-term-Lautheit der letzten 1 bis 60 Minuten mit Zielband.
- **whatFor:** Zeigt, ob ein Programm über die Zeit gleichmäßig im Ziel bleibt, und wo laute Einspieler, Applaus oder zu leise Moderation lagen. True-Peak-Überschreitungen sind markiert.
- **howToRead:**
  - Waagerecht: Zeit; senkrecht: Lautheit; Zielband ±1 LU um den Zielwert.
  - Marken bei True Peak > −1 dBTP.
  - Gut: S-Kurve überwiegend im Band, keine Peak-Marken.
- **tryIt:** Generator Sinus −23 dBFS Stereo, nach einer Minute auf −18 dBFS umschalten. **Erfolg:** Die Kurve springt um 5 LU nach oben und verlässt das Zielband.
- **pitfall:** Short-term-Werte schwanken bei Sprache stark; maßgeblich für R 128 ist die integrierte Lautheit I über das ganze Programm.
- **sources:** R128; T3341; README.de.md „Audio Lautheitsverlauf“.

**EN**
- **title:** Loudness history
- **oneLiner:** Momentary and short-term loudness of the last 1 to 60 minutes with a target band.
- **whatFor:** Shows whether a programme stays on target over time and where loud inserts, applause or quiet presenters were. True-peak overs are marked.
- **howToRead:**
  - Horizontal: time; vertical: loudness; target band ±1 LU around the target.
  - Marks where true peak > −1 dBTP.
  - Good: S curve mostly inside the band, no peak marks.
- **tryIt:** Generator sine −23 dBFS stereo, after a minute switch to −18 dBFS. **Success:** the curve jumps up 5 LU and leaves the target band.
- **pitfall:** Short-term values swing a lot with speech; R 128 compliance is judged on integrated loudness I over the whole programme.
- **sources:** as above.

### audio-spectrum – Audio Spektrum / Audio spectrum

**DE**
- **title:** Audio Spektrum
- **oneLiner:** Frequenzverteilung des Tons per FFT, logarithmische Frequenzachse.
- **whatFor:** Findet Brummen (50/100 Hz), Pfeifen, Rückkopplungen und fehlende Höhen; prüft Messtöne und Leitungen.
- **howToRead:**
  - Waagerecht: Frequenz (log), senkrecht: Pegel in dB.
  - Neigung 0/3/4,5 dB/Okt. gleicht die natürliche Abnahme aus; Terzbänder wahlweise.
  - Gut: keine schmalen, stehenden Spitzen, die nicht zum Programm gehören.
- **tryIt:** Generator Sinus 1 kHz. **Erfolg:** Eine einzelne Spitze bei 1 kHz. Dann rosa Rauschen mit Neigung 3 dB/Okt. als Linie: **Erfolg:** annähernd waagerechter Verlauf.
- **pitfall:** Die FFT-Größe bestimmt die Auflösung: kleine FFT trennt tiefe Frequenzen schlecht, große reagiert träge.
- **sources:** README.de.md „Audio Spektrum“ (keine der Vorgabequellen behandelt Audio-Spektren).

**EN**
- **title:** Audio spectrum
- **oneLiner:** Frequency content of the audio via FFT on a log frequency axis.
- **whatFor:** Finds hum (50/100 Hz), whistles, feedback and missing top end; checks test tones and lines.
- **howToRead:**
  - Horizontal: frequency (log), vertical: level in dB.
  - Tilt 0/3/4.5 dB/oct compensates the natural roll-off; third-octave bands optional.
  - Good: no narrow standing peaks that do not belong to the programme.
- **tryIt:** Generator 1 kHz sine. **Success:** a single peak at 1 kHz. Then pink noise with 3 dB/oct tilt as a line: **Success:** roughly horizontal.
- **pitfall:** FFT size sets resolution: a small FFT separates low frequencies poorly, a large one reacts slowly.
- **sources:** as above.

### audio-phase – Audio Goniometer

**DE**
- **title:** Audio Goniometer
- **oneLiner:** Stereobild als M/S-Darstellung mit Korrelationsgradmesser.
- **whatFor:** Prüft Stereo-Breite, Mono-Kompatibilität und Verpolung. Ein verpolter Kanal kann bei Mono-Abhöre (Handy, Radio) Sprache auslöschen.
- **howToRead:**
  - Senkrechte Linie = Mono (L = R); L links oben, R rechts oben.
  - Waagerechte Linie = gegenphasig (L = −R).
  - Korrelation: +1 = mono, 0 = unabhängig, −1 = gegenphasig.
  - Gut: Wolke eher senkrecht, Korrelation überwiegend positiv.
- **tryIt:** Generator Sinus, Schnellwahl L+R. **Erfolg:** senkrechte Linie, Korrelation +1. Dann L−R: **Erfolg:** waagerechte Linie, Korrelation −1.
- **pitfall:** Kurzzeitig negative Korrelation kommt bei breiten Hallanteilen vor; erst dauerhaft negative Werte deuten auf Verpolung. Der Korrelationsgrad ist nicht frei zugänglich genormt (Fenster 600 ms ist eigene Festlegung).
- **sources:** `docs/research/audio.md` (Korrelation ohne frei zugängliche Normdefinition); README.de.md „Audio Goniometer“.

**EN**
- **title:** Audio goniometer
- **oneLiner:** Stereo image as an M/S display with a correlation meter.
- **whatFor:** Checks stereo width, mono compatibility and polarity. A reversed channel can cancel speech on mono playback (phone, radio).
- **howToRead:**
  - Vertical line = mono (L = R); L top left, R top right.
  - Horizontal line = out of phase (L = −R).
  - Correlation: +1 = mono, 0 = uncorrelated, −1 = out of phase.
  - Good: cloud mostly vertical, correlation mostly positive.
- **tryIt:** Generator sine, quick select L+R. **Success:** vertical line, correlation +1. Then L−R: **Success:** horizontal line, correlation −1.
- **pitfall:** Brief negative correlation occurs with wide reverb; only sustained negative values indicate reversed polarity. The correlation meter has no freely available standard definition (600 ms window is an own choice).
- **sources:** as above.

### audio-check – Audio Ident & A/V-Versatz / Audio ident & A/V offset

**DE**
- **title:** Audio Ident & A/V-Versatz
- **oneLiner:** Erkennt Leitungs-Idents, meldet Kanalfehler und misst den Ton-Bild-Versatz.
- **whatFor:** Leitungsprüfung vor der Sendung: kommen alle Kanäle in der richtigen Reihenfolge, Polarität und mit −18 dBFS an? Dazu Lippensynchronität zwischen Blitz und Piep.
- **howToRead:**
  - Erkannt: EBU-Stereo-Ident (R 49), GLITS, BLITS, EBU-Mehrkanal-Ident (Tech 3304), eigener Kanal-Ident.
  - Meldungen: „L/R vertauscht“, „Polarität invertiert“, „Kanal fehlt“, falsche Kanalfolge, Pegel gegen −18 dBFS.
  - A/V-Versatz positiv = Ton vor dem Bild; Bewertung nach BT.1359-1: wahrnehmbar ab etwa +45/−125 ms, akzeptabel bis etwa +90/−185 ms.
  - Gut: keine gelbe oder rote Meldung, Versatz im Bereich +25/−100 ms (BT.1359 Empfehlung 3).
- **tryIt:** Tongenerator „EBU-Stereo-Ident“, Pegel −18 dBFS, „→ als Messquelle“. **Erfolg:** „EBU-Stereo-Ident (R 49)“ erkannt, Meldungen nur grün (L/R richtig zugeordnet, gleichphasig, Pegel −18 dBFS). Dann Schnellwahl R statt L+R: **Erfolg:** Meldung „Kanal L fehlt“.
- **pitfall:** Der A/V-Versatz gilt nur für die gemessene Strecke; ohne einmalige Kalibrierung ist die Bildausgabe des Rechners selbst nicht garantiert synchron.
- **sources:** BT.1359 (Recommends 2–4, Appendix 1 §3); EBU R 49, Tech 3304; R68 – Seiten in `docs/research/audio.md`; README.de.md „A/V-Sync“.

**EN**
- **title:** Audio ident & A/V offset
- **oneLiner:** Recognises line idents, reports channel faults and measures audio-to-video offset.
- **whatFor:** Line check before air: do all channels arrive in the right order and polarity at −18 dBFS? Plus lip sync between flash and beep.
- **howToRead:**
  - Recognised: EBU stereo ident (R 49), GLITS, BLITS, EBU multichannel ident (Tech 3304), own channel ident.
  - Reports: "L/R swapped", "polarity inverted", "channel missing", wrong channel order, level vs −18 dBFS.
  - A/V offset positive = sound ahead of vision; judged per BT.1359-1: detectable from about +45/−125 ms, acceptable up to about +90/−185 ms.
  - Good: no yellow or red report, offset within +25/−100 ms (BT.1359 recommends 3).
- **tryIt:** Tone generator "EBU stereo ident", level −18 dBFS, "→ as measurement source". **Success:** "EBU stereo ident (R 49)" recognised, only green reports (L/R assigned correctly, in phase, level −18 dBFS). Then quick select R instead of L+R: **Success:** report "channel L missing".
- **pitfall:** The A/V offset applies only to the measured path; without a one-time calibration the computer's own picture output is not guaranteed in sync.
- **sources:** as above.

---

## Takt und Zeit

### genlock – Referenz / Genlock

**DE**
- **title:** Referenz / Genlock
- **oneLiner:** Status des Haustakts am Referenzeingang einer DeckLink-Karte, dazu Bildtakt-Lage und Timecode.
- **whatFor:** In Mehrkamera-Systemen müssen alle Kameras und Zuspieler auf denselben Takt gelockt sein, sonst springt das Bild beim Umschalten. Das Panel zeigt, ob die Referenz anliegt und gelockt ist.
- **howToRead:**
  - Lock-Status, erkanntes Format (Black Burst bei SD, Tri-Level bei HD), eingestellter Genlock-Offset, Eingangsstatus.
  - Lage des Bildtakts von DeckLink-/NDI-Quellen im SMPTE-ST-2059-1-Raster (Lage, Streuung, Drift in ppm).
  - Gut: „gelockt“, passendes Format, Drift nahe 0 ppm.
- **tryIt:** Tri-Level-Sync an den Referenzeingang der DeckLink legen. **Erfolg:** Referenz „gelockt“, Format „Tri-Level-Sync (HD-Format)“. Ohne Kabel: „nicht gelockt“.
- **pitfall:** Das DeckLink-SDK meldet den Zeitversatz zwischen Eingang und Referenz nicht; das Panel zeigt daher keine Timing-Messung wie ein Hardware-Scope. Mit Hardware noch ungeprüft.
- **sources:** SONY S. 32 (PDF 37, Genlock); README.de.md „Referenz / Genlock“.

**EN**
- **title:** Reference / genlock
- **oneLiner:** Status of house sync at a DeckLink reference input, plus frame timing and time code.
- **whatFor:** In multi-camera systems all cameras and playout must lock to the same reference, otherwise the picture jumps on a cut. The panel shows whether the reference is present and locked.
- **howToRead:**
  - Lock status, detected format (black burst for SD, tri-level for HD), set genlock offset, input status.
  - Frame timing of DeckLink/NDI sources on the SMPTE ST 2059-1 grid (position, spread, drift in ppm).
  - Good: "locked", matching format, drift near 0 ppm.
- **tryIt:** Feed tri-level sync into the DeckLink reference input. **Success:** reference "locked", format "tri-level sync (HD format)". Without cable: "not locked".
- **pitfall:** The DeckLink SDK does not report the input-to-reference timing offset; the panel therefore shows no timing measurement like a hardware scope. Not yet tested with hardware.
- **sources:** as above.

### clock – Uhr / Timecode / Clock / time code

**DE**
- **title:** Uhr / Timecode
- **oneLiner:** Tageszeit-Timecode, Quell-Timecode, LTC und PTP-Status.
- **whatFor:** Zeitbezug für Sendung und Aufzeichnung: Abgleich von Kamera-Timecode mit der Tageszeit, Lesen von LTC aus dem Ton, Prüfen eines PTP-Grandmasters (ST 2110/2059).
- **howToRead:**
  - Tageszeit nach ST 2059-1 (Systemzeit → TAI → Timecode); „Systemuhr – keine Referenz“, solange kein PTP korrigiert.
  - Quell-Timecode (Container-Start-Tag oder SEI über die Bridge, Videodateien im Browser ab 0) und Differenz zur Tageszeit in Frames.
  - PTP: Grandmaster, Domain, clockClass, Offset (Software-Schätzung).
  - Gut: Differenz 0 Frames, PTP empfangen.
- **tryIt:** Panel „Uhr / Timecode“ öffnen, ohne PTP im Netz. **Erfolg:** Der Tageszeit-Timecode läuft und ist als „Systemuhr – keine Referenz“ gekennzeichnet; bei laufender Bridge meldet die PTP-Zeile „kein PTP empfangen“.
- **pitfall:** Über 30 fps zählt der Timecode 0…49/59 wie Schnittprogramme; LTC kennt nach ST 12-1 nur Frame-Paare. Software-Zeitstempel sind für PTP nur eine Schätzung.
- **sources:** README.de.md „Uhr und Timecode“ (keine der Vorgabequellen behandelt Timecode).

**EN**
- **title:** Clock / time code
- **oneLiner:** Time-of-day time code, source time code, LTC and PTP status.
- **whatFor:** Time reference for broadcast and recording: compare camera time code with time of day, read LTC from audio, check a PTP grandmaster (ST 2110/2059).
- **howToRead:**
  - Time of day per ST 2059-1 (system time → TAI → time code); "System clock – not a reference" while no PTP corrects it.
  - Source time code (container start tag or SEI via the bridge, video files in the browser count from 0) and difference to time of day in frames.
  - PTP: grandmaster, domain, clockClass, offset (software estimate).
  - Good: difference 0 frames, PTP received.
- **tryIt:** Open the "Clock / time code" panel with no PTP on the network. **Success:** the time-of-day time code runs and is marked "System clock – not a reference"; with the bridge running, the PTP line reports "no PTP received".
- **pitfall:** Above 30 fps the time code counts 0…49/59 like editors; LTC per ST 12-1 only knows frame pairs. Software time stamps are only an estimate for PTP.
- **sources:** as above.

---

## Licht (Opple Light Master)

Gemeinsamer Hinweis: Der Opple misst einen Wert an einer Stelle, kein Bild. Die Werte rechnet lz-scopes aus den Rohkanälen des Filtersensors; für LED-Primärfarben und Displays nur Trendmesser. Mired = 10⁶ / K.

### light-cie – Licht: Farbort (CIE) / Light: chromaticity

**DE**
- **title:** Licht: Farbort (CIE)
- **oneLiner:** Gemessener Farbort der Lichtquelle im CIE 1976 u′v′ oder 1931 xy mit Planck-Kurve.
- **whatFor:** Zeigt, ob eine Leuchte auf der Planck-Kurve (Glühlicht/Tageslicht-Charakter) liegt oder einen Grün-/Magentastich hat. Grundlage, um Leuchten verschiedener Hersteller vor dem Kameraweißabgleich anzugleichen.
- **howToRead:**
  - Planck-Kurve mit Isothermen (CCT), Linien Duv ±0,01/±0,02.
  - Oberhalb der Kurve (Duv > 0) = grünlich, unterhalb (Duv < 0) = magenta.
  - Spur je Gerät (aktuell oder 20/60/300 Messungen), gespeicherte Messpunkte, Δu′v′ zum gewählten Ziel (Referenzpunkt, 3200/4300/5600/6500 K Planck, D65).
  - Gut: Punkt auf oder sehr nahe der Kurve, alle Leuchten nah beieinander.
- **tryIt:** Opple erst unter eine Halogen-/Kunstlichtleuchte, dann ins Tageslicht halten. **Erfolg:** Der Punkt wandert in Richtung der Planck-Kurve zu höherer CCT (von den niedrigen Isothermen um 3000 K zu denen um 5000–6500 K).
- **pitfall:** Zwei Lichter mit gleicher CCT können verschieden aussehen, wenn ihr Duv verschieden ist; immer beides prüfen.
- **sources:** SONY S. 4 (PDF 10, Farbtemperatur), S. 39 (PDF 44, Preset White); `docs/research/opple-light-master.md` (Duv nach Ohno).

**EN**
- **title:** Light: chromaticity
- **oneLiner:** Measured chromaticity of the light in CIE 1976 u′v′ or 1931 xy with the Planckian locus.
- **whatFor:** Shows whether a fixture sits on the Planckian locus (tungsten/daylight character) or has a green/magenta cast. Basis for matching fixtures from different makers before the camera white balance.
- **howToRead:**
  - Planckian locus with isotherms (CCT), lines Duv ±0.01/±0.02.
  - Above the locus (Duv > 0) = greenish, below (Duv < 0) = magenta.
  - Trace per device (current or 20/60/300 readings), stored points, Δu′v′ to the chosen target (reference point, 3200/4300/5600/6500 K Planck, D65).
  - Good: point on or very close to the locus, all fixtures close together.
- **tryIt:** Hold the Opple first under a halogen/tungsten-style fixture, then into daylight. **Success:** the point moves along the locus towards higher CCT (from the isotherms around 3000 K to those around 5000–6500 K).
- **pitfall:** Two lights with the same CCT can look different if their Duv differs; always check both.
- **sources:** as above.

### light-vector – Licht: Vectorscope / Light: vectorscope

**DE**
- **title:** Licht: Vectorscope
- **oneLiner:** Farbabweichung des Lichts von einem Zielweiß als Winkel und Abstand (CIELUV).
- **whatFor:** Lichtabgleich am Set: zeigt, in welche Richtung (wärmer, kälter, grün, magenta) und wie weit eine Leuchte vom Ziel abweicht, und schlägt ab 5 mired Abweichung eine CTO/CTB-Folie vor (Lee oder Rosco).
- **howToRead:**
  - Mitte = Zielweiß (3200/4300/5600/6500 K, D65 oder Referenzpunkt).
  - Winkel = Farbton h_uv, Abstand = Sättigung s_uv = 13·Δu′v′.
  - Richtungswörter wärmer/kälter entlang der Planck-Kurve, grün/magenta quer dazu.
  - Mired zum Ziel und Folienvorschlag (nicht bei Ziel D65).
  - Gut: Punkt in der Mitte; unter 5 mired Abweichung schlägt die App keine Folie mehr vor.
- **tryIt:** ⚙ Mitte (Ziel) „5600 K Planck“, Opple unter eine 3200-K-Leuchte. **Erfolg:** Punkt Richtung „wärmer“, „Mired zum Ziel“ etwa −134 (10⁶/5600 − 10⁶/3200) mit CTB-Vorschlag.
- **pitfall:** Folien korrigieren nur die Farbtemperatur in Mired, nicht ein lückenhaftes Spektrum; eine LED kann nach Folie „richtig“ messen und an der Kamera trotzdem falsch wirken.
- **sources:** `docs/research/opple-light-master.md` (h_uv, s_uv, Mired-Rechnung); SONY S. 4 (PDF 10).

**EN**
- **title:** Light: vectorscope
- **oneLiner:** Colour deviation of the light from a target white as angle and distance (CIELUV).
- **whatFor:** Matching light on set: shows in which direction (warmer, cooler, green, magenta) and how far a fixture is off target, and from 5 mired off suggests a CTO/CTB gel (Lee or Rosco).
- **howToRead:**
  - Centre = target white (3200/4300/5600/6500 K, D65 or reference point).
  - Angle = hue h_uv, distance = saturation s_uv = 13·Δu′v′.
  - Direction words warmer/cooler along the locus, green/magenta across it.
  - Mired to target and gel suggestion (not with target D65).
  - Good: point in the centre; below 5 mired the app no longer suggests a gel.
- **tryIt:** ⚙ centre (target) "5600 K Planck", Opple under a 3200 K fixture. **Success:** point towards "warmer", "mired to target" about −134 (10⁶/5600 − 10⁶/3200) with a CTB suggestion.
- **pitfall:** Gels correct only colour temperature in mired, not a gappy spectrum; an LED can measure "right" after gelling and still look wrong on camera.
- **sources:** as above.

### light-bands – Licht: Filterkanäle / Light: filter channels

**DE**
- **title:** Licht: Filterkanäle
- **oneLiner:** Kalibrierte Zählwerte der 6 bzw. 8 Farbfilter des Opple-Sensors, keine spektrale Leistung.
- **whatFor:** Grober Blick auf die spektrale Zusammensetzung: zeigt etwa, ob einer LED Rot- oder Cyan-Anteile fehlen. Ergänzt CCT und Duv, die allein nichts über Lücken sagen.
- **howToRead:**
  - Je Filterkanal ein Balken, relativ zum stärksten Kanal; wahlweise als Verhältnis zum Referenzpunkt (×1 = gleich).
  - Gut: zwei Lichter mit ähnlichem Balkenprofil verhalten sich an der Kamera ähnlicher.
- **tryIt:** Glühlicht messen, in der Seitenleiste als Messpunkt aufnehmen und als Referenz (A) markieren, dann eine weiße LED messen. **Erfolg:** Die Balkenprofile unterscheiden sich sichtbar; das Referenzprofil erscheint gestrichelt daneben.
- **pitfall:** Das ist kein Spektrum; 6–8 Stützstellen können schmale Spitzen oder Lücken nicht auflösen.
- **sources:** README.de.md „Lichtmesser“; `docs/research/opple-light-master.md`.

**EN**
- **title:** Light: filter channels
- **oneLiner:** Calibrated counts of the Opple sensor's 6 or 8 colour filters, not spectral power.
- **whatFor:** Rough look at spectral make-up: shows e.g. whether an LED lacks red or cyan. Complements CCT and Duv, which alone say nothing about gaps.
- **howToRead:**
  - One bar per filter channel, relative to the strongest channel; optionally as a ratio to the reference point (×1 = equal).
  - Good: two lights with similar bar profiles behave more alike on camera.
- **tryIt:** Measure tungsten, store it as a measuring point in the sidebar and mark it as reference (A), then measure a white LED. **Success:** the bar profiles differ visibly; the reference profile is shown dashed alongside.
- **pitfall:** This is not a spectrum; 6–8 sample points cannot resolve narrow peaks or gaps.
- **sources:** as above.

### light-trend – Licht: Zeitverlauf / Light: trend

**DE**
- **title:** Licht: Zeitverlauf
- **oneLiner:** Lux, CCT und Duv über 30 s, 2 min, 10 min oder 1 h, mit Mittel und Streuung.
- **whatFor:** Zeigt Drift und Schwankung: Aufwärmen von Leuchten, wechselndes Tageslicht, Dimmer-Effekte. Hilft zu entscheiden, wann Weißabgleich nachgeführt werden muss.
- **howToRead:**
  - Kurven für Lux, CCT, Duv (einzeln oder zusammen); je Größe Mittel und σ, bei Lux zusätzlich der Variationskoeffizient in %.
  - Gut: flache Kurven, kleine Streuung.
- **tryIt:** Opple 2 Minuten vor eine frisch eingeschaltete Leuchte legen. **Erfolg:** Aufwärm-Drift in CCT oder Lux ist als Kurve sichtbar, danach flach.
- **pitfall:** Flimmern wird hier nicht gemessen (Light Master 4/Flimmern ungeprüft); eine ruhige Kurve heißt nicht flimmerfrei.
- **sources:** README.de.md „Lichtmesser“; SONY S. 46 (PDF 51, Weißabgleich draußen oft nachführen).

**EN**
- **title:** Light: trend
- **oneLiner:** Lux, CCT and Duv over 30 s, 2 min, 10 min or 1 h, with mean and spread.
- **whatFor:** Shows drift and fluctuation: fixtures warming up, changing daylight, dimmer effects. Helps decide when white balance needs redoing.
- **howToRead:**
  - Curves for lux, CCT, Duv (single or together); mean and σ per quantity, for lux also the coefficient of variation in %.
  - Good: flat curves, small spread.
- **tryIt:** Put the Opple in front of a freshly switched-on fixture for 2 minutes. **Success:** warm-up drift in CCT or lux shows as a curve, then flattens.
- **pitfall:** Flicker is not measured here (Light Master 4/flicker untested); a calm curve does not mean flicker-free.
- **sources:** as above.

### light-map – Licht: Messfeld / Light: field map

**DE**
- **title:** Licht: Messfeld
- **oneLiner:** Punkte nacheinander in ein Raster aufnehmen: Gleichmäßigkeit von Helligkeit und Farbe.
- **whatFor:** Prüft, wie gleichmäßig eine Fläche ausgeleuchtet ist (Green Screen, Bühne, Ambi-Fläche für White Shading) und vergleicht zwei Lichter mit Mired und Grün/Magenta-Richtung.
- **howToRead:**
  - Raster mit Messpunkten als Karte: Beleuchtungsstärke in % vom hellsten Punkt, Δu′v′ zum Mittel (Skala 0 … 0,01) oder CCT zum Mittel (±500 K); Kopfzeile mit Gleichmäßigkeit min/max in % und max Δu′v′.
  - Rastergröße, Aufnahme und Vergleich zweier Lichter (Mired, Grün/Magenta mit Lee-Folienvorschlag) in der Seitenleiste → Lichtmesser.
  - Gut: Gleichmäßigkeit nahe 100 %, Δu′v′ klein.
- **tryIt:** Seitenleiste → Lichtmesser → Messfeld 3×3, die neun Punkte auf einer Wand nacheinander aufnehmen (blauer Rahmen = nächster Punkt). **Erfolg:** Kopfzeile „9/9 Punkte“ mit Gleichmäßigkeit und max Δu′v′.
- **pitfall:** Für White Shading muss die Fläche sehr gleichmäßig sein; TEK nennt ±0,5 % als typisch, 1 % und mehr als häufig – Abweichungen der Fläche landen sonst als „Shading-Fehler“ in der Kamera.
- **sources:** TEK PDF 3 (Leuchtdichte je Quadrant, ±0,5 %/1 %); TEK PDF 6 (ungleichmäßige Fläche verfälscht Shading).

**EN**
- **title:** Light: field map
- **oneLiner:** Capture points one after another into a grid: uniformity of brightness and colour.
- **whatFor:** Checks how evenly a surface is lit (green screen, stage, light box for white shading) and compares two lights with mired and green/magenta direction.
- **howToRead:**
  - Grid of points as a map: illuminance in % of the brightest point, Δu′v′ to the mean (scale 0 … 0.01) or CCT to the mean (±500 K); header with uniformity min/max in % and max Δu′v′.
  - Grid size, capture and comparison of two lights (mired, green/magenta with a Lee gel suggestion) in the sidebar → light meter.
  - Good: uniformity near 100 %, small Δu′v′.
- **tryIt:** Sidebar → light meter → grid 3×3, capture the nine points on a wall one after another (blue frame = next point). **Success:** header "9/9 points" with uniformity and max Δu′v′.
- **pitfall:** White shading needs a very even surface; TEK calls ±0.5 % typical and 1 % or more common – unevenness otherwise ends up as a "shading error" in the camera.
- **sources:** as above.

### light-spectrum – Licht: Wellenlängen / Light: wavelengths

**DE**
- **title:** Licht: Wellenlängen
- **oneLiner:** Beim Opple die Filterkanäle über der Wellenlänge, bei Spektrometern das echte Spektrum.
- **whatFor:** Mit einem Spektrometer (über ArgyllCMS) lässt sich die spektrale Qualität einer Leuchte beurteilen, die über Hautwiedergabe und Kamera-Matching entscheidet; dazu CRI/TLCI/TM-30, wie ArgyllCMS sie berechnet.
- **howToRead:**
  - Waagerecht: Wellenlänge 380–780 nm, senkrecht: relativer Wert (Spitze = 100 %).
  - Gut: möglichst lückenlose, gleichmäßige Kurve; tiefe Täler deuten auf schlechte Farbwiedergabe.
- **tryIt:** Seitenleiste → Lichtmesser → Weitere Messgeräte → „Spektrum-Datei öffnen …“ (Argyll .sp oder CSV mit Wellenlänge, Wert). **Erfolg:** Kurve erscheint über der Wellenlängenachse, Kopfzeile mit Bereich und Spitze in nm.
- **pitfall:** Mit dem Opple ist das kein Spektrum, nur Filterstützstellen; CRI/TLCI daraus nicht ableiten.
- **sources:** SONY S. 7 (PDF 13, sichtbares Spektrum ~380–760 nm); BBC57 PDF 8 (Neutralität 400–700 nm); README.de.md „Weitere Messgeräte“; EBU Tech 3355 (TLCI, laut `ebu-video.md`).

**EN**
- **title:** Light: wavelengths
- **oneLiner:** For the Opple the filter channels over wavelength, for spectrometers the real spectrum.
- **whatFor:** With a spectrometer (via ArgyllCMS) the spectral quality of a fixture can be judged, which decides skin rendering and camera matching; plus CRI/TLCI/TM-30 as ArgyllCMS computes them.
- **howToRead:**
  - Horizontal: wavelength 380–780 nm, vertical: relative value (peak = 100 %).
  - Good: a continuous, even curve; deep dips indicate poor colour rendering.
- **tryIt:** Sidebar → light meter → more meters → "Open spectrum file …" (Argyll .sp or CSV with wavelength, value). **Success:** a curve appears over the wavelength axis, header with range and peak in nm.
- **pitfall:** With the Opple this is not a spectrum, only filter sample points; do not derive CRI/TLCI from it.
- **sources:** as above.

### light-swatch – Licht: Farbfläche / Light: swatch

**DE**
- **title:** Licht: Farbfläche
- **oneLiner:** Zeigt den gemessenen Farbort des Lichts als Farbfläche auf dem Display.
- **whatFor:** Macht eine Messung anschaulich: Team und Kunde sehen, wie warm, kalt oder grünlich ein Licht ist, neben dem Planck-Ort gleicher CCT als Vergleich.
- **howToRead:**
  - Fläche „gemessen (mit Duv)“ in Display-Farben (sRGB oder P3, Helligkeit normiert), daneben „Planck, gleiche CCT“ → der Unterschied ist der Duv-Anteil.
  - Schraffur = außerhalb des Display-Gamuts, gezeigt wird die abgeschnittene Farbe.
  - Gut: Fläche und Planck-Vergleich sehen gleich aus (Duv ≈ 0).
- **tryIt:** Licht mit sichtbarem Grünstich messen. **Erfolg:** Fläche wirkt grünlicher als die Planck-Vergleichsfläche daneben.
- **pitfall:** Die Darstellung hängt vom Display und dessen Kalibrierung ab; sie ist eine Veranschaulichung, keine Messung.
- **sources:** `docs/research/opple-light-master.md` (xy → Display-RGB, Schraffur).

**EN**
- **title:** Light: swatch
- **oneLiner:** Shows the measured chromaticity of the light as a colour patch on screen.
- **whatFor:** Makes a reading tangible: crew and client see how warm, cool or greenish a light is, next to the Planckian point of the same CCT for comparison.
- **howToRead:**
  - Patch "measured (with Duv)" in display colours (sRGB or P3, brightness normalised), next to it "Planck, same CCT" → the difference is the Duv part.
  - Hatching = outside the display gamut, the clipped colour is shown.
  - Good: patch and Planckian reference look the same (Duv ≈ 0).
- **tryIt:** Measure a light with a visible green cast. **Success:** the patch looks greener than the Planckian reference next to it.
- **pitfall:** The rendering depends on the display and its calibration; it illustrates, it does not measure.
- **sources:** as above.

---

## Grundbegriffe / Basic terms

**Shading (Kamera-Shading / Racking)**
- DE: Laufende Bildkontrolle der Kameras über die RCP: Blende, Schwarz, Weiß- und Farbbalance so führen, dass alle Kameras gleich aussehen. Im engeren Sinn: White/Black Shading = Ausgleich ungleichmäßiger Helligkeit oder Farbe über die Bildfläche (Objektiv, Prisma, Sensor) mit Saw- und Par-Korrekturen.
- EN: Ongoing picture control of cameras via the RCP: iris, black, white and colour balance kept so all cameras match. In the narrow sense: white/black shading = correcting uneven brightness or colour across the frame (lens, prism, sensor) with saw and par corrections.
- Quellen: TEK PDF 2–5; SONY S. 10 (PDF 16), S. 26 (PDF 31); RD-1; RD-2 (Rollen: Shader/V1 vs. EIC je nach Markt verschieden; einfache RCPs regeln nur R und B); RD-6 (Objektive unterscheiden sich in Absorption und Flare); PL-Q3.

**Black / Pedestal (Master Black)**
- DE: Der absolute Schwarzpegel der Kamera, Bezug für alle anderen Pegel. Zu tief = Bild wirkt schwer und schwarz-verschluckt, zu hoch = flau und neblig. Black Balance gleicht R, G, B bei geschlossener Blende ab.
- EN: The camera's absolute black level, the reference for all other levels. Too low = heavy, crushed picture; too high = flat and foggy. Black balance equalises R, G, B with the iris closed.
- Ergänzung DE: Black Balance nur mit verschlossenem Objektiv bzw. geschlossener Iris; stimmen die Tiefen danach mit offener Blende nicht, ist das Flare-Kompensation, eine eigene Einstellung (RD-3). EN: Black balance only with the lens capped or iris closed; if lowlights differ once the iris is open, that is flare compensation, a separate control (RD-3).
- Quellen: SONY S. 25 (PDF 30), S. 38–39 (PDF 43–44); BBC57 PDF 8–9 (Super-Black für Flare-Korrektur, Schwarz setzen); RD-3; RD-6.

**Gain**
- DE: Elektronische Verstärkung in dB bei zu wenig Licht; +6 dB verdoppelt die Signalamplitude, erhöht aber das Rauschen gleich mit. Beim Shading-Aufbau auf 0 dB stellen. Getrennt davon: R/B-Gain = Weißabgleich je Kanal.
- EN: Electronic amplification in dB for low light; +6 dB doubles signal amplitude but raises noise as well. Set to 0 dB for shading set-up. Separately: R/B gain = per-channel white balance.
- Quellen: SONY S. 31 (PDF 36), S. 56 (PDF 61, dB = 20·log); TEK PDF 3.

**Knee**
- DE: Kompression der Lichter ab einem Kniepunkt (z. B. um 100 %), damit helle Bereiche nicht sofort clippen; darüber begrenzt der White Clip. Für Shading-Messungen Knee ausschalten, sonst verfälscht er die Graustufen.
- EN: Compression of highlights above a knee point (e.g. around 100 %) so bright areas do not clip immediately; above that the white clip limits. Switch knee off for shading measurements, otherwise it distorts the grey scale.
- Quellen: SONY S. 34 (PDF 39), S. 30 (PDF 35, DCC), S. 47 (PDF 52, White Clip); TEK PDF 3.

**Matrix**
- DE: Zwei verschiedene Dinge: (1) die **Linear-/Multi-Matrix** der Kamera mischt die Sensor-Kanäle linear (vor dem Gamma), um Farben zu korrigieren oder Kameras anzugleichen; (2) die **Codiermatrix** (BT.709/BT.2020) rechnet R′G′B′ in Y′CbCr um. Beides nicht verwechseln.
- EN: Two different things: (1) the camera's **linear/multi matrix** mixes sensor channels linearly (before gamma) to correct colours or match cameras; (2) the **encoding matrix** (BT.709/BT.2020) converts R′G′B′ to Y′CbCr. Do not confuse them.
- Quellen: SONY S. 36 (PDF 41), S. 38 (PDF 43), S. 56 (PDF 61); TEK PDF 9–10; RD-4 (vermengt beides, siehe Widersprüche).

**TV-Weiß / Weißabgleich (White balance)**
- DE: Weißabgleich stellt die Kanalverstärkungen so ein, dass ein weißes/graues Objekt R:G:B = 1:1:1 ergibt; danach stimmen auch die übrigen Farben. Monitore und Normen beziehen Weiß auf D65 (≈ 6500 K, x 0,3127/y 0,3290); die Szene darf anders beleuchtet sein, die Kamera passt sich an.
- EN: White balance sets the channel gains so a white/grey object gives R:G:B = 1:1:1; the other colours then follow. Monitors and standards reference white to D65 (≈ 6500 K, x 0.3127/y 0.3290); the scene may be lit differently, the camera adapts.
- Ergänzung DE: „TV-Weiß“ auf dem Chart ist keine perfekte Reflexion: Die BBC legte 1970 die Weißstufe auf 60 % Reflexion, weil Studios das hellste Motiv auf etwa 60 % eines idealen Weiß begrenzten; neuere 11-Stufen-Charts haben ≈ 90 %. Der Chart dient zum Kanalabgleich, Knee und Gamma; die Belichtung für Personen wird danach am Bild gesetzt (RD-5). EN: Chart "TV white" is not a perfect reflector: in 1970 the BBC set the white step at 60 % reflectance because studios limited the brightest subject to about 60 % of ideal white; newer 11-step charts are ≈ 90 %. The chart is for channel balance, knee and gamma; exposure for people is set on the picture afterwards (RD-5).
- Quellen: SONY S. 46 (PDF 51), S. 4 (PDF 10); BBC57 PDF 7 (D6500 als Weißpunkt), PDF 8 (60 % Weißstufe, Begründung), PDF 10 (Tab. 1); TEK PDF 8; BT.709; RD-1 („Monitore auf 6500 K“); RD-5.

**IRE vs. %**
- DE: IRE stammt aus dem analogen NTSC: 100 IRE = 714 mV Weiß über Austastwert, in Nordamerika Schwarz mit Setup bei 7,5 IRE. Digital und in HD gilt 0–100 % = 0–700 mV = Code 64–940 (10 bit); „IRE“ wird heute oft locker für % benutzt, ist aber nur ohne Setup gleichwertig.
- EN: IRE comes from analogue NTSC: 100 IRE = 714 mV white above blanking, North American black with 7.5 IRE set-up. In digital/HD, 0–100 % = 0–700 mV = code 64–940 (10 bit); "IRE" is loosely used for % today but is only equivalent without set-up.
- Quellen: TEK PDF 9 (7,5 IRE Setup, Japan ohne), PDF 15 (100 % = 700 mV); SONY S. 47 (PDF 52); BT.709/BT.2100 (Quantisierung). [714 mV = 1 V × 100/140: Standardwert, in den Vorgabequellen nicht genannt.]

**Legal / Full Range**
- DE: Legal (Narrow, „Video“) Range: 8 bit Y′ 16–235, Cb/Cr 16–240; 10 bit 64–940 bzw. 64–960. Darunter und darüber bleibt Reserve für Unter- und Überschwinger (bis Code 4–1019, 0–3 und 1020–1023 sind bei SDI reserviert). Full Range nutzt 0–255 bzw. 0–1023 (Computer-Grafik). EBU R 103 empfiehlt −5 … 105 % für R′, G′, B′ und Y′, Meldung erst ab 1 % der Fläche.
- EN: Legal (narrow, "video") range: 8-bit Y′ 16–235, Cb/Cr 16–240; 10-bit 64–940 and 64–960. Below and above there is headroom for under- and overshoots (up to codes 4–1019; 0–3 and 1020–1023 are reserved on SDI). Full range uses 0–255 or 0–1023 (computer graphics). EBU R 103 recommends −5 … 105 % for R′, G′, B′ and Y′, reported only above 1 % of the area.
- Quellen: R103 Tab. 1 p5, p7; BT.709; BT.2100 Tab. 9.

---

## Widersprüche und Abweichungen zwischen Quellen

1. **Zebra/„legal“ 100 IRE** (SONY S. 47) vs. **EBU R 103 v3.0**: Sony nennt 100 IRE als „upper limit of legal video“ (NTSC-Kontext). Primärnorm R 103 erlaubt R′G′B′ und Y′ bis 105 % (Vorzug) mit 1-%-Flächenregel, hart bis Code 1019. → R 103 gilt; Texte nutzen −5/105 %.
2. **Black Clip 0 %** (SONY S. 25) vs. R 103 −5 %: Kamera-Clip ist eine Geräteeinstellung; das Signal darf laut R 103 bis −5 % gehen. Kein echter Normkonflikt, aber „unter 0 % = illegal“ ist falsch.
3. **75-%-Balken mit 100-%-Weiß** (SONY S. 27): gilt für EBU 100/0/75/0. Das SMPTE-75-%-Testbild in lz-scopes hat oben links **75 % Grau**, das 100-%-Weiß steht unten (BT.471-Nomenklatur). Texte entsprechend formuliert.
4. **Gamma 2,2 / 0,45** (SONY S. 32) vs. **BT.1886** (Referenz-EOTF γ = 2,4) und BT.709-OETF (0,45 mit linearem Anfangsstück 4,5): Sony beschreibt die CRT-Näherung; Primärnormen gewinnen.
5. **„BT.601 für SD (größer als 709!)“** (RD-4): falsch. BT.601-625 hat praktisch dieselben Primärvalenzen wie BT.709 (nur Grün x 0,29 statt 0,30); der Unterschied liegt in der Y′CbCr-Matrix. RD-4 vermengt außerdem Kamera-Linearmatrix und Codiermatrix.
6. **Hautton-Linie 123°**: in keiner geöffneten Primärquelle belegt (auch `docs/research/ebu-video.md` Punkt 5); als Praxiswert [unsicher] markiert. Hautpegel „~80 IRE“ (SONY S. 47) bzw. „70 IRE“ (RD-1 über ein Video) sind NTSC-Praxis; genormte Hautpegel gibt es nur für HDR (BT.2408 Tab. 2).
7. **Graukeil-Weiß**: BBC57 (60 % Reflexion als Weißstufe, 9 Stufen, Super-Black 0,6 %) und TEK PDF 8 (9-Stufen-Chart 60 %, 11-Stufen-Chart 90 %) stimmen überein. RD-5 nennt 89,9 % für 11-Stufen-Charts und behauptet, Herstellerangaben zur Empfindlichkeit bezögen sich auf 89,9 % bei 2000 lux [unsicher, nicht geprüft]. RD-1 („weiße Chips auf 100 IRE, Chip 6 bei 50–55 IRE“) ist chartabhängig und nicht prüfbar. RD-5 berichtet, dass 90-%-Weiß auf 100 % gelegt Gesichter „matschig“ macht – folgerichtig, weil Haut dann um den Faktor 1,5 (gut eine halbe Blende) tiefer liegt als mit 60-%-Weiß; Ursache ist die Belichtungsregel, nicht ein Normkonflikt.
8. **Near-Black +4 %**: BT.2111-3 Code 99 (= exakt 4 %), EBU Tech 3373 Code 96 (laut `ebu-video.md`). lz-scopes folgt BT.2111.
9. **Diamond-Tiefpass**: Tektronix filtert kurze Überschwinger heraus (TEK PDF 17), lz-scopes nicht (README). Ergebnis kann strenger aussehen als ein Hardware-Scope.
10. **White Shading-Ursache**: SONY S. 10 betont Grün/Magenta oben/unten durch das dichroitische Prisma, TEK PDF 2 einen helleren Bildmittelpunkt durch das Objektiv. Kein Widerspruch – zwei Erscheinungsformen; Texte nennen beide.
11. **Waveform vs. Monitor** (RD-1): ein Nutzer lehnt das Einstellen von Iris/Pedestal nach Waveform ohne Chart ab; YT-1 und TEK zeigen es mit Scopes. RD-2 sagt das Gegenteil („Monitore lügen, Scopes nicht“). Meinungs-, kein Normkonflikt; im Pitfall von wf-luma aufgegriffen.
12. **Registrierung** (RD-3): ein Nutzer spricht von driftender Registrierung; andere halten dagegen, dass Registrierung bei Halbleitersensoren nicht driftet (nur Röhrenkameras). Für lz-scopes nicht relevant.
13. **„Belichtung in der Post“** (RD-5, ein Nutzer): für Live-Mehrkamera abgelehnt (gleicher Thread). Texte gehen von Live-Abgleich aus.

## Nicht erreichbar / nicht ausgewertet

- Reddit: WebFetch gesperrt; alle sechs Threads per RSS gelesen (Kommentare ggf. nicht vollständig, RSS liefert nur die ersten ~25 Einträge).
- YouTube-Transkripte (yxceiOl5VJ4, dnT-zRhWVK4, Playlist): nicht abrufbar (Untertitel-API leer, yt-dlp „page needs to be reloaded“). Nur Titel/Beschreibung/Kapitel.
- Playlist von Lars `PL8rGYj3gFXdXAH92O6ja4xPp04YaUqnBK`: „The playlist does not exist“ (privat oder gelöscht); Einzelvideo tqjocBWkphU („Project 3 2“, Wayne Murray) ohne Beschreibung.
- SMPTE RP 219 / ST 2084 / EG 1: kostenpflichtig, nicht geprüft; 75-%-Luma-Werte sind aus BT.709 berechnet.
