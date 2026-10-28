// LUT files from other tools (#203). Our own test files only prove that we read what we write;
// these come from OCIO (djieff/prism) and from another viewer's test assets (lifeart/openrv-web),
// both MIT – see test/fixtures/luts/README.md. The big ones of the same collection are fetched
// on demand (scripts/luts-fetch.mjs) and taken along when they are there.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyLut, parseLut } from '../src/lut';

const DIR = join(import.meta.dirname, 'fixtures', 'luts');
const VENDOR = join(import.meta.dirname, '..', 'vendor', 'luts');
const IS_LUT = /\.(cube|3dl|spi3d|spi1d|csp)$/i;
/** the fetched files, if `node scripts/luts-fetch.mjs` has run */
const vendorFiles = existsSync(VENDOR) ? readdirSync(VENDOR).filter((f) => IS_LUT.test(f)) : [];
const read = (dir: string, f: string) => parseLut(readFileSync(join(dir, f), 'utf8'), f);
const at = (dir: string, f: string, v: number) => applyLut(read(dir, f), [v, v, v]);

describe('LUT files from other tools', () => {
  it('.spi1d: the sRGB curve hits its own EOTF', () => {
    const l = read(DIR, 'srgb.spi1d');
    expect(l.format).toBe('spi1d');
    expect(l.pre?.size).toBe(4101);
    // sRGB EOTF: ((v + 0.055) / 1.055)^2.4 above 0.04045
    for (const v of [0.25, 0.5, 0.75, 1]) {
      const want = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      expect(at(DIR, 'srgb.spi1d', v)[0]).toBeCloseTo(want, 4);
    }
  });

  it('.3dl and .cube 3D: a gamut change keeps grey grey', () => {
    const tdl = read(DIR, 'aces2065_to_acescg_17.3dl');
    expect(tdl.format).toBe('3dl');
    expect(tdl.cube?.size).toBe(17);
    const cube = read(DIR, 'linp3_to_lin2020_17.cube');
    expect(cube.cube?.size).toBe(17);
    for (const f of ['aces2065_to_acescg_17.3dl', 'linp3_to_lin2020_17.cube']) {
      const [r, g, b] = at(DIR, f, 0.5);
      expect(r).toBeCloseTo(0.5, 3);
      expect(g).toBeCloseTo(0.5, 3);
      expect(b).toBeCloseTo(0.5, 3);
    }
  });

  it('smallest 3D cube (2³) and a 1D .cube', () => {
    expect(read(DIR, 'warm_2.cube').cube?.size).toBe(2);
    const warm = at(DIR, 'warm_2.cube', 0.5);
    expect(warm[0]).toBeGreaterThan(warm[1]); // warm tint: more red than green
    const g = read(DIR, 'gamma_17.cube');
    expect(g.pre?.size).toBe(17);
    expect(g.cube).toBeUndefined();
    // the entry at the middle sample is returned unchanged, no neighbour mixed in
    expect(at(DIR, 'gamma_17.cube', 0.5)[0]).toBeCloseTo(0.282051, 6);
  });

  it('own DOMAIN_MIN/MAX clamps instead of stretching', () => {
    const l = read(DIR, 'custom_domain_1d.cube');
    expect(l.pre?.min?.[0]).toBeCloseTo(0.1, 6);
    expect(l.pre?.max?.[0]).toBeCloseTo(0.9, 6);
    expect(at(DIR, 'custom_domain_1d.cube', 0)[0]).toBeCloseTo(0.1, 4);
    expect(at(DIR, 'custom_domain_1d.cube', 0.5)[0]).toBeCloseTo(0.5, 4);
    expect(at(DIR, 'custom_domain_1d.cube', 1)[0]).toBeCloseTo(0.9, 4);
  });

  it('a file without a size is rejected, not half read', () => {
    expect(() => read(DIR, 'no_size.cube')).toThrow(/SIZE/);
  });

  it.skipIf(!vendorFiles.length)('the big ones of the same collection, when fetched', () => {
    for (const f of vendorFiles) {
      const l = read(VENDOR, f);
      expect(l.cube?.size ?? l.pre?.size).toBeGreaterThan(1);
      // every output stays finite – a misread header shows up here as NaN
      for (const v of [0, 0.5, 1]) for (const c of at(VENDOR, f, v)) expect(Number.isFinite(c)).toBe(true);
    }
  });
});
