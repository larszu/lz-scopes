# Latency: measuring and reducing (#16)

## Sources opened

- W3C WebCodecs (https://w3c.github.io/webcodecs/, 30.09.2026): `VideoDecoder` is exposed
  in `Window` and `DedicatedWorker`; `VideoDecoderConfig.optimizeForLatency`.
- W3C AVC (H.264) WebCodecs Registration (https://w3c.github.io/webcodecs/avc_codec_registration.html):
  without `description` the bitstream is "annexb"; a key frame chunk must contain the IDR
  picture and all parameter sets; codec string `avc1.PPCCLL` after RFC 6381 §3.4.
- Not opened, taken from ffmpeg's own output: the FLV tag layout (verified against a file
  written by ffmpeg, test/fixtures/testsrc-h264.flv, and in the unit tests).

## Method

Glass-to-glass in the strict sense (camera looking at a screen) needs hardware. Here the
chain is measured from the moment a frame is created to the moment it is drawn:

1. `scripts/latency-source.mjs` renders frames with the wall clock and a counter as
   black/white blocks (`server/stamp.mjs`: sync word, 16-bit counter, check byte, 32-bit
   ms), encodes with x264 zero-latency and publishes to mediamtx (RTSP).
2. The bridge pulls with ffmpeg and stamps each frame with its own clock when the frame
   leaves ffmpeg (header value of `LZV1`/`LZHK`/`LZHD`).
3. The app reads the stamp from the pixels on arrival and closes the measurement at the
   next animation frame (the frame is drawn in that frame).

Not included: the display's own processing and scan-out, and camera exposure/readout.
All parts use wall clocks and are only meaningful on one computer (or with NTP).

## Measurements (MacBook, Electron, 1280×720 → 960×540, 25 fps; e2e/latency.spec.ts)

Four runs on the same machine while other jobs were running – the spread between runs is
larger than the differences between the paths:

| Path | Run 1 | Run 2 | Run 3 | Run 4 (stamp → drawn, mean ms) |
|---|---|---|---|---|
| raw, main thread (before #16) | 118 | 181 | 118 | 164 |
| raw, worker | 113 | 136 | 118 | 120 |
| H.264, worker | 66 | 71 | 102 | 64 |

Split (run 3): source → bridge 107 / 106 / 89 ms, bridge → app 6–8 ms, H.264 decode 8 ms.
Most of the latency sits before the bridge: x264 encode of the test source, RTSP via
mediamtx, ffmpeg decode. A bare ffmpeg pull of the same stream (no app) gave 93–134 ms
with a minimum of ~90 ms, so the app itself adds little (bridge → drawn ≈ 10–15 ms).

Statistics of a 1920×1080 video file (e2e/gpustats.spec.ts), main-thread time per update:

| Path | Median | Max |
|---|---|---|
| CPU, 480-px readback (before) | 6.9–7.6 ms | 10–12 ms |
| GPU reduction, full resolution | 0.5 ms | 0.6–0.8 ms |

## Conclusions

- The worker keeps reception off the main thread and hands over only the newest frame;
  with an idle main thread the latency is the same, its benefit is that a busy main thread
  (many panels, software WebGL) no longer queues stale frames.
- H.264 transport lowers the data rate by roughly 50× (useful for remote bridges); its
  latency was lower than raw in all four runs (64–102 vs 118–181 ms), mostly in the
  source → bridge part. Likely cause, not proven: 2 MB raw frames through the ffmpeg pipe
  into the Electron main process versus ~5 KB per H.264 frame; a bare ffmpeg pull without
  Electron did not show the difference. It is 8 bit 4:2:0 and lossy, so it is
  labelled as such in the source card and the Messwerte panel.
- The GPU statistics remove the synchronous readback for browser-decoded video (camera,
  capture, files) – about 6 ms less main-thread work every 100 ms, at full resolution.
