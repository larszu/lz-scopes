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
| [prism](https://github.com/djieff/prism) (Copyright (c) 2026 Jean-Francois Bouchard) | MIT, text in [licenses/prism-LICENSE.txt](licenses/prism-LICENSE.txt) | `src/lut.ts` | structure of the LUT parsers (`.cube`, `.3dl`, `.spi3d`, `.csp`) after `src/prism/io/lut/loader.py`, written anew in TypeScript |

Manufacturer look LUTs (Sony, Panasonic, Canon, ARRI, Blackmagic, RED) are **not** bundled: their terms forbid redistribution or could not be read. The app links their official download pages ([docs/research/lut-cst.md](docs/research/lut-cst.md)).

The `licenses/` folder ships with the desktop app. The gamut distance `(max − c)/max` follows the idea of jedypod/gamut-compress (no licence file); the formula is written anew.

## ffmpeg (desktop app)

The desktop installers bundle a static **ffmpeg binary** (via `ffmpeg-static`) and start it as a separate process to decode network streams. That binary is built with GPL components and is licensed under the **GPL** (the ffmpeg code base is mainly LGPL, optional components are GPL; see `ffmpeg.LICENSE` in `node_modules/ffmpeg-static/`). LZ Scopes talks to it only through the command line and a pipe; it is not linked into the app.

- ffmpeg source code and licence texts: <https://ffmpeg.org/download.html>, <https://ffmpeg.org/legal.html>
- Build used by `ffmpeg-static`: <https://github.com/eugeneware/ffmpeg-static/releases>
- The web build does not contain ffmpeg. `npm start` uses an ffmpeg from your `PATH`.

## ArgyllCMS (optional, not shipped)

Display calibration (`server/meter.mjs`) can use **ArgyllCMS `spotread`** if the user has installed it. ArgyllCMS is licensed under the AGPL-3 (some drivers GPL-2+, <https://www.argyllcms.com/doc/ArgyllDoc.html>). LZ Scopes does not bundle, link or modify it: it starts the separately installed program and reads its text output, the way DisplayCAL does. Procedures from DisplayCAL (GPL-3) were read as reference only; no code was taken ([docs/research/display-kalibrierung.md](docs/research/display-kalibrierung.md)).

## Development only (not shipped)

TypeScript, Vite, Vitest, electron-builder, concurrently, `@types/*`: MIT or Apache-2.0, see `package-lock.json`.

## Own works

- **Logo and trademark of Lars Zumpe Medienproduktion** (`docs/brand/`, `src/brand/`, `build/icon.png`, `public/icons/`): signet, logo and app icon, unchanged files from the Brand Kit 2.0. Own trademark of Lars Zumpe, **not free to use**: no permission of the licence covers them (see [LICENSE](LICENSE), section 10).
- **LZ display test images** (`public/patterns/lz-display/`, 20 images, 1920 x 1080): own work of Lars Zumpe Medienproduktion.
- **Test patterns** generated in code (`src/patterns.ts`): own work. Standards such as SMPTE RP 219 / EBU R 95 / ITU-R BT.709 are referenced by name only.
- Research notes in `docs/research/` cite third-party projects and standards by link and summary.
