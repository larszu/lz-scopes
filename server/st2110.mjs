// ST 2110 network receive in the bridge (#226, #227, #230): payload decoders for 2110-30
// (AES67 L16/L24), 2110-31 (AES3 transparent, AM824), 2110-40 (RFC 8331 ancillary data) and
// 2110-41 (Fast Metadata), the ST 2022-7 path evaluation, and the receiver with its sockets.
// Own code; sources opened (docs/research/st2110-empfang.md):
//
// - RFC 3550 §5.1 (RTP header), §6.4.1 + A.8 (interarrival jitter J += (|D| − J)/16), RFC 3551/3190
//   (L16/L24: big-endian two's complement, channels interleaved per sample period).
// - SMPTE ST 2110-30:2025 §6 (AES67 constraints, 44.1/48/96 kHz, levels Table 2/3).
// - SMPTE ST 2110-31:2022 §5.4 Figure 2: AM824 subframe = 0 0 B F P C U V | DATA24 (big endian,
//   AES3 time slot 27 = MSB), §5.4 subframes 1 and 2 of each AES3 frame interleaved.
// - RFC 8331 §2/§2.1: payload header ext. seq. 16 | length 16 | ANC_Count 8 | F 2 | reserved 22,
//   per ANC packet C 1 | Line_Number 11 | Horizontal_Offset 12 | S 1 | StreamNum 7, then DID,
//   SDID, Data_Count, UDW (10 bit each, packed MSB first), Checksum_Word, word_align to 32 bit.
//   Data_Count b8 = even parity of b7–b0, b9 = NOT b8; checksum = 9 LSB of the sum of the 9 LSB
//   of DID, SDID, DC and all UDW, b9 = NOT b8. F = 0b01 is invalid (packet ignored).
// - SMPTE ST 2110-41:2026 §5.4 Figure 2: Data Item Package = Type 22 | K 1 | Length 9 (in 32-bit
//   words, not 0), then Length × 32 bit contents.
// - SMPTE ST 2022-7:2019 §7 (PD = max |Pi − Pj|, MD = PT − EA), Table 1 (classes A 10 ms,
//   B 50 ms, C 450 ms SBR / 150 ms HBR, D 150 µs), §4.1/4.2 (HBR ≥ 270 Mbit/s), Annex A
//   (match the copies by sequence number, the RTP timestamp in addition).
//
// All times here are software receive times of this process (event loop, not the NIC): the
// path offset and jitter are good to about 0.1–1 ms, class D (150 µs) cannot be judged with them.

import dgram from 'node:dgram';
import { performance } from 'node:perf_hooks';
import { parseRtp, seqDiff, ReorderBuffer } from './rtp.mjs';
import { parseChannelOrder, layoutOf } from './sdp.mjs';
import { bmsg, field } from './messages.mjs';

// ---- 2110-30 / -31 audio

/** L16/L24 payload → interleaved float32 (−1 … 1). Trailing partial sample periods are ignored. */
export function decodeLinear(payload, channels, bits) {
  const bps = bits / 8, frames = Math.floor(payload.length / (bps * channels));
  const out = new Float32Array(frames * channels);
  if (bits === 24) for (let i = 0, o = 0; i < out.length; i++, o += 3) out[i] = ((payload[o] << 24 | payload[o + 1] << 16 | payload[o + 2] << 8) >> 8) / 8388608;
  else for (let i = 0; i < out.length; i++) out[i] = payload.readInt16BE(i * 2) / 32768;
  return out;
}

/**
 * AM824 payload (ST 2110-31 §5.4) → interleaved float32 of the 24-bit DATA field plus the bit
 * counters: V (validity) set, B (block start) seen, parity errors of the subframe. The parity
 * check is AES3's even parity over time slots 4–31 (AES3-3, not opened; the definition used here:
 * the P bit makes the number of ones in DATA24 + V + U + C + P even).
 */
