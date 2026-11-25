// Packet timing of ST 2110 flows: ST 2110-21 sender models (CINST against CMAX, VRX against
// VRXFULL), the RP 2110-25 style values per frame (RTP offset, first packet margin, path delay)
// and per-flow statistics (IAT, rates, burstiness, RTP errors), each as mean and min/max.
//
// SMPTE ST 2110-21:2022 (free, pub.smpte.org), opened for this:
// - §6.2 TVD = N·TFRAME + TROFFSET; TPR0 = TVD; TPRj = TVD + j·TRS (gapped progressive, §6.3.2).
// - §6.3.2 progressive: RACTIVE = 1080/1125, TRS = TFRAME·RACTIVE/NPACKETS,
//   TRODEFAULT = 43/1125·TFRAME (height ≥ 1080) or 28/750·TFRAME (below).
// - §6.3.3 Table 1 interlaced/PsF: RACTIVE = HEIGHT/total, TRODEFAULT = INT((total − HEIGHT)/2)/total·TFRAME,
//   second half of the packets read from TFRAME/2 + TLINE/2, TLINE = TFRAME/total (525, 625, 1125 lines).
// - §6.4 linear: TRS = TFRAME/NPACKETS, TRODEFAULT as gapped.
// - §6.6.1 network compatibility model: bucket drains one packet every TDRAIN = TFRAME/NPACKETS/β,
//   at instants k·TDRAIN since the SMPTE epoch; CINST must never exceed CMAX.
// - §6.6.2 virtual receiver buffer: fills on arrival, drains packet j at TPRj; must neither overflow
//   VRXFULL nor underflow (packet j arrives by TPRj).
// - §7.1.2–7.1.4 (β = 1.10, MAXUDP = 1500 for the standard limit … see vrxFull()):
//   N:  VRXFULL = MAX(INT(1500·8/MAXUDP), INT(NPACKETS/(27000·TFRAME))), CMAX = MAX(4, INT(NPACKETS/(43200·RACTIVE·TFRAME)))
//   NL: VRXFULL as N, CMAX = MAX(4, INT(NPACKETS/(43200·TFRAME)))
//   W:  VRXFULL = MAX(INT(1500·720/MAXUDP), INT(NPACKETS/(300·TFRAME))), CMAX = MAX(16, INT(NPACKETS/(21600·TFRAME)))
// RP 2110-25 itself was not opened (not free); the three per-frame values follow the names in
// issue #229 and are defined in docs/research/st2110-netz.md.
//
// Time stamps: the caller passes arrival times in seconds relative to `epochSec`, an integer TAI
// second. With software time stamps (Node, see receiver.mjs) all values are coarse estimates and
// are reported with `timestamps: 'software'`.

export const BETA = 1.1;

/** Total lines of the system the picture comes from (ST 2110-21 Table 1). */
const systemLines = (height) => (height <= 486 ? 525 : height <= 576 ? 625 : 1125);

/** ST 2110-21 model constants for a video flow. */
export function model({ rate, height, interlace = false, tp = '2110TPN', npackets, troffUs = null, maxUdp = 1460 }) {
  const T = rate.den / rate.num;
  const total = systemLines(height);
  const linear = tp === '2110TPNL' || tp === '2110TPW';
  const rActive = interlace ? height / total : 1080 / 1125;
  const troDefault = interlace ? (Math.floor((total - height) / 2) / total) * T : (height >= 1080 ? 43 / 1125 : 28 / 750) * T;
  const troffset = troffUs !== null && Number.isFinite(troffUs) ? troffUs / 1e6 : troDefault;
  const trs = linear ? T / npackets : (T * rActive) / npackets;
  const tline = T / total;
  const maxUdpModel = maxUdp <= 1460 ? 1500 : maxUdp; // §7.1.2: 1500 when the Standard UDP Size Limit is in use
  const vrxFull = tp === '2110TPW'
    ? Math.max(Math.floor((1500 * 720) / maxUdpModel), Math.floor(npackets / (300 * T)))
    : Math.max(Math.floor((1500 * 8) / maxUdpModel), Math.floor(npackets / (27000 * T)));
  const cmax = tp === '2110TPW' ? Math.max(16, Math.floor(npackets / (21600 * T)))
    : tp === '2110TPNL' ? Math.max(4, Math.floor(npackets / (43200 * T)))
      : Math.max(4, Math.floor(npackets / (43200 * rActive * T)));
  const tdrain = T / npackets / BETA;
  /** read time of packet j relative to TVD */
  const tpr = (j) => (interlace && !linear && j >= npackets / 2 ? T / 2 + tline / 2 + (j - npackets / 2) * trs : j * trs);
  return { T, rActive, troDefault, troffset, trs, tline, vrxFull, cmax, tdrain, tpr, linear, total };
}

