# Audiogenerator und Audioanalyser für LZ Scopes – Recherche

Stand: 29.09.2026. Nur Recherche, kein Produktcode. Normwerte stammen aus den geöffneten PDFs (Links unter [Quellen](#quellen)). Seitenangaben beziehen sich auf die **PDF-Seite** (p). Was als **Einschätzung** markiert ist, ist eine eigene Bewertung und nicht belegt. Angaben aus Sekundärquellen stehen ausdrücklich als solche da.

Ziel: Generator und Analyser „wie VMA, aber besser“, eingebettet in LZ Scopes (Browser/Electron, Bridge mit ffmpeg).

---

## (a) VMA: was die beiden Seiten können

Beide Seiten sind per JS obfuskiert (der Seiteninhalt wird zur Laufzeit geschrieben, danach sind keine `<script>`-Elemente mehr im DOM). Ausgewertet mit headless Chrome über CDP: DOM-Texte nach dem Rendern ausgelesen und die Web-Audio-API vor dem Laden per `Page.addScriptToEvaluateOnNewDocument` angezapft (Aufrufe von `getUserMedia`, `createAnalyser`, `fftSize`, AudioParam-Rampen usw. mitgeschrieben). Für den Analyser lieferte Chrome über `--use-fake-device-for-media-stream` ein künstliches Mikrofon.

### A.1 Audio Test Tone Generator (`audiogenerator.htm`)

_(Screenshot der Fremdsoftware entfernt – Urheberrecht; Beschreibung siehe Text.)_

| Bereich | Bedienelemente und Werte (wörtlich) |
|---|---|
| **Main tone** | Waveform: *Sine, Square, Sawtooth, Triangle, White noise* · Frequency A (Hz) 20–20 000, Standard 1000 (Zahl + Schieber) · Frequency B (Hz, nur Dual-Tone) Standard 1200 · Master level 0–1, Schritt 0,01, Standard 0,3 („Approx. relative level“) |
| **Stereo mode** | *Mono (L = R), Left only, Right only, Out of phase (L = +, R = −), Dual tone (A left, B right)* |
| **Kanaltrims** | Left channel level, Right channel level, je 0–1 |
| Steuerung | *Start tone*, *Stop tone*, Status („running: sine 1000 Hz (dual)“) · Werte ändern sich live |
| **Frequency sweep** | Start (Hz) 20, End (Hz) 20 000, Duration 0,5–60 s (Standard 10) · *Play sweep (one-shot)*, *Stop sweep* · Status |
| **Presets** | *1 kHz mono, 1 kHz left only, 1 kHz right only, 440 Hz (concert A), Dual-tone 350/440 Hz, Noise check* |
| **Audio vectorscope** | L auf der X-Achse, R auf der Y-Achse, Lissajous des erzeugten Signals |
| Hinweise | Safety-Warnung, „All processing happens locally … Web Audio API“ |

Implementierung (aus den abgefangenen API-Aufrufen): `OscillatorNode` + `ChannelMerger(2)` + `GainNode`, ein `AnalyserNode` (fftSize 2048) für das Vectorscope. Der Sweep ist ein **exponentieller** Sinus-Sweep (`exponentialRampToValueAtTime 20 → 20 000`), immer Sinus, unabhängig von der gewählten Wellenform. Rauschen ist ein **2-s-Stereo-Puffer** (`createBuffer(2, 96000, 48000)`) als `AudioBufferSourceNode`, vermutlich in Schleife. **Einschätzung:** Damit wiederholt sich das Rauschen alle 2 s.

Schwächen:
- Pegel nur relativ (0–1), keine Angabe in dBFS, kein Preset für den Ausrichtungspegel −18 dBFS.
- Kein Rosa Rauschen, keine Stereo-Idents (EBU, GLITS, BLITS), kein Mehrkanal, keine Wahl des Ausgabegeräts.
- Die Beschriftung des Vectorscopes widerspricht sich selbst: Bei L=X und R=Y ist gegenphasig eine Diagonale von links oben nach rechts unten, keine senkrechte Linie. Senkrecht wäre gegenphasig nur beim um 45° gedrehten Goniometer, und dort wäre Mono senkrecht, nicht diagonal.

### A.2 Audio Analyser (`audioanalyser.htm`)

_(Screenshot der Fremdsoftware entfernt – Urheberrecht; Beschreibung siehe Text.)_

| Bereich | Inhalt |
|---|---|
| Eingang | Auswahl *Microphone* / *Audio File* (Datei-Input), *Start*, *Stop*, Positionsschieber (`seek`, 0–1) für Dateien |
| **Oscilloscope (Time Domain)** | ±1,0; Anzeige „42.7 ms @ 48 kHz“ (= 2048 Samples) |
| **Spectrum Analyser (dBFS)** | 0 bis −80 dBFS, **lineare** Frequenzachse bis Nyquist (24 kHz), Anzeige „SR 48 kHz“ |
| **Level Meters (VU)** | Balken L/R, Skala 0 … −20, „0 VU = −18 dBFS“, Spitzenmarke |
| **Stereo Phase / Correlation** | Lissajous (L→ / R↑), Korrelationsgrad als Zahl („Corr 1.00“), Skala −1 … +1 |
| **Analog Stereo VU (180°)** | zwei gezeichnete Zeigerinstrumente, „VU only · calibrated“ |
| Bedienung | Tippen auf ein Panel maximiert es |

Implementierung: `getUserMedia({audio: true})` **ohne weitere Constraints**, `ChannelSplitter(2)`, `AnalyserNode` mit fftSize 2048 und smoothingTimeConstant 0,7. Kein AudioWorklet.

Schwächen:
- `audio: true` lässt Echounterdrückung, Rauschunterdrückung und automatische Pegelregelung des Browsers eingeschaltet. Die gemessenen Pegel sind dadurch geregelt, und Chrome mischt Stereo laut addpipe.com bei aktiver Echounterdrückung zu Mono (Sekundärquelle). Für Messtechnik ist das untauglich.
- Keine Geräteauswahl (nur „Microphone“), keine Kanalzahl über 2.
- **Kein Loudness nach BS.1770/R 128**, kein True Peak, kein Sample-Peak in dBFS, kein PPM, keine Verlaufsanzeige, keine Protokollierung.
- Spektrum mit linearer Frequenzachse und fester FFT-Größe, keine Oktav- oder Terzbänder.

---

## (b) Was andere Werkzeuge besser machen

| Werkzeug | Stärke, die sich zu übernehmen lohnt | Quelle |
|---|---|---|
| **Youlean Loudness Meter 2** | M/S/I, LRA, TP, **PLR** (True Peak − Integrated) und **PSR** (PLR im 3-s-Fenster); Verlaufsgraph, Histogramm und Lautheitsverteilung; Presets für Film/TV/Gaming/Streaming, eigene Presets; **Export als PDF/PNG/SVG** | youlean.co, KVR |
| **NUGEN VisLM** | Verlauf bis 24 h, **an Timecode gekoppelt**; True-Peak-Überschreitungen als anspringbare Marken im Verlauf; **Dialog Gate** (misst nur Dialoganteile) | nugenaudio.com |
| **TC Electronic LM2 / Clarity M** | **Radar-Anzeige**: Außenring Momentary, Radarzeiger Short-term-Verlauf, 12-Uhr-Position = Zielwert, Ringabstand und Umlaufzeit einstellbar (Standard 6 dB, 4 min); Clarity M zusätzlich Downmix-Prüfung, Stereo-/Surround-Korrelation, RTA | KVR, SOS |
| **RTW TouchMonitor** | PPM mit mehreren Skalen, Zeigerinstrumente PPM/VU, Vectorscope; Routing Mono bis 7.1 und Multikanal; **Surround Sound Analyzer**; Multikorrelator; modular lizenzierbar | rtw.com |
| **iZotope Insight 2** | Intelligibility Meter (Dialog gegen Mischung), 2D-/3D-Spektrogramm, Surround Scope (bis 7 Kanäle), Sound Field mit Vectorscope | izotope.com |
| **Voxengo SPAN** | Spektrum mit **4,5 dB/Oktave Neigung** (einstellbar), Glättung, M/S-Analyse, Korrelation, Pegelstatistik und Clipping-Zähler, R-128- und K-Metering | voxengo.com |
| **loudness-worklet** (MIT, npm) | BS.1770-5 als AudioWorkletProcessor: M/S/I, LRA, TP; gibt an, alle Testsignale aus BS.2217, Tech 3341 und Tech 3342 zu bestehen; beliebige Abtastraten; Kanalgewichte für 1, 2, 5, 6, 8, 10, 12 und 24 Kanäle | github.com/lcweden/loudness-worklet |
| **libebur128** (MIT, C) | Referenz für die K-Filter-Formel bei beliebiger Abtastrate (siehe c) | github.com/jiixyj/libebur128 |

**Einschätzung:** Kein Software-Werkzeug aus der Liste verbindet Bild- und Tonmessung desselben Netzwerkstroms. Die Bridge liefert beides aus einem ffmpeg-Prozess. Daraus ergeben sich Funktionen, die VMA und die Plugins nicht haben: A/V-Versatz messen, Ton und Bild einer RTSP-Kamera in einem Layout, ein gemeinsamer Generator für Testbild und Testton.

Nicht recherchiert: die Fairlight-Meter in DaVinci Resolve, PPM-Ballistik nach IEC 60268-10 (die Norm ist nicht frei verfügbar) und ATSC A/85.

---

## (c) Normwerte

### c.1 ITU-R BS.1770-5 (11/2023) – Lautheit und True Peak

**K-Filter, 48 kHz** (p6–7, Tabellen 1 und 2). Biquad-Form `y = b0·x + b1·x[−1] + b2·x[−2] − a1·y[−1] − a2·y[−2]` mit a0 = 1:

| | Stufe 1 (Shelving, „Kopf“) | Stufe 2 (Hochpass, RLB) |
|---|---|---|
| b0 | 1.53512485958697 | 1.0 |
| b1 | −2.69169618940638 | −2.0 |
| b2 | 1.19839281085285 | 1.0 |
| a1 | −1.69065929318241 | −1.99004745483398 |
| a2 | 0.73248077421585 | 0.99007225036621 |

Die Norm gibt nur die 48-kHz-Werte an. Andere Abtastraten brauchen laut Norm Koeffizienten mit „the same frequency response“ (p6), eine Formel steht nicht drin.

**Formel für beliebige Abtastraten** (aus libebur128, `ebur128_init_filter`, MIT). Nachgeprüft: Bei fs = 48 000 kommen die Tabellenwerte auf mindestens 13 Nachkommastellen heraus.

```ts
// Stufe 1: High-Shelf
const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
let K = Math.tan(Math.PI * f0 / fs);
const Vh = 10 ** (G / 20), Vb = Vh ** 0.4996667741545416;
let a0 = 1 + K / Q + K * K;
const s1 = { b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
             a1: 2 * (K * K - 1) / a0,           a2: (1 - K / Q + K * K) / a0 };
// Stufe 2: Hochpass
const f1 = 38.13547087602444, Q2 = 0.5003270373238773;
K = Math.tan(Math.PI * f1 / fs); a0 = 1 + K / Q2 + K * K;
const s2 = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q2 + K * K) / a0 };
```

Ergebnisse aus dieser Formel, *berechnet*:

| fs | Stufe 1 b0, b1, b2 | Stufe 1 a1, a2 | Stufe 2 a1, a2 |
|---|---|---|---|
| 44 100 | 1.5308412300503478, −2.6509799951547297, 1.169079079921587 | −1.6636551132560204, 0.7125954280732254 | −1.989169673629796, 0.9891990357870393 |
| 48 000 | 1.5351248595869702, −2.6916961894063807, 1.19839281085285 | −1.6906592931824103, 0.7324807742158501 | −1.9900474548339797, 0.9900722503662099 |
| 96 000 | 1.5597142289757966, −2.9267415782510824, 1.3782612023158187 | −1.8446094698901085, 0.8558433229306412 | −1.9950175447247156, 0.9950237590409233 |

**Messung** (p7–9):
- Mittlere Leistung je Kanal z_i nach dem K-Filter. Lautheit `L = −0.691 + 10·log10(Σ G_i · z_i)` in LKFS (= LUFS).
- Gating-Blöcke Tg = 400 ms, Überlappung 75 % (Schritt 100 ms). Unvollständige Blöcke am Ende zählen nicht.
- Absolute Schwelle Γa = −70 LKFS. Relative Schwelle Γr = Lautheit der Blöcke über Γa, minus 10. Integrierte Lautheit aus den Blöcken mit l_j > Γa **und** l_j > Γr (Gl. 7).
- Kanalgewichte (Tabelle 3): L, R, C je 1.0; Ls, Rs je 1.41 (≈ +1,5 dB); LFE wird nicht gemessen. Annex 3 (p22–24): Gewicht nach Richtung. |φ| < 30° und 60° ≤ |θ| ≤ 120° ergibt 1.41, alles andere 1.00.
- Kontrolle: Ein Sinus mit 0 dBFS und 997 Hz auf L, C oder R ergibt −3,01 LKFS (p9). Der Wert −0.691 gleicht die Verstärkung des K-Filters bei 997 Hz aus.

**True Peak** (Annex 2, p20):
1. 12,04 dB abschwächen (entfällt bei Gleitkomma).
2. 4-fach überabtasten (48 → 192 kHz). Höhere Abtastraten brauchen weniger Überabtastung, 96 kHz zum Beispiel 2-fach.
3. Tiefpass. Beispiel in der Norm: FIR-Interpolator der Ordnung 48 mit 4 Phasen zu je 12 Taps, Koeffizienten auf p20 (Phase 0 beginnt mit 0.0017089843750, 0.0109863281250, −0.0196533203125, …; Phasen 1 bis 3 folgen tabelliert).
4. Betrag bilden.
5. `20·log10` + 12,04 dB ergibt dB TP. Die Einheit dB TP ist nur für Messgeräte mit mindestens 192 kHz Überabtastrate vorgesehen.

### c.2 EBU Tech 3341 (2023) – „EBU Mode“

- **M** = gleitendes Rechteckfenster 0,4 s, **S** = 3 s, beide ohne Gating. S wird bei Live-Messgeräten mindestens mit 10 Hz aktualisiert, **I** mit Gating nach BS.1770 mindestens mit 1 Hz (p5). Keine zusätzliche Ballistik.
- Pflichtbedienung: I und LRA gemeinsam starten, pausieren, fortsetzen und zurücksetzen. Max M und Max S müssen anzeigbar sein und werden mit I zurückgesetzt (p4–5).
- Live-Messgerät: Bei jeder Aktualisierung wird I aus den gespeicherten Blocklautheiten neu berechnet, weil die relative Schwelle mitwandert (p5).
- LRA: In den ersten 60 s nach einem Reset als „noch nicht stabil“ kennzeichnen (p6).
- **Skalen** (p6): „EBU +9“ = −18 … +9 LU (−41 … −14 LUFS), ist Standard; „EBU +18“ = −36 … +18 LU (−59 … −5 LUFS). Absolute (LUFS) und relative Skala (LU, 0 LU = −23 LUFS) müssen beide wählbar sein. Höchstens eine Nachkommastelle, die Einheit wird immer mit angezeigt (p7).
- Mindestumfang: Programme Loudness, LRA, Max True Peak (p7).
- **Kalibrierung:** 1-kHz-Sinus in Stereo, gleichphasig, Spitzenpegel −18 dBFS, muss −18,0 LUFS ergeben (p7).
- **Mindestanforderungen**, Tabelle 1 (p8–9), Auszug. Toleranz jeweils ±0,1 LU, beim True Peak +0,2/−0,4 dB:
  - #1: 1 kHz Stereo mit −23 dBFS über 20 s ergibt M = S = I = −23,0 LUFS. #2: −33 dBFS ergibt −33,0.
  - #3–#5: Gating-Tests (Pegelwechsel −36/−23/−36 dBFS, −72 dBFS unter der absoluten Schwelle, 20,1 s mit −20 dBFS gegen −26 dBFS), alle ergeben I = −23,0.
  - #6: 5.0 mit L/R −28, C −24, Ls/Rs −30 dBFS ergibt I = −23,0.
  - #9/#12: Rechteckwechsel prüfen die Fenster für S und M. #10/#11 und #13/#14: Max S und Max M für dateibasierte bzw. Live-Messgeräte.
  - #15–#19: Sinus mit fs/4, fs/6 oder fs/8, 0,50 FFS und Phasen 0°/45°/60°/67,5° ergibt −6,0 dBTP. Mit 1,41 FFS ergibt sich +3,0 dBTP.
  - #20–#23: eine Periode fs/4 in fs/6, mit 4·fs erzeugt und mit 0 bis 3 Samples Versatz heruntergetastet, ergibt 0,0 dBTP.
- LFE, falls überhaupt mitgemessen: mit +10 dB gewichten (p9).

### c.3 EBU Tech 3342 (2023) – Loudness Range

- Eingang sind Short-term-Werte (3-s-Fenster) mit mindestens 10 Hz, also mindestens 2,9 s Überlappung (p4).
- Absolute Schwelle −70 LUFS, **relative Schwelle −20 LU** (nicht −10 wie bei I).
- LRA = 95. Perzentil − 10. Perzentil der verbleibenden Werte (p5). MATLAB-Referenz auf p7: Die Energie der Werte über −70 wird gemittelt, Schwelle = Mittel − 20, Perzentil über den Index `round((n−1)·p/100 + 1)` der sortierten Werte.
- Tests (p6): 1 kHz Stereo, 2 Töne −20/−30 dBFS ergibt 10 ±1 LU; −20/−15 ergibt 5; −40/−20 ergibt 20; 5 Stufen ergeben 15 LU.
- Für Programme unter 1 min rät R 128 von LRA ab (R 128 Fußnote 2).

### c.4 EBU R 128 (V5, 11/2023) und Ergänzungen

- Zielwert **−23,0 LUFS**, bei Live-Produktion Toleranz ±1,0 LU, in der Qualitätskontrolle ±0,2 LU Messtoleranz (p3).
- **Max True Peak −1 dBTP** in der Produktion, Messtoleranz ±0,3 dB (p4).
- LRA, Max M und Max S sind optionale Kennwerte (p4).
- **R 128 s1** (Werbung und Trailer): −23,0 LUFS, **Max S ≤ −18,0 LUFS** (+5 LU), −1 dBTP (p3).
- **R 128 s2** (Streaming): unverändert −23,0 LUFS streamen. Wo der Ausspielweg es verlangt, darf der Distribution Loudness Level höher liegen, empfohlen −20,0 bis −16,0 LUFS (p4).

### c.5 EBU R 68-2000 – Ausrichtungspegel

Ausrichtungspegel = **18 dB unter dem maximalen Codierpegel**, unabhängig von der Bitzahl (p1). Fußnote: genau 1:8 = 18,06 dB. Tabelle 1 nennt die Codes, zum Beispiel 16 bit: Maximum 7FFF, Ausrichtung 0FFF.

### c.6 EBU Tech 3343 (2023) und Tech 3344 (V2.1, 2016)

- 3343 §8.1 (p22): Ausrichtung weiterhin mit **1 kHz bei −18 dBFS**. Das ergibt −18 LUFS bzw. +5 LU, wenn der Ton gleichphasig auf L und R liegt. Die EBU empfiehlt fürs Ausrichten einen **Peak-Meter**, keinen Loudness-Meter (K-Filter-Flanke bei 1 kHz).
- 3343 §8.2 (p22–23): Abhörpegel **LLISTref = 73 dBC SPL** je Lautsprecher, mit Rosa Rauschen 500–2000 Hz (Filter mindestens Terzfilter nach IEC 61260) bei −23 LUFS, mono. Kanäle untereinander ≤ 1 dB, Frontpaar < 0,5 dB. LFE: +10 dB In-Band-Verstärkung, Prüfung mit Rosa Rauschen 60–120 Hz (LFE) gegen 200–400 Hz (Hauptkanal).
- 3344 (p26): Vor Codecs einen Limiter auf **−2 dBTP** setzen, bei niedrigen Bitraten tiefer. −12 dBTP entspricht dem Referenzpegel nach CENELEC EN 50049, −23 dBTP (1 kHz auf L+R) entspricht −23 LUFS.

### c.7 Idents und Aufsprechsignale (EBU Tech 3304, 2009)

- **EBU-Stereo-Ident** (nach R 49, beschrieben in Tech 3304 §2.1, p5): 1 kHz beim Ausrichtungspegel, **Kanal 1 (L) alle 3 s für 250 ms unterbrochen**. Laut SOS (Sekundärquelle) ergibt die Mono-Summe Einbrüche von −6 dB, bei vertauschter Polarität dagegen 250-ms-Pips bei −24 dBFS.
- **BLITS** (§4.1, p6–7). Frequenzen: L = R = 880 Hz, C = 1320 Hz, LFE = 82,5 Hz, Ls = Rs = 660 Hz.
  - Abschnitt 1: je Kanal ein Burst von 600 ms mit −18 dBFS, 200 ms Abstand, danach 200 ms Stille (0–4,80 s). Reihenfolge laut vhs-decode-Wiki (Sekundärquelle): L, R, C, LFE, Ls, Rs.
  - Abschnitt 2: 1 kHz bei −18 dBFS. R läuft 5,1 s durch. L ist nach 1 s für 300 ms unterbrochen, dann dreimal 300 ms an und 300 ms aus, danach 2 s Dauerton. Anschließend 300 ms Stille (4,80–10,20 s).
  - Abschnitt 3: 2 kHz bei **−24 dBFS**, alle Kanäle gleichphasig, 3 s, danach 200 ms Stille. Gesamtdauer **13,40 s**, in Schleife.
- **EBU-Mehrkanal-Ident** (§4.2, p8): 3 s 1 kHz auf allen Hauptkanälen, 0,5 s Stille, dann jeder Kanal einzeln im Uhrzeigersinn ab vorn links (0,5 s Ton, 0,5 s Pause), 1 s Stille, Wiederholung. LFE: 80 Hz Dauerton.
- **GLITS** (Wikipedia, Sekundärquelle): 1 kHz bei −18 dBFS, Zyklus 4 s. L ist einmal für 250 ms unterbrochen; 250 ms danach ist R zweimal für 250 ms unterbrochen, mit 250 ms Abstand.

### c.8 Weitere Werte

- **A/V-Versatz, ITU-R BT.1359-1** (p1): Wahrnehmbarkeit ab etwa +45 ms (Ton vor dem Bild) bzw. −125 ms (Ton nach dem Bild). Akzeptanzschwelle etwa +90/−185 ms. Gesamtkette höchstens +90/−185 ms, empfohlener Arbeitsbereich +25/−100 ms. Vom Ende der Produktion bis zum Sendereingang +22,5/−30 ms.
- **Korrelationsgrad:** Eine frei zugängliche Normdefinition wurde nicht gefunden (AES17 behandelt ihn nicht, IEC 60268-18 ist ein Peak-Meter-Bericht). Üblich ist `r = Σ(L·R) / √(ΣL²·ΣR²)` über ein gleitendes Fenster. Die Zeitkonstante „um 600 ms“ stammt nur von SOS (Sekundärquelle). **Einschätzung:** Formel und Zeitkonstante einstellbar machen und dokumentieren.

---

## (d) Empfohlener Funktionsumfang „besser als VMA“

Grundsatz nach [Schnell starten]: Messen beginnt ohne Pflichtfelder, Presets statt Formulare.

### Muss (erste Version)

**Generator**
1. Sinus 10 Hz – 20 kHz, Standard 997 Hz bzw. 1 kHz. Pegel **in dBFS** (Spitze), Schnellwahl −18 (R 68), −20, −23, −9 und 0 dBFS. Anzeige zusätzlich in dBTP und LUFS, damit klar ist, was ein Messgerät anzeigen muss.
2. Routing je Kanal: an/aus, Polarität umkehrbar, eigener Pegel. Presets L, R, L+R, L−R.
3. **Idents**: EBU-Stereo, GLITS, 1 kHz Dauerton, sample-genau erzeugt.
4. **Rosa und weißes Rauschen**, nicht periodisch. Wahlweise korreliert (Mono) oder dekorreliert. Bandbegrenzung 500–2000 Hz für Tech 3343 (LLISTref).
5. Log-Sweep mit wählbarer Dauer und Wiederholung. Stufen-Sweep (Terzmitten) zum Ablesen am Fremdgerät.
6. **Ausgabegerät wählen** (`AudioContext.setSinkId`). Sanftes Ein- und Ausblenden (10 ms), Pegelgrenze mit Bestätigung über −6 dBFS.

**Analyser**
1. Quellen: Audiogerät (Geräteliste, **echoCancellation/noiseSuppression/autoGainControl aus**), Audio aus Video- und Audiodateien, **Ton des Bridge-Streams** (RTSP/SRT/…, siehe e).
2. **Loudness nach BS.1770-5 / Tech 3341**: M, S, I, LRA, Max M, Max S, Max TP. Start, Pause und Reset. Skalen EBU +9/+18, absolut/relativ, Zielwert-Presets (R 128, R 128 s1, R 128 s2).
3. **Pegelmeter je Kanal**: Sample-Peak und True Peak in dBFS/dBTP, Peak-Hold, Überlaufzähler, Skala mit Markierungen −18 und −1.
4. **Korrelationsgradmesser und Goniometer** (M/S-Darstellung, 45° gedreht, Mono senkrecht) mit richtiger Beschriftung.
5. **Spektrum** mit logarithmischer Frequenzachse, FFT-Größe wählbar, Neigung 0/3/4,5 dB/Okt., Terzbänder als Balken.
6. **Lautheitsverlauf** (S und M über die Zeit, Zielband eingeblendet).
7. **Selbsttest**: Die Testsignale aus Tech 3341 (#1–#23) und Tech 3342 (#1–#4) erzeugt LZ Scopes selbst. Sie laufen in vitest gegen den DSP-Kern und lassen sich in der App vom Generator in den Analyser schleifen. **Einschätzung:** Das ist der sichtbarste Unterschied zu VMA, weil die Messwerte damit belegt sind.

### Soll

1. **Ident-Erkennung im Analyser**: erkennt EBU, GLITS und BLITS und meldet „L/R vertauscht“, „Polarität R invertiert“ oder „Kanal fehlt“. Das bietet keines der recherchierten Werkzeuge in dieser Form (Einschätzung).
2. **BLITS und EBU-Mehrkanal-Ident, 5.1-Generator und 5.1-Metering** (Gewichte nach Tabelle 3, LFE ausgenommen), soweit das Gerät die Kanäle hergibt.
3. **Polaritätstest**: asymmetrischer Puls oder Sägezahn im Generator, Anzeige „+“ oder „−“ je Kanal im Analyser.
4. **A/V-Sync**: Das Testbild-Ausgabefenster blitzt, der Generator gibt gleichzeitig einen Piep aus. Der Analyser misst im Bridge-Stream den Versatz zwischen Blitz (Luma-Sprung) und Piep und bewertet ihn gegen BT.1359 (+45/−125 und +90/−185 ms). Bild und Ton kommen aus demselben ffmpeg-Prozess, das ist der Kern von „besser“.
5. Audio-Panels in den bestehenden Layouts (Meter, Goniometer, Spektrum, Verlauf). Kompakter Pegelbalken als Einblendung am Bild-Panel.
6. PLR/PSR, Protokoll als CSV und PNG/PDF (Verlauf + Kennwerte), True-Peak-Marken im Verlauf zum Anspringen.
7. **Dateianalyse schneller als Echtzeit** (ganze Datei in einem Worker, Ergebnis I/LRA/TP sofort). Tech 3341 erlaubt ausdrücklich dateibasierte Messgeräte.

### Kann

- Spektrogramm (2D, WebGL), Radar-Anzeige wie LM2, K-Meter, PPM-Varianten (erst nach Klärung von IEC 60268-10).
- Messung im Kreis (Generator → Gerät → Analyser): Laufzeit, Frequenzgang aus Sweep-Entfaltung, THD+N.
- Dialog Gate bzw. Sprachanteil, Intelligibility.
- Bridge-seitige Dauermessung ohne offenen Browser (ffmpeg-Filter `ebur128` als Gegenprobe oder DSP-Kern in Node), mit Alarm.
- Mehrkanal-Eingänge über 2 Kanäle (siehe e.3).

---

## (e) Technische Architektur

### e.1 Bausteine

```
src/audio/
  dsp/            reines TS, ohne DOM, getestet in vitest
    kweight.ts    Biquads nach c.1 (Formel für jedes fs)
    loudness.ts   100-ms-Teilblöcke → M (4 Blöcke), S (30 Blöcke), I (Gating), Max M/S
    lra.ts        Tech 3342 (S-Werte ≥10 Hz, −70 / −20, Perzentile 10/95)
    truepeak.ts   4× polyphasige FIR (Koeffizienten BS.1770 Annex 2), bei fs ≥ 96 kHz 2×
    meters.ts     Sample-Peak, RMS, Korrelation, M/S, Polarität, Ident-Erkennung
    signals.ts    Generator-Signale (Sinus, Idents, Rosa Rauschen, Sweep) + Tech-3341/3342-Testsignale
  worklet/
    analyser.worklet.ts   AudioWorkletProcessor: ruft dsp/* auf, schickt Schnappschüsse mit 20–30 Hz
    generator.worklet.ts  AudioWorkletProcessor: signals.ts, sample-genaue Idents
  worker/
    offline.worker.ts     Dateien und Bridge-PCM ohne AudioContext-Takt (dsp/* direkt)
  sources.ts      AudioSource: device | element | file | bridge
  panels/         Meter, Goniometer, Spektrum, Verlauf (Canvas 2D oder der vorhandene WebGL-Renderer)
```

Warum die DSP im eigenen Kern statt `AnalyserNode`: `AnalyserNode` liefert nur Blöcke mit Glättung und keine lückenlosen Samples. Für Gating, 400-ms-Fenster und True Peak braucht man jede Probe. Ein Kern, drei Hüllen (Worklet für Live-Eingänge, Worker für Dateien und Bridge, vitest für die Normtests) sichert gleiche Ergebnisse auf allen Wegen.

Eigenbau oder loudness-worklet (MIT): **Einschätzung** Eigenbau des Kerns (etwa 400 Zeilen), loudness-worklet und libebur128 dienen als Gegenprobe in den Tests. Die eigene Ident-, Polaritäts- und A/V-Logik braucht ohnehin Zugriff auf die Samples.

### e.2 Quellen im Browser

| Quelle | Weg | Anmerkung |
|---|---|---|
| Audiogerät | `getUserMedia({audio: {deviceId: {exact}, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: {ideal: 2}}})` → `MediaStreamAudioSourceNode` → Worklet | Geräteliste über `enumerateDevices()` erst nach Freigabe mit Namen. AudioContext mit der Geräterate anlegen (meist 48 000), sonst resampelt der Browser und verfälscht True Peak leicht (**Einschätzung**). |
| Video-/Audiodatei (Wiedergabe) | vorhandenes `<video>` aus `src/sources.ts` → `createMediaElementSource` → Worklet | Das Element ist derzeit `muted`. Ob ein stummgeschaltetes Element im Graphen Stille liefert, ist zu prüfen (offene Frage). Sonst `muted = false` setzen und den Graphen nicht an `destination` hängen. |
| Datei (Messung) | `decodeAudioData` → offline.worker | Ganze Datei schneller als Echtzeit, Ergebnis wie bei dateibasierten Messgeräten. |
| Bridge-Stream | WebSocket (e.4) → offline.worker (Messung) und optional Ring-Puffer → Worklet → `setSinkId` (Abhören) | Messung ohne AudioContext-Takt, also keine Taktdrift zwischen Kamera und Soundkarte. Nur das Abhören braucht Drift-Ausgleich. |
| Generator | generator.worklet → `ChannelMerger` → `destination`, `ctx.setSinkId(id)` | Seit Chrome 110 verfügbar (Chrome-Blog). Mehrkanal: `destination.maxChannelCount` prüfen, `channelInterpretation = 'discrete'`. |

Latenz: Ein AudioWorklet arbeitet in Blöcken zu 128 Samples (2,7 ms bei 48 kHz). Die Anzeige läuft über `requestAnimationFrame`. Maßgeblich ist ohnehin das Messfenster (M = 400 ms). Für den Generator `latencyHint: 'interactive'`. `ctx.baseLatency` und `ctx.outputLatency` werden angezeigt und für den A/V-Sync-Piep verrechnet. Den verbleibenden Versatz der Bildausgabe (Display-Pipeline, etwa 1 Frame) kann nur eine Kalibrierung klären (**Einschätzung**).

`SharedArrayBuffer` für Ring-Puffer braucht Cross-Origin-Isolation (COOP/COEP). In Electron und über die Bridge lässt sich das setzen. Ohne Isolation genügt `MessagePort` mit Transfer der Puffer.

### e.3 Grenze Mehrkanal-Eingang

Chrome liefert über `getUserMedia` höchstens 2 Kanäle. Mehrkanal-Interfaces kommen nicht vollständig an (Chromium-Issue 40403559, laut addpipe.com und dem Issue-Tracker weiterhin offen). Für 5.1, SDI-Embedded-Audio oder Dante-Mehrkanal:
- **Bridge-Eingang `device:`**: ffmpeg liest lokal (`-f avfoundation` / `dshow` / `alsa`) und schickt PCM über dasselbe Protokoll. Nur bei Bindung an `127.0.0.1` erlauben, feste Geräteliste statt freier ffmpeg-Optionen (Sicherheitsregel aus dem README bleibt).
- Oder ein natives Modul in Electron (Kann).

### e.4 Bridge: Protokollerweiterung Audio

Heute: `-an`, Binärnachricht = ein Bild ohne Kopf. Vorschlag, abwärtskompatibel über eine Query-Option:

**Anfrage:** `/stream?url=…&audio=1` (optional `&video=0` für reine Tonquellen). Ohne `audio=1` bleibt alles wie bisher. Alte Hosts wie lz-camera-bridge `/scope/<n>` funktionieren weiter und senden nur kein Audio.

**info** bekommt ein Feld:
```json
{"type":"info", "...":"wie bisher", "proto":2,
 "audio":{"sampleRate":48000,"channels":2,"format":"f32le","layout":"stereo",
          "codec":"aac","sourceSampleRate":48000,"sourceChannels":2}}
```
`"audio": null`, wenn der Stream keinen Ton hat (dann auch keine Audio-Nachrichten).

**Binärnachrichten bei `proto: 2`** bekommen einen 16-Byte-Kopf (Little Endian). Damit bleibt die Nutzlast auf 4 Byte ausgerichtet, `Uint16Array` und `Float32Array` lassen sich direkt darauf legen:

| Offset | Typ | Video `LZV1` | Audio `LZA1` |
|---|---|---|---|
| 0 | 4 × ASCII | `LZV1` | `LZA1` |
| 4 | uint32 | Bildnummer seit Start | Anzahl Sample-Frames n im Paket |
| 8 | float64 | PTS in s (NaN, wenn unbekannt) | Index des ersten Samples seit Start (lückenlos, Sprünge = Lücke) |
| 16 | … | RGBA wie bisher | n × channels float32, verschachtelt |

**ffmpeg** (ein Prozess, zwei Ausgänge; `spawn(..., {stdio: ['ignore','pipe','pipe','pipe']})`, Audio auf fd 3):
```
ffmpeg … -i <url> \
  -map 0:v:0 -vf scale=… -pix_fmt rgba -f rawvideo pipe:1 \
  -map 0:a:0? -c:a pcm_f32le -f f32le pipe:3
```
- Keine Abtastraten- oder Kanalwandlung (`-ar`/`-ac` weglassen). Rate und Layout liefert ffprobe (`-select_streams a:0 -show_entries stream=codec_name,sample_rate,channels,channel_layout`). Das K-Filter rechnet für jede Rate.
- Die Bridge teilt PCM in Pakete zu 20 ms (960 Frames bei 48 kHz, bei Stereo etwa 7,7 KB, 50 Nachrichten/s).
- **Ton nie zugunsten von Bild verwerfen.** Die Drop-Regel (`bufferedAmount`) gilt nur für Video. Audio ist mit etwa 384 KB/s (Stereo f32) klein. Muss doch Ton entfallen, zeigt der Sample-Index die Lücke. Der Client markiert dann I/LRA als „mit Lücke“.
- PTS für Video und Audio: rawvideo überträgt keine Zeitstempel. Möglichkeiten: `showinfo`/`ashowinfo` auf stderr auswerten, oder statt zwei Rohausgängen `-f nut` auf einem Kanal ausgeben und in Node demultiplexen. Für die A/V-Sync-Messung ist das nötig, für Loudness nicht.
- `stats` erweitern: `audioSent`, `audioDropped`, `audioGaps`.
- `frame-protocol.md` bekommt den Abschnitt „proto 2“. `Source.connectFrames` unterscheidet über `info.proto`.

---

## (f) Offene Fragen

1. **Welche Eingänge nutzt Lars wirklich?** USB-Interface, Dante Virtual Soundcard, SDI-Karte mit 8–16 eingebetteten Kanälen? Davon hängt ab, ob der Bridge-Eingang `device:` (e.3) zur Pflicht wird.
2. Welche Kameras liefern Ton im RTSP-Stream, mit welchem Codec (AAC, G.711, PCM) und welcher Rate? Das bestimmt die Tests der Bridge.
3. Zielwerte neben R 128: Braucht es Streaming-Presets (z. B. −14/−16 LUFS der Plattformen) oder ATSC A/85? Beides ist hier nicht aus Primärquellen belegt.
4. Soll der Generator wie das Testbild ein eigenes Ausgabefenster bekommen, zum Beispiel mit Testbild und Ident zusammen auf einem Capture-Ausgang?
5. Windows: Funktioniert `pipe:3` mit ffmpeg unter Windows (Handle-Vererbung)? Sonst `-f nut` auf stdout oder ein zweiter Prozess. Der zweite Prozess öffnet eine zweite RTSP-Sitzung, das vertragen manche Kameras nicht.
6. Liefert `createMediaElementSource` an einem `muted` Video Stille? Test in Electron 44 und Chrome nötig.
7. Mehrkanal-Ausgabe: Welche `destination.maxChannelCount` meldet Chrome bzw. Electron auf den eingesetzten Interfaces?
8. Nicht aus Primärquellen belegt: Die **BLITS-Kanalreihenfolge** in Abschnitt 1 (Tech 3304 zeigt sie nur als Grafik), GLITS-Timing (nur Wikipedia) und der Wortlaut von EBU R 49 (nur über Tech 3304 und SOS). Vor der Umsetzung R 49 und die BLITS-Originalbeschreibung (IBS-Journal 2007) beschaffen.
9. PPM-Ballistik (IEC 60268-10, DIN/Nordic/BBC) und Korrelationsmesser-Zeitkonstante: Normtext nicht frei verfügbar. Entscheiden, ob PPM überhaupt gebraucht wird oder TP + Loudness reichen.
10. Eigener DSP-Kern oder loudness-worklet übernehmen (Lizenz MIT)? Empfehlung oben: eigener Kern, fremde Implementierungen als Gegenprobe.

---

## Quellen

Primärquellen (geöffnet, als PDF geladen):
- ITU-R BS.1770-5 (11/2023): https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-5-202311-I!!PDF-E.pdf
- ITU-R BT.1359-1 (1998): https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1359-1-199811-I!!PDF-E.pdf
- EBU R 128 (2023): https://tech.ebu.ch/docs/r/r128.pdf · R 128 s1: https://tech.ebu.ch/docs/r/r128s1.pdf · R 128 s2: https://tech.ebu.ch/docs/r/r128s2.pdf
- EBU Tech 3341 (2023): https://tech.ebu.ch/docs/tech/tech3341.pdf
- EBU Tech 3342 (2023): https://tech.ebu.ch/docs/tech/tech3342.pdf
- EBU Tech 3343 (2023): https://tech.ebu.ch/docs/tech/tech3343.pdf
- EBU Tech 3344 (V2.1, 2016): https://tech.ebu.ch/docs/tech/tech3344.pdf
- EBU R 68-2000: https://tech.ebu.ch/docs/r/r068.pdf
- EBU Tech 3304 (2009): https://tech.ebu.ch/docs/tech/tech3304.pdf
- libebur128, `ebur128.c`: https://github.com/jiixyj/libebur128 (MIT)

VMA: https://vma-broadcast.com/audiogenerator.htm · https://vma-broadcast.com/audioanalyser.htm (29.09.2026, headless Chrome)

Sekundärquellen:
- Youlean: https://youlean.co/youlean-loudness-meter/ · https://www.kvraudio.com/product/youlean-loudness-meter-by-youlean
- NUGEN VisLM: https://nugenaudio.com/vislm/
- TC LM2 / Clarity M: https://www.kvraudio.com/news/tc-electronic-releases-lm2-radar-loudness-meter-plug-in-with-intro-offer-19275 · https://www.soundonsound.com/reviews/tc-electronic-clarity-m
- RTW TouchMonitor: https://www.rtw.com/touchmonitor-tm7-and-tm9
- iZotope Insight 2: https://www.izotope.com/en/products/insight/features
- Voxengo SPAN: https://www.voxengo.com/product/span/features/
- loudness-worklet: https://github.com/lcweden/loudness-worklet
- AudioContext.setSinkId: https://developer.chrome.com/blog/audiocontext-setsinkid
- Mehrkanal-getUserMedia: https://issues.chromium.org/issues/40403559 · https://blog.addpipe.com/recording-true-stereo-audio-using-getusermedia/
- GLITS: https://en.wikipedia.org/wiki/GLITS · BLITS-Reihenfolge: https://github.com/oyvindln/vhs-decode/wiki/BLITS-Test-Tone
- EBU-Stereo-Ident, Mono-Summe: https://www.soundonsound.com/techniques/sos-audio-test-files
- Korrelationsmesser: https://www.soundonsound.com/sound-advice/q-what-are-my-phase-correlation-meters-telling-me

[Schnell starten]: Hausregel „Planner nie mit Pflichtfeldern bremsen“, sinngemäß übertragen.
