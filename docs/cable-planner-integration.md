[Deutsch](cable-planner-integration.de.md) | **English**

# LZ Scopes in cable-planner – concept

As of 29 September 2026. None of this is built. It describes how the scopes fit into cable-planner without becoming an “extra tool”.

## Principle

Measuring belongs on the device in the canvas, just like the ATEM multiviewer configuration, camera control and Videohub routing. There is no separate scopes view in the suite. Clicking a camera in the plan offers *Preview* **and** *Scopes* right there.

## What cable-planner already has

- `StreamsSection` (#946): streams per device (`StreamEndpoint`: protocol, direction, address without credentials)
- `streamPreviewService` in the Electron main process:
  - local addresses only
  - credentials from the keychain; they never reach the renderer
  - ffmpeg is located, not bundled
  - so far fetches exactly **one** still as a `data:` URI, so the window's CSP stays as it is
- `streamPreviewStore`: allowing and blocking the preview per project

These are exactly the safeguards live scopes need too. The scopes therefore extend this service instead of building a second path.

## Proposal

### 1. Transport: IPC instead of WebSocket

Main process:
- `streamScopeService.start(endpointId, { width, depth })` checks the same as `streamPreviewService`: local, allowed, credentials from the keychain.
- It then starts ffmpeg with `-f rawvideo -pix_fmt rgba|rgba64le`. The command line and the explicit matrix are in [`frame-protocol.md`](frame-protocol.md).
- Frames go to the renderer through a `MessageChannelMain` port as a transferable `ArrayBuffer`, i.e. without a copy.

Renderer:
- `source.pushInfo(info)`, then `source.pushFrame(buf)` per frame. Both exist in lz-scopes.

Why:
- No open port and no relaxed CSP (`connect-src`).
- The address with password stays in the main process.
- Neither lz-camera-bridge nor the lz-scopes bridge is needed.

Constraints:
- At most one ffmpeg per endpoint, however many panels are watching.
- ffmpeg runs only while a panel is open.
- If ffmpeg is missing, the same `no-ffmpeg` message appears as for the preview.

### 2. User interface on the device

- **Properties → Streams:** every sending stream gets *Scopes* next to *Preview*. The panel below shows waveform and vectorscope, switchable to parade, histogram or CIE through a header select (`ScopeView`, 2 panels). Transfer and colour space are set to “auto” and come from ffprobe.
- **On the device in the canvas:** the badge can optionally carry a small live waveform (~120×60), only while it is switched on. Double-click opens the large panel.
- **On the cable (measuring point):** a cable whose source device has a sending stream gets *Measure signal* in its context menu. This is the scope on the patch panel: what is measured is what arrives on this line. Without a stream the entry stays greyed out, with a hint saying what is missing (for example “SDI – capture or encoder needed”, as in `lz-camera-bridge/docs/live-video.md`, category 4).
- **Comparison:** select several devices and choose *Compare scopes*. The panel shows one parade per source side by side, intended for matching several cameras. This is the only place with more than one source, and it comes from the selection in the canvas, not from a separate view.

### 3. Test patterns as a device

- The catalogue has a virtual device *Test pattern generator* (software, no hardware). It has outputs like a real generator and, on the device, the pattern choice from `PATTERNS`, including resolution and label.
- If an output is connected to a display or projector in the plan, and that display is assigned to a screen of the computer, *Output* opens a borderless full-screen window on exactly that screen (`BrowserWindow` with `screen.getAllDisplays()`). This is the `?out=` path of lz-scopes, only with the target screen taken from the plan.
- The LZ display test images belong to it. cable-planner vendors only the 1080p PNGs, about 600 KB.

### 4. Web viewer and mobile

`src/viewer` and `src/mobile` have no ffmpeg. There, *Scopes* and *Measure signal* stay hidden. The test pattern choice works, because it is pure canvas.

## Code sharing

- Vendor the lz-scopes core (`color`, `renderer`, `graticule`, `panel`, `sources`, `patterns`, `embed`) the same way lz-camera-bridge vendors it: `src/renderer/vendor/lz-scopes/` with `VENDOR.md` (source and commit).
- A drift gate following the suite's pattern (`npm run drift` in av-planner-suite) compares against `larszu/lz-scopes@main`. This keeps planner and bridge on the same version without a private npm package and without GitHub access during installation.
- The main-process part (ffmpeg arguments, matrix, backpressure) is added to `src/main/util/streamUrl.ts`. `ffmpegArgs` already exists there and gets a `rawvideo` variant.

## Order

1. IPC transport and streams section (*Scopes* next to *Preview*), with tests for the arguments and the permission logic
2. Measuring point on the cable and badge in the canvas
3. Test pattern generator as a device, output on the assigned screen
4. Comparison of several sources

## Open decisions

- Should the canvas badge be off by default? Proposal: yes, because processing and network load then only arise when someone is looking.
- Should the test pattern generator be a catalogue entry (visible in the plan and the bill of materials) or a function on the display (“Show test pattern”)? Proposal: function on the display plus an optional device, because a real device such as a Blackmagic generator would otherwise be listed twice.
