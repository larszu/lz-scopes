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

- **Real scopes, in software.** Waveform (luma, RGB overlay, RGB / YRGB / YCbCr parade), vectorscope, CIE 1931 xy or 1976 u′v′, histogram, false colour, zebra, gamut warning and numeric readout.
- **Streams, not just files.** RTSP, RTMP, SRT, UDP, RTP, HLS and HTTP via an ffmpeg bridge; capture cards through the bridge (`device:`); DaVinci Resolve in 16 bit through its scripting API; camera / USB capture with device picker, screen or window with crop, watch folder, video and image files directly in the browser.
- **HDR aware.** 8 or 16 bit analysis, PQ and HLG (display peak Lw 500-10 000 cd/m², system gamma applied to luminance per BT.2100, EBU R 167 presets), BT.709 / 2020 / 601 with 525- and 625-line primaries, waveform scale in cd/m² with BT.2408 reference marks (75 % HLG, 58 % PQ, 38 % grey card) and optional EBU R 103 limits (-5 / 105 %).
- **Camera log.** ARRI LogC3 / LogC4, Sony S-Log3, Panasonic V-Log, Blackmagic Film Gen 5, Canon Log 2 / 3, RED Log3G10, Fujifilm F-Log2, DJI D-Log, Nikon N-Log and Apple Log with their camera gamuts (Bradford-adapted where the white differs). Log acts on the scene-referred waveform scale (reflectance, 18 % grey), the CIE diagram, the picture view and the vectorscope targets.
- **CST and LUTs per source.** Colour space transform to Rec.709 / Rec.2020 PQ / HLG (or any gamut and transfer) with Bradford adaptation and tone mapping (ACES 2.0 tonescale, BT.2390 EETF, extended Reinhard, clip), camera presets (log → Rec.709), then up to two LUTs (`.cube`, `.3dl`, `.spi3d`, `.spi1d`, `.csp`, tetrahedral, by drag and drop). Each panel measures the signal, after the CST or after the LUTs (gear menu, key `C`), shown in the panel head. Manufacturer look LUTs are not bundled; the app links their official download pages ([docs/research/lut-cst.md](docs/research/lut-cst.md)).
- **Honest about what it knows.** Transfer (BT.1886, gamma 2.2 / 2.6 / 2.8, sRGB, linear, PQ, HLG) and matrix come from the stream metadata; when nothing is signalled the source card says so and names the assumption.
- **Waveform zoom and channels.** Black and highlight magnifier for black balance, parade / YRGB / RGB channels can be hidden, labels switchable.
- **Built-in test patterns.** About 40 generated patterns from PLUGE (ITU-R BT.814-4, SDR and HDR) and SMPTE bars to PQ wedges and EBU R 95 safe areas, plus 20 LZ display test images. Open any of them full screen on a monitor, projector or capture.
- **Your layout.** Dock, stack and resize panels by drag and drop, keep layout configurations as JSON.
- **Face tracking.** Skin-tone waveform that follows a detected face; pick which face to track (MediaPipe BlazeFace, runs locally).
- **Vectorscope tools.** Zoom, gamut boundaries and colour-match targets; per-scope settings behind the gear icon.
- **Outputs and overlay scenes.** Send a scope view or clean picture to another screen, as an MJPEG stream or by ffmpeg to RTMP / SRT / RTSP / UDP. Overlay scenes combine any number of scopes with position, size and opacity, editable in the output window (`E`).
- **Remote control.** HTTP / WebSocket control API and a Bitfocus Companion module ([docs/control-api.md](docs/control-api.md), `companion/`).
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

Keys: `1`-`6` layout, `C` measuring stage (signal / after CST / after LUT), `Space` freeze or play, `Left` / `Right` frame, `J` `K` `L` shuttle, `F` full screen, `S` PNG, `B` sidebar, `Esc` leave zoom, `E` edit overlay in an output window.

## Build from source

