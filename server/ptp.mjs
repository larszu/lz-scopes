// Passive PTP monitor (IEEE 1588-2008 / SMPTE ST 2059-2) and ST 2110 RTP timestamp check.
// Own code – no node-ptpv2 (GPL, no domain 127), no linuxptp (GPL).
//
// Sources (opened, see docs/research/clock-ptp.md):
// - Ports 319 (ptp-event) / 320 (ptp-general) and 224.0.1.129 (PTP-primary): IANA
//   service-names-port-numbers and multicast-addresses registries.
// - Message layout: IEEE 1588-2008 is not freely available; offsets were taken from the
//   Wireshark PTP dissector (epan/dissectors/packet-ptp.c, GPL – facts only, no code):
//   common header 34 bytes (0 transportSpecific|messageType, 1 versionPTP, 2 messageLength,
//   4 domainNumber, 6 flagField, 8 correctionField, 20 clockIdentity, 28 portNumber,
//   30 sequenceId, 32 controlField, 33 logMessageInterval); Sync/Follow_Up timestamp at 34
//   (uint48 s + uint32 ns); Announce 44 currentUtcOffset, 47 priority1, 48 clockClass,
//   49 clockAccuracy, 50 offsetScaledLogVariance, 52 priority2, 53 grandmasterIdentity,
//   61 stepsRemoved, 63 timeSource; Management 46 actionField, TLV at 48; flags 0x0200
//   twoStep, 0x0004 currentUtcOffsetValid, 0x0008 ptpTimescale, 0x0010 timeTraceable.
// - SMPTE ST 2059-2:2021 (free): domain default 127, logSyncInterval default −3,
//   logAnnounceInterval default 0, announceReceiptTimeout 3, SM TLV Table 2 (organizationId
//   68 97 E8, subtype 00 00 01, 48 bytes), Management message Table 1 (TLV at offset 48).
// - SMPTE ST 2110-10:2022 §7.3 (RTP clock offset zero at the epoch, mediaclk:direct=0),
//   §7.6.1/7.6.4 (video RTP timestamp = RTP clock at the alignment point, truncated),
//   ST 2110-20:2022 §6.1.3 (RTP clock 90 kHz), RFC 3550 §5.1 (32-bit timestamp at bytes 4–7).
//
// All receive/send times are software timestamps of this process (performance clock);
// offsets and delays are estimates in the order of 0.1–1 ms and are labelled as such.

import dgram from 'node:dgram';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { performance } from 'node:perf_hooks';
import { taiMinusUtc as leapTaiMinusUtc } from './leap.mjs';

export const PTP_PRIMARY = '224.0.1.129';
export const PTP_EVENT_PORT = 319;
export const PTP_GENERAL_PORT = 320;
export const MSG = { SYNC: 0x0, DELAY_REQ: 0x1, FOLLOW_UP: 0x8, DELAY_RESP: 0x9, ANNOUNCE: 0xb, SIGNALING: 0xc, MANAGEMENT: 0xd };
const MSG_NAMES = { 0: 'Sync', 1: 'Delay_Req', 2: 'Pdelay_Req', 3: 'Pdelay_Resp', 8: 'Follow_Up', 9: 'Delay_Resp', 10: 'Pdelay_Resp_Follow_Up', 11: 'Announce', 12: 'Signaling', 13: 'Management' };
export const TIME_SOURCES = { 0x10: 'ATOMIC_CLOCK', 0x20: 'GPS', 0x30: 'TERRESTRIAL_RADIO', 0x39: 'SERIAL_TIME_CODE', 0x40: 'PTP', 0x50: 'NTP', 0x60: 'HAND_SET', 0x90: 'OTHER', 0xa0: 'INTERNAL_OSCILLATOR', 0xf0: 'SMPTE: Sync-Signal, ARB', 0xf1: 'SMPTE: Sync-Signal, PTP-initialisiert' };
/** ST 2059-2 Table 2 gmLockingStatus */
export const LOCKING_STATUS = ['nicht verfügbar', 'intern (nicht extern gebunden)', 'Cold Locking', 'Warm Locking', 'extern gebunden'];

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export const clockIdText = (id) => (id.length === 16 ? id.match(/../g).join(':') : id);

/** uint48 seconds + uint32 ns → BigInt ns */
const readTs = (b, off) => BigInt(b.readUIntBE(off, 6)) * 1_000_000_000n + BigInt(b.readUInt32BE(off + 6));

