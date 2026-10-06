# Opple Light Master per Bluetooth – Umsetzung (#11)

Stand: 30.09.2026. Ergänzt Teil B von [led-wall-und-messgeraete.md](led-wall-und-messgeraete.md). Nur geöffnete Quellen.

## Quellen und Lizenzen (am 30.09. geklont bzw. geöffnet)

| Projekt | Lizenz laut Repo | Verwendung in LZ Scopes |
|---|---|---|
| [natmart-in/sunday-light-meter](https://github.com/natmart-in/sunday-light-meter) @ eb50efc | MIT (LICENSE-Datei, `package.json`) | Protokoll portiert (`src/opple/protocol.ts`), Matrizen, LM3-Lichtartregel und Duv-Koeffizienten (`src/opple/photometry.ts`), Verbindungsablauf neu geschrieben (`src/opple/meter.ts`); Test-Rahmen eines echten LM4, LM3-Referenzwerte und CIE-1931-Tabelle als Testdaten. Lizenztext in `licenses/`. |
| [gabrielebaudo/opple-bridge](https://github.com/gabrielebaudo/opple-bridge) | MIT (LICENSE-Datei) | nicht direkt; Herkunft der LM4-Matrix (aus der OPPLE-Smart-App extrahiert) laut sunday-light-meter |
| [khromov/opple-light-master-4-web-ui](https://github.com/khromov/opple-light-master-4-web-ui) | **keine Lizenzdatei**; GitHub meldet keine Lizenz (die Recherche vom 29.09. nannte MIT – im Repo nicht belegt) | nicht verwendet, nur gelesen |
| [OlliV/open-light-master](https://github.com/OlliV/open-light-master) | GPL-3.0 | nicht verwendet; Herkunft der LM3-Matrizen laut sunday-light-meter |

## Umrechnung

- Das Gerät liefert Rohzählwerte (LM3: 6 Kanäle 450–650 nm; LM4: AS7341 F1–F8 + Clear) und je Gerät Kalibrierfaktoren `kSensor` (Opcode 0x0A04). XYZ = Matrix · (Kanäle · kSensor); Y ist die Beleuchtungsstärke in lx.
- **CCT:** McCamy 1992, Formel und Gültigkeit (Fehler < 2 K zwischen 2856 K und 6504 K) aus [Wikipedia „Correlated color temperature“, Abschnitt Approximation](https://en.wikipedia.org/wiki/Correlated_color_temperature) (Quelltext geöffnet), dort mit Zitat McCamy, Color Res. Appl. 17(2) 142–144 und Erratum.
- **Duv:** Polynom im Winkel um (0,292; 0,24) nach Ohno, „Practical Use and Calculation of CCT and Duv“, LEUKOS 2014 ([NIST-Eintrag](https://www.nist.gov/publications/practical-use-and-calculation-cct-and-duv) geöffnet; das Paper selbst war nicht zugänglich, Taylor & Francis 403). Koeffizienten aus sunday-light-meter, identisch mit [waveformlighting.com](https://www.waveformlighting.com/tech/calculate-duv-from-cie-1931-xy-coordinates) (ohne Quellenangabe). Deshalb prüft `test/opple.test.ts` das Ergebnis selbst gegen den exakten Planck-Ort (Plancksches Gesetz × CIE-1931-2°-Normspektralwerte): |Duv| < 3·10⁻⁴ von 2000 bis 15 000 K, ±0,01 senkrecht zum Ort wird als ±0,01 erkannt.
- CRI, EML und Spektrum-Rekonstruktion sind nicht übernommen (Aufgabe #11 verlangt Lux/CCT/Duv/xy; das LM4-Polynommodell der App wäre ein weiterer Datenblock aus der App).

## Web Bluetooth in Electron

- [Electron „Device Access“](https://www.electronjs.org/docs/latest/tutorial/devices): Ereignis `select-bluetooth-device` am webContents, `event.preventDefault()`, `callback(deviceId)`, leerer String bricht ab. Umgesetzt in `electron/main.cjs`: Geräteliste in der Seitenleiste, Abbruch nach 60 s (Nachtrag 01.10.).
- macOS: [Apple `NSBluetoothAlwaysUsageDescription`](https://developer.apple.com/documentation/bundleresources/information-property-list/nsbluetoothalwaysusagedescription) – „required if your app uses the device’s Bluetooth interface“, macOS 11.0+. In `electron-builder.js` unter `mac.extendInfo` eingetragen.
- Web-Fassung: nur Chrome/Edge (https oder localhost); Safari/Firefox ohne Web Bluetooth.

## Offen / ungeprüft

- **Gerät:** Seit 30.09. mit einem Light Master 3 geprüft (`test/oppleLm3Live.test.ts`). LM4 ungeprüft. Mitgeschnittene Rahmen lassen sich per „Rohdaten kopieren“ für Tests sichern.
- **Modell:** LM3 oder LM4? Beides wird am Nutzdatenumfang erkannt.
- **Koeffizienten:** Die Matrizen stammen aus der dekompilierten OPPLE-Smart-App und sind über MIT-Projekte veröffentlicht (LM4: opple-bridge; LM3: open-light-master → sunday-light-meter). Lars hat am 06.10.2026 entschieden, sie zu veröffentlichen; eine Erlaubnis von Opple liegt nicht vor (Herkunft: [led-wall-und-messgeraete.md](led-wall-und-messgeraete.md) C.6).
- Für LED-Wand-Primärfarben nur Trendmesser (Filtersensor, feste Matrizen).

## Nachtrag 30.09.2026 – Flimmern und LED-Wand

- Flicker-Protokoll (nur LM4) aus [gabrielebaudo/opple-bridge](https://github.com/gabrielebaudo/opple-bridge) @ 5bba264 (MIT, Lizenztext in `licenses/`) portiert: Anfrage 0x0A0A mit [0, Periode], Antwort 4 × 0x0A0B mit gepackten 12-bit-Werten, Abtastmodi 25/146/11, Grundlinie je Messbereich. Kennwerte Percent Flicker/Flicker Index nach ENERGY STAR (Entwurf), Abschnitt 8. Getestet nur mit synthetisch gepackten Seiten (keine aufgezeichneten Flicker-Rahmen unter freier Lizenz; die Aufnahmen im khromov-Repo sind ohne Lizenz).
- Einsatz an der LED-Wand, Grenzen und Weißpunkt-Herleitung: [led-wall-und-messgeraete.md, Teil C](led-wall-und-messgeraete.md).

## Nachtrag 01.10.2026 – Licht-Ansichten, mehrere Geräte, Display-Eignung

Geöffnete Quellen (30.09./01.10.): [Opple Light Master III User Guide (DarkSky, PDF)](https://darksky.org/app/uploads/bsk-pdf-manager/2022/12/Opple-Light-Master-III-User-Guide.pdf), [1lumen-Test LM3 Pro](https://1lumen.com/gear-review/opple-light-master-3-pro/), [Sekonic C-800 (sekonicindustrial.com)](https://www.sekonicindustrial.com/c-800), [UPRtek MK350S Premium](https://www.uprtek.com/en/product/spectrometers/mk350s-premium), Wikipedia [„Mired“](https://en.wikipedia.org/wiki/Mired), [„CIELUV“](https://en.wikipedia.org/wiki/CIELUV), [„Color rendering index“](https://en.wikipedia.org/wiki/Color_rendering_index), [„Color gel“](https://en.wikipedia.org/wiki/Color_gel) (Quelltext), [Mired Shift Gel Table (Dan Berens, PDF)](https://www.danberens.co.uk/uploads/3/0/0/6/30067935/mired_shift_gel_and_camera_filter_tables.pdf), [ArgyllCMS Instrumente](https://www.argyllcms.com/doc/instruments.html), [Calibrite Display Pro HL](https://calibrite.com/us/product/display-pro-hl/), [Datacolor SpyderPro](https://www.datacolor.com/spyder/products/spyder-pro/). Nicht erreichbar: opple.eu-Produktseite (404).

### Was der LM3 physikalisch liefert

- Einen Messwert je Abfrage an einer Stelle: 6 Filterkanäle (450/500/550/570/600/650 nm) als 16-bit-Zählwerte plus Kalibrierfaktoren, daraus XYZ über feste Matrizen. **Kein Bild, kein Messfeld im Sinne eines Bildes**, kein Spektrum.
- Eigene Messung am echten LM3 (30.09.): Der Sensor aktualisiert etwa alle **0,7 s** (Wechsel der Rohwerte nach 690–750 ms; schnellere Abfragen, 65 ms je Abfrage, liefern den gehaltenen Wert). Die Rohwerte sind bei Raumlicht klein: bei ≈ 13,5 lx `3 6 19 29 49 50`, bei ≈ 73,5 lx `55 61 120 152 193 162`. Ein Zählschritt im 450-nm-Kanal ist bei 13 lx also ≈ 33 %, im 650-nm-Kanal ≈ 2 %. Abgedeckt: 0,14 lx bei `0 0 1 1 1 1`, mit sinnlosem Farbort (x 0,72, y 0,28).
- Opple-Anleitung (DarkSky): Lux, CCT, Flimmern; „CCT readings … can have about 10-20% variance between tests of the same source“, Mittelung empfohlen. 1lumen: bis etwa 50 000 lx, „~5% difference“, die App zeigt Ra (ohne R9) und eine Spektrumgrafik; „not a full-fledged spectrophotometer“.

### Wie es etablierte Geräte zeigen

- **Sekonic C-800** (CMOS-Spektrometer): CRI, TM-30, SSI, TLCI/TLMF, Spektrum, „hue/saturation and x, y (CIE 1931)“, Filterkorrektur „in both CCi and LBi (Camera/Lighting)“, Vergleich mehrerer Lichter; 1–200 000 lx, 1600–40 000 K.
- **UPRtek MK350S Premium**: 380–780 nm, 1 nm Schrittweite, ≈ 12 nm Halbwertsbreite; CIE 1931 xy und 1976 u′v′, CRI R1–R15, CQS, TLCI, TM-30-18, Flimmern; Vergleich zweier Messungen.
- **Opple-App** (Anleitung): Lux, CCT, CIE-1931-Diagramm, Flimmer-Risiko nach IEEE 1789.
- **Asensetek Lighting Passport**: siehe [led-wall-und-messgeraete.md](led-wall-und-messgeraete.md) (kein SDK gefunden).

### Umgesetzt (src/opple/scopes.ts, lightScience.ts, store.ts)

| Ansicht | Inhalt | Beleg |
|---|---|---|
| Licht: Farbort (CIE) | CIE 1976 u′v′ (Standard) oder 1931 xy, Ausschnitt um die Planck-Kurve oder ganzes Diagramm; Planck-Kurve, Isothermen (Normalen zur Kurve in CIE 1960 uv), Linien Duv ±0,01/±0,02, Spur je Gerät, Messpunkte, Δu′v′ zum Ziel | u′ = 4x/(−2x+12y+3), v′ = 9y/(−2x+12y+3) (Wikipedia „CIELUV“); Planck-Ort nach Krystek (`calib/colorimetry.ts`) |
| Licht: Vectorscope | Mitte = Zielweiß (3200/4300/5600/6500 K Planck, D65 oder Referenzpunkt), Farbtonwinkel h_uv und Sättigung s_uv = 13·Δu′v′, Planck-Kurve mit Richtungen wärmer/kälter/grün/magenta, Mired zum Ziel mit Folienvorschlag | h_uv = atan2(Δv′, Δu′), s_uv (Wikipedia „CIELUV“) |
| Licht: Filterkanäle | 6 bzw. 8 Balken an den Kanal-Wellenlängen, relativ zum stärksten Kanal oder als Verhältnis zum Referenzpunkt; beschriftet „kalibrierte Zählwerte, keine spektrale Leistung“ | – |
| Licht: Zeitverlauf | Lux, CCT, Duv über 30 s … 1 h, Mittel, σ, Variationskoeffizient | – |
| Licht: Messfeld | Raster Spalten × Zeilen, Punkte nacheinander aufnehmen (gemittelt), Karte Lux % vom Maximum / Δu′v′ zum Mittel / CCT zum Mittel, Gleichmäßigkeit min/max, Vergleich A→B | Mittel-Farbort aus summiertem XYZ |

*▦ Licht-Ansichten* legt die fünf Panels als eigenes Layout an. Doppelklick macht ein Panel groß, *⧉ Ausgabe → Panel* zeigt es auf einem anderen Bildschirm (Ausgabefenster lesen die Messwerte des Hauptfensters).

**Vergleich zweier Lichter, Folien:** Mired M = 10⁶/T, Korrektur = 10⁶/T_Ziel − 10⁶/T_Quelle; Folien addieren sich in Mired (Wikipedia „Mired“, Beispiel 5700 K/3200 K ≈ −137 → CTB, im Test geprüft). Folienwerte zuerst aus der Tabelle von Dan Berens (Sekundärquelle), am 01.10. gegen die Hersteller geprüft (Abschnitt „Folien“ im nächsten Nachtrag). Vorgeschlagen werden eine oder zwei Folien desselben Herstellers mit dem kleinsten Rest.

**Weggelassen: CRI, TLCI, TM-30.** CRI wird aus der spektralen Leistungsverteilung berechnet; die Testfarben sind in 5-nm-Schritten tabelliert, und die Abtastung muss fein genug für Spitzen im Spektrum sein (Wikipedia „Color rendering index“). TLCI und TM-30 brauchen ebenfalls ein Spektrum. Aus 6 Filterkanälen müsste man ein Spektrum mit einem Modell schätzen (so macht es die Opple-App); das Ergebnis wäre eine Modellannahme, keine Messung. Die Filterkurven des LM3 sind nicht veröffentlicht.

### Mehrere Geräte, neue Geräte

- Keine Kopplung mit dem System: Web Bluetooth verbindet per GATT direkt. In der Desktop-App sammelt `electron/main.cjs` die Treffer des Scans (`select-bluetooth-device` feuert bei jedem neuen Fund erneut) und schickt sie per IPC an die Seitenleiste, dort wählt man aus. Abbruch nach 60 s. Im Browser zeigt Chrome seine eigene Auswahl.
- Gemerkt werden Name, Alias, Modell, die Web-Bluetooth-Kennung und in Electron die Geräteadresse aus dem Scan. *Verbinden* bei einem bekannten Gerät wählt in Electron dessen Adresse automatisch, sobald der Scan es sieht (geprüft nach Neuladen der Seite). `navigator.bluetooth.getDevices()` gibt es in Electron 44 nicht (geprüft: `undefined`); in Chrome wird es genutzt, wenn vorhanden.
- Mehrere gleichzeitig: je Gerät eine eigene GATT-Verbindung und Abfrage (`OppleMeter`). **Ungeprüft**, nur ein LM3 vorhanden.
- Chromium bricht `requestDevice` sofort mit `NotFoundError` ab, wenn das Fenster keinen Fokus hat (am 30.09. und 01.10. wieder beobachtet). Die Meldung sagt das.

### Eignet sich der Light Master zur Display-Kalibrierung? Nein, höchstens als Trend

1. **Messgröße:** Er misst Beleuchtungsstärke (lx) mit Kosinus-Empfänger, ein Display-Kolorimeter die Leuchtdichte (cd/m²) eines kleinen Messflecks. Aufgelegt auf eine gleichmäßig leuchtende Fläche gilt nur E ≈ π·L, und das Gehäuse schattet ab (Herleitung in [led-wall-und-messgeraete.md, Teil C](led-wall-und-messgeraete.md)). Absolute cd/m² sind damit nicht belegbar.
2. **Spektrale Korrektur:** Display-Kolorimeter lassen sich je Displaytechnik korrigieren. ArgyllCMS: i1 Display Pro und ColorMunki Display „are capable of using CCSS (Colorimeter Calibration Spectral Sample) files“, erzeugt mit einem Spektrometer als Referenz. Für den Light Master gibt es keine Korrektur, nur drei feste Matrizen (monochromatisch, Glühlampe, allgemein). Für schmale Display-Primärfarben (QD, OLED, Mini-LED) ist der Farbort deshalb nicht verlässlich.
3. **Auflösung bei niedrigen Pegeln:** gemessen 0,14 lx bei Zählwerten `0 0 1 1 1 1`. Ein Display-Schwarz von wenigen Zehntel cd/m² ergäbe aufgelegt nach E ≈ π·L etwa 1 lx, also nur ein bis fünf Zählschritte je Kanal (aus den Rohwerten bei 13,5 lx abgeleitet, nicht gemessen). Schwarzwert und dunkle Graustufen sind nicht messbar, ihr Farbort erst recht nicht.
4. **Winkel und Streulicht:** Ein Kosinus-Empfänger nimmt die ganze Halbkugel auf, also auch Raumlicht und Reflexe. Ein Display-Kolorimeter misst einen engen Kegel und liegt auf.
5. **Zeit:** ≈ 0,7 s je neuem Wert; ein Graukeil mit Einschwingen und Mittelung dauert lange.
6. **Vergleichsgeräte:** Calibrite Display Pro HL „measuring up to 3,000 nits“, Datacolor Spyder-Reihe bis 1 200, 3 000 bzw. 12 000 cd/m². Mindestleuchtdichte und Genauigkeit stehen auf den geöffneten Herstellerseiten nicht. Belegt ist für die i1-Display-Familie die spektrale Korrektur (CCSS) und eine adaptive Integrationszeit bei wenig Licht (ArgyllCMS). Der Light Master hat beides nicht.

**Eigene Messung am MacBook-Display (30.09.2026, 21:00–22:30):** Ausgabefenster im Vollbild (`?out=`), Vollfeld-Graustufen über den Patch-Kanal, je Stufe 2,5–3 s Einschwingen, 4–6 Messungen. Der LM3 lag auf dem Tisch beim Test-Mac, nicht aufgelegt; seine Lage zum Display ist unbekannt.
- Lauf 1 (stabile Phase, ≈ 13,5 lx Raumlicht): Schwarz 13,38 ± 0,18 lx; Graustufen 5 % … 100 %: 13,36 / 13,52 / 13,85 / 13,84 / 13,84 / 13,85 / 13,83 / 13,86 / 14,16 / 13,96 / 13,86 lx. Schwarz → Weiß ≈ 0,5 lx, das sind ein bis zwei Zählschritte im Rot-Kanal. Ein Graukeil ist nicht auflösbar. In der ersten Minute schwankte das Raumlicht stark (0,14 … 69 lx); diese Werte sind verworfen.
- Lauf 2 (≈ 73,5 lx Raumlicht, fünfmal Schwarz/Weiß im Wechsel): Schwarz im Mittel 73,47 lx, Weiß 73,54 lx. Der Unterschied von 0,07 lx liegt unter der Streuung von ≈ 0,1 lx. **Das Display ist in dieser Lage nicht messbar.**
- Linearität und Rauschen des Displays ließen sich deshalb nicht bestimmen. Gemessen sind nur das Rauschen des Sensors bei konstantem Licht (σ ≈ 0,1 lx bei 73 lx, ≈ 0,15 %) und die Quantisierung (oben).
- Offen: eine Messung mit aufgelegtem Sensor. Nach den Punkten 1–3 ist zu erwarten: Weiß und helle Graustufen als relative Tendenz brauchbar, Schwarz und Farbort nicht.

**Folgerung:** Der Light Master wird im Kalibrierdialog (#9) **nicht** als Messquelle angeboten. Für Displays taugt er höchstens als Tendenzanzeige für den Weißpunkt bei hellem Vollfeld. Eine Kalibrierung, eine Verifikation (ΔE) oder eine Uniformitätsprüfung nach ISO 14861 ist damit nicht seriös.

## Nachtrag 01.10.2026 (2) – Farbfläche, Wellenlängen, weitere Messgeräte, Folien

Geöffnet: [ArgyllCMS spotread](https://www.argyllcms.com/doc/spotread.html), ArgyllCMS-Quellen 3.5.0 (`spectro/spotread.c`, `xicc/xspect.c`, GPL/AGPL – nur als Fakten zum Ausgabeformat gelesen, kein Code übernommen), [ams-OSRAM AS7341 Datenblatt DS000504 v3-00](https://look.ams-osram.com/m/24266a3e584de4db/original/AS7341-DS000504.pdf), Lee-Produktseiten `leefilters.com/colour/<nummer>-…/` (200, 201, 202, 203, 204, 205, 206, 218, 223, 281, 285, 287, 244–249, 278, 279), Rosco-Produktseiten `us.rosco.com/en/products/filters/r3202…`, `r3407…`, `r3408…`, `r3409…`, `r3410…`, `r3411…`, `r3420…`, [Rosco Color Correction Kit (PDF)](https://us.rosco.com/sites/default/files/content/resource/2016-08/RoscoColorCorrectionKitData.pdf), [UPRtek MK350D](https://www.uprtek.com/en/product/spectrometers/mk350d), Wikipedia-Vorlage [„Color temperature white points“](https://en.wikipedia.org/wiki/Template:Color_temperature_white_points). Suchergebnisse ohne geöffnete Seite sind unten als solche markiert.

### Farbfläche (Scope „Licht: Farbfläche“)

- Der gemessene Farbort xy (mit Duv, nicht nur die CCT) wird mit Y = 1 nach XYZ und mit der inversen RGB→XYZ-Matrix der Display-Primärfarben in lineares RGB gerechnet. sRGB hat die Rec.709-Primärfarben, Display P3 die von P3-D65; beide haben Weiß D65 und die sRGB-Kurve (Primärfarben in `src/color.ts`). Danach wird so skaliert, dass der größte Kanal 1 ist (Helligkeit normiert). Es gibt keinen Weißabgleich: Die Fläche zeigt die absolute Farbe des Lichts so, als wäre das D65-Weiß des Displays neutral.
- Negative Kanäle bedeuten: außerhalb des Display-Gamuts. Die Fläche wird dann schraffiert, die Farbe auf 0 abgeschnitten und der Text sagt es. Daneben steht als Vergleich der Planck-Ort bei gleicher CCT, so wird der Duv-Anteil sichtbar.
- Die Panel-Overlays werden jetzt im Farbraum des Displays angelegt (`colorSpace: 'display-p3'`, wenn Display P3 erkannt bzw. gewählt ist). Die Farbfläche liest den Farbraum der Zeichenfläche aus und rechnet damit, sodass sie auch auf einer sRGB-Fläche ehrlich bleibt. Das stimmt nur bei kalibriertem Display mit aktiver Farbverwaltung; die Fläche sagt das.

### Wellenlängen-Monitor (Scope „Licht: Wellenlängen“)

- **Spektrometer** (ArgyllCMS oder Datei): echtes Spektrum, relative Intensität über der Wellenlänge 380–780 nm, nach Wellenlänge eingefärbt, mit Spitzenwert und Einheit. Das Spektrum des Referenzpunkts erscheint gestrichelt.
- **Opple:** die Filterkanäle als Punkte an der Mittenwellenlänge, Höhe = kalibrierter Zählwert relativ zum stärksten Kanal, beschriftet „Filterkanäle, kein Spektrum“. Beim LM4 zeigt ein Balken die Halbwertsbreite laut AS7341-Datenblatt (F1–F8: 415/26, 445/30, 480/36, 515/39, 555/39, 590/40, 630/50, 680/52 nm, Figure 7; dass der LM4 einen AS7341 enthält, steht in sunday-light-meter). Die Filterbreiten des LM3 sind nicht veröffentlicht.
- **Keine geschätzte Spektralkurve:** Eine Rekonstruktion bräuchte die spektralen Empfindlichkeiten aller Kanäle samt Diffusor. ams nennt nur Mitte und Halbwertsbreite und schreibt, die Parameter gelten mit dem Diffusor des Referenzaufbaus (AN001054, oben). Für den LM3 fehlt beides. Eine Kurve wäre eine Annahme.

### Gemeinsame Messgeräte-Schnittstelle

`src/opple/drivers.ts`, Schnittstelle `LightDevice` (Zustand, Messen, Mitteln, Abfrageschleife, Trennen). Treiber:

| Treiber | Weg | Daten | Stand |
|---|---|---|---|
| Opple Light Master 3/4 | Web Bluetooth | 6/8 Filterkanäle → XYZ | LM3 geprüft |
| ArgyllCMS `spotread -a -s` | Bridge (`server/meter.mjs`, schon für #9), getrennter Prozess | XYZ, Beleuchtungsstärke, Spektrum; CRI Ra/R1–R14, TLCI Qa, TM-30 Rf/Rg so, wie ArgyllCMS sie berechnet | **ungeprüft** (kein ArgyllCMS, kein Gerät) |
| Spektrum-Datei | Datei-Auswahl | Argyll `.sp` (CGATS, `spotread -O`) oder zwei Spalten Wellenlänge/Wert | mit Testdateien geprüft |

ArgyllCMS (spotread.html und `spotread.c`):
- `-a` misst im Umgebungsmodus, absolut, „include the various color temperatures and Color Rendering Index“. Ohne Umgebungsmodus misst das Gerät emissiv; dann fehlt die Zeile „Ambient = … Lux“, und LZ Scopes zeigt cd/m² statt lx.
- `-s` druckt das Spektrum: „Spectrum from A to B nm in N steps“, danach eine Zeile mit Werten.
- Einheiten: Ambient mW/(m²·nm), Emission mW/(m²·sr·nm).
- Im Umgebungsmodus ist die Ausgabe von CCT, CRI, TLCI und TM-30 eingeschaltet (`-T` schaltet sie dort ab). TLCI und TM-30 gibt es nur bei spektral messenden Geräten. „(Caution)“ markiert Werte, an denen ArgyllCMS zweifelt; die UI zeigt das als „(Vorsicht)“.
- **CRI, TLCI und TM-30 rechnet LZ Scopes nicht selbst.** Es zeigt die Werte von ArgyllCMS mit Quellenangabe. Für Spektrum-Dateien gibt es deshalb nur XYZ, CCT und Duv, kein CRI.
- Lizenz wie bei #9: ArgyllCMS (AGPL) wird nicht mitgeliefert und nicht gelinkt, nur ein installiertes `spotread` als eigener Prozess aufgerufen. Geräte laut [Instrumentliste](https://www.argyllcms.com/doc/instruments.html): i1Pro 1–3, ColorMunki, JETI specbos 1211/1201 und spectraval, Klein K10-A, i1Display/ColorMunki Display (ohne Spektrum), Spyder.

XYZ aus einem Spektrum: Summe über die CIE-1931-2°-Normspektralwerte in 5-nm-Schritten mal 683 lm/W (Tabelle aus sunday-light-meter, MIT, jetzt `src/opple/cmf.ts`). Geprüft: Spektrum gleicher Energie → x = y = 1/3; Planck 2856 K → Normlichtart A (0,4476/0,4074); 1 mW/(m²·nm) flach → ≈ 73 lx.

**Nicht angebunden, mit Begründung:**
- **Sekonic C-800:** kein SDK gefunden, nur „C-800 Utility“. **C-7000:** „SDK for remote control“ nur auf Antrag über den Händler ([led-wall-und-messgeraete.md](led-wall-und-messgeraete.md)). Lizenz und Protokoll sind damit nicht öffentlich.
- **UPRtek MK350:** Die MK350D-Seite nennt „SDK (Systems Developer's Kit) and … Modbus interface“ und den Export auf microSD „in excel compatible format“. SDK und Lizenz stehen nicht öffentlich, das Exportformat ist nicht dokumentiert. Weg: Export in zwei Spalten umwandeln und als CSV laden. Laut Suchergebnis (Seite nicht geöffnet) liefert UPRtek das SDK als DLL.
- **Asensetek Lighting Passport:** kein öffentliches SDK gefunden (frühere Recherche).
- **Konica Minolta CL-200A:** Die Bedienungsanleitung ist bei Konica Minolta öffentlich. Die „Communication Specifications“ fand die Suche nur als Kopie auf einer Drittseite (nicht geöffnet). Das Gerät braucht laut Suchergebnis einen eigenen USB-Treiber, Web Serial geht damit voraussichtlich nicht. Nicht gebaut.
- **JETI, Klein:** über ArgyllCMS abgedeckt; die eigenen JETI-SDKs nicht recherchiert.

### Folien gegen die Hersteller geprüft

- **Lee** (Produktseiten, Feld „Mired Shift“): 200 −274, 201 −137, 281 −112, 202 −78, 203 −35, 218 −18, 223 +26, 206 +64, 205 +109, 285 +124, 204 +159, 287 +312. Das stimmt mit der Tabelle von Dan Berens überein.
- **Rosco** gibt auf den Produktseiten die Umrechnung an, nicht immer Mired: 3202 „Boosts 3200K to 5500K“ → −131 (stimmt), 3407 „Converts 5500K to 2900K“ → +163 (Tabelle: +167), 3408 → +81, 3409 „5500K to 4500K“ → +40 (Tabelle +42), 3410 „5500K to 4900K“ → +22 (Tabelle +20), 3411 „5500K to 3200K“ → +131, 3420 „Mired Shift +320“. LZ Scopes nimmt jetzt die aus den Rosco-Angaben gerechneten Werte. Die Rosco-CTB außer 3202 (3203, 3204, 3206, 3208, 3216, 3220) waren unter den geratenen Adressen nicht zu finden und bleiben aus der Sekundärtabelle (im Code markiert).
- **Grün/Magenta:** Lee nennt für jede Folie den Farbort des gefilterten Lichts unter Kunstlicht (3200 K) und Tageslicht (Source C). Daraus rechnet LZ Scopes die Duv-Verschiebung: Duv(gefiltert) − Duv(Quelle), Source C x 0,31006 y 0,31616 (Wikipedia-Vorlage, CIE 15:2004), Kunstlicht = Planck 3200 K. Ergebnis (Kunstlicht/Tageslicht): 244 Plus Green +0,0195/+0,0279, 245 ½ +0,0106/+0,0152, 246 ¼ +0,0056/+0,0083, 278 ⅛ +0,0026/+0,0042, 279 ⅛ Minus −0,0036/−0,0038, 249 ¼ −0,0057/−0,0060, 248 ½ −0,0111/−0,0144, 247 Minus Green −0,0197/−0,0299. Der Vergleich A→B schlägt jetzt die passende Lee-Folie vor. Für Rosco-Grünfolien fehlen veröffentlichte Farborte, hier gibt es keinen Vorschlag.
