// ST 2022-6 (SDI over IP, "HBRMT"): payload header, frame assembly and extraction of the active
// picture from the SDI word stream into v210; plus the reverse for the test signal generator.
//
// SMPTE ST 2022-6:2012 (free, pub.smpte.org), opened for this:
// - §6.4 Fig. 3 payload header (8 octets, +4 with a video time stamp when CF ≠ 0, +4·Ext):
//   Ext(4) F(1) VSID(3) FRCount(8) R(2) S(2) FEC(3) CF(4) RESERVE(5) | MAP(4) FRAME(8) FRATE(8)
//   SAMPLE(4) FMT-RESERVE(8); code tables for MAP, FRAME, FRATE, SAMPLE, CF.
// - §6.5 media payload 1376 octets, last one of the frame padded; 10-bit words MSB first without
//   NRZI/scrambling; the frame starts with the EAV before line 1; OL = PL·BS·2/8 (4:2:2),
//   OF = OL·LF, DPF = INT(OF/1376)+1, LPO = OF − 1376·(DPF−1). Fig. 5: EAV 3FF 000 000 XYZ.
// - RTP: marker on the last datagram of the frame; ST 2022-8:2019 §5.3 RTP clock 27 MHz.
// From knowledge, not from a document opened here (SMPTE ST 274/296/292-1 are not free):
// - horizontal totals (PL) per format and rate, HD-SDI word interleave C/Y (Cb Y Cr Y …,
//   TRS doubled: 3FF 3FF 000 000 000 000 XYZ XYZ), LN/CRC words after EAV, XYZ = 1 F V H P3 P2 P1 P0 0 0.
//   The XYZ example 0x2D8 of Fig. 5 (F=0, V=1, H=1) is a unit test of the protection bits.

export const HBRMT_PAYLOAD = 1376;

/** FRAME code (Table in §6.4) → active size, total lines, scan. */
export const FRAME_CODES = {
  0x20: { width: 1920, height: 1080, lines: 1125, interlace: true, name: '1080i' },
  0x21: { width: 1920, height: 1080, lines: 1125, interlace: false, name: '1080p' },
  0x22: { width: 1920, height: 1080, lines: 1125, interlace: true, psf: true, name: '1080PsF' },
  0x30: { width: 1280, height: 720, lines: 750, interlace: false, name: '720p' },
};
/** FRATE code → frame rate (num/den). */
export const FRATE_CODES = { 0x10: [60, 1], 0x11: [60000, 1001], 0x12: [50, 1], 0x14: [48, 1], 0x15: [48000, 1001], 0x16: [30, 1], 0x17: [30000, 1001], 0x18: [25, 1], 0x1a: [24, 1], 0x1b: [24000, 1001] };

/**
 * Horizontal total in samples (PL). [Wissen] SMPTE ST 274 (1125 lines) and ST 296 (750 lines):
 * the total grows as the rate falls so the sample clock stays 74.25 or 148.5 MHz.
 */
export function horizontalTotal(frameCode, frate) {
  const [n, d] = FRATE_CODES[frate] ?? [];
  if (!n) return 0;
  const hz = Math.round(n / d);
  const fmt = FRAME_CODES[frameCode];
  if (!fmt) return 0;
  // fields/frames per second that set the clock: interlaced 1080 counts fields
  const r = fmt.interlace ? hz * 2 : hz;
  if (fmt.lines === 1125) return { 60: 2200, 50: 2640, 48: 2750, 30: 2200, 25: 2640, 24: 2750, 120: 2200, 100: 2640, 96: 2750 }[r] ?? 0;
  return { 60: 1650, 50: 1980, 30: 3300, 25: 3960, 24: 4125 }[r] ?? 0;
}

/** SDI geometry for the header codes (10-bit 4:2:2 only). */
export function sdiGeometry(frameCode, frate, sample) {
  const fmt = FRAME_CODES[frameCode];
  const pl = horizontalTotal(frameCode, frate);
  if (!fmt || !pl || sample !== 0x01) return null;
  const wordsPerLine = pl * 2;
  const octetsPerFrame = (pl * 10 * 2 / 8) * fmt.lines;
  const dpf = Math.floor(octetsPerFrame / HBRMT_PAYLOAD) + 1;
  return { ...fmt, pl, wordsPerLine, octetsPerFrame, datagrams: dpf, lastOctets: octetsPerFrame - HBRMT_PAYLOAD * (dpf - 1), rate: FRATE_CODES[frate] };
}

