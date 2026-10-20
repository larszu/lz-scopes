import { describe, expect, it } from 'vitest';
import { centreColour, shadingFit, shadingGrid, syntheticField } from '../src/lensShading';
import { comparePrints, nearestZoom, printOf, rankPrints } from '../src/lensprint';

const flat = { gain: 0.8 };

describe('white shading core: saw and parabola per channel', () => {
  it('a flat field has no shading', () => {
    const s = shadingFit(shadingGrid(syntheticField(160, 90, [flat, flat, flat])));
    for (const c of [s.r, s.g, s.b]) for (const v of [c.sawH, c.sawV, c.parH, c.parV, c.rest]) expect(Math.abs(v)).toBeLessThan(1e-3);
    expect(s.g.centre).toBeCloseTo(0.8, 6);
  });
  it('finds a red horizontal saw and a lens fall-off (parabola) in all channels', () => {
    const fall = { parH: -0.08, parV: -0.05 };
    const s = shadingFit(shadingGrid(syntheticField(320, 180, [{ gain: 0.8, sawH: 0.03, ...fall }, { gain: 0.8, ...fall }, { gain: 0.8, ...fall }]), 16, 9));
    // % of the fitted centre level, which the fall-off lowers slightly: 3 % ± 0.1
    expect(Math.abs(s.r.sawH - 3)).toBeLessThan(0.1);
    expect(Math.abs(s.g.sawH)).toBeLessThan(0.1); // sampling every 2nd pixel is not quite symmetric
    for (const c of [s.r, s.g, s.b]) { expect(c.parH).toBeCloseTo(-8, 0); expect(c.parV).toBeCloseTo(-5, 0); }
    // corners darker than the centre in the luma map
    expect(s.map[0]).toBeLessThan(-8);
    expect(Math.abs(s.map[4 * 16 + 8])).toBeLessThan(1);
  });
  it('green/magenta top and bottom (Sony: V modulation) shows as opposite V saws', () => {
    const s = shadingFit(shadingGrid(syntheticField(160, 90, [{ gain: 0.8, sawV: 0.02 }, { gain: 0.8, sawV: -0.02 }, { gain: 0.8, sawV: 0.02 }])));
    expect(s.r.sawV).toBeCloseTo(2, 1);
    expect(s.g.sawV).toBeCloseTo(-2, 1);
  });
  it('centre colour as R/G and B/G', () => {
    const c = centreColour(shadingFit(shadingGrid(syntheticField(64, 36, [{ gain: 0.88 }, { gain: 0.8 }, { gain: 0.72 }]))));
    expect(c.rg).toBeCloseTo(1.1, 6);
    expect(c.bg).toBeCloseTo(0.9, 6);
  });
});

describe('lens fingerprint: store, compare, recognise', () => {
  const field = (sawR: number, par: number, warm = 1) => shadingFit(shadingGrid(syntheticField(160, 90, [{ gain: 0.8 * warm, sawH: sawR, parH: par }, { gain: 0.8, parH: par }, { gain: 0.8 / warm, parH: par }])));
  const wide = printOf('Fujinon XA20', 8, field(0.0, -0.1), true);
  const tele = printOf('Fujinon XA20', 160, field(0.02, -0.03), true);
  const other = printOf('Canon CJ18', 8, field(0.0, -0.1, 1.04), true);
  it('the difference tells which control to turn and how far', () => {
    const live = printOf('?', 0, field(0.03, -0.1), true);
    const d = comparePrints(live, wide);
    expect(d.worst.ch).toBe('r');
    expect(d.worst.term).toBe('sawH');
    expect(d.worst.pp).toBeCloseTo(3, 1);
    expect(Math.abs(d.dRg)).toBeLessThan(0.1);
  });
  it('recognises the lens and zoom by the smallest distance', () => {
    const live = printOf('?', 0, field(0.02, -0.03), true);
    expect(rankPrints(live, [wide, tele, other])[0].p).toBe(tele);
    const warm = printOf('?', 0, field(0.0, -0.1, 1.04), true);
    expect(rankPrints(warm, [wide, tele, other])[0].p).toBe(other);
  });
  it('nearest stored zoom of the same lens', () => {
    expect(nearestZoom([wide, tele, other], 'Fujinon XA20', 120)).toBe(tele);
    expect(nearestZoom([wide, tele], 'Canon CJ18', 8)).toBeNull();
  });
});