Requires [Node.js](https://nodejs.org/) 20+ and, for network streams without the desktop app, `ffmpeg` and `ffprobe` in the `PATH` (`brew install ffmpeg`).

```bash
npm install
npm run dev                  # UI http://localhost:4191, bridge on 4192
npm run build && npm start   # production, everything on http://127.0.0.1:4192
npm test                     # colour maths, statistics, bridge input validation
npm run test:e2e             # desktop app via Playwright: waveform pixels, RTSP (mediamtx), outputs/MJPEG, layouts, CST/LUT stages
npm run typecheck
npm run dist:mac             # or dist:win: desktop app with bridge and ffmpeg
```

CI (`ci.yml`) runs types, unit tests, build and the E2E tests on every PR and push to main. The RTSP test is skipped without `mediamtx`/`ffmpeg`.

Release: push a tag `v*`; `release.yml` builds Windows and macOS and attaches the installers to the release.

## Audio

Tone generator and loudness/level analyser, measured with an own DSP core (`src/audio/dsp`, plain TypeScript, tested in vitest against the synthesisable EBU Tech 3341 and Tech 3342 minimum-requirement signals at 44.1 and 48 kHz). Standards and sources: [docs/research/audio.md](docs/research/audio.md).

- **Sources with sound**: network streams through the bridge (protocol 2, same ffmpeg process as the picture, no resampling), the sound of video files, audio devices (echo cancellation, noise suppression and AGC off), audio files (also measured faster than real time), and the generator as loop-back.
- **Audio scopes** in the panel menu, docking layout and saved layouts: level & loudness (sample peak, true peak after ITU-R BS.1770-5 Annex 2, M/S/I on the EBU +9 / +18 scale in LUFS or LU, LRA after Tech 3342, Max M/S/TP, PLR, targets EBU R 128, R 128 s1, s2), loudness history, spectrum (log frequency axis, slope 0/3/4.5 dB/oct, third-octave bands) and goniometer with correlation meter.
- **Tone generator**: sine, square, triangle, saw, white and pink noise (also 500–2000 Hz for Tech 3343), log and stepped sweep, EBU stereo ident, GLITS, L/R ident, polarity test and an A/V-sync beep that matches the flashing test pattern “A/V-Sync”. Level in dBFS with −18 dBFS (EBU R 68) preset, per-channel routing and polarity, output device selectable, self-test of the measuring core.

## Architecture

- **Bridge** (`server/index.mjs`): ffprobe for resolution and colour metadata, then ffmpeg scales to the analysis width and writes raw `rgba` / `rgba64le` frames over a WebSocket. Slow browsers get frames dropped, no queue builds up. The Y'CbCr matrix is passed to ffmpeg explicitly, the transfer function is left untouched. It listens on `127.0.0.1` only and accepts network URLs and test patterns, never local files, ffmpeg options or a shell.
- **Renderer** (`src/renderer.ts`): one WebGL2 context behind all panels. Every sampled pixel is scattered as an additive point into a float target (up to 4 million per scope and frame) and mapped with `1 - e^(-k x)`.
- **UI**: plain TypeScript, [dockview](https://github.com/mathuo/dockview) for the docking layout, Vite for the build, Electron for the desktop shell.
- **Web build**: asset paths are relative, so it runs at `/` and under `/lz-scopes/`.

Details: [docs/control-api.md](docs/control-api.md) (control API), [docs/frame-protocol.md](docs/frame-protocol.md) (frame protocol), [docs/cable-planner-integration.md](docs/cable-planner-integration.md) (use inside cable-planner), [docs/research](docs/research) (standards and market research), [docs/PUBLISHING.md](docs/PUBLISHING.md) (going public).

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
- No NDI or SDI (DeckLink / AJA) input. Audio from the browser is limited to 2 channels (more only through the bridge); bridge audio cannot be monitored yet.
- Browser sources (camera, file) are always 8 bit and pass through the browser's colour management.

## Author

Built and maintained by **Lars Zumpe**, Lars Zumpe Medienproduktion. Scopes can also be used inside [LZ Cable Planner](https://github.com/larszu/cable-planner).

## License

Proprietary, &copy; 2026 Lars Zumpe, all rights reserved. Using the published builds is free; redistribution and derivative works are not. See [LICENSE](LICENSE). Not open source: the code is public to read.
Bundled third-party components keep their own licences: [THIRD_PARTY.md](THIRD_PARTY.md) (including the GPL ffmpeg binary in the desktop app).

The logo, signet and app icon of Lars Zumpe Medienproduktion are its own trademark and not free to use (LICENSE, section 10). The interface follows the Brand Guide 2.0 (Public Sans, navy palette); scope traces and measurement colours are not brand colours and stay unchanged.
