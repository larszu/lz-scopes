# Farb-Repos: Auswertung für LZ Scopes

Stand: 29.09.2026. Alle Repos flach geklont (`git clone --depth 1`), Code und README gelesen. Datei- und Zeilenangaben beziehen sich auf diesen Stand; das Datum dahinter ist der letzte Commit.

Ausgangslage LZ Scopes: `src/color.ts` kennt BT.601/709/2020-Luma, die Primaries Rec.709, P3-D65, Rec.2020 und SMPTE-C, PQ, HLG, BT.1886 (2,4 / 100 cd/m²), Legal-Range-Codes und ARRI-Falschfarben. Der Renderer streut Punkte additiv in ein Float-Target (WebGL2). Kamera-Log-Kurven, Kamera-Gamuts, ΔE, u′v′, Gamut-Warnung und Messabläufe fehlen noch.

## Lizenzen auf einen Blick

| Repo | Lizenz | Code übernehmen? | Formeln und Konstanten |
|---|---|---|---|
| soufianekhiat/alwan | MIT | **ja**, mit Copyright-Hinweis | ja |
| aces-aswf/aces-core | Apache 2.0 | **ja**, mit LICENSE und Hinweis auf Änderungen | ja |
| djieff/prism | MIT | ja, mit Copyright-Hinweis | ja |
| MindStudioOfficial/scopes_plusplus | GPL-3.0 | nein | nur Ideen und Fakten |
| baldavenger/DCTLs | GPL-3.0 | nein | nur Ideen und Fakten |
| kampidh/Colour-Gamut-Plotter | GPL-3.0 | nein | nur Ideen |
| eoyilmaz/displaycal-py3 | GPL-3.0 | nein | nur Ideen, Abläufe und Fakten |
| jedypod/gamut-compress | **keine Lizenzdatei** | nein, alle Rechte beim Autor | nur Ideen; dieselbe Mathematik liegt MIT-lizenziert in alwan |
| Joegenco/PixelManager | **keine Lizenzdatei**; die mitgelieferten Hersteller-LUTs haben eigene Bedingungen | nein | Parameter nur zur Gegenprobe |

GPL-3 heißt für LZ Scopes: Solange LZ Scopes nicht selbst unter GPL-3 steht (im `package.json` ist keine Lizenz gesetzt), darf kein Code daraus übernommen werden, auch nicht übersetzt oder abgewandelt. Mathematische Formeln, Normwerte (BT.2100, ISO 14861, Herstellerkurven) und Abläufe sind als solche nicht geschützt. Sie werden aus der Primärquelle oder aus MIT/Apache-Code übernommen und in eigenen Worten neu umgesetzt. Die GPL-Repos dienen dabei als Gegenprobe.

---

## 1. MindStudioOfficial/scopes_plusplus (GPL-3.0, 22.11.2025)

**Zweck:** Native C++23-App (ImGui, OpenGL, OpenCL) für Live-Waveform und Vectorscope. Open-Source-Neufassung von LiveScopes.tv, einem der Vorbilder von LZ Scopes. NDI-Eingang.

**Scope-Typen** (README „Features“): Waveform Luma, RGB, RGB-Parade, **RGB Blacklevel**, YUV-Parade; UV-Vectorscope; CIE 1931; **Double Diamond**; Falschfarben-Viewer; wählbar Linear RGB, sRGB, BT.709, BT.601-525/-625, BT.2020 und Legal/Full Range. Auf der Roadmap stehen DeckLink, LUTs, Fokus-Peaking und Zebra.

**Nützliche Inhalte:**
- **Double-Diamond-Display** (Tektronix-Stil, Gamut-Prüfung R′G′B′): `src/app/kernels/02_accumulate.cl` Z. 179–219. Obere Raute G/B: `x = −0,5·G + 0,5·B + 0,5`, `y = 0,25·G + 0,25·B + 0,5`. Untere Raute G/R: `x = −0,5·G + 0,5·R + 0,5`, `y = −0,25·G − 0,25·R + 0,5`. Alles innerhalb der Rauten ist legales RGB. Die Formeln sind trivial und lassen sich in LZ Scopes frei nachbauen.
- **RGB Blacklevel:** eine gezoomte Waveform der untersten Signalwerte. `03_create_images.cl` Z. 79–91 liest nur die Zeilen bis Faktor 0,137255 (≈ 35/255) und spreizt sie auf die volle Höhe. Das ist als „Schwarz-Lupe“ interessant.
- **ROI:** Jeder Akkumulations-Kernel prüft eine Maske (`mask_rect`, `02_accumulate.cl` Z. 64). LZ Scopes hat die ROI schon.
- **Falschfarben-Presets:** `src/app/src/false_color.hpp` Z. 827–832 mit RED, „Manhatten LCD“, Sony Venice, ARRI, jeweils auch transparent. Das Format ist eine dünne Liste (Pegel % → Farbe), die zu einer 256er-Tabelle für Full und Limited Range expandiert wird (Z. 9–40). Die Tabellenwerte sind GPL-Code und nicht zu übernehmen. Die Presets besser aus den Hersteller-Handbüchern bauen.
- Ein OpenCL-Kernel für die Eingangsformate UYVY, YUYV, NV12, P216, UYVA (`01_convert.cl`) zeigt, welche Formate NDI/SDI liefern.

**Übernehmbar:** nur Ideen (Double Diamond, Blacklevel-Zoom, weitere Falschfarben-Presets, Legal/Full-Umschaltung am Scope).

---

## 2. soufianekhiat/alwan (MIT, 05.09.2026)

**Zweck:** Farbwissenschafts-Bibliothek in reinem C11, ohne Abhängigkeiten. Die Kernel kompilieren unverändert als C, **GLSL**, HLSL und Halide (`src/alwan/alwan_glsl.h`). Laut README ist jede Konstante gegen die Referenz geprüft (OCIO, colour-science, ACES-CTL). Trotz des Namens ist es **kein Farbwähler**, sondern die umfangreichste Formelquelle dieser Liste. Und sie ist MIT-lizenziert.

**Kernfunktionen (README „Features“):** CIE XYZ/xyY/Lab/Luv/LCh, IPT, ICtCp, JzAzBz, Oklab; CATs (Bradford, CAT02, CAT16 …); SDR/HDR-Transfer (sRGB, BT.1886, PQ, HLG, BT.2390-EETF, BT.2446); **Kamera-Logs von 13 Herstellern**; ACES 1.x und 2.0, ACEScc/cct; ΔE76/94/2000/CMC/**ITP**/OK u. a.; CCT (McCamy, Robertson, Ohno-Duv); CRI, TM-30; CVD-Simulation; Gamut-Mapping; MaxCLL/MaxFALL.

