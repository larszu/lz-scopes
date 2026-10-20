import { describe, expect, it } from 'vitest';
import { analyseShading, cellColour, cellDeviation, rampColour, shadingRows } from '../src/whiteShading';
import { channelPlanes } from '../src/noise';
import { rgbDecoder } from '../src/ycbcr';

const KR = 0.2126, KB = 0.0722;
/** White field 160 × 90 whose channels follow c0·(1 + sawH/2·x + sawV/2·y + parH·x² + parV·y²). */
function field(chan: Record<'R' | 'G' | 'B', { sawH?: number; sawV?: number; parH?: number; parV?: number }>, level = 0.8, w = 160, h = 90) {
  const px = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = ((x + 0.5) / w) * 2 - 1, ny = ((y + 0.5) / h) * 2 - 1;
    const v = (c: { sawH?: number; sawV?: number; parH?: number; parV?: number }) => {
      // the mean of x² over −1 … 1 is 1/3: subtract it so the field mean stays `level`
      const rel = ((c.sawH ?? 0) / 2) * nx + ((c.sawV ?? 0) / 2) * ny + (c.parH ?? 0) * (nx * nx - 1 / 3) + (c.parV ?? 0) * (ny * ny - 1 / 3);
      return level * (1 + rel);
    };
    px.set([v(chan.R), v(chan.G), v(chan.B), 1], (y * w + x) * 4);
  }
  return analyseShading(channelPlanes(px, w, rgbDecoder(1), KR, KB, [0, 0, w, h]))!;
}

describe('white-shading map', () => {
  it('a flat field has no saw, no par and zero flatness', () => {
    const r = field({ R: {}, G: {}, B: {} });
    for (const c of ['Y', 'R', 'G', 'B'] as const) {
      for (const k of ['sawH', 'sawV', 'parH', 'parV', 'flatness'] as const) expect(Math.abs(r[c][k])).toBeLessThan(1e-6);
    }
  });

  it('recovers a known saw and parabola per channel (hotspot in green, red tilted left to right)', () => {
    const r = field({ R: { sawH: 0.04 }, G: { parH: -0.03, parV: -0.02 }, B: { sawV: -0.025 } });
    expect(r.R.sawH).toBeCloseTo(0.04, 3);
    expect(r.G.parH).toBeCloseTo(-0.03, 3);
    expect(r.G.parV).toBeCloseTo(-0.02, 3);
    expect(r.B.sawV).toBeCloseTo(-0.025, 3);
    expect(Math.abs(r.R.parH) + Math.abs(r.G.sawH) + Math.abs(r.B.sawH)).toBeLessThan(1e-4);
    // flatness of the green hotspot: edges −3 % −2 % at the corners vs. centre ≈ 5 %
    expect(r.G.flatness).toBeCloseTo(0.05, 2);
  });

  it('the map shows a centre hotspot as positive in the middle and negative at the corners; colour cast follows the red saw', () => {
    const hot = field({ R: { parH: -0.04, parV: -0.04 }, G: { parH: -0.04, parV: -0.04 }, B: { parH: -0.04, parV: -0.04 } });
    const centre = Math.floor(hot.gy / 2) * hot.gx + Math.floor(hot.gx / 2);
    expect(cellDeviation(hot, 'Y', centre)).toBeGreaterThan(0.01);
    expect(cellDeviation(hot, 'Y', 0)).toBeLessThan(-0.01);
    const tilt = field({ R: { sawH: 0.06 }, G: {}, B: {} });
    expect(cellColour(tilt, tilt.gx - 1)[0]).toBeGreaterThan(0.02);   // right edge redder
    expect(cellColour(tilt, 0)[0]).toBeLessThan(-0.02);               // left edge less red
    expect(Math.abs(cellColour(tilt, 0)[1])).toBeLessThan(1e-6);       // blue untouched
  });

  it('table and colour ramp', () => {
    const r = field({ R: { sawH: 0.04 }, G: {}, B: {} });
    const rows = shadingRows(r, { flat: 'flat' });
    expect(rows).toHaveLength(5);
    expect(rows[2]).toContain('+4.00');
    expect(rampColour(0, 0.05)).toEqual([0.5, 0.5, 0.5]);
    expect(rampColour(1, 0.05)[0]).toBe(1);
    expect(rampColour(-1, 0.05)[2]).toBe(1);
  });
});
