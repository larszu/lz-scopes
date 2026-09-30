// Latency measurement (#16) with stamped test pictures (server/stamp.mjs,
// scripts/latency-source.mjs): source clock → bridge → app arrival → drawn.
// All differences use wall clocks: valid when source, bridge and app share one clock
// (same computer) or are NTP-synchronised; otherwise only the bridge → app part without
// the source is meaningful, and even that only on one computer.

import { stampAge } from '../server/stamp.mjs';
import type { FrameMeta } from './frameLink';

export interface LatencySummary {
  /** stamp → drawn (next animation frame after arrival), ms */
  total: Stat;
  /** stamp → frame left ffmpeg in the bridge */
  toBridge: Stat | null;
  /** bridge → arrived in the app (incl. H.264 decode) */
  bridgeToApp: Stat | null;
  decode: Stat | null;
  frames: number;
}
export interface Stat { mean: number; min: number; max: number }

const WINDOW_MS = 2000;

export function stat(v: number[]): Stat | null {
  if (!v.length) return null;
  let s = 0, lo = Infinity, hi = -Infinity;
  for (const x of v) { s += x; lo = Math.min(lo, x); hi = Math.max(hi, x); }
  return { mean: s / v.length, min: lo, max: hi };
}

export class LatencyMeter {
  private rows: { t: number; total: number; toBridge: number; bridgeToApp: number; decode: number }[] = [];
  /** last frame's stamp (a frame counted once even if drawn twice) */
  private lastStamp: number | null = null;

  /** A frame arrived; its latency is closed at the next animation frame (when it gets drawn). */
  onFrame(meta: FrameMeta | undefined) {
    if (!meta || meta.stamp === null || meta.stamp === this.lastStamp) return;
    const stamp = meta.stamp;
    this.lastStamp = stamp;
    const done = () => {
      const now = Date.now();
      const bridgeOk = Number.isFinite(meta.bridge);
      this.rows.push({
        t: now,
        total: stampAge(stamp, now),
        toBridge: bridgeOk ? stampAge(stamp, meta.bridge) : NaN,
        bridgeToApp: bridgeOk ? meta.arrive - meta.bridge : NaN,
        decode: meta.decodeMs ?? NaN,
      });
      while (this.rows.length && now - this.rows[0].t > WINDOW_MS) this.rows.shift();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done); else done();
  }

  /** Mean/min/max of the last 2 s, null without stamped frames. */
  summary(now = Date.now()): LatencySummary | null {
    const r = this.rows.filter((x) => now - x.t <= WINDOW_MS);
    if (!r.length) return null;
    const col = (k: 'total' | 'toBridge' | 'bridgeToApp' | 'decode') => stat(r.map((x) => x[k]).filter(Number.isFinite));
    return { total: col('total')!, toBridge: col('toBridge'), bridgeToApp: col('bridgeToApp'), decode: col('decode'), frames: r.length };
  }
}

/** Lines for the Messwerte panel. */
export function latencyLines(s: LatencySummary | null): string[] {
  if (!s) return [];
  const f = (x: Stat | null) => (x ? `${Math.round(x.mean)} ms (${Math.round(x.min)}–${Math.round(x.max)})` : '–');
  const lines = ['', `Latenz     Stempel → Anzeige ${f(s.total)}`];
  if (s.toBridge) lines.push(`           Quelle → Bridge ${f(s.toBridge)} · Bridge → App ${f(s.bridgeToApp)}`);
  if (s.decode) lines.push(`           davon H.264-Dekodierung ${f(s.decode)}`);
  lines.push('           (gleiche Uhr vorausgesetzt; ohne Monitor-Verzögerung)');
  return lines;
}
