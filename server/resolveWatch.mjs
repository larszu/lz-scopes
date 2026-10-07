// Is the Resolve timeline playing? (#88)
//
// Measured with DaVinci Resolve Studio 21.1.1 on 07.10.2026 (docs/research/resolve-playback.md):
// while the timeline plays, every call of the external scripting API blocks – not only
// ExportCurrentFrameAsStill, also GetCurrentTimecode and GetProductName – and returns only once
// playback stops. The API has no "is playing" query (DaVinciResolveScript.pyi of 21.1). So the
// silence itself is the signal: resolve_helper.py prints one line per still (≈ every 1/fps s,
// one export took 7–16 ms in the test); no line for much longer than usual means "playing".
//
// A slow export (heavy grade, 4K noise reduction) also delays the line. Told apart afterwards:
// after real playback the time code has moved; after a slow export it has not. A slow export
// raises the threshold so the next one is not mistaken again.

const MIN_MS = 800;

/**
 * @param {{ fps?: number, minMs?: number }} [o] helper still rate
 * @returns {{
 *   line(now: number, tc?: string | null): null | { state: 'paused', played: boolean },
 *   check(now: number): null | { state: 'playing' },
 *   readonly playing: boolean, readonly thresholdMs: number,
 * }}
 */
export function createPlaybackWatch(o = {}) {
  const period = 1000 / Math.max(0.5, o.fps ?? 10);
  let threshold = Math.max(o.minMs ?? MIN_MS, 4 * period);
  let last = null; // time of the last line
  let lastTc = null;
  let playing = false;
  let tcAtBlock = null;
  return {
    get playing() { return playing; },
    get thresholdMs() { return threshold; },
    line(now, tc = null) {
      const gap = last == null ? 0 : now - last;
      last = now;
      let ev = null;
      if (playing) {
        playing = false;
        const played = tc != null && tcAtBlock != null && tc !== tcAtBlock;
        // not played: the export itself was slow – wait longer next time
        if (!played) threshold = Math.min(10000, Math.max(threshold, gap * 1.5));
        ev = { state: 'paused', played };
      }
      if (tc != null) lastTc = tc;
      return ev;
    },
    check(now) {
      if (playing || last == null || now - last < threshold) return null;
      playing = true;
      tcAtBlock = lastTc;
      return { state: 'playing' };
    },
  };
}
