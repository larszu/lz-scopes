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
| [Electron](https://www.electronjs.org/) | 44.4.5 | MIT | desktop app | Chromium and Node.js inside it carry their own notices (`LICENSES.chromium.html` in the app bundle) |

## ffmpeg (desktop app)

The desktop installers bundle a static **ffmpeg binary** (via `ffmpeg-static`) and start it as a separate process to decode network streams. That binary is built with GPL components and is licensed under the **GPL** (the ffmpeg code base is mainly LGPL, optional components are GPL; see `ffmpeg.LICENSE` in `node_modules/ffmpeg-static/`). LZ Scopes talks to it only through the command line and a pipe; it is not linked into the app.

- ffmpeg source code and licence texts: <https://ffmpeg.org/download.html>, <https://ffmpeg.org/legal.html>
- Build used by `ffmpeg-static`: <https://github.com/eugeneware/ffmpeg-static/releases>
- The web build does not contain ffmpeg. `npm start` uses an ffmpeg from your `PATH`.

## Development only (not shipped)

TypeScript, Vite, Vitest, electron-builder, concurrently, `@types/*`: MIT or Apache-2.0, see `package-lock.json`.

## Own works

- **LZ display test images** (`public/patterns/lz-display/`, 20 images, 1920 x 1080): own work of Lars Zumpe Medienproduktion.
- **Test patterns** generated in code (`src/patterns.ts`): own work. Standards such as SMPTE RP 219 / EBU R 95 / ITU-R BT.709 are referenced by name only.
- Research notes in `docs/research/` cite third-party projects and standards by link and summary.