const TWO32 = 2 ** 32;

/** Running mean/min/max. */
class Agg {
  constructor() { this.n = 0; this.sum = 0; this.min = Infinity; this.max = -Infinity; }
  add(v) { if (!Number.isFinite(v)) return; this.n++; this.sum += v; if (v < this.min) this.min = v; if (v > this.max) this.max = v; }
  out(scale = 1, digits = 2) {
    const r = (v) => Math.round(v * scale * 10 ** digits) / 10 ** digits;
    return this.n ? { mean: r(this.sum / this.n), min: r(this.min), max: r(this.max), n: this.n } : null;
  }
}

/**
 * Per-flow statistics for any RTP flow (video, audio, anc): IAT, packet and bit rate, burstiness,
 * sequence errors. Video flows add the ST 2110-21 models (VideoTiming below).
 */
export class FlowStats {
  constructor({ epochSec = 0, historySeconds = 60 } = {}) {
    this.epochSec = epochSec; this.historySeconds = historySeconds;
    this.packets = 0; this.bytes = 0; this.lost = 0; this.reordered = 0; this.duplicates = 0;
    this.lastSeq = null; this.lastAt = null; this.iat = new Agg(); this.iatSec = new Agg();
    this.sec = null; this.secPackets = 0; this.secBytes = 0; this.secLost = 0; this.bins = new Map();
    this.history = []; this.rateAgg = new Agg(); this.bitAgg = new Agg(); this.burst = new Agg();
    this.seen = new Set();
  }
  /** `t` arrival (s, relative to epochSec), `rtp` { seq, ts, marker }, `bytes` UDP payload size. */
  packet(t, rtp, bytes) {
    this.packets++; this.bytes += bytes;
    const s = Math.floor(t);
    if (this.sec === null) this.sec = s;
    if (s !== this.sec) this.closeSecond(s);
    this.secPackets++; this.secBytes += bytes;
    // 1 ms bins for burstiness (packets per ms, mean against maximum)
    const bin = Math.floor(t * 1000);
    this.bins.set(bin, (this.bins.get(bin) ?? 0) + 1);
    if (this.lastAt !== null) { const d = (t - this.lastAt) * 1e6; this.iat.add(d); this.iatSec.add(d); }
    this.lastAt = t;
    if (this.lastSeq !== null) {
      const d = ((rtp.seq - this.lastSeq + 0x18000) % 0x10000) - 0x8000;
      if (d === 0 || (d < 0 && this.seen.has(rtp.seq))) this.duplicates++;
      else if (d < 0) { this.reordered++; this.lost = Math.max(0, this.lost - 1); this.secLost = Math.max(0, this.secLost - 1); }
      else if (d > 1) { this.lost += d - 1; this.secLost += d - 1; }
      if (d > 0) this.lastSeq = rtp.seq;
    } else this.lastSeq = rtp.seq;
    this.seen.add(rtp.seq); if (this.seen.size > 4096) this.seen = new Set([rtp.seq]);
  }
  closeSecond(next) {
    const counts = [...this.bins.values()];
    const mean = this.secPackets / 1000, peak = counts.length ? Math.max(...counts) : 0;
    const entry = { t: this.sec, packets: this.secPackets, bits: this.secBytes * 8, lost: this.secLost, iatMaxUs: this.iatSec.n ? Math.round(this.iatSec.max * 10) / 10 : null, burst: mean > 0 ? Math.round((peak / mean) * 100) / 100 : null, ...this.secondExtra() };
    this.history.push(entry); while (this.history.length > this.historySeconds) this.history.shift();
    this.rateAgg.add(this.secPackets); this.bitAgg.add(this.secBytes * 8);
    if (mean > 0) this.burst.add(peak / mean);
    this.sec = next; this.secPackets = 0; this.secBytes = 0; this.secLost = 0; this.bins = new Map(); this.iatSec = new Agg();
  }
  secondExtra() { return {}; }
  status() {
    return {
      timestamps: 'software', packets: this.packets, bytes: this.bytes, lost: this.lost, reordered: this.reordered, duplicates: this.duplicates,
      iatUs: this.iat.out(), packetRate: this.rateAgg.out(1, 0), bitRate: this.bitAgg.out(1, 0), burstiness: this.burst.out(),
      // DSCP and TTL sit in the IP header; Node's UDP sockets do not hand them out (no IP_RECVTOS/IP_RECVTTL)
      dscp: null, ttl: null, history: this.history,
    };
  }
}

