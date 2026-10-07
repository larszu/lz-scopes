// Frame phase of a captured signal against the SMPTE ST 2059-1 frame grid (#72).
//
// ST 2059-1 aligns video frames to the SMPTE epoch (1970-01-01 00:00:00 TAI): frame n starts
// at n · fpsDen/fpsNum seconds of PTP time (see docs/research/clock-ptp.md). For every picture
// the bridge receives from a capture helper we take the arrival time on the PTP scale
// (clockNow(): system clock, corrected by the PTP offset estimate when the PTP monitor of the
// clock panel runs) and look where it falls inside the frame period.
//
// What this is and is not:
// - The arrival time contains the capture and transfer latency of card, driver and helper.
//   The absolute phase is therefore an upper bound and only comparable between runs on the
//   same machine.
// - What it shows reliably is *stability*: a signal locked to the same time base keeps its
//   phase (drift ≈ 0 ppm); a free-running or differently locked source drifts by its
//   frequency offset (e.g. 10 ppm = 10 µs per second).
// - Software timestamps scatter by roughly 0.1–1 ms; the circular standard deviation shows it.

/** Phase of time t (s) inside the frame period P (s), 0 ≤ φ < P. */
export function framePhaseSeconds(t, period) {
  const n = Math.floor(t / period);
  let ph = t - n * period;
  if (ph < 0) ph += period;
  if (ph >= period) ph -= period;
  return ph;
}

/** Circular mean and standard deviation of phases (s) in a period P (s). */
export function circularStats(phases, period) {
  if (!phases.length) return { mean: NaN, sd: NaN, r: 0 };
  let c = 0, s = 0;
  for (const p of phases) { const a = (2 * Math.PI * p) / period; c += Math.cos(a); s += Math.sin(a); }
  c /= phases.length; s /= phases.length;
  const r = Math.hypot(c, s);
  let a = Math.atan2(s, c);
  if (a < 0) a += 2 * Math.PI;
  // circular standard deviation sqrt(−2 ln R), as an angle → seconds
  const sd = r > 0 ? (Math.sqrt(Math.max(0, -2 * Math.log(r))) * period) / (2 * Math.PI) : Infinity;
  return { mean: (a * period) / (2 * Math.PI), sd, r };
}

/**
 * Theil–Sen slope (median of pairwise slopes; pairs at least `minDx` apart) – robust against
 * single late frames – with a standard error from the residuals around that line.
 */
export function robustSlope(xs, ys, minDx = 1) {
  const n = xs.length;
  if (n < 3) return { slope: NaN, se: NaN };
  const step = Math.max(1, Math.floor(n / 200));
  const ix = []; for (let i = 0; i < n; i += step) ix.push(i);
  const ks = [];
  for (let a = 0; a < ix.length; a++) for (let b = a + 1; b < ix.length; b++) {
    const dx = xs[ix[b]] - xs[ix[a]];
    if (dx >= minDx) ks.push((ys[ix[b]] - ys[ix[a]]) / dx);
  }
  if (!ks.length) return { slope: NaN, se: NaN };
  ks.sort((p, q) => p - q);
  const k = ks.length % 2 ? ks[ks.length >> 1] : (ks[ks.length / 2 - 1] + ks[ks.length / 2]) / 2;
  let mx = 0; for (const x of xs) mx += x; mx /= n;
  const res = xs.map((x, i) => ys[i] - k * x);
  let mr = 0; for (const r of res) mr += r; mr /= n;
  let ssr = 0, sxx = 0;
  for (let i = 0; i < n; i++) { ssr += (res[i] - mr) ** 2; sxx += (xs[i] - mx) ** 2; }
  return { slope: k, se: sxx > 0 ? Math.sqrt(ssr / (n - 2) / sxx) : NaN };
}

/** Collects arrival times and reports phase, scatter and drift over a sliding window. */
export class PhaseTracker {
  constructor(fpsNum, fpsDen, windowSeconds = 20) {
    this.period = fpsDen / fpsNum;
    this.window = windowSeconds;
    this.samples = []; // { t, ph } with ph unwrapped
    this.ref = 'system';
  }
  add(t, ref = 'system') {
    this.ref = ref;
    let ph = framePhaseSeconds(t, this.period);
    const last = this.samples.at(-1);
    if (last) {
      // unwrap: keep the step between successive samples within ±P/2
      const base = last.ph - framePhaseSeconds(last.ph, this.period);
      ph += base;
      while (ph - last.ph > this.period / 2) ph -= this.period;
      while (last.ph - ph > this.period / 2) ph += this.period;
    }
    this.samples.push({ t, ph });
    while (this.samples.length && t - this.samples[0].t > this.window) this.samples.shift();
  }
  /**
   * { periodMs, meanMs, sdMs, driftPpm, driftSePpm, jumps, n, spanS, ref } – null with fewer than
   * 10 samples; drift only after 2 s. `jumps` counts steps of more than a quarter frame between
   * successive pictures (dropped or repeated frames, resync of the source).
   */
  report() {
    const n = this.samples.length;
    if (n < 10) return null;
    const { mean, sd } = circularStats(this.samples.map((s) => framePhaseSeconds(s.ph, this.period)), this.period);
    const span = this.samples.at(-1).t - this.samples[0].t;
    const t0 = this.samples[0].t;
    const { slope: k, se } = robustSlope(this.samples.map((s) => s.t - t0), this.samples.map((s) => s.ph));
    let jumps = 0;
    for (let i = 1; i < n; i++) if (Math.abs(this.samples[i].ph - this.samples[i - 1].ph) > this.period / 4) jumps++;
    const ok = span >= 2 && Number.isFinite(k);
    return {
      periodMs: this.period * 1000, meanMs: mean * 1000, sdMs: sd * 1000,
      driftPpm: ok ? k * 1e6 : null, driftSePpm: ok && Number.isFinite(se) ? se * 1e6 : null, jumps, n, spanS: span, ref: this.ref,
    };
  }
}