**Konkrete Stellen (alle MIT):**

| Inhalt | Datei, Zeilen | Konstanten (Auszug) |
|---|---|---|
| S-Log3 | `core/alwan_rgb_core.inc` 237–253 | log: `(420 + log10((x+0,01)/0,19)·261,5)/1023` ab x ≥ 0,01125; linear: Code 95 … 171,2102946929 |
| S-Log2 | 228–235 | S-Log mit Faktor 155/219 |
| C-Log / C-Log2 / C-Log3 | 263–330 | C-Log2: a = 0,24136077, k = 87,09937546, Offset 0,092864125, Eingang /0,9; C-Log3 dreiteilig mit Schwellen ±0,014 |
| V-Log | 336–362 | Schnitt 0,01, b = 0,00873, c = 0,241514, d = 0,598206, linear 5,6·x + 0,125 |
| LogC3 (EI 800) | 367–394 | a = 5,555556, b = 0,052272, c = 0,247190, d = 0,385537, e = 5,367655, f = 0,092809, Schnitt 0,010591 |
| LogC4 | 396–423 | a = 2231,8263090676883, b = 0,9071358748778103, c = 0,09286412512218964, s = 0,1135972086105891, t = −0,01805699611991131; `(log2(a·x+64)−6)/14·b + c` |
| REDLog, REDLogFilm | 427–453 | |
| Log3G10 | 455–477 | a = 0,224282, b = 155,975327, c = 0,01, g = 15,1927 |
| BMDFilm Gen5 | 480–505 | A = 0,08692876065491224, B = 0,005494072432257808, C = 0,5300133392291939, D = 8,283605932402494, E = 0,09246575342465753, Schnitt 0,005, `A·ln(x+B)+C` |
| BMDFilm Gen4 | 508–530 | |
| N-Log, Apple Log, F-Log2, L-Log, D-Log | 646, 701, 770, 803, 834 | |
| Kamera- und Normgamuts (Primaries + Weiß) | `data/rgb_spaces/*.csv`, eingebunden über `alwan_rgb_embedded.h` 21–339 | z. B. AWG4: R 0,7347/0,2653, G 0,1424/0,8576, B 0,0991/−0,0308, D65; S-Gamut3.Cine: 0,766/0,275, 0,225/0,800, 0,089/−0,087; V-Gamut: 0,730/0,280, 0,165/0,840, 0,100/−0,030; Blackmagic WG Gen5, Cinema Gamut, REDWideGamutRGB, DaVinci WG, E-Gamut, D-Gamut, F-Gamut … |
| u′v′ | `core/alwan_colorspace_core.inc` 75–81 | `u′ = 4X/(X+15Y+3Z)`, `v′ = 9Y/(X+15Y+3Z)` |
| ΔE ITP (BT.2124) | `alwan_colorspace_core.inc` 332–337 | `720·√(ΔI² + 0,25·ΔCt² + ΔCp²)` (Faktor 720 laut `docs/api/color-difference.md` Z. 104) |
| ΔE2000 | `alwan_colorspace_core.inc` ab 426 | |
| ACES-1.3-Gamut-Compression (RGC) | Parameter `api/alwan_aces_ff.c` 426–445, Mathematik `core/alwan_aces_ff_core.inc` 216–282 | Limits C/M/Y = 1,147 / 1,264 / 1,312; Schwellen 0,815 / 0,803 / 0,880; Power 1,2; `d = (ach − c)/|ach|`, `cd = thr + s·nd/(1+nd^p)^(1/p)`; Skalierung `s = (lim−thr)/(((1−thr)/(lim−thr))^(−p) − 1)^(1/p)` |
| BT.2390-EETF (HDR-Tonemapping) | `core/alwan_hdr_core.inc` 232–275 | |
| MaxCLL / MaxFALL | `docs/api/hdr.md` 66–96 | MaxCLL = max(R,G,B) über alle Pixel, MaxFALL = Mittel der Pixel-Maxima, jeweils in cd/m² |
| Gamut-Mapping-Methoden (Überblick) | `docs/gamut_mapping.md` 36–68 | Clip, Hue-preserving, Oklab-Varianten, HDR-ICtCp-Mapper, ACES 1.3/2.0 |

**Übernehmbar:** ja, Code und Konstanten, mit MIT-Hinweis (Copyright (c) 2025 Soufiane KHIAT). Praktisch: die `*_core.inc`-Kernel lassen sich fast wörtlich nach GLSL ES 3.0 (WebGL2) und TypeScript übertragen. Bei diesem Repo gilt: erst die Tests aus dem Schwesterrepo `alwan_dev` gegenlesen, wenn Zweifel an einer Konstante bestehen.

---

## 3. kampidh/Colour-Gamut-Plotter (GPL-3.0, 15.01.2023)

**Zweck:** PyQt5-Oberfläche um die colour-science-Funktion `plot_RGB_chromaticities_in_chromaticity_diagram`. Sie trägt die Pixel eines Bildes als Punktwolke ins Chromatizitätsdiagramm ein. **Einen 3D-Gamut-Plot gibt es nicht**, nur 2D (CIE 1931 xy und CIE 1976 u′v′), dazu eine schnelle Vorschau mit vispy.

**Nützliche Inhalte:**
- Umschaltung **CIE 1931 ↔ CIE 1976 UCS**. Sichtbereiche: 1931 `[−0,1; 0,85; −0,05; 0,9]`, 1976 `[−0,05; 0,65; −0,05; 0,65]` (`src/CIEPlotterQt_base.pyw` Z. 245–246, Plot Z. 725–790).
- **Plot-Dichte** als Pixelbudget: 50 k / 100 k / 500 k / 1 M / 3 M / 5 M / unbegrenzt, mit Nearest-Neighbour-Verkleinerung ohne Interpolation (Z. 159–183). LZ Scopes streut bis zu 4 M Punkte, das ist vergleichbar.
- **Eingebettetes ICC-Profil auslesen**: Primaries, Weiß und TRC je Kanal, auch parametrische Kurven der Typen 0–4 (`src/icctotrcMP.py` Z. 625–665). Relevant für Bilddateien als Quelle.
- Hinweis bei Werten > 1,0 nach dem Linearisieren: „possibly an HDR image“ (Z. 537–538).

**Übernehmbar:** nur Ideen (u′v′-Ansicht, ICC-Auswertung bei Dateiquellen). Die ICC-Parametric-Curve-Typen stehen in der ICC-Spezifikation.

