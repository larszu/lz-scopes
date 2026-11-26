// Test signal generator for ST 2110-20 (video), ST 2110-30 (PCM audio), ST 2110-40 (ancillary
// data: ATC time code from PTP time) and ST 2022-6 (SDI over IP), optionally twice for ST 2022-7.
// Counterpart of the receive paths (receiver.mjs) so they can be checked without a third-party
// device (loopback test, ci:local).
//
// Sources (docs/research/st2110-netz.md):
// - ST 2110-10:2022 §7.3/§7.6: RTP clock offset 0 at the SMPTE epoch; video time stamp = RTP clock
//   at the alignment point N·TFRAME, truncated. ST 2110-20 §6.1.3: 90 kHz.
// - ST 2110-21:2022 §6.3: gapped read schedule TPRj = TVD + j·TRS; a type N sender has every packet
//   out before its TPRj; we send packet j at TPRj − TRS/2.
// - ST 2110-30 / AES67: L24 big-endian, 48 kHz RTP clock, 1 ms (Level A, ≤ 8 ch) or 125 µs (Level C,
//   up to 64 ch) packet time. Level −18 dBFS = EBU R 68 alignment level.
// - RFC 8331 §2 (opened): ANC payload header and per-packet fields, parity of Data_Count and the
//   checksum rule. ST 12-2 ATC (DID 60h/SDID 60h, 16 UDW, nibble in b7–b4) [Wissen; the decoder
//   src/vanc.ts reads the same layout and is the unit test's counterpart].
// - ST 2059-1 §9: time address from PTP time minus the leap seconds (here without a local offset).
//
// Software pacing: Node sends from one thread with timers; the packets of a frame leave in short
// bursts per loop turn, not on the exact grid. At high rates (1080p50: ≈ 216 000 packets/s) a
// single Node process does not keep up; the generator then reports late packets. The loopback
// test uses small pictures.

import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { rtpHeader, packetizeFrame, packRow422, STD_UDP } from './video.mjs';
import { model } from './timing.mjs';
import { sdiGeometry, buildSdiFrame, packWords, hbrmtHeader, HBRMT_PAYLOAD } from './sdi.mjs';
import { writeSdp } from './sdp.mjs';
import { createClock } from './clock.mjs';
import { taiMinusUtc } from '../leap.mjs';

/** Formats offered (ST 2110-20 fmtp values). `small` is for tests only. */
export const VIDEO_FORMATS = {
  '1080p50': { width: 1920, height: 1080, rate: { num: 50, den: 1 }, interlace: false },
  '1080p25': { width: 1920, height: 1080, rate: { num: 25, den: 1 }, interlace: false },
  '1080p59.94': { width: 1920, height: 1080, rate: { num: 60000, den: 1001 }, interlace: false },
  '1080i50': { width: 1920, height: 1080, rate: { num: 25, den: 1 }, interlace: true },
  '1080i59.94': { width: 1920, height: 1080, rate: { num: 30000, den: 1001 }, interlace: true },
  '720p50': { width: 1280, height: 720, rate: { num: 50, den: 1 }, interlace: false },
  '2160p50': { width: 3840, height: 2160, rate: { num: 50, den: 1 }, interlace: false },
  '2160p25': { width: 3840, height: 2160, rate: { num: 25, den: 1 }, interlace: false },
  small: { width: 192, height: 108, rate: { num: 25, den: 1 }, interlace: false },
};

const KR_KB = { bt709: [0.2126, 0.0722], bt2020: [0.2627, 0.0593], bt601: [0.299, 0.114] };

/**
 * EBU 100/0/75/0 colour bars on the top three quarters, a luma ramp 0–100 % below; 10-bit narrow
 * range Y′CbCr 4:2:2 (BT.709/BT.2020 matrices, BT.2100-3 Table 9 quantisation: Y 64 + 876·Y′,
 * C 512 + 896·C). Returns row(i) → Uint16Array of Cb Y0 Cr Y1 … (2 per pixel).
 */
export function barsPicture(width, height, matrix = 'bt709') {
  const [kr, kb] = KR_KB[matrix] ?? KR_KB.bt709;
  const kg = 1 - kr - kb;
  const code = (r, g, b) => {
    const y = kr * r + kg * g + kb * b;
    return [Math.round(64 + 876 * y), Math.round(512 + 896 * ((b - y) / (2 * (1 - kb)))), Math.round(512 + 896 * ((r - y) / (2 * (1 - kr))))];
  };
  const bars = [[1, 1, 1], [0.75, 0.75, 0], [0, 0.75, 0.75], [0, 0.75, 0], [0.75, 0, 0.75], [0.75, 0, 0], [0, 0, 0.75], [0, 0, 0]].map((c) => code(...c));
  const top = new Uint16Array(width * 2), ramp = new Uint16Array(width * 2);
  for (let x = 0; x < width; x += 2) {
    const [y0, cb, cr] = bars[Math.min(7, Math.floor((x * 8) / width))];
    const [y1] = bars[Math.min(7, Math.floor(((x + 1) * 8) / width))];
    top.set([cb, y0, cr, y1], x * 2);
    const r = (v) => Math.round(64 + (876 * v) / Math.max(1, width - 1));
    ramp.set([512, r(x), 512, r(x + 1)], x * 2);
  }
  const split = Math.floor((height * 3) / 4);
  return (i) => (i < split ? top : ramp);
}