/**
 * ST 2110-21 / RP 2110-25 analysis of a 2110-20 flow. `fmt` from the SDP: { rate, height, interlace,
 * tp, troffUs, maxUdp }. NPACKETS is learned from the flow (packets per frame, the most frequent count).
 */
export class VideoTiming extends FlowStats {
  constructor(fmt, opts = {}) {
    super(opts);
    this.fmt = fmt;
    this.cur = null; // current frame: { n, arrivals: [], first }
    this.npackets = 0;
    this.cinst = { bucket: 0, lastIdx: null, max: 0, secMax: 0 };
    this.frameAgg = { cinst: new Agg(), vrx: new Agg(), vrxAdj: new Agg(), late: 0, rtpOffsetUs: new Agg(), fpMarginUs: new Agg(), pathUs: new Agg(), frames: 0, markerMissing: 0 };
    this.secVrx = -Infinity; this.secLate = 0;
    // epoch helpers in BigInt: frames and RTP ticks at epochSec
    this.epochTicks = Number((BigInt(this.epochSec) * 90000n) % BigInt(TWO32));
  }
  /** Time (s, relative to epochSec) of the alignment point N·TFRAME. */
  alignTime(n) {
    const { num, den } = this.fmt.rate;
    return Number(BigInt(n) * BigInt(den) - BigInt(this.epochSec) * BigInt(num)) / num;
  }
  /** RTP time stamp → its time (s, relative to epochSec), unwrapped around the arrival `t`. */
  rtpTime(ts, t) {
    const expected = (this.epochTicks + t * 90000) % TWO32;
    let d = ts - expected;
    if (d > TWO32 / 2) d -= TWO32; else if (d < -TWO32 / 2) d += TWO32;
    return t + d / 90000;
  }
  /** Frame index N of a time (s, relative). */
  frameIndex(rel) {
    const { num, den } = this.fmt.rate;
    // N = floor((epochSec + rel)·num/den): integer part in BigInt, the fraction from `rel`
    const whole = BigInt(this.epochSec) * BigInt(num);
    return Number((whole + BigInt(Math.floor(rel * num))) / BigInt(den));
  }
  packet(t, rtp, bytes) {
    super.packet(t, rtp, bytes);
    // network compatibility model: drains at k·TDRAIN from epochSec (phase error < one TDRAIN)
    if (this.npackets) {
      const m = this.model ?? (this.model = model({ ...this.fmt, npackets: this.npackets }));
      const idx = Math.floor(t / m.tdrain);
      const c = this.cinst;
      if (c.lastIdx !== null) c.bucket = Math.max(0, c.bucket - (idx - c.lastIdx));
      c.lastIdx = idx; c.bucket++;
      if (c.bucket > c.max) c.max = c.bucket;
      if (c.bucket > c.secMax) c.secMax = c.bucket;
    }
    const rt = this.rtpTime(rtp.ts, t);
    // both fields of an interlaced frame map to the same N (the second field is TFRAME/2 later);
    // the time stamp is truncated to the 90 kHz grid (ST 2110-10), so add two ticks before flooring
    const n = this.frameIndex(rt + 2 / 90000);
    if (!this.cur || n !== this.cur.n) {
      if (this.cur) this.closeFrame(false);
      this.cur = { n, arrivals: [], rtpTime: rt, sawMarker: false };
    }
    this.cur.arrivals.push(t);
    if (rtp.marker) {
      this.cur.sawMarker = true;
      if (!this.fmt.interlace || this.cur.markers === 1) this.closeFrame(true);
      else this.cur.markers = 1;
    }
  }
  closeFrame(withMarker) {
    const f = this.cur; this.cur = null;
    if (!f || !f.arrivals.length) return;
    if (!withMarker && !f.sawMarker) this.frameAgg.markerMissing++;
    const count = f.arrivals.length;
    // NPACKETS: the first complete frame sets it, later ones only when the count stays stable
    if (withMarker && (!this.npackets || (count !== this.npackets && this.lastCount === count))) { this.npackets = count; this.model = null; }
    this.lastCount = count;
    if (!this.npackets || !withMarker) return;
    const m = this.model ?? (this.model = model({ ...this.fmt, npackets: this.npackets }));
    const align = this.alignTime(f.n);
    const tvd = align + m.troffset;
    // virtual receiver buffer against TPRj (signalled/default TROFFSET) and with the drain start
    // moved to the latest arrival that avoids an underflow (the buffer a receiver really needs)
    let late = 0, peak = 0, lead = -Infinity;
    for (let j = 0; j < count; j++) lead = Math.max(lead, f.arrivals[j] - m.tpr(j));
    const vrxAt = (start) => {
      let drained = 0, max = 0, under = 0;
      for (let j = 0; j < count; j++) {
        const a = f.arrivals[j];
        while (drained < count && start + m.tpr(drained) < a) drained++;
        if (drained > j) under++;
        max = Math.max(max, j + 1 - Math.min(drained, j + 1));
      }
      return { max, under };
    };
    const sig = vrxAt(tvd); peak = sig.max; late = sig.under;
    const adj = vrxAt(lead);
    this.frameAgg.vrx.add(peak); this.frameAgg.vrxAdj.add(adj.max); this.frameAgg.late += late; this.secLate += late;
    this.secVrx = Math.max(this.secVrx, peak);
    this.frameAgg.cinst.add(this.cinst.secMax);
    this.frameAgg.rtpOffsetUs.add((f.rtpTime - align) * 1e6);
    this.frameAgg.fpMarginUs.add((tvd - f.arrivals[0]) * 1e6);
    this.frameAgg.pathUs.add((f.arrivals[0] - f.rtpTime) * 1e6);
    this.frameAgg.frames++;
  }
  secondExtra() {
    const out = { cinstMax: this.cinst.secMax, vrxMax: Number.isFinite(this.secVrx) ? this.secVrx : null, late: this.secLate };
    this.cinst.secMax = 0; this.secVrx = -Infinity; this.secLate = 0;
    return out;
  }
  status() {
    const m = this.npackets ? (this.model ?? model({ ...this.fmt, npackets: this.npackets })) : null;
    const a = this.frameAgg;
    return {
      ...super.status(),
      npackets: this.npackets || null, tp: this.fmt.tp || null,
      model: m ? { cmax: this.fmt.cmax ?? m.cmax, vrxFull: m.vrxFull, troffsetUs: Math.round(m.troffset * 1e7) / 10, trsNs: Math.round(m.trs * 1e9), tdrainNs: Math.round(m.tdrain * 1e9), rActive: m.rActive } : null,
      cinst: { max: this.cinst.max, perSecond: a.cinst.out() },
      vrx: a.vrx.out(), vrxAdjusted: a.vrxAdj.out(), latePackets: a.late,
      rtpOffsetUs: a.rtpOffsetUs.out(), firstPacketMarginUs: a.fpMarginUs.out(), pathDelayUs: a.pathUs.out(),
      frames: a.frames, markerMissing: a.markerMissing,
      verdict: m ? {
        cinst: this.cinst.max <= (this.fmt.cmax ?? m.cmax),
        vrx: (a.vrx.out()?.max ?? 0) <= m.vrxFull && a.late === 0,
      } : null,
    };
  }
}
