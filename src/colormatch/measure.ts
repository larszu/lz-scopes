// Field evaluation of the camera colour match: four corners → homography → median per field,
// and ΔE per field against the target. Pure functions (test/colormatch-tool.test.ts).

import { GAMUTS, mul3, rgbToXyzMatrix, signalToLinear, xyzToLab } from '../color';
import { deltaE, type Space } from '../deltae';
import { homography, project, type Frame, type Pt } from '../led/analysis';
import type { Rgb } from '../match/core';
import type { ChartDef } from './charts';

export type Patches = (Rgb | null)[];

/** Median R′G′B′ of every field; corners TL, TR, BR, BL in picture pixels. */
export function measureChart(f: Frame, corners: Pt[], chart: ChartDef, inner = 0.5, grid = 7): Patches {
  if (corners.length !== 4) return chart.patches.map(() => null);
  const H = homography([[0, 0], [chart.width, 0], [chart.width, chart.height], [0, chart.height]], corners);
  const lo = (1 - inner) / 2;
  return chart.patches.map((p) => {
    const ch: number[][] = [[], [], []];
    for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
      const [x, y] = project(H, p.x + p.w * (lo + (inner * (i + 0.5)) / grid), p.y + p.h * (lo + (inner * (j + 0.5)) / grid));
      const xi = Math.floor(x), yi = Math.floor(y);
      if (xi < 0 || yi < 0 || xi >= f.width || yi >= f.height) continue;
      const o = (yi * f.width + xi) * 3;
      ch[0].push(f.rgb[o]); ch[1].push(f.rgb[o + 1]); ch[2].push(f.rgb[o + 2]);
    }
    return ch[0].length ? (ch.map(median) as Rgb) : null;
  });
}

function median(v: number[]) {
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Corners when none were set: the chart filling the picture with a 10 % margin. */
export const defaultCorners = (w: number, h: number): Pt[] => [[w * 0.1, h * 0.1], [w * 0.9, h * 0.1], [w * 0.9, h * 0.9], [w * 0.1, h * 0.9]];

/** ΔE per field (ΔE00 for SDR/log, ΔITP for PQ/HLG – deltae.ts), both in the same encoding. */
export function fieldDeltas(cam: Patches, target: Patches, space: Space): (number | null)[] {
  return cam.map((p, i) => { const q = target[i]; return p && q ? deltaE(space, p, q).value : null; });
}

export function summary(de: (number | null)[]) {
  const v = de.filter((x): x is number => x != null);
  return { mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN, max: v.length ? Math.max(...v) : NaN, n: v.length };
}

/** CIELAB of a signal (white = signal 1,1,1) – the residual space of the colour steps. */
export function labOf(space: Space): (c: number[]) => number[] {
  const M = rgbToXyzMatrix(GAMUTS[space.gamut]), white = mul3(M, [1, 1, 1]);
  return (c) => xyzToLab(mul3(M, signalToLinear(c, space.transfer, space.hlgLw)), white);
}
