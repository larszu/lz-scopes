# Third-party licences

LZ Scopes' own code is proprietary (© Lars Zumpe, see [LICENSE](LICENSE)). The components below keep their own licences; this licence covers only the parts authored by Lars Zumpe.
Die Komponenten unten behalten ihre eigenen Lizenzen.

## Shipped in the app or the web build

| Component | Version | Licence | Where | Note |
|---|---|---|---|---|
| [dockview-core](https://github.com/mathuo/dockview) | 8.3.1 | MIT | web + desktop | docking layout; `src/vendor/dockview.css` is copied from the `dockview` package (header keeps the notice) |
| [@mediapipe/tasks-vision](https://github.com/google-ai-edge/mediapipe) | 1.0.1 | Apache-2.0 | web + desktop | face auto-tracking; the WASM runtime is copied to `public/mediapipe` at build time (`scripts/copy-mediapipe.mjs`), not committed |
| BlazeFace short-range model (`public/models/blaze_face_short_range.tflite`) | – | Apache-2.0 | web + desktop | Google MediaPipe model, used unchanged |
| [ws](https://github.com/websockets/ws) | 8.22.0 | MIT | bridge (desktop / `npm start`) | WebSocket server |
| [FFmpeg](https://ffmpeg.org/) with x264, x265, libsrt, mbedTLS, zlib (own build, [scripts/ffmpeg-build/](scripts/ffmpeg-build/)) | 9.0.2 | GPL-3.0-or-later (no nonfree parts) | desktop app only | see below |
| [Public Sans](https://github.com/uswds/public-sans) via [@fontsource-variable/public-sans](https://fontsource.org/fonts/public-sans) | 5.3.0 | SIL OFL 1.1, text in [licenses/public-sans-OFL.txt](licenses/public-sans-OFL.txt) | web + desktop | UI typeface; `src/fonts/` holds the unchanged variable WOFF2 files (latin, latin-ext) so the desktop app works offline |
| [Capacitor](https://github.com/ionic-team/capacitor) (@capacitor/core, /ios, /cli) | 8.5.2 | MIT, text in [licenses/capacitor-LICENSE.txt](licenses/capacitor-LICENSE.txt) | iOS/iPadOS app | native shell around the web build (`ios/`, docs/ios.md) |
| [@capacitor-community/bluetooth-le](https://github.com/capacitor-community/bluetooth-le) | 8.3.0 | MIT, text in [licenses/capacitor-bluetooth-le-LICENSE.txt](licenses/capacitor-bluetooth-le-LICENSE.txt) | iOS/iPadOS app | CoreBluetooth for the Opple Light Master (`src/native/webBluetooth.ts`) |
| [bonjour-service](https://github.com/onlxltd/bonjour-service) with multicast-dns, dns-packet, thunky, @leichtgewicht/ip-codec, fast-deep-equal | 1.4.4 | MIT, text in [licenses/bonjour-service-LICENSE.txt](licenses/bonjour-service-LICENSE.txt) (dependencies: MIT, notices in their packages) | bridge (desktop / `npm start`) | announces `_lz-scopes._tcp` for the iOS app (`server/bonjour.mjs`) |
| [Electron](https://www.electronjs.org/) | 44.4.5 | MIT | desktop app | Chromium and Node.js inside it carry their own notices (`LICENSES.chromium.html` in the app bundle) |

## Ported formulas and constants

| Source | Licence | Where | What |
|---|---|---|---|
| [alwan](https://github.com/soufianekhiat/alwan) (Copyright (c) 2025 Soufiane KHIAT) | MIT, text in [licenses/alwan-LICENSE.txt](licenses/alwan-LICENSE.txt) | `src/camera.ts`, `src/color.ts` | camera log curves and camera primaries, CIE 1976 u′v′, CIEDE2000, ΔE ITP; file and line references in the code |
| [aces-core](https://github.com/aces-aswf/aces-core) (Copyright Contributors to the ACES Project) | Apache-2.0, text in [licenses/aces-core-LICENSE.txt](licenses/aces-core-LICENSE.txt) | `src/color.ts` (`bradford`), `src/chain.ts` (`acesParams`, `acesTonescale`) | Bradford cone response matrix and von-Kries adaptation from `lib/Lib.Academy.ColorSpaces.ctl`; ACES 2.0 tonescale from `lib/Lib.Academy.Tonescale.ctl`; changed: column-vector convention, ported to TypeScript/GLSL, tonescale applied to luminance and limited to the peak |
| [alwan](https://github.com/soufianekhiat/alwan) (see above) | MIT | `src/color.ts` (`bt2390Eetf`), `src/chain.ts` (shader) | BT.2390 EETF from `core/alwan_hdr_core.inc` |
| [alwan](https://github.com/soufianekhiat/alwan) (see above) | MIT | `src/calib/colorimetry.ts` (`planckUv`) | Krystek 1985 Planckian-locus coefficients from `src/alwan/data/planckian_locus_krystek_{u,v}.csv`; the CCT/Duv search is our own |
| [alwan](https://github.com/soufianekhiat/alwan) @ 8fc3044 (see above) | MIT | `src/rgc.ts` | ACES 1.3 reference gamut compression: defaults and per-channel math from `src/alwan/api/alwan_aces_ff.c` and `src/alwan/core/alwan_aces_ff_core.inc`, ported to TypeScript/GLSL |
| [prism](https://github.com/djieff/prism) (Copyright (c) 2026 Jean-Francois Bouchard) | MIT, text in [licenses/prism-LICENSE.txt](licenses/prism-LICENSE.txt) | `src/lut.ts` | structure of the LUT parsers (`.cube`, `.3dl`, `.spi3d`, `.csp`) after `src/prism/io/lut/loader.py`, written anew in TypeScript |
| [sunday-light-meter](https://github.com/natmart-in/sunday-light-meter) @ eb50efc (Copyright (c) 2026 Sunday Light) | MIT, text in [licenses/sunday-light-meter-LICENSE.txt](licenses/sunday-light-meter-LICENSE.txt) | `src/opple/protocol.ts`, `src/opple/photometry.ts`, `src/opple/meter.ts`, `test/fixtures/opple-lm3-reference.json`, `test/fixtures/cie1931-2deg-5nm.json` and `src/opple/cmf.ts` (same table), sample frames in `test/opple.test.ts` | Opple Light Master BLE framing and payload parsing (ported), LM3 3×7 and LM4 3×8 XYZ matrices, LM3 source-type rule, Duv polynomial coefficients, recorded LM4 frames and reference values; connection flow written anew. Provenance of the matrices as stated there: LM3 via OlliV/open-light-master (GPL-3.0, not used here directly), LM4 set `LightmasterIVCoeff_20231115` extracted from the OPPLE Smart app by gabrielebaudo/opple-bridge (MIT). The numbers originate from the **decompiled OPPLE Smart app** and reached us only through these MIT projects; Opple has not given permission, and whether plain coefficients are protected is unclear. Published here by decision of Lars Zumpe (06.10.2026), see [docs/research/led-wall-und-messgeraete.md](docs/research/led-wall-und-messgeraete.md) C.6 |
| [opple-bridge](https://github.com/gabrielebaudo/opple-bridge) @ 5bba264 (Copyright (c) 2026 Gabriele Baudo) | MIT, text in [licenses/opple-bridge-LICENSE.txt](licenses/opple-bridge-LICENSE.txt) | `src/opple/protocol.ts` (flicker part) | Light Master 4 flicker request/answer layout, 12-bit sample packing, sampling-mode time factors and ADC baselines from `opple_bridge/ble/parser.py` and `science/flicker.py` (there taken from the decompiled OPPLE Smart app), ported; the capture cascade in `src/opple/meter.ts` follows `ble/manager.py` |
| [woscope](https://github.com/m1el/woscope) @ 74af1e3 (Copyright (c) 2015 Igor Null, Chad von Nau) | MIT, text in [licenses/woscope-LICENSE.txt](licenses/woscope-LICENSE.txt) | `src/crt.ts` | CRT beam: segment quads around the line (`shaders/vsLine.glsl`) and the analytic Gaussian integral along the segment with the erf approximation (`shaders/fsLine.glsl`); rewritten for WebGL2, deposit normalised to one point per segment, persistence and glow are our own |

Manufacturer look LUTs (Sony, Panasonic, Canon, ARRI, Blackmagic, RED) are **not** bundled: their terms forbid redistribution or could not be read. The app links their official download pages ([docs/research/lut-cst.md](docs/research/lut-cst.md)).

The `licenses/` folder ships with the desktop app. The gamut distance `(max − c)/max` follows the idea of jedypod/gamut-compress (no licence file); the formula is written anew.

## ffmpeg (desktop app)

The desktop installers ship **ffmpeg and ffprobe** in `<resources>/ffmpeg/` and start them as separate processes (command line and pipes; not linked into the app). They are LZ Scopes' **own minimal build**: [scripts/ffmpeg-build/build.sh](scripts/ffmpeg-build/build.sh) compiles FFmpeg statically with exactly these libraries. Every source archive is pinned by SHA-256 (x264 by its git commit) in [scripts/ffmpeg-build/sources.txt](scripts/ffmpeg-build/sources.txt):

| Component | Version | Licence |
|---|---|---|
| FFmpeg | 9.0.2 (`--enable-gpl --enable-version3`, no `--enable-nonfree`) | GPL-3.0-or-later as configured (code base LGPL-2.1-or-later) |
| x264 | stable branch, commit b35605a | GPL-2.0-or-later |
| x265 | 4.2 (10 bit) | GPL-2.0-or-later |
| libsrt | 1.5.7 | MPL-2.0 |
| mbedTLS | 3.6.7 | Apache-2.0 |
| zlib | 1.3.2 | Zlib |
| Windows only: mingw-w64 winpthreads, GCC runtime (static) | Ubuntu 24.04 toolchain | MIT; GCC Runtime Library Exception |

`.github/workflows/ffmpeg-build.yml` builds the following targets:
- macOS arm64 and macOS x64; `scripts/ffmpeg-fetch.mjs` joins them into a universal binary with `lipo`.
- Windows x64.
- Linux x64, for the tests only.

It tests each build on its own OS: licence, SRT, and 10-bit HEVC/v210 over TCP and SRT. Then it publishes the zips together with **every source archive and the build script** as the pre-release [ffmpeg-9.0.2-lzs1](https://github.com/larszu/lz-scopes/releases/tag/ffmpeg-9.0.2-lzs1). [scripts/ffmpeg-builds.json](scripts/ffmpeg-builds.json) pins those zips by SHA-256. `scripts/ffmpeg-fetch.mjs` rejects any binary built with `--enable-nonfree` or lacking libsrt, x264 or x265.

- **Licence texts** (in the app under `ffmpeg/licenses/`, here in [licenses/ffmpeg/](licenses/ffmpeg/)): GPL-3.0, GPL-2.0, LGPL-3.0, LGPL-2.1, FFmpeg `LICENSE.md`, MPL-2.0 (libsrt), Apache-2.0 (mbedTLS), MIT (mingw-w64 winpthreads).
- **Source code (GPLv3 §6d):** every GitHub release of LZ Scopes carries all source archives above, plus `build.sh` and `sources.txt`. The same files are attached to [ffmpeg-9.0.2-lzs1](https://github.com/larszu/lz-scopes/releases/tag/ffmpeg-9.0.2-lzs1). FFmpeg: <https://ffmpeg.org/download.html>, <https://ffmpeg.org/legal.html>. For questions, open an issue at <https://github.com/larszu/lz-scopes/issues>.
- The web build contains no ffmpeg. `npm start` uses the fetched build (`npm run ffmpeg:fetch`), otherwise `$FFMPEG` or an ffmpeg from the `PATH`.
- Research and duties: [docs/research/ffmpeg-lizenz.md](docs/research/ffmpeg-lizenz.md). Up to 0.1.0 the app used `ffmpeg-static`, whose macOS arm64 binary is built with `--enable-nonfree` and is not redistributable; 1.0.0 to 1.3.0 shipped third-party GPL builds (Martin Riedl for macOS, BtbN for Windows).

## Capture helpers (optional, built locally)

- **DeckLink helper** (`helpers/decklink/`, shipped in the desktop app for macOS and Windows): own code, compiled against the include files of the DeckLink SDK 12.0 (headers, IDL, `DeckLinkAPIDispatch.cpp`). They are not in this repository; CI fetches them from the copy in the OBS Studio repository at a fixed commit, every file checked by its git blob hash ([scripts/decklink-sdk.json](scripts/decklink-sdk.json), `npm run decklink:fetch`). The include files carry Blackmagic Design's own permissive licence ([licenses/decklink-sdk-headers.txt](licenses/decklink-sdk-headers.txt)); the [DeckLink SDK EULA](https://www.blackmagicdesign.com/EULA/DeckLinkSDK) exempts `/Mac/Include`, `/Win/Include` and `/Linux/Include` from its clauses 1, 4.3, 4.4, 5, 7 and 8 (§0.1) and permits creating software compatible with Blackmagic products (§1.2). The driver (Blackmagic Desktop Video) is installed by the user and not shipped. Designation per EULA §6.2: "LZ Scopes compatible with Blackmagic Design DeckLink". DeckLink is a trademark of Blackmagic Design Pty. Ltd. ffmpeg's own DeckLink device is `nonfree` and is not used.
- **NDI® helper** (`helpers/ndi/`): own code; `ndi-min.h` takes over type and function declarations from the NDI SDK 6.3 headers, which are MIT-licensed file by file (text in [licenses/ndi-sdk-headers-MIT.txt](licenses/ndi-sdk-headers-MIT.txt)). The NDI runtime is **not** shipped; the helper loads the one the user installed. NDI® is a registered trademark of Vizrt NDI AB (<https://ndi.video/>).

## ArgyllCMS (optional, not shipped)

Display calibration (`server/meter.mjs`) can use **ArgyllCMS `spotread`** if the user has installed it separately. ArgyllCMS is licensed under the AGPL-3 (some drivers GPL-2+, <https://www.argyllcms.com/doc/ArgyllDoc.html>). Its author offers a commercial licence (ArgyllPRO) for closed-source products and writes: “It is highly advisable that closed source products that make use of ArgyllCMS NOT be developed before securing an appropriate license” (<https://www.argyllcms.com/commercialuse.html>).

LZ Scopes contains **no ArgyllCMS code, binaries or data**, and the installers do not ship any (`electron-builder.js` excludes them; `test/argyll-packaging.test.ts` checks it). The app only starts a user-installed `spotread` as a separate process and reads its text output, the way DisplayCAL does. The feature is optional; without ArgyllCMS values are entered by hand. Remaining risk and assessment: [docs/research/display-kalibrierung.md](docs/research/display-kalibrierung.md#argyllcms-lizenzlage-stand-06102026). Procedures from DisplayCAL (GPL-3) were read as reference only; no code was taken.

## Display profile helper and DDC tools (#17)

- `helpers/colorsync/lzs-colorsync.swift`: own code on Apple's public ColorSync API, built into `helpers/bin/` and shipped with the macOS app.
- DDC/CI uses tools only if the user installed them and only as separate programs: [m1ddc](https://github.com/waydabber/m1ddc) (MIT, macOS, brightness) and ddcutil (GPL-2.0-or-later, Linux). Neither is bundled. The VCP values follow ddcutil's feature table (read as facts, no code taken). Windows uses the system DLLs `mscms.dll` and `dxva2.dll` through PowerShell.

## Test videos (desktop app, downloaded on request, not shipped)

*Quellen → Testvideos …* lists freely licensed films. Nothing of them is in the repository or the installers: the desktop app downloads a file only when the user clicks, from the publisher's server, checks size and SHA-256 (values computed on 06.10.2026, `src/testVideoCatalog.ts`), unpacks the single-entry ZIP (CRC-32 checked) and keeps it in `<userData>/testvideos`. The dialog shows licence and attribution next to each title. Research: [docs/research/testvideos.md](docs/research/testvideos.md).

| Title | Files | Licence | Attribution |
|---|---|---|---|
| Big Buck Bunny (2008; 2013 re-render "sunflower") | download.blender.org/peach/bigbuckbunny_movies/ (320×180 … 1080p), download.blender.org/demo/movies/BBB/ (1080p/2160p, 30/60 fps) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) ([peach.blender.org/about](https://peach.blender.org/about/)) | (c) copyright 2008, Blender Foundation / www.bigbuckbunny.org |
| Cosmos Laundromat, HDR P3/PQ 2K 24p | s3.amazonaws.com/download.opencontent.netflix.com/CosmosLaundromat/ | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) ([opencontent.netflix.com](https://opencontent.netflix.com/)) | Cosmos Laundromat – Blender Studio (Blender Foundation), HDR grade Netflix with Fotokem Keep Me Posted; Netflix Open Content |
| Meridian, HDR P3/PQ UHD 59.94p | s3.amazonaws.com/download.opencontent.netflix.com/Meridian/ | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) ([opencontent.netflix.com](https://opencontent.netflix.com/)) | Meridian – Netflix, Inc.; Netflix Open Content |

The licences do not cover the logos and trademarks of Blender Foundation or Netflix.

## Development only (not shipped)

TypeScript, Vite, Vitest, electron-builder, concurrently, `@types/*`: MIT or Apache-2.0, see `package-lock.json`.

## Own works

- **Logo and trademark of Lars Zumpe Medienproduktion** (`docs/brand/`, `src/brand/`, `build/icon.png`, `public/icons/`): signet, logo and app icon, unchanged files from the Brand Kit 2.0. Own trademark of Lars Zumpe, **not free to use**: no permission of the licence covers them (see [LICENSE](LICENSE), section 10).
- **LZ display test images** (`public/patterns/lz-display/`, 20 images, 1920 x 1080): own work of Lars Zumpe Medienproduktion.
- **Test patterns** generated in code (`src/patterns.ts`): own work. Pictures and logos users upload stay in their own browser profile (IndexedDB) and are not part of the app. Standards such as SMPTE RP 219 / EBU R 95 / ITU-R BT.709 are referenced by name only.
- Research notes in `docs/research/` cite third-party projects and standards by link and summary.
