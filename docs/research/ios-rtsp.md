# iOS/iPadOS: RTSP directly on the device (#90)

Status 08.10.2026. Plan in [ios-app.md](ios-app.md) (item 5); this is what was built and why.
Only sources that were actually opened are listed; assessments are marked as such.

## Sources opened

- W3C, WebCodecs AVC codec registration: codec string `avc1.`/`avc3.` + 6 characters per
  RFC 6381 §3.4; "If the description is not present, the bitstream is assumed to be in
  [annexb] format."
- W3C, WebCodecs HEVC codec registration: `hev1.`/`hvc1.` "with a suffix of four
  dot-separated fields" from ISO/IEC 14496-15 §E.3; without `description` the bitstream is
  Annex B.
- IETF RFC 6455 §4.2.2: `Sec-WebSocket-Accept` = base64(SHA-1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"));
  "A server MUST NOT mask any frames that it sends to the client", client frames are masked.
- IETF RFC 2617 §3.5: Digest example (Mufasa / "Circle Of Life", response
  6629fae49393a05397450978507c4ef1) – used as a unit test.
- RTP/RTSP RFCs 3550, 6184, 7798, 2326 as listed in [rtp-eigenempfang.md](rtp-eigenempfang.md);
  the Swift code is a port of that implementation.
- WebKit `Source/WebCore/platform/VideoDecoder.cpp` (GitHub): lists only VP8/VP9/AV1
  (libvpx/dav1d) there; where H.264/HEVC are decoded is not in that file. That WebKit decodes
  them with VideoToolbox on Apple platforms is an **assessment**, not verified in the source.
- Existing measurement (ios-app.md): the CI simulator log shows `VideoDecoder=yes`.

## Decisions

| Question | Decision | Why |
|---|---|---|
| RTSP/RTP code | Swift port of `server/rtsp.mjs` + `server/rtp.mjs` (own code, MIT like the repo) in a Swift package `ios/LzRtsp` | no ffmpeg (GPL, no subprocesses on iOS), same behaviour and counters as the bridge; the package builds for macOS too, so `swift test` runs without a simulator |
| TCP | Network.framework `NWConnection` | system TCP, no extra dependency |
| UDP | BSD sockets, even/odd port pair, 8 MB receive buffer (halved until accepted), IPv4 | port pair rule of RFC 3550 §11, key-frame bursts; NWListener cannot pick the pair |
| Path into the WebView | **Loopback WebSocket in the app speaking the existing frame protocol** (`ws://127.0.0.1:<port>/rtsp?token=…`) | `src/sources.ts` and `src/frameWorker.ts` stay as they are; binary frames without Base64/JSON (the Capacitor bridge would encode every frame as JSON/Base64, +33 % and a copy on the main thread); the worker already decodes Annex B access units with WebCodecs |
| Decoding | **WebCodecs in the WebView** for what it decodes (8 bit H.264/HEVC); **VideoToolbox in the app** for the rest (e.g. HEVC Main 10, or WebKit without HEVC) | compressed AUs are the smallest data across the process boundary (a few Mbit/s instead of ~50 MB/s RGBA at 960 px, 25 fps) and the decoder output stays in WebKit; VideoToolbox decodes, scales to the analysis width and delivers NV12 in the stream's range, the R′G′B′ conversion uses the stream's matrix with the formula of `src/yuv.ts` (no system colour management) |
| WebSocket server | own RFC 6455 handshake on `NWListener` | Network.framework's WebSocket server does not expose the request path/query; only the server side is needed (unmasked text/binary, close, ping) |
| Access control | listen on 127.0.0.1 only, random 128-bit token per app run, `403` otherwise | other apps on the device cannot use the camera connection |
| Credentials | typed `user:pass@` is cut out of the URL before it is stored and saved to the Keychain (`kSecClassInternetPassword`, protocol RTSP, host + port, `WhenUnlockedThisDeviceOnly`); the native side reads it when it connects | passwords never in `localStorage`, in the WebSocket URL or in logs |
| Colour tags | `CMVideoFormatDescriptionCreateFromH264/HEVCParameterSets` → matrix, primaries, transfer, range | CoreMedia parses the VUI; checked in the unit tests (BT.709 tags of the test stream) |
| Route choice | `rtsp://` direct by default, Settings → RTSP direct can switch back to the bridge; `rtsps://` always via the bridge | direct has the lower latency and needs no computer; the bridge still gives 16 bit, sound and TLS |

## Tests

- `ios/LzRtsp/Tests` (Swift Testing): RTP header, sequence/clock wrap, reorder buffer,
  STAP-A/FU-A/AP/FU, gaps, Digest (RFC 2617 vector), Basic, challenge choice, SDP rules,
  stream parser byte by byte, HEVC codec string, credential split.
- Recorded sessions (`scripts/ios-rtsp-fixtures.mjs`): mediamtx + ffmpeg SMPTE bars as H.264
  and HEVC, raw TCP bytes from PLAY on. The Swift parser/depacketizer must produce the same
  access units as `server/rtp.mjs` (SHA-256 per unit, any chunking). VideoToolbox decodes them;
  the 75 % white bar comes out at R′G′B′ 191 ±4 (0.75 × 255).
- Live (`LZS_RTSP_TEST_PORT`, `scripts/ios-rtsp-testserver.mjs`): frame server end to end over
  TCP and UDP, WebCodecs route (LZHK with SPS in front) and VideoToolbox route (LZV1 at 640 px),
  Digest with stored credentials and with a wrong password (`rtsp.unauthorized`), wrong token
  refused, unreachable camera reported.
- iOS workflow: the simulator app opens H.264 and HEVC (Main 10 from the shipped x265) at
  start (`-LzsAutoStreams`, debug builds only); `scripts/ios-rtsp-check.mjs` requires both live
  in the WebView with ≥ 25 frames and the 75 % bar at 191 ±8.

## Not verified

- Real iPhone/iPad (simulator runs on the Mac's GPU and video stack), real cameras, Wi-Fi
  loss behaviour, the local-network permission prompt for cameras in the LAN (loopback needs
  none; a camera on the LAN does – `NSLocalNetworkUsageDescription` is set).
- HEVC via WebCodecs on a device (the simulator test uses Main 10 → VideoToolbox).
- Long sessions, camera mode switches with new parameter sets, cameras sending only in-band
  parameter sets (handled in code, not tested against hardware).