---

## 4. jedypod/gamut-compress (keine Lizenz, 27.05.2022)

**Zweck:** Jed Smiths Werkzeug aus der ACES Gamut Mapping VWG. Es drückt hochchromatische Kamerafarben, die im Arbeitsgamut (z. B. ACEScg) negative Komponenten hätten, zurück in den Gamut. Umsetzungen gibt es als Nuke Blink, DCTL, Fuse, Matchbox und GLSL. Das README ist eine sehr gute Einführung (Kamera-Primaries außerhalb des Spektralzugs, negative Werte, Blue-Bar-Beispiel).

**Algorithmus** (`docs/gamut-compress-algorithm.md` Z. 12–21 und 78; `GamutCompress.glsl` Z. 71–102):
- Achromatisch: `ach = max(r,g,b)`
- Distanz je Kanal: `d = (ach − c)/|ach|`; 0 = neutral, 1 = Gamutrand, > 1 = außerhalb
- Schwelle `th = 1 − threshold`; Distanzlimit `dl = 1 + {cyan, magenta, yellow}`
- Parabolische Kompression mit `s = (1 − th)/√(max(1,001; dl) − 1)` und `cd = s·√(d − th + s²/4) − s·√(s²/4) + th` für d ≥ th, exakt invertierbar (Z. 95–99)
- Rückweg: `rgb = ach − cd·|ach|`
- DCTL-Voreinstellung (`GamutCompress.dctl` Z. 1–8): Schwelle C/M/Y 0,15, Distanz C/M/Y 0,1 / 0,2 / 0,1, Arbeitsraum ACEScct/ACEScc/ACEScg
- ACEScct: linear `10,5402377416545·x + 0,0729055341958355` bis x ≤ 0,0078125, sonst `(log2 x + 9,72)/17,52`; ACEScc mit Sonderfall unter 2⁻¹⁵ (`GamutCompress.glsl` Z. 13–51)
- Parameterlogik mit Threshold, Power und Distanzlimits je Kamera: `docs/gamut-compress-documentation.md` Z. 52–84. Das Nuke-Werkzeug `utilities/CalculateDistance.nk` berechnet die maximale Distanz aus Quell- und Arbeitsgamut.

**Übernehmbar:** nein (keine Lizenz). Die Idee „Distanz zum Gamutrand je Kanal“ ist aber ideal für eine **Gamut-Warnung mit Stärkeanzeige**. Die RGC-Variante (Power-Kurve, feste ACES-Parameter) liegt MIT-lizenziert in alwan und Apache-lizenziert bei ACES/OCIO vor.

---

## 5. Joegenco/PixelManager (keine Lizenz, 20.05.2026)

**Zweck:** Eine große OCIO-2.0-Konfiguration für Blender, Nuke und Fusion (`config.ocio`, 4209 Zeilen). Sie enthält Display-Transforms (AgX-Varianten, OpenDRT, JzDT, TCAM v2/v3, ACES 1.3 und 2.0, ARRI K1S1/ALF2/Reveal, RED IPP2, Sony S-Cinetone, Canon, BMD Extended Video, Khronos Neutral …) sowie die Kamera-Log-Eingänge fast aller Hersteller. Dazu kommen viele Hersteller-LUTs (`ARRI/`, `Sony/`, `Canon/`, `RWG/`, `BMD/`).

**Nützliche Inhalte (als Gegenprobe zu alwan):**
- **Log-Kurven als OCIO-`LogCameraTransform`-Parameter** (`config.ocio`): ARRI LogC3 Z. 982, LogC4 Z. 1000, BMDFilm Gen5 Z. 1018, V-Log Z. 1076, Log3G10 Z. 1094, S-Log3 Z. 1148, F-Log Z. 1238, F-Log2 Z. 1252, DaVinci Intermediate Z. 843. Beispiel S-Log3: `base 10, log_side_slope 0,255620723362659, log_side_offset 0,410557184750733, lin_side_slope 5,26315789473684, lin_side_offset 0,0526315789473684, lin_side_break 0,01125, linear_slope 6,62194371177582`.
- Canon C-Log2/3 über OCIO-Builtins (Z. 1037, 1057); Apple Log, D-Log, N-Log, ProTune und S-Log2 über 1D-LUT-Dateien (`luts/*.spi1d`, Z. 1208–1309).
- **XYZ→Kamera-RGB-Matrizen** (Z. 567–747): AWG3, AWG4, BMD WG Gen5, Cinema Gamut, V-Gamut, RWG, S-Gamut/3/3.Cine, Venice-Varianten, D-Gamut, F-Gamut, E-Gamut 1/2, DaVinci WG. Achtung: Die Matrix für „S-Gamut3.Cine“ (Z. 691) ist identisch mit „Venice S-Gamut3.Cine“ (Z. 719). Das ist wahrscheinlich ein Kopierfehler, deshalb Primaries lieber aus alwan nehmen.
- Ein **Falschfarben-View** je Display (`AgX False Color …`, Z. 139–269, LUT `luts/AgX_False_Color.spi1d`).
- Die Liste der **Display-Ziele** (sRGB, Display P3, Rec.1886, AdobeRGB, Rec.2020, Rec.2100 PQ 1000, Z. 107–284) eignet sich als Vorlage für die Display-Farbraum-Auswahl.

**Übernehmbar:** nein (keine Lizenz, fremde Hersteller-LUTs). Die Parameter sind Herstellerfakten und dienen hier nur zum Abgleich der alwan-Werte.

---

## 6. aces-aswf/aces-core (Apache 2.0, 01.09.2026)

**Zweck:** CTL-Kernbibliothek für ACES 2.0: Tonescale, Chroma- und Gamut-Kompression des Output Transforms, Display-Encoding, Farbraum-Utilities. **Nicht enthalten:** IDTs, ACEScct/ACEScc und fertige ODT-Dateien. Die liegen in den Schwesterrepos (`aces-input-and-colorspaces`, `aces-output`). Laut `CHANGELOG.md` wurde in 2.0 die LogC4-Matrix korrigiert.

