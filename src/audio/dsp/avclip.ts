// A/V offset of a recorded clip (#153): someone films the test pattern “A/V-Sync” while the
// generator “A/V-Sync-Piep” runs (e.g. with a phone) and drops the file in. Offline the whole
// clip is known, so the picture's mean luma is normalised to its own min/max first (a phone
// sees the monitor only as part of the frame, the flash may move the mean by a few per cent);
// then frames and sound run through the live meter (AvSyncMeter: same detectors, same
// BT.1359 sign: positive = sound advanced = sound early).

import { AvSyncMeter } from './avsync';

export interface ClipFrame { t: number; y: number }
export type ClipVerdict = 'early' | 'late' | 'sync';
export interface ClipResult {
  /** frame rate from the median frame interval (null with fewer than 2 frames) */
  fps: number | null;
  frameMs: number | null;
  /** median offset in ms, BT.1359 sign (null without a flash/beep pair) */
  offsetMs: number | null;
  /** offset in frames of the clip */
  frames: number | null;
  verdict: ClipVerdict | null;
  pairs: number;
  flashes: number;
  beeps: number;
  /** spread of the pairs (max − min) in ms */
  spreadMs: number | null;
}

/** Analyse a clip: frames with presentation time (s) and mean luma, audio channels starting at t = 0. */
export function analyzeClip(frames: ClipFrame[], audio: Float32Array[], fs: number): ClipResult {
  const m = new AvSyncMeter(fs);
  const fr = frames.filter((f) => Number.isFinite(f.t) && Number.isFinite(f.y)).sort((a, b) => a.t - b.t);
  let lo = Infinity, hi = -Infinity;
  for (const f of fr) { if (f.y < lo) lo = f.y; if (f.y > hi) hi = f.y; }
  const span = hi - lo > 1e-6 ? hi - lo : 1;
  // interleave picture and sound in time order (the meter pairs as it goes)
  const n = audio[0]?.length ?? 0, chunk = 1024;
  let fi = 0;
  for (let i = 0; i < n || fi < fr.length; i += chunk) {
    const tEnd = (i + chunk) / fs;
    while (fi < fr.length && (fr[fi].t < tEnd || i >= n)) { m.pushVideo(fr[fi].t, (fr[fi].y - lo) / span); fi++; }
    if (i < n) { const len = Math.min(chunk, n - i); m.pushAudio(audio.map((c) => c.subarray(i, i + len)), len, i / fs); }
  }
  const r = m.result(1000);
  const dts: number[] = [];
  for (let i = 1; i < fr.length; i++) { const d = fr[i].t - fr[i - 1].t; if (d > 0) dts.push(d); }
  dts.sort((a, b) => a - b);
  const frameMs = dts.length ? dts[dts.length >> 1] * 1000 : null;
  const fps = frameMs ? Math.round((1000 / frameMs) * 100) / 100 : null;
  const off = r.medianMs;
  const inFrames = off !== null && frameMs ? off / frameMs : null;
  return {
    fps, frameMs, offsetMs: off, frames: inFrames,
    verdict: inFrames === null ? null : Math.abs(inFrames) < 0.5 ? 'sync' : inFrames > 0 ? 'early' : 'late',
    pairs: r.pairs.length, flashes: r.flashes, beeps: r.beeps,
    spreadMs: r.minMs !== null && r.maxMs !== null ? r.maxMs - r.minMs : null,
  };
}