/** Payload header (§6.4) → fields and the media data; null if too short. */
export function parseHbrmt(p) {
  if (p.length < 8) return null;
  const w0 = p.readUInt32BE(0), w1 = p.readUInt32BE(4);
  const ext = w0 >>> 28, cf = (w0 >>> 5) & 15;
  const h = {
    ext, f: (w0 >>> 27) & 1, vsid: (w0 >>> 24) & 7, frCount: (w0 >>> 16) & 255, r: (w0 >>> 14) & 3, s: (w0 >>> 12) & 3, fec: (w0 >>> 9) & 7, cf,
    map: w1 >>> 28, frame: (w1 >>> 20) & 255, frate: (w1 >>> 12) & 255, sample: (w1 >>> 8) & 15,
  };
  let o = 8;
  if (cf) { if (p.length < o + 4) return null; h.videoTs = p.readUInt32BE(o); o += 4; }
  o += ext * 4;
  if (p.length < o) return null;
  return { ...h, media: p.subarray(o) };
}

/** Payload header for the generator. */
export function hbrmtHeader({ frCount, frame, frate, sample = 0x01, map = 0, vsid = 0 }) {
  const b = Buffer.alloc(8);
  b.writeUInt32BE(((0 << 28) | (1 << 27) | ((vsid & 7) << 24) | ((frCount & 255) << 16)) >>> 0, 0);
  b.writeUInt32BE((((map & 15) << 28) | ((frame & 255) << 20) | ((frate & 255) << 12) | ((sample & 15) << 8)) >>> 0, 4);
  return b;
}

/** TRS XYZ word: 1 F V H P3 P2 P1 P0 0 0 with P3 = V⊕H, P2 = F⊕H, P1 = F⊕V, P0 = F⊕V⊕H. */
export function xyz(f, v, h) {
  return 0x200 | (f << 8) | (v << 7) | (h << 6) | ((v ^ h) << 5) | ((f ^ h) << 4) | ((f ^ v) << 3) | ((f ^ v ^ h) << 2);
}

/** 10-bit words packed MSB first (§6.5) → Uint16Array. */
export function unpackWords(bytes, count) {
  const out = new Uint16Array(count);
  // 4 words = 5 octets
  let o = 0, i = 0;
  for (; i + 4 <= count && o + 5 <= bytes.length; i += 4, o += 5) {
    const b0 = bytes[o], b1 = bytes[o + 1], b2 = bytes[o + 2], b3 = bytes[o + 3], b4 = bytes[o + 4];
    out[i] = (b0 << 2) | (b1 >> 6); out[i + 1] = ((b1 & 63) << 4) | (b2 >> 4); out[i + 2] = ((b2 & 15) << 6) | (b3 >> 2); out[i + 3] = ((b3 & 3) << 8) | b4;
  }
  return out;
}
export function packWords(words) {
  const out = Buffer.alloc(Math.ceil((words.length * 10) / 8));
  let o = 0;
  for (let i = 0; i < words.length; i += 4, o += 5) {
    const a = words[i], b = words[i + 1] ?? 0, c = words[i + 2] ?? 0, d = words[i + 3] ?? 0;
    out[o] = a >> 2; out[o + 1] = ((a & 3) << 6) | (b >> 4);
    if (o + 2 < out.length) out[o + 2] = ((b & 15) << 4) | (c >> 6);
    if (o + 3 < out.length) out[o + 3] = ((c & 63) << 2) | (d >> 8);
    if (o + 4 < out.length) out[o + 4] = d & 255;
  }
  return out;
}

/**
 * Collects 2022-6 datagrams into frames and extracts the active picture as v210.
 * `onFrame(v210, { geometry, broken, trsErrors })`, `onFormat(geometry)` when the header codes change.
 */
export class SdiAssembler {
  constructor({ onFrame, onFormat = () => {}, deliverBroken = false }) {
    Object.assign(this, { onFrame, onFormat, deliverBroken });
    this.geo = null; this.key = ''; this.chunks = []; this.bytes = 0; this.gap = false; this.lastSeq = null; this.frCount = null;
    this.frames = 0; this.broken = 0; this.packets = 0; this.unsupported = 0; this.trsErrors = 0;
  }
  push(pkt) {
    this.packets++;
    const h = parseHbrmt(pkt.payload);
    if (!h) { this.gap = true; return; }
    const key = `${h.map}/${h.frame}/${h.frate}/${h.sample}`;
    if (key !== this.key) {
      this.key = key;
      this.geo = h.map === 0 ? sdiGeometry(h.frame, h.frate, h.sample) : null;
      // a join in the middle of a frame shows up as a short frame in finish()
      this.chunks = []; this.bytes = 0; this.gap = false;
      if (this.geo) this.onFormat(this.geo);
    }
    if (!this.geo) { this.unsupported++; return; }
    if (this.lastSeq !== null && pkt.seq !== ((this.lastSeq + 1) & 0xffff)) this.gap = true;
    this.lastSeq = pkt.seq;
    if (this.frCount !== null && h.frCount !== this.frCount && this.bytes) { this.finish(true); }
    this.frCount = h.frCount;
    this.chunks.push(h.media); this.bytes += h.media.length;
    if (pkt.marker) this.finish(false);
  }
  finish(lostEnd) {
    const g = this.geo;
    const data = Buffer.concat(this.chunks);
    const broken = lostEnd || this.gap || data.length < g.octetsPerFrame;
    this.chunks = []; this.bytes = 0; this.gap = false; this.frCount = null;
    if (broken) this.broken++;
    if (broken && !this.deliverBroken) return;
    const { v210, trsErrors } = extractActive(data, g);
    this.trsErrors += trsErrors;
    this.frames++;
    this.onFrame(v210, { geometry: g, broken, trsErrors });
  }
}