/** SM TLV (ST 2059-2 Table 2) at `off` (start of tlvType), or null. */
export function parseSmTlv(b, off) {
  if (b.length < off + 52) return null;
  if (b.readUInt16BE(off) !== 0x0003) return null;
  if (b.readUInt16BE(off + 2) < 48) return null;
  if (b[off + 4] !== 0x68 || b[off + 5] !== 0x97 || b[off + 6] !== 0xe8) return null;
  const subType = b.readUIntBE(off + 7, 3);
  if (subType !== 1) return { subType };
  return {
    subType,
    frameRateNum: b.readUInt32BE(off + 10), frameRateDen: b.readUInt32BE(off + 14),
    gmLockingStatus: b[off + 18],
    dropFrame: !!(b[off + 19] & 1), colorFrame: !!(b[off + 19] & 2),
    currentLocalOffset: b.readInt32BE(off + 20), jumpSeconds: b.readInt32BE(off + 24),
    timeOfNextJump: b.readUIntBE(off + 28, 6), timeOfNextJam: b.readUIntBE(off + 34, 6), timeOfPreviousJam: b.readUIntBE(off + 40, 6),
    previousJamLocalOffset: b.readInt32BE(off + 46),
    daylightSaving: { current: !!(b[off + 50] & 1), next: !!(b[off + 50] & 2), previousJam: !!(b[off + 50] & 4) },
    leapSecondJump: !!(b[off + 51] & 1),
  };
}

/** Parse a PTPv2 message; null if it is not one. */
export function parsePtp(b) {
  if (!Buffer.isBuffer(b) || b.length < 34) return null;
  const version = b[1] & 0x0f;
  if (version !== 2) return null;
  const type = b[0] & 0x0f;
  const length = b.readUInt16BE(2);
  if (length < 34 || length > b.length) return null;
  const flags = b.readUInt16BE(6);
  const m = {
    type, name: MSG_NAMES[type] ?? `Typ ${type}`, transportSpecific: b[0] >> 4, version, minorVersion: b[1] >> 4, length,
    domain: b[4], flags, twoStep: !!(flags & 0x0200), unicast: !!(flags & 0x0400),
    utcOffsetValid: !!(flags & 0x0004), ptpTimescale: !!(flags & 0x0008), timeTraceable: !!(flags & 0x0010), frequencyTraceable: !!(flags & 0x0020),
    leap61: !!(flags & 0x0001), leap59: !!(flags & 0x0002),
    /** correctionField in ns (scaled ns / 2^16) */
    correctionNs: Number(b.readBigInt64BE(8)) / 65536,
    clockIdentity: hex(b.subarray(20, 28)), portNumber: b.readUInt16BE(28), sequenceId: b.readUInt16BE(30),
    logMessageInterval: b.readInt8(33),
  };
  if ((type === MSG.SYNC || type === MSG.FOLLOW_UP || type === MSG.DELAY_REQ) && length >= 44) m.timestampNs = readTs(b, 34);
  if (type === MSG.DELAY_RESP && length >= 54) {
    m.timestampNs = readTs(b, 34);
    m.requestingClockIdentity = hex(b.subarray(44, 52)); m.requestingPortNumber = b.readUInt16BE(52);
  }
  if (type === MSG.ANNOUNCE && length >= 64) {
    Object.assign(m, {
      timestampNs: readTs(b, 34), currentUtcOffset: b.readInt16BE(44), priority1: b[47], clockClass: b[48], clockAccuracy: b[49],
      offsetScaledLogVariance: b.readUInt16BE(50), priority2: b[52], grandmasterIdentity: hex(b.subarray(53, 61)),
      stepsRemoved: b.readUInt16BE(61), timeSource: b[63],
    });
  }
  if (type === MSG.MANAGEMENT && length >= 52) {
    m.actionField = b[46] & 0x0f;
    const sm = parseSmTlv(b, 48);
    if (sm) m.sm = sm;
  }
  return m;
}

// ---- builders (tests and our optional Delay_Req)