/** Alignment point of frame/period n (s relative to epochSec) and the RTP time stamp at it. */
export function alignment(n, rate, epochSec, clockHz = 90000) {
  const N = BigInt(n), num = BigInt(rate.num), den = BigInt(rate.den);
  const at = Number(N * den - BigInt(epochSec) * num) / rate.num;
  const ts = Number(((N * den * BigInt(clockHz)) / num) % 4294967296n);
  return { at, ts };
}
export const frameAt = (t, rate, epochSec) => Number(((BigInt(epochSec) * BigInt(rate.num)) + BigInt(Math.floor(t * rate.num))) / BigInt(rate.den));

// ---- flows: each yields a schedule of { at, buf } per period n

/** ST 2110-20 video flow (static picture: payloads built once, headers per packet). */
export function videoFlow({ format = 'small', depth = 10, matrix = 'bt709', pt = 96, tp = '2110TPN', maxUdp = STD_UDP } = {}) {
  const f = VIDEO_FORMATS[format];
  if (!f) throw new Error(`unknown format ${format}`);
  const pgroup = { 8: { bytes: 4, pixels: 2 }, 10: { bytes: 5, pixels: 2 } }[depth];
  if (!pgroup) throw new Error('depth 8 or 10');
  const fmt = { ...f, pgroup, maxUdp };
  const pic = barsPicture(f.width, f.height, matrix);
  const rows = new Map();
  const payloads = packetizeFrame(fmt, (r) => { const k = pic(r); if (!rows.has(k)) rows.set(k, packRow422(k, depth)); return rows.get(k); });
  const m = model({ rate: f.rate, height: f.height, interlace: f.interlace, tp, npackets: payloads.length });
  const flow = {
    kind: 'video', format, width: f.width, height: f.height, rate: f.rate, interlace: f.interlace, sampling: 'YCbCr-4:2:2', depth, pt, tp,
    colorimetry: matrix === 'bt2020' ? 'BT2020' : 'BT709', tcs: 'SDR', npackets: payloads.length, model: m,
    picture: pic,
  };
  flow.period = (n, epochSec) => {
    const a = alignment(n, f.rate, epochSec);
    const tsField2 = f.interlace ? alignment(2 * n + 1, { num: f.rate.num * 2, den: f.rate.den }, epochSec).ts : a.ts;
    const tvd = a.at + m.troffset;
    return payloads.map((p, j) => ({ at: tvd + m.tpr(j) - m.trs / 2, marker: p.marker, ts: p.field ? tsField2 : a.ts, payload: p.payload }));
  };
  flow.periodLength = f.rate.den / f.rate.num;
  return flow;
}

/** ST 2110-30 audio: L24, `channels` × sine `freq` Hz at `levelDb` dBFS, packet time 1 ms or 125 µs. */
export function audioFlow({ channels = 2, freq = 1000, levelDb = -18, ptimeMs = channels > 8 ? 0.125 : 1, pt = 97 } = {}) {
  if (!(channels >= 1 && channels <= 64)) throw new Error('channels 1–64');
  const spp = Math.round(48 * ptimeMs);
  if (channels * spp * 3 > STD_UDP - 12) throw new Error('packet too large for the standard UDP limit: use 125 µs');
  const amp = 10 ** (levelDb / 20) * 8388607;
  const rate = { num: 48000, den: spp };
  const flow = { kind: 'audio', channels, freq, levelDb, ptimeMs, pt, rate, samplesPerPacket: spp };
  flow.period = (n, epochSec) => {
    const { at, ts } = alignment(n, rate, epochSec, 48000);
    const b = Buffer.alloc(channels * spp * 3);
    // sample index since the epoch modulo one period of the tone keeps the phase continuous
    const first = (BigInt(n) * BigInt(spp)) % 48000n;
    for (let s = 0; s < spp; s++) {
      const v = Math.round(amp * Math.sin((2 * Math.PI * freq * Number((first + BigInt(s)) % 48000n)) / 48000));
      for (let c = 0; c < channels; c++) b.writeIntBE(v, (s * channels + c) * 3, 3);
    }
    return [{ at, marker: false, ts, payload: b }];
  };
  flow.periodLength = spp / 48000;
  return flow;
}

