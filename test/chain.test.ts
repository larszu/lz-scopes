import { describe, expect, it } from 'vitest';
import { acesParams, acesTonescale, compileChain, reinhard, stageView } from '../src/chain';
import { bt2390Eetf, detectTransfer, gammaEotf, gammaInverse, linearToSignal, pqEncode, signalToLinear, transferSignalled, type Transfer } from '../src/color';
import { LUTS, apply3D, applyLut, identityCube, parse3dl, parseCsp, parseCube, parseLut, parseSpi1d, parseSpi3d, registerLut } from '../src/lut';
import { Source } from '../src/sources';

const close = (a: number[], b: number[], d = 6) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

describe('transfers: signal ↔ linear light', () => {
  const T: Transfer[] = ['sdr', 'g22', 'g26', 'g28', 'srgb', 'linear', 'pq', 'hlg', 'slog3', 'logc4', 'vlog', 'clog3', 'nlog', 'applelog'];
  it('round trip for every transfer', () => {
    for (const t of T) {
      const rgb = [0.1, 0.45, 0.8];
      close(linearToSignal(signalToLinear(rgb, t), t), rgb, 5);
    }
  });
  it('HLG round trip with other display peaks', () => {
    for (const lw of [500, 2000, 4000]) close(linearToSignal(signalToLinear([0.2, 0.6, 0.75], 'hlg', lw), 'hlg', lw), [0.2, 0.6, 0.75], 5);
  });
  it('sRGB (IEC 61966-2-1) and gamma curves', () => {
    expect(gammaEotf('srgb', 0.5)).toBeCloseTo(0.214041, 5);
    expect(gammaInverse('srgb', 0.0031308)).toBeCloseTo(0.04045, 4);
    expect(gammaEotf('g22', 0.5)).toBeCloseTo(Math.pow(0.5, 2.2), 12);
  });
  it('detects signalled gammas from ffprobe and says when nothing is signalled', () => {
    expect(detectTransfer('gamma22')).toBe('g22');
    expect(detectTransfer('gamma28')).toBe('g28');
    expect(detectTransfer('iec61966-2-1')).toBe('srgb');
    expect(detectTransfer('linear')).toBe('linear');
    expect(detectTransfer('unknown')).toBe('sdr');
    expect(transferSignalled('unknown')).toBe(false);
    expect(transferSignalled('bt709')).toBe(true);
  });
});

describe('tone mapping', () => {
  it('BT.2390 EETF: identity below the knee, source peak → target peak, monotonic', () => {
    const src = pqEncode(1000), tgt = pqEncode(203);
    expect(bt2390Eetf(0.2, src, tgt)).toBeCloseTo(0.2, 12);
    expect(bt2390Eetf(src, src, tgt)).toBeCloseTo(tgt, 9);
    let prev = 0;
    for (let e = 0; e <= src; e += 0.01) { const o = bt2390Eetf(e, src, tgt); expect(o).toBeGreaterThanOrEqual(prev - 1e-12); prev = o; }
  });
  it('ACES 2.0 tonescale: 18 % grey ≈ 10 cd/m² at 100 cd/m² peak (anchor c_d = 10.013, aces-core Tonescale.ctl l. 38)', () => {
    // the anchor enters the constants via g_ip; the forward curve with the published constants gives 9.99993
    expect(acesTonescale(0.18, acesParams(100))).toBeCloseTo(10.0, 2);
    // the curve reaches the peak at r_hit (128 for SDR) and is limited there
    expect(acesTonescale(128, acesParams(100))).toBeCloseTo(100, 0);
    expect(acesTonescale(1e6, acesParams(100))).toBeLessThanOrEqual(100.0001);
    expect(acesTonescale(1e6, acesParams(1000))).toBeLessThanOrEqual(1000.001);
  });
  it('Reinhard: white point W maps to 1', () => {
    expect(reinhard(4, 4)).toBeCloseTo(1, 12);
    expect(reinhard(0.001, 4)).toBeCloseTo(0.001, 5);
  });
});

function src(settings: Partial<Source['settings']>) {
  const s = new Source('pattern', 'T', { transfer: 'sdr', colorspace: '709', ...settings });
  return s;
}

