// ST 2110-20 (uncompressed video over RTP, RFC 4175 based): packetiser for the test signal
// generator and frame assembler for the receiver. Output of the receiver is v210 (the layout the
// DeckLink/AJA helpers deliver, docs/frame-protocol.md), so the bridge path behind it is the same.
//
// SMPTE ST 2110-20:2022 (free, pub.smpte.org), opened for this:
// - §6.1.2 marker bit = last packet of a frame (progressive) or of a field (interlaced);
//   §6.1.3 RTP clock 90 kHz, all packets of a frame/field share the time stamp.
// - §6.1.4 payload header: Extended Sequence Number (16 high bits of the 32-bit sequence), then
//   1–3 Sample Row Data headers: SRD Length (16, octets, multiple of the pgroup), F (1, second
//   field), SRD Row Number (15, starting at 0 per field), C (1, another SRD header follows),
//   SRD Offset (15, pixel position of the first sample).
// - §6.1.5 rows of the second field sit below the like-numbered rows of the first; one packet never
//   spans two fields/frames; fields go out first field first.
// - §6.2.4 Table 2: 4:2:2 pgroups C'B, Y0', C'R, Y1' – 4 octets (8 bit), 5 (10 bit), 6 (12 bit),
//   2 pixels each, samples packed MSB first.
// - ST 2110-10: Standard UDP Size Limit 1460 octets of UDP payload.

/** UDP payload limit (ST 2110-10 Standard UDP Size Limit) minus the 12-byte RTP header. */
export const STD_UDP = 1460;

/** RTP fixed header (RFC 3550 §5.1), no CSRC, no extension. */
export function rtpHeader({ marker = false, pt, seq, ts, ssrc }) {
  const b = Buffer.alloc(12);
  b[0] = 0x80; b[1] = (marker ? 0x80 : 0) | (pt & 0x7f);
  b.writeUInt16BE(seq & 0xffff, 2); b.writeUInt32BE(ts >>> 0, 4); b.writeUInt32BE(ssrc >>> 0, 8);
  return b;
}

/** Octets of one sample row. */
export const rowBytes = (width, pg) => Math.ceil(width / pg.pixels) * pg.bytes;

/** Rows per field: odd heights give the first field one more (§6.1.5). */
export const fieldRows = (height, interlace, field) => (interlace ? (field === 0 ? Math.ceil(height / 2) : Math.floor(height / 2)) : height);

/**
 * Packing plan for one frame: equal chunks per row, each a multiple of the pgroup, one SRD per
 * packet (a valid General Packing Mode layout). Returns [{ field, row, offsetPx, bytes, marker }].
 * The receiver below also takes packets with 2–3 SRD headers from other senders.
 */
export function packPlan({ width, height, interlace = false, pgroup, maxUdp = STD_UDP }) {
  const R = rowBytes(width, pgroup);
  const maxData = Math.floor((maxUdp - 12 - 2 - 6) / pgroup.bytes) * pgroup.bytes;
  const groups = R / pgroup.bytes;
  const n = Math.ceil(R / maxData);
  const per = Math.ceil(groups / n);
  const plan = [];
  for (const field of interlace ? [0, 1] : [0]) {
    const rows = fieldRows(height, interlace, field);
    for (let row = 0; row < rows; row++) {
      for (let g = 0; g < groups; g += per) {
        const cnt = Math.min(per, groups - g);
        plan.push({ field, row, offsetPx: g * pgroup.pixels, bytes: cnt * pgroup.bytes, marker: false });
      }
    }
    plan[plan.length - 1].marker = true;
  }
  return plan;
}

/**
 * Payloads for one frame from `rowData(frameRow) → Buffer` (row octets in pgroup form).
 * Returns [{ payload, marker, field }]; the caller prefixes the RTP header and sets the
 * Extended Sequence Number (bytes 0–1 of the payload).
 */
export function packetizeFrame(fmt, rowData) {
  const out = [];
  for (const p of packPlan(fmt)) {
    const frameRow = fmt.interlace ? p.row * 2 + p.field : p.row;
    const src = rowData(frameRow);
    const startByte = (p.offsetPx / fmt.pgroup.pixels) * fmt.pgroup.bytes;
    const b = Buffer.alloc(2 + 6 + p.bytes);
    b.writeUInt16BE(p.bytes, 2);
    b.writeUInt16BE(((p.field & 1) << 15) | (p.row & 0x7fff), 4);
    b.writeUInt16BE(p.offsetPx & 0x7fff, 6); // C = 0
    src.copy(b, 8, startByte, startByte + p.bytes);
    out.push({ payload: b, marker: p.marker, field: p.field });
  }
  return out;
}