**Nützliche Inhalte:**
- **AP0 und AP1** (`lib/Lib.Academy.OutputTransform.ctl` Z. 14–36): AP0 R 0,73470/0,26530, G 0,0/1,0, B 0,0001/−0,0770; AP1 R 0,713/0,293, G 0,165/0,830, B 0,128/0,044; Weiß jeweils 0,32168/0,33767 (D60-ähnlich). Die Matrizen AP0↔AP1 werden dort aus den Primaries berechnet. LZ Scopes kann sie mit dem vorhandenen `rgbToXyzMatrix` ebenso ableiten.
- **Bradford und CAT02** (`Lib.Academy.ColorSpaces.ctl` Z. 43–53) sowie der Von-Kries-CAT und RGB→RGB mit Weißanpassung (Z. 55–125). Das fehlt LZ Scopes, sobald Gamuts mit anderem Weißpunkt als D65 dazukommen (ACES, DCI-P3, Cinema Gamut).
- **ACES-2.0-Tonescale** (`Lib.Academy.Tonescale.ctl` Z. 30–96): n_r = 100, g = 1,15, c = 0,18, c_d = 10,013, w_g = 0,14, t_1 = 0,04, r_hit 128 … 896. Vorwärts: `f = m_2·(x/(x+s_2))^g`, `h = f²/(f+t_1)`, Ausgabe `h·n_r` in cd/m². Die Kurve ist geschlossen darstellbar und damit gut als Referenzlinie in der Waveform nutzbar.
- **Output-Transform-Konstanten** (`Lib.Academy.OutputTransform.ctl` Z. 61–90): L_A = 100, Y_b = 20, Surround {0,9; 0,59; 0,9}, Chroma-Compress 2,4 / 3,3, Expand 1,3 / 0,69 / 0,5, Compression-Threshold 0,75; dazu CAM16-Primaries (Z. 928–932) und eine Cusp-Tabelle mit 360 Hue-Stützstellen. Ein vollständiger ACES-2.0-ODT ist aufwendig (Tabellenbau, Iterationen). Im Browser besser als vorab gebackene 3D-LUT oder über alwan umsetzen.
- **Display-Encoding** (`Lib.Academy.DisplayEncoding.ctl`): `moncurve` (sRGB-artig, Z. 39–97), BT.1886 (Z. 100–147), SMPTE↔Full Range mit 64/1023 und 940/1023 (Z. 149–185), PQ-Konstanten (Z. 188–194, identisch mit LZ Scopes), PQ↔HLG über 1000 cd/m² mit Systemgamma 1,2 (Z. 251–330).

**Übernehmbar:** ja, mit Apache-2.0-Hinweis (LICENSE beilegen, Änderungen kennzeichnen).

---

## 7. baldavenger/DCTLs (GPL-3.0, 25.06.2021)

**Zweck:** Sammlung von DaVinci-Resolve-DCTLs (Technical Transforms, Charts, Convolution, OFX-Spielereien). Es gibt keine eigene Log-Sammlung aller Hersteller. Enthalten sind nur LogC3, Log3G10, D-Log, C-Log (v1), Cineon und ACES 1.x.

**Nützliche Inhalte:**
- **Scopes in DCTL**: `DCTL_OFX/Waveform_OFX.dctl` Z. 3–13 mit Parade/Luma/R/G/B/RGB/YRGB, Anzeige als Scope, Overlay oder **Box** (ROI-Rahmen) und Dichte/Gain/Min/Max. Weitere: `Charts/Waveform_*.dctl` (Waveform mit Zoom und Markierungen), `DCTL_OFX/Zebra_Stripes_OFX.dctl` Z. 3–7 (Zebra mit Peak White 940 / Black 64 in 10-bit-Codes), `DCTL_OFX/Map_to_3D_Cube_OFX.dctl` und `sRGB_CIELab_Cube_OFX.dctl` (Pixel als **3D-Würfel in RGB bzw. CIELab** mit Rotation, Zoom und Dichte).
- **Testbilder**: `Charts/Macbeth_ColorChecker_Chart.dctl` Z. 3–26 (24 Felder als 8-bit-sRGB), Hue- und Sat-Rampen, lineare Rampe.
- **Log-Formeln** (Herstellerfakten): LogC3 EI 800 `LogC_to_Linear.dctl` Z. 7 (identisch mit alwan); Log3G10 `Log3G10_to_Lin.dctl` Z. 5–7; D-Log `Dlog_Dgamut.dctl` Z. 70–85 (Schnitt 0,14 bzw. 0,0078, `(10^(3,89616·x − 2,27752) − 0,0108)/0,9892`); C-Log v1 `Inverse_Rec709_to_Clog_P3D65.dctl` Z. 301–313; Cineon 685/300 mit Schwarz 0,0108 in `Cineon_to_sRGB.dctl` Z. 5–7.
- **Matrizen**: AWG3→Rec.709 `AWG_to_Rec709.dctl` Z. 5–7, D-Gamut und AP0/AP1 sowie D60↔D65-CAT in `Dlog_Dgamut.dctl` Z. 10–29, RWG→XYZ `RedWideGamutRGB_to_XYZ.dctl` Z. 8–10.
- **ICtCp** aus linearem Rec.2020: `Linear_Rec2020_to_ICTCP.dctl` Z. 4–34, mit den BT.2100-Ganzzahlmatrizen /4096 (LMS: 1688, 2146, 262 / 683, 2951, 462 / 99, 309, 3688). Das ist die Grundlage für ΔE ITP.
- Full↔Legal: `Utility/Full_2_Legal.dctl` Z. 6–8 (876/1023 und 64/1023).

**Übernehmbar:** nein (GPL). Ideen: 3D-RGB/Lab-Würfel, Waveform-Box, Zebra in Codewerten. Die Normwerte (ICtCp, Legal Range) stehen in BT.2100 bzw. BT.709.

---

## 8. djieff/prism (MIT, 01.08.2026)

**Zweck:** Kein Farbscope, sondern ein schlanker **OCIO-Bildbetrachter** (PySide6, OpenColorIO, OpenImageIO) zum Prüfen von Transforms. Name: „Pipeline Review and Image State Monitor“.

**Funktionen (README):** A/B-Vergleich mit **Split, Wipe, Full und Diff** (Graustufen-Absolutdifferenz); je Bild eigene OCIO-Ein- und Ausgabe plus Look; Pixel-Probe im HUD; Belichtungsregler; OCIO-Kontextvariablen live; Waveform- und Vectorscope-Fenster; **LUT-Inspektor**.
- **LUT-Inspektor:** lädt `.cube`, `.spi1d`, `.csp`, `.spi3d`, `.lut`, `.3dl` (`src/prism/io/lut/loader.py` Z. 60–230). Er meldet Stützstellen, Min/Max, Werte außerhalb des Bereichs und Monotonie (`core/lut/analysis.py`). Kurven werden auf der Neutralachse R=G=B gezeigt. **Volumenansicht** der 3D-LUT als Punktwolke, isometrisch oder als RG/RB/GB-Ebene, wahlweise „Output cloud“ oder „Source lattice“, mit Neutralachse und Dezimierung großer LUTs.
- **Waveform-Glättung:** Gaußfilter σ = (0,5; 0,5) auf der Dichte, dann gemeinsame Normierung aller vier Kanäle (`core/scopes/waveform_science.py` Z. 15, 48–108). Luma-Koeffizienten kommen aus colour-science (BT.709/BT.2020).

