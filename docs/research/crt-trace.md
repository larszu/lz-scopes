# CRT-/Analog-Trace (Issue #27)

Stand: 30.09.2026. Nur geöffnete Quellen.

| Quelle | Befund | Verwendung |
|---|---|---|
| woscope, github.com/m1el/woscope @ 74af1e3, MIT (© 2015 Igor Null, Chad von Nau), `shaders/vsLine.glsl`, `shaders/fsLine.glsl`, `shaders/fsBlurTranspose.glsl`, `LICENSE` | Jedes Segment zwischen zwei Abtastwerten ist ein Quad um die Linie (Halbbreite uSize, σ = uSize/4). Der Fragment-Shader integriert einen Gaußfleck analytisch entlang des Segments: (erf((len−x)/(√2σ)) + erf(x/(√2σ)))·exp(−y²/2σ²)/(2·len)·uSize; bei len ≈ 0 ein Punkt. erf nach Abramowitz & Stegun 7.1.27. Glow als 9-Tap-Unschärfe (1…5…1)/25 in zwei Richtungen. | Prinzip und erf-Näherung übernommen (MIT, Hinweis in `licenses/woscope-LICENSE.txt`, THIRD_PARTY.md). Neu: WebGL2, Energie je Segment auf 1 normiert (Helligkeit ∝ 1/Strahlgeschwindigkeit, gleiche Gesamthelligkeit wie der Punktmodus), eigene Nachleucht- und Glow-Pässe |
| Wikipedia „Phosphor“, Tabelle „Standard phosphor types“ (abgerufen 30.09.2026; verweist auf Shionoya, Phosphor Handbook, CRC 1999) | P1: Zn₂SiO₄:Mn, grün 525 nm, 1–100 ms, Oszilloskope. P7: (Zn,Cd)S:Cu, blau mit gelbem Nachleuchten 440/558 nm, lang, Radar/frühe Oszilloskope. P31: ZnS:Cu, gelblich grün, 0,01–1 ms, Oszilloskope | Phosphor-Presets; Farben als sRGB-Näherung der Wellenlängen (nicht farbmetrisch), τ-Voreinstellung 0,5 ms / 30 ms / 1,5 s aus den Klassen |
| osci-render | GPL – laut Issue nur als Idee, nicht geöffnet und nicht verwendet | – |

## Umsetzung

- `src/crt.ts`: Einstellungen, Phosphore, Strahldichte (CPU-Spiegel für Tests), Shader.
- Waveforms: Segmente zwischen benachbarten Abtastwerten einer Bildzeile; vorher horizontal auf die Scope-Breite reduziert (Schrittweite = Quellbreite / Panelbreite je Sektion). Vectorscope und CIE: Segmente zwischen aufeinanderfolgenden Abtastwerten in Abtastreihenfolge.
- Budget 150 000 Segmente je Scope und Bild (statt bis 4 Mio. Punkte).
- Nachleuchten: neu = aktuell·(1 − d) + alt·d, d = exp(−Δt/τ); konvergiert gegen die aktuelle Spur (Helligkeit unabhängig von τ), nur bewegte Spuren ziehen einen Schweif. „unendlich“ = Maximum (Speicheroszilloskop).
- P7 zweifarbig: wo der Strahl gerade ist, blau; was nur nachleuchtet, gelb.

## Grenzen

- Ein Look, keine Messung: Pegel und Positionen bleiben dieselben wie im Digitalmodus, aber der Glow verbreitert die Spur optisch.
- Nachleuchten wird je Anzeige-Frame gerechnet, nicht je Strahlweg innerhalb eines Bildes.
- In Software-WebGL (SwiftShader) ist der Modus langsam; mit GPU ungeprüft auf schwachen Rechnern.