export function decodeAm824(payload, channels) {
  const frames = Math.floor(payload.length / (4 * channels));
  const pcm = new Float32Array(frames * channels);
  let v = 0, b = 0, parity = 0;
  for (let i = 0; i < pcm.length; i++) {
    const o = i * 4, flags = payload[o];
    if (flags & 0x01) v++;
    if (flags & 0x20) b++;
    let ones = 0;
    for (let k = 1; k < 4; k++) { let x = payload[o + k]; while (x) { ones += x & 1; x >>= 1; } }
    ones += ((flags >> 3) & 1) + ((flags >> 2) & 1) + ((flags >> 1) & 1) + (flags & 1);
    if (ones & 1) parity++;
    pcm[i] = ((payload[o + 1] << 24 | payload[o + 2] << 16 | payload[o + 3] << 8) >> 8) / 8388608;
  }
  return { pcm, v, b, parity };
}

// ---- 2110-40 ancillary data (RFC 8331)

/** Reads big-endian bit fields from a buffer. */
class Bits {
  constructor(buf, byteOff = 0) { this.buf = buf; this.pos = byteOff * 8; }
  get left() { return this.buf.length * 8 - this.pos; }
  read(n) {
    let v = 0;
    for (let i = 0; i < n; i++, this.pos++) v = (v << 1) | ((this.buf[this.pos >> 3] >> (7 - (this.pos & 7))) & 1);
    return v >>> 0;
  }
  align32(base) { const r = (this.pos - base) % 32; if (r) this.pos += 32 - r; }
}

/** Even-parity word: b8 = parity of b7–b0, b9 = NOT b8 (ST 291-1 via RFC 8331 §2.1). */
export const parityOk = (w) => {
  let p = 0; for (let i = 0; i < 8; i++) p ^= (w >> i) & 1;
  return ((w >> 8) & 1) === p && ((w >> 9) & 1) === (p ^ 1);
};

/**
 * RFC 8331 payload → { extSeq, length, count, field, packets, error? }. Each packet:
 * { c, line, hOffset, s, stream, did, sdid, dataCount, udw: number[] (10 bit), checksumOk, parityOk }.
 * `did`/`sdid` are the 8-bit values (b7–b0), as src/vanc.ts expects them.
 */
export function parseAnc(payload) {
  if (payload.length < 8) return { error: 'short', packets: [] };
  const extSeq = payload.readUInt16BE(0), length = payload.readUInt16BE(2), count = payload[4], f = payload[5] >> 6;
  const out = { extSeq, length, count, field: f === 2 ? 1 : f === 3 ? 2 : 0, packets: [] };
  if (f === 1) return { ...out, error: 'field' };
  if (8 + length > payload.length) return { ...out, error: 'length' };
  const body = payload.subarray(0, 8 + length);
  const r = new Bits(body, 8);
  for (let i = 0; i < count; i++) {
    const start = r.pos;
    if (r.left < 32 + 40) return { ...out, error: 'truncated' };
    const c = r.read(1), line = r.read(11), hOffset = r.read(12), s = r.read(1), stream = r.read(7);
    const didW = r.read(10), sdidW = r.read(10), dcW = r.read(10);
    const n = dcW & 0xff;
    if (r.left < (n + 1) * 10) return { ...out, error: 'truncated' };
    const udw = [];
    let sum = (didW & 0x1ff) + (sdidW & 0x1ff) + (dcW & 0x1ff);
    for (let k = 0; k < n; k++) { const w = r.read(10); udw.push(w); sum += w & 0x1ff; }
    const cs = r.read(10);
    const checksumOk = (cs & 0x1ff) === (sum & 0x1ff) && ((cs >> 9) & 1) === (((cs >> 8) & 1) ^ 1);
    out.packets.push({ c, line, hOffset, s, stream, did: didW & 0xff, sdid: sdidW & 0xff, dataCount: n, udw, checksumOk, parityOk: parityOk(didW) && parityOk(sdidW) && parityOk(dcW) });
    r.align32(start);
  }
  return out;
}