**Übernehmbar:** ja (MIT). Interessant sind der LUT-Parser als Vorlage, das A/B-Diff sowie die Wipe-Idee für „Signal vs. Monitor-Transform“ und die LUT-Volumenansicht.

---

## 9. eoyilmaz/displaycal-py3 (GPL-3.0, 29.07.2026)

**Zweck:** Python-3-Fortführung von DisplayCAL, der Oberfläche für **ArgyllCMS**. Sie deckt Display-Kalibrierung, Profilierung, Verifikation, Uniformität, 3D-LUT-Erzeugung für Video (Resolve, madVR, eeColor, Prisma) und Farbmessgeräte-Korrekturen ab. Das Repo ist groß (`DisplayCAL/worker.py` allein 19 219 Zeilen).

**Lizenz:** GPL-3.0 (`LICENSE.txt`). Für LZ Scopes gilt: **Code nein. Formeln, Normwerte, Abläufe, Dateiformate und Protokolle ja**, sofern neu umgesetzt. Die ArgyllCMS-Werkzeuge selbst (AGPL/GPL) dürfen als **eigenständige Programme aufgerufen** werden, ohne dass LZ Scopes GPL wird (getrennte Prozesse, Kommunikation über Argumente und Dateien). So macht es DisplayCAL selbst.

### Messgeräte und Ansteuerung
- Alles läuft über Argyll-Kommandozeilenprogramme. **`dispcal`** kalibriert (erzeugt `.cal`, Grauachse), **`dispread`** misst Testfeldsätze (`.ti1` → `.ti3`), **`spotread`** macht Einzelmessungen (Uniformität: `spotread -v -e -T`, `worker.py` Z. 3399–3413). **`colprof`** erstellt das Profil, **`collink`** die Gerätelinks und 3D-LUTs (`worker.py` ab Z. 4857), **`targen`** die Testfelder.
- Gemeinsame Messargumente (`worker.py` Z. 2761–2847): `-d` Display bzw. `-dweb`/`-dmadvr`, `-c` Port, `-y` Messmodus (LCD/Refresh/…), `-Z` Quantisierung, `-P` Messfenster-Größe/-Position, `-YA` und `-YR:60` (Refresh-Einstellungen), `-V` adaptiv, `-I` Drift-Kompensation.
- **Gerätetabelle** (`argyll_instruments.py` Z. 57–457): DTP92/94, i1 Display 1/2, **i1 Display Pro / ColorMunki Display**, i1 Pro 1/2/3, ColorMunki, ColorHug 1/2, **Spyder 1–5, SpyderX, SpyderX2, Spyder 2024**, Huey, K-10, JETI **specbos** (auch 1201) und **spectraval**, HCFR, EX1, dazu Dummy-Geräte. Pro Gerät ist hinterlegt, ob es Spektrometer ist und ob es CCMX/CCSS nutzen kann (Sonderfälle in `worker.py` Z. 3425 ff.).

### Korrekturen für Colorimeter
- **CCMX**: eine 3×3-Matrix Colorimeter→Referenzspektrometer für einen Displaytyp (Vorlage `ccmx.py` Z. 9–25 mit INSTRUMENT, DISPLAY, REFERENCE). **CCSS**: spektrale Stichproben des Displays, damit Geräte mit bekannter Spektralempfindlichkeit (i1 Display Pro, Spyder4+) selbst korrigieren können. Erzeugung und Verwaltung in `colorimeter_correction.py`, 2D-Plot in `wx_ccxx_plot.py`. Für LED-Wände mit schmalbandigen LEDs ist das zentral (siehe `docs/research/led-wall-und-messgeraete.md`).

### Messablauf und Einstellungen (Voreinstellungen aus `config.py`)
- **Warm-up:** Hinweis „mindestens **30 Minuten**“ vor der Messung, Gerät bei Kontaktmessung schon auflegen (`lang/en.yaml` Z. 1459–1460). Zusätzlich gibt es **Drift-Kompensation**: periodisch ein Schwarz- bzw. Weißfeld gegen die Erwärmung von Messgerät bzw. Display (Z. 1050–1057).
- Timing: `measure.min_display_update_delay_ms` = 20 ms (Bereich 20–60 000), `measure.display_settle_time_mult` = 1,0 (Z. 1731–1738, Bereiche Z. 1420–1421). Optional schwarzer Hintergrund (`measure.darken_background`).
- **Patchreihenfolge** (Z. 1535–1541, Standard Z. 1980): `optimize_display_response_delay`, `maximize_lightness_difference`, `maximize_rec709_luma_difference`, `maximize_RGB_difference`, `vary_RGB_difference`.
- **APL-Steuerung für Displays mit automatischer Helligkeitsbegrenzung** (OLED, LED-Wand): `patterngenerator.apl` = 0,22 (Hintergrundpegel, damit die mittlere Bildhelligkeit konstant bleibt) und **Full-Field-Pattern-Insertion** (Z. 1744–1749: Dauer 5 s, Intervall 5 s, Pegel 0,15).
- **Untethered-Modus**: Der Patterngenerator wird nicht von DisplayCAL gesteuert. Der Nutzer schaltet die Felder selbst, das Programm erkennt den Wechsel an der Messung und schaltet weiter. Kriterium (`wx_untethered_frame.py` Z. 665–681, Voreinstellungen `config.py` Z. 1992–1996): neuer Messwert gilt als neues Feld, wenn ΔE > 1,5 zum letzten, oder |ΔL| > 1,0 bei |ΔC| < 0,5; manuelle Verzögerung 0,75 s.

