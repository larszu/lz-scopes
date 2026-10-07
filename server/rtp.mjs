// RTP reception for the bridge's own RTSP client (docs/research/rtp-eigenempfang.md):
// RTP header (RFC 3550 §5.1), reorder buffer for UDP, and depacketisers for H.264
// (RFC 6184, packetization-mode 0/1: single NAL unit, STAP-A, FU-A) and HEVC (RFC 7798
// without DONL: single NAL unit, AP, FU). An access unit is complete when the packet with
// the marker bit arrives (RFC 6184 §5.1, RFC 7798 §4.1) – or, for senders that never set
// it, when the time stamp changes. That marker bit is what ffmpeg's RTSP input ignores:
// its H.264 parser waits for the start of the next access unit (one frame late).

/** Parse an RTP packet; null if it is not RTP version 2 or too short. */
export function parseRtp(buf) {
  if (buf.length < 12 || buf[0] >> 6 !== 2) return null;
  const padding = (buf[0] & 0x20) !== 0, ext = (buf[0] & 0x10) !== 0, cc = buf[0] & 0x0f;
  let off = 12 + cc * 4;
  if (ext) {
    if (buf.length < off + 4) return null;
    off += 4 + buf.readUInt16BE(off + 2) * 4;
  }
  let end = buf.length;
  if (padding) end -= buf[buf.length - 1];
  if (off > end) return null;
  return {
    marker: (buf[1] & 0x80) !== 0, pt: buf[1] & 0x7f, seq: buf.readUInt16BE(2),
    ts: buf.readUInt32BE(4), ssrc: buf.readUInt32BE(8), payload: buf.subarray(off, end),
  };
}

/** Signed distance a → b of 16-bit sequence numbers (−32768 … 32767). */
export const seqDiff = (a, b) => ((b - a + 0x18000) % 0x10000) - 0x8000;

/**
 * Puts UDP packets back in sequence order. A packet missing for longer than `maxWaitMs`
 * (or when `window` packets wait behind it) counts as lost and is skipped. Over TCP the
 * order is given; pass `window: 0` to hand everything through at once.
 */
export class ReorderBuffer {
  constructor(onPacket, { window = 64, maxWaitMs = 30 } = {}) {
    this.onPacket = onPacket; this.window = window; this.maxWaitMs = maxWaitMs;
    this.next = null; this.held = new Map();
    /** lost: given up; reordered: arrived after a later one but in time; late: arrived after being given up; duplicates: twice */
    this.lost = 0; this.reordered = 0; this.late = 0; this.duplicates = 0;
    this.highest = null;
  }
  push(pkt, now = Date.now()) {
    if (this.window === 0) { this.onPacket(pkt, false); return; }
    if (this.next === null) this.next = pkt.seq;
    const d = seqDiff(this.next, pkt.seq);
    if (d < 0) { // already delivered, or given up as lost
      if (this.skipped?.has(pkt.seq)) { this.late++; this.skipped.delete(pkt.seq); } else this.duplicates++;
      return;
    }
    if (d > 0x4000) { this.reset(pkt); return; } // sender restarted
    if (this.held.has(pkt.seq)) { this.duplicates++; return; }
    if (this.highest !== null && seqDiff(this.highest, pkt.seq) < 0) this.reordered++; // fills a gap
    else this.highest = pkt.seq;
    this.held.set(pkt.seq, { pkt, at: now });
    this.drain(now);
  }
  /** Deliver what is in order; give up on gaps that waited too long. */
  drain(now = Date.now()) {
    for (;;) {
      const h = this.held.get(this.next);
      if (h) {
        this.held.delete(this.next);
        this.onPacket(h.pkt, this.gap === true);
        this.gap = false;
        this.next = (this.next + 1) & 0xffff;
        continue;
      }
      if (!this.held.size) return;
      let oldest = Infinity;
      for (const v of this.held.values()) oldest = Math.min(oldest, v.at);
      if (this.held.size < this.window && now - oldest < this.maxWaitMs) return;
      // give up on the missing packet(s) up to the oldest one waiting
      let skip = Infinity;
      for (const s of this.held.keys()) skip = Math.min(skip, seqDiff(this.next, s));
      this.lost += skip;
      // remember what was given up (bounded) to tell late arrivals from duplicates
      this.skipped ??= new Set();
      for (let k = 0; k < Math.min(skip, 256); k++) this.skipped.add((this.next + k) & 0xffff);
      if (this.skipped.size > 1024) this.skipped = new Set([...this.skipped].slice(-512));
      this.next = (this.next + skip) & 0xffff;
      this.gap = true;
    }
  }
  reset(pkt) { this.held.clear(); this.next = pkt.seq; this.highest = null; this.gap = true; this.push(pkt); }
}

const SC = Buffer.from([0, 0, 0, 1]);

/** NAL unit type and key-frame test per codec. */
export const NAL = {
  h264: { type: (b) => b[0] & 0x1f, key: (t) => t === 5, params: (t) => t === 7 || t === 8 },
  hevc: { type: (b) => (b[0] >> 1) & 0x3f, key: (t) => t >= 16 && t <= 21, params: (t) => t >= 32 && t <= 34 },
};

