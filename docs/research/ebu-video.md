# EBU- und ITU-Normen für Video-Messtechnik: Abgleich mit LZ Scopes

Stand: 29.09.2026. Alle Werte stammen aus den geöffneten PDFs. Seitenangaben beziehen sich auf die **PDF-Seite** (p), nicht auf die gedruckte Seitenzahl. Was als *berechnet* markiert ist, ist aus Normwerten abgeleitet und steht so nicht in der Quelle.

Die Seite `tech.ebu.ch/publications` ist für Skripte gesperrt (HTTP 403). Die PDFs unter `tech.ebu.ch/docs/...` lassen sich dagegen direkt laden.

---

## (a) Relevante Publikationen

### EBU

| Dokument | Inhalt (kurz) | PDF |
|---|---|---|
| **R 103 v3.0** (Mai 2020) Video Signal Tolerance in Digital Television Systems | Nominal-, Vorzugs- und Gesamtbereich in Codewerten (8/10/12/16 bit), Messfilter, 1-%-Flächenregel für Out-of-Gamut, SDI-Reservecodes | https://tech.ebu.ch/docs/r/r103.pdf |
| R 103 v2.0 (Juni 2016) | erste Fassung mit Codewert-Tabelle (HDR/HLG/PQ als Stichworte) | https://tech.ebu.ch/files/live/sites/tech/files/shared/r/r103v2_0.pdf |
| R 103-2000 (v1.1) | **historisch**: RGB −5 %/105 %, Luma −1 %/103 %, 1-MHz-Filter | https://tech.ebu.ch/docs/r/r103v1_1.pdf |
| **R 95 v1.1** (Juni 2017) Safe Areas for 16:9 Television Production | Action Safe 3,5 %, Graphics Safe 5 % je Rand; Pixel- und Zeilenwerte für 576i bis 4320p; 4:3-Caption-Safe als Hilfslinie | https://tech.ebu.ch/docs/r/r095.pdf |
| **Tech 3320 v4.1** (Sept. 2019) User Requirements for Video Monitors | Grade 1/2/3 (SDR) und 1A/1B/2/3 (HDR): Leuchtdichte, Schwarzwert, Kontrast, Gamma-Toleranz, Farbtoleranzen, Überschwinger, Out-of-Gamut-Anzeige | https://tech.ebu.ch/docs/tech/tech3320.pdf |
| **Tech 3325 v2.0** (Jan. 2022) Methods for the Measurement of the Performance of Studio Monitors | Messverfahren und Testmuster EBU_1 bis EBU_12, Graustufen-Codewerte, 15 EBU-Testfarben als 10-bit-Y'CbCr, HDR-Varianten (HLG75, PQ58) | https://tech.ebu.ch/docs/tech/tech3325.pdf (Muster: tech.ebu.ch/publications/tech3325-testpatterns) |
| **Tech 3373 v1.0** (März 2020) Colour Bars for HLG UHDTV | EBU-HDR-Farbbalken: 100/75 % HLG, BT.709-Balken nach Display- und Scene-Light-Wandlung, Luma-Rampe, Sättigungskeile (JzAzBz), 2SI-Test, Near-Black −4…+4 % | https://tech.ebu.ch/docs/tech/tech3373.pdf |
| **Tech 3374** (Dez. 2020) EOTF Chart for HDR Calibration and Monitoring | 16 Spalten (0–50 % in 10-%-, 50–100 % in 5-%-Schritten), 3840×2160, 16 bit; prüft EOTF, Clipping und Tone-Mapping am Monitor | https://tech.ebu.ch/docs/tech/tech3374.pdf |
| Tech 3372 UHD/HDR Service Parameters | HLG10, PQ10 und HDR10 als Ausstrahlungsprofile, Signalisierung | https://tech.ebu.ch/docs/tech/tech3372.pdf |
| Tech 3375 Signalling and Transport of HDR and WCG | Signalisierung von Transfer/Primaries | https://tech.ebu.ch/docs/tech/tech3375.pdf |
| Tech 3376 (Sept. 2023) Baseline HDR Camera Painting Controls | HLG-Kameraabgleich: Chart-Weiß auf CV 721, Schwarz auf CV 64; HDR-Monitor 940 = 400 cd/m², γ 1,04 | https://tech.ebu.ch/docs/tech/tech3376.pdf |
| **R 167 v1.1** (Mai 2025) Reference Monitors: Predefined Modes for HLG | HLG-Presets 500–10000 cd/m², Systemgamma, 75 %-Leuchtdichte, Extended Range 109 %, Umfeldkorrektur | https://tech.ebu.ch/docs/r/r167.pdf |
| R 153 / R 154 | UHD/HDR-Parameter für Live-Zuspielung bzw. Dateiaustausch | https://tech.ebu.ch/docs/r/r153.pdf, …/r154.pdf |
| R 118 Tiering of Cameras | Kamerastufen (UHD2/UHD1/HD Tier 1–4) nach Rauschen und Auflösung, Messung nach Tech 3335 | https://tech.ebu.ch/docs/r/r118.pdf |
| Tech 3335 (Aug. 2014) Methods of Measuring the Imaging Performance of TV Cameras | Gamma (Sägezahn/Testchart), Rauschen, Empfindlichkeit, Belichtungsumfang, Farbwiedergabe, Auflösung, Aliasing | https://tech.ebu.ch/docs/tech/tech3335.pdf |
| **R 137 Rev. 2.0** (Aug. 2016) TLCI-2012 / TLMF-2013 | Empfehlung, Leuchten nach Tech 3355 zu bewerten; Messbedingungen am Spektrometer | https://tech.ebu.ch/docs/r/r137.pdf |
| **Tech 3355** TLCI-2012 | Berechnungsverfahren: Kameramodell, 18 bunte ColorChecker-Felder, CIEDE2000, Qa-Skala | https://tech.ebu.ch/docs/tech/tech3355.pdf |
| Tech 3353 / Tech 3354 | „Standard"-Kameramodell der TLCI bzw. Vergleich der CIE-Farbabstandsmetriken | https://tech.ebu.ch/docs/tech/tech3353.pdf, …/tech3354.pdf |
| Tech 3384 (Apr. 2025) Test Patterns – Scaling and Interlacing | Frequenzgitter, Vertikal-Zeit-Filter, Ringing-Kreuze, Chroma-Timing (Material auf qc.ebu.io) | https://tech.ebu.ch/docs/tech/tech3384.pdf |
| R 132 Signal Quality in HDTV | Qualitätsleitfaden (Kompression, Lippensynchronität, Verweis auf R 95) | https://tech.ebu.ch/docs/r/r132.pdf |
| TR 081 (HDR-Monitortests 2024–25), TR 070 (HDR-FAQ 2022), TR 038 (HLG-Subjektivtest) | Hintergrund; TR 070 verweist auf Tech 3373 als freie EBU-Balken | https://tech.ebu.ch/docs/techreports/tr081.pdf usw. |

