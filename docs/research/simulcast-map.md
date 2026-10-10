# Simulcast-Abweichungskarte

Stand 10.10.2026. Idee 7 aus [scope-wuensche.md](scope-wuensche.md). Code: `src/simulcast.ts` (Rechnung, ohne DOM), `src/simulcastPanel.ts` (Panel *Simulcast-Abweichung*), Tests `test/simulcast.test.ts`, `e2e/simulcast.spec.ts`.

## Quellen

| Kürzel | Quelle | Was daraus übernommen ist |
|---|---|---|
| BT.2124 | ITU-R BT.2124-0 (01/2019), „Objective metric for the assessment of the potential visibility of colour differences in television“ ([PDF](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.2124-0-201901-I!!PDF-E.pdf)), Anhang 1 (normativ) S. 2–3, Anhang 3 S. 5, Anhang 4 S. 6–7 | Rechenweg Displaylicht-RGB (BT.2020) → LMS → PQ → ICtCp → I, T = 0,5·Ct, P → ΔE ITP = 720·√(ΔI² + ΔT² + ΔP²); „a value of 1 is equivalent to a just noticeable difference when viewed in the most critical adaptation state“, darum „may over-predict“; Anhang 3: szenenbezogene Signale nur mit angenommener Spitzenleuchtdichte, sonst nur Rangfolge; Anhang 4 § 3: Bewertung von Signalverarbeitung, „ΔEITP > 1 indicates the colour error may be perceptible“, negative RGB vor ITP auf null begrenzen; Anhang 4 § 2: „a tolerance below 3 may be an acceptable level of accuracy for a reference display“ |
| BT.2408 | ITU-R BT.2408-8, Tab. 1 (über `lut-cst.md`, `ebu-video.md`) | SDR 100 % ≙ HDR-Referenzweiß 203 cd/m² – der Maßstab, mit dem das SDR-Bild in den HDR-Container zurückgesetzt wird |
| PVC | [ProVideo Coalition: FA Cup Final broadcast – most of the audience watched it in HD SDR](https://www.provideocoalition.com/fa-cup-final-broadcast-most-of-the-audience-watched-it-in-hd-sdr/) (gelesen 10.10.2026) | Anlass: „single HDR workflow“, SDR aus der HDR-Quelle per Wandlung („conversion to SDR for shading“, AJA FS-HDR), „most viewers watch TV on HD SDR“. Der Artikel beschreibt keinen Vergleich zwischen HDR und SDR. |

## Rechnung

1. Für jede Zelle eines Rasters von etwa 160 × 90 (Seitenverhältnis wie die Quelle) das Pixel der Zellmitte aus dem CPU-Bild der Quelle.
2. Beide Stufen der Kette (`compileChain`, wie die Messpunkte Signal / nach CST / nach LUT) auf dieses Pixel anwenden.
3. Jede Stufe als Displaylicht lesen: `signalToLinear` mit Transfer, Gamut und HLG-Lw der Stufe (1,0 = Referenzweiß; SDR nach BT.1886), nach BT.2020, negative Anteile auf 0 (BT.2124 Anh. 4 § 3), × 203 cd/m² (BT.2408). Damit steht das SDR-Bild „zurückgewandelt“ im HDR-Container.
4. ICtCp nach BT.2100 Tab. 7 (`rgb2020ToIctcp`), ΔE ITP nach BT.2124 Anh. 1 (`deltaEITP`, 0,25·ΔCt² = ΔT²).
5. Kennzahlen: Mittel, 95. Perzentil (lineare Interpolation wie in `calib/colorimetry.ts`), Maximum, Anteil über 1 und über einer wählbaren Grenze (Standard 3, Bezug BT.2124 Anh. 4 § 2 – dort für Referenzmonitore, hier nur als Orientierung).
6. Darstellung: graues Bild der Referenzstufe, darüber Farbe ab ΔE ITP > 1 (blau → gelb → rot bis zur Skala, logarithmisch), darüber weiß. Höchstens etwa sechs Neuberechnungen pro Sekunde.

Log-Stufen sind Szenenlicht; sie werden ebenfalls mit 1,0 → 203 cd/m² gelesen und als „nur Rangfolge“ gekennzeichnet (BT.2124 Anh. 3).

## Prüfstand

- BT.2124 Anh. 4: 58-%-PQ-Blau [296, 201, 582] → ITP [0,3554; 0,1346; −0,1613] auf drei Stellen; Beispiel-ΔE ITP 2,363 aus den Anhangswerten.
- SDR-Weiß 100 % und PQ 58 % (≈ 203 cd/m²) liefern ΔE ITP < 1.
- Synthetischer PQ-Verlauf 0–1000 cd/m², CST nach Rec.709 mit „Clip an der Zielspitze“: unter 203 cd/m² < 1, am oberen Ende > 20, gleiche Stufe beidseits = 0.
- e2e: Testbild „PQ-Verlauf mit Referenzweiß 203“, CST nach Rec.709 mit Clip – links grau, Lichter rechts weiß.
- **Nicht geprüft:** gegen einen echten Simulcast-Wandler (AJA FS-HDR o. Ä.) oder gegen LUTs eines Senders; ob der Abstand im Bild den Eindruck am SDR-Fernseher trifft (BT.2124 kann überschätzen).
