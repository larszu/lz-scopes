// Performance test, bridge part (#245): what one picture costs ffmpeg on this computer. The
// same work as a DeckLink/AJA stream (server/helper-input.mjs): 10-bit 4:2:2 in, area scaling to
// the analysis width (field by field for interlaced), R′G′B′ out. The source is ffmpeg's own test
// signal; its generation is measured separately (generateMs) and included in every case, so the
// figures are an upper bound.

import { spawn } from 'node:child_process';

const run = (ffmpeg, args) => new Promise((ok, fail) => {
  const t0 = process.hrtime.bigint();
  const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => { err = (err + d).slice(-500); });
  p.on('error', fail);
  p.on('close', (code) => (code === 0 ? ok(Number(process.hrtime.bigint() - t0) / 1e6) : fail(new Error(err.trim() || `ffmpeg ${code}`))));
});

/** Cases: [label, output width (0 = native), bit depth]. */
export const BENCH_CASES = [['960 px · 8 bit', 960, 8], ['960 px · 16 bit', 960, 16], ['1920 px · 8 bit', 0, 8], ['1920 px · 16 bit', 0, 16]];

/**
 * ms per picture for each case at 1920×1080i50, 10-bit 4:2:2 in.
 * @returns {Promise<{ frames: number; generateMs: number; cases: { label: string; width: number; depth: number; msPerFrame: number }[] }>}
 */
export async function benchFfmpeg(ffmpeg, { frames = 100, threads = 1 } = {}) {
  const src = ['-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=50,format=yuv422p10le,setfield=tff`, '-frames:v', String(frames)];
  // best of two: a background task on the computer should not decide the result
  const best = async (args) => Math.min(await run(ffmpeg, args), await run(ffmpeg, args));
  const base = await best([...src, '-f', 'null', '-']);
  const cases = [];
  for (const [label, w, depth] of BENCH_CASES) {
    const size = w ? `scale=${w}:${Math.round((w * 1080) / 1920 / 2) * 2}` : 'scale=1920:1080';
    const vf = `${size}:flags=area:in_color_matrix=bt709:in_range=tv:interl=1:threads=${threads}`;
    const ms = await best([...src, '-vf', vf, '-pix_fmt', depth === 16 ? 'rgba64le' : 'rgba', '-threads', '1', '-f', 'null', '-']);
    // total per picture, test-signal generation included (conservative: a real input costs less)
    cases.push({ label, width: w || 1920, depth, msPerFrame: ms / frames });
  }
  return { frames, generateMs: base / frames, cases };
}