### Testfeldsätze
- Format CGATS `.ti1` (Kopf mit Keywords, Datenblock `SAMPLE_ID RGB_R RGB_G RGB_B XYZ_X XYZ_Y XYZ_Z`, RGB in %). Beispiel `DisplayCAL/ref/verify_video.ti1`.
- **Verifikation** (`DisplayCAL/ref/`, Anzahl laut `NUMBER_OF_SETS`): `verify` 26, `verify_extended` 51, `verify_video` 47, `verify_video_extended` 81, `verify_grayscale` 41, `verify_large` 325, `verify_video_large` 335, `verify_xl` 490, `verify_video_xl` 485, bis `xxxl` 989/1005. **HDR:** `verify_video_extended_smpte2084_{100,200,500,1000}_p3_2020` und `…_hlg_p3_2020` mit je 81 Feldern. Normen: `ISO_12646-2008_color_accuracy_and_gray_balance` 141 und `ISO_14861_color_accuracy_RGB318` 318.
- **Profilierung** (`DisplayCAL/ti1/`): Namensschema `d3-e4-sN-g52-mN` (Grau 52 Stufen, Würfel N³). Größen 34, 79, 115, 175, 778 und 4954 Felder.
- Referenzfarbräume als ICC (`ref/`): Rec2020_2084, Rec2020_HLG1000, SMPTE431_P3_D65(_2084/_HLG1000), ACES, ACEScg, DCDM X′Y′Z′, SMPTE240M.

### Zielwerte
- Weißpunkt: Farbtemperatur (1000–15 000 K, Standard 6500, Daylight- oder Planck-Ort `t`/`T`) oder xy (Standard 0,3127). Leuchtdichte Standard 120 cd/m² (`calibration.luminance`, Bereich 20–100 000) (`config.py` Z. 1633, 2002–2010, 1436, 1547).
- Tonwertkurve `trc`: Gamma (Standard 2,2; relativ `g` oder absolut `G`), `240` (SMPTE 240M), `709`, `l` (L*), `s` (sRGB) (Z. 1542–1543, 1983).
- **Schwarzpunkt:** `calibration.black_output_offset` 1,0, `black_point_correction` 0,0, `black_point_rate` 4,0 (Z. 1618–1627). Für die 3D-LUT: `3dlut.trc` = BT.1886 mit Gamma 2,4, Typ `B` (absolut), Output-Offset 0,0 (Z. 1570–1574). Die BT.1886-Umsetzung mit Schwarzpunkt-Mischung und Input/Output-Offset ist aus ArgyllCMS `xicc.c` übernommen (`colormath.py` Z. 5854 ff.).

### 3D-LUT-Erzeugung
- Formate (`config.py` Z. 1450–1461): `3dl`, **`cube`** (Standard), `dcl`, `eeColor`, `icc`, **`madVR`**, `mga`, `png`, `ReShade`, `spi3d`. Größen 5, 9, 16, 17, 24, 32, **33**, 64, **65** (Standard 65, Z. 1466/1599). Bittiefe 8–16. Ein-/Ausgangscodierung Full/Video (Z. 1447–1449). Rendering-Intent Standard `aw` (Z. 1597). Resolve und IRIDAS erwarten `.cube`; für `.3dl` ist 17er-Größe typisch (`config.py` Z. 379–391).
- Erzeugt wird die LUT mit Argyll `collink` aus Quellfarbraum (z. B. Rec.709/BT.1886) und gemessenem Displayprofil.

### Testfeld-Anzeige (Patterngenerator)
`patterngenerators.py`:
- **DaVinci Resolve** (Z. 806–930): DisplayCAL ist TCP-**Server** auf Port **20002**, Resolve verbindet sich als Client (Resolve: „Monitor Calibration“). Jede Nachricht besteht aus 4 Byte Länge (big-endian) und einem XML-Block. Variante „CM“ (10 bit): `<calibration><color red= green= blue= bits=/><background …/><geometry x= y= cx= cy=/></calibration>`. Variante „LS“ (8 bit) mit `<shapes><rectangle>…`. Pegel in Codewerten, optional Video-Pegel 16–235 (`_get_rgb`, Z. 279–310).
- **Web-Patterngenerator** (Z. 932 ff., `webwin.py` Z. 141–154): ein HTTP-Server liefert eine Seite. Der Browser holt per Long-Polling `/ajax/messages?<aktuelles Muster>` das nächste Muster als Text `vorder|hinter|x|y|w|h` (z. B. `#808080|#808080|0|0|1|1`). Damit lässt sich **jedes Gerät mit Browser** als Feldgenerator nutzen.
- **Chromecast** (`chromecast_pattern_generator.py`), **Prisma** (HTTP, Port 80), **madVR** (Netzwerk-API).

### Uniformität
- Raster 3×3, 5×5, 7×7 oder 9×9 (Standard 5×5, `config.py` Z. 1545–1546, 1989–1991). Je Feld 4 Stufen: Weiß, 192, 128, 64 (8 bit, als 100/75/50/25 % geführt; `wx_display_uniformity_frame.py` Z. 154–159). Gemessen wird per `spotread`.
- Auswertung (`report/uniformity.functions.js`): Referenz ist das Mittelfeld. Je Feld werden ΔE00 zur Referenz, Leuchtdichteabweichung in % und CCT-Abweichung berechnet. **ISO 14861:** ΔE00 ≤ 4 (nominal), ≤ 2 (empfohlen) (Z. 41–47). **Kontrastabweichung** T = |R/R_ref − 1| mit R = Leuchtdichte 50 % / 100 %, Toleranz T < 0,1 (Z. 80, 106, 133–139). Laut Kommentar ist ISO 12646:2015 dem gefolgt. Ausgabe als farbiges HTML-Raster (`report/uniformity.html`).

### Verifikationsbericht
- Kennzahlen je Metrik (`report/compare.constants.js`): Max, Mittel, Median, MAD, 95./99. Perzentil, Spannweite und Standardabweichung. Metriken: ΔE76, ΔE94, ΔE00, CMC, **ΔICtCp**, dazu ΔL/ΔC/ΔH/Δa/Δb und Gamma.
- **Grenzwerte „Default“** (`report/compare.variables.js` Z. 39–73, nominal/empfohlen): Weißpunkt gemessen vs. Ziel ΔE00 2/1; mittleres ΔE00 1,5/1; maximales ΔE00 4/3; mittleres ΔE76 3/1,5; maximales ΔE76 6/4. Z. 75–76 setzt ΔICtCp-Weißpunkt 2/1, schreibt dabei aber auf Index 25, und der ist in der Liste „Calibration red tone values“. Das ist vermutlich ein Indexfehler bei DisplayCAL, daher nicht blind übernehmen.
- Weitere Kriteriensätze: RGB, Verify, CMYK, IDEAlliance 2009/2013, ISO 12647-7, Fogra MediaWedge 3, ISO 14861 (Z. 87–293). Der Bericht bewertet Graubalance, Tonwertkurve, Gamut-Abdeckung und Kontrast (`measurement_report.py`).

---

## Priorisierte Feature-Liste für LZ Scopes

### Muss