const parity10 = (v8) => { let p = 0; for (let i = 0; i < 8; i++) p ^= (v8 >> i) & 1; return (v8 & 0xff) | (p << 8) | ((p ^ 1) << 9); };

/**
 * ST 12-1 time address (64 bits, LSB first in nibbles) for a frame count within the day at an
 * integer rate. Above 30 frames/s the address counts frame pairs and flags the second frame of a
 * pair (bit 59 at 50 fps, bit 27 at 60 fps – the LTC polarity position, docs/research/clock-ptp.md).
 */
export function timeAddress(frameOfDay, fps) {
  const pairs = fps > 30;
  const f = pairs ? Math.floor(frameOfDay / 2) : frameOfDay, flag = pairs ? frameOfDay & 1 : 0;
  const per = pairs ? fps / 2 : fps;
  const ff = f % per, total = Math.floor(f / per);
  const ss = total % 60, mm = Math.floor(total / 60) % 60, hh = Math.floor(total / 3600) % 24;
  const nib = new Array(16).fill(0);
  nib[0] = ff % 10; nib[2] = Math.floor(ff / 10);
  nib[4] = ss % 10; nib[6] = Math.floor(ss / 10);
  nib[8] = mm % 10; nib[10] = Math.floor(mm / 10);
  nib[12] = hh % 10; nib[14] = Math.floor(hh / 10);
  if (flag) { if (fps === 50 || fps === 25) nib[14] |= 8; else nib[6] |= 8; }
  return nib;
}

/** ST 12-2 ATC user data words: nibble in b7–b4, DBB bit in b3 (DBB1 = payload type in UDW1–8). */
export function atcUdw(nibbles, dbb1 = 0x00, dbb2 = 0x00) {
  return nibbles.map((n, i) => parity10(((n & 15) << 4) | ((((i < 8 ? dbb1 >> i : dbb2 >> (i - 8)) & 1)) << 3)));
}

/** RFC 8331 payload (after the RTP header) for ANC packets [{ line, offset, did, sdid, udw: [10-bit] }]. */
export function rfc8331Payload(packets, extSeq = 0, field = 0) {
  const bits = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  for (const p of packets) {
    put(0, 1); put(p.line ?? 10, 11); put(p.offset ?? 0, 12); put(0, 1); put(0, 7);
    const did = parity10(p.did), sdid = parity10(p.sdid), dc = parity10(p.udw.length);
    put(did, 10); put(sdid, 10); put(dc, 10);
    let sum = (did & 0x1ff) + (sdid & 0x1ff) + (dc & 0x1ff);
    for (const w of p.udw) { put(w, 10); sum += w & 0x1ff; }
    const cs = sum & 0x1ff;
    put(cs | ((((cs >> 8) & 1) ^ 1) << 9), 10);
    while (bits.length % 32) bits.push(0); // word_align
  }
  const body = Buffer.alloc(bits.length / 8);
  for (let i = 0; i < bits.length; i++) if (bits[i]) body[i >> 3] |= 0x80 >> (i & 7);
  const head = Buffer.alloc(8);
  head.writeUInt16BE(extSeq & 0xffff, 0); head.writeUInt16BE(body.length, 2);
  head[4] = packets.length; head[5] = (field & 3) << 6;
  return Buffer.concat([head, body]);
}

/** ST 2110-40 flow: one ATC (LTC payload type) per frame, time of day from PTP time − leap seconds. */
export function ancFlow({ rate = { num: 25, den: 1 }, pt = 100 } = {}) {
  if (rate.den !== 1) throw new Error('ATC generator: integer frame rates only (drop-frame counting not built)');
  const flow = { kind: 'anc', rate, pt };
  flow.period = (n, epochSec) => {
    const { at, ts } = alignment(n, rate, epochSec);
    const utcMs = (epochSec + at) * 1000 - 37000;
    const utc = epochSec + at - taiMinusUtc(utcMs);
    const day = ((utc % 86400) + 86400) % 86400;
    const fod = Math.floor(day * rate.num + 1e-6) % (86400 * rate.num);
    const udw = atcUdw(timeAddress(fod, rate.num), 0x00);
    return [{ at: at + 0.001, marker: true, ts, payload: rfc8331Payload([{ line: 10, did: 0x60, sdid: 0x60, udw }]) }];
  };
  flow.periodLength = 1 / rate.num;
  return flow;
}

