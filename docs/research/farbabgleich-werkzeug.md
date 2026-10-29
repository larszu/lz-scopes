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
| Anleitungsmodus | kein Protokoll | Person stellt um, Werkzeug misst |
| Simulator | kein Protokoll | Demo und Tests |

Nicht eingebaut, weil hier noch nicht gegen die öffentliche Spezifikation geprüft: direkte Panasonic-AW-CGI-, Sony-CGI- und VISCA-over-IP-Befehle für Matrix und Mehrachsen-Farbe. Kandidaten für einen eigenen Schritt, jeweils mit Seitenangabe aus der Herstellerspezifikation.

## Offen

- Nichts an echter Kamera geprüft (#116). Die BMD-REST-Steuerung ruft die Kamera direkt aus der Oberfläche auf; ob die Kamera das ohne CORS-Freigabe annimmt, ist ungeprüft.
- Matrix und Mehrachsen-Farbe gibt es nur im Simulator; über Bridge und BMD-REST nur globale Sättigung (BMD zusätzlich Farbton).
- Lage der ChromaDuMonde-Felder und die TE156-Vorlage mit Herstellerunterlagen füllen.
