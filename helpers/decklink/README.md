# lz-decklink – DeckLink-Helfer

Nimmt von einem Gerät mit DeckLink-Schnittstelle auf (LZ Scopes compatible with Blackmagic Design DeckLink) und schreibt die Bilder im Helfer-Protokoll (`docs/frame-protocol.de.md`) auf stdout. Die Bridge startet ihn für Quellen `decklink:<n>` und rechnet wie bei Streams mit ffmpeg nach R′G′B′ um.

**Stand:** In der Desktop-App enthalten (macOS universal, Windows x64, Linux x64 und arm64; gebaut in `release.yml`). **Mit Hardware geprüft** am 03.11.2026 auf macOS 26 (Apple Silicon) mit einem UltraStudio Recorder 3G an Thunderbolt, Desktop Video 16.5: Liste, Aufnahme über SDI in v210 und UYVY (1080p25), eingebetteter Ton (16 Kanäle), RP-188-Timecode, VANC, Eingangswahl SDI/HDMI; Prüfskript `scripts/decklink/probe.mjs`. Nicht geprüft: RGB 4:4:4, HDR-Kennung, Referenzeingang (das Gerät hat keinen), Windows und Linux mit Karte (#116). Desktop Video für Linux gibt es auch für AArch64; Blackmagic nennt als getestete ARM-Plattformen nur Jetson AGX Xavier und Clara AGX. Bezeichnung nach SDK-EULA §6.2: „LZ Scopes compatible with Blackmagic Design DeckLink“.

**Einrichtung des Treibers:** Schritte für macOS, Windows und Linux in `docs/manual/inputs.de.md` (*Blackmagic Desktop Video einrichten*); die Oberfläche zeigt sie als Dialog (`src/decklinkSetup.ts`).

## Warum ein eigener Helfer

ffmpeg kann DeckLink selbst (`-f decklink`), aber nur mit `--enable-decklink`, und das steht in ffmpegs `configure` unter `EXTERNAL_LIBRARY_NONFREE_LIST`. Ein solches ffmpeg darf nicht weitergegeben werden. Die Desktop-App liefert ein weitergebbares ffmpeg ohne nonfree aus (siehe [THIRD_PARTY.md](../../THIRD_PARTY.md)) und für DeckLink diesen Helfer.

## Bauen

1. **Blackmagic Desktop Video** installieren (Treiber; ohne ihn findet der Helfer keine Geräte; zum Bauen nicht nötig).
2. Include-Dateien des SDK holen: `npm run decklink:fetch`. Das lädt sie aus der Kopie im OBS-Studio-Repository (fester Commit, jede Datei per Blob-Hash geprüft, `scripts/decklink-sdk.json`) nach `vendor/decklink-sdk/`. Alternativ zeigt `DECKLINK_SDK_DIR` auf ein heruntergeladenes SDK. Im Repository liegen die Dateien nicht.
3. Bauen: `node scripts/build-helpers.mjs decklink`

- macOS: `clang++`, universal (arm64 + x86_64), mit `Mac/include/DeckLinkAPIDispatch.cpp`, das den Treiber zur Laufzeit lädt.
- Linux: `g++` mit `Linux/include/DeckLinkAPIDispatch.cpp`.
- Windows: `midl` + `cl` aus einer MSVC-Umgebung („x64 Native Tools“-Konsole; in CI `ilammy/msvc-dev-cmd`). Der Treiber wird per COM geladen.

Das Ergebnis landet in `helpers/bin/`; `npm run dist:*` und `release.yml` nehmen es in die Desktop-App auf. Ohne Helfer zeigt die Oberfläche bei *DeckLink…* „nicht verfügbar“, ohne Treiber „Desktop Video nicht installiert“. `LZS_DECKLINK_HELPER=/pfad/zu/lz-decklink` überschreibt den Ort.

## Schnittstelle

```
lz-decklink --list                      → {"ok":true,"devices":[{"index":0,"name":"UltraStudio Recorder 3G","formatDetection":true,"capture":true,"inputs":["sdi","hdmi"],"input":"sdi"}]}
lz-decklink --capture <index> [--bits 8|10] [--input sdi|hdmi|optical|component|composite|svideo] [--audio 0|2|8|16]
lz-decklink --reference <index>       → {"ok":true,"hasReference":true,"referenceLocked":true,"referenceMode":{…},"timingOffsetPixels":0,…} (Genlock, #72)
```

- Start im zuletzt erkannten Modus (`bmdDeckLinkStatusDetectedVideoInputMode`), sonst 1080i50.
- Schreiben in einem eigenen Thread: ein noch nicht geschriebenes Bild wird durch das neuere ersetzt (`STAT` `decklink.skipped` je Sekunde, die Bridge zählt es als verworfen); Ton und Metadaten gehen nie verloren. Bilder ohne Zeilenauffüllung gehen ohne Kopie aus dem Treiberpuffer raus.
- Formaterkennung (`bmdVideoInputEnableFormatDetection`): bei jedem Wechsel wird der Eingang neu geöffnet und ein neuer `INFO`-Datensatz geschickt. Geräte ohne Formaterkennung bleiben auf 1080i50. Ein Wechsel nur zwischen p und PsF bei gleicher Größe und Rate wird übergangen: Der Recorder 3G meldet bei 1080p25 über SDI mit jedem Bild abwechselnd 1080p25 und 1080PsF25.
- `--input`: Eingangsbuchse nur für diesen Prozess (`bmdDeckLinkConfigVideoInputConnection`); ohne die Angabe gilt die Einstellung aus Desktop Video Setup. `--list` meldet die vorhandenen Buchsen (`inputs`) und die eingestellte (`input`).
- Y′CbCr-Signale: `v210` (10 bit, Voreinstellung) oder `uyvy422` (8 bit) unverändert.
- RGB-4:4:4-Signale: `bmdFormat10BitRGB` (`r210`, laut SDK-Header „SMPTE video levels (64-960)“) → im Helfer auf volle 16 bit gespreizt (`rgb48le`, Werte außerhalb 64…940 werden abgeschnitten).
- `INFO` enthält Matrix (aus den Modus-Flags bzw. `bmdDeckLinkFrameMetadataColorspace`), HDR-EOTF (CEA-861.3: 2 = PQ, 3 = HLG) und Timecode (RP 188, erster gültiger).
- `VANC`: alle Zusatzpakete des Bildes (`IDeckLinkVideoFrameAncillaryPackets`, DID/SDID, Zeile, Datenstrom, Nutzdaten als Hex), bei Änderung bzw. höchstens 4/s (#160). Ausgewertet im Browser (`src/vanc.ts`, Panel *SDI-Signalinfo*). Mit Hardware ungeprüft (#116).
- Ton (`--audio n`, die Bridge setzt 16, wenn die Seite Ton will): eingebetteter Ton mit 48 kHz, 32 bit, so viele Kanäle wie das Gerät kann (16, 8 oder 2; `BMDDeckLinkMaximumAudioChannels`). `AUDI`-Datensätze mit Paketzeit, `FPTS` mit der Stream-Zeit jedes Bildes auf derselben Uhr; die Bridge macht daraus Protokoll 2 mit PTS (A/V-Versatz). Geprüft mit dem Recorder 3G über SDI: 16 Kanäle, lückenlos. Die lokale Aufnahme der Bridge schreibt bei DeckLink noch keinen Ton.

## Lizenz

Die Include-Dateien tragen eine eigene freizügige Lizenz von Blackmagic Design ([licenses/decklink-sdk-headers.txt](../../licenses/decklink-sdk-headers.txt)). Die SDK-EULA nimmt `/Mac/Include`, `/Win/Include` und `/Linux/Include` von ihren Klauseln 1, 4.3, 4.4, 5, 7 und 8 aus (§0.1) und erlaubt Software, die mit Blackmagic-Produkten kompatibel ist (§1.2). Der Treiber wird nicht mitgeliefert. Details: `docs/research/geraete-eingaenge.md`, THIRD_PARTY.md.