/** Build an RFC 8331 payload (for tests and the loopback check): packets { did, sdid, udw: bytes, line?, … }. */
export function buildAnc(packets, { extSeq = 0, field = 0 } = {}) {
  const words = [];
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  const par = (b) => { let p = 0; for (let i = 0; i < 8; i++) p ^= (b >> i) & 1; return (b & 0xff) | (p << 8) | ((p ^ 1) << 9); };
  for (const p of packets) {
    const start = bits.length;
    put(p.c ?? 0, 1); put(p.line ?? 0x7ff, 11); put(p.hOffset ?? 0xfff, 12); put(p.s ?? 0, 1); put(p.stream ?? 0, 7);
    const did = par(p.did), sdid = par(p.sdid), dc = par(p.udw.length);
    const udw = p.udw.map((b) => (p.raw10 ? b : par(b)));
    put(did, 10); put(sdid, 10); put(dc, 10);
    let sum = (did & 0x1ff) + (sdid & 0x1ff) + (dc & 0x1ff);
    for (const w of udw) { put(w, 10); sum += w & 0x1ff; }
    const cs = (sum & 0x1ff) | ((((sum >> 8) & 1) ^ 1) << 9);
    put(p.badChecksum ? cs ^ 1 : cs, 10);
    while ((bits.length - start) % 32) bits.push(0);
  }
  for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let k = 0; k < 8; k++) b = (b << 1) | (bits[i + k] ?? 0); words.push(b); }
  const head = Buffer.alloc(8);
  head.writeUInt16BE(extSeq & 0xffff, 0); head.writeUInt16BE(words.length, 2); head[4] = packets.length;
  head[5] = (field === 1 ? 2 : field === 2 ? 3 : 0) << 6;
  return Buffer.concat([head, Buffer.from(words)]);
}

// ---- 2110-41 Fast Metadata

/** Data Item Packages (ST 2110-41 §5.4) → [{ type, k, length, data }], or { error }. Contents stay opaque. */
export function parseFmx(payload) {
  const items = [];
  for (let o = 0; o + 4 <= payload.length;) {
    const h = payload.readUInt32BE(o);
    const type = h >>> 10, k = (h >>> 9) & 1, length = h & 0x1ff;
    if (length === 0 || o + 4 + length * 4 > payload.length) return { items, error: 'length' };
    items.push({ type, k, length, data: payload.subarray(o + 4, o + 4 + length * 4) });
    o += 4 + length * 4;
  }
  return { items };
}

// ---- ST 2022-7

/** ST 2022-7:2019 Table 1: receiver class that tolerates path differential `pdMs`. */
export function dupClass(pdMs, hbr) {
  if (!Number.isFinite(pdMs)) return null;
  if (pdMs <= 0.15) return 'D';
  if (pdMs <= 10) return 'A';
  if (pdMs <= 50) return 'B';
  if (pdMs <= (hbr ? 150 : 450)) return 'C';
  return 'beyond';
}

/**
 * Pairs the copies of an RTP stream received on two paths (ST 2022-7 Annex A: by sequence
 * number, checked with the RTP timestamp) and reports what a seamless receiver would see:
 * path offset (B − A, signed) now / min / max, path differential PD, jitter per path, packets
 * on one path only, packets missing on both, and the buffer depth MD a receiver needs (≥ the
 * largest PD seen, §7). `push()` returns true for the first copy – that one goes on.
 */
