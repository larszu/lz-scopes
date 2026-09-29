<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lzm_hauptlogo_offwhite.svg" />
    <img src="docs/brand/lzm_hauptlogo_navy.svg" alt="Lars Zumpe Medienproduktion" width="220" />
  </picture>
</p>

<h1 align="center">LZ Scopes</h1>

<p align="center">
  <b>Software waveform monitor, vectorscope, histogram and CIE diagram, including RTSP streams.</b><br />
  Measure camera, screen, file, network stream or a built-in test pattern. In the browser or as a desktop app for macOS and Windows.
</p>

<p align="center">
  <a href="https://github.com/larszu/lz-scopes/releases/latest">
    <img src="https://img.shields.io/badge/Download-macOS%20%26%20Windows-1D324F?style=for-the-badge&logo=github&logoColor=white" alt="Download LZ Scopes for macOS and Windows" height="40" />
  </a>
  &nbsp;
  <a href="https://larszu.github.io/lz-scopes/">
    <img src="https://img.shields.io/badge/Open%20in%20browser-web%20edition-5C6B85?style=for-the-badge" alt="Open the web edition" height="40" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20web-1D324F" alt="Platforms" />
  <img src="https://img.shields.io/badge/license-proprietary%2C%20free%20to%20use-5C6B85" alt="License" />
  <img src="https://img.shields.io/badge/node-%E2%89%A520-132040" alt="Node 20+" />
  <img src="https://img.shields.io/badge/WebGL2-renderer-132040" alt="WebGL2" />
</p>

<p align="center"><sub><a href="README.de.md">Deutsche Fassung / German version</a></sub></p>

<p align="center">
  <img src="docs/screenshots/hero.png" alt="LZ Scopes: picture, luma waveform, vectorscope, RGB parade, histogram and CIE diagram docked in one window" width="860" />
</p>

---

## Why LZ Scopes

- **Real scopes, in software.** Waveform (luma, RGB overlay, RGB / YRGB / YCbCr parade), vectorscope, CIE 1931 xy, histogram, false colour, zebra and numeric readout.
- **Streams, not just files.** RTSP, RTMP, SRT, UDP, RTP, HLS and HTTP via an ffmpeg bridge; camera, screen, video and image files directly in the browser.
- **HDR aware.** 8 or 16 bit analysis, PQ and HLG, BT.709 / 2020 / 601, waveform scale in cd/m².
- **Built-in test patterns.** About 40 generated patterns from PLUGE and SMPTE bars to PQ wedges, plus 20 LZ display test images. Open any of them full screen on a monitor, projector or capture.
- **Your layout.** Dock, stack and resize panels by drag and drop, keep layout configurations as JSON.
- **Face tracking.** Skin-tone waveform that follows a detected face (MediaPipe BlazeFace, runs locally).
- **Outputs.** Send a scope view or clean picture to another screen, as an MJPEG stream or by ffmpeg to RTMP / SRT / RTSP / UDP.
- **Embeddable.** `ScopeView` renders scopes in any page without a framework.

## Screenshots

<table>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/colorchecker.png" alt="Four panel layout measuring a ColorChecker pattern" width="420" /><br /><b>ColorChecker, 2x2 layout</b></td>
    <td width="50%" align="center"><img src="docs/screenshots/hdr-pq.png" alt="PQ grey wedge with waveform in cd/m2" width="420" /><br /><b>HDR: PQ wedge in cd/m&sup2;</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="docs/screenshots/lz-displaytest.png" alt="LZ display test image gamma" width="420" /><br /><b>LZ display test images</b></td>
    <td width="50%" align="center"><img src="docs/screenshots/gradbars.png" alt="Saturation ramps measured in the vectorscope" width="420" /><br /><b>Saturation ramps</b></td>
  </tr>
</table>

## Download and install