/** 10-bit 4:2:2 component row (Cb Y0 Cr Y1 …, 2 per pixel) → pgroup octets (8/10/12 bit). */
export function packRow422(comp, depth) {
  const n = comp.length;
  if (depth === 10) {
    const b = Buffer.alloc((n / 4) * 5);
    for (let i = 0, o = 0; i < n; i += 4, o += 5) {
      const cb = comp[i], y0 = comp[i + 1], cr = comp[i + 2], y1 = comp[i + 3];
      b[o] = cb >> 2; b[o + 1] = ((cb & 3) << 6) | (y0 >> 4); b[o + 2] = ((y0 & 15) << 4) | (cr >> 6);
      b[o + 3] = ((cr & 63) << 2) | (y1 >> 8); b[o + 4] = y1 & 255;
    }
    return b;
  }
  if (depth === 8) {
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i++) b[i] = comp[i] >> 2;
    return b;
  }
  throw new Error(`4:2:2 depth ${depth} not supported by the packer`);
}

/** v210 bytes of one picture (rows padded to 48 px = 128 octets). */
export const v210Bytes = (w, h) => Math.ceil(w / 48) * 128 * h;

/**
 * Builds frames from ST 2110-20 packets (4:2:2 8/10/12 bit) into v210.
 * `onFrame(buf, { ts, broken, missingBytes })` per complete frame; frames with lost packets are
 * reported with `broken: true` and, by default, not handed on (a scope must not show holes as signal).
 * 12-bit input keeps its upper 10 bits (v210 has no more).
 */
export class VideoAssembler {
  constructor({ width, height, interlace = false, sampling, depth, deliverBroken = false }, onFrame) {
    if (sampling !== 'YCbCr-4:2:2' || ![8, 10, 12].includes(depth)) throw new Error(`ST 2110-20: ${sampling} ${depth} bit not supported (4:2:2 8/10/12 bit only)`);
    if (!(width >= 16 && width <= 8192 && height >= 16 && height <= 8192)) throw new Error(`ST 2110-20: invalid size ${width}×${height}`);
    Object.assign(this, { width, height, interlace, depth, deliverBroken, onFrame });
    this.pgBytes = { 8: 4, 10: 5, 12: 6 }[depth];
    this.rowWords = Math.ceil(width / 48) * 32;
    this.expectBytes = rowBytes(width, { bytes: this.pgBytes, pixels: 2 }) * height;
    this.buf = new Uint32Array(this.rowWords * height);
    this.lastExt = null;
    this.reset();
    /** counters: frames delivered, frames with lost/late packets, packets, bad payload headers */
    this.frames = 0; this.broken = 0; this.packets = 0; this.malformed = 0;
  }
  /** lastExt survives: a frame whose first packets are missing shows up as a sequence gap */
  reset() { this.ts = null; this.frameTs = null; this.got = 0; this.gap = false; this.fieldsDone = 0; }

  /** `pkt` from parseRtp (server/rtp.mjs): { marker, seq, ts, payload }. */
  push(pkt) {
    this.packets++;
    const p = pkt.payload;
    if (p.length < 8) { this.malformed++; return; }
    const ext = ((p.readUInt16BE(0) << 16) | pkt.seq) >>> 0;
    // a new time stamp without the marker of the previous frame: the end got lost
    if (this.ts !== null && pkt.ts !== this.ts && !(this.interlace && this.fieldsDone === 1)) this.finish(true);
    if (this.ts === null || pkt.ts !== this.ts) {
      if (!(this.interlace && this.fieldsDone === 1)) { this.got = 0; this.frameTs = pkt.ts; }
      this.ts = pkt.ts;
    }
    if (this.lastExt !== null && ext !== ((this.lastExt + 1) >>> 0)) this.gap = true;
    this.lastExt = ext;
    // SRD headers
    const hdrs = [];
    let o = 2;
    for (;;) {
      if (o + 6 > p.length) { this.malformed++; this.gap = true; return; }
      const len = p.readUInt16BE(o), fr = p.readUInt16BE(o + 2), co = p.readUInt16BE(o + 4);
      hdrs.push({ len, field: fr >> 15, row: fr & 0x7fff, offset: co & 0x7fff });
      o += 6;
      if (!(co & 0x8000) || hdrs.length === 3) break;
    }
    for (const h of hdrs) {
      if (o + h.len > p.length || h.len % this.pgBytes) { this.malformed++; this.gap = true; return; }
      const frameRow = this.interlace ? h.row * 2 + h.field : h.row;
      if (frameRow >= this.height || h.offset + (h.len / this.pgBytes) * 2 > this.width + 1) { this.malformed++; this.gap = true; return; }
      this.unpack(p, o, h.len, frameRow, h.offset);
      this.got += h.len;
      o += h.len;
    }
    if (pkt.marker) {
      if (this.interlace && hdrs[0].field === 0) { this.fieldsDone = 1; return; }
      this.finish(false);
    }
  }