describe('CST chain', () => {
  it('without CST and LUT the stage view is the source itself', () => {
    const s = src({});
    expect(stageView(s, 'cst')).toBe(s);
  });
  it('same space, no tone mapping = identity', () => {
    const s = src({ chain: { cst: { on: true, gamut: '709', transfer: 'sdr', tonemap: 'none' } } });
    close(compileChain(s, 'cst').apply([0.2, 0.5, 0.9]), [0.2, 0.5, 0.9], 9);
  });
  it('Rec.709 SDR → Rec.2020 PQ → back is lossless without tone mapping', () => {
    const a = src({ chain: { cst: { on: true, gamut: '2020', transfer: 'pq', tonemap: 'none' } } });
    const pq = compileChain(a, 'cst').apply([0.3, 0.6, 0.1]);
    const b = src({ transfer: 'pq', colorspace: '2020', chain: { cst: { on: true, gamut: '709', transfer: 'sdr', tonemap: 'none' } } });
    close(compileChain(b, 'cst').apply(pq), [0.3, 0.6, 0.1], 5);
  });
  it('SDR white (100 %) lands on PQ 58 % (203 cd/m², BT.2408-8 Tab. 1)', () => {
    const a = src({ chain: { cst: { on: true, gamut: '2020', transfer: 'pq', tonemap: 'none' } } });
    compileChain(a, 'cst').apply([1, 1, 1]).forEach((v) => expect(v).toBeCloseTo(0.58, 2));
  });
  it('S-Log3 18 % grey → Rec.709 with the ACES tonescale ≈ 10 cd/m² → 38.3 % (BT.1886)', () => {
    const s = src({ transfer: 'slog3', chain: { cst: { on: true, gamut: '709', transfer: 'sdr', tonemap: 'aces2' } } });
    const grey = (420 - 64) / 876; // S-Log3 18 % grey = code 420
    compileChain(s, 'cst').apply([grey, grey, grey]).forEach((v) => expect(v).toBeCloseTo(Math.pow(acesTonescale(0.18, acesParams(100)) / 100, 1 / 2.4), 4));
  });
  it('the stage view reports the target transfer, gamut and processed probe values', () => {
    const s = src({ transfer: 'vlog', chain: { cst: { on: true, gamut: '709', transfer: 'sdr', tonemap: 'aces2' } } });
    const v = stageView(s, 'cst');
    expect(v.transfer).toBe('sdr'); expect(v.gamut).toBe('709'); expect(v.colorspace).toBe('709');
    expect(s.transfer).toBe('vlog'); expect(s.gamut).toBe('vgamut');
  });
});

describe('LUT files', () => {
  it('identity .cube reproduces its input (tetrahedral)', () => {
    const l = parseCube(identityCube(5), 'id.cube');
    close(applyLut(l, [0.123, 0.5, 0.987]), [0.123, 0.5, 0.987], 6);
  });
  it('tetrahedral interpolation is exact for affine LUTs', () => {
    const n = 4, data = new Float32Array(n ** 3 * 3);
    const f = (r: number, g: number, b: number) => [0.2 * r + 0.5 * g + 0.1, 0.9 * b - 0.3 * r, 0.33 * g + 0.33 * b + 0.34 * r];
    for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) data.set(f(r / 3, g / 3, b / 3), ((b * n + g) * n + r) * 3);
    const lut = { size: n, data, min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] };
    for (const p of [[0.1, 0.7, 0.4], [0.9, 0.2, 0.6], [0.5, 0.5, 0.5]]) close(apply3D(lut, p), f(p[0], p[1], p[2]), 6);
  });
  it('.cube with 1D shaper and 3D part (Resolve), DOMAIN keywords, 1D-only', () => {
    const shaper = ['LUT_1D_SIZE 2', 'LUT_1D_INPUT_RANGE 0 2', 'LUT_3D_SIZE 2', '0 0 0', '1 1 1'];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) shaper.push(`${r} ${g} ${b}`);
    const l = parseCube(shaper.join('\n'));
    close(applyLut(l, [1, 0.5, 2]), [0.5, 0.25, 1], 6);
    const d = parseCube('DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\nLUT_1D_SIZE 3\n0 0 0\n0.5 0.5 0.5\n1 1 1');
    close(applyLut(d, [1, 2, 0.5]), [0.5, 1, 0.25], 6);
  });
  it('.3dl (blue fastest, 10-bit output), .spi3d, .spi1d, .csp', () => {
    const rows = ['0 1023'];
    for (let r = 0; r < 2; r++) for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) rows.push(`${r * 1023} ${g * 1023} ${b * 1023}`);
    close(applyLut(parse3dl(rows.join('\n')), [0.25, 0.5, 0.75]), [0.25, 0.5, 0.75], 5);
    const spi = ['SPILUT 1.0', '3 3', '2 2 2'];
    for (let r = 0; r < 2; r++) for (let g = 0; g < 2; g++) for (let b = 0; b < 2; b++) spi.push(`${r} ${g} ${b} ${1 - r} ${g} ${b}`);
    close(applyLut(parseSpi3d(spi.join('\n')), [0.25, 0.5, 0.75]), [0.75, 0.5, 0.75], 6);
    close(applyLut(parseSpi1d('Version 1\nFrom 0 1\nLength 2\nComponents 1\n{\n0\n0.5\n}'), [1, 0.5, 0]), [0.5, 0.25, 0], 6);
    const csp = ['CSPLUTV100', '3D', '', '2', '0 2', '0 1', '2', '0 1', '0 1', '2', '0 1', '0 1', '', '2 2 2'];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) csp.push(`${r} ${g} ${b}`);
    close(applyLut(parseCsp(csp.join('\n')), [1, 0.5, 0.25]), [0.5, 0.5, 0.25], 3);
  });
  it('rejects wrong sizes and unknown formats', () => {
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow();
    expect(() => parseLut('x', 'a.txt')).toThrow();
  });
  it('the chain applies registered LUTs at the LUT stage only', () => {
    const inv = ['LUT_3D_SIZE 2'];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) inv.push(`${1 - r} ${1 - g} ${1 - b}`);
    registerLut(parseCube(inv.join('\n'), 'invert.cube'));
    expect(LUTS.has('invert.cube')).toBe(true);
    const s = src({ chain: { lut1: 'invert.cube' } });
    close(compileChain(s, 'lut').apply([0.2, 0.4, 0.6]), [0.8, 0.6, 0.4], 6);
    close(compileChain(s, 'cst').apply([0.2, 0.4, 0.6]), [0.2, 0.4, 0.6], 9);
  });
});
