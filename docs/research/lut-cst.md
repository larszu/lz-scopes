# Eingangs-LUTs und Farbraum-Transformation (CST): Quellen

Stand: 29.09.2026. Grundlage für `src/chain.ts`, `src/lut.ts`, `src/lutLibrary.ts` (Issue #20).

## Kette je Quelle

Eingang (Transfer/Gamut der Quelle, auch Kamera-Log aus `src/camera.ts`) → CST (linear → Ziel-Gamut, Bradford bei anderem Weißpunkt → Tone-Mapping → Ziel-Transfer) → LUT 1 → LUT 2. Jedes Panel misst an einer Stufe (Signal, nach CST, nach LUT). Die GPU rechnet die Kette im Shader, die CPU dieselbe Kette für Messpunkt und Statistik.

Lineares Licht in der Kette: 1,0 = Referenzweiß. SDR 100 % ≙ HDR-Referenzweiß 203 cd/m² (BT.2408-8, Tab. 1), Log als Szenenlicht (0,18 = Graukarte).

## Formeln

| Baustein | Quelle | Lizenz | Stelle |
|---|---|---|---|
| Kamera-Log-Kurven, Kamera-Gamuts | alwan | MIT | `core/alwan_rgb_core.inc`, `data/rgb_spaces/*.csv` (siehe `src/camera.ts`) |
| Bradford-CAT | aces-core | Apache 2.0 | `lib/Lib.Academy.ColorSpaces.ctl` Z. 43–93 |
| BT.2390-EETF | alwan | MIT | `core/alwan_hdr_core.inc` Z. 235–265 (je Kanal im PQ-Bereich, ohne Schwarzanhebung) |
| ACES-2.0-Tonescale | aces-core | Apache 2.0 | `lib/Lib.Academy.Tonescale.ctl` Z. 30–96; in LZ Scopes auf die Luminanz mit erhaltenen RGB-Verhältnissen angewandt. Das ist eine Vereinfachung und nicht der volle ACES-2.0-Output-Transform (keine JMh-Chroma- und Gamut-Kompression). Mit den veröffentlichten Konstanten ergibt 18 % Grau 9,9999 cd/m² bei 100 cd/m² Spitze (Anker c_d = 10,013) |
| Reinhard, erweitert | Reinhard et al. 2002, „Photographic Tone Reproduction for Digital Images“, Gl. 4 | Formel | L·(1 + L/W²)/(1 + L) auf die Luminanz |
| HLG-OOTF, Systemgamma | ITU-R BT.2100-3 | Norm | siehe `ebu-video.md` |

## LUT-Formate

Aufbau nach djieff/prism `src/prism/io/lut/loader.py` (MIT), in TypeScript neu geschrieben:

| Format | prism-Stelle | Umsetzung in `src/lut.ts` |
|---|---|---|
| `.cube` | Z. 352–421 | 1D und 3D, `DOMAIN_MIN/MAX` (Adobe), `LUT_1D/3D_INPUT_RANGE` und 1D-Shaper vor 3D (Resolve), Rot läuft am schnellsten |
| `.3dl` | Z. 483–521 | erste Zeile = Eingangsraster, Blau läuft am schnellsten. Abweichend von prism wird die Ausgabeskala aus der Bittiefe bestimmt (10/12/14/16 bit) statt aus dem Dateimaximum |
| `.spi3d` | Z. 433–480 | Indizes je Zeile, nur würfelförmig |
| `.csp` | Z. 524–624 | CSPLUTV100 3D. Abweichend von prism werden Pre-LUTs als „Anzahl, Zeile Eingänge, Zeile Ausgänge“ je Kanal gelesen und zu einem 1D-Shaper mit 1024 Stützstellen umgerechnet |
| `.spi1d` | – | `From`, `Length`, `Components`, Werte |

Interpolation: 1D linear, 3D tetraedrisch (sechs Tetraeder entlang der Grauachse). Die Tetraeder-Interpolation gibt affine Abbildungen exakt wieder (Test).

## Hersteller-LUTs: Weitergabe

Geprüft am 29.09.2026. Nur tatsächlich geöffnete Seiten. Ergebnis: **Keine Hersteller-LUT wird mitgeliefert.** Die App verlinkt die offiziellen Download-Seiten (`src/lutLibrary.ts`, „Hersteller-LUTs …“ in der Quellenkarte).

| Hersteller | Look | Download-Seite (geöffnet) | Bedingungen | Weitergabe |
|---|---|---|---|---|
| Sony | s709, kreative Looks | https://sony-cinematography.com/resources/luts/ | Verweis auf „SEL Terms & Conditions“, nicht geöffnet; pro.sony-Seiten lieferten HTTP 403 | unklar → nein |
| Panasonic | V-Log → V-709 | https://av.jpn.support.panasonic.com/support/global/cs/dsc/download/lut/index.html | https://av.jpn.support.panasonic.com/support/global/cs/terms-of-use.html: „Duplication, public transmission, distribution, modification … without the authorization of the Author is prohibited“ | nein |
| Panasonic | VariCam-Bibliothek | https://pro-av.panasonic.net/en/cinema_camera_varicam_eva/support/lut/ | kein Lizenztext auf der Seite | unklar → nein |
| Canon | Canon Log 2/3 → Canon 709 | https://hk.canon/en/support/0200747702 | Disclaimer auf der Seite: „You shall not distribute, assign, license, sell, rent, broadcast, transmit, publish or transfer the Content to any other party.“ Die Seite zu „BT.709 Wide DR“ war nicht abrufbar | nein |
| ARRI | LogC4/LogC3 → Rec.709 | https://www.arri.com/en/learn-help/learn-help-camera-system/tools/lut-generator | https://www.arri.com/en/legal: Nutzung von Downloads und Dateien nur mit ausdrücklicher Zustimmung (sinngemäß, Zitat aus der Werkzeug-Zusammenfassung) | nein |
| Blackmagic | Gen 5 Film to Video | nur mit DaVinci Resolve | Resolve-EULA: keine Weitergabe, keine abgeleiteten Werke | nein |
| RED | IPP2 Output Presets | https://www.reddigitalcinema.com/download/ipp2-output-presets | Bedingungen hinter einer Zustimmungs-Checkbox, Text nicht einsehbar | unklar → nein |

Dass DaVinci Resolve Hersteller-LUTs mitliefert, beruht vermutlich auf eigenen Vereinbarungen; für LZ Scopes folgt daraus nichts.

## BBC-HDR-LUTs (#210)

Geprüft am 24.11.2026: [bbc/bbc_hdr_television_production_luts](https://github.com/bbc/bbc_hdr_television_production_luts), Version 1.8 vom 16.09.2026, Commit `dd27445`. Lizenz **Apache 2.0** (GitHub-Lizenzfeld, `LICENSE`, Kopf jeder `.cube`-Datei: „Moved to Open Source licence – No changes to functionality from 1.7“). Weitergabe ist erlaubt, mit Lizenztext und Kennzeichnung von Änderungen; eine `NOTICE`-Datei hat das Repository nicht.

**Umsetzung:** Mitgeliefert wird trotzdem keine LUT, weil jede 33³-Datei rund 1 MB groß ist (65³: 7 MB). Die LUT-Sammlung (`src/lutLibrary.ts`, Knopf *LUT-Sammlung …* unter *CST / LUT*) lädt eine Datei auf Klick von GitHub, fest auf den Commit, legt sie wie eine gezogene Datei in IndexedDB ab, setzt sie in LUT 1 und stellt den LUT-Ausgang (Transfer, Gamut, HLG-Lw 1000) auf das Ziel der LUT. Passt der Eingang nicht (Quelle bzw. CST-Ausgang ≠ LUT-Eingang), sagt das die Meldung. Ohne Internet: Datei aus dem Repository holen und auf die Karte ziehen. `npm run luts:bbc` holt dieselben Dateien nach `vendor/luts/bbc/`.

**Nur Type I.** Laut *Implementation Guidelines for HLG Format Conversion LUTs* (BBC, 09/2026, `Documentation/BBC_HDRTV_HLG_LUT_Implementation_Guide.pdf`) arbeiten Type-I-LUTs im Nennbereich (Eingang und Ausgang 0 = Schwarz, 1 = 100 %), „intended for software applications“. Type II/III erwarten den vollen 10-bit-Container (0 = Code 0, 1 = Code 1023, Schwarz bei 64/1023) und gehören in Hardware-LUT-Geräte. Die Kette von LZ Scopes gibt der LUT Nenn-R′G′B′; eine Type-III-LUT wäre dort um den Narrow-Range-Versatz falsch. Angeboten werden die Type-I-Primärwandlungen 1a, 2a, 3a, 5a, 7a, 8a. Die Szenenlicht-LUTs 4 und 6 gibt es nur als Type III und fehlen deshalb.

**Abgleich mit der eigenen Rechnung** (`test/bbcLuts.test.ts`, Stichprobe jedes vierten Gitterpunkts in `test/fixtures/bbc-luts/`):

| LUT | gegen | größte Abweichung an den Knoten | Urteil |
|---|---|---|---|
| 7a HLG → PQ 1000 | `signalToLinear(hlg, 1000)` → `linearToSignal(pq)` | 0,8·10⁻⁴ | stimmt (BT.2100-3, Systemgamma 1,2 bei 1000 cd/m²) |
| 1a PQ 1000 → HLG | `signalToLinear(pq)` → `linearToSignal(hlg, 1000)`, Ausgang auf 0–1 begrenzt | 1,6·10⁻⁴ | stimmt, auch das Clipping über 1000 cd/m² |
| 3a BT.709 → HLG direkt (Displaylicht) | SDR BT.1886 γ 2,4, 100 % = 203 cd/m², Gamut 709 → 2020, HLG 1000 | bis 0,12 | **weicht ab**, siehe unten |

Zur LUT 3: Beide bilden 100 % SDR auf 75 % HLG ab. Darunter liegt die BBC tiefer: 75-%-Weiß der RP-219-Balken ergibt laut Release Notes v1.8 (Annex 1, Tabelle „LUT 3“) 0,6145, die CST von LZ Scopes 0,6329; 40 % Grau 0,3107 gegen 0,3566; 15 % Grau 0,1004 gegen 0,1337. Für Grau entspricht die BBC-Kurve einem SDR-Exponenten von etwa 2,75 statt 2,4. Welches SDR-Displaymodell die BBC dafür annimmt, steht in den gelesenen Abschnitten nicht. Bis das geklärt ist, ist die SDR → HLG-Wandlung der CST nicht BBC-gleich. Messungen „nach CST“ und „nach LUT 3a“ unterscheiden sich also in den Mitten; das ist kein Fehler des LUT-Wegs.

Nicht geprüft: 2a (Tone-Mapping der BBC, nicht BT.2390), 5a und 8a (eigene BBC-Kurven, kein Gegenstück in der CST), alle Type-II/III-Varianten.

Zweite Vergleichsquelle aus dem Issue: [PeterTh/PtBi](https://github.com/PeterTh/PtBi) ist GPL-3.0. Daraus wird nichts übernommen.

## Gamma-Erkennung

Die Transferfunktion wird nur aus den Stream-Metadaten erkannt (ffprobe `color_transfer`): `bt709`/`smpte170m`/`bt2020-10/12` → BT.1886, `gamma22` → γ 2,2, `gamma28` → γ 2,8, `iec61966-2-1` → sRGB, `linear`, `smpte2084` → PQ, `arib-std-b67` → HLG. Fehlen die Metadaten, zeigt die Quellenkarte „nicht signalisiert, Annahme“ bzw. „keine Metadaten, Annahme“. Aus dem Bild selbst lässt sich die Kurve nicht bestimmen. Log-Kurven werden nie signalisiert.
