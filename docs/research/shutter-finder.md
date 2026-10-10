# Shutter-/Scanraten-Finder für LED-Wände und LED-Licht

Stand 10.10.2026. Idee 5 aus [scope-wuensche.md](scope-wuensche.md). Code: `src/led/flicker.ts` (Rechnung, ohne DOM), `src/led/flickerUi.ts` (Aufnahme im LED-Wand-Dialog), Tests `test/flicker.test.ts`, `e2e/ledfinder.spec.ts`.

## Quellen

| Kürzel | Quelle | Was daraus übernommen ist |
|---|---|---|
| ENTTEC | [ENTTEC Support: „Why do LEDs flicker on camera?“](https://support.enttec.com/pixel/pixel-general-knowledge/why-do-leds-flicker-on-camera) (gelesen 10.10.2026) | LEDs dimmen per PWM; Banding, wenn das Kamera-Timing nicht zur PWM-Rate passt; „Set the exposure to a whole number of PWM cycles“; Beispiel 400 Hz: 1/400, 1/200, 1/100, 1/50 s; „A 1/50 s exposure spans 8 full cycles of a 400 Hz source“; 400 Hz bei 24 fps = 16,67 Zyklen je Bild, „pulses at roughly 8 Hz“; die PWM-Rate ist im Chip fest |
| MPX | [Megapixel: „Solving Scan Lines with ICVFX“](https://support.megapixelvr.com/support/solutions/articles/103000307117-solving-scan-lines-with-icvfx) (gelesen 10.10.2026) | Scan-Linien aus dem Verhältnis von Wand-Refresh und Sensor-Erfassung; Rolling Shutter liest über ein längeres Fenster aus; Genlock aus einem Takt; Phase in µs verschieben; kleinerer Shutterwinkel; Refresh > 7680 Hz empfohlen, 3840 Hz als Beispiel; „monitoring of recorded images“ |
| OCC | [Symbol Rate Maximization in Rolling-Shutter OCC, arXiv 2602.08474](https://arxiv.org/html/2602.08474v1), Abschnitt II-A, Gl. 5–7 | Belichtung einer Zeile als Rechteckfenster der Länge T_exp („shifted integration kernel“), Zeilen werden nacheinander abgetastet |
| ICVFX | `led-wall-und-messgeraete.md`, Zeile „Scan-Linien / Refresh vs. Shutter“ | vorhandene Recherche zu Scan-Gruppen und Genlock |

## Modell (eigene Herleitung aus den Quellen, keine Norm)

- Das Licht flimmert mit f (PWM- bzw. Refresh-Rate, ENTTEC, MPX).
- Jede Zeile integriert das Licht über die Belichtung T (Rechteckfenster, OCC Gl. 5). Die Fourier-Transformierte eines Rechtecks der Länge T ist sinc(f·T); sie ist null, wenn T ganze Zyklen umfasst, T = n/f. Das ist die Mathematik hinter ENTTECs „whole number of PWM cycles“; für eine Rechteck-PWM gilt es auch für alle Oberwellen m·f.
- Ein Rolling Shutter beginnt Zeile y um y·t_row später (MPX: „rolling readout“). Zeile y in Bild n sieht cos(2π(f·t_row·y + f·n/F)): Bänder mit ky = f·t_row Zyklen pro Zeile, die sich je Bild um f/F Zyklen verschieben. Die Kamera sieht davon den Alias f − F·round(f/F) (Abtastung mit F; ENTTECs 8 Hz bei 400 Hz/24 fps sind genau dieser Wert: 400 − 17·24 = −8).
- Aus gemessenem Alias und bekanntem f folgt nichts Neues über f, aber die Prüfung, ob die Messung zu f passt. Aus ky und f folgt die Zeilenzeit t_row = ky/f und die Auslesezeit des Bildes t_row·Höhe – ein Plausibilitätswert gegen das Datenblatt.
- Ist f unbekannt, passen alle k·F + Alias. Mit der Auslesezeit aus dem Datenblatt lässt sich f = ky·Höhe/Auslesezeit schätzen und auf den nächsten Kandidaten setzen; das klappt nur, wenn die Auslesezeit auf deutlich unter F/(2f) genau stimmt (bei 3840 Hz und 50 fps: 0,65 %). Der Test zeigt, dass 2 % Fehler auf einen Nachbarkandidaten führen.

## Umsetzung

- Aufnahme: N aufeinanderfolgende Bilder der Quelle (Rohdaten der Bridge oder Element-Ausschnitt in voller Zeilenauflösung), je Bild das mittlere Luma je Zeile im Wandbereich (Bounding Box der vier Wandecken, sonst das ganze Bild). Bildzähler und Zeit werden mitgeschrieben; Lücken im Zähler werden gezählt und bei der Phasenrechnung übersprungen.
- Laufende Bänder: jedes Profil durch das zeitliche Mittelprofil teilen (entfernt den Bildinhalt), Hann-Fenster, FFT über die Zeilen, stärkste Zeilenfrequenz; Alias aus dem mittleren Phasenschritt dieser Frequenz zwischen aufeinanderfolgenden Bildern.
- Pumpen des ganzen Bildes: DFT der Bildmittel über die echten Bildzeitpunkte (Zähler/F).
- Stehende Bänder: Spektrum des Mittelprofils (Wand im Genlock: Alias 0, Bänder stehen); mindestens zwei Zyklen im Bereich.
- Vorschläge: alle T = n/f bis 360°, sortiert nach Abstand zu 180°; für den eingestellten Winkel Zyklen und Restflimmern |sinc(f·T)| (Grundwelle, relativ zu einer sehr kurzen Belichtung).

## Prüfstand

- Synthetisch (`simulateProfiles`): Rechteck-PWM, exakt integriert je Zeile, Rolling Shutter mit vorgegebener Auslesezeit, optional fehlende Bilder. Geprüft: Alias −10 Hz bei 3840 Hz/50 fps und +10 Hz bei 3860 Hz (Laufrichtung), Bandabstand und Auslesezeit 15 ms, keine Bänder bei T = 38/3840 s, Schätzung aus der Auslesezeit, Pumpen eines 100-Hz-Lichts bei 30 fps, stehende Bänder bei 3850 Hz = 77·50 fps.
- e2e: Aufnahme von einem animierten Testbild bis zur Vorschlagstabelle, ohne Kamera.
- **Nicht geprüft:** an einer echten LED-Wand, an einer LED-Leuchte mit Kamera, mit Global-Shutter-Kameras, mit Wänden mit Scan-Gruppen und schwarzen Subframes (MPX) – dort kann das Zeilenprofil andere Formen als die Rechteck-PWM haben. Browser-Quellen liefern Bilder im Takt von `requestVideoFrameCallback`; ob jedes Kamerabild ankommt, zeigt nur der Zähler.
