# UI-Farben für farbkritische Arbeit

Frage: Welche Farbe soll die Bedienoberfläche von LZ Scopes haben, wenn daneben Bild und Messdarstellung beurteilt werden? Daraus folgen die drei Varianten („Oberfläche“ im ⚙-Menü) und der Standard.

Stand 30.09.2026. Genannt sind nur Quellen, die für diese Notiz tatsächlich geöffnet wurden.

## Geöffnete Quellen

| Quelle | Aussage |
|---|---|
| **Rec. ITU-R BT.2100-3**, Table 3 „Reference viewing environment for critical viewing of HDR programme material“ | Umfeld (surround) und Peripherie: **„Neutral grey at D65“**. Leuchtdichte des Umfelds **5 cd/m²**, der Peripherie ≤ 5 cd/m². Note 3a: Das Umfeld ist die Fläche um das Display, die die Adaption des Auges beeinflusst, typisch Wand oder Vorhang dahinter. |
| **Report ITU-R BT.2408-8**, § 3.2, Table 5 „Typical production environments with different surround conditions“ | Die Leuchtdichte des Umfelds verschiebt den Adaptionszustand und damit den wahrgenommenen Kontrast: Schnittraum 10 cd/m² → Gamma −0,02; Grading-Raum 5 cd/m² → 0,00; dunkler Grading-Raum 0,5 cd/m² → +0,08. Für größte Konsistenz gelten die Referenzbedingungen aus BT.2100. |
| **EBU Tech 3320 v4.1** (2019), § Black level, Note | Nennt als Standardbedingung „dim surround (15 % as in ITU-R Rec. BT.500)“. Die Leuchtdichte der Umgebung und das Streulicht auf dem Schirm bestimmen, welche Schwarzwerte noch sichtbar sind. |
| **DaVinci Resolve 21.1 Reference Manual** (Blackmagic Design, Sept. 2026, im Programmordner; Kapitel User Preferences → UI Settings, PDF-Seite ≈ 110) | „Use gray background for user interface: By default, DaVinci Resolve uses a blue-gray UI background, intended to provide a more attractive experience for users focused on the less color-critical aspects […] namely editing. Turning this checkbox on switches DaVinci Resolve to a **totally neutral, desaturated gray UI**, which can be valuable as a point of reference for colorists concerned about the blue-gray UI’s potential to **bias the eye** in the dark environment of the grading suite.“ |
| **Brand Guide 2.0** der Lars Zumpe Medienproduktion (Skill `lzm-brand`, Web-Tokens aus dem Brand Kit) | Das Web ist dunkel: Deep Navy #132040, Navy #1D324F, Off-White #F6F5F0, Stahlblau #8C9CB3. Kontrast nach WCAG 2.1: Stahlblau auf Navy 4,6:1, Tally-Rot auf Navy 2,9:1 (nur als Punkt). |

## Nicht geöffnet (offen)

- **ISO 12646** (Displays für Farbprüfung) und **ISO 3664** (Betrachtungsbedingungen): Die Seiten auf iso.org lieferten HTTP 403. Die Normen sind kostenpflichtig. Ihre Aussagen zu neutralgrauem Umfeld sind hier nicht belegt.
- **SMPTE ST 2080-3** (Referenz-Betrachtungsumgebung), **Rec. ITU-R BT.2035**, **ITU-R BT.500**: in dieser Runde nicht geöffnet. BT.500 ist nur über das Zitat in EBU Tech 3320 erfasst.
- **WCAG 2.x** im Original: nicht geöffnet, weil das Abruflimit erreicht war. Die Kontrastwerte unten sind mit der bekannten Formel (relative Leuchtdichte aus sRGB, (L1 + 0,05)/(L2 + 0,05)) gerechnet. Sie stimmen mit den Werten im Brand Guide überein, z. B. Off-White auf Navy mit 11,9:1.
- **Baselight, Nucoda, Scratch**: Handbücher nicht geöffnet. Aussagen über deren Oberflächen fehlen deshalb.

## Folgerungen

1. **Neutral statt farbig.** BT.2100 verlangt für das Umfeld ein neutrales Grau bei D65. Resolve begründet seine graue Oberfläche damit, dass eine blaugraue Oberfläche „das Auge beeinflussen“ kann. Die Oberfläche einer Messsoftware liegt im Blickfeld direkt neben Bild und Scope. Sie sollte deshalb unbunt sein. Gemessen in CIELAB (D65, sRGB):
   - Deep Navy #132040: a* = 6,6, b* = −22,1
   - Navy #1D324F: b* = −20,3
   - Stahlblau #8C9CB3: b* = −13,8
   - Die frühere Optik #111316 liegt mit b* = −2,2 fast neutral. Ihre sattgrünen Akzente #8cff9e liegen bei a* = −52, b* = +36.
2. **Dunkelgrau statt Schwarz.** BT.2100 und BT.2408 setzen für die Referenz 5 cd/m² Umfeld an, nicht 0. Auf einem Schreibtisch-Display mit 100–160 cd/m² Weiß entspricht das etwa 3–5 % Leuchtdichte. Die Variante „Neutral“ nutzt als Grund #262626 (Y 1,9 %) und für Flächen #2e2e2e (Y 2,7 %). Das ist bewusst etwas dunkler als 5 cd/m², weil die Oberfläche nur einen Teil des Blickfelds füllt und helle Flächen neben dem Scope blenden. Ohne Normbeleg ist das eine Abwägung.
3. **Gedämpfte Akzente.** Aktive Schaltflächen sind hellgrau, nicht farbig. Die einzigen bunten Elemente der Oberfläche sind die 8-px-Statuspunkte der Quellen (verbunden, verbindet, Fehler). Sie sind entsättigt: a*/b* höchstens etwa 35, statt bis 52 in der Variante „Original“.
4. **Kontrast.** Text #d6d6d6 auf #2e2e2e ergibt 9,3:1, Nebentext #a8a8a8 auf #2e2e2e 5,7:1. Beides liegt über 4,5:1. Die Werte sind in `test/theme.test.ts` geprüft, ebenso R = G = B für alle Grautöne der Variante.
5. **Messdarstellungen bleiben unverändert.** Spuren, Graticule, Falschfarben, Gamut-Farben, ROI-Gelb und das Grün/Rot der Selbsttests gehören zu keiner Variante. Der Scope-Hintergrund `--scope-bg` (#0b0c0e, gleich dem WebGL-clearColor; b* = −1,0) ist in allen Varianten derselbe. Die Ausgabefenster behalten ihren schwarzen Grund, weil sie Signal ausgeben. Nur die Einblendungen (HUD, Szenen-Leiste) folgen der Variante.
6. **Logo.** Das Signet „lz.“ steht in jeder Variante. „Neutral“ zeigt es weiß (#FFFFFF, unbunt), „LZM“ und „Original“ in Off-White. Beides sind Farbvarianten aus dem Brand Kit, nichts ist umgefärbt.

## Vorschlag Standard

**„Neutral (farbkritisch)“ ist der Standard.** Für Beurteilung und Grading stützen BT.2100 (neutrales Grau bei D65) und die Begründung im Resolve-Handbuch diese Wahl. „LZM“ (Markenoptik, z. B. für Präsentation und Screenshots) und „Original“ (die frühere Optik, fast schwarz) bleiben wählbar. Die Variante wird im Zustand und in den Layout-Konfigurationen gespeichert.
