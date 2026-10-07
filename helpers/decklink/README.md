# lz-decklink – DeckLink-Helfer

Nimmt von einem Gerät mit DeckLink-Schnittstelle auf (LZ Scopes compatible with Blackmagic Design DeckLink) und schreibt die Bilder im Helfer-Protokoll (`docs/frame-protocol.md`) auf stdout. Die Bridge startet ihn für Quellen `decklink:<n>` und rechnet wie bei Streams mit ffmpeg nach R′G′B′ um.

**Stand:** In der Desktop-App enthalten (macOS universal, Windows x64; gebaut in `release.yml`). Auf macOS gegen die Include-Dateien des DeckLink SDK 12.0 kompiliert und ohne Treiber ausgeführt (meldet „Blackmagic Desktop Video ist nicht installiert (DeckLink-Treiber fehlt)“). Der Windows-Zweig wird in CI kompiliert, aber nirgends ausgeführt. **Nie mit echter Hardware gelaufen.** Bezeichnung nach SDK-EULA §6.2: „LZ Scopes compatible with Blackmagic Design DeckLink“.

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
lz-decklink --list                      → {"ok":true,"devices":[{"index":0,"name":"UltraStudio 4K Mini","formatDetection":true,"capture":true}]}
lz-decklink --capture <index> [--bits 8|10]
```

- Formaterkennung (`bmdVideoInputEnableFormatDetection`): bei jedem Wechsel wird der Eingang neu geöffnet und ein neuer `INFO`-Datensatz geschickt. Geräte ohne Formaterkennung bleiben auf 1080i50.
- Y′CbCr-Signale: `v210` (10 bit, Voreinstellung) oder `uyvy422` (8 bit) unverändert.
- RGB-4:4:4-Signale: `bmdFormat10BitRGB` (`r210`, laut SDK-Header „SMPTE video levels (64-960)“) → im Helfer auf volle 16 bit gespreizt (`rgb48le`, Werte außerhalb 64…940 werden abgeschnitten).
- `INFO` enthält Matrix (aus den Modus-Flags bzw. `bmdDeckLinkFrameMetadataColorspace`), HDR-EOTF (CEA-861.3: 2 = PQ, 3 = HLG) und Timecode (RP 188, erster gültiger).
- Kein Ton (noch nicht umgesetzt).

## Lizenz

Die Include-Dateien tragen eine eigene freizügige Lizenz von Blackmagic Design ([licenses/decklink-sdk-headers.txt](../../licenses/decklink-sdk-headers.txt)). Die SDK-EULA nimmt `/Mac/Include`, `/Win/Include` und `/Linux/Include` von ihren Klauseln 1, 4.3, 4.4, 5, 7 und 8 aus (§0.1) und erlaubt Software, die mit Blackmagic-Produkten kompatibel ist (§1.2). Der Treiber wird nicht mitgeliefert. Details: `docs/research/geraete-eingaenge.md`, THIRD_PARTY.md.