/** Common header + body. `ts` in BigInt ns (Sync/Follow_Up/Delay_Req/Announce origin). */
export function buildPtp({ type, domain = 127, flags = 0, correctionNs = 0, clockIdentity = '0011223344556677', portNumber = 1, sequenceId = 0, logMessageInterval = 0, body = Buffer.alloc(0) }) {
  const b = Buffer.alloc(34 + body.length);
  b[0] = type & 0x0f; b[1] = 2; b.writeUInt16BE(b.length, 2); b[4] = domain; b.writeUInt16BE(flags, 6);
  b.writeBigInt64BE(BigInt(Math.round(correctionNs * 65536)), 8);
  Buffer.from(clockIdentity, 'hex').copy(b, 20); b.writeUInt16BE(portNumber, 28); b.writeUInt16BE(sequenceId, 30);
  b[32] = { 0: 0, 1: 1, 8: 2, 9: 3, 13: 4 }[type] ?? 5; b.writeInt8(logMessageInterval, 33);
  body.copy(b, 34);
  return b;
}
export function tsBytes(ns) {
  const b = Buffer.alloc(10);
  const n = BigInt(ns);
  b.writeUIntBE(Number(n / 1_000_000_000n), 0, 6); b.writeUInt32BE(Number(n % 1_000_000_000n), 6);
  return b;
}

// ---- time helpers

/** Local wall clock (POSIX UTC) in BigInt ns from the performance clock. */
export function nowUtcNs() {
  const ms = performance.timeOrigin + performance.now();
  const whole = Math.floor(ms);
  return BigInt(whole) * 1_000_000n + BigInt(Math.round((ms - whole) * 1e6));
}

const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Passive monitor. Emits nothing – callers poll `status()`. `taiMinusUtc(utcMs)` supplies
 * the leap table for the local clock when the grandmaster does not signal a valid UTC offset.
 */
export class PtpMonitor {
  constructor({ iface = '', delayReq = false, taiMinusUtc = leapTaiMinusUtc, now = nowUtcNs } = {}) {
    this.iface = iface; this.delayReq = delayReq; this.taiMinusUtc = taiMinusUtc; this.now = now;
    this.sockets = []; this.error = ''; this.started = 0; this.running = false;
    /** per domain: announce sources, sync state, sm */
    this.domains = new Map();
    this.counts = new Map(); // `${domain}:${type}` → timestamps (ms) of the last 10 s
    this.ourId = randomBytes(8).toString('hex');
    this.seq = 0; this.pendingReq = new Map();
    this.timer = null;
  }

  nowMs() { return Number(this.now() / 1_000_000n); }

