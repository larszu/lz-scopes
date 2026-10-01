# Own RTP reception (low-latency mode)

Decision by Lars (01.10.2026), proposal 6 of [low-latency.md](low-latency.md): receive RTSP/RTP
in the bridge itself so the frame that ffmpeg's H.264 parser holds back disappears. ffmpeg
stays the decoder/scaler and the fallback for everything the own client does not handle.

## Sources opened

- IETF RFC 3550 (RTP): fixed header (V, P, X, CC, M, PT, sequence number, timestamp, SSRC,
  CSRC list); header extension with a 16-bit length in 32-bit words; padding count in the
  last octet; modular arithmetic for wrap-around; RR packet type 201.
- IETF RFC 6184 (H.264 over RTP): marker bit "set for the very last packet of the access
  unit"; NAL unit types 1–23 single, 24 STAP-A, 25 STAP-B, 26/27 MTAP, 28 FU-A, 29 FU-B;
  non-interleaved mode allows single, STAP-A and FU-A; FU header S|E|R|Type, NAL header
  rebuilt from F/NRI of the FU indicator and the type of the FU header; STAP-A with 16-bit
  sizes; `sprop-parameter-sets` base64, comma-separated; `packetization-mode` 0/1/2.
- IETF RFC 7798 (HEVC over RTP): 2-byte payload header F|Type|LayerId|TID; AP = 48,
  FU = 49 (S, E, 6-bit FuType), PACI = 50; DONL present only if `sprop-max-don-diff` > 0;
  marker bit on the last packet of the access unit; `sprop-vps/sps/pps`.
- IETF RFC 2326 (RTSP 1.0): interleaved binary data `$`, channel byte, 16-bit length
  (§10.12); `Transport: RTP/AVP/TCP;interleaved=0-1` and `RTP/AVP;unicast;client_port=…`;
  GET_PARAMETER without body as liveness "ping" (§10.8); RTP-Info in the PLAY response.
- IETF RFC 7826 (RTSP 2.0): "not backwards compatible other than in the basic version
  negotiation"; session timeout "normally 60 seconds"; any request on the session or RTCP
  keeps it alive. Cameras and mediamtx speak 1.0, so the client is 1.0 only.
- IETF RFC 2617 (Digest): A1 = user:realm:password, A2 = method:uri, response with and
  without qop=auth; header fields. The example of §3.5 is a unit test.
- IETF RFC 4175 (uncompressed video over RTP): extended sequence number, per-line headers
  (length, field/line number, continuation/offset), pgroup 4 octets/2 px for 4:2:2 8 bit,
  5 octets/2 px for 10 bit, marker = end of frame/field, 90 kHz. SMPTE ST 2110-20 builds on
  it; the SMPTE document itself is not freely available and was not opened.
- FFmpeg source: `libavformat/rtpdec_h264.c` (`need_parsing = AVSTREAM_PARSE_FULL`),
  `libavcodec/h264_parser.c` (`h264_find_frame_end` needs the start of the next access
  unit), `libavformat/demux.c` (`PARSER_FLAG_COMPLETE_FRAMES` only for
  `AVSTREAM_PARSE_HEADERS`), `libavformat/matroskadec.c` (H.264: PARSE_HEADERS, HEVC: no
  parser), `libavformat/flvdec.c` (H.264/HEVC: PARSE_HEADERS).

## Design

```
camera ── RTSP (TCP) ──▶ server/rtsp.mjs  OPTIONS, DESCRIBE (SDP), SETUP, PLAY, keep-alive, Digest/Basic
        └─ RTP (TCP $-frames or UDP) ──▶ server/rtp.mjs  header → reorder buffer (UDP) → depacketiser
                                          access unit complete at the marker bit
                                          ──▶ server/mkv.mjs  live Matroska (SimpleBlock per access unit)
                                          ──▶ ffmpeg -f matroska -i pipe:0  (decode, scale, rawvideo/x264 as before)
```