1. **Kamera-Log-Eingänge und Kamera-Gamuts**
   - Transfer um LogC3, LogC4, S-Log3, V-Log, BMDFilm Gen5, C-Log2, C-Log3, Log3G10, F-Log2, D-Log, N-Log und Apple Log erweitern. Formeln und Konstanten aus **alwan** `core/alwan_rgb_core.inc` (MIT), gegengeprüft mit den PixelManager-OCIO-Parametern und den Herstellerpapieren.
   - Gamuts (AWG3/4, S-Gamut3(.Cine), V-Gamut, BMD WG Gen5, Cinema Gamut, RWG, DaVinci WG, ACES AP0/AP1) als Primaries aus alwan `data/rgb_spaces/*.csv` bzw. aces-core. Matrizen daraus mit dem vorhandenen `rgbToXyzMatrix`.
   - Umsetzung: Log→linear und Matrix im Fragment-Shader vor dem Scatter-Pass. Die Waveform bleibt in Codewerten, bekommt aber eine Markierung „18 % Grau“ je Kurve (berechnet als `oetf(0,18)`, keine hart kodierten Prozentwerte). Falschfarben je Log-Kurve beziehen sich auf Blenden über/unter 18 %.
   - Erweiterung in `color.ts`: `Transfer` wird zur Liste; `detectTransfer` bleibt für ffprobe, Log nur manuell (Streams taggen Log nicht).
2. **Chromatische Adaption (Bradford)** für Gamuts mit anderem Weiß als D65 (ACES D60, DCI-P3, Cinema Gamut). Matrix aus aces-core `Lib.Academy.ColorSpaces.ctl` Z. 43–47, Verfahren Z. 55–125 (Apache 2.0). Ohne sie wären AP0/AP1 und DCI im CIE-Plot verschoben.
3. **Gamut-Warnung im Bild** mit Stärke. Pro Pixel linear in den Zielgamut (z. B. Rec.709 bei 2020-Quelle) umrechnen und die Distanz `d = (max − c)/max` bilden (Idee gamut-compress, Formel frei). Ist d > 1, wird eingefärbt, mit Abstufung nach Überschreitung. Zusätzlich im CIE-Plot: Punkte außerhalb des Zieldreiecks rot. Das ist billig im Shader.
4. **CIE 1976 u′v′** als zweite Ansicht des CIE-Panels: `u′ = 4X/(X+15Y+3Z)`, `v′ = 9Y/(X+15Y+3Z)` (alwan `alwan_colorspace_core.inc` Z. 75–81). Die Spektralzug-Tabelle (`SPECTRAL_LOCUS`) wird dafür nur umgerechnet, Sichtbereich wie im Plotter `[−0,05; 0,65]`.
5. **ΔE-Auswertung am Messpunkt / an Referenzfeldern**: ΔE2000 für SDR, **ΔE ITP** (BT.2124, Faktor 720) für HDR. Quelle alwan Z. 332–337 bzw. ab 426 (MIT). Voraussetzung für Sequenzer und Report.

### Soll

6. **Messfeld-Sequenzer** (aus DisplayCAL abgeleitet, eigene Umsetzung):
   - Testfeldsätze als CGATS-`.ti1` lesen (Format ist offen, Dateien selbst erzeugen) oder eigene Sätze: Graukeil 0–100 % in 5/10-%-Schritten, Primär- und Sekundärfarben 75/100 %, ColorChecker, HDR-PQ-Stufen. Die Feldanzahl orientiert sich an DisplayCAL (Video 47, Extended 81, HDR 81).
   - Das Ausgabefenster (`?out=`) schaltet die Felder selbst durch. Einstellbar sind Feldgröße (Fenster %, wie `-P`), **APL-Hintergrund** (DisplayCAL 0,22) und optional Full-Field-Insertion gegen ABL. Zeiten: Mindestverzögerung plus Einschwingzeit.
   - Messwerte manuell eingeben (XYZ oder xyY + cd/m²) oder per Messgerät einlesen: über Argyll `spotread` als separaten Prozess in der Bridge (keine Lizenzbindung) oder direkt (siehe LED-Wand-Recherche).
   - **Untethered-Automatik** wie DisplayCAL: Feldwechsel erkennen, wenn ΔE > 1,5 zum letzten Messwert (oder |ΔL| > 1 bei |ΔC| < 0,5). Damit funktionieren auch externe Generatoren und Wände ohne Steuerverbindung.
   - Warm-up-Hinweis (30 min) und optional periodisches Weiß- und Schwarzfeld zur Driftkontrolle.
7. **Verifikationsreport**: Tabelle je Feld (Soll-XYZ, Ist-XYZ, ΔE00/ΔITP, ΔL/ΔC/ΔH), Kennzahlen Mittel/Max/Median/95. Perzentil, Ampel nach nominal/empfohlen. Grenzwerte als Konfiguration, Startwerte aus DisplayCAL „Default“ (Mittel ΔE00 1,5/1, Max 4/3, Weißpunkt 2/1). Dazu Graukurve (gemessenes Gamma bzw. EOTF gegen BT.1886/PQ), Weißpunkt-CCT und Duv, Kontrast. Export als HTML/PDF.
8. **Uniformitätskarte**: Raster 3×3 bis 9×9 im Ausgabefenster nacheinander aufleuchten lassen, Stufen 100/75/50/25 %. Heatmap über ΔE00 zur Mitte, Leuchtdichte in % und CCT; Bewertung nach ISO 14861 (ΔE00 ≤ 4 / ≤ 2, Kontrastabweichung T < 0,1). Für LED-Wände das Raster auf Kabinett- oder Modulgrenzen legen (Abstimmung mit `led-wall-und-messgeraete.md`).
9. **Double-Diamond-Scope** (Idee scopes_plusplus, Formeln trivial) als Gamut-Prüfung auf R′G′B′-Ebene; passt zum vorhandenen Scatter-Renderer.
10. **Schwarz-Lupe** (RGB-Blacklevel-Waveform: untere ~14 % gespreizt) und eine **Legal/Illegal-Prüfung** auf Y′CbCr-Ebene (README „Grenzen“). Dafür muss die Bridge 16–235 bzw. 64–940 nicht abschneiden.
11. **LUT laden und anwenden** (Monitor-LUT/Look im Bildpanel): `.cube` zuerst, dann `.3dl`/`.spi3d`. Parser-Vorlage prism `io/lut/loader.py` (MIT). In WebGL2 als 3D-Textur mit trilinearer Filterung.

### Kann

