# Display-Kalibrierung und -Verifikation (#9) – Recherche

Stand: 30.09.2026. Grundlage ist `colour-repos.md`, Abschnitt 9 (displaycal-py3). Hier steht nur, was für die Umsetzung zusätzlich geöffnet und geprüft wurde. Quellen, die nicht geöffnet werden konnten, sind als solche markiert.

## Lizenzen

| Quelle | Lizenz | Verwendung in LZ Scopes |
|---|---|---|
| displaycal-py3 (lokal geklont, 29.07.2026) | GPL-3.0 | nur Abläufe und Fakten, kein Code: Ausgabeformat von `spotread`, Untethered-Kriterium, Uniformitäts-Auswertung. Alles neu geschrieben. |
| ArgyllCMS ([ArgyllDoc.html](https://www.argyllcms.com/doc/ArgyllDoc.html), geöffnet) | „Almost all of the source code and provided executable files are … licensed under the Affero GNU Version 3 license“; einige Treiber GPL-2+ | **wird nicht mitgeliefert und nicht gelinkt.** LZ Scopes startet ein vom Nutzer installiertes `spotread` als eigenen Prozess und liest dessen Textausgabe, wie DisplayCAL. Die Seite sagt auch: „If you wish to incorporate or make use of the code in commercial or non-GPL products, you will need to negotiate a commercial license“. Einen fremden, getrennt installierten Prozess aufzurufen ist keine Einbindung von Code; siehe Abschnitt „ArgyllCMS: Lizenzlage“. Profile/Messdaten gehören laut derselben Seite dem, der sie misst. |
| alwan (MIT, `licenses/alwan-LICENSE.txt`) | MIT | Koeffizienten der Planck-Kurve nach Krystek 1985 (`src/alwan/data/planckian_locus_krystek_{u,v}.csv`) für CCT/Duv. Suchverfahren selbst geschrieben. |
| Adobe Cube LUT Specification 1.0 (PDF, 2013, geöffnet) | Spezifikation | Schreibregeln für `.cube`: `LUT_3D_SIZE N`, N³ Zeilen, „first component index (Red) changing most rapidly“ (§ 7.2), `TITLE "…"`, Kommentare mit `#`, Domain ohne Angabe 0…1. |

## ArgyllCMS: Lizenzlage (Stand 06.10.2026)

Geöffnet: [argyllcms.com/commercialuse.html](https://www.argyllcms.com/commercialuse.html) („Commercial Use and non-GPL Licensing“) und [ArgyllDoc.html](https://www.argyllcms.com/doc/ArgyllDoc.html).
- ArgyllCMS ist „licensed under the Affero GNU Version 3 license (AGPL3)“.
- Graeme Gill bietet den von ihm geschriebenen Code als kommerzielle Lizenz unter dem Namen **ArgyllPRO** an (Computer Graphics Technology P.L.), „so that it may be incorporated in closed source or Server based products“.
- „It is highly advisable that closed source products that make use of ArgyllCMS NOT be developed before securing an appropriate license.“
- Den Aufruf von Argyll-Werkzeugen als getrennte Programme behandelt die Seite **nicht ausdrücklich**.

**Umsetzung in LZ Scopes:**
- Kein Argyll-Code, keine Argyll-Binaries und keine Argyll-Daten im Repo oder in den Installern. `electron-builder.js` schließt `spotread*`, `dispcal*`, `dispread*`, `colprof*`, `collink*` und alles mit `argyll` im Namen aus. `test/argyll-packaging.test.ts` prüft das und die Git-Dateiliste.
- `server/meter.mjs` startet nur ein `spotread`, das der Nutzer selbst installiert hat, als eigenen Prozess. Die Kommunikation läuft über Kommandozeile, stdin und stdout, gelinkt wird nichts. So arbeitet auch DisplayCAL.
- Die Funktion ist optional. Ohne ArgyllCMS bleibt die manuelle Eingabe, und der Dialog sagt das.
- Der Kalibrier-Dialog nennt die Lizenz und dass Argyll separat installiert werden muss.

**Bewertung:** Das ist ein separates, nicht gebündeltes Programm. Nach der üblichen GPL-Lesart sind Programme, die über Kommandozeile und Pipes kommunizieren, getrennte Werke („aggregate“). Damit wird LZ Scopes nicht AGPL-pflichtig, und es wird nichts weitergegeben, das unter Argylls Lizenz fällt.

**Restrisiko:** Der Satz „closed source products that make use of ArgyllCMS“ ist weit formuliert, und die Seite grenzt den Prozessaufruf nicht ab. Bei einem kommerziellen Vertrieb von LZ Scopes, der mit der Messgerätefunktion wirbt, sollte das mit dem Rechteinhaber geklärt werden. Alternativ lässt sich eine ArgyllPRO-Lizenz anfragen. Das ist eine Rechts- und Kostenfrage für Lars, keine technische. Ein eigener Gerätetreiber würde die Abhängigkeit beseitigen, wäre aber ein großer, ungeprüfter Aufwand und wird nicht gebaut.

## ArgyllCMS `spotread`

Aus [argyllcms.com/doc/spotread.html](https://www.argyllcms.com/doc/spotread.html):
- `spotread [-options] [logfile]`; `-e` emissiv (absolute Werte, cd/m² bei Displays), `-y X` Displaytyp (gerätespezifische Liste), `-c n` Port aus der Liste der Usage-Ausgabe, `-X file.ccmx` Korrekturmatrix, `-X file.ccss` Spektralstichproben, `-N` Anfangskalibrierung überspringen, `-O` eine Messung und Ende, `-x` Yxy statt Lab.
- „XYZ values are … absolute cd/m^2 for display, emissive and ambient readings“.
- Nach dem Verbindungsaufbau wartet `spotread` auf einen Tastendruck; jede Taste (bzw. Leertaste) löst eine Messung aus.

Das genaue Textformat steht nicht auf der Seite. DisplayCAL (GPL, nur als Fakt gelesen) wertet `Result is XYZ: X Y Z, D50 Lab: …` aus, erkennt Fehler an `Spot read failed` bzw. `Spot read needs a calibration` und den Bereitschaftszustand an `key to take a reading` (`wx_untethered_frame.py` Z. 630–650, `wx_display_uniformity_frame.py` Z. 465–480). DisplayCAL ruft für Uniformität `spotread -v -e -T` auf (`worker.py` Z. 3399–3413) und sendet ein Leerzeichen auf stdin für die nächste Messung.

**Ungeprüft:** Auf dem Test-Mac ist ArgyllCMS nicht installiert und kein Messgerät angeschlossen. Parser und Prozesssteuerung sind nur mit synthetischen Ausgaben getestet.

## Untethered-Automatik

DisplayCAL `wx_untethered_frame.py` Z. 652–690: neuer Messwert gilt als neues Feld, wenn ΔE > 1,5 zum zuletzt übernommenen Wert oder |ΔL| > 1 bei |ΔC| < 0,5; übernommen wird erst beim **zweiten** Messwert in Folge, der das Kriterium erfüllt. LZ Scopes: dieselben Schwellen, ΔE00 auf Lab relativ zum hellsten bisher gesehenen Wert, zweite Messung muss zur ersten stabil sein (ΔE00 ≤ 1,5). Eigene Umsetzung.

## Uniformität

Nicht aus der Norm belegt: ISO 14861:2015 ist kostenpflichtig; die geöffnete Leseprobe (iteh, 428 kB) enthält die Anforderung nicht, iso.org lieferte 403. Die Werte stammen aus DisplayCAL `report/uniformity.functions.js` (Z. 41–47, 80, 106, 125–139, 227):
- Referenz ist das **Mittelfeld**, Lab je Feld relativ zum Weiß des Mittelfelds.
- ΔE00 zum Mittelfeld derselben Stufe: „shall be equal or less than four and should be equal or less than two“ (Kommentar dort, ISO 14861).
- Kontrastabweichung T = |R/R_ref − 1| mit R = Y(50 %)/Y(100 %), Toleranz T < 0,1.
- Hinweis „ISO 14861:2015 mandates at least a 5 × 5 grid“.

In der UI steht deshalb „nach ISO 14861 laut DisplayCAL“ und nicht „ISO-konform geprüft“.

## Verifikation

- Kennzahlen: Mittel, Max, Median, 95. Perzentil für ΔE00 und ΔITP (BT.2124, in `src/color.ts`). Perzentil als lineare Interpolation zwischen Rangwerten (wie numpy-Standard).
- Grenzwerte ΔE00 aus DisplayCAL „Default“ (`colour-repos.md`): Mittel 1,5/1, Max 4/3, Weißpunkt 2/1 (nominal/empfohlen). Für ΔITP ist kein Grenzwert recherchiert, er wird nur angezeigt.
- Sollwerte SDR: BT.1886 Anhang 1 mit gemessenem Weiß Lw und Schwarz Lb, L = a·max(V + b, 0)^2,4 (Formel in `ebu-video.md`); alternativ Potenz 2,2/2,4 mit Schwarz-Offset oder sRGB. Weißpunkt D65. Lab relativ zum Soll-Weiß (D65 mit gemessenem Lw).
- Sollwerte HDR: PQ (ST 2084) absolut in cd/m², Rec.2020-Container.
- CCT/Duv: Abstand zur Planck-Kurve in CIE 1960 uv (Krystek-Näherung, 1000–15 000 K); Duv positiv oberhalb der Kurve. Referenz: D65 ≈ 6504 K, Duv ≈ +0,0032.

## Testfeldsätze

DisplayCAL-Sätze (`verify_video.ti1` usw.) sind GPL-Daten und werden **nicht** übernommen. LZ Scopes erzeugt eigene Sätze mit derselben Feldanzahl als Orientierung:
- **Video 47:** 11 Graustufen (0–100 %, 10 %), R/G/B/C/M/Y in 100/75/50/25 % (24), 12 Farbtöne bei 75 % Pegel und halber Sättigung.
- **Video 81:** 21 Graustufen (5 %), R/G/B/C/M/Y in 100/75/50/25/10 % (30), 12 Farbtöne 75 %/50 % Sättigung, 12 Farbtöne 50 %/75 % Sättigung, 6 Pastelltöne 100 %/25 %.
- **Graukeil 21** und **HDR PQ** (Graustufen in cd/m² bis zur gewählten Spitze, P3- und Rec.709-Farben bei 100 bzw. 203 cd/m² im Rec.2020-Container).

Alle Felder sind 8-bit-Codewerte (Canvas-Ausgabe), die Sollwerte werden aus dem gerundeten Codewert gerechnet.

## Messfeld-Ausgabe

Das Ausgabefenster (`?out=`) zeigt die Felder. Feldgröße als Flächenanteil, konstanter Hintergrund (DisplayCAL-Vorgabe APL 22 %), optional Full-Field-Insertion (DisplayCAL: alle 5 s für 5 s, Pegel 15 %). Die Canvas-Werte laufen durch die Farbverwaltung des Systems. Für unveränderte Codewerte muss das Systemprofil passen (#17) oder ein externer Generator im Untethered-Modus genutzt werden.

## 3D-LUT aus Messungen

DisplayCAL erzeugt LUTs mit Argyll `collink` aus einem vollständigen Displayprofil. LZ Scopes baut kein ICC-Profil. Stattdessen verwendet es ein **Matrix/Shaper-Modell**: Schwarz-XYZ plus 3×3-Matrix aus den gemessenen Primärfarben (je minus Schwarz), Kanalkurven aus dem Graukeil. Das Modell gilt nur für additive Displays mit unabhängigen Kanälen (typisch LCD/OLED im nativen Modus, ohne ABL-Effekte). Deshalb:
- Bevor eine LUT entsteht, sagt das Modell alle gemessenen Felder voraus. Die LUT wird nur geschrieben, wenn der Modellfehler mittleres ΔE00 ≤ 1,5 und 95. Perzentil ≤ 3 einhält. Diese Schwelle ist eine eigene Festlegung.
- Ziel ist Rec.709/BT.1886 (bzw. gewähltes SDR-Ziel) mit dem Schwarz des Displays. Ist D65 bei vollem Weiß nicht erreichbar, wird das Weiß abgesenkt. Werte außerhalb des Display-Gamuts werden geclippt, ihre Anzahl steht im LUT-Kopf.
- Für HDR/PQ wird keine LUT erzeugt.
- Größen 33 und 65, `.cube` nach Adobe-Spezifikation.
