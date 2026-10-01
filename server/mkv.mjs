// Live Matroska writer for the own RTP reception (docs/research/rtp-eigenempfang.md):
// wraps complete access units from the RTP depacketiser so ffmpeg can decode them
// without its own H.264 parser holding a frame back. ffmpeg's matroska demuxer marks
// H.264 tracks AVSTREAM_PARSE_HEADERS (→ PARSER_FLAG_COMPLETE_FRAMES) and HEVC tracks
// not at all (libavformat/matroskadec.c), unlike RTSP/RTP, raw H.264 and MPEG-TS (full
// parsing, one access unit late).
//
// Format: Matroska / EBML (IETF RFC 9559 for Matroska, RFC 8794 for EBML): an EBML header,
// a Segment and Clusters of unknown size (live), one video track, SimpleBlocks with a
// millisecond time stamp relative to the Cluster. Bitstream and CodecPrivate are Annex B
// (start codes): ffmpeg's H.264/HEVC decoders accept Annex B extradata as well as
// avcC/hvcC (they check the first byte), which spares building hvcC.

const UNKNOWN = Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);

/** EBML variable-size integer for an element data size (1–8 bytes). */
export function vint(n) {
  for (let len = 1; len <= 8; len++) {
    if (n < 2 ** (7 * len) - 1) {
      const b = Buffer.alloc(len);
      let v = n;
      for (let i = len - 1; i >= 0; i--) { b[i] = v % 256; v = Math.floor(v / 256); }
      b[0] |= 0x80 >> (len - 1);
      return b;
    }
  }
  throw new Error('EBML size too large');
}

function idBytes(id) {
  const out = [];
  for (let v = id; v > 0; v = Math.floor(v / 256)) out.unshift(v & 255);
  return Buffer.from(out);
}
export function el(id, data) {
  const body = Buffer.isBuffer(data) ? data : Array.isArray(data) ? Buffer.concat(data) : typeof data === 'string' ? Buffer.from(data, 'utf8') : uint(data);
  return Buffer.concat([idBytes(id), vint(body.length), body]);
}
function uint(n) {
  const out = [];
  let v = n;
  do { out.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0);
  return Buffer.from(out);
}

export const CODEC_IDS = { h264: 'V_MPEG4/ISO/AVC', hevc: 'V_MPEGH/ISO/HEVC' };

/**
 * Header up to the start of the first Cluster.
 * `codec` 'h264' | 'hevc', `config` = parameter sets in Annex B, `width`/`height` in px.
 */
export function mkvHeader({ codec, config, width = 0, height = 0 }) {
  const ebml = el(0x1a45dfa3, [
    el(0x4286, 1), el(0x42f7, 1), el(0x42f2, 4), el(0x42f3, 8),
    el(0x4282, 'matroska'), el(0x4287, 4), el(0x4285, 2),
  ]);
  const info = el(0x1549a966, [el(0x2ad7b1, 1_000_000), el(0x4d80, 'lz-scopes'), el(0x5741, 'lz-scopes')]);
  const video = [];
  if (width) video.push(el(0xb0, width));
  if (height) video.push(el(0xba, height));
  const entry = [el(0xd7, 1), el(0x73c5, 1), el(0x83, 1), el(0x9c, 0), el(0x86, CODEC_IDS[codec])];
  if (config?.length) entry.push(el(0x63a2, config));
  if (video.length) entry.push(el(0xe0, video));
  const tracks = el(0x1654ae6b, [el(0xae, entry)]);
  // Segment of unknown size: everything after it belongs to it
  return Buffer.concat([ebml, idBytes(0x18538067), UNKNOWN, info, tracks]);
}

/** Writer: `header()` once, then `block()` per access unit (ms time stamps, increasing). */
export class MkvWriter {
  constructor(opts) { this.opts = opts; this.cluster = null; }
  header() { return mkvHeader(this.opts); }
  /** One SimpleBlock; opens a new Cluster on key frames and before the int16 offset overflows. */
  block(data, ms, key) {
    const t = Math.max(0, Math.round(ms));
    const parts = [];
    if (this.cluster === null || t < this.cluster || t - this.cluster > 30_000 || (key && t !== this.cluster)) {
      this.cluster = t;
      parts.push(idBytes(0x1f43b675), UNKNOWN, el(0xe7, t));
    }
    const head = Buffer.alloc(4);
    head[0] = 0x81; // track number 1 as EBML vint
    head.writeInt16BE(t - this.cluster, 1);
    head[3] = key ? 0x80 : 0x00;
    parts.push(idBytes(0xa3), vint(4 + data.length), head, data);
    return Buffer.concat(parts);
  }
}