12. **Gamut-Compression-Vorschau**: ACES-1.3-RGC (alwan, MIT: Limits 1,147/1,264/1,312, Schwellen 0,815/0,803/0,880, Power 1,2) als Vorschau-Schalter im Bildpanel, dazu Gamut-Warnung vorher und nachher.
13. **ACES in der Bildansicht**: IDT = Log→linear + Matrix (Punkt 1 und 2) nach AP0/AP1. Ausgabe über ACES-2.0-Tonescale (aces-core `Tonescale.ctl` Z. 30–96, geschlossen darstellbar) als Referenzkurve. Den vollständigen 2.0-ODT (JMh, Cusp-Tabellen) besser als vorab gebackene 3D-LUT laden (Punkt 11) statt ihn im Shader nachzubauen.
14. **3D-Farbwürfel / Gamut-Volumen**: Pixel als Punktwolke im RGB-Würfel oder in CIELab/ICtCp, drehbar, mit Zielgamut als Drahtgitter. Ideen: DCTLs `Map_to_3D_Cube`, `sRGB_CIELab_Cube`, prism LUT-Volume. Der Scatter-Renderer kann das mit einer zusätzlichen Projektionsmatrix.
15. **HDR-Kennzahlen**: MaxCLL/MaxFALL laufend (alwan `docs/api/hdr.md`) und BT.2390-EETF als „so sieht es auf einem 1000-nit-Display aus“ (alwan `alwan_hdr_core.inc` Z. 232–275).
16. **A/B-Vergleich** (prism): Split/Wipe/Diff zwischen zwei Quellen oder Signal gegen LUT.
17. **Patterngenerator für Resolve spielen**: LZ Scopes (Bridge) als TCP-Client zu einem Kalibrierprogramm oder umgekehrt als Server auf Port 20002, damit Calman oder DisplayCAL Felder in LZ Scopes anzeigen lassen können. Protokoll: 4-Byte-Länge + XML (siehe Abschnitt 9). Alternativ das Web-Long-Poll-Protokoll von DisplayCAL, damit DisplayCAL/Argyll (`-dweb`) das Ausgabefenster direkt ansteuern kann.
18. **Weitere Falschfarben-Presets** (RED, Sony) und eine Anzeige in Blenden relativ zu 18 %, nach Herstellerhandbuch.

## Offene Fragen

1. Unter welcher Lizenz soll LZ Scopes erscheinen? Davon hängt ab, ob GPL-Code (DisplayCAL, DCTLs, scopes_plusplus) je in Frage kommt. Vorschlag: MIT/proprietär bleiben, Formeln nur aus alwan (MIT) und aces-core (Apache).
2. Soll alwan als WASM-Modul eingebunden oder sollen die benötigten Kernel nach TS/GLSL portiert werden? Portieren ist schlanker, WASM ist näher an der geprüften Referenz.
3. Messgeräte: Argyll `spotread` als externer Prozess der Bridge (kein Lizenzproblem, deckt alle Geräte ab) oder eigene USB/HID-Treiber? Abgleich mit `led-wall-und-messgeraete.md`.
4. Welche Testfeldsätze sind Pflicht (SDR-Video 47/81, HDR-PQ 1000, ColorChecker)? Die DisplayCAL-`.ti1`-Dateien sind GPL-verteilt; die Feldwerte selbst sind Normfakten, die Dateien sollten aber neu erzeugt werden.
5. Soll die Bridge Sub-Black und Super-White durchreichen (Voraussetzung für Legal-Prüfung und Schwarz-Lupe)?
6. Die ΔICtCp-Grenzwerte in DisplayCAL scheinen falsch indiziert. Welche Toleranzen gelten für HDR-Verifikation (Quelle: BT.2124, ggf. Netflix/EBU-Vorgaben)?
7. PixelManager: Die S-Gamut3.Cine-Matrix gleicht der Venice-Variante. Vor Nutzung gegen Sony-Primaries prüfen (alwan: 0,766/0,275, 0,225/0,800, 0,089/−0,087).
8. Braucht es einen vollständigen ACES-2.0-ODT live, oder reichen gebackene LUTs aus Resolve/OCIO?

---

## Umsetzung Rest von Issue #8 (30.09.2026)

| Punkt | Quelle (geöffnet) | Umsetzung |
|---|---|---|
| Double Diamond | Formeln oben (scopes_plusplus, nur Idee), neu geschrieben | Scope „Double Diamond“: oben G/B, unten G/R, Schwarz in der Mitte, Weiß an den Spitzen; ohne den Tiefpass der Hardware-Geräte |
| Falschfarben ARRI | ARRI ALEXA Mini LF User Manual, „Exposure Tools; False Color“, S. 83 (über manualshelf.com) | Werte des bestehenden Presets bestätigt (0–2,5 / 2,5–4 / 38–42 / 52–56 / 97–99 / 99–100 %) |
| Falschfarben RED | docs.red.com, DSMC2 DRAGON-X Operation Guide v7.4, „False Color Modes: Video“ | neues Preset, 9 Zonen in IRE; RED wertet die RGB-Pegel des Video-Ausgangs, LZ Scopes die Luma → für bunte Flächen Näherung |
| Falschfarben Sony | VENICE-Handbuch: Tabelle nur als Bild, PDF-Download vom Skript aus blockiert | **kein Preset** (nicht belegbar) |
| ACES 1.3 RGC | alwan @ 8fc3044 (MIT): `src/alwan/api/alwan_aces_ff.c` Z. 426–434, 470–484; `src/alwan/core/alwan_aces_ff_core.inc` Z. 216–282 | Vorschau im Bild-Panel (in ACEScg), wirkt auch auf die Gamut-Warnung; nicht auf die Scopes |
| MaxCLL/MaxFALL | alwan `docs/api/hdr.md` Z. 66–96 | Messwerte-Panel: MaxCLL und FALL des Bildes, Maxima seit Start der Quelle; gemessen am Analysebild (unterabgetastet), nur CPU-Statistikpfad |
| A/B | prism (Idee Split/Wipe/Diff) | Bild-Panel: Split 50 %, Wipe, Differenz (max |A − B| der angezeigten Bilder × Verstärkung); B = anderer Messpunkt derselben Quelle oder andere Quelle |
| ACES-2.0-Ansicht | aces-core Tonescale (schon in chain.ts) | keine neue Ansicht: die CST mit Tone-Mapping „ACES-2.0-Tonescale“ ist die Ansicht über die vorhandene Kette. Vollständiger ODT (JMh, Cusp-Tabellen) nicht umgesetzt – besser als gebackene LUT laden |
| 3D-RGB-Würfel | – | nicht umgesetzt (Kann) |