  async start() {
    this.running = true; this.started = this.nowMs();
    const bindOne = (port) => new Promise((ok) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.once('error', (e) => { ok({ error: e }); try { s.close(); } catch { /* */ } });
      s.bind({ port, address: '0.0.0.0', exclusive: false }, () => {
        try { s.addMembership(PTP_PRIMARY, this.iface || undefined); } catch (e) { ok({ error: e }); try { s.close(); } catch { /* */ } return; }
        s.removeAllListeners('error');
        s.on('error', (e) => { this.error = errorText(e, port); });
        s.on('message', (msg, rinfo) => this.onPacket(msg, rinfo, this.now()));
        ok({ socket: s });
      });
    });
    const [ev, gen] = await Promise.all([bindOne(PTP_EVENT_PORT), bindOne(PTP_GENERAL_PORT)]);
    for (const r of [ev, gen]) if (r.socket) this.sockets.push(r.socket);
    const err = ev.error ?? gen.error;
    if (err) this.error = errorText(err, ev.error ? PTP_EVENT_PORT : PTP_GENERAL_PORT);
    this.eventSocket = ev.socket ?? null;
    if (this.delayReq && this.eventSocket) this.timer = setInterval(() => this.sendDelayReq(), 1000);
    return this;
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    for (const s of this.sockets) { try { s.close(); } catch { /* */ } }
    this.sockets = [];
  }

  domain(d) {
    let s = this.domains.get(d);
    if (!s) {
      s = { announces: new Map(), syncs: new Map(), fus: new Map(), sm: null, smAt: 0, offsets: [], delays: [], lastSyncAt: 0, lastOffsetNs: NaN, meanPathDelayNs: NaN, delayAt: 0 };
      this.domains.set(d, s);
    }
    return s;
  }

  count(domain, type, at) {
    const k = `${domain}:${type}`;
    const a = this.counts.get(k) ?? [];
    a.push(at); while (a.length && at - a[0] > 10000) a.shift();
    this.counts.set(k, a);
  }

  /** Local clock as PTP time (ns) for the domain's UTC offset. */
  localPtp(rxUtcNs, d) {
    const best = this.best(d);
    const off = best && best.utcOffsetValid ? best.currentUtcOffset : this.taiMinusUtc(Number(rxUtcNs / 1_000_000n));
    return rxUtcNs + BigInt(off) * 1_000_000_000n;
  }

  onPacket(buf, rinfo, rxUtcNs) {
    const m = parsePtp(buf);
    if (!m) return;
    const at = Number(rxUtcNs / 1_000_000n);
    this.count(m.domain, m.type, at);
    const d = this.domain(m.domain);
    const src = `${m.clockIdentity}-${m.portNumber}`;
    if (m.type === MSG.ANNOUNCE) {
      d.announces.set(src, { ...m, address: rinfo?.address, at });
    } else if (m.type === MSG.SYNC) {
      const s = { seq: m.sequenceId, rx: rxUtcNs, at, twoStep: m.twoStep, corr: m.correctionNs, origin: m.timestampNs };
      d.syncs.set(src, s);
      if (!m.twoStep) this.offset(m.domain, d, s, m.timestampNs, 0);
      else {
        // Sync (port 319) and Follow_Up (port 320) arrive on different sockets: either order
        const fu = d.fus.get(src);
        if (fu && fu.seq === m.sequenceId) this.offset(m.domain, d, s, fu.ts, fu.corr);
      }
    } else if (m.type === MSG.FOLLOW_UP) {
      const s = d.syncs.get(src);
      if (s && s.seq === m.sequenceId) this.offset(m.domain, d, s, m.timestampNs, m.correctionNs);
      else d.fus.set(src, { seq: m.sequenceId, ts: m.timestampNs, corr: m.correctionNs });
    } else if (m.type === MSG.DELAY_RESP) {
      if (m.requestingClockIdentity !== this.ourId) return;
      const req = this.pendingReq.get(m.sequenceId);
      if (!req || !d.t1) return;
      this.pendingReq.delete(m.sequenceId);
      // IEEE 1588 delay request-response: mpd = ((t2 − t1) + (t4 − t3)) / 2, corrections subtracted
      const t3 = this.localPtp(req.tx, m.domain);
      const mpd = (Number(d.t2 - d.t1) - d.corr + Number(m.timestampNs - t3) - m.correctionNs) / 2;
      if (Number.isFinite(mpd)) { d.delays.push(mpd); if (d.delays.length > 30) d.delays.shift(); d.meanPathDelayNs = median(d.delays); d.delayAt = at; }
    } else if (m.type === MSG.MANAGEMENT && m.sm) {
      d.sm = m.sm; d.smAt = at;
    }
  }

  offset(domainNo, d, s, originNs, fuCorr) {
    // differences in BigInt first: PTP times in ns exceed the 53-bit precision of a Number
    const t2 = this.localPtp(s.rx, domainNo);
    d.t1 = originNs; d.t2 = t2; d.corr = s.corr + fuCorr;
    // local − GM, still containing the one-way path delay (subtracted when measured)
    const raw = Number(t2 - originNs) - d.corr;
    d.offsets.push({ at: s.at, raw });
    while (d.offsets.length && s.at - d.offsets[0].at > 60000) d.offsets.shift();
    d.lastOffsetNs = raw; d.lastSyncAt = s.at;
  }

  sendDelayReq() {
    const dom = this.activeDomain();
    if (dom === null || !this.eventSocket) return;
    const seq = (this.seq = (this.seq + 1) & 0xffff);
    const b = buildPtp({ type: MSG.DELAY_REQ, domain: dom, clockIdentity: this.ourId, portNumber: 1, sequenceId: seq, logMessageInterval: 0x7f, body: tsBytes(0n) });
    this.eventSocket.send(b, PTP_EVENT_PORT, PTP_PRIMARY, (e) => { if (!e) this.pendingReq.set(seq, { tx: this.now() }); });
    for (const k of this.pendingReq.keys()) if (((seq - k) & 0xffff) > 10) this.pendingReq.delete(k);
  }

  /** Best announce of a domain by the BMCA data set comparison (priority1, class, accuracy, variance, priority2, identity). */
  best(domainNo) {
    const d = this.domains.get(domainNo);
    if (!d) return null;
    const now = this.nowMs();
    const fresh = [...d.announces.values()].filter((a) => now - a.at < 3 * 1000 * Math.max(0.125, 2 ** a.logMessageInterval) + 500);
    fresh.sort((a, b) => a.priority1 - b.priority1 || a.clockClass - b.clockClass || a.clockAccuracy - b.clockAccuracy
      || a.offsetScaledLogVariance - b.offsetScaledLogVariance || a.priority2 - b.priority2 || (a.grandmasterIdentity < b.grandmasterIdentity ? -1 : 1));
    return fresh[0] ?? null;
  }

  /** Domain shown: 127 (ST 2059-2 default) if present, else the one with the most traffic. */
  activeDomain(prefer = 127) {
    if (this.domains.has(prefer) && this.best(prefer)) return prefer;
    let bestD = null, n = -1;
    for (const [dn, d] of this.domains) { const c = d.announces.size + d.syncs.size; if (c > n) { n = c; bestD = dn; } }
    return bestD;
  }

  rate(domain, type) {
    const a = this.counts.get(`${domain}:${type}`) ?? [];
    const now = this.nowMs();
    const recent = a.filter((t) => now - t <= 5000);
    return recent.length / 5;
  }

  status(prefer = 127) {
    const now = this.nowMs();
    const base = { running: this.running, error: this.error, since: this.started, delayReq: this.delayReq, iface: this.iface, estimate: 'software' };
    const dn = this.activeDomain(prefer);
    const domains = [...this.domains.keys()].sort((a, b) => a - b);
    if (dn === null) return { ...base, state: this.error ? 'error' : 'none', domains };
    const d = this.domains.get(dn);
    const a = this.best(dn);
    const syncFresh = now - d.lastSyncAt < 2000;
    const recent = d.offsets.filter((o) => now - o.at < 10000).map((o) => o.raw);
    const mpd = now - d.delayAt < 10000 ? d.meanPathDelayNs : NaN;
    const med = median(recent);
    const off = Number.isFinite(mpd) ? med - mpd : med;
    const jitter = recent.length > 1 ? Math.sqrt(recent.reduce((s, v) => s + (v - med) ** 2, 0) / (recent.length - 1)) : NaN;
    const smFresh = d.sm && now - d.smAt < 5000 ? d.sm : null;
    const history = [];
    for (let t = now - 60000; t < now; t += 1000) {
      const bucket = d.offsets.filter((o) => o.at >= t && o.at < t + 1000).map((o) => o.raw);
      history.push(bucket.length ? median(bucket) - (Number.isFinite(mpd) ? mpd : 0) : null);
    }
    return {
      ...base,
      state: a && syncFresh ? 'receiving' : a ? 'announce' : syncFresh ? 'sync-only' : 'stale',
      domain: dn, domains,
      gm: a ? {
        identity: clockIdText(a.grandmasterIdentity), clockClass: a.clockClass, clockAccuracy: a.clockAccuracy, variance: a.offsetScaledLogVariance,
        priority1: a.priority1, priority2: a.priority2, stepsRemoved: a.stepsRemoved, timeSource: TIME_SOURCES[a.timeSource] ?? `0x${a.timeSource.toString(16)}`,
        currentUtcOffset: a.currentUtcOffset, utcOffsetValid: a.utcOffsetValid, ptpTimescale: a.ptpTimescale, timeTraceable: a.timeTraceable,
        leader: `${clockIdText(a.clockIdentity)}/${a.portNumber}`, address: a.address, logAnnounceInterval: a.logMessageInterval,
      } : null,
      leaders: [...d.announces.values()].filter((x) => now - x.at < 10000).length,
      twoStep: [...d.syncs.values()].some((s) => s.twoStep),
      rates: { announce: this.rate(dn, MSG.ANNOUNCE), sync: this.rate(dn, MSG.SYNC), followUp: this.rate(dn, MSG.FOLLOW_UP), management: this.rate(dn, MSG.MANAGEMENT), delayResp: this.rate(dn, MSG.DELAY_RESP) },
      /** local clock − GM in ns: median of 10 s, minus the mean path delay when measured */
      offsetNs: Number.isFinite(off) ? off : null, jitterNs: Number.isFinite(jitter) ? jitter : null,
      meanPathDelayNs: Number.isFinite(mpd) ? mpd : null, pathDelayIncluded: !Number.isFinite(mpd),
      history,
      sm: smFresh ? { ...smFresh, lockingText: LOCKING_STATUS[smFresh.gmLockingStatus] ?? String(smFresh.gmLockingStatus) } : null,
    };
  }
}