- Why Matroska: every ffmpeg path that takes H.264 as a byte stream (RTSP, raw `h264`,
  MPEG-TS) parses it and ends an access unit only at the next one. Matroska delivers whole
  blocks (H.264 with `PARSE_HEADERS` → complete frames, HEVC without parser), works with
  the bundled ffmpeg 6.0, and needs only a few EBML elements. Bitstream and CodecPrivate
  stay in Annex B (ffmpeg's H.264/HEVC decoders accept Annex B extradata).
- Packet loss: an access unit with a gap is dropped, and so is everything up to the next
  key frame (IDR / IRAP). A scope must not show decoder concealment as signal.
- Reorder buffer (UDP only): waits at most 30 ms or 64 packets for a missing packet, then
  counts it as lost. Over TCP nothing is held.
- Sound: the own client takes only the video track. With sound on, a second ffmpeg opens
  its own RTSP session for the audio (the existing 'split' mode). The two have no common
  PTS, so the A/V offset (#24) is not measured in this mode; the UI says so.
- Fallback to ffmpeg's RTSP input (with a note in the Messwerte panel): `rtsps://`, no
  H.264/HEVC track, H.264 `packetization-mode=2`, HEVC with DONL, any RTSP error.
- Not built: RFC 4175 / ST 2110-20 (uncompressed, needs multicast, PTP and very high data
  rates; a project of its own), RTSP 2.0, RTCP sender-report time base, SRTP.

## Measurements

### ffmpeg stage (`node scripts/latency-bench.mjs`, stamp → raw frame out of ffmpeg, ms)

Quiet machine (01.10., 2 × 6 s):

| Source | ffmpeg RTSP (bridge) | own RTP, TCP | own RTP, UDP |
|---|---|---|---|
| H.264 25 fps | p50 53 (run means 53 / 53) | **12** (12 / 13) | **12** (12 / 13) |
| HEVC 25 fps | p50 62 (62 / 67) | **21** (22 / 24) | **21** (22 / 23) |
| H.264, 2 B-frames (x264 without zerolatency) | 932 | 892 | – |

Under load (load average 15 on 10 cores, 3 × 8 s; p50 / min): H.264 bridge 61 / 48, own TCP
21 / 11, own UDP 18 / 10; HEVC bridge 108 / 54, own TCP 101 / 21, own UDP 57 / 22; 50 fps
H.264 bridge 41 / 28, own TCP 29 / 10. The B-frame source shows that reordered streams decode
correctly; its ≈ 900 ms come from x264's look-ahead in the test source, not from the
reception.

### App (`e2e/lowlatency.spec.ts`, stamp → drawn, 1 panel, ms)

Quiet machine, 1 round:

| Configuration | Reception | stamp → drawn |
|---|---|---|
| normal, raw 960 | ffmpeg | 78 |
| Low Latency 640, RTP via ffmpeg | ffmpeg | 57 |
| Low Latency 640, own RTP TCP | own | **16** |
| Low Latency 640, own RTP UDP | own | **16** |
| Low Latency 640, own RTP, without draw on arrival | own | 20 |
| Low Latency 320, own RTP | own | **9** |
| normal, H.264 transport 960 | ffmpeg | 66 |
| Low Latency 640, H.264 transport, own RTP | own | **17** |

Under load (2 rounds, run means): normal raw 960 120 / 101; LL 640 via ffmpeg 73 / 70; own
TCP 39 / 45; own UDP 21 / 16; own TCP with statistics every 1 s 20 / 18; LL 320 own 16 / 9;
H.264 transport own 21 / 16. The statistics rate made no measurable difference with one
panel; it stays a setting for heavy layouts.

Bridge integration checked against mediamtx: own RTP over TCP and UDP with AAC sound
(split session: 85 frames and 179 sound packets in 6 s), fallback for an MPEG-4 Part 2
stream (note "RTP-Eigenempfang nicht möglich (Kein H.264-/HEVC-Videotrack im SDP) – ffmpeg
empfängt"), unit tests with a mock RTSP server (Digest challenge, interleaved RTP).

## Not checked

- Real cameras (Sony, Panasonic, Axis …): none reachable from this machine; Digest and
  keep-alive behaviour of real firmware, cameras that send without marker bit (handled by
  the time stamp change, but untested against hardware), interlaced H.264 (PAFF/MBAFF).
- Packet loss on a real network; the drop logic is unit-tested only.
- Windows (UDP port binding, firewall prompts).
