# lz-decklink – DeckLink/UltraStudio-Helfer

Nimmt von einer Blackmagic DeckLink-Karte oder einem UltraStudio auf und schreibt die Bilder im Helfer-Protokoll (`docs/frame-protocol.md`) auf stdout. Die Bridge startet ihn für Quellen `decklink:<n>` und rechnet wie bei Streams mit ffmpeg nach R′G′B′ um.

**Stand:** Quelltext fertig, auf macOS gegen die Header des DeckLink SDK 12.0 kompiliert (universal, ohne Warnungen) und ohne Treiber ausgeführt (meldet sauber „Desktop Video ist nicht installiert“). **Nie mit echter Hardware gelaufen.** Windows- und Linux-Zweig sind nach den SDK-Headern geschrieben, aber nicht kompiliert.

## Warum ein eigener Helfer

ffmpeg kann DeckLink selbst (`-f decklink`), aber nur mit `--enable-decklink`, und das steht in ffmpegs `configure` unter `EXTERNAL_LIBRARY_NONFREE_LIST`. Ein solches ffmpeg darf nicht weitergegeben werden. Die Desktop-App liefert ein weitergebbares ffmpeg ohne nonfree aus (siehe [THIRD_PARTY.md](../../THIRD_PARTY.md)) und für DeckLink diesen Helfer.

## Bauen

1. **Blackmagic Desktop Video** installieren (Treiber; ohne ihn findet der Helfer keine Geräte).
2. **Desktop Video SDK** herunterladen: blackmagicdesign.com/developer → Capture and Playback → SDK, kostenlos, mit Registrierung. Das SDK wird **nicht** in dieses Repository eingecheckt.
3. Bauen:

```sh
DECKLINK_SDK_DIR="$HOME/SDKs/Blackmagic DeckLink SDK 16.0" node scripts/build-helpers.mjs decklink
```

macOS: `clang++`, universal (arm64 + x86_64), bindet `Mac/include/DeckLinkAPIDispatch.cpp` ein, das den Treiber zur Laufzeit lädt. Linux: `g++` mit `Linux/include/DeckLinkAPIDispatch.cpp`.

Windows (von Hand, in der „x64 Native Tools“-Konsole):

```bat
midl /h DeckLinkAPI.h /iid DeckLinkAPI_i.c "%DECKLINK_SDK_DIR%\Win\include\DeckLinkAPI.idl"
cl /EHsc /O2 /std:c++17 helpers\decklink\lz-decklink.cpp DeckLinkAPI_i.c /Fe:helpers\bin\lz-decklink.exe ole32.lib oleaut32.lib
```

Das Ergebnis landet in `helpers/bin/`; `npm run dist:*` nimmt es in die Desktop-App auf. Ohne gebauten Helfer zeigt die Oberfläche bei *DeckLink…* „nicht verfügbar“. `LZS_DECKLINK_HELPER=/pfad/zu/lz-decklink` überschreibt den Ort.

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

Die DeckLink-SDK-Header tragen eine eigene freizügige Lizenz von Blackmagic Design („Permission is hereby granted, free of charge … to use, reproduce, display, distribute, execute, and transmit the Software …“, Hinweis muss in Quellkopien erhalten bleiben, nicht in reinem Maschinencode). Die Lizenzbedingungen des SDK-Downloads selbst stehen erst nach der Registrierung zur Verfügung und wurden hier nicht eingesehen – vor einer Weitergabe des gebauten Helfers prüfen. Siehe `docs/research/geraete-eingaenge.md`.