export class DupEvaluator {
  constructor({ clock = 48000, windowMs = 1000, paths = 2 } = {}) {
    this.clock = clock; this.windowMs = windowMs; this.nPaths = paths;
    this.entries = new Map(); this.next = null; this.highest = null; this.ref = null;
    this.path = Array.from({ length: paths }, () => ({ packets: 0, bytes: 0, only: 0, dup: 0, jitter: 0, last: null, lastAt: -Infinity }));
    this.both = 0; this.lostBoth = 0; this.late = 0; this.tsMismatch = 0; this.started = null;
    this.offsets = []; this.offMin = Infinity; this.offMax = -Infinity; this.pdMax = 0; this.lastOffset = null;
  }
  ext(seq) {
    if (this.ref === null) { this.ref = seq; return seq; }
    const e = this.ref + seqDiff(this.ref & 0xffff, seq);
    if (e > this.ref) this.ref = e;
    return e;
  }
  /** @returns {boolean} true when this is the first copy of the packet */
  push(pathIndex, rtp, rxMs, bytes = 0) {
    this.started ??= rxMs;
    const p = this.path[pathIndex];
    p.packets++; p.bytes += bytes; p.lastAt = rxMs;
    // RFC 3550 A.8 interarrival jitter, in RTP clock units
    if (p.last) {
      const d = ((rxMs - p.last.rx) * this.clock) / 1000 - ((rtp.ts - p.last.ts) | 0);
      p.jitter += (Math.abs(d) - p.jitter) / 16;
    }
    p.last = { rx: rxMs, ts: rtp.ts };
    const e = this.ext(rtp.seq);
    this.highest = this.highest === null ? e : Math.max(this.highest, e);
    this.next ??= e;
    let first = false;
    if (e < this.next) { this.late++; } else {
      const en = this.entries.get(e);
      if (!en) { this.entries.set(e, { ts: rtp.ts, first: rxMs, t: Array(this.nPaths).fill(null).map((_, i) => (i === pathIndex ? rxMs : null)) }); first = true; }
      else if (en.t[pathIndex] !== null) p.dup++;
      else {
        if (en.ts !== rtp.ts) this.tsMismatch++;
        en.t[pathIndex] = rxMs;
        if (this.nPaths === 2 && en.t[0] !== null && en.t[1] !== null) this.offset(en.t[1] - en.t[0], rxMs);
      }
    }
    this.finalise(rxMs);
    return first;
  }
  offset(d, now) {
    this.lastOffset = d;
    this.offMin = Math.min(this.offMin, d); this.offMax = Math.max(this.offMax, d);
    this.pdMax = Math.max(this.pdMax, Math.abs(d));
    this.offsets.push({ at: now, d });
    while (this.offsets.length && now - this.offsets[0].at > 10000) this.offsets.shift();
  }
  /** Close every sequence number older than the window: both, one path only, or none. */
  finalise(now) {
    while (this.next !== null && this.highest !== null && this.next <= this.highest) {
      const en = this.entries.get(this.next);
      if (en) {
        if (now - en.first < this.windowMs) return;
        const got = en.t.map((x) => x !== null);
        if (got.every(Boolean)) this.both++;
        else got.forEach((g, i) => { if (g) this.path[i].only++; });
        this.entries.delete(this.next);
      } else {
        // missing on every path – but only once a later packet is older than the window
        let later = null;
        for (let k = 1; k <= 2048 && this.next + k <= this.highest; k++) { later = this.entries.get(this.next + k); if (later) break; }
        if (!later || now - later.first < this.windowMs) return;
        this.lostBoth++;
      }
      this.next++;
    }
  }
  status(now) {
    this.finalise(now);
    // rates over the time packets came in (not up to now: a stopped stream keeps its rate)
    const lastAt = Math.max(...this.path.map((p) => p.lastAt));
    const span = this.started === null ? 0 : (lastAt - this.started) / 1000;
    const bytes = this.path.reduce((s, p) => Math.max(s, p.bytes), 0);
    const mbit = span > 0.1 ? (bytes * 8) / span / 1e6 : null;
    const hbr = mbit !== null && mbit >= 270;
    const recent = this.offsets.map((o) => o.d);
    const pps = span > 0.1 ? Math.max(...this.path.map((p) => p.packets)) / span : null;
    return {
      paths: this.path.map((p) => ({ packets: p.packets, only: p.only, duplicates: p.dup, jitterMs: (p.jitter / this.clock) * 1000, silentMs: Number.isFinite(p.lastAt) ? now - p.lastAt : null })),
      both: this.both, lostBoth: this.lostBoth, late: this.late, tsMismatch: this.tsMismatch,
      offsetMs: this.lastOffset, offsetMinMs: Number.isFinite(this.offMin) ? this.offMin : null, offsetMaxMs: Number.isFinite(this.offMax) ? this.offMax : null,
      offset10sMinMs: recent.length ? Math.min(...recent) : null, offset10sMaxMs: recent.length ? Math.max(...recent) : null,
      pdMaxMs: this.offsets.length || this.pdMax ? this.pdMax : null,
      /** MD a receiver needs (§7: PD must stay within PT − EA), in ms and in packets */
      bufferMs: this.offsets.length || this.pdMax ? this.pdMax : null,
      bufferPackets: pps !== null ? Math.ceil((this.pdMax / 1000) * pps) : null,
      // class D (150 µs) cannot be shown with software receive times: below 0.15 ms it says A
      class: this.offsets.length || this.pdMax ? (dupClass(this.pdMax, hbr) === 'D' ? 'A' : dupClass(this.pdMax, hbr)) : null,
      mbit, hbr, windowMs: this.windowMs,
    };
  }
}

// ---- receiver

/** Software receive time in ms (monotonic). */
const nowMs = () => performance.now();