export function errorText(e, port) {
  if (e?.code === 'EACCES' || e?.code === 'EPERM') return `Port ${port}: keine Berechtigung (Ports unter 1024 brauchen unter Linux root oder CAP_NET_BIND_SERVICE; unter macOS nur mit Bindung an 0.0.0.0)`;
  if (e?.code === 'EADDRINUSE') return `Port ${port} ist belegt (läuft bereits ein PTP-Dienst wie ptp4l ohne SO_REUSEADDR?)`;
  if (e?.code === 'EADDRNOTAVAIL' || e?.code === 'ENODEV') return `Multicast ${PTP_PRIMARY} auf dieser Schnittstelle nicht möglich (${e.code})`;
  return `PTP: ${e?.message ?? e}`;
}

/** IPv4 interfaces for the multicast join. */
export function ipv4Interfaces() {
  const out = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  return out;
}

// ---- ST 2110 RTP timestamps

/** RFC 3550 §5.1 fixed header. */
export function parseRtp(b) {
  if (!Buffer.isBuffer(b) || b.length < 12 || b[0] >> 6 !== 2) return null;
  return { marker: !!(b[1] & 0x80), payloadType: b[1] & 0x7f, seq: b.readUInt16BE(2), timestamp: b.readUInt32BE(4), ssrc: b.readUInt32BE(8) };
}

