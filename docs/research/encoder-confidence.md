# Encoder-Konfidenz für Streams

Stand 10.10.2026. Idee 8 aus [scope-wuensche.md](scope-wuensche.md). Code: `src/encoder.ts` (Rechnung, ohne DOM), `src/encoderPanel.ts` (Panel *Encoder-Konfidenz*), Tests `test/encoder.test.ts`, `e2e/encoder.spec.ts`.

## Quellen

| Kürzel | Quelle | Was daraus übernommen ist |
|---|---|---|
| WSB | Z. Wang, H. R. Sheikh, A. C. Bovik: „No-reference perceptual quality assessment of JPEG compressed images“, ICIP 2002, S. 477–480 ([PDF](https://ece.uwaterloo.ca/~z70wang/publications/icip02.pdf)), Gl. 2, 3, 6 | Blockbildung B_h = mittlerer Betrag der Differenz über die 8er-Blockgrenzen, Aktivität A_h = mittlerer Betrag innerhalb der Blöcke (Gl. 3: (8·Mittel aller − B_h)/7), ebenso vertikal, B und A als Mittel beider Richtungen (Gl. 6). Die Autoren nennen die Methode auch für H.26x/MPEG-Video anwendbar. Übernommen sind nur B und A, als Verhältnis B/A; die an MOS angepasste Formel mit α, β, γ ist für JPEG gefittet und nicht übernommen. |
| CAMBI | P. Tandon, M. Afonso, J. Sole, L. Krasula: „CAMBI: Contrast-aware Multiscale Banding Index“, arXiv 2102.00079 ([PDF](https://arxiv.org/pdf/2102.00079)), Abschnitt II, Gl. 1–4 | Banding als Kontrasterkennung: Luma, auf 10 bit, Tiefpass, je Pixel Anteil p(k) der Nachbarn mit Differenz k unter den Pixeln mit Gradient < τg; c(k, s) = p(0)·max(p(−k)/(p(0)+p(−k)), p(k)/(p(0)+p(k))), k = 1…4; fünf Skalen (Fenster 65 × 65 bei 4k, je Stufe halbe Auflösung); Gewicht k·log2(16/v); räumlich die schlechtesten 30 %; alle 0,5 s |
| BT.1359 | ITU-R BT.1359-1, bereits in `src/audio/dsp/avsync.ts` und [audio.md](audio.md) | Vorzeichen (positiv = Ton vor dem Bild), Erkennbarkeit +45/−125 ms, Annehmbarkeit +90/−185 ms |
| SLC | [Streaming Learning Center, Interview mit Elecard](https://streaminglearningcenter.com/?p=20297) (gelesen 10.10.2026) | Anlass: Überwachung mit Sonden entlang der Kette (Elecard Boro) und Qualitätsvergleich per VMAF/PSNR/SSIM für IPTV-/OTT-Betreiber; kleine Produktionen kommen im Artikel nicht vor. Blockbildung und Banding nennt der Artikel nicht beim Namen. |

## Umsetzung

- Panel-Quelle = Rücklauf (dekodierter Stream als normale Quelle, z. B. HLS/RTMP/SRT über die Bridge), im ⚙ die Programm-Quelle.
- **Verzögerung:** beide Quellen werden beim Zeichnen (25 Hz) abgetastet, je neues Bild ein 16 × 9-Vorschaubild der Mittelwerte mit Ankunftszeit; über 10 s die Verschiebung 0–8 s (20-ms-Schritte) mit dem kleinsten mittleren Betragsabstand; „Zuordnung“ = 1 − bester/medianer Abstand (bewegter Inhalt nötig). Eigene Methode, keine Norm.
- **Blockbildung:** B/A nach WSB auf dem Luma (0–255) des Analysebilds, Raster am Bildursprung. Nur aussagekräftig bei nativer Analysebreite; ein skaliertes Analysebild wird erkannt und gemeldet.
- **Banding:** vereinfacht nach CAMBI – 8-bit-Luma auf 10 bit mit 2 × 2-Mittel (Annahme: der Tiefpass ist im Artikel nicht genau beschrieben), Fenster 65·v·B/3840 px für v = 1, 2, 4, 8 auf dem Analysebild statt Hochskalierung auf 4k, Mittelpunkte in einem Raster (Abstand B/48), Fensterpunkte unterabgetastet, τg = 2 Codes (eigene Wahl). Werte sind nicht mit libvmaf-CAMBI vergleichbar; das Panel zeigt Programm → Rücklauf. Stufen über 4 Codes (10 bit) zählen wie in CAMBI nicht als Banding.
- **A/V:** jede Quelle misst ihren Versatz aus Blitz und Piep (`AvSyncMeter`, Bridge-PTS); die Differenz Rücklauf − Programm ist, was die Strecke hinzufügt, bewertet nach BT.1359-1.
- Mediane der letzten 10 Auswertungen (je Seite eine pro Sekunde, abwechselnd). Zeichen bei Blockbildung (Rücklauf über Programm um > 0,1 / 0,3) und Banding (> 1 / 3) sind **eigene Schwellen** ohne Quelle.

## Prüfstand

- Synthetisch: glattes Bild B/A ≈ 1, 8 × 8-Blockmittel nur Grenzsprünge (A = 0), Mischung > 1,5, Rauschen ≈ 1; Banding: flaches Feld 0, 8-bit-Verlauf > 10-bit-Verlauf, starke Textur maskiert; Verzögerung 1,2 s von Zufallsbildern auf ±20 ms, Standbild ohne Zuordnung; A/V-Differenz und Bewertung.
- e2e: zwei animierte Testbild-Quellen als Programm und Rücklauf, Kennzahlen erscheinen (als `aria-label` des Panels lesbar).
- **Nicht geprüft:** mit einem echten Encoder und Rücklauf (HLS/RTMP/SRT), mit echter Blockbildung von H.264/HEVC (Deblocking-Filter glätten die Grenzen, Transformblöcke 4 × 4 bis 32 × 32), ob die Banding-Werte mit dem Eindruck übereinstimmen, A/V mit realer Strecke.