/**
 * One flow: one socket per path, ST 2022-7 merge, reordering, then the essence decoder.
 * `onAudio(pcmFloat32Interleaved, sampleIndex)`, `onAnc({ packets, ts, field })`,
 * `onFmx({ items, ts })`, `onRaw(pathIndex, buf, rinfo)` (pcap tap).
 */
export class FlowReceiver {
  constructor(flow, { iface = '', iface2 = '', onAudio, onAnc, onFmx, onRaw, onError } = {}) {
    Object.assign(this, { flow, iface, iface2, onAudio, onAnc, onFmx, onRaw, onError });
    this.sockets = []; this.errors = [];
    this.dup = new DupEvaluator({ clock: flow.clock, paths: flow.paths.length });
    this.reorder = new ReorderBuffer((pkt, gap) => this.deliver(pkt, gap), { window: 64, maxWaitMs: 20 });
    this.packets = 0; this.badRtp = 0; this.ptMismatch = 0; this.payloadErrors = 0; this.ssrc = null; this.ssrcChanges = 0;
    this.audio = flow.essence?.startsWith('audio') ? { v: 0, b: 0, parity: 0, frames: 0, ts0: null, wraps: 0, lastTs: null, expected: null, overlap: 0 } : null;
    this.anc = flow.essence === 'anc40' ? { frames: 0, packets: 0, checksum: 0, parity: 0, fieldErr: 0, types: new Map(), lastTs: null } : null;
    this.fmx = flow.essence === 'fmx41' ? { items: 0, types: new Map() } : null;
    if (this.audio) this.order = parseChannelOrder(flow.fmtp?.['channel-order'], flow.channels);
  }
  get layout() { return this.order ? layoutOf(this.order) : ''; }
  start() {
    this.flow.paths.forEach((p, i) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      const iface = (i === 1 ? this.iface2 || this.iface : this.iface) || undefined;
      s.on('error', (e) => this.fail(i, e));
      s.on('message', (b, rinfo) => this.onPacket(i, b, rinfo, nowMs()));
      s.bind({ port: p.port, exclusive: false }, () => {
        try {
          s.setRecvBufferSize?.(4 * 1024 * 1024);
        } catch { /* the system keeps its own limit */ }
        if (!isMulticast(p.dest)) return;
        try {
          if (p.source && typeof s.addSourceSpecificMembership === 'function') s.addSourceSpecificMembership(p.source, p.dest, iface);
          else s.addMembership(p.dest, iface);
        } catch (e) { this.fail(i, e); }
      });
      this.sockets.push(s);
    });
    this.timer = setInterval(() => this.reorder.drain(), 20);
    return this;
  }
  fail(i, e) {
    const m = e?.code === 'EADDRINUSE' ? bmsg('st2110.inUse', `Port ${this.flow.paths[i].port} is in use`, { port: this.flow.paths[i].port })
      : e?.code === 'EADDRNOTAVAIL' || e?.code === 'ENODEV' || e?.code === 'EINVAL' ? bmsg('st2110.join', `Cannot join ${this.flow.paths[i].dest} on this interface (${e.code})`, { group: this.flow.paths[i].dest, err: e.code })
        : bmsg('st2110.socket', `Socket: ${e?.message ?? e}`, { reason: String(e?.message ?? e) });
    this.errors[i] = m;
    this.onError?.(m);
  }
  stop() {
    clearInterval(this.timer);
    for (const s of this.sockets) { try { s.close(); } catch { /* already closed */ } }
    this.sockets = [];
  }
  onPacket(i, b, rinfo, rx) {
    const p = this.flow.paths[i];
    // source-specific: drop what another sender puts on the group (when SSM was not possible)
    if (p.source && rinfo?.address && rinfo.address !== p.source) return;
    this.onRaw?.(i, b, rinfo);
    const r = parseRtp(b);
    if (!r) { this.badRtp++; return; }
    if (this.flow.pt !== null && this.flow.pt !== undefined && r.pt !== this.flow.pt) { this.ptMismatch++; return; }
    if (this.ssrc !== null && r.ssrc !== this.ssrc) this.ssrcChanges++;
    this.ssrc = r.ssrc;
    this.packets++;
    if (this.dup.push(i, r, rx, b.length)) this.reorder.push(r);
  }
  deliver(r, gap) {
    try {
      if (this.audio) this.deliverAudio(r);
      else if (this.anc) this.deliverAnc(r);
      else if (this.fmx) this.deliverFmx(r);
    } catch { this.payloadErrors++; }
    void gap;
  }
  /** sample index from the RTP timestamp (ST 2110-10 §7.7: it advances by the samples per packet) */
  deliverAudio(r) {
    const a = this.audio, ch = this.flow.channels;
    let pcm;
    if (this.flow.essence === 'audio31') { const d = decodeAm824(r.payload, ch); pcm = d.pcm; a.v += d.v; a.b += d.b; a.parity += d.parity; }
    else pcm = decodeLinear(r.payload, ch, this.flow.encoding === 'L16' ? 16 : 24);
    const n = pcm.length / ch;
    if (!n) return;
    if (a.ts0 === null) a.ts0 = r.ts;
    if (a.lastTs !== null && r.ts < a.lastTs && a.lastTs - r.ts > 0x80000000) a.wraps++;
    a.lastTs = r.ts;
    let index = r.ts + a.wraps * 0x100000000 - a.ts0;
    if (a.expected !== null && index < a.expected) {
      // overlap (repeated or shifted samples): keep only the new part
      const skip = a.expected - index;
      if (skip >= n) { a.overlap += n; return; }
      a.overlap += skip; pcm = pcm.subarray(skip * ch); index = a.expected;
    }
    a.expected = index + pcm.length / ch;
    a.frames += pcm.length / ch;
    this.onAudio?.(pcm, index);
  }
  deliverAnc(r) {
    const a = this.anc;
    const d = parseAnc(r.payload);
    if (d.error === 'field') { a.fieldErr++; return; }
    if (d.error) this.payloadErrors++;
    if (r.ts !== a.lastTs) { a.frames++; a.lastTs = r.ts; }
    for (const p of d.packets) {
      a.packets++;
      if (!p.checksumOk) a.checksum++;
      if (!p.parityOk) a.parity++;
      const k = `${p.did.toString(16).padStart(2, '0')}/${p.sdid.toString(16).padStart(2, '0')}`;
      a.types.set(k, (a.types.get(k) ?? 0) + 1);
    }
    this.onAnc?.({ packets: d.packets, ts: r.ts, field: d.field, marker: r.marker });
  }
  deliverFmx(r) {
    const d = parseFmx(r.payload);
    if (d.error) this.payloadErrors++;
    for (const it of d.items) { this.fmx.items++; const k = it.type.toString(16).toUpperCase(); this.fmx.types.set(k, (this.fmx.types.get(k) ?? 0) + 1); }
    this.onFmx?.({ items: d.items, ts: r.ts });
  }
  status() {
    const now = nowMs();
    const f = this.flow;
    return {
      essence: f.essence, encoding: f.encoding, clock: f.clock, channels: f.channels, paths: f.paths.map((p, i) => ({ dest: p.dest, port: p.port, source: p.source, ...(this.errors[i] ? field('error', this.errors[i]) : {}) })),
      packets: this.packets, badRtp: this.badRtp, ptMismatch: this.ptMismatch, payloadErrors: this.payloadErrors, ssrcChanges: this.ssrcChanges,
      lost: this.reorder.lost, reordered: this.reorder.reordered,
      dup: f.paths.length > 1 ? this.dup.status(now) : null,
      jitterMs: (this.dup.path[0].jitter / f.clock) * 1000,
      ...(this.audio ? { audio: { frames: this.audio.frames, validity: this.audio.v, blocks: this.audio.b, parity: this.audio.parity, overlap: this.audio.overlap, order: this.order.map((g) => g.symbol) } } : {}),
      ...(this.anc ? { anc: { frames: this.anc.frames, packets: this.anc.packets, checksum: this.anc.checksum, parity: this.anc.parity, fieldErr: this.anc.fieldErr, types: Object.fromEntries(this.anc.types) } } : {}),
      ...(this.fmx ? { fmx: { items: this.fmx.items, types: Object.fromEntries(this.fmx.types) } } : {}),
    };
  }
}

export const isMulticast = (a) => /^(22[4-9]|23\d)\./.test(a ?? '');

/** Hex for VancPacket.data (lower 8 bits of each UDW, src/vanc.ts). */
export const udwHex = (udw) => udw.map((w) => (w & 0xff).toString(16).padStart(2, '0')).join('');