  /** pgroups → v210 words of one row: components Cb Y0 Cr Y1 … in the same order as v210. */
  unpack(p, o, len, row, offsetPx) {
    const w = this.buf, base = row * this.rowWords;
    let k = offsetPx * 2; // component index in the row
    const end = o + len;
    const put = (v) => {
      const wi = base + ((k / 3) | 0), s = (k % 3) * 10;
      w[wi] = (w[wi] & ~(1023 << s)) | (v << s);
      k++;
    };
    if (this.depth === 10) {
      // leading pgroups until the component index sits on a word boundary
      while (o < end && k % 3 !== 0) {
        const b0 = p[o], b1 = p[o + 1], b2 = p[o + 2], b3 = p[o + 3], b4 = p[o + 4];
        put((b0 << 2) | (b1 >> 6)); put(((b1 & 63) << 4) | (b2 >> 4)); put(((b2 & 15) << 6) | (b3 >> 2)); put(((b3 & 3) << 8) | b4);
        o += 5;
      }
      // fast path: 3 pgroups = 12 components = 4 whole v210 words
      let wi = base + k / 3;
      for (; o + 15 <= end; o += 15, wi += 4, k += 12) {
        let b0 = p[o], b1 = p[o + 1], b2 = p[o + 2], b3 = p[o + 3], b4 = p[o + 4];
        const c0 = (b0 << 2) | (b1 >> 6), c1 = ((b1 & 63) << 4) | (b2 >> 4), c2 = ((b2 & 15) << 6) | (b3 >> 2), c3 = ((b3 & 3) << 8) | b4;
        b0 = p[o + 5]; b1 = p[o + 6]; b2 = p[o + 7]; b3 = p[o + 8]; b4 = p[o + 9];
        const c4 = (b0 << 2) | (b1 >> 6), c5 = ((b1 & 63) << 4) | (b2 >> 4), c6 = ((b2 & 15) << 6) | (b3 >> 2), c7 = ((b3 & 3) << 8) | b4;
        b0 = p[o + 10]; b1 = p[o + 11]; b2 = p[o + 12]; b3 = p[o + 13]; b4 = p[o + 14];
        const c8 = (b0 << 2) | (b1 >> 6), c9 = ((b1 & 63) << 4) | (b2 >> 4), c10 = ((b2 & 15) << 6) | (b3 >> 2), c11 = ((b3 & 3) << 8) | b4;
        w[wi] = c0 | (c1 << 10) | (c2 << 20); w[wi + 1] = c3 | (c4 << 10) | (c5 << 20);
        w[wi + 2] = c6 | (c7 << 10) | (c8 << 20); w[wi + 3] = c9 | (c10 << 10) | (c11 << 20);
      }
      for (; o < end; o += 5) {
        const b0 = p[o], b1 = p[o + 1], b2 = p[o + 2], b3 = p[o + 3], b4 = p[o + 4];
        put((b0 << 2) | (b1 >> 6)); put(((b1 & 63) << 4) | (b2 >> 4)); put(((b2 & 15) << 6) | (b3 >> 2)); put(((b3 & 3) << 8) | b4);
      }
    } else if (this.depth === 8) {
      for (; o < end; o++) put(p[o] << 2);
    } else {
      for (; o < end; o += 6) {
        const b0 = p[o], b1 = p[o + 1], b2 = p[o + 2], b3 = p[o + 3], b4 = p[o + 4], b5 = p[o + 5];
        put(((b0 << 4) | (b1 >> 4)) >> 2); put((((b1 & 15) << 8) | b2) >> 2); put(((b3 << 4) | (b4 >> 4)) >> 2); put((((b4 & 15) << 8) | b5) >> 2);
      }
    }
  }

  finish(lostEnd) {
    const missing = this.expectBytes - this.got;
    const broken = lostEnd || this.gap || missing > 0;
    const ts = this.frameTs;
    this.reset();
    if (broken) this.broken++;
    if (broken && !this.deliverBroken) return;
    this.frames++;
    // a copy: the next frame is written into the same buffer while this one may still be in a pipe
    this.onFrame(Buffer.from(new Uint8Array(this.buf.buffer, this.buf.byteOffset, this.buf.byteLength)), { ts, broken, missingBytes: Math.max(0, missing) });
  }
}
