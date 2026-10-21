import { describe, expect, it } from 'vitest';
import { fitMatrix, matchMatrix, patchMedians, suggestMatrix, type CameraPatches } from '../src/match/chart';
import { homography, invertHomography, project, type Frame, type Pt } from '../src/led/analysis';
import { linearToSignal, mul3, signalToLinear } from '../src/color';
import type { Space } from '../src/deltae';
import type { Rgb } from '../src/match/core';

const SP: Space = { transfer: 'sdr', gamut: '709', hlgLw: 1000 };
/** 24 distinct signal colours (not a measured ColorChecker, just spread over the cube). */
const PATCHES: Rgb[] = Array.from({ length: 24 }, (_, i) => [0.15 + 0.7 * ((i * 7) % 24) / 23, 0.15 + 0.7 * ((i * 11) % 24) / 23, 0.15 + 0.7 * ((i * 5) % 24) / 23]);
const CORNERS: Pt[] = [[60, 40], [330, 70], [320, 240], [50, 200]]; // perspective, not a rectangle

/** Chart drawn in perspective onto a grey frame; `tf` changes each patch colour (camera error). */
function chartFrame(tf: (c: Rgb) => number[] = (c) => c, noise = 0): Frame {
  const width = 400, height = 300, rgb = new Float32Array(width * height * 3).fill(0.3);
  const Hinv = invertHomography(homography([[0, 0], [6, 0], [6, 4], [0, 4]], CORNERS));
  let seed = 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [u, v] = project(Hinv, x + 0.5, y + 0.5);
    if (u < 0 || v < 0 || u >= 6 || v >= 4) continue;
    const c = tf(PATCHES[Math.floor(v) * 6 + Math.floor(u)]), o = (y * width + x) * 3;
    for (let k = 0; k < 3; k++) rgb[o + k] = c[k] + (Math.abs(rnd()) > 0.49 ? 1 : noise * rnd()); // a few hot pixels
  }
  return { width, height, rgb };
}

const M_ERR = [1.08, -0.05, 0.0, 0.02, 0.95, 0.03, -0.01, 0.04, 0.9];
const viaMatrix = (m: number[]) => (c: Rgb) => linearToSignal(mul3(m, signalToLinear(c, 'sdr')), 'sdr');

describe('colour chart match matrix', () => {
  it('reads every patch through a perspective homography, robust against hot pixels', () => {
    const p = patchMedians(chartFrame(), CORNERS);
    expect(p).toHaveLength(24);
    p.forEach((v, i) => v!.forEach((x, k) => expect(x).toBeCloseTo(PATCHES[i][k], 4)));
  });

  it('ΔE is 0 for the reference and large for a camera with a matrix error', () => {
    const ref: CameraPatches = { id: 'a', space: SP, patches: patchMedians(chartFrame(), CORNERS) };
    const cam: CameraPatches = { id: 'b', space: SP, patches: patchMedians(chartFrame(viaMatrix(M_ERR)), CORNERS) };
    const [ra, rb] = matchMatrix([ref, cam], 'a');
    expect(ra.max).toBeCloseTo(0, 6);
    expect(rb.mean!).toBeGreaterThan(2);
    expect(rb.de).toHaveLength(24);
  });

  it('least squares recovers a known 3×3 matrix', () => {
    const src = PATCHES.map((c) => signalToLinear(c, 'sdr'));
    const M = [0.9, 0.1, 0, 0.05, 1.1, -0.15, 0, -0.2, 1.2];
    const m = fitMatrix(src, src.map((c) => mul3(M, c)))!;
    m.forEach((v, i) => expect(v).toBeCloseTo(M[i], 6));
    expect(fitMatrix([[1, 1, 1], [2, 2, 2], [3, 3, 3]], [[1, 1, 1], [2, 2, 2], [3, 3, 3]])).toBeNull();
  });

  it('suggestion undoes the camera error measured from noisy frames', () => {
    const ref: CameraPatches = { id: 'a', space: SP, patches: patchMedians(chartFrame(), CORNERS) };
    const cam: CameraPatches = { id: 'b', space: SP, patches: patchMedians(chartFrame(viaMatrix(M_ERR), 0.01), CORNERS) };
    const s = suggestMatrix(cam, ref)!;
    expect(s.before).toBeGreaterThan(2);
    expect(s.after).toBeLessThan(0.5);
  });
});
