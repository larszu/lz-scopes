<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lzm_hauptlogo_offwhite.svg" />
    <img src="docs/brand/lzm_hauptlogo_navy.svg" alt="Lars Zumpe Medienproduktion" width="220" />
  </picture>
</p>

<h1 align="center">LZ Scopes</h1>

<p align="center">
  <b>Software waveform monitor, vectorscope, histogram and CIE diagram, including RTSP streams.</b><br />
  Measure camera, screen, file, network stream or a built-in test pattern. In the browser or as a desktop app for macOS, Windows and Linux.
</p>

<p align="center">
  <a href="https://github.com/larszu/lz-scopes/releases/latest">
    <img src="https://img.shields.io/badge/Download-macOS%20%7C%20Windows%20%7C%20Linux-1D324F?style=for-the-badge&logo=github&logoColor=white" alt="Download LZ Scopes for macOS, Windows and Linux" height="40" />
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

Scopes that measure instead of guessing: waveform, parade, vectorscope, histogram, CIE diagram, false colour and readings – from a camera, a capture card, NDI, RTSP/SRT, DaVinci Resolve or a file. Up to 16 bit, unclipped Y′CbCr, HDR and log included.

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

## Install

[Latest release](https://github.com/larszu/lz-scopes/releases/latest) for macOS, Windows and Linux (x64 and arm64). The desktop app brings everything with it, ffmpeg included – RTSP and SRT work straight away. Without installing: the [web version](https://larszu.github.io/lz-scopes/) (test patterns, camera, screen, files).

Linux packages, iPhone/iPad and the fine print: [details → install](docs/details.md#download-and-install).

## Quick start

1. Start the app – the first source is a test pattern, every panel follows it.
2. Pick a source per panel: *Test pattern*, *Camera*, *Screen*, *File* or *Stream*.
3. For a stream, type the URL, e.g. `rtsp://user:pass@host:554/stream`.
4. Drag a rectangle in the picture to measure that area only.
5. Arrange the panels by drag and drop, save them under *File → Layouts …*.

Keys: `1`–`6` layout · `Space` freeze or play · `←`/`→` one frame · `J`/`K`/`L` shuttle · `C` measuring stage · `F` full screen · `S` PNG. All of them under *Help → Keyboard shortcuts*.

## What it does

- **Scopes**: waveform (luma, colour, RGB), RGB/YRGB/YCbCr parade, vectorscope (also split by tonal range), HLS, CIE, diamond, 3D colour volume, histogram, saturation vs luma, channel plot, readings.
- **Inputs**: camera, screen, file (through the bridge up to 16 bit, with transport), folder, RTSP, SRT, RTMP, NDI, DeckLink/UltraStudio, SDI VANC, DaVinci Resolve.
- **Measuring properly**: unclipped Y′CbCr (sub-black, super-white), EBU R 103, PQ/HLG in cd/m², the manufacturers' log curves, CST and LUTs per source, scale in %, 8/10 bit, nits or stops.
- **Matching cameras**: reference camera with ghost trace, colour chart match with ΔE and a matrix proposal, skin tones of every camera in one vectorscope, drift guard, Touch Shading through the [LZ Camera Bridge](https://github.com/larszu/lz-camera-bridge). Camera colour match that drives the camera itself (Blackmagic REST, Panasonic and Sony CGI, Sony VISCA over IP in the desktop app, bridge, or step-by-step guide) against built-in or imported chart definitions (JSON, kept locally).
- **On the desk**: alarm frames per panel with a hold time, QC log as CSV, recording with ring buffer and synchronised playback, output window for the second screen, control from Companion.
- **Also**: test patterns (SMPTE, PLUGE, zone plate, HDR, LED wall), display calibration, light meter, clock and time code, audio with loudness and A/V offset.

Every feature in detail, including what has been tried on real hardware: **[docs/details.md](docs/details.md)**.

## Read on

| | |
|---|---|
| [Details](docs/details.md) | every feature, install, limits, tests |
| [Manual: inputs](docs/manual/inputs.md) | Resolve, windows, folders, capture cards, files |
| [Control API](docs/control-api.md) | HTTP and WebSocket, Companion module |
| [Frame protocol](docs/frame-protocol.md) | feed your own source into the scopes |
| [docs/research](docs/research) | measurement methods, standards, sources |

## Author

Built and maintained by **Lars Zumpe**, Lars Zumpe Medienproduktion.

## License

Proprietary, &copy; 2026 Lars Zumpe, all rights reserved. Using the published builds is free; redistribution and derivative works are not ([LICENSE](LICENSE)). Not open source: the code is public to read. Bundled third-party components keep their own licences ([THIRD_PARTY.md](THIRD_PARTY.md)); logo and signet are a trademark and not free to use.

NDI® is a registered trademark of Vizrt NDI AB.
