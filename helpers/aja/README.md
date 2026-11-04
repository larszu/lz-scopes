# lz-aja – AJA-Helfer

Nimmt von einer Karte von AJA Video Systems auf (KONA, Io, U-TAP, Corvid …) und schreibt die Bilder im Helfer-Protokoll (`docs/frame-protocol.de.md`) auf stdout. Die Bridge startet ihn für Quellen `aja:<n>` und rechnet wie bei DeckLink mit ffmpeg nach R′G′B′ um.

**Stand:** In der Desktop-App enthalten (macOS universal, Windows x64, Linux x64 und arm64). Gebaut gegen [libajantv2](https://github.com/aja-video/libajantv2) 18.0.0 (MIT), statisch gelinkt. **Mit Hardware nicht geprüft** – es stand keine AJA-Karte zur Verfügung. In CI geprüft: Bau auf allen drei Systemen, `--list` ohne Karte. Nicht unterstützt: 4K/UHD (Quad-Link, TSI, 12G; der Helfer meldet `aja.format4k`), Referenz-/Genlock-Status, analoge Eingänge.

`aja-video/ntv2` ist der ältere, seit 2023 ruhende Stand derselben Bibliothek; genutzt wird `libajantv2`, das auch den Linux-Treiber enthält.

## Bauen

1. Treiber installieren: macOS und Windows **AJA Desktop Software** (aja.com/support), Linux den Kerneltreiber aus libajantv2 (`driver/linux`: `make`, dann `sudo ./load_ajantv2`). Zum Bauen nicht nötig.
2. Bibliothek holen: `npm run aja:fetch` – klont `aja-video/libajantv2` am Tag aus `scripts/aja-sdk.json` nach `vendor/libajantv2/` und prüft, dass der Tag auf den gepinnten Commit zeigt. Alternativ zeigt `AJA_SDK_DIR` auf einen eigenen Checkout. Neuer Tag: `node scripts/aja-sdk-fetch.mjs --pin ntv2_18_1_0`.
3. Bauen: `node scripts/build-helpers.mjs aja` (CMake ≥ 3.21; `helpers/aja/CMakeLists.txt` bindet libajantv2 per `add_subdirectory` ein, ohne Demos, Werkzeuge, Tests, Treiber und Plugin-Laden).

- macOS: universal (arm64 + x86_64), Mindestversion 11.0. libajantv2 liest die SDK-Version aus `CMAKE_OSX_SYSROOT`; das Build-Skript übergibt daher den Pfad mit Versionsnummer (`MacOSX27.2.sdk`), nicht den Link `MacOSX.sdk`.
- Linux: `g++`, braucht `libudev-dev`.
- Windows: MSVC (`-A x64`), in CI nach `ilammy/msvc-dev-cmd`.

Das Ergebnis landet in `helpers/bin/`; `npm run dist:*` und `release.yml` nehmen es in die Desktop-App auf. `LZS_AJA_HELPER=/pfad/zu/lz-aja` überschreibt den Ort.

## Schnittstelle

```
lz-aja --list   → {"ok":true,"sdk":"18.0.0","devices":[{"index":0,"name":"KONA 5","serial":"…","capture":true,"ready":true,"busy":false,"anc":true,"audioChannels":16,"inputs":["sdi1","sdi2","sdi3","sdi4","hdmi1"],"signals":{"sdi1":"1080i50"}}]}
lz-aja --capture <index> [--bits 8|10] [--input sdi1|…|hdmi1|…] [--audio 0|2|8|16]
```

- Eingang: `--input`, sonst der erste SDI-Eingang. Der Eingang n nutzt Kanal n (Framestore, Audiosystem n, wenn die Karte eines je Kanal hat). Bidirektionale SDI-Buchsen werden auf Empfang geschaltet.
- Belegung wie in AJAs eigenen Capture-Demos: `AcquireStreamForApplication` (Signatur `LZSC`), Task-Modus `NTV2_OEM_TASKS`; beim Ende (auch bei SIGTERM oder geschlossener Pipe) werden AutoCirculate gestoppt, Task-Modus und Besitz zurückgegeben. Ein toter Vorbesitzer wird vom SDK übernommen. Hält ein anderes Programm die Karte, meldet `--list` `busy` und `--capture` `aja.busy`.
- Signalführung: nur die eigenen Kreuzpunkte (Eingang → Framestore, bei RGB über HDMI Eingang → CSC → Framestore), `ApplySignalRoute` ohne `inReplace` – die übrige Signalführung der Karte bleibt. Die Referenz wird nicht umgestellt.
- Formaterkennung: `GetInputVideoFormat` (SDI mit dem Progressiv-Bit der Karte), alle 10 Bilder geprüft; bei einem Wechsel startet AutoCirculate neu und ein neuer `INFO` folgt. p ↔ PsF bei gleicher Größe und Rate gilt nicht als Wechsel (wie bei lz-decklink).
- Pixel: `NTV2_FBF_10BIT_YCBCR` = `v210` (Voreinstellung), `NTV2_FBF_8BIT_YCBCR` = `uyvy422`; Zeilen ohne Auffüllung.
- `INFO`: Matrix BT.709 (HD) bzw. BT.601 (SD), auf SDI aus der VPID (ST 352: Rec.2020 → `bt2020nc`, Transfer SDR/HLG/PQ), auf HDMI aus AVI-InfoFrame und DRM-InfoFrame (CEA-861.3: 2 = PQ, 3 = HLG).
- Schreiben in einem eigenen Thread: ein noch nicht geschriebenes Bild wird durch das neuere ersetzt (`STAT aja.skipped`); was AutoCirculate auf der Karte verwirft, meldet `STAT aja.dropped`. Die Bridge zählt beides als verworfen. Ton, Timecode und VANC gehen nie verloren.
- Ton: eingebettet (SDI) bzw. HDMI-Ton, 48 kHz, 32 bit, 16/8/6/2 Kanäle je nach Karte. `AUDI` mit fortlaufendem Sample-Zähler, `FPTS` mit dem Zeitstempel der Karte (48-kHz-Audiouhr, `acAudioClockTimeStamp`) – beide auf derselben Uhr.
- Timecode: erster gültiger RP 188 / ATC des Eingangs als `TIME` je Bild.
- `VANC`: auf Karten mit Anc-Extraktor (`CanDoCustomAnc`) alle Pakete über `AJAAncillaryList`, im selben JSON wie lz-decklink (`src/vanc.ts`, Panel *SDI-Signalinfo*).

## Lizenz

libajantv2 steht unter der MIT-Lizenz; darin enthalten sind eine popt-Portierung (MIT-artig, Red Hat) und SQLite (gemeinfrei). Texte: [licenses/libajantv2-LICENSE.txt](../../licenses/libajantv2-LICENSE.txt). Der Treiber wird nicht mitgeliefert. AJA, KONA und Io sind Marken von AJA Video Systems, Inc.
