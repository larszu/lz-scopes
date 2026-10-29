# Kamera-Farbabgleich (Werkzeug)

Stand 29.10.2026. Ausgabe → *Kamera-Farbabgleich …*, Code in `src/colormatch/`, Tests `test/colormatch-tool.test.ts`, `e2e/colormatch.spec.ts`. Baut auf dem Kamera-Abgleich auf ([kamera-abgleich.md](kamera-abgleich.md), #140): Homographie aus `src/led/analysis.ts`, ΔE aus `src/deltae.ts`, Sollwerte der ColorChecker aus `src/match/chartRef.ts`, Eckendialog aus `src/match/chartUi.ts`, Paint-Bus aus `src/shading/`.

## Bedienung

- **Links Referenz:** Tafel wählen, Quelle wählen (jede Quelle, auch eine Kamera ohne Steuerung, oder die Sollwerte der Tafel), *Tafel suchen* oder *Ecken setzen …*, dann **Farben holen**.
- **Rechts Zielkamera:** Quelle und Steuerung wählen, **Abgleichen**. Fortschrittsbalken, *Abbrechen*, nach dem Lauf *Vorher/Nachher* (schreibt die Werte vom Start bzw. Ende an die Kamera). *Multi*: mehrere Ziele, nacheinander abgeglichen.
- Unten ΔE00 je Feld (ΔITP bei PQ/HLG), Mittel und Maximum.

## Ablauf (`engine.ts`)

1. **Latenz messen:** ein Parameter wird um ein Viertel seines Bereichs verstellt, das Bild wird alle 20 ms gelesen, bis es sich bewegt. Wartezeit je Stellschritt = Latenz × 1,2 + 40 ms. Nicht messbar → 500 ms.
2. **Schwarz, Weiß, Pedestal, Gamma, Matrix, Mehrachsen-Farbkorrektur** – jeweils nur mit den Parametern, die die Kamera anbietet; fehlt alles, wird der Schritt übersprungen und gemeldet.
3. Jeder Schritt ist dieselbe herstellerunabhängige Regelschleife: die Wirkung jedes Parameters wird gemessen (finite Differenzen = Jacobi-Matrix), dann gedämpfte Gauß-Newton-Schritte (Levenberg-Marquardt) mit Broyden-Nachführung. Ein Schritt, der schlechter macht, wird zurückgenommen. Fehlermaß: Signal R′G′B′ für die Graustufen, CIELAB für die Farbschritte.

Weil die Wirkung gemessen und nicht angenommen wird, braucht die Schleife weder Einheiten noch Kennlinien einer Kamera. Darauf baut der **Anleitungsmodus**: Das Werkzeug sagt „Weiß R: 0 → +5“, die Person stellt es an der Kamera ein und bestätigt, das Werkzeug misst nach.

## Karten (`charts.ts`, datengetrieben)

Eine Karte ist eine Beschreibung: Seitenverhältnis, Felder als Rechtecke in Kartenkoordinaten 0..1, Feldtyp (Farbe, Grau, Schwarz, Weiß) und – wo öffentlich belegt – ein Sollwert je Feld (xyY oder Lab, D50, oder nur Y = Reflexion für neutrale Felder). Erkennung, Abtastung, ΔE und Regelschleife nehmen alles andere aus der Beschreibung; eine neue Karte ist ein Eintrag in `CHART_SPECS`. Graustufenkarten ohne Farbfelder durchlaufen nur Schwarz, Weiß, Pedestal und Gamma.

| Karte | Lage | Sollwerte |
|---|---|---|
| ColorChecker Classic | 6 × 4 laut Hersteller-Datenblatt | BabelColor-Mittel (colour-science, THIRD_PARTY.md) |
| DSC ChromaDuMonde | vereinfachtes 8 × 6-Raster, an echter Tafel zu prüfen | keine – nur gegen Referenzkamera |
| TE156 | **Vorlage**, 11 Graufelder als Platzhalter | **keine** – kein öffentliches Hersteller-Datenblatt mit Lage und Werten gefunden; aus dem Datenblatt zur Tafel eintragen |

**Erkennung (`detect.ts`), klassisch, ohne trainiertes Modell:** Otsu-Schwelle auf Luma, zusammenhängende Gebiete beider Polaritäten, Löcher gefüllt; das größte Gebiet, das den Bildrand nicht berührt, sein Viereck zu ≥ 85 % füllt und zum Seitenverhältnis passt, ist die Tafel. Ecken = Extrempunkte entlang x+y und x−y. Klappt das nicht (Tafel ohne Rand vor ähnlichem Hintergrund), werden die Ecken von Hand gesetzt. Danach Homographie und Median über ein 7 × 7-Raster im inneren Feldbereich.

## Protokolle

lz-scopes ist öffentlich. Hier wird nur gesprochen, was eine öffentliche Herstellerspezifikation hat; Tabellen aus Fremdanalysen kommen nicht ins Repo.

| Steuerung | Quelle | Was genutzt wird |
|---|---|---|
| Blackmagic Camera Control REST API | Blackmagic Design, *Blackmagic Camera Control – Developer Information*, Abschnitt „Color Correction Control API“, S. 66–69, und SDI-Tabelle Gruppe 8 (Wertebereiche): <https://documents.blackmagicdesign.com/DeveloperManuals/BlackmagicCameraControl.pdf> | `GET/PUT <Kamera>/control/api/v1/colorCorrection/lift`, `/gamma`, `/gain` (`red/green/blue/luma`), `/color` (`hue/saturation`) |
| lz-camera-bridge Paint-Bus | kein Kameraprotokoll: die WebSocket-Befehle der Bridge, die Touch Shading schon sendet (`src/shading/model.ts` `busCommands`) | Black/White R/G/B, Master Black, Master Gamma, Saturation – nur Felder, die die Bridge für die Kamera meldet |
| Panasonic AW-CGI | Panasonic Connect, *AW-UE150/AW-HE145 Integrated Camera Interface Specifications*, 1. 4. 2022: <https://eww.pass.panasonic.co.jp/pro-av/support/content/guide/DEF/UE150/AW-UE150HE145_InterfaceSpecification_E.pdf> | siehe Tabelle unten |
| Sony CGI | Sony, *VISCA Command List / CGI Command List, Software Version 1.0, SRG-A40/A12* (5-053-155-11 (1), 2023), auf der Sony-Supportseite als „Technical Manual – VISCA/CGI Command List“: <https://www.sony.com.hk/en/electronics/support/ptz-and-remote-cameras-ptz-cameras/srg-a40/manuals> | siehe Tabelle unten |
| Sony VISCA over IP | dasselbe Sony-Dokument | siehe Tabelle unten |
| Anleitungsmodus | kein Protokoll | Person stellt um, Werkzeug misst |
| Simulator | kein Protokoll | Demo und Tests |

### Befehle je Hersteller

**Panasonic aw_cam** (`http://<Kamera>/cgi-bin/aw_cam?cmd=<Befehl>&res=1`, Antwort = Befehl im Rumpf, S. 7; Abfrage mit Q statt O):

| Funktion | Befehl | Daten | Seite |
|---|---|---|---|
| R/B Gain (Weiß) | `OSG:39`, `OSG:3A` | 738h…800h…8C8h = −200…0…+200 | 30 |
| Master Pedestal | `OSJ:0F` | 738h…8C8h = −200…+200 | 31 |
| R/B Pedestal (Schwarz) | `ORP`, `OBP` | 032h…096h…0FAh = −100…0…+100 | 31 |
| Gamma | `OSA:6A` | 67h…94h = 0,30…0,75, Schritt 0,01 | 33 |
| Matrix Type USER | `OSE:31:3` | wird vor dem ersten Matrix-/Farbkorrekturbefehl gesendet | 35 |
| Linear Matrix R-G, R-B, G-R, G-B, B-R, B-G | `OSD:A4`…`OSD:A9` | 41h…80h…BFh = −63…0…+63 | 35 |
| Color Correction, 16 Achsen (B_Mg … B), Sättigung/Phase | `OSD:80`…`OSD:9F` | 41h…BFh = −63…+63 | 35–36 |

Die Codes gelten für UE150/HE145; andere Modelle haben eigene Spezifikationen. Was eine Kamera auf die Abfrage nicht beantwortet, bietet das Werkzeug nicht an.

**Sony CGI** (`http://<Kamera>/command/<cgi>?<Parameter>=<Wert>`, Digest-Authentisierung, Abfrage `inquiry.cgi?inq=imaging`, S. 31):

| Funktion | Befehl | Daten | Seite |
|---|---|---|---|
| R/B-Gain (Weiß) | `imaging.cgi?WhiteBalanceCrGain=`, `WhiteBalanceCbGain=` | 0…128…255 | 43, 47 |
| Manueller Weißabgleich | `WhiteBalanceMode=manual` (einmal vor dem ersten Gain-Wert) | | 47 |

**Sony VISCA over IP** (UDP 52381; Kopf: Payload-Typ 01 00/01 10/01 11, Länge 2 Byte, Folgenummer 4 Byte, Big-Endian; Adresse 1, S. 9–11):

| Funktion | Befehl | Daten | Seite |
|---|---|---|---|
| R.GAIN Direct | `81 01 04 43 00 00 0p 0p FF` | pp 00…80…FF = −128…0…+127 | 15 |
| B.GAIN Direct | `81 01 04 44 00 00 0p 0p FF` | wie oben | 15 |
| R/B-Gain-Abfrage | `81 09 04 43 FF`, `81 09 04 44 FF` → `90 50 00 00 0p 0p FF` | | 20 |

Sony-Pedestal, -Gamma, -Matrix und Mehrachsen stehen in der SRG-A40/A12-Liste nicht und bleiben deshalb draußen. Daten aus der Panasonic-Analyse (mapdata) und Code aus lz-camera-bridge wurden nicht verwendet.

## Offen

- Nichts an echter Kamera geprüft (#116). Die BMD-REST-Steuerung ruft die Kamera direkt aus der Oberfläche auf; ob die Kamera das ohne CORS-Freigabe annimmt, ist ungeprüft.
- Matrix und Mehrachsen-Farbe: Simulator und Panasonic; über Bridge und BMD-REST nur globale Sättigung (BMD zusätzlich Farbton); Sony nur R/B-Gain.
- Panasonic- und Sony-CGI rufen die Kamera direkt aus der Oberfläche auf (CORS, bei Sony zusätzlich Digest ungeprüft). VISCA over IP ist UDP: Adapter und Tests sind da, ein Transport in der Desktop-App fehlt noch, darum steht VISCA nicht in der Auswahl.
- Lage der ChromaDuMonde-Felder und die TE156-Vorlage mit Herstellerunterlagen füllen.
