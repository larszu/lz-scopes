# Farbziele, Farbabgleich und Grün-Qualifier (#55)

Stand 06.10.2026. Nur geöffnete Quellen; was nicht belegt ist, steht als „offen“.

## Wie andere es lösen

| Produkt | Was es kann | Quelle |
|---|---|---|
| DaVinci Resolve, Color Match | Abgleich auf drei Kartentypen (X-Rite ColorChecker, Datacolor SpyderCheckr, DSC OneShot): Source Gamma, Target Gamma/Color Space, Target Color Temp, Target White Level; Felder per Overlay einpassen, „Match“. Abweichung je Feld in **Prozent**, nicht ΔE. Eine freie Zielfarbe kommt nicht vor | Colorist Reference Manual, Kap. 11, „Color Match Palette“, S. 500–503 (Auszug, DSC Labs: static.webshopapp.com/…/dsc-labs-color-match-palette.pdf) |
| Nobe OmniScope | Color Picker mit RGB, RGBY, Nits (PQ), HEX, CMYK, HSV; mehrere feste „Color pins“; „Custom Targets“ (ohne Details); SkinTone-Scope; Snapshots für Referenzabgleich. ΔE wird nicht genannt | timeinpixels.com/nobe-omniscope (Feature-Liste) |
| Sony HDC | USER MATRIX = klassische Matrix; **MULTI MATRIX** = 16-Achsen-Farbkorrektor für eine gewählte Farbe (Hue und Saturation) | Sony HDC-25 Series Technical Information, S. 18 (manualslib) |

Offen: Resolve-HSL-Qualifier im Handbuch, Panasonic/Grass-Valley-Begriffe, Calman-Toleranzen.

Daraus gebaut: Ziel als freie Farbe (fehlt bei Resolve), ΔE und Prozentwerte zugleich, Korrektur als Farbton/Sättigung je Farbachse (Multi-Matrix-Logik), Referenz entweder Ziel oder zweite Kamera.

## CI-Farben: sRGB-Hex und Rec.709-Video

- sRGB (IEC 61966-2-1) und BT.709 haben **dieselben Primaries und D65**. Die Kurve unterscheidet sich: sRGB stückweise (≈ 2,2), Video BT.1886 γ 2,4 (Wikipedia „sRGB“, Transfer function und Vergleich mit Rec. 709).
- Legal Range: D = Round[(219·E′ + 16)·2^(n−8)] (BT.2100-3, Tab. 9; schon in ebu-video.md).
- **Entscheidung:** Zwei Lesarten, wählbar je Ziel.
  - *Videowert* (Standard): #RRGGBB/255 = R′G′B′ 0…100 %, also 0 → 16, 255 → 235. So landet eine Grafik mit diesem Hex im Mischer bzw. in Resolve; auf einem 709-Monitor sieht sie aus wie auf einem sRGB-Monitor mit Gamma-Unterschied.
  - *sRGB-Licht*: Die Farbe, die ein sRGB-Monitor zeigt; das Signal ist BT.1886-invers dazu. Das hebt die Schatten an, z. B. Codewert 0,5 → Signal 0,526.
  - Für HDR- und andere Quellen wird über Licht umgerechnet: 1,0 = Referenzweiß, also PQ 58 % und HLG 75 % (BT.2408, getestet).
  - Bei Log gilt der Videowert als Rec.709-Kamerasignal (BT.709-OETF invers, wie die Log-Balkenziele). Das ist eine Näherung und wird in der UI so benannt.
- Logo-Pipette: Der Browser wandelt eingebettete Profile nach sRGB, gepickt wird der sRGB-Codewert. Transparente Pixel bleiben unberücksichtigt.
- **Pantone/CMYK:** Keine Umrechnung. Eine frei verwendbare Pantone→sRGB-Tabelle wurde nicht geprüft (offen), und eine eigene Umrechnung wäre geraten. Der Nutzer trägt die vom Kunden genannten RGB-/Hex-Werte ein.

## Farbabstand und Korrekturrichtung

