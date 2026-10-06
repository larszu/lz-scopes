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

- **Real scopes, in software.** Waveform (luma, RGB overlay, RGB / YRGB / YCbCr parade), vectorscope, Tektronix-style diamond (R′G′B′ gamut), CIE 1931 xy or 1976 u′v′, histogram, false colour (ARRI-style, RED video mode, Sony SDR / S-Log3 palettes), zebra, gamut warning and numeric readout with MaxCLL / MaxFALL for PQ.
- **Streams, not just files.** RTSP, RTMP, SRT, UDP, RTP, HLS and HTTP via an ffmpeg bridge; capture cards through the bridge (`device:`, explicit mode, raw 10-bit formats and decode matrix, also on remote bridges); Blackmagic DeckLink / UltraStudio through a native helper built against the DeckLink SDK (`decklink:`, see [helpers/decklink](helpers/decklink/README.md), untested with hardware); NDI® sources through a helper that loads the user-installed NDI runtime (`ndi:`, [ndi.video](https://ndi.video/), 8-bit UYVY or 16-bit P216, tested only in loopback); watch folders on the bridge machine (`folder:`, newest 16-bit TIFF / DPX / EXR still, only folders released with `--watch-dir` or, in the desktop app, by dialog); DaVinci Resolve in 16 bit through its scripting API (a running Resolve is detected and offered in the source list); camera / USB capture with device picker, screen or window with crop, watch folder, video and image files directly in the browser.
- **HDR aware.** The picture view down-maps HDR and log for SDR screens after BT.2408 (hybrid-linear, highlights through the BT.2390 EETF, reference white ≈ 93 %) or BT.2446 Method A. 8 or 16 bit analysis, PQ and HLG (display peak Lw 500-10 000 cd/m², system gamma applied to luminance per BT.2100, EBU R 167 presets), BT.709 / 2020 / 601 with 525- and 625-line primaries, waveform scale in cd/m² with BT.2408 reference marks (75 % HLG, 58 % PQ, 38 % grey card) and optional EBU R 103 limits (-5 / 105 %).
- **Camera log.** ARRI LogC3 / LogC4, Sony S-Log3, Panasonic V-Log, Blackmagic Film Gen 5, Canon Log 2 / 3, RED Log3G10, Fujifilm F-Log2, DJI D-Log, Nikon N-Log and Apple Log with their camera gamuts (Bradford-adapted where the white differs). Log acts on the scene-referred waveform scale (reflectance, 18 % grey), the CIE diagram, the picture view and the vectorscope targets.
- **CST and LUTs per source.** Colour space transform to Rec.709 / Rec.2020 PQ / HLG (or any gamut and transfer) with Bradford adaptation and tone mapping (ACES 2.0 tonescale, BT.2390 EETF, extended Reinhard, clip), camera presets (log → Rec.709), then up to two LUTs (`.cube`, `.3dl`, `.spi3d`, `.spi1d`, `.csp`, tetrahedral, by drag and drop). Each panel measures the signal, after the CST or after the LUTs (gear menu, key `C`), shown in the panel head. Manufacturer look LUTs are not bundled; the app links their official download pages ([docs/research/lut-cst.md](docs/research/lut-cst.md)).
- **Honest about what it knows.** Transfer (BT.1886, gamma 2.2 / 2.6 / 2.8, sRGB, linear, PQ, HLG) and matrix come from the stream metadata; when nothing is signalled the source card says so and names the assumption.
- **CRT look.** Per scope (⚙ → Darstellung) the trace can be drawn as an analogue beam: segments between neighbouring samples with a Gaussian spot (after [woscope](https://github.com/m1el/woscope), MIT), brightness falling with beam speed, phosphors P31 / P1 / P7, persistence up to infinite, glow and beam width ([docs/research/crt-trace.md](docs/research/crt-trace.md)). A look only: the levels are the same as in the digital display.
- **Waveform zoom and channels.** Black and highlight magnifier for black balance, parade / YRGB / RGB channels can be hidden, labels switchable.
- **Unclipped Y′CbCr and EBU R 103.** Bridge mode *16 bit Y′CbCr* sends Y′CbCr 4:4:4 without range conversion; the shader converts to R′G′B′ with the source matrix, so values below 0 % and above 100 % survive. EBU R 103 v3.0 check with its measurement filter (1/16…1/16 × 1/4-1/2-1/4): share outside −5/105 % and outside 4-1019 in the Messwerte panel (reported above 1 % of the area) and as picture overlay.
- **Built-in test patterns.** About 40 generated patterns from PLUGE (ITU-R BT.814-4, SDR and HDR, with real −2 %), ITU-R BT.2111-3 HDR bars (HLG narrow, PQ narrow, PQ full, exact 10-bit codes as 16-bit frames) and SMPTE bars to PQ wedges and EBU R 95 safe areas, plus 20 LZ display test images, at preset or free resolutions. Open any of them full screen on a monitor, projector or capture.
- **LED wall check.** Wall/cabinet setup, cabinet grid with IDs, pixel-mapping, scroll, free-level, low-level, shutter/genlock, moiré and patch-sequencer patterns in wall resolution; camera-based relative check after a 4-point rectification: per-cabinet heatmap, seam profiles, before/after, viewing-angle series, scan-line index, dead-pixel search, CSV/PNG report, and an Unreal-style 3×3 camera matrix. With the Opple Light Master (untested, trend meter only): per-cabinet luminance/Δu′v′/CCT map, white point actual/target/Δ with hints per processor (NovaLCT, NovaStar VX, Brompton Tessera) and per-cabinet matching to a reference, flicker, joint CSV/PNG report. The wall itself is calibrated in its processor (Brompton, NovaStar, Colorlight); not yet tried on a real wall.
- **Light meter.** Opple Light Master 3 / 4 over Web Bluetooth, several at once, each with a remembered name: lux, CCT, Duv, xy, history, CSV. Own light scopes for the dock: chromaticity (CIE 1976/1931 with Planckian locus and isotherms), a "vectorscope of the light" around a target white (CIELUV hue/saturation, mired and CTO/CTB gel suggestion), the 6/8 filter channels (not a spectrum), time course, and a measuring grid built point by point (uniformity, Δu′v′, comparison of two lights). The meter gives one value at one place, no image. No pairing needed (it never shows up in the system's Bluetooth settings): switch it on, click *Find Light Master* and pick it from the list. Tested with a Light Master 3 in the desktop app; the Light Master 4, flicker and several meters at once only without a second device. Not suitable for display calibration (illuminance sensor without display correction, see the research). Also: a colour patch showing the measured chromaticity (with Duv) on the display (sRGB/P3, out-of-gamut marked), a wavelength view (Opple: filter channels, not a spectrum; spectrometers: the real spectrum), and further meters behind one interface: spectrometers/colorimeters via ArgyllCMS `spotread` on the bridge (spectrum, CRI/TLCI/TM-30 as computed by ArgyllCMS; untested) and spectrum files (Argyll .sp, CSV). Gel suggestions use Lee/Rosco manufacturer data, including Lee plus/minus green.
- **Your layout.** Dock, stack and resize panels by drag and drop, keep layout configurations as JSON.
- **Face tracking.** Skin-tone waveform that follows a detected face; pick which face to track (MediaPipe BlazeFace, runs locally).
- **Vectorscope tools.** Zoom, gamut boundaries and colour-match targets; per-scope settings behind the gear icon.
- **Scopes over time.** Timeline panel with colour barcode, hue, saturation and luma over the last 10 s – 5 min; persistence (trace history) for vectorscope, CIE, diamond and 3D volume.
- **Colour targets and colour match (#55).** Customer CI colours as hex, RGB 8/10 bit or legal 16–235/64–940, read as video value (graphics workflow) or as sRGB display light; picked from a probe, a frame or an uploaded logo; saved in named lists with JSON export/import. The *Farbabgleich* panel compares the probe or frame mean of a source with a target or with the same object in a second camera: side-by-side swatches for the display (sRGB/P3), ΔE00/ΔITP, ΔL/ΔC/ΔH, hue and saturation, and the correction in words, values and camera terms (Multi-Matrix, white balance, Resolve). Measurement series for effect paints (several spots or angles). *Waveform Grüntöne*, green wedge and picture overlay for grass and foliage (BT.2408 levels as presets). Hex/RGB at every probe read-out. Notes: [docs/research/farbziele.md](docs/research/farbziele.md).
- **3D colour volume and ΔE.** Point cloud in the R′G′B′ cube, CIELAB or ICtCp with scaled axes, rotatable by dragging, with the target gamut as wire frame; ΔE 2000 (SDR) or ΔE ITP (HDR) of the probe point against the nearest colour bar or an own target. Extra curves: Sony S-Log2, ACEScct, ARRI LogC3 for EI 160–1600 (ARRI white paper).
- **A/B comparison and gamut compression.** Picture panel: split, wipe or difference against another stage of the same source (signal / after CST / after LUT) or another source; ACES 1.3 reference gamut compression as a preview for picture and gamut warning.
- **Outputs and overlay scenes.** Send a scope view or clean picture to another screen, as an MJPEG stream or by ffmpeg to RTMP / SRT / RTSP / UDP / TCP, or as a 10-bit stream (HEVC Main 10, v210, ProRes). Overlay scenes combine any number of scopes with position, size and opacity, editable in the output window (`E`).
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

The desktop app contains the bridge and a redistributable ffmpeg 9.0.2 (GPLv3, with SRT; licences and source: [THIRD_PARTY.md](THIRD_PARTY.md)), so RTSP, SRT and other network sources work right away without a system ffmpeg. The *Bridge* section shows which ffmpeg runs. macOS builds are ad-hoc signed: on first start, right-click and choose *Open*.

**Web edition:** <https://larszu.github.io/lz-scopes/>. Test patterns, camera, screen and files work there. RTSP, SRT and other network streams need the desktop app or `npm start`, because a browser cannot open them.

## Quick start

1. Start the app. The first source is a test pattern (SMPTE 75 % bars, the „(LZ)“ variant: look at its black field in the waveform with the black magnifier); all panels follow it.
2. Pick another source per panel: *Test pattern*, *Camera*, *Screen*, *File* or *Stream*.
3. For a stream enter the URL (for example `rtsp://user:pass@host:554/stream`) and connect. Resolution, frame rate, 8 / 16 bit, TCP / UDP, transfer and colour space are set per stream, *auto* reads the metadata.
4. Drag a rectangle in the picture to measure only that area. Click sets a measurement point that is marked in waveform and vectorscope.
5. Arrange the windows with drag and drop, store the result under *Layouts*.

Keys: `1`-`6` layout, `C` measuring stage (signal / after CST / after LUT), `Space` freeze or play, `Left` / `Right` frame, `J` `K` `L` shuttle, `F` full screen, `S` PNG, `B` sidebar, `Esc` leave zoom, `E` edit overlay in an output window.

## Build from source

Requires [Node.js](https://nodejs.org/) 20+. `npm run ffmpeg:fetch` downloads the same ffmpeg the app ships (SHA-256-checked, into `vendor/ffmpeg/`); without it the bridge uses `$FFMPEG` or an ffmpeg from the `PATH`.

```bash
npm install
npm run ffmpeg:fetch         # ffmpeg/ffprobe of the desktop app for this machine (tests and npm start use it)
npm run dev                  # UI http://localhost:4191, bridge on 4192
npm run build && npm start   # production, everything on http://127.0.0.1:4192
npm test                     # colour maths, statistics, bridge input validation
npm run test:e2e             # desktop app via Playwright: waveform pixels, RTSP and SRT (mediamtx), outputs/MJPEG, 10-bit/SRT push, layouts, CST/LUT stages
npm run typecheck
npm run dist:mac             # or dist:win: desktop app with bridge and ffmpeg
```

CI (`ci.yml`) runs types, unit tests, build and the E2E tests on every PR and push to main, and tests the shipped ffmpeg builds on macOS and Windows (licence, SRT, 10-bit push). The RTSP/SRT receive tests are skipped without `mediamtx`.

Release: push a tag `v*`; `release.yml` builds Windows and macOS, checks the ffmpeg inside the packages and attaches the installers and the ffmpeg source archives to the release. `workflow_dispatch` is a dry run.

## Audio

Tone generator and loudness/level analyser, measured with an own DSP core (`src/audio/dsp`, plain TypeScript, tested in vitest against the synthesisable EBU Tech 3341 and Tech 3342 minimum-requirement signals at 44.1 and 48 kHz). Standards and sources: [docs/research/audio.md](docs/research/audio.md).

- **Sources with sound**: network streams through the bridge (protocol 2, same ffmpeg process as the picture, no resampling, with presentation timestamps), the sound of video files, audio devices in the browser (echo cancellation, noise suppression and AGC off; HDMI capture cards, laptop microphone, USB interfaces, Dante Virtual Soundcard/Dante Via as system devices – at most 2 channels in Chromium), audio devices read by the bridge with all their channels (`audio:avfoundation|dshow|alsa:<name>`, and `device:…#audio=<name>` for picture and sound of a capture device), audio files (also measured faster than real time), and the generator as loop-back. Bridge sound can be monitored (drift-compensated ring buffer, selectable output device and channel pair).
- **Audio scopes** in the panel menu, docking layout and saved layouts: level & loudness (sample peak, true peak after ITU-R BS.1770-5 Annex 2, M/S/I on the EBU +9 / +18 scale in LUFS or LU, LRA after Tech 3342, Max M/S/TP, PLR, targets EBU R 128, R 128 s1, s2), loudness history, spectrum (log frequency axis, slope 0/3/4.5 dB/oct, third-octave bands) and goniometer with correlation meter; PSR, true-peak marks in the history, protocol as CSV and PNG, compact level bar on picture panels. Channel weights beyond 5.1 after BS.1770-5 Annex 3 (Table 4/5).
- **Ident & A/V offset** (panel “Audio Ident & A/V-Versatz”): recognises EBU stereo ident (R 49), GLITS, BLITS and the EBU multichannel ident (Tech 3304) and reports swapped L/R, inverted polarity, missing channels, channel order and line-up level. Measures the A/V offset between flash and beep with the PTS of the bridge and rates it after ITU-R BT.1359-1; the picture output of the “A/V-Sync” pattern can be calibrated (see docs/research/audio.md, section h – a browser cannot guarantee sync of its picture output without a measurement).
- **Tone generator**: sine, square, triangle, saw, white and pink noise (also 500–2000 Hz for Tech 3343), log and stepped sweep, EBU stereo ident, GLITS, BLITS, EBU multichannel ident, L/R ident, polarity test and an A/V-sync beep that matches the flashing test pattern “A/V-Sync”. Level in dBFS with −18 dBFS (EBU R 68) preset, stereo, 5.1 or 7.1 output, per-channel routing and polarity, output device selectable, self-test of the measuring core. Control API/Companion: `audio.reset`, `audio.pause`, `generator`.

## Display calibration and verification

⚙ → *Kalibrierung / Verifikation …* (procedures after DisplayCAL, own code; [docs/research/display-kalibrierung.md](docs/research/display-kalibrierung.md)).

- **Patch sequencer**: the pattern output window (`?out=`) shows the measuring patches (size, constant APL background, optional full-field insertion against ABL). The sequencer (`src/patchSequencer.ts`) is shared with the LED-wall tools.
- **Meter**: ArgyllCMS `spotread`, started by the bridge as a separate program (desktop app or `npm start`), with CCMX/CCSS correction and display type. ArgyllCMS is not bundled; without it the dialog says “ArgyllCMS nicht gefunden” and takes XYZ or xyY by hand. *Untested with real hardware.*
- **Own patch sets**: grey 21, Video 47, Video 81, HDR PQ (up to the chosen peak). Untethered mode for external generators (new patch when ΔE00 > 1.5, confirmed twice).
- **Report**: ΔE00 and ΔITP (mean, median, 95th percentile, max) against BT.1886 with measured black / gamma / sRGB / PQ, grey curve with effective gamma, CCT and Duv, contrast; CSV, HTML, print to PDF.
- **Uniformity** 3×3 to 9×9 at 100/75/50/25 %, ΔE00 to the centre (≤ 4 / ≤ 2 as quoted by DisplayCAL for ISO 14861) and contrast deviation.
- **3D LUT** `.cube` 33/65 from a matrix/shaper model of the measurements, only if the model predicts the measured patches well enough (SDR only).
- **System profile (desktop app)**: ⚙ → *Systemprofil mitschalten* sets the operating system's display profile to match the chosen display colour space (sRGB / Display P3 / Rec.709, profile per space selectable). The previous profile is backed up first and restored on quit, with *Zurücksetzen* and after a crash on the next start. macOS via a small Swift helper on the public ColorSync API (`npm run build:helpers`, checked on a built-in display), Windows via mscms (untested). Monitor preset/brightness over DDC/CI (VCP 0x14 / 0x10) where a tool is present, untested. Not available in the browser ([docs/research/systemprofil.md](docs/research/systemprofil.md)).

## Clock and time code

Panel type **Clock / time code** (and an optional corner read-out in the picture panel). Sources and findings: [docs/research/clock-ptp.md](docs/research/clock-ptp.md).

- **Above 30 fps** the time code counts 0…49/59 like editing software and FFmpeg; ST 12-1 frame pairs as an option. LTC runs at 25/30 code words (pairs) there.
- **Time of day** after SMPTE ST 2059-1: system time → TAI (IERS Bulletin C 72, TAI − UTC = 37 s) → time address with Daily Jam, 23.98 … 60 fps, DF/NDF, frame phase to the SMPTE epoch. Labelled “system clock – no reference” unless PTP corrects it.
- **Source time code**: container start time code (ffprobe tag), GOP/SEI time code per frame (ffmpeg `showinfo`), DaVinci Resolve timeline time code, browser video files from `currentTime`; difference to the time of day in frames.
- **LTC** from any source with sound: own biphase-mark reader (24–30 fps, forward and reverse).
- **PTP monitor** in the bridge (own code, UDP 319/320 on 224.0.1.129): grandmaster, domain, clockClass, rates, SMPTE SM TLV (lock, local offset, next jam), offset and optional mean path delay as software-timestamp estimates. No PTP on the network → “no PTP received”. The UI served by the bridge or the desktop app may use it directly; another web origin (e.g. GitHub Pages) only after the user allows it on the bridge's own `/allow` page.
- **ST 2110 RTP check**: RTP timestamp (90 kHz, zero offset at the epoch) against arrival time and frame grid.

## Architecture

- **Bridge** (`server/index.mjs`): ffprobe for resolution and colour metadata, then ffmpeg scales to the analysis width and writes raw `rgba` / `rgba64le` frames (or `ayuv64le` in Y′CbCr mode, [docs/frame-protocol.md](docs/frame-protocol.md)) over a WebSocket. Slow browsers get frames dropped, no queue builds up. The Y'CbCr matrix is passed to ffmpeg explicitly, the transfer function is left untouched. It listens on `127.0.0.1` only and accepts network URLs and test patterns, never local files, ffmpeg options or a shell.
- **Reception and latency** (#16): the stream WebSocket runs in a worker (`src/frameWorker.ts`) that hands over only the newest frame. Optional H.264 transport for remote bridges (source card: `H.264 · 8 bit`; about 1/50 of the data rate, 8 bit 4:2:0, lossy, decoded with WebCodecs). Histogram and clip values of browser-decoded video come from a GPU reduction (`src/gpuStats.ts`). `node scripts/latency-source.mjs rtsp://…` publishes a stamped test picture; the Messwerte panel then shows its latency. Numbers: [docs/research/latency.md](docs/research/latency.md). **Low Latency** (per source in the source card, or globally in Settings), each part adjustable: analysis width cap (320–960 px or native), drawing on frame arrival, the bridge's own RTP reception for `rtsp://` (H.264/HEVC over TCP or UDP; access units end at the RTP marker bit instead of one frame later in ffmpeg's parser; ffmpeg stays the fallback) and the statistics rate. The panel head shows `Low Latency · … ms`; [docs/research/rtp-eigenempfang.md](docs/research/rtp-eigenempfang.md). ffmpeg's raw output runs without encoder frame threads (`-threads 1`, all sources) and hands every frame out at once. `node scripts/latency-bench.mjs` compares ffmpeg variants. Numbers and ranked proposals: [docs/research/low-latency.md](docs/research/low-latency.md).
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

- Only bridge streams in *16 bit Y′CbCr* mode and the 16-bit patterns keep sub-black and super-white; 8 / 16 bit R′G′B′ streams and browser sources are clipped to 0-100 %, the R 103 check then says so.
- The R 103 check runs on the analysis picture; with a scaled analysis width it is not normative (set width to native).
- Output windows render above 8 bit where the browser allows it (pattern window: float16 canvas with exact 10-bit codes, `R` switches levels 0–100 % / codes 1:1 for a legal-range monitor; scope windows: RGBA16F WebGL buffer). The window shows what the pipeline delivers; whether the display link carries 10 bit is not known – use the *10-bit ramp* banding test or a capture. A 10-bit stream (`codec=hevc10|hevc422|v210|prores`, v210 bit-exact) goes through the bridge. See [docs/research/10bit-ausgabe.md](docs/research/10bit-ausgabe.md).
- No AJA input. NDI only with the NDI runtime installed, no sound, untested with real network sources. DeckLink only through our own helper (ffmpeg's own DeckLink device is "nonfree" and cannot be redistributed); it ships with the desktop app but has never run with hardware, and the Windows helper has only been compiled. Audio from the browser is limited to 2 channels (more only through the bridge). Not tested yet: multichannel interfaces and Dante on real hardware, the bridge on Windows, the A/V offset against a real camera.
- Browser sources (camera, file) are always 8 bit and pass through the browser's colour management.

## Author

Built and maintained by **Lars Zumpe**, Lars Zumpe Medienproduktion. Scopes can also be used inside [LZ Cable Planner](https://github.com/larszu/cable-planner).

## License

Proprietary, &copy; 2026 Lars Zumpe, all rights reserved. Using the published builds is free; redistribution and derivative works are not. See [LICENSE](LICENSE). Not open source: the code is public to read.
Bundled third-party components keep their own licences: [THIRD_PARTY.md](THIRD_PARTY.md) (including the GPL ffmpeg binary in the desktop app).

The logo, signet and app icon of Lars Zumpe Medienproduktion are its own trademark and not free to use (LICENSE, section 10). The interface has three skins (⚙ → Oberfläche): *Neutral* (achromatic greys for colour-critical work, default), *LZM* (Brand Guide 2.0, navy) and *Original* (near black). Scope traces and measurement colours are the same in every skin. Reasoning: [docs/research/ui-farben.md](docs/research/ui-farben.md).

NDI® is a registered trademark of Vizrt NDI AB.