/** ST 2022-6 flow (10-bit 4:2:2 HD/3G), bars from barsPicture; RTP clock 27 MHz (ST 2022-8). */
export function sdiFlow({ frame = 0x21, frate = 0x12, pt = 98 } = {}) {
  const g = sdiGeometry(frame, frate, 0x01);
  if (!g) throw new Error('unsupported 2022-6 format');
  const pic = barsPicture(g.width, g.height);
  const bytes = packWords(buildSdiFrame(g, pic));
  const rate = { num: g.rate[0], den: g.rate[1] };
  const chunks = [];
  for (let o = 0; o < bytes.length; o += HBRMT_PAYLOAD) {
    const c = Buffer.alloc(HBRMT_PAYLOAD);
    bytes.copy(c, 0, o, Math.min(bytes.length, o + HBRMT_PAYLOAD));
    chunks.push(c);
  }
  const flow = { kind: 'sdi', frame, frate, rate, pt, geometry: g, datagrams: chunks.length, width: g.width, height: g.height, picture: pic };
  flow.period = (n, epochSec) => {
    const { at, ts } = alignment(n, rate, epochSec, 27000000);
    const T = rate.den / rate.num, step = T / chunks.length;
    return chunks.map((c, j) => ({ at: at + j * step, marker: j === chunks.length - 1, ts, payload: Buffer.concat([hbrmtHeader({ frCount: n & 255, frame, frate }), c]) }));
  };
  flow.periodLength = 1 / (rate.num / rate.den);
  return flow;
}

/**
 * Sends flows in real time. `legs`: [{ host, port, iface? }] (two legs = ST 2022-7, same packets on
 * both). One Sender per flow; status() counts packets and late sends.
 */
export class Sender {
  constructor(flow, { legs, ttl = 32, clock = createClock(), socket = null, ssrc = randomBytes(4).readUInt32BE(0) } = {}) {
    if (!legs?.length || legs.length > 2) throw new Error('one or two destinations');
    Object.assign(this, { flow, legs, ttl, clock, ssrc });
    this.socket = socket ?? dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.seq = 0; this.sent = 0; this.late = 0; this.errors = 0; this.running = false; this.queue = []; this.n = null;
  }
  async start() {
    this.running = true;
    await new Promise((ok) => this.socket.bind(0, ok));
    try { this.socket.setMulticastTTL(this.ttl); } catch { /* unicast */ }
    if (this.legs[0].iface) try { this.socket.setMulticastInterface(this.legs[0].iface); } catch { /* */ }
    try { this.socket.setSendBufferSize(8 * 1024 * 1024); } catch { /* */ }
    this.socket.on('error', () => { this.errors++; });
    // start with the next whole period
    this.n = frameAt(this.clock.now(), this.flow.rate, this.clock.epochSec) + 1;
    this.loop();
    return this;
  }
  stop() { this.running = false; clearTimeout(this.timer); try { this.socket.close(); } catch { /* */ } }
  fill() {
    while (this.queue.length < 2 * (this.flow.npackets ?? this.flow.datagrams ?? 1)) {
      for (const p of this.flow.period(this.n, this.clock.epochSec)) this.queue.push(p);
      this.n++;
    }
  }
  loop() {
    if (!this.running) return;
    this.fill();
    const now = this.clock.now();
    let i = 0;
    for (; i < this.queue.length && this.queue[i].at <= now; i++) {
      const p = this.queue[i];
      if (now - p.at > 0.001) this.late++;
      const pkt = Buffer.concat([rtpHeader({ marker: p.marker, pt: this.flow.pt, seq: this.seq, ts: p.ts, ssrc: this.ssrc }), p.payload]);
      // Extended Sequence Number (2110-20 / RFC 8331): high 16 bits of the 32-bit counter
      if (this.flow.kind === 'video' || this.flow.kind === 'anc') pkt.writeUInt16BE((this.seq >>> 16) & 0xffff, 12);
      this.seq = (this.seq + 1) >>> 0;
      for (const leg of this.legs) this.socket.send(pkt, leg.port, leg.host, (e) => { if (e) this.errors++; });
      this.sent++;
    }
    this.queue.splice(0, i);
    const next = this.queue[0]?.at ?? now + 0.001;
    const wait = (next - now) * 1000;
    if (wait > 2) this.timer = setTimeout(() => this.loop(), wait - 1);
    else setImmediate(() => this.loop());
  }
  sdp(origin = '0.0.0.0') {
    return writeSdp({ origin, legs: this.legs.map((l) => ({ group: l.host, port: l.port, source: l.source ?? null })), flow: this.flow });
  }
  status() { return { kind: this.flow.kind, sent: this.sent, late: this.late, errors: this.errors, legs: this.legs.map((l) => `${l.host}:${l.port}`) }; }
}