### ITU-R / SMPTE

| Dokument | Inhalt | Quelle |
|---|---|---|
| **BT.814-4** (07/2018) PLUGE | SD-PLUGE (Annex 1), HD/UHD/HDR-PLUGE mit Codewerten und Pixelpositionen (Annex 2), Einstellverfahren (Annex 3), PQ-Schwarzregelung (Annex 4), HLG-Umfeldgamma (Annex 5) | itu.int, R-REC-BT.814-4-201807 |
| **BT.2111-3** (05/2025) HDR-Farbbalken | Muster für HLG narrow, PQ narrow und PQ full; Maße für 2K/4K/8K; 10/12-bit-Codewerte | itu.int, R-REC-BT.2111-3-202505 |
| **BT.2408-8** (2024) Report: Operational practices in HDR | Referenzpegel (203 cd/m², 75 % HLG, 58 % PQ), Graukarte, Hauttöne, Rasen | itu.int, R-REP-BT.2408-8-2024 |
| BT.2100-3 (02/2025) | PQ- und HLG-Formeln, OOTF, Systemgamma, Quantisierung | itu.int |
| BT.709-6, BT.601-7, BT.2020-2, BT.1886 | Primaries, OETF, Luma-Koeffizienten, Referenz-EOTF | itu.int |
| BT.471-1 | Nomenklatur der Farbbalken (100/0/75/0 usw.) | itu.int |
| BT.1848-1 | Safe Areas (ITU-Pendant zu R 95), nicht ausgewertet | itu.int |
| **SMPTE RP 219-1:2014** | HD/SD-kompatible Farbbalken. **Nicht geprüft**: kostenpflichtig, nur 4 Vorschauseiten ohne Werte frei zugänglich | – |

---

## (b) Normwerte

### Signalbereich und Gamut (R 103)