Get the installer from the [latest release](https://github.com/larszu/lz-scopes/releases/latest).

| Platform | File |
|---|---|
| macOS (Apple Silicon and Intel) | `LZ Scopes-<version>-universal.dmg` or `.zip` |
| Windows 10/11 (x64) | `LZ Scopes-<version>-x64.exe` (installer) or `-portable.exe` |

The desktop app contains the bridge and ffmpeg, so RTSP and other network sources work right away. macOS builds are ad-hoc signed: on first start, right-click and choose *Open*.

**Web edition:** <https://larszu.github.io/lz-scopes/>. Test patterns, camera, screen and files work there. RTSP, SRT and other network streams need the desktop app or `npm start`, because a browser cannot open them.

## Quick start

1. Start the app. The first source is a test pattern (SMPTE 75 % bars); all panels follow it.
2. Pick another source per panel: *Test pattern*, *Camera*, *Screen*, *File* or *Stream*.
3. For a stream enter the URL (for example `rtsp://user:pass@host:554/stream`) and connect. Resolution, frame rate, 8 / 16 bit, TCP / UDP, transfer and colour space are set per stream, *auto* reads the metadata.
4. Drag a rectangle in the picture to measure only that area. Click sets a measurement point that is marked in waveform and vectorscope.
5. Arrange the windows with drag and drop, store the result under *Layouts*.

Keys: `1`-`6` layout, `Space` freeze or play, `Left` / `Right` frame, `J` `K` `L` shuttle, `F` full screen, `S` PNG, `B` sidebar, `Esc` leave zoom.

## Build from source

Requires [Node.js](https://nodejs.org/) 20+ and, for network streams without the desktop app, `ffmpeg` and `ffprobe` in the `PATH` (`brew install ffmpeg`).

```bash
npm install
npm run dev                  # UI http://localhost:4191, bridge on 4190
npm run build && npm start   # production, everything on http://127.0.0.1:4190
npm test                     # colour maths, statistics, bridge input validation
npm run typecheck
npm run dist:mac             # or dist:win: desktop app with bridge and ffmpeg
```

Release: push a tag `v*`; `release.yml` builds Windows and macOS and attaches the installers to the release.

## Architecture

- **Bridge** (`server/index.mjs`): ffprobe for resolution and colour metadata, then ffmpeg scales to the analysis width and writes raw `rgba` / `rgba64le` frames over a WebSocket. Slow browsers get frames dropped, no queue builds up. The Y'CbCr matrix is passed to ffmpeg explicitly, the transfer function is left untouched. It listens on `127.0.0.1` only and accepts network URLs and test patterns, never local files, ffmpeg options or a shell.
- **Renderer** (`src/renderer.ts`): one WebGL2 context behind all panels. Every sampled pixel is scattered as an additive point into a float target (up to 4 million per scope and frame) and mapped with `1 - e^(-k x)`.
- **UI**: plain TypeScript, [dockview](https://github.com/mathuo/dockview) for the docking layout, Vite for the build, Electron for the desktop shell.
- **Web build**: asset paths are relative, so it runs at `/` and under `/lz-scopes/`.

Details: [docs/frame-protocol.md](docs/frame-protocol.md) (frame protocol), [docs/cable-planner-integration.md](docs/cable-planner-integration.md) (use inside cable-planner), [docs/research](docs/research) (standards and market research), [docs/PUBLISHING.md](docs/PUBLISHING.md) (going public).

Embedding:

```ts
import { ScopeView, Source } from 'lz-scopes/src';
const view = new ScopeView(el, { scopes: ['wf-luma', 'vector', 'parade', 'hist'] });
const src = new Source('stream', 'Camera 1');
src.connectFrames('ws://bridge/scope/1');
view.setSource(src);
```

## Limits

- Values are full-range R'G'B' after conversion. Sub-black and super-white outside 16-235 are clipped; there is no legal / illegal check at Y'CbCr level yet.
- No audio, NDI or SDI (DeckLink / AJA) input.
- Browser sources (camera, file) are always 8 bit and pass through the browser's colour management.

## Author

Built and maintained by **Lars Zumpe**, Lars Zumpe Medienproduktion. Scopes can also be used inside [LZ Cable Planner](https://github.com/larszu/cable-planner).

## License

Proprietary, &copy; 2026 Lars Zumpe, all rights reserved. Using the published builds is free; redistribution and derivative works are not. See [LICENSE](LICENSE). Not open source: the code is public to read.
Bundled third-party components keep their own licences: [THIRD_PARTY.md](THIRD_PARTY.md) (including the GPL ffmpeg binary in the desktop app).