/**
 * Collects RTP payloads into access units (Annex B, 4-byte start codes).
 * `onAccessUnit({ data, key, ts, complete })` – AUs with a gap inside are dropped and
 * everything up to the next key frame as well (a scope must not show concealment).
 */
export class Depacketizer {
  constructor(codec, onAccessUnit) {
    if (!NAL[codec]) throw new Error(`RTP: codec ${codec} not supported`);
    this.codec = codec; this.onAccessUnit = onAccessUnit;
    this.nals = []; this.ts = null; this.fu = null; this.broken = false; this.needKey = true;
    this.aus = 0; this.dropped = 0;
  }
  /** `gap` = packets were lost right before this one. */
  push(pkt, gap = false) {
    // a gap could have taken the end of the pending access unit or the start of this one: both count as broken
    if (gap && this.nals.length + (this.fu ? 1 : 0) > 0) this.broken = true;
    if (this.ts !== null && pkt.ts !== this.ts) this.flush(); // sender without marker bit
    if (gap) { this.broken = true; this.fu = null; }
    this.ts = pkt.ts;
    if (this.codec === 'h264') this.h264(pkt.payload); else this.hevc(pkt.payload);
    if (pkt.marker) this.flush();
  }
  h264(p) {
    if (!p.length) return;
    const type = p[0] & 0x1f;
    if (type >= 1 && type <= 23) this.nals.push(p);
    else if (type === 24) { // STAP-A: 16-bit size + NAL unit, repeated
      for (let o = 1; o + 2 <= p.length;) {
        const n = p.readUInt16BE(o); o += 2;
        if (!n || o + n > p.length) { this.broken = true; break; }
        this.nals.push(p.subarray(o, o + n)); o += n;
      }
    } else if (type === 28) { // FU-A: FU indicator (F, NRI) + FU header (S, E, R, type)
      if (p.length < 2) return;
      const s = (p[1] & 0x80) !== 0, e = (p[1] & 0x40) !== 0;
      if (s) this.fu = [Buffer.from([(p[0] & 0xe0) | (p[1] & 0x1f)]), p.subarray(2)];
      else if (this.fu) this.fu.push(p.subarray(2));
      else { this.broken = true; return; } // middle of a NAL unit whose start is missing
      if (e) { this.nals.push(Buffer.concat(this.fu)); this.fu = null; }
    } else this.broken = true; // STAP-B, MTAP, FU-B: interleaved mode, not supported
  }
  hevc(p) {
    if (p.length < 2) return;
    const type = (p[0] >> 1) & 0x3f;
    if (type < 48) this.nals.push(p);
    else if (type === 48) { // AP: 16-bit size + NAL unit, repeated (no DONL)
      for (let o = 2; o + 2 <= p.length;) {
        const n = p.readUInt16BE(o); o += 2;
        if (!n || o + n > p.length) { this.broken = true; break; }
        this.nals.push(p.subarray(o, o + n)); o += n;
      }
    } else if (type === 49) { // FU: payload header (2) + FU header (S, E, FuType)
      if (p.length < 3) return;
      const s = (p[2] & 0x80) !== 0, e = (p[2] & 0x40) !== 0, ft = p[2] & 0x3f;
      if (s) this.fu = [Buffer.from([(p[0] & 0x81) | (ft << 1), p[1]]), p.subarray(3)];
      else if (this.fu) this.fu.push(p.subarray(3));
      else { this.broken = true; return; }
      if (e) { this.nals.push(Buffer.concat(this.fu)); this.fu = null; }
    } else this.broken = true; // PACI (50) and others
  }
  flush() {
    const nals = this.nals, ts = this.ts;
    const broken = this.broken || this.fu !== null;
    this.nals = []; this.fu = null; this.broken = false;
    if (broken) { this.dropped++; this.needKey = true; return; }
    if (!nals.length) return;
    const t = NAL[this.codec];
    const key = nals.some((n) => t.key(t.type(n)));
    if (this.needKey && !key) { this.dropped++; return; }
    this.needKey = false;
    this.aus++;
    this.onAccessUnit({ data: Buffer.concat(nals.flatMap((n) => [SC, n])), key, ts });
  }
}

/** Unwraps 32-bit RTP time stamps into a monotonic ms time line (90 kHz clock). */
export class RtpClock {
  constructor(rate = 90000) { this.rate = rate; this.first = null; this.last = null; this.wraps = 0; }
  ms(ts) {
    if (this.first === null) { this.first = ts; this.last = ts; }
    let wraps = this.wraps;
    if (ts < this.last && this.last - ts > 0x80000000) { this.wraps++; wraps = this.wraps; this.last = ts; }
    else if (ts > this.last && ts - this.last > 0x80000000) wraps--; // late packet from before a wrap
    else if (ts > this.last) this.last = ts;
    return ((ts + wraps * 0x100000000 - this.first) * 1000) / this.rate;
  }
}
