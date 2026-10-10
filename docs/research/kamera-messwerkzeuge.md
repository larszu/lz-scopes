# Messwerkzeuge für den Kameraabgleich

Stand 10.10.2026. Herleitung der Werkzeuge aus [scope-wuensche.md](scope-wuensche.md) (Wünsche 3–7, Idee 2), soweit umgesetzt. Was eine Norm vorgibt, steht mit Quelle da; was eine eigene Festlegung von lz-scopes ist, ist als solche markiert. Geprüft ist alles nur mit synthetischen Bildern in vitest und mit Testbildern im e2e-Test, nicht mit echten Kameras.

## Blendenskala (STOP) – Wunsch 3

Umgesetzt als Skala *STOP* (Einstellungen → Scopes → Skala bzw. Kopfleiste), `src/stops.ts`, Tests `test/stops.test.ts`.

- **Vorbild**: Telestream PRISM „STOP“ ([Blog](https://blog.telestream.com/master-hdr-video-production-with-stop-monitoring/), gelesen): „+1 stop means the light is twice as bright“; Zweck: „compare cameras with different gamma settings on the same scale“. Der PRISM-Datenblatt-Text spricht von einer „normalized ‚linear to light‘ logarithm vertical scale“. Wie PRISM den Nullpunkt je Kurve legt, steht in den gelesenen Quellen nicht; das Handbuch war nicht frei abrufbar.
- **Festlegung lz-scopes**: Blende 0 = Graukarte, +1 = doppeltes lineares Licht. Lineares Licht und Graukarte je Kurve:

| Kurve | lineares Licht | Graukarte (Blende 0) | Quelle |
|---|---|---|---|
| Kamera-Log (S-Log3, LogC3 …) | Szene-linear aus der Herstellerkurve | 0,18 | Herstellerkurven in `src/camera.ts`; S-Log3 0,18 → Code 420/1023 |
| HLG | Szenelicht E über die inverse OETF (BT.2100) | Signal 38 % | BT.2408 Tab. 1 (18-%-Graukarte bei 38 % HLG) |
| PQ | Displaylicht in cd/m² (ST 2084) | Signal 38 % ≈ 26 cd/m² | BT.2408 Tab. 1 |
| SDR BT.1886 | Szenelicht über die inverse BT.709-OETF (Kamerabelichtung) | 0,18 → 40,9 % | BT.709 OETF |
| γ 2,2 / 2,6 / 2,8, sRGB, linear | Displaylicht der Kurve | 0,18 linear | eigene Festlegung |

- Für SDR ist die inverse OETF eine Annahme: Knie, Black Gamma und Kameramatrix verbiegen die echte Kurve, die Skala gilt dann nur im linearen Teil. Bei PQ sind es Display-Blenden (die Szenebelichtung ist nach der OOTF nicht mehr eindeutig).
- Skala: ganze Blenden, beim Zoomen Drittelblenden; der Messpunkt zeigt zusätzlich „≈ … Blenden zur Graukarte“.

## Fokushilfe – Wunsch 4

Umgesetzt als Bild-Overlay *Fokus-Peaking* mit Schärfewert, `src/focus.ts`, Shader-Modus `peaking` in `src/renderer.ts`, Tests `test/focus.test.ts`.

- **Vorbild**: Leader LV5600 *Focus Assist* und Nobe Live Pack (scope-wuensche.md); deren Verfahren sind nicht veröffentlicht. Es gibt keine Norm für einen Schärfewert im Live-Bild.
- **Festlegung lz-scopes**: Kanten = Sobel-Gradient von Y′ in Quellauflösung, so skaliert, dass ein harter Sprung Schwarz→Weiß 1,0 ergibt; Peaking färbt alles über der Schwelle (Standard 0,12) ein. Schärfewert = Effektivwert dieses Gradienten im Messrahmen × 100 („Tenengrad“-Maß), ohne Messrahmen im mittleren Drittel; dazu ein Spitzenwert-Halter, der bei neuem Rahmen neu beginnt.
- Der Wert hängt vom Motiv, vom Kontrast und vom Rauschen ab. Er taugt zum Scharfstellen auf das Maximum bei gleichem Ausschnitt, nicht zum Vergleich verschiedener Motive oder Kameras. Gemessen wird ohne Skalierung (große Rahmen werden auf die Mitte beschnitten), denn Skalieren glättet genau die Kanten.
- Browser-Quellen werden für die CPU-Messung auf höchstens 960 px Breite gelesen; dort ist der Wert gröber als bei Bridge-Quellen in nativer Breite. Geprüft nur mit synthetischen Bildern (unscharf gerechnetes Schachbrett: Wert fällt mit wachsendem σ) und dem Testbild *Schachbrett* im e2e-Test.

## Rauschmessung – Wunsch 5

Umgesetzt als Panel *Rauschmessung*, `src/noise.ts` und `src/surface.ts`, Tests `test/noise.test.ts`.

- **Vorbild**: Leader LV5490SER10 ([Produktblatt](https://www.leader.co.jp/uploads/2018/03/ca_lv5490ser10_e.pdf), gelesen): „Signals to be measured: Select one of Y / G / B / R“, Messfenster frei setzbar, „Noise level indication: mVrms Display or dB display“; Messfenster „as flat as possible“, weil Objektiv-Shading sonst mitzählt; Tiefpass (HD 30 … 3,7 MHz) und Hochpass (HD 200 kHz, je −12 dB). Die Formel für dB nennt das Blatt nicht.
- **Festlegung lz-scopes**: σ = Effektivwert der Abweichung der Abtastwerte im Messrahmen (ohne Rahmen im mittleren Drittel) vom Mittelwert, je Y′, R′, G′, B′; mVrms = σ · 700 mV (100 % = 700 mV), dB = 20 · log10(σ / 100 %), S/N = −dB. Statt des Hochpasses wird wahlweise (Standard an) eine quadratische Fläche (Sägezahn + Parabel H/V + Diagonale) per kleinster Quadrate abgezogen; so zählen Shading und langsame Verläufe nicht. Einen Tiefpass gibt es nicht: lz-scopes misst die volle Bandbreite des Analysebilds.
- **Grenzen**: Die Quantisierung setzt eine Untergrenze (Effektivwert Stufe/√12): 8 bit R′G′B′ ≈ −58,9 dB, 10 bit narrow ≈ −69,6 dB; das Panel nennt die Grenze des jeweiligen Signalwegs. Ein verkleinertes Analysebild (Bridge-Breite unter nativ, Browserquellen ≤ 960 px) mittelt Rauschen weg; das Panel weist darauf hin. Geprüft nur synthetisch (Gauß-Rauschen σ = 1 % → −40 dB, mit überlagertem Shading) und mit Testbildern; mit echten Kameras ungeprüft.

## White-Shading-Karte – Wunsch 7

Umgesetzt als Panel *White-Shading-Karte*, `src/whiteShading.ts` (Flächenanpassung aus `src/surface.ts`), Tests `test/whiteShading.test.ts`.

- **Quelle**: Tektronix-App-Note 25W-27159, S. 2–5 (gelesen): White Shading gleicht Helligkeits- und Farbfehler der Optik aus („the center of the image appears brighter than the edges“); Ablauf mit gleichmäßiger Lichtquelle, Gain 0 dB, Knie und Gamma-Regler aus, Blende f4–f5,6, Objektiv leicht unscharf; je Kanal in der Reihenfolge Grün, Rot, Blau „adjust the H and V Saw so that the trace is as flat as possible. Then make adjustments of the H and V Par“; Ziel ist eine flache Spur in der RGB-Parade und ein Punkt in der Bildmitte des Vectorscopes bei 20-facher Verstärkung. Ross-Hilfe ([Acid Cam, Lens White](https://help.rossvideo.com/acid/Tasks/Acid-Cam/Lens/Lens-White.html), gelesen): „measured both horizontally and vertically“, je Kanal R/G/B. Die Sägezahn-/Parabel-Zerlegung des [TV-Technology-Artikels](https://tvtechnology.com/miscellaneous/white-shading) ist nicht gegengelesen.
- **Festlegung lz-scopes**: Je Kanal Y′, R′, G′, B′ wird per kleinster Quadrate die Fläche c0 + c1·x + c2·y + c3·x² + c4·y² + c5·x·y angepasst (x, y = −1 … +1). Angezeigt in % des Kanalmittels: Saw H = rechter − linker Rand = 2·c1, Saw V = unten − oben = 2·c2, Par H/V = Rand − Mitte = c3 bzw. c4, Spanne = Max − Min der Fläche. Wie die Regler einer bestimmten Kamera skaliert sind und welches Vorzeichen sie haben, ist herstellerabhängig und nicht abgebildet; die Werte sagen Richtung und Größe des Fehlers.
- Karte: 16 × 9 Zellen, Abweichung vom Mittel (warm = heller, blau = dunkler, Vollausschlag ± 2/5/10/20 %) oder Farbstich R′−G′ / B′−G′ gegen den Weißpunkt der Fläche selbst, damit ein Weißabgleichsfehler nicht als Shading erscheint. Ganze Bildfläche, wahlweise nur Messrahmen; ein verkleinertes Analysebild stört hier nicht (nur langsame Verläufe).
- Geprüft nur synthetisch (bekannte Saw/Par je Kanal werden auf 0,1 % genau zurückgerechnet) und mit dem Testbild *Grauverlauf*; mit echter Kamera und Diffusor ungeprüft.

## Hautton über alle Kameras – Idee 2

Umgesetzt als Panel *Hautton aller Kameras*, `src/skinTone.ts`, Tests `test/skinTone.test.ts`; zugleich der Hautton-Teil von Schritt 3 in [kamera-abgleich.md](kamera-abgleich.md).

- **Grundlage**: dieselbe Hautton-Auswahl wie *Waveform Hauttöne* und der Bild-Overlay (Luma-Fenster, Farbton-Toleranz um die Hauttonlinie 123°, Chroma > 0,012); Gesichter aus der vorhandenen Gesichtserkennung (`src/face.ts`, MediaPipe BlazeFace), sonst Messrahmen oder ganzes Bild. Keine Norm für „gleicher Hautton“; Nobe zeigt Hautverteilungen nur je Quelle (scope-wuensche.md, nicht nachgeprüft).
- **Festlegung lz-scopes**: Je Quelle (bis 8) die Hautpixel als Cb/Cr-Punkte in einer Farbe, die Mitte der Wolke als Kreuz; Farbton H = atan2(Cr, Cb) der Mitte mit Abstand zur Hauttonlinie, Sättigung S = |CbCr| / 0,5, ΔH/ΔS gegen die Referenzkamera (Schritt 1) bzw. die erste Quelle mit Haut. ⚙ schaltet die Gesichtserkennung in allen Quellen des Panels ein.
- Geprüft nur synthetisch (Gesichtsfeld mit bekanntem Farbton; eine um +6° verschobene Kamera ergibt ΔH ≈ +6°; Hemd, Wand und Schatten außerhalb des Fensters zählen nicht) und mit dem Testbild *ColorChecker (Näherung)*. Die Gesichtserkennung mit echten Kameras und unterschiedlichem Licht je Gesichtsseite ist ungeprüft.