- ΔE00 (SDR, Log) bzw. ΔITP (PQ, HLG) wie bisher (src/deltae.ts).
- ΔL′, ΔC′ und ΔH′ = 2√(C1C2)·sin(Δh/2) nach der CIEDE2000-Definition (Wikipedia „Color difference“, Abschnitt CIEDE2000). Angezeigt werden die CIELAB-Werte.
- Ampel:
  - ≤ 1: grün. Die ΔE-Formeln sind so ausgelegt, dass 1,0 einem eben merklichen Unterschied entspricht (Wikipedia „Color difference“). Einschränkung derselben Quelle: Für CIE76 wurde das auf 2,3 korrigiert.
  - Bis zur Toleranz (Standard 3, das ist das DisplayCAL-Maximum „empfohlen“, siehe colour-repos.md): gelb.
  - Darüber: rot.
  - Für ΔITP ist kein Grenzwert belegt. Die Stufen gelten dort gleich und sind in der UI als „nicht belegt“ gekennzeichnet.
- Korrektur in Vectorscope-Begriffen der Quelle:
  - Farbton ±° (gegen bzw. im Uhrzeigersinn, Richtung nächster Balkenfarbe)
  - Sättigung ±% (|CbCr|-Verhältnis)
  - Helligkeit ±% (Y′-Verhältnis)
- Kamera-Begriffe:
  - Multi-Matrix bzw. Farbkorrektur der nächsten Farbachse: Phase und Sättigung.
  - Bei neutralem Ziel (Graukarte): Weißabgleich mit R-/B-Gain relativ zu G, linear.
  - Resolve: Qualifier, Hue, Sat bzw. Hue-vs-Hue-/Hue-vs-Sat-Kurve.
- Kameraabgleich: Die Referenzquelle wird über Licht in die Codierung der zu korrigierenden Quelle umgerechnet. Bei verschiedener Log-Kurve und Display-Kurve ist das nur eine Näherung.

## Effektlacke (Metallic, Perl)

- ASTM E2194-14(2021) misst Metallic-Lacke unter **drei Winkeln** und gilt **nicht** für Perl- und Interferenzpigmente (dafür E2539). Gleiche Werte unter drei Winkeln garantieren keinen visuellen Abgleich, wenn Glanz, Orange Peel, Textur oder Flake-Ausrichtung abweichen (store.astm.org/e2194-14r21.html, Scope und Significance).
- Umsetzung:
  - über einen Messrahmen messen (Mittel)
  - mehrere Stellen bzw. Kamerawinkel als *Messreihe* sammeln
  - angezeigt werden das Mittel und die Streuung (ΔE jeder Messung zum Mittel)
- Die konkreten Winkel (15°/45°/110°) und DIN 6175-2 sind offen. Eine Kamera misst ohnehin keinen definierten Beleuchtungswinkel.

## Grün-/Rasen-Qualifier

- **Pegel:** BT.2408-8 Tab. 2, Rasen HLG 40–55 %, PQ 40–45 % (ebu-video.md). Für SDR gibt es keinen Normwert.
  - Standard ist 40–55 %, die Vorgaben stehen zur Wahl.
- **Farbton:** ColorChecker-Felder (Wikipedia „ColorChecker“, Abschnitt Colors, Herstellerwerte sRGB)
  - „Foliage“ #576C43 = 87/108/67 → 205,5° im Rec.709-Vectorscope
  - „Yellow green“ #9DBC40 = 157/188/64 → 189,5°
  - **Standard 198° ± 20°**, beide Felder liegen sicher im Keil (getestet).
  - „Bereich aus Messrahmen“ setzt den Farbton auf den sättigungsgewichteten Kreismittelwert und den Luma-Bereich auf das 5.–95. Perzentil.
- Shader: Der Hautton-Keil hat jetzt einen Mittelpunkt (uSkin.w). Die Waveform „Grüntöne“ und das Overlay „Grüntöne“ nutzen denselben Pfad mit den Grün-Parametern.

## Tests

`test/colormatch.test.ts`:

- Eingabeformate
- Legal-Codes nach BT.2100
- sRGB-EOTF(0,5) = 0,2140
- Weiß → PQ 58 % und HLG 75 % (BT.2408)
- Rundweg Signal ↔ CI
- Rotation, Sättigung und Luma werden wiedererkannt
- Weißabgleich bei neutralem Ziel
- Farbfelder fürs Display
- ColorChecker-Grün im Keil

`e2e/match.spec.ts`: Messpunkt auf dem 75-%-Gelbbalken erscheint als Farbfeld im Panel.

## Ungeprüft

- Kameraabgleich mit zwei echten Kameras und Effektlack am Objekt: keine Hardware im Test.
- P3-Farbfelder: nur rechnerisch geprüft, nicht mit einem Messgerät.