| Größe | Wert | Quelle |
|---|---|---|
| Nominalbereich | 8 bit 16–235 · 10 bit 64–940 · 12 bit 256–3760 · 16 bit 4096–60160 | R 103 v3.0, Tab. 1, p5 |
| Vorzugsbereich („Preferred Min./Max.") | 8 bit **5–246** · 10 bit **20–984** · 12 bit 80–3936 · 16 bit 1280–62976 | R 103 v3.0, Tab. 1, p5 |
| entspricht in % | **−5,0 % … +105,0 %** für R, G, B **und** Y (*berechnet*: (5−16)/219, (246−16)/219) | – |
| Gesamtbereich | 8 bit 1–254 · 10 bit 4–1019 · 12 bit 16–4079 · 16 bit 256–65279 | R 103 v3.0, Tab. 1, p5 |
| Geltung | „RGB components and the corresponding Luminance (Y) signal should not normally exceed" den Vorzugsbereich | R 103 v3.0, p4 |
| Out-of-Gamut-Anzeige | erst, wenn der Fehler **1 % des Bildes** übersteigt; Bereiche außerhalb des aktiven Bildes (nach R 95) ausklammern | R 103 v3.0, p5 + Fußnote 3 |
| Messfilter | horizontal ¼-Band 1/16, 2/16, 3/16, 4/16, 3/16, 2/16, 1/16; vertikal ½-Band 1/4, 1/2, 1/4 (bei Interlace innerhalb des Halbbilds) | R 103 v3.0, p5 |
| SDI-Reserve | 10 bit 0–3 und 1020–1023 sind Synchronwörter | R 103 v3.0, p7 |
| **historisch** (R 103-2000) | RGB −5 %…105 %, **Luma −1 %…103 %**, Flächenregel 1 % | R 103v1.1, p1 |

Die Werte −1 %/103 % aus dem Auftrag gelten nur für die Fassung von 2000. Seit v2.0 (2016) stehen in der Tabelle Codewerte, die für RGB und Y gleichermaßen −5 %/105 % entsprechen.

### Safe Areas (R 95 v1.1)

| Größe | Wert | Quelle |
|---|---|---|
| Action Safe | 3,5 % oben, unten und seitlich | R 95, Note 5, p4 |
| Graphics Safe | 5 % oben, unten und seitlich | R 95, Note 5, p4 |
| 1080p Action Safe | 1786 px breit (67 px je Seite), Zeilen 80–1083 (38 Zeilen oben) | R 95, Fig. 4, p8 |
| 1080p Graphics Safe | 1728 px breit (96 px je Seite), Zeilen 96–1067 (54 Zeilen oben) | R 95, Fig. 4, p8 |
| 4:3-Caption-Safe | 1296 px breit, 312 px (16,25 %) vom Rand | R 95, Fig. 4, p8 |
| Monitor-Overscan | alle Monitore sollen auf 3,5 % Overscan (= Action Safe) einstellbar sein | Tech 3320, §1.5.11, p15 |

### PLUGE (BT.814-4)

| Variante | Codewerte | Quelle |
|---|---|---|
| HD/UHD SDR | Higher level 235/**940**/3760 · Schwarz 16/64/256 · etwas heller **20/80/320** · etwas dunkler **12/48/192** (8/10/12 bit) | BT.814-4, Tab. 2, p7 |
| HDR (PQ und HLG) | Higher level **399** (10 bit)/1596 (12 bit) = **38,2 %**, ≈ 27 cd/m² auf PQ- bzw. 1000-cd/m²-HLG-Display; Schwarz 64, ±2 % = 80/48 | BT.814-4, Tab. 3, p8 |
| Aufbau HD | links schmale horizontale Streifen (10 Zeilen HD, 20 bei 4K), rechts zwei breite Streifen (144 Zeilen HD, 288 bei 4K), jeweils ≈ +2 % und −2 % um Schwarz; Mitte Higher-level-Feld | BT.814-4, Annex 2, p7 |
| Positionen HD | Spalten Sa–Sh = 0, 312, 599, 888, 1031, 1320, 1607, 1919; Zeilen (progressiv) La–Lj = 42, 366, 387, 509, 510, 653, 654, 776, 797, 1121 | BT.814-4, Tab. 4/5, p9 |
| SD (Annex 1) | Streifen −1,8 %/+1,8 % (Betrieb, 10 bit 48/80), Graustufen 63,0/35,2/15,1 % | BT.814-4, Tab. 1, p6 |
| Einstellregel | Helligkeit so einstellen, dass der dunkelste Streifen gerade verschwindet und der hellere sichtbar bleibt | BT.814-4, Annex 3, p10–11 |
| HLG-Umfeld | γ_bright = γ_ref − 0,076·log10(L_amb/5) | BT.814-4, Annex 5, p12 |

### HDR-Referenzpegel (BT.2408-8, Tech 3320, Tech 3325, R 167)

| Größe | PQ | HLG (1000-cd/m²-Display) | Quelle |
|---|---|---|---|
| HDR Reference White / Graphics White | 203 cd/m², **58 %** | **75 %** | BT.2408-8, Tab. 1, p9; Tech 3320, p21 |
| 18-%-Graukarte | 26 cd/m², 38 % | 38 % | BT.2408-8, Tab. 1, p9 |
| Graustufenchart max. 83 % / 90 % | 162/179 cd/m², 56/57 % | 71/73 % | BT.2408-8, Tab. 1, p9 |
| Haut Fitzpatrick 1–2 / 3–4 / 5–6 | 45–55 / 40–50 / 30–40 % | 55–65 / 45–60 / 25–45 % | BT.2408-8, Tab. 2, p11 |
| Rasen | 40–45 % | 40–55 % | BT.2408-8, Tab. 2, p11 |
| Waveform-Marker | „A 75%-HLG or 58%-PQ marker on a waveform monitor … will help" | BT.2408-8, p9 |
| 10-bit-Code Referenzweiß | 573 (narrow), **594** (full) | **721** | Tech 3325, Fig. 30, p40; BT.2111-3, Tab. 2–4 |
| 1000 cd/m² in PQ | 75,2 % Signal | – | Tech 3325, p39 |
| HLG-Systemgamma | – | γ = 1,2 + 0,42·log10(Lw/1000); erweitert γ = 1,2·κ^log2(Lw/1000), κ = 1,111 | BT.2100-3, Note 5f, p9 |
| HLG-OOTF | – | F_D = α·Y_S^(γ−1)·E mit Y_S = 0,2627 R + 0,6780 G + 0,0593 B (Gamma auf Luminanz, nicht je Kanal) | BT.2100-3, p8; Note 5e, p9 |
| HLG-Konstanten | – | a = 0,17883277, b = 0,28466892, c = 0,55991073 | BT.2100-3, p7; R 167, p10 |
| HLG-Presets | – | 500/600/1000/2000/3000/4000/5000/10000 cd/m² → 75 % = 120/138/203/343/456/559/653/1043 cd/m², γ = 1,07/1,11/1,20/1,33/1,42/1,48/1,53/1,70 | R 167, Tab. 1.1, p6 |
| HLG Extended 109 % | – | (1019−64)/(940−64) = 1,0902; bei 1000 cd/m² → 1811 cd/m² | R 167, p4 und Tab. 1.2, p7 |
| PQ-Konstanten | m1 = 2610/16384, m2 = 2523/4096·128, c1 = 3424/4096, c2 = 2413/4096·32, c3 = 2392/4096·32 | – | BT.2100-3, p6 |
| Quantisierung | narrow D = Round[(219·E′+16)·2^(n−8)], full D = Round[(2^n−1)·E′] | – | BT.2100-3, Tab. 9, p11 |

### Farbbalken

| Muster | Werte | Quelle |
|---|---|---|
| Nomenklatur | Weiß / Schwarz / Farbe max / Farbe min, z. B. **100/0/75/0** (EBU), 100/0/100/0, 75/7,5/75/7,5 | BT.471-1, p2 |
| BT.2111-3 HLG narrow | 100 %: 940/64; 75 %: 721/64; 40 % Grau 414; Stufen −7 % = 4, 0 % = 64, 10 % = 152, 20 % = 239, 30 % = 327, 40 % = 414, 50 % = 502, 60 % = 590, 70 % = 677, 80 % = 765, 90 % = 852, 100 % = 940, 109 % = 1019; Schwarz −2/0/+2/+4 % = 48/64/80/**99** | BT.2111-3, Tab. 2, p9–10 |
| BT.2111-3 75 % BT.709-Balken in HLG | Gelb 713/719/316, Cyan 538/709/718, Grün 512/706/296, Magenta 651/286/705, Rot 639/269/164, Blau 227/147/702 | BT.2111-3, Tab. 2, p10 |
| BT.2111-3 PQ narrow | 58 %-Balken 573/64; 40 % Grau 414; Stufen wie HLG | BT.2111-3, Tab. 3, p11–12 |
| BT.2111-3 PQ full | 100 % 1023/0; 58 % **594**; 40 % Grau 409; Stufen 0/102/205/…/1023; +2 %/+4 % Schwarz = 19/41 | BT.2111-3, Tab. 4, p12–13 |
| BT.2111-3 Maße (2K) | a 1920, b 1080, c 240, d 206, e 204, f 136, g 70, h 68, i 238, j 438, k 282; Zeilen b/12, b/2, b/12, b/12, b/4 | BT.2111-3, Tab. 1, p8; Fig. 1, p6 |
| Tech 3373 (EBU, nur HLG) | 100/75 %-Balken wie BT.2111; DL-Weiß 602, SL-Weiß 618; Luma-Rampe CV 4–1019 (−7…+109 %); Text-Hintergrund 250, Text 600; Sättigungskeile Rot/Grün/Blau 0,0–1,0 (Tab. 6–8); Near-Black −4/−2/−1/0/1/2/4 % = 32/48/56/64/72/80/**96** | Tech 3373, Tab. 3–10, p9–13; Maße Tab. 1, p8 |
| SMPTE EG 1 / RP 219 | nicht offen zugänglich, nicht geprüft | – |

### Monitore (Tech 3320 v4.1)

| Größe | Grade 1 | Grade 2 | Grade 3 | Quelle |
|---|---|---|---|---|
| SDR Weiß (100 %) | 70 bis ≥ 100 cd/m² | 70 bis ≥ 200 | 70–250 (400) | §1.5.1, p9 |
| SDR Schwarz | < 0,05 cd/m² | < 0,4 | < 0,7 | §1.5.2, p10 |
| SDR Kontrast (Vollbild) | > 2000:1 | > 500:1 | > 300:1 | §1.5.3, p11 |
| Gamma | nominal 2,4, Toleranz ±0,10 zwischen 10 und 90 % | wie G1 | – | §1.5.4, p11 |
| Graustufe | 0,5 Δu\*v\* (1–100 cd/m²) | 1 Δu\*v\* | 1,5 Δu\*v\* | §1.5.5, p12 |
| Weißpunkt D65 | 1,3 Δu\*v\* | 4 Δu\*v\* | 4 Δu\*v\* | §1.5.7, p13 |
| EBU-Testfarben | 4 Δu\*v\*, Haut 2,6 | 7 ΔE\* | 7 ΔE\* | §1.5.6, p12 |
| HDR-HLG-Spitze (1 % Fläche) | 1A/1B ≥ 1000 cd/m² | ≥ 600 | ≥ 500 | §2.4.1.1, p22 |
| HDR-Schwarz | 0,005 cd/m² | 0,01 | 0,02 | §2.4.2, p25 |
| HLG 75 %-Vollbild | 203 cd/m² ohne Power-Limit (bei 940 = 1000 cd/m²) | – | – | p23 |
| PQ-Vollbild | 199,2 cd/m² (CV 592, full) ohne Power-Limit | – | – | p24 |
| Out-of-Gamut | G1/G2 brauchen einen Modus, der Out-of-Gamut anzeigt, ohne zu korrigieren; 1B/PQ: harter Clip plus Falschfarben-Anzeige | – | – | §1.5.20, p17; p21, p23–24 |

### Messmuster (Tech 3325 v2.0)

| Muster | Inhalt | Quelle |
|---|---|---|
| EBU_1 | Weißfeld H/7,5 (13,13 % H) in der Mitte, vier Schwarzfelder, Hintergrund 50 % Grau (SDR) bzw. 38,2 %/CV 399 (HDR) | p12, p39 |
| Messpunkte | 1 Mitte; 2/5 = ±0,4 H; 9/12 = ±0,4 W; 3,4,6,7 = ±0,2 W/H; 8,10,11,13 = ±0,4 W/H | Fig. 4, p10 |
| EBU_4 Graustufen (10 bit) | 64, 86, 138, 190, 242, 294, 346, 398, 450, 502, 554, 606, 658, 710, 762, 814, 866, 918, 940, 1019 | Tab. 5, p19 |
| BT.709-Primaries (Y′CbCr) | Rot 250/409/960 · Grün 691/167/105 · Blau 127/960/471 | Tab. 6, p23 |
| 15 EBU-Testfarben | z. B. Dark Skin 381/470/578, Light Skin 636/457/599 (vollständig in Tab. 7) | Tab. 7, p23 |
| HDR-Weißfeld | SDR 940, HLG 721, PQ58 full 594, PQ58 narrow 573 | Fig. 30, p40 |

### Transferfunktionen und Farbräume (für src/color.ts)

| Größe | Wert | Quelle |
|---|---|---|
| BT.709 Primaries | R 0,640/0,330 · G 0,300/0,600 · B 0,150/0,060 · D65 0,3127/0,3290 | BT.709-6, p5 |
| BT.709 Luma | 0,2126 / 0,7152 / 0,0722 | BT.709-6, p6 |
| BT.709 OETF | V = 1,099·L^0,45 − 0,099 (L ≥ 0,018), sonst 4,5·L | BT.709-6, p5 |
| BT.601 Primaries **625** | R 0,640/0,330 · G 0,290/0,600 · B 0,150/0,060 | BT.601-7, §2.6.1, p8 |
| BT.601 Primaries **525** | R 0,630/0,340 · G 0,310/0,595 · B 0,155/0,070 | BT.601-7, §2.6.1, p8 |
| BT.1886 | L = a·max(V+b, 0)^γ, γ = 2,40, Referenz Lw = 100 cd/m² | BT.1886, p4–5 |
| TLCI Qa | k = 3,16, p = 2,4; nur die 18 bunten ColorChecker-Felder; Qa = 50 bei Tageslicht-Leuchtstoffröhre (ΔE\* 3,16) als Grenze „korrigierbar" | Tech 3355, p16 |

---

## (c) Abweichungen in LZ Scopes

| # | Datei:Zeile | Ist | Soll | Quelle |
|---|---|---|---|---|
| 1 | `src/patterns.ts:210–221` (Muster `pluge`) | vier Balken +2/+4/+1/+3 % auf Schwarz, 75-%-Feld; keine Sub-Black-Streifen | BT.814-Aufbau: Higher level 100 % (SDR) bzw. 38,2 % (HDR, CV 399), Streifen ±2 % (48/80) links schmal, rechts breit, Positionen nach Tab. 4/5 | BT.814-4, p7–9 |
| 2 | `src/patterns.ts:97–101` (`smpteBars`) | PLUGE −4/0/+4 % (−4 % wird auf 0 geklemmt) | Das entspricht der EG-1/NTSC-Tradition. Digitale HD-Balken (RP-219-Familie, BT.2111) nutzen −2/0/+2/0/+4 %. Namen oder Variante klären | BT.2111-3, Tab. 2 (48/64/80/99) |
| 3 | `src/patterns.ts:179` (`gray18`) | 118/255 = 46,3 % („≈ 46 %") | Mit der BT.709-OETF ergibt 18 % Reflexion **40,9 %** (*berechnet*; 8-bit narrow ≈ 106, full ≈ 104). 46 % ist die sRGB-Kurve. Das widerspricht auch dem eigenen ARRI-Band 38–42 % (`src/color.ts:160`). Für HDR: 38 % HLG/PQ | BT.709-6, p5; BT.2408-8, Tab. 1 |
| 4 | `src/patterns.ts:278–280` (`safe`) | gestrichelter 4:3-Rahmen über volle Höhe (1440 px bei 1080p) | R 95 v1.1 markiert nur den 4:3-**Caption-Safe** mit 1296 px (312 px vom Rand) als Hilfslinie; volle 4:3-Fläche ist nicht Teil von R 95 v1.1 | R 95, Fig. 4, p8 |
| 5 | `src/patterns.ts:266–282` (`safe`) | Kästen als `w·0.93` bzw. `w·0.9` mit Bruchteil-Pixeln | stimmt prozentual (3,5 %/5 %). Pixelgenau wären es bei 1080p 67/38 px bzw. 96/54 px nach R 95 statt gerundeter Brüche; bei 720p/2160p die Werte aus Fig. 2/5 | R 95, Note 5, Fig. 2–5 |
| 6 | `src/patterns.ts` (Gruppe HDR, 337–366) | keine HDR-Farbbalken, kein HDR-PLUGE | BT.2111-3 (HLG, PQ narrow, PQ full) und/oder Tech 3373 fehlen | BT.2111-3; Tech 3373 |
| 7 | `src/patterns.ts:1–4`, README Z. 58 | Canvas voll-RGB 8 bit: kein −7 %, kein 109 %, keine exakten 10-bit-Codes (721, 573, 99 …) | Für BT.2111/Tech 3373 intern 10/16-bit-Werte erzeugen und als 16-bit-Frame an die Scopes geben (`Source.pushFrame`) | BT.2111-3, §5, p5 |
| 8 | `src/color.ts:94–95` `hlgNits`/`hlgFromNits` | fest 1000 cd/m², γ = 1,2 | Lw wählbar, γ = 1,2 + 0,42·log10(Lw/1000); R-167-Presets | BT.2100-3, Note 5f, p9; R 167, Tab. 1.1 |
| 9 | `src/renderer.ts:173–182` (`lin`, HLG) | `pow(e, 1.2)` je Kanal | OOTF auf Luminanz: Y_S^(γ−1)·E mit Y_S aus 2020-Koeffizienten. Je Kanal verschiebt Sättigung und Farbton bei Farben (die Grauwerte stimmen) | BT.2100-3, p8, Note 5e |
| 10 | `src/renderer.ts:187–195` (`toDisplay`) | eigener Roll-off (`w = 4`) für HDR auf SDR | keine Norm. Für die Vorschau BT.2408-Display-Light-Wandlung (HLG→709) oder BT.2390-EETF (PQ); mindestens als „Näherung" kennzeichnen | Tech 3373, p8 (verweist auf BT.2408); Tech 3320, p24 (EETF BT.2390) |
| 11 | `src/color.ts:22`, `src/panel.ts:33`, `src/renderer.ts:441` | `'601'` nutzt immer SMPTE-C (525-Primaries), auch für `bt470bg` (625/PAL) | 625-Quellen: R 0,640/0,330, G 0,290/0,600, B 0,150/0,060 (EBU-Primaries) | BT.601-7, §2.6.1, p8 |
| 12 | README „Grenzen", Bridge (rgba) | Werte außerhalb 16–235 werden bei der Wandlung abgeschnitten, keine Y′CbCr-Prüfung | R-103-Prüfung braucht Sub-Black/Super-White ungeklemmt (bis 4…1019). Waveform reicht schon −5…105 % (`src/renderer.ts:29–30`), der Datenpfad nicht | R 103 v3.0, Tab. 1, p5 |
| 13 | `src/renderer.ts:29–30` | Waveform −5 %…105 % | Für BT.2111/Tech 3373 (−7 %…109 %) und HLG Extended Range auf mindestens −7…110 % erweitern | BT.2111-3, Tab. 2; R 167, p4 |
| 14 | `src/graticule.ts:46–58` | %-Skala ohne HDR-Marken; nur im cd/m²-Modus 203 hervorgehoben | Marken 75 % (HLG) bzw. 58 % (PQ), optional 38 % (Graukarte) | BT.2408-8, p9 |
| 15 | `src/color.ts:131–136` / Vectorscope | Ziele 75/100 % stimmen (Test in `test/color.test.ts:34`) | – (keine Abweichung). Für HLG/2020 fehlen die BT.709-Umrechnungsziele aus BT.2111/Tech 3373 | BT.2111-3, Tab. 2 |

Ohne Abweichung geprüft: EBU-Balken 100/0/75/0 und 100/0/100/0 (`patterns.ts:288–295`, BT.471-1), PQ-Konstanten (`color.ts:75`), HLG-Konstanten a/b/c (`color.ts:86`, auch Shader), 75 % HLG ≙ 203 cd/m² und 58 % PQ ≙ 203 cd/m² (`patterns.ts:340–365`), Luma-Koeffizienten 601/709/2020, Primaries 709/2020, Legal-Range-Formel (`color.ts:122–124`, BT.709/BT.2100), SDR-cd/m² nach BT.1886 mit 100 cd/m² und Lb = 0.

---

## (d) Empfohlene neue Funktionen

### Muss

1. **EBU-R-103-Gamut-Prüfung**: Y′CbCr ungeklemmt einlesen (Bridge: 10/16-bit Y′CbCr statt `rgba`), R′G′B′ ohne Clamp zurückrechnen, R/G/B und Y gegen den Vorzugsbereich prüfen (10 bit 20–984). Vor der Prüfung die Filter 1/16…1/16 und 1/4-1/2-1/4 anwenden. Alarm erst ab > 1 % der aktiven Bildfläche. Anzeige: Anteil in %, Markierung im Bild, Grenzlinien bei −5/105 % in der Waveform. Zusätzlich den Gesamtbereich (4–1019) als harte Grenze. Umschaltbar auf die historische Regel R 103-2000 (Y −1/103 %).
2. **BT.2111-3-HDR-Balken** in drei Varianten (HLG narrow, PQ narrow, PQ full) nach Tab. 1–6, erzeugt als 16-bit-Frame für die Scopes, damit −7 %, 109 % und die exakten Codes ankommen.
3. **BT.2408-Marken** in der Waveform: 75 % HLG / 58 % PQ als Referenzweiß, 38 % Graukarte, optional Hautton-Bänder aus Tab. 2 als Falschfarben-Preset „BT.2408".
4. **BT.814-PLUGE** (SDR 940 und HDR 399, Streifen 48/80, Positionen nach Tab. 4–6); in der Canvas-Ausgabe mit Hinweis, dass −2 % nur im 16-bit-Scope-Pfad existiert.
5. **HLG-Systemgamma** korrekt: Lw-Einstellung mit γ-Formel, OOTF auf Luminanz (Abw. 8/9); Presets nach R 167 (500…10000 cd/m²).

### Soll

6. **EBU Tech 3373** komplett: DL/SL-Balken, Luma-Rampe 4–1019 mit Marken bei 64/721/940, Sättigungskeile R/G/B, Near-Black-Reihe, 2SI-Muster für Quad-3G.
7. **Tech-3325-Messmuster** EBU_1, EBU_3 (13 Messpunkte, Fenster 1/4/10/25/81 %), EBU_4-Graustufen und EBU_5 (Primaries + 15 EBU-Testfarben aus Tab. 7) für Monitorvermessung am Ausgabefenster. Die 15 EBU-Farben ersetzen oder ergänzen die ColorChecker-Näherung.
8. **Tech-3374-EOTF-Chart** (16 Spalten, Codes 0–50 % in 10-%-, 50–100 % in 5-%-Schritten, Mitte 720 px hoch).
9. **Safe Areas pixelgenau** nach R 95 (Fig. 1–6) als Overlay im Bild-Panel, nicht nur als Testbild; 4:3-Caption-Safe statt 4:3-Vollbild.
10. **601 nach 525/625 trennen** (Abw. 11).
11. **Vectorscope-Ziele für 709-in-2020**: Die BT.709-Balken aus BT.2111/Tech 3373 als zweiten Zielsatz anzeigen, damit HLG-Konvertierungen prüfbar sind.
12. **Normgerechte HDR-Vorschau**: BT.2408-Wandlung HLG→709 (Display Light) statt eigenem Roll-off, und eine Anzeige von Pixeln außerhalb des Display-Volumens (Tech 3320 verlangt so etwas vom Grade-1B-Monitor).

### Kann

13. **TLCI-2012-Rechner**: Spektrum (CSV vom Spektrometer) laden, Qa nach Tech 3355 berechnen. Das ist Lichtmesstechnik, kein Videosignal; sinnvoll nur als Nebenwerkzeug.
14. **Monitorabnahme gegen Tech 3320** mit externem Messgerät: Grade-Schwellen als Prüfliste (Weiß, Schwarz, Kontrast, Gamma ±0,10, Δu\*v\*).
15. **Tech-3384-Muster** (Frequenzgitter, Ringing-Kreuze, Chroma-Timing) für Scaler/Deinterlacer-Tests.
16. **Legal-Range-Canvas-Modus**: Muster auf 16–235 abbilden, damit Sub-Black im Ausgabefenster darstellbar ist, wenn Capture oder Display „limited" interpretieren.

---

## (e) Offene Fragen

1. **SMPTE RP 219-1 und EG 1** sind kostenpflichtig und nicht geprüft. Die −I/+Q-Werte in `smpteBars` (0/33/76, 50/0/106) lassen sich ohne die Norm nicht belegen. Soll das Muster als „EG-1-Stil (Näherung)" bezeichnet oder durch ein belegtes Muster ersetzt werden?
2. **+4 %-Schwarz**: BT.2111-3 nennt 99 (= 64 + 0,04·876), Tech 3373 Tab. 10 nennt 96 (−4 % = 32, also 8 Codes je Prozent). Welche Quelle soll LZ Scopes zugrunde legen?
3. **Tech 3320** schreibt bei HLG „luma level 1023 is called 109% white" (p22), R 103 und R 167 rechnen mit 1019. Offensichtlich ein Fehler in Tech 3320; bitte nicht übernehmen.
4. **Ausgabefenster vs. Scope-Pfad**: Soll der Generator künftig zweigleisig arbeiten (16-bit exakt für die Scopes, 8-bit Canvas für die Ausgabe), oder soll die Ausgabe über die Bridge als 10-bit-Datei/-Stream laufen?
5. **Hautton-Linie 123°** (`color.ts:139`) ist in keiner geöffneten Quelle belegt; für HDR liefert BT.2408 nur Pegelbereiche, keinen Winkel.
6. **ARRI-Falschfarben** (`color.ts:157–164`) sind herstellereigen und nicht Teil der EBU/ITU-Normen. Ein BT.2408-Preset wäre die normbasierte Ergänzung.
7. Die **EBU-Testmuster-Dateien** (Tech 3325, Tech 3373-C-Code, Tech 3374-TIFF) liegen auf tech.ebu.ch bzw. qc.ebu.io. Lizenz und Weitergabe im Repo sind nicht geprüft. Deshalb eher selbst erzeugen als Dateien bündeln.
8. **BT.1848-1** (ITU-Safe-Areas) wurde geladen, aber nicht mit R 95 abgeglichen.
