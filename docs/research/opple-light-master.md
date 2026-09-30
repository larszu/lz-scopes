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

- [Electron „Device Access“](https://www.electronjs.org/docs/latest/tutorial/devices): Ereignis `select-bluetooth-device` am webContents, `event.preventDefault()`, `callback(deviceId)`, leerer String bricht ab. Umgesetzt in `electron/main.cjs`: erstes gefundenes Gerät (die Seite filtert per Name), Abbruch nach 20 s.
- macOS: [Apple `NSBluetoothAlwaysUsageDescription`](https://developer.apple.com/documentation/bundleresources/information-property-list/nsbluetoothalwaysusagedescription) – „required if your app uses the device’s Bluetooth interface“, macOS 11.0+. In `electron-builder.js` unter `mac.extendInfo` eingetragen.
- Web-Fassung: nur Chrome/Edge (https oder localhost); Safari/Firefox ohne Web Bluetooth.

## Offen / ungeprüft

- **Kein Gerät vorhanden:** Verbindung, Polling und Electron-Auswahl sind nicht mit einem Light Master geprüft. Die UI sagt das („ungeprüft“). Mitgeschnittene Rahmen lassen sich per „Rohdaten kopieren“ für Tests sichern.
- **Modell:** LM3 oder LM4? Beides wird am Nutzdatenumfang erkannt.
- **Koeffizienten:** Die Matrizen stammen aus der OPPLE-Smart-App (über MIT-Projekte veröffentlicht). Ob sie in einem öffentlichen, ggf. kommerziell genutzten Programm verwendet werden dürfen, ist nicht geklärt (Urheberrecht an Zahlen fraglich, App-AGB nicht gelesen) – Entscheidung von Lars.
- Für LED-Wand-Primärfarben nur Trendmesser (Filtersensor, feste Matrizen).