export const RTP_VIDEO_CLOCK = 90000; // ST 2110-20 §6.1.3
const TWO32 = 2 ** 32;

/**
 * Compare an RTP timestamp with the PTP time of its arrival (ST 2110-10 §7.3: offset zero at
 * the epoch). Returns the arrival lag (receive time − RTP time) and the deviation of the
 * timestamp from the frame grid floor(n × 90000 × den / num) (§7.6.1/7.6.4).
 */
export function rtpCheck(ts, rxPtpSeconds, rateNum, rateDen, clock = RTP_VIDEO_CLOCK) {
  const nowTicks = rxPtpSeconds * clock;
  // unwrap: the full timestamp closest to (and normally just before) the arrival time
  const base = Math.floor(nowTicks / TWO32) * TWO32;
  let full = base + ts;
  if (full - nowTicks > TWO32 / 2) full -= TWO32; else if (nowTicks - full > TWO32 / 2) full += TWO32;
  const lagTicks = nowTicks - full;
  const n = Math.round((full * rateNum) / (clock * rateDen));
  const grid = Math.floor((n * clock * rateDen) / rateNum);
  return { lagSeconds: lagTicks / clock, lagFrames: (lagTicks / clock) * (rateNum / rateDen), frame: n, gridTicks: full - grid };
}

/** Joins an ST 2110 multicast group and evaluates the first packet of every frame. */
export class RtpMonitor {
  constructor({ group, port, iface = '', rateNum = 25, rateDen = 1, ptpNow }) {
    Object.assign(this, { group, port, iface, rateNum, rateDen, ptpNow });
    this.lastTs = -1; this.samples = []; this.packets = 0; this.error = ''; this.socket = null; this.pt = null;
  }
  start() {
    const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    s.on('error', (e) => { this.error = errorText(e, this.port); });
    s.bind({ port: this.port, address: '0.0.0.0', exclusive: false }, () => {
      try { s.addMembership(this.group, this.iface || undefined); } catch (e) { this.error = errorText(e, this.port); }
    });
    s.on('message', (b) => this.onPacket(b, this.ptpNow()));
    this.socket = s;
    return this;
  }
  stop() { try { this.socket?.close(); } catch { /* */ } this.socket = null; }
  onPacket(b, rxPtpSeconds) {
    const r = parseRtp(b);
    if (!r) return;
    this.packets++; this.pt = r.payloadType;
    if (r.timestamp === this.lastTs) return;
    this.lastTs = r.timestamp;
    if (rxPtpSeconds === null) return;
    this.samples.push({ at: Date.now(), ...rtpCheck(r.timestamp, rxPtpSeconds, this.rateNum, this.rateDen) });
    while (this.samples.length > 600) this.samples.shift();
  }
  status() {
    const now = Date.now();
    const recent = this.samples.filter((s) => now - s.at < 2000);
    return {
      group: this.group, port: this.port, error: this.error, packets: this.packets, payloadType: this.pt, frames: recent.length,
      lagMs: recent.length ? median(recent.map((s) => s.lagSeconds)) * 1000 : null,
      lagFrames: recent.length ? median(recent.map((s) => s.lagFrames)) : null,
      gridTicks: recent.length ? median(recent.map((s) => s.gridTicks)) : null,
    };
  }
}

export const isMulticastV4 = (a) => /^(22[4-9]|23\d)\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a ?? '') && a.split('.').every((x) => Number(x) <= 255);
