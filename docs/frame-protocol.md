[Deutsch](frame-protocol.de.md) | **English**

# LZ Scopes – frame protocol

A WebSocket delivers uncompressed frames to the browser. This repo's bridge speaks it (`/stream?url=…`), and any host can implement it, for example lz-camera-bridge under `/scope/<n>`. On the browser side, `Source.connectFrames(wsUrl)` connects.

| Direction | Type | Content |
|---|---|---|
| Server → client | Text | `{"type":"info","width":960,"height":540,"depth":8\|16,"fps":25,"sourceWidth":1920,"sourceHeight":1080,"codec":"h264","transfer":"smpte2084","primaries":"bt2020","matrix":"bt2020nc","range":"tv","decodeMatrix":"bt2020"}` before the first frame |
| Server → client | Binary | one frame: `width × height × 4` samples R, G, B, A, row by row from the top; `depth` 8 → Uint8, 16 → Uint16 LE |
| Server → client | Text | `{"type":"stats","sent":n,"dropped":n}` (optional, 1 Hz) |
| Server → client | Text | `{"type":"tc","tc":"10:00:07:05","tcPts":7.2,"pts":7.4,"first":0.96,"kind":"gop"\|"s12m"}` (optional, at most 25/s): last timecode from the frame side data and the PTS of the newest decoded frame; Resolve: `{"type":"tc","tc":…,"kind":"resolve","fps":25,"df":false}` before every frame |
| Server → client | Text | Resolve only: `{"type":"resolve","state":"playing"\|"paused","played":true,"project":"…"}` – the timeline started playing (the scripting API blocks, no stills until the pause) or paused again; `played` false = it was only a slow export (#88, `server/resolveWatch.mjs`) |
| Server → client | Text | `{"type":"error"\|"end","message":"…","code":"…","params":{…}}`, then the server closes. `message` is English; the interface translates `code`/`params` (optional, `server/messages.mjs`) as `bridge.<code>` and shows unknown codes with `message`. `stats` can carry `message`/`code`/`params` in the same way. |

Values are full-range R′G′B′ (0 = 0 %, maximum = 100 %). The transfer function is left unchanged; PQ and HLG arrive as code values. `transfer`, `matrix` and `primaries` follow the ffprobe names; if they are missing, the client assumes SDR and BT.709 for HD or BT.601 for SD.

ffmpeg command that produces the format (see `server/index.mjs`):

```
ffmpeg -rtsp_transport tcp -i <url> -an -map 0:v:0 \
  -vf scale=960:540:flags=area:in_color_matrix=bt709:in_range=limited \
  -pix_fmt rgba -f rawvideo pipe:1          # rgba64le for 16 bit
```

Always set `in_color_matrix` explicitly, otherwise swscale converts untagged HD streams with BT.601. If the browser cannot keep up, drop frames instead of buffering them (`ws.bufferedAmount`).

## Whole frames, interlace

Every binary message contains exactly one complete frame (bridge: `server/frames.mjs`, test `test/frames.test.ts`). Parts of two frames in one message do not occur; the client replaces the picture only as a whole. For interlaced sources (ffprobe `field_order` tt/bb/tb/bt, or `interlaced` from the DeckLink/NDI helper) a frame contains both fields woven together; the bridge scales field by field (`scale=…:interl=1`) so the fields are not mixed vertically, and reports `"interlaced": true` in `info`.

## Unclipped Y′CbCr (`format=yuv`)

Opt-in via `/stream?url=…&format=yuv` (sets `depth` to 16). The bridge then does not convert to R′G′B′ but scales Y′CbCr 4:4:4 without range or matrix conversion. Codes below black and above white (sub-black, super-white, BT.2111 −7 %/109 %) arrive unchanged; the client converts to R′G′B′ (shader) without clipping.

`info` gets three fields:

```json
{"type":"info", "...":"as above", "depth":16, "format":"yuv", "yuvRange":"limited"|"full", "bits":10}
```

- Every pixel: 4 × Uint16 LE in the order **A, Y′, Cb, Cr** (ffmpeg `ayuv64le`), A = 65535.
- n-bit codes left-aligned: value · 2^(16−n), in both ranges (checked with ffmpeg 9.0.1: 10 bit 943 → 60352, 8 bit full 255 → 65280). `bits` is n of the source, from `pix_fmt`.
- Narrow: Y′ = (D − 4096)/56064, Cb/Cr = (D − 32768)/57344. Full: Y′ = D/((2^n − 1)·2^(16−n)), Cb/Cr = (D − 2^(n−1)·2^(16−n))/((2^n − 1)·2^(16−n)) (BT.2100-3 Table 9).
- Matrix: `decodeMatrix` or `matrix` as above; the client uses the matrix of the source (can be overridden manually).
- If the source is R′G′B′ (`gbrp`, `rgb24` …), the bridge answers with `"format":"rgb"`, 16-bit R′G′B′ and a `note`.

```
ffmpeg … -i <url> -map 0:v:0 -an \
  -vf scale=960:540:flags=area:in_color_matrix=bt709:out_color_matrix=bt709:in_range=limited:out_range=limited \
  -pix_fmt ayuv64le -f rawvideo pipe:1
```

Other hosts may produce planar `yuv444p16le` instead of `ayuv64le`, but must then reorder to A, Y′, Cb, Cr before sending.

## Protocol 2: picture and sound (`audio=1`)

Opt-in via the request: `/stream?url=…&audio=1` (optionally `&video=0` for audio-only sources). Without `audio=1` everything stays as above; hosts that speak only protocol 1 keep working unchanged (the client recognises protocol 2 by `info.proto`).

`info` gets two fields:

```json
{"type":"info", "...":"as above", "proto":2,
 "audio":{"sampleRate":48000,"channels":2,"format":"f32le","layout":"stereo",
          "codec":"aac","sourceSampleRate":48000,"sourceChannels":2}}
```

`"audio": null` if the source has no sound; then no audio packets arrive either. For audio-only sources `width` and `height` are 0.

With `proto: 2`, every binary message starts with a 16-byte header (little endian); the payload stays 4-byte aligned:

| Offset | Type | Picture `LZV1` | Sound `LZA1` |
|---|---|---|---|
| 0 | 4 × ASCII | `LZV1` | `LZA1` |
| 4 | uint32 | frame number since start | number of sample frames n in the packet |
| 8 | float64 | PTS in s (NaN if unknown) | index of the first sample since start (contiguous; a jump = a gap) |
| 16 | … | RGBA as above | n × channels float32, interleaved |

- **Timestamps (PTS)**: if a stream delivers picture and sound from one ffmpeg process, every frame carries its PTS (seconds, source time base after ffmpeg's start offset). The sound gets anchors as a text message `{"type":"apts","index":n,"pts":t}`: sample `index` has time `t`, later samples count on in steps of `1/sampleRate`. A new anchor comes with the first packet, on a jump of more than 5 ms and at least every 5 s. Picture PTS and sound PTS are comparable (A/V offset). In the fallback path with two processes (below) there are no PTS, because two sessions have different time axes. The bridge reads them from ffmpeg's `showinfo`/`ashowinfo` (log level `info`); a frame waits at most 150 ms for its line, otherwise it goes out with NaN. With a frame-rate limit (`fps=`) the PTS sit on the grid of the `fps` filter.
- Audio packets of 20 ms (960 frames at 48 kHz). No sample-rate or channel conversion: rate and layout as in the source.
- **Sound is never dropped.** The drop rule via `bufferedAmount` applies to pictures only.
- `stats` additionally contains `audioSent`, `audioDropped` (always 0), `audioGaps` and `audioSplit` (fallback path active, see below).
- The test patterns `test:*` deliver with `audio=1` a 1 kHz stereo tone with amplitude 1/8 (−18.06 dBFS, alignment level according to EBU R 68).

ffmpeg, one process with two outputs (sound on file descriptor 3):

```
ffmpeg … -i <url> \
  -map 0:v:0 -an -vf scale=… -pix_fmt rgba -f rawvideo pipe:1 \
  -map 0:a:0 -vn -c:a pcm_f32le -f f32le pipe:3
```

Fallback path: if ffmpeg exits within the first seconds with an error about `pipe:3` (possible on Windows when the descriptor is not inherited), the bridge starts a second ffmpeg process for the sound only (`-vn … pipe:1`). It opens a second session to the source; some cameras do not tolerate that. `LZS_AUDIO_SPLIT=1` forces the fallback path.

## Request parameters for devices and conversion

In addition to `url`, `width`, `fps`, `depth`, `transport`, `audio`:

| Parameter | Values | Applies to |
|---|---|---|
| `size` | `1920x1080` | `device:` – device mode (if omitted on macOS: the largest 16:9 mode) |
| `rate` | `50`, `59.94`, `30000/1001` | `device:` – capture rate of the device |
| `pixfmt` | ffmpeg name, e.g. `yuv422p10le`, `uyvy422` | `device:` – raw format (if omitted: the deepest one offered) |
| `pixel` | `8` | `decklink:` – 8-bit UYVY instead of 10-bit v210 |
| `matrix` | `bt709`, `bt601`, `bt2020`, `smpte240m` | all – fixed matrix for Y′CbCr → R′G′B′ instead of tag/size rule |
| `range` | `tv`, `pc` | all – fixed value range |

`GET /api/devices/formats?url=device:…` returns `{modes:[{width,height,fpsMin,fpsMax,pixfmt?}], pixfmts:[…], preferred, defaultSize}`, `GET /api/decklink` the state of the DeckLink helper `{available, helper, devices, error}`, `GET /api/ndi` the NDI sources `{available, runtime, version, sources:[{name,url}], error}`; an NDI source is called `ndi:<name>`. `GET /api/folders` lists the released watch folders `[{name,url}]` (`folder:<name>`, released with `--watch-dir`).

## Helper protocol (native capture helpers → bridge)

Devices without a free ffmpeg path (DeckLink, NDI) run through a separate helper process that the bridge starts. It writes records to stdout:

| Offset | Type | Content |
|---|---|---|
| 0 | 4 × ASCII | tag `INFO`, `FRAM`, `STAT`, `ERR ` |
| 4 | uint32 LE | length n of the payload |
| 8 | n bytes | payload |

- `INFO` (JSON, before the first frame and on every format change): `{"width":1920,"height":1080,"fpsNum":50,"fpsDen":1,"pixel":"v210","matrix":"bt709","range":"tv","transfer":"unknown","primaries":"unknown","name":"1080i50","timecode":"10:00:00:00"}`
- `FRAM`: one frame in the format `pixel`, rows without further padding. `pixel` ∈ `v210` (48 pixels per 128 bytes), `uyvy422`, `p216le`, `rgb48le`, `bgra`, `bgr0`, `rgba`, `rgb0`, `nv12`, `yuv420p`.
- `STAT` (JSON `{"message":"…","code":"…"}`): status, e.g. “no input signal” (`code` optional, see above).
- `ERR `: error as JSON `{"message":"…","code":"…","params":{…}}` or as plain text; the helper exits afterwards.
- `TIME` (JSON `{"tc":"10:00:00:00","df":false}`, optional, per frame before `FRAM`): timecode of the source (DeckLink: RP 188). The bridge forwards it as `{"type":"tc","tc":…,"kind":"decklink","fps":…,"df":…}`.

For helper sources `stats` additionally contains `phase`: position of frame arrival in the SMPTE ST 2059-1 grid `{periodMs, meanMs, sdMs, driftPpm, n, spanS, ref:"system"|"ptp"}` (server/phase.mjs). `GET /api/decklink/reference?index=n` returns the card's reference/genlock status (`lz-decklink --reference n`, docs/research/genlock.md, German).

`--list` instead prints one JSON line `{"ok":true,"devices":[…]}` or `{"ok":false,"error":"…"}`. The bridge pipes the frames through ffmpeg (`-f v210` or `-f rawvideo -pix_fmt …` from stdin) and the same scaling as for streams; towards the browser, protocol 1 applies. For testing without hardware: `test/fixtures/fake-helper.mjs`.

## Timecode (optional)

`info` can contain `timecode` (start timecode of the container, ffprobe tag, e.g. MOV tmcd), `startTime` (s), `frameRate` (`"30000/1001"`) and `sourceFps`. The bridge puts `showinfo=checksum=0` in front of the scaler and reads from it, per source frame, `pts_time` and the side data “GOP timecode” (MPEG-2) or “SMPTE 12-1 timecode” (SEI). The client computes the current timecode as `tc + (pts − tcPts) × fps`, without side data as `timecode + (pts − startTime) × fps`. Turn it off with `&tc=0`. Hosts that send no `tc` remain compatible.

## Clock: `/clock`

WebSocket only from 127.0.0.1, for the UI of the same origin or a web origin released by the user (`GET /allow?origin=…` shows the bridge's release page; `GET /api/clock-access` tells a page whether it is released; file `allowed-origins.json` in the configuration folder, CLI `--allow-origin`, `--config-dir`, `LZS_CONFIG_DIR`). Server → client at 4 Hz `{"type":"ptp", state, domain, gm, rates, offsetNs, meanPathDelayNs, pathDelayIncluded, sm, history, ifaces, rtp}`; client → server `{"type":"config","iface":"","delayReq":false}` and `{"type":"rtp","group":"239.1.1.1","port":5004,"rateNum":25,"rateDen":1}` or `{"type":"rtp","off":true}`. See `server/ptp.mjs` and `docs/research/clock-ptp.md` (German).

## H.264 transport (`codec=h264`)

For remote bridges with little bandwidth: `/stream?url=…&codec=h264` (forces protocol 2). The bridge scales as above but stays in Y′CbCr (matrix of the source, narrow range, 4:2:0) and encodes with libx264 (`ultrafast`, `zerolatency`, no B-frames, GOP 2 s) into FLV on the pipe; `server/flv.mjs` splits that into access units.

- `info` gets `"transport":"h264"`, `depth` is always 8. `format=yuv` is ignored; PTS and `apts` anchors are dropped (no A/V offset).
- Text `{"type":"video","codec":"avc1.42c01f","format":"annexb"}` before the first frame (codec string according to RFC 6381 from the AVCDecoderConfigurationRecord).
- Binary with the 16-byte header: `LZHK` (keyframe, SPS/PPS prepended) or `LZHD` (dependent frame), uint32 frame number, float64 bridge clock in ms; then one access unit in Annex B format (start codes).
- If the browser cannot keep up, the bridge drops up to the next keyframe.
- The browser decodes with WebCodecs in a worker (`src/frameWorker.ts`) and converts Y′CbCr to R′G′B′ itself with `decodeMatrix` (`src/yuv.ts`), not through a colour-managed canvas. Result: 8 bit, lossy – for exact measurements use the raw transport.

## iOS app: RTSP direct (loopback)

The iPhone/iPad app serves the same protocol itself for `rtsp://` sources (#90, `ios/LzRtsp/Sources/LzRtsp/FrameServer.swift`): `ws://127.0.0.1:<port>/rtsp?token=…&url=rtsp://…&transport=tcp|udp&width=…&wc=h264,hevc`, loopback only, with a random token per app run, no credentials in the URL (Keychain). Protocol 2 without sound. If the stream's codec is in `wc` (what the WebView's WebCodecs decodes) and 8 bit: `info` with `"transport":"h264"|"hevc"`, then `video` and `LZHK`/`LZHD` as above (HEVC: `hvc1.…` codec string, ISO/IEC 14496-15 Annex E). Otherwise VideoToolbox decodes in the app and `LZV1` R′G′B′A 8-bit frames arrive at `width`. `info.direct` is `"webcodecs"` or `"videotoolbox"`; `stats` carries `rtp` like the bridge's own RTP reception.

## Latency stamp

`scripts/latency-source.mjs` writes the time of day (ms, mod 2³²) and a frame counter as black-and-white blocks into the top two rows of the picture (layout in `server/stamp.mjs`). The app reads them in every frame and shows readings in the panel: stamp → display, and for H.264 additionally source → bridge and bridge → app (bridge clock in the `LZHK`/`LZHD` header; on the raw path the `LZV1` header carries the PTS and there is no split). All values assume the same clock (one computer or NTP); the delay of the monitor is not included.

## Local devices

The bridge reads capture and audio devices of this computer via ffmpeg (list: `GET /api/devices` → `[{name, url, kind: "video"|"audio"}]`):

- `device:avfoundation|dshow|v4l2:<video device>` – picture; with `#audio=<audio device>` also the sound in the same ffmpeg process (macOS `"<video>:<audio>"`, Windows `video=…:audio=…`, Linux a second ALSA input, e.g. `#audio=hw:1,0`).
- `audio:avfoundation|dshow|alsa:<audio device>` – sound only, with all channels the driver delivers. `#ch=<n>` requests `n` channels with DirectShow/ALSA.

Names go to ffmpeg as a single argument, never through a shell. With AVFoundation the name must not contain `:` (separator between picture and sound). Tested on macOS with the camera and microphone of a MacBook; DirectShow, ALSA, multichannel interfaces and Dante Virtual Soundcard are untested.