/** Active picture of one SDI frame (C/Y-interleaved 10-bit words) → v210, field rows woven. */
export function extractActive(data, g) {
  const words = unpackWords(data, g.wordsPerLine * g.lines);
  const activeWords = g.width * 2;
  const rowWords = Math.ceil(g.width / 48) * 32;
  const out = new Uint32Array(rowWords * g.height);
  let trsErrors = 0;
  const rows = [0, 0];
  for (let l = 0; l < g.lines; l++) {
    const base = l * g.wordsPerLine;
    // EAV at the start of every line (the frame starts with the EAV before line 1)
    if (words[base] !== 0x3ff || words[base + 1] !== 0x3ff || words[base + 2] || words[base + 3] || words[base + 4] || words[base + 5] || !((words[base + 6] >> 6) & 1)) { trsErrors++; continue; }
    const sav = base + g.wordsPerLine - activeWords - 8;
    if (words[sav] !== 0x3ff || words[sav + 1] !== 0x3ff) { trsErrors++; continue; }
    const x = words[sav + 6];
    if ((x >> 6) & 1) { trsErrors++; continue; } // H must be 0 in SAV
    if ((x >> 7) & 1) continue; // vertical blanking
    const f = g.interlace ? (x >> 8) & 1 : 0;
    const row = g.interlace ? rows[f] * 2 + f : rows[0];
    rows[f]++;
    if (row >= g.height) continue;
    let s = sav + 8, wi = row * rowWords;
    for (let k = 0; k < activeWords; k += 3, s += 3) out[wi++] = words[s] | ((words[s + 1] ?? 0) << 10) | ((words[s + 2] ?? 0) << 20);
  }
  return { v210: Buffer.from(out.buffer), trsErrors };
}

/**
 * One SDI frame (10-bit words) from active rows (`row(i)` → Uint16Array of Cb Y Cr Y …), for
 * the generator. HANC/VANC carry blanking (C 200h, Y 040h). [Wissen] Active line ranges of
 * ST 274/296: 1080p lines 42–1121, 1080i 21–560 and 584–1123, 720p 26–745. LN carries the line
 * number; the CRC words are a fixed 200h (not computed – a gateway that checks CRC counts errors).
 */
export function buildSdiFrame(g, row) {
  const words = new Uint16Array(g.wordsPerLine * g.lines);
  const activeWords = g.width * 2;
  const ranges = g.lines === 750 ? [[26, 745, 0]] : g.interlace ? [[21, 560, 0], [584, 1123, 1]] : [[42, 1121, 0]];
  for (let l = 0; l < g.lines; l++) {
    const line = l + 1;
    const base = l * g.wordsPerLine;
    const rng = ranges.find(([a, b]) => line >= a && line <= b);
    // field bit for interlaced: second field from line 564 (1125i) [Wissen]
    const fBit = g.interlace && line >= 564 ? 1 : 0;
    const v = rng ? 0 : 1;
    const eav = xyz(fBit, v, 1), savw = xyz(fBit, v, 0);
    words.set([0x3ff, 0x3ff, 0, 0, 0, 0, eav, eav], base);
    // LN0: b8–b2 = L6–L0; LN1: b5–b2 = L10–L7; b9 = NOT b8
    const ln0 = ((line & 0x7f) << 2), ln1 = (((line >> 7) & 15) << 2);
    const nb8 = (w) => w | ((((w >> 8) & 1) ^ 1) << 9);
    words.set([nb8(ln0), nb8(ln0), nb8(ln1), nb8(ln1), 0x200, 0x200, 0x200, 0x200], base + 8);
    const sav = base + g.wordsPerLine - activeWords - 8;
    for (let i = base + 16; i < sav; i += 2) { words[i] = 0x200; words[i + 1] = 0x040; }
    words.set([0x3ff, 0x3ff, 0, 0, 0, 0, savw, savw], sav);
    if (rng) {
      const r = g.interlace ? (line - rng[0]) * 2 + rng[2] : line - rng[0];
      words.set(row(r).subarray(0, activeWords), sav + 8);
    } else {
      for (let i = sav + 8; i < base + g.wordsPerLine; i += 2) { words[i] = 0x200; words[i + 1] = 0x040; }
    }
  }
  return words;
}
