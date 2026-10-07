# Gesten: Zoom und Schwenken in den Scopes (#89)

Stand 07.10.2026. Mit Maus, Trackpad und Touch in jedem Scope zoomen und schwenken, ohne Messpunkt, Touch Shading, Dock und Seitenleiste zu stören.

## Wie es andere machen

- **OmniScope (Time in Pixels):** Rad zoomt um den Mauszeiger. Die Waveform zoomt nur senkrecht (0,5–20×), Leertaste + Ziehen schwenkt, Mittelklick oder Doppelklick setzt zurück. Das Vectorscope zoomt stufenlos in die Mitte des Plots. Beim Vectorscope kann das Rad wahlweise die Verstärkung steuern. Quellen: [Waveform](https://docs.timeinpixels.com/nobe-omniscope/scopes/waveform), [Vectorscope](https://docs.timeinpixels.com/nobe-omniscope/scopes/vectorscope).
- **DaVinci Resolve:** Die Scopes kennen den 2×-Zoom des Vectorscopes und Bereichsvorwahlen. Laut Forenbeiträgen zoomt Alt + Rad, die mittlere Taste schwenkt. Die Forenseite war nicht abrufbar (403), deshalb ist das hier nicht übernommen und nur als Hinweis notiert.
- **Browser:** Chromium (seit M35), Edge und Firefox (seit 55) liefern das Trackpad-Pinch als `wheel` mit `ctrlKey: true`, `deltaY` ist der Skalierungsschritt. Safari auf macOS liefert eigene `gesturestart`/`gesturechange`/`gestureend` mit laufendem `scale`. Mausrad und Trackpad unterscheidet man nur heuristisch (`deltaMode`, Größe und Ganzzahligkeit der Deltas). Quellen: [Dan Burzo, „Pinch me, I'm zooming“](https://danburzo.ro/dom-gestures/), [MDN gesturechange](https://developer.mozilla.org/en-US/docs/Web/API/Element/gesturechange_event).
- **Touch:** Pointer Events mit zwei Zeigern: Abstand → Zoom, Mittelpunkt → Schwenken. `touch-action: none` hält den Browser vom eigenen Zoomen und Scrollen ab. Quelle: [MDN Pinch zoom gestures](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures).

## Entscheidungen

| Eingabe | Wirkung |
|---|---|
| Mausrad | Zoom um den Mauszeiger, beim Vectorscope um die Mitte (wie OmniScope, die Neutralachse bleibt stehen) |
| Trackpad-Pinch (ctrl+wheel, Safari-Gesten) | Zoom um den Mauszeiger, auch im Vectorscope |
| Zwei-Finger-Scroll | Schwenken, Richtung wie beim Seitenscrollen |
| Mittlere Taste ziehen, ⇧ + ziehen | Schwenken |
| Zwei Finger | Spreizen = Zoom um die Finger, gemeinsam bewegen = Schwenken |
| Ein Finger bzw. linke Taste | Schwenkt einen vergrößerten Scope, wenn der Scope das Ziehen nicht selbst braucht |
| Doppelklick, Doppeltipp, Klick auf den Zoom-Chip | Zurücksetzen. Ohne Zoom bleibt der Doppelklick „Panel solo“. |

- **Keine Leertaste zum Schwenken**, anders als OmniScope: Die Leertaste ist hier Einfrieren bzw. Wiedergabe.
- **Waveforms und Paraden** zoomen nur senkrecht und bauen auf der gewählten Lupe auf (voll, Schwarz, Lichter). Der Bereich wird als Pegelbereich gerechnet. Dadurch skaliert die Beschriftung mit feineren Teilstrichen, und unten steht „LUPE lo … hi %“. 1–20×.
- **2D-Scopes** (Vectorscope, CIE, Diamond, Sättigung/Luma, Kanal-Plot, Histogramm) und das **Bild**: 1–16×, der vergrößerte Plot füllt immer den Rahmen. Der Shader rechnet `pos · z + (x, y)`, das Overlay zeichnet mit dem passend vergrößerten Rechteck und wird beschnitten. Linien, Ziele und Messpunkt bleiben so auf der Spur. Beschriftungen außerhalb des Plots (CIE-Achsen, Histogramm-Skala) bleiben sichtbar, solange ihre Linie im Panel liegt.
- **Bild:** Der Viewport deckt nur den sichtbaren Ausschnitt ab, die Texturkoordinaten werden beschnitten. So entsteht auch bei 16× kein übergroßer Viewport. Klick setzt weiter den Messpunkt, Ziehen den Messrahmen, beides am vergrößerten Bild.
- **3D-Volumen:** wie bisher ziehen = drehen, dazu dieselben Zoom- und Schwenkgesten. Der Zoom (0,3–8×) liegt weiter in `cube.zoom/panX/panY`.
- **Spurhelligkeit:** Beim Zoom wird das Gewicht der Punkte mit z² (2D) bzw. z (Waveform) erhöht, damit die Spur nicht verblasst.

## Konflikte

- **Touch Shading aktiv:** Die Finger gehören der Kamera, die Gesten nehmen keine Zeiger an. Rad und Trackpad-Pinch zoomen weiter, und das Shading rechnet mit dem vergrößerten Pegelbereich bzw. der verschobenen Vectorscope-Mitte.
- **Messpunkt und Messrahmen im Bild:** Die linke Taste und ein Finger bleiben beim Messen. Kommt ein zweiter Finger dazu, wird der angefangene Rahmen verworfen (`lzs-gesture-cancel`).
- **Hautton- und Grün-Waveform:** Die linke Taste zieht die Linien. Das Mausrad bleibt die Farbton-Toleranz, Pinch und Scroll vom Trackpad zoomen bzw. schwenken.
- **Dockview:** Panels werden an Tab und Kopf gezogen, die Gesten hängen nur am Panel-Körper.
- **Seitenleiste:** liegt außerhalb der Panels, ihr Scrollen bleibt unberührt. Das Rad wird nur abgefangen, wenn der Scope zoomen kann (Audio, Uhr, Tabellen nicht). In der Desktop-App verhindert das auch, dass ein Pinch das ganze Fenster zoomt.

## Prüfung

- `test/view.test.ts` prüft die Transformationsmathematik: Shader gegen Overlay, Zoom um den Cursor, Begrenzung, Waveform-Bereich gegen `waveY`/`waveLevel` und die Rad-Klassifizierung.
- `e2e/gestures.spec.ts` arbeitet mit synthetischen Events in der Desktop-App. Geprüft werden Trackpad-Pinch an der Waveform (Graustufen landen auf dem gezoomten Pegel), Zwei-Finger-Scroll, Doppelklick, Touch-Pinch und Doppeltipp am Vectorscope, Pinch, mittlere Taste und Zoom-Chip am Bild sowie der Vorrang von Touch Shading.
- **Ungeprüft:** echte Geräte (Magic Trackpad, Maus mit Freilaufrad, iPad) und Safari. Der iOS-Simulator stand nicht zur Verfügung, weil auf dem Rechner kein Xcode installiert ist. Die Unterscheidung Maus/Trackpad ohne `ctrlKey` ist eine Heuristik und kann bei hochauflösenden Mausrädern danebenliegen. Dann schwenkt das Rad statt zu zoomen, der Pinch zoomt weiterhin.
