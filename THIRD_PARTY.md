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
| [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static) | 5.3.0 | GPL-3.0-or-later (wrapper) | desktop app only | see below |
| [Public Sans](https://github.com/uswds/public-sans) via [@fontsource-variable/public-sans](https://fontsource.org/fonts/public-sans) | 5.3.0 | SIL OFL 1.1, text in [licenses/public-sans-OFL.txt](licenses/public-sans-OFL.txt) | web + desktop | UI typeface; `src/fonts/` holds the unchanged variable WOFF2 files (latin, latin-ext) so the desktop app works offline |
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
| [sunday-light-meter](https://github.com/natmart-in/sunday-light-meter) @ eb50efc (Copyright (c) 2026 Sunday Light) | MIT, text in [licenses/sunday-light-meter-LICENSE.txt](licenses/sunday-light-meter-LICENSE.txt) | `src/opple/protocol.ts`, `src/opple/photometry.ts`, `src/opple/meter.ts`, `test/fixtures/opple-lm3-reference.json`, `test/fixtures/cie1931-2deg-5nm.json` and `src/opple/cmf.ts` (same table), sample frames in `test/opple.test.ts` | Opple Light Master BLE framing and payload parsing (ported), LM3 3×7 and LM4 3×8 XYZ matrices, LM3 source-type rule, Duv polynomial coefficients, recorded LM4 frames and reference values; connection flow written anew. Provenance of the matrices as stated there: LM3 via OlliV/open-light-master (GPL-3.0, not used here directly), LM4 set `LightmasterIVCoeff_20231115` extracted from the OPPLE Smart app by gabrielebaudo/opple-bridge (MIT). Whether the app's coefficients may be used commercially is open, see [docs/research/opple-light-master.md](docs/research/opple-light-master.md) |
| [opple-bridge](https://github.com/gabrielebaudo/opple-bridge) @ 5bba264 (Copyright (c) 2026 Gabriele Baudo) | MIT, text in [licenses/opple-bridge-LICENSE.txt](licenses/opple-bridge-LICENSE.txt) | `src/opple/protocol.ts` (flicker part) | Light Master 4 flicker request/answer layout, 12-bit sample packing, sampling-mode time factors and ADC baselines from `opple_bridge/ble/parser.py` and `science/flicker.py` (there taken from the decompiled OPPLE Smart app), ported; the capture cascade in `src/opple/meter.ts` follows `ble/manager.py` |
| [woscope](https://github.com/m1el/woscope) @ 74af1e3 (Copyright (c) 2015 Igor Null, Chad von Nau) | MIT, text in [licenses/woscope-LICENSE.txt](licenses/woscope-LICENSE.txt) | `src/crt.ts` | CRT beam: segment quads around the line (`shaders/vsLine.glsl`) and the analytic Gaussian integral along the segment with the erf approximation (`shaders/fsLine.glsl`); rewritten for WebGL2, deposit normalised to one point per segment, persistence and glow are our own |

Manufacturer look LUTs (Sony, Panasonic, Canon, ARRI, Blackmagic, RED) are **not** bundled: their terms forbid redistribution or could not be read. The app links their official download pages ([docs/research/lut-cst.md](docs/research/lut-cst.md)).

The `licenses/` folder ships with the desktop app. The gamut distance `(max − c)/max` follows the idea of jedypod/gamut-compress (no licence file); the formula is written anew.

## ffmpeg (desktop app)

The desktop installers bundle a static **ffmpeg binary** (via `ffmpeg-static`) and start it as a separate process to decode network streams. That binary is built with GPL components and is licensed under the **GPL** (the ffmpeg code base is mainly LGPL, optional components are GPL; see `ffmpeg.LICENSE` in `node_modules/ffmpeg-static/`). LZ Scopes talks to it only through the command line and a pipe; it is not linked into the app.

- ffmpeg source code and licence texts: <https://ffmpeg.org/download.html>, <https://ffmpeg.org/legal.html>
- Build used by `ffmpeg-static`: <https://github.com/eugeneware/ffmpeg-static/releases>
- The web build does not contain ffmpeg. `npm start` uses an ffmpeg from your `PATH`.

## Capture helpers (optional, built locally)

- **DeckLink helper** (`helpers/decklink/`): own code, built against the Blackmagic Desktop Video SDK, which is **not** in this repository (free download after registration). The SDK headers carry Blackmagic Design's permissive licence (use, reproduce, distribute; notice kept in source copies). The terms of the SDK download itself were not reviewed – check them before shipping a built helper. ffmpeg's own DeckLink device is `nonfree` and is not used.
- **NDI® helper** (`helpers/ndi/`): own code; `ndi-min.h` takes over type and function declarations from the NDI SDK 6.3 headers, which are MIT-licensed file by file (text in [licenses/ndi-sdk-headers-MIT.txt](licenses/ndi-sdk-headers-MIT.txt)). The NDI runtime is **not** shipped; the helper loads the one the user installed. NDI® is a registered trademark of Vizrt NDI AB (<https://ndi.video/>).

## ArgyllCMS (optional, not shipped)

Display calibration (`server/meter.mjs`) can use **ArgyllCMS `spotread`** if the user has installed it. ArgyllCMS is licensed under the AGPL-3 (some drivers GPL-2+, <https://www.argyllcms.com/doc/ArgyllDoc.html>). LZ Scopes does not bundle, link or modify it: it starts the separately installed program and reads its text output, the way DisplayCAL does. Procedures from DisplayCAL (GPL-3) were read as reference only; no code was taken ([docs/research/display-kalibrierung.md](docs/research/display-kalibrierung.md)).

## Display profile helper and DDC tools (#17)

- `helpers/colorsync/lzs-colorsync.swift`: own code on Apple's public ColorSync API, built into `helpers/bin/` and shipped with the macOS app.
- DDC/CI uses tools only if the user installed them and only as separate programs: [m1ddc](https://github.com/waydabber/m1ddc) (MIT, macOS, brightness) and ddcutil (GPL-2.0-or-later, Linux). Neither is bundled. The VCP values follow ddcutil's feature table (read as facts, no code taken). Windows uses the system DLLs `mscms.dll` and `dxva2.dll` through PowerShell.

## Development only (not shipped)

TypeScript, Vite, Vitest, electron-builder, concurrently, `@types/*`: MIT or Apache-2.0, see `package-lock.json`.

## Own works

- **Logo and trademark of Lars Zumpe Medienproduktion** (`docs/brand/`, `src/brand/`, `build/icon.png`, `public/icons/`): signet, logo and app icon, unchanged files from the Brand Kit 2.0. Own trademark of Lars Zumpe, **not free to use**: no permission of the licence covers them (see [LICENSE](LICENSE), section 10).
- **LZ display test images** (`public/patterns/lz-display/`, 20 images, 1920 x 1080): own work of Lars Zumpe Medienproduktion.
- **Test patterns** generated in code (`src/patterns.ts`): own work. Standards such as SMPTE RP 219 / EBU R 95 / ITU-R BT.709 are referenced by name only.
- Research notes in `docs/research/` cite third-party projects and standards by link and summary.
