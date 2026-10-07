# Genlock / Haustakt (Black Burst, Tri-Level) – Recherche (#72)

Stand: 07.10.2026. Nur geöffnete Quellen. Einschätzungen sind als solche markiert.

## Was die DeckLink-API zum Referenzeingang liefert

Geöffnet: DeckLink-SDK-Doku (sdk-doc.blackmagicdesign.com/decklink-sdk/, Seiten *DeckLink Configuration ID*, *DeckLink Status ID*, *DeckLink Attribute ID*) und die SDK-Header 12.0 (Kopie im OBS-Repository, nur zum Lesen und Kompilieren, nicht im Repo).

| Kennung | Art | Bedeutung (Doku) |
|---|---|---|
| `BMDDeckLinkHasReferenceInput` | Attribut, Flag | „True if the DeckLink device has a genlock reference source input connector.“ |
| `BMDDeckLinkSupportsFullFrameReferenceInputTimingOffset` | Attribut, Flag | „supports genlock offset adjustment wider than +/-511 pixels“ |
| `bmdDeckLinkStatusReferenceSignalLocked` | Status, Flag | „True if the reference input signal is locked.“ |
| `bmdDeckLinkStatusReferenceSignalMode` | Status, Int | „The detected reference input mode (BMDDisplayMode), available on devices which support reference input format detection.“ |
| `bmdDeckLinkStatusReferenceSignalFlags` | Status, Int | erkannte Referenz-Flags (`BMDDeckLinkVideoStatusFlags`: PsF, Dual-Stream-3D), ebenfalls nur mit Formaterkennung |
| `bmdDeckLinkConfigReferenceInputTimingOffset` | Konfiguration, Int | „Adjust genlock timing pixel offset … the supported range is between +/- half the count of total pixels in the video frame. Otherwise the supported range is +/-511.“ |
| `IDeckLinkOutput::GetReferenceStatus` | Methode | `bmdReferenceLocked`, `bmdReferenceNotSupportedByHardware` (Header) |

Ergebnis: Die API meldet, ob die Referenz anliegt und gelockt ist, welches Format erkannt wurde, und den **eingestellten** Genlock-Offset. Den gemessenen Zeitversatz zwischen Eingangssignal und Referenz liefert sie nicht. Eine Timing-Anzeige wie an Messgeräten lässt sich mit einer DeckLink also nicht ehrlich bauen.

## Was etablierte Messgeräte zeigen

- **Tektronix** (App Note „Master Sync and Master Clock Reference Timing within a Facility“, 20W-29582-0, 2013, geöffnet): Die *Timing Display* der WFM/WVR-Serien zeigt den Zeitversatz zwischen externer Referenz (Black Burst oder Tri-Level) und Eingang als Rechteck = ein Bild. Halbbildfehler erscheinen senkrecht, Zeilenfehler waagerecht, dazu Messwerte in Zeilen und µs. Tektronix nennt das Verfahren „proprietary“. Für SD-SDI wird 4,6 µs DAC-Verzögerung angesetzt, für HD-SDI 1,3 µs (Bezug SMPTE RP 168). Tri-Level ist der HD-Takt, Black Burst der von NTSC/PAL.
- **Telestream PRISM** (nur Suchergebnis, Seite nicht geöffnet): Die Timing Display vergleicht den Eingang mit Black Burst, Tri-Level oder PTP.
- **Leader LV5600W** (Spezifikation spec_lv5600w_7600w_e_v1.pdf, geöffnet): externer Referenzeingang „Tri-level sync or NTSC/PAL black burst signal (NTSC 10 field IDs are supported.)“; Funktion „phase difference display based on the phase of an external sync signal“ und Waveform des Referenzsignals. Die Phase kann um ±1 Takt schwanken, je nachdem, wann Signale angeschlossen werden.

## Umsetzung in LZ Scopes

- **Helfer** `lz-decklink --reference <n>`: liest die Kennungen oben und gibt eine JSON-Zeile aus. Die Bridge stellt sie unter `/api/decklink/reference?index=n` bereit.
- **Panel „Referenz / Genlock“** zeigt Gerät, Referenz gelockt ja/nein, erkanntes Format und daraus abgeleitet Black Burst (SD) oder Tri-Level (HD), den eingestellten Offset mit Bereich, den Eingangsstatus und ausdrücklich: „Zeitversatz Eingang ↔ Referenz: liefert die DeckLink-API nicht“.
- **Bildtakt gegen das ST-2059-1-Raster:** Die Bridge stempelt jedes Bild eines Helfers (DeckLink, NDI) bei der Ankunft mit PTP-Zeit, und zwar mit der Systemuhr oder, wenn das Uhr-Panel PTP empfängt, mit dessen Offset-Schätzung. Sie bestimmt die Lage im Bildraster, die zirkuläre Streuung und die Drift in ppm (`server/phase.mjs`).
  - *Einschätzung:* Die absolute Lage enthält die Übertragungs- und Treiberlatenz. Aussagekräftig sind Konstanz und Drift: Bei 0 ppm läuft die Quelle auf demselben Takt, bei einer Abweichung frei oder an einem anderen Takt.
  - Die Streuung der Softwarezeitstempel liegt bei etwa 0,1–1 ms.
- **Timecode:** Der Helfer schickt je Bild den RP-188-Timecode (`TIME`-Datensatz), die Bridge reicht ihn als `{type:'tc'}` weiter. Das Uhr-Panel vergleicht ihn mit LTC und Tageszeit.
- **Nicht gebaut:** ein Timing-Display nach Tektronix-Art. Es fehlt der Messwert, und die Darstellung ist laut Tektronix ein proprietäres Verfahren. Ebenso keine Waveform des Referenzsignals, dafür hat eine DeckLink keinen Analogpfad.

## Geprüft ohne DeckLink

- Phasenmessung mit echtem Datenstrom: NDI-Loopback auf dem Mac (eigener Testsender `lz-ndi --send-test`, Runtime 6.3.2 nur entpackt). Ergebnis bei 25 fps: Lage stabil um 20–23 ms im 40-ms-Raster. Streuung 2–3 ms, an der Bridge allein gemessen; mit gleichzeitig laufendem headless Chrome auf dem ausgelasteten Rechner bis 10 ms. Dazu Sprünge über eine Viertel-Bildperiode (NDI liefert gebündelt). Die Anzeige meldet das als „Sprünge – Drift unsicher“ und behauptet keinen Lock. Die Werte gelten für diesen Software-Sender, nicht für eine Karte.
- Phase, Streuung, Drift und Sprünge mit synthetischen Zeitreihen in vitest (0, +10, −25 ppm; 0,3 ms Jitter; ein Sprung von 15 ms).

## Ungeprüft

Alles mit Hardware: keine DeckLink-Karte mit Referenzeingang im Test. Der Helfer ist auf macOS gegen die Header des SDK 12.0 kompiliert; der Release-Build nutzt das aktuelle SDK. Die Werte im Panel sind gegen Testdaten in derselben Form geprüft (vitest), nicht gegen eine Karte.
