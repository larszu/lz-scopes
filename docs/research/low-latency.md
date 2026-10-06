# Low latency: where the time goes and what helps

Follow-up to [latency.md](latency.md) (#16). Question from Lars (30.09.2026): how low can the
latency get, and is a separate low-latency mode worth it?

## Sources opened

- FFmpeg source (master, fetched 30.09.2026):
  - `libavcodec/pthread.c`, `validate_thread_parameters`: frame threading is used only when
    the codec supports it **and** `AV_CODEC_FLAG_LOW_DELAY` (`-flags low_delay`) is not set.
    `libavcodec/pthread_frame.c` sets `avctx->delay = thread_count - 1` for video, and
    `libavcodec/avcodec.h` (`thread_type`): "Use of FF_THREAD_FRAME will increase decoding
    delay by one frame per thread". Slice threading (`FF_THREAD_SLICE`) has no such delay.
    `-flags low_delay` therefore also removes the (threads − 1)-frame decoder delay.
  - `libavcodec/rawenc.c`: the `rawvideo` **encoder** declares `AV_CODEC_CAP_FRAME_THREADS`.
  - `libavcodec/frame_thread_encoder.c`, `ff_thread_video_encode_frame`: after submitting a
    frame it returns a packet only if the oldest task is already finished; otherwise it
    returns nothing, and that packet comes out with the next frame. For the rawvideo
    "encoder" (a memcpy) this is one frame interval of latency for nothing.
  - `libavformat/rtpdec_h264.c`: H.264 over RTP sets `need_parsing = AVSTREAM_PARSE_FULL`;
    `libavcodec/h264_parser.c` (`h264_find_frame_end`) ends an access unit only when it sees
    the start of the next one (AUD/SPS/PPS/SEI or a slice with a new first macroblock).
    `libavformat/demux.c` sets `PARSER_FLAG_COMPLETE_FRAMES` only for `AVSTREAM_PARSE_HEADERS`.
    So every RTSP/H.264 input through ffmpeg holds one frame in the parser.
  - `libavformat/rtsp.c`: `reorder_queue_size` defaults to 0 over TCP (or with `max_delay 0`),
    otherwise `RTP_REORDER_QUEUE_DEFAULT_SIZE`; `libavformat/options_table.h`: `nobuffer`
    "reduce the latency introduced by optional buffering", `probesize` default 5 000 000,
    `max_delay`, `flush_packets`.
- Chrome for Developers, "Low-latency rendering with the desynchronized hint"
  (https://developer.chrome.com/blog/desynchronized): the hint skips the compositor queue,
  2d/webgl/webgl2 only, may tear on front-buffer platforms, WebGL needs
  `preserveDrawingBuffer: true`, support via `getContextAttributes().desynchronized`.
- MDN `WebGLRenderingContext.texImage2D`: `VideoFrame` is an accepted source (GPU upload
  without `copyTo` into JS memory).
- WICG `requestVideoFrameCallback` (https://wicg.github.io/video-rvfc/): `expectedDisplayTime`,
  `captureTime`, `receiveTime`, callbacks run before `requestAnimationFrame`.
- Haivision SRT socket options (github.com/Haivision/srt, docs/API/API-socket-options.md):
  `SRTO_RCVLATENCY` default 120 ms in live mode, "the minimum receiver buffering delay".
- Digital Production, "Nobe OmniScope is a Live Act now!" (30.03.2026): glass-to-glass over
  SDI, Resolve Live 80–90 ms, Livegrade ≈ 90 ms, OmniScope via GPU sharing ≈ 10 ms after
  Livegrade (100-fps camera, ±10 ms). timeinpixels.com blog "Introducing Live Pack":
  "zero-copy, near zero-latency GPU signal sharing" with Livegrade, no numbers.
- Not opened (so no claims taken from them): x264 `zerolatency` internals, NDI latency
  figures, OBS, ScopeBox latency. The review pages opened for ScopeBox (Streaming Media
  Producer, RedShark) contain no latency figures.

## Method

Two tools, both on one MacBook (M1 Pro, 10 cores), stamped test source
(`scripts/latency-source.mjs`: stamp → x264 zero latency → mediamtx RTSP over TCP):

1. `node scripts/latency-bench.mjs` – ffmpeg only, as the bridge runs it: stamp → raw frame
   out of the pipe. Variants alternate A B C … three times, 8 s each.
2. `e2e/lowlatency.spec.ts` – the desktop app, configurations alternating, 2-s windows.
   Stages come from time stamps at every hand-over (`src/latency.ts`): source → out of
   ffmpeg (the bridge reads the stamp itself on the raw path and reports it with its 1-s
   stats), bridge → worker (H.264), worker → main thread, waiting for the draw, drawing.
   "Drawn" means the WebGL work and panel copies were issued; compositor and monitor come
   after that and are not measured (a camera looking at the screen would be needed).

Other agents were running builds and tests at the same time, so single runs scatter by
±20 ms; run means are given.

## Where the time went (before)

| Stage | Before | How found |
|---|---|---|
| source: raw frame → x264 → RTSP publish → mediamtx | ≈ 10–15 ms + parser | bench floor |
| ffmpeg RTSP demux: H.264 parser waits for the next access unit | **1 frame** (40 ms at 25 fps) | source code, pipe test at 10/25/50 fps |
| ffmpeg decode (`-flags low_delay` → no frame threads) + scale | 3–5 ms | `-debug_ts` trace |
| ffmpeg **rawvideo encoder, frame-threaded** | **1 frame** (42 ms at 25 fps, 22 at 50) | showinfo → pipe timing |
| pipe ffmpeg → bridge (Node, 2 MB frames in 64-KB reads) | ≈ 5–10 ms at 960 px | e2e split |
| WebSocket → worker → main thread | ≈ 1 ms | e2e split |
| wait for the next animation frame | ≈ 4 ms mean (0–16.7) | e2e split |
| draw (1 panel, texture upload, blit) | 2–5 ms | e2e split |
| compositor, display scan-out, monitor processing | not measured | – |

### ffmpeg variants (`scripts/latency-bench.mjs`, 3 × 8 s, stamp → out of ffmpeg, ms)

| Variant | mean | sd | p50 | run means |
|---|---|---|---|---|
| ffmpeg defaults (no low-delay flags) | 532 | 35 | 530 | 576 / 531 / 490 |
| bridge before (`nobuffer`, `low_delay`, reorder 0) | 98 | 21 | 92 | 111 / 92 / 90 |
| **bridge now (+ `-threads 1` on the rawvideo output)** | **55** | 5 | **54** | 56 / 53 / 55 |
| + decoder `-threads 1` | 55 | 8 | 53 | no gain (low_delay already disables frame threads) |
| + RTSP over UDP | 64 | 27 | 53 | no gain on localhost |
| + showinfo (time code) | 53 | 4 | 52 | no cost |
| + 640 px instead of 960 | 49 | 3 | 49 | −5 ms |
| + `fast_bilinear` instead of `area` | 53 | 3 | 52 | no gain |
| + `-hwaccel videotoolbox` | 55 | 3 | 55 | no gain |
| + `-probesize 32 -analyzeduration 0` | 52 | 3 | 52 | no steady-state gain; starts ≈ 0.7 s sooner |

Isolated check of the rawvideo encoder (showinfo at the end of the filter chain → frame
complete on the pipe, 25 fps): 42 ms → 2 ms with `-threads 1` (16 bit: 43 → 3 ms). Other
containers without the rawvideo encoder (PAM via image2pipe, NUT) show the same 2 ms.

## Measurements in the app (`e2e/lowlatency.spec.ts`, 1 panel, 3 rounds × 8 s, ms)

`main` before this change (e2e/latency.spec.ts, three runs): raw/worker 116 / 121 / 114,
H.264 67 / 67 / 67. This branch, same test: raw/worker 79, H.264 67.

| Configuration | stamp → drawn | run means | source → bridge | worker → main | wait | draw |
|---|---|---|---|---|---|---|
| normal, raw 960 | 93 | 78 / 87 / 115 | 75 | 1 | 4 | 4 |
| normal, raw 640 | 78 | 61 / 92 / 81 | 68 | 1 | 4 | 2 |
| **Low Latency, raw (640)** | **64** | 57 / 75 / 61 | 58 | 0 | 0 | 2 |
| Low Latency without draw on arrival | 71 | 61 / 90 / 63 | 62 | 0 | 4 | 2 |
| normal, H.264 960 | 84 | 66 / 117 / 68 | 66 | 1 | 4 | 4 |
| **Low Latency, H.264 (640)** | **57** | 56 / 59 / 57 | 50 | 1 | 0 | 2 |

(H.264: bridge → worker incl. decode 8 ms at 960, 5 ms at 640.)

## Proposals, ranked (gain at 25 fps, effort)

| # | Measure | Gain | Effort | Status |
|---|---|---|---|---|
| 1 | `-threads 1` for ffmpeg's rawvideo output (bridge, DeckLink/NDI helpers) | **≈ 40 ms (1 frame)** | trivial | **done, for every source** – no downside |
| 2 | Analysis width 640 instead of 960 in low-latency mode | ≈ 5 ms in ffmpeg, ≈ 10–20 ms end to end (less to pipe, send, upload) | small | **in Low Latency**; fewer sample points (640×360) |
| 3 | Draw on arrival instead of at the next animation frame | wait 4 → 0 ms (mean) up to "drawn" | small | **in Low Latency**; visible gain unproven (compositor) |
| 4 | Higher source frame rate (50/60 fps) | every frame-sized hold-back halves (parser, encoder, display) | camera setting | recommendation |
| 5 | Source encoder: no B-frames, zero-latency/low-delay profile, short GOP or intra refresh | camera-dependent, often 1–3 frames | camera setting | recommendation |
| 6 | Own RTP/H.264 depacketiser (marker bit ends the access unit) instead of ffmpeg's parser | ≈ 40 ms (1 frame) | large | **done** (H.264/HEVC, TCP/UDP): [rtp-eigenempfang.md](rtp-eigenempfang.md) |
| 7 | Pass the camera's H.264 through (no decode/re-encode in the bridge), decode with WebCodecs and upload the `VideoFrame` directly as a texture | a few ms plus less CPU; still has #6 unless the RTP part is ours | medium–large | open |
| 8 | Smaller raw frames on the pipe/WebSocket (e.g. 4:2:0 or 4:2:2 8 bit instead of RGBA; 16 bit Y′CbCr stays for #7) | ≈ 5–10 ms at 960 px | medium | open |
| 9 | `desynchronized` canvas + draw on arrival | removes compositor queue (per Chrome, up to a frame) | medium: panels are 2D blits of one WebGL canvas | not built: effect cannot be measured here, may tear |
| 10 | SRT: lower `latency` (default 120 ms) on clean LANs | up to ≈ 100 ms for SRT sources | setting | recommendation (URL parameter `latency`; not tested here) |
| 11 | Capture cards via getUserMedia + `requestVideoFrameCallback` | avoids ffmpeg/pipe/WebSocket entirely for local cards | medium | open (camera path exists; latency not measured) |

Measured and **not** helpful (left out): decoder `-threads 1` (already off through
`low_delay`), `-hwaccel videotoolbox`, `fast_bilinear` scaling, RTSP over UDP on
localhost, removing the time-code showinfo, `-flush_packets 1` on rawvideo, small
`probesize` (only faster start), keeping at most one frame in the WebSocket instead of two
(no difference without back-pressure; not measurable without a slower client).

## What is realistic

- With a local RTSP camera through the bridge: ffmpeg's part is now ≈ 1 frame (parser) +
  ≈ 5 ms; the app adds ≈ 5–10 ms up to "drawn". Everything else is the camera encoder, the
  network and the display. On this machine the whole chain from the test source is
  ≈ 60 ms at 25 fps, of which ≈ 40 ms are one frame interval.
- For reference, Digital Production measured ≈ 80–100 ms glass-to-glass for Resolve Live,
  Livegrade and OmniScope via SDI. A bridge chain is not the same (no SDI, but an encoder),
  so this only frames the order of magnitude.
- Below ≈ 1 frame + display only with an own RTP depacketiser (#6) or uncompressed capture
  (#11), and at higher frame rates.

## Low-latency mode (built)

Per source (source card: `Latenz: global / Low Latency / Latenz normal`, plus the fields
below with "global" as default) and globally (Settings → Low Latency). Every measure is a
setting of its own:

| Setting | Values | Default | Price |
|---|---|---|---|
| Analysebreite | 320 / 480 / 640 / 960 / nativ | 640 | fewer sample points |
| Zeichnen bei Ankunft | an / aus | an | more draw work with several sources; visible gain unproven |
| RTP-Eigenempfang | an / aus | an | sound in a second session without common PTS (no A/V offset); fallback to ffmpeg for anything unsupported |
| Statistik | 100 / 250 / 500 / 1000 ms | 100 | slower histogram/clip values; no measurable gain with one panel |

The panel head shows `Low Latency · … ms`, the source card the measured value next to the
switch (only with stamped pictures), the Messwerte panel the stage split and how the bridge
receives the stream (own RTP with packet counters, or ffmpeg and why).
