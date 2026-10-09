# Scope-Wünsche aus Broadcast, Live und Event

Stand 09.10.2026. Recherche: Threads aus r/VIDEOENGINEERING (gelesen über das Archiv api.pullpush.io, Reddit selbst sperrt automatische Abrufe), YouTube-Titel und -Kapitel, Herstellerseiten. Was davon in lz-scopes umgesetzt wird, ist offen. Zusammenfassung von Quellen, keine eigenen Messungen.

Durchgehender Befund: Zum Shading gibt es kaum Lernmaterial, Wissen wird „from the old dogs to the new guys on site“ weitergegeben ([1jjmwmu](https://www.reddit.com/r/VIDEOENGINEERING/comments/1jjmwmu/colour_correction/)); im Corporate-Bereich macht oft eine Person EIC, V1 und Shading zugleich ([1behzp2](https://www.reddit.com/r/VIDEOENGINEERING/comments/1behzp2/eiccamera_shading/)). Daraus folgt die Scope-Hilfe (Hilfe → Scope-Hilfe einblenden).

## Gewünscht, in lz-scopes noch nicht vorhanden

| # | Wunsch | Quelle | Aufwand |
|---|---|---|---|
| 1 | Referenzspur einfrieren und über das Live-Signal legen (Waveform, Parade, Diamond) – gestimmte Kamera als Vorlage für die nächste | [Tektronix App-Note 25W-27159](https://www.telestream.net/pdfs/app-notes/Camera-Setup-Matching-and-Alignment-Application-Note-25W271590.pdf), empfohlen in [13ik5e1](https://www.reddit.com/r/VIDEOENGINEERING/comments/13ik5e1/video_shading/) | klein |
| 2 | Kachelansicht: derselbe Scope für 4–8 Kameras mit Kamera-ID | [PRISM CAM/MULTI](https://blog.telestream.com/?p=12623), [Nobe Live Pack](https://digitalproduction.com/2026/03/11/nobe-omniscope-gets-live-pack-for-on-set-and-live-monitoring/) | klein–mittel |
| 3 | Blendenskala (STOP) für jede Gamma, nicht nur Log | [PRISM STOP](https://blog.telestream.com/master-hdr-video-production-with-stop-monitoring/) | klein |
| 4 | Fokushilfe: Peaking plus Schärfewert im Bereich | Leader LV5600 Focus Assist, Nobe Live Pack | klein–mittel |
| 5 | Rauschmessung (Black Noise / SNR im Messrahmen) | [Leader Noise Meter](https://www.svgeurope.org/blog/news-roundup/leader-video-noise-meter-option-for-4k-waveform-monitor/) | klein–mittel |
| 6 | Kameradaten im Scope: Iris, ND, Gain, Farbtemperatur, Tally, ID (Werte liefert lz-camera-bridge) | [Leader LV5600-SER27](https://www.testequipmentdepot.com/leader-lv5600-ser27-internal-option-id-iris-and-tally-display-software-option-for-lv5600-units.html) | mittel |
| 7 | White-Shading-Karte: Ebenheit von Luma/Farbe auf gleichmäßiger Fläche, zerlegt in Sägezahn/Parabel H/V | [TV Technology](https://tvtechnology.com/miscellaneous/white-shading), [Ross](https://help.rossvideo.com/acid/Tasks/Acid-Cam/Lens/Lens-White.html) | klein–mittel |
| 8 | Geführter Shading-Ablauf (Schwarz bei zu, Black Balance, Graukeil, Weiß, Knee, Matrix) | [13ik5e1](https://www.reddit.com/r/VIDEOENGINEERING/comments/13ik5e1/video_shading/), [16hdoql](https://www.reddit.com/r/VIDEOENGINEERING/comments/16hdoql/can_someone_explain_to_me_color_matrix_in_the/) | mittel |

## Gewünscht und schon vorhanden

Diamond zum Mitteln der Schwärzen ([1qtm2oq](https://www.reddit.com/r/VIDEOENGINEERING/comments/1qtm2oq/black_shading_question/)), Vectorscope-Zoom ×2/×5, YRGB-Parade, farbige Waveform, CIE, Hautton-Linie und -Waveform, Falschfarben, Lichtmesser, HDR-Skalen in cd/m², CST/LUT je Messpunkt für HDR/SDR-Simulcast, Farbabgleich in Kamerabegriffen, R128, Zebra, R103-Gamut, jetzt auch HLS-Vectorscope.

## Ideen, die es so noch nicht gibt

1. **Kamera-Match-Matrix:** N Kameras auf dieselbe Farbtafel, ΔE00 je Feld zur Referenzkamera, Vorschlag für die Multi-Matrix-Achsen. Canon bietet Abgleich nur statisch als LUT für eigene Kameras ([Canon](https://sg.canon/en/business/releases-free-pc-app-colour-matching-remote-and-main-cameras/news)), Sony beschreibt ihn manuell.
2. **Hautton über alle Kameras:** Gesichter je Kamera erkennen, Hautverteilungen farbig in einem Vectorscope überlagern. Nobe kann es nur je Quelle.
3. **Drift-Wächter während der Show:** Schwarzboden und Neutralstatistik je Kamera verfolgen, Alarm bei Abweichung vom Gruppenmittel (LED-Licht, Wolken, [13ik5e1](https://www.reddit.com/r/VIDEOENGINEERING/comments/13ik5e1/video_shading/)).
4. **Black-/Flare-Assistent:** Schwarz-Schwerpunkt bei geschlossener und offener Blende vergleichen, Differenz als Flare-Vektor ([1qtm2oq](https://www.reddit.com/r/VIDEOENGINEERING/comments/1qtm2oq/black_shading_question/)).
5. **Shutter-/Scanraten-Finder** für LED-Wände und -Licht: zeitliche FFT des Zeilenprofils, Shutter-Vorschlag mit ganzen Zyklen ([ENTTEC](https://support.enttec.com/pixel/pixel-general-knowledge/why-do-leds-flicker-on-camera), IEEE P2020 nur im Labor).
6. **Moiré-Messer:** 2D-FFT im Wandbereich, Aliasing als Risikoanzeige (Sony warnt nur aus der Geometrie, [Newsshooter](https://www.newsshooter.com/2023/04/13/sony-virtual-production-tool-set/)).
7. **Simulcast-Abweichungskarte:** ΔITP zwischen echtem und zurückgewandeltem Bild als Heatmap ([ProVideo Coalition](https://www.provideocoalition.com/fa-cup-final-broadcast-most-of-the-audience-watched-it-in-hd-sdr/)).
8. **Encoder-Konfidenz für Streams:** Programm gegen Rücklauf (HLS/RTMP) – Blockbildung, Banding, A/V-Versatz, live; für kleine Produktionen gibt es nichts ([Streaming Learning Center](https://streaminglearningcenter.com/?p=20297)).
9. **Objektiv-Fingerabdruck:** Farbabweichung und White Shading je Objektiv und Zoomstellung speichern, bei Wechsel abgleichen (Panasonic Lens Files nur für White Shading).

Herkunft der Liste: Recherche-Agent, Quellen nicht einzeln nachgeprüft; vor einer Umsetzung die jeweilige Primärquelle lesen.
