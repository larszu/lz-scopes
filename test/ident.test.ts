import { describe, expect, it } from 'vitest';
import { DEFAULT_GEN, ToneGenerator, blitsValue, ebuMultiCycle, type GenConfig } from '../src/audio/dsp/signals';
import { IdentDetector } from '../src/audio/dsp/ident';
import { channelInfo, clockwiseOrder, positionWeight } from '../src/audio/dsp/layouts';

const fs = 48000;

/** Render `seconds` of the generator with `channels` outputs (all routes on). */
function render(signal: GenConfig['signal'], seconds: number, channels = 2, patch: Partial<GenConfig> = {}) {
  const routes = Array.from({ length: channels }, () => ({ on: true, invert: false, trim: 0 }));
  const g = new ToneGenerator(fs, channels, { ...DEFAULT_GEN, signal, level: -18, routes, channels, running: true, ...patch });
  const n = Math.round(seconds * fs);
  const chs = Array.from({ length: channels }, () => new Float32Array(n));
  for (let off = 0; off < n; off += 128) { const len = Math.min(128, n - off); g.render(chs.map((c) => c.subarray(off, off + len)), len, off); }
  return chs;
}
function detect(chs: Float32Array[], layout = '') {
  const d = new IdentDetector(fs, channelInfo(chs.length, layout));
  const n = chs[0].length;
  for (let off = 0; off < n; off += 2048) d.push(chs, Math.min(2048, n - off), off);
  return d.analyse();
}
const texts = (r: ReturnType<typeof detect>) => r.findings.map((f) => f.text).join(' | ');

describe('layouts and BS.1770-5 Annex 3 weights', () => {
  it('Table 4: 60° ≤ |θ| ≤ 120° at |φ| < 30° is 1.41, everything else 1.00', () => {
    expect(positionWeight(30, 0)).toBe(1);
    expect(positionWeight(-60, 0)).toBe(1.41);
    expect(positionWeight(90, 0)).toBe(1.41);
    expect(positionWeight(-110, 0)).toBe(1.41);
    expect(positionWeight(120, 0)).toBe(1.41);
    expect(positionWeight(135, 0)).toBe(1);
    expect(positionWeight(180, 0)).toBe(1);
    expect(positionWeight(90, 30)).toBe(1);
    expect(positionWeight(110, 45)).toBe(1);
  });
  it('5.1 keeps Table 3 (Ls/Rs 1.41, LFE 0); 7.1 follows Table 5 (M±090 1.41, M±135 1.00)', () => {
    expect(channelInfo(6, '5.1').map((c) => c.weight)).toEqual([1, 1, 1, 0, 1.41, 1.41]);
    expect(channelInfo(6, '5.1(side)').map((c) => c.weight)).toEqual([1, 1, 1, 0, 1.41, 1.41]);
    expect(channelInfo(8, '7.1').map((c) => c.weight)).toEqual([1, 1, 1, 0, 1, 1, 1.41, 1.41]);
    // 7.1.4: the four height channels (U±045/U±135) are 1.00
    expect(channelInfo(12, '7.1.4').map((c) => c.weight)).toEqual([1, 1, 1, 0, 1, 1, 1.41, 1.41, 1, 1, 1, 1]);
    // 22.2 (Table 5 configuration H 9+10+3): two LFE channels excluded, M±060/M±090 1.41
    const h = channelInfo(24, '22.2');
    expect(h.filter((c) => c.lfe).length).toBe(2);
    expect(h.filter((c) => c.weight === 1.41).map((c) => c.id).sort()).toEqual(['SL', 'SR']);
  });
  it('unknown layouts stay discrete with weight 1', () => {
    expect(channelInfo(4).map((c) => c.weight)).toEqual([1, 1, 1, 1]);
    expect(channelInfo(16).every((c) => c.weight === 1)).toBe(true);
  });
  it('clockwise order from front left (Tech 3304 §4.2)', () => {
    const n = (l: string, c: number) => clockwiseOrder(channelInfo(c, l)).map((i) => channelInfo(c, l)[i].name);
    expect(n('5.1', 6)).toEqual(['L', 'C', 'R', 'Rb', 'Lb']);
    expect(n('7.1', 8)).toEqual(['L', 'C', 'R', 'Rs', 'Rb', 'Lb', 'Ls']);
  });
});

describe('multichannel generator (Tech 3304)', () => {
  it('BLITS: 600 ms bursts L, R, C, LFE, Ls, Rs; section 2 and 3 as specified', () => {
    const on = (ch: number, t: number) => Math.abs(blitsValue(ch, t)) > 0 || Math.abs(blitsValue(ch, t + 0.0002)) > 0;
    [0, 1, 2, 3, 4, 5].forEach((k) => { expect(on(k, k * 0.8 + 0.3)).toBe(true); expect(on(k, k * 0.8 + 0.7)).toBe(false); });
    expect(on(0, 4.8 + 1.15)).toBe(false); // first L break
    expect(on(1, 4.8 + 1.15)).toBe(true);
    expect(on(0, 4.8 + 4)).toBe(true);
    expect(on(0, 10.1)).toBe(false); // 300 ms silence
    expect(on(3, 11)).toBe(true); // 2 kHz on all channels
    expect(on(5, 13.3)).toBe(false);
  });
  it('EBU multichannel: cycle 4 s + 1 s per main channel (6 s identification for 5.1)', () => {
    expect(ebuMultiCycle(5) - 3).toBe(6);
    expect(ebuMultiCycle(7) - 3).toBe(8);
  });
});

describe('ident recognition', { timeout: 30000 }, () => {
  it('EBU stereo ident (R 49): recognised, L/R right, in phase, −18 dBFS', () => {
    const r = detect(render('ebu-ident', 8));
    expect(r.kind).toBe('ebu');
    expect(texts(r)).toContain('L/R richtig');
    expect(texts(r)).toContain('gleichphasig');
    expect(r.channels[0].levelDb!).toBeCloseTo(-18, 0);
    expect(Math.abs(r.channels[0].freq! - 1000)).toBeLessThan(3);
  });
  it('EBU stereo ident with swapped channels → „L/R vertauscht“', () => {
    const [L, R] = render('ebu-ident', 8);
    expect(texts(detect([R, L]))).toContain('L/R vertauscht');
  });
  it('inverted polarity on one channel', () => {
    const [L, R] = render('ebu-ident', 8);
    const r = detect([L, R.map((v) => -v)]);
    expect(texts(r)).toContain('Polarität invertiert');
  });
  it('missing channel', () => {
    const [L] = render('ebu-ident', 8);
    expect(texts(detect([L, new Float32Array(L.length)]))).toContain('Kanal R fehlt');
  });
  it('GLITS and its swapped version', () => {
    const [L, R] = render('glits', 9);
    const r = detect([L, R]);
    expect(r.kind).toBe('glits');
    expect(texts(r)).toContain('L/R richtig');
    expect(texts(detect([R, L]))).toContain('L/R vertauscht');
  });
  it('LZ Kanal-Ident L/R', () => {
    const [L, R] = render('ident-lr', 7);
    expect(detect([L, R]).kind).toBe('lz-lr');
    expect(texts(detect([R, L]))).toContain('L/R vertauscht');
  });
  it('BLITS 5.1: order right; C and LFE swapped is named', () => {
    const chs = render('blits', 20, 6);
    const r = detect(chs, '5.1');
    expect(r.kind).toBe('blits');
    expect(texts(r)).toContain('Kanalfolge richtig');
    const sw = [chs[0], chs[1], chs[3], chs[2], chs[4], chs[5]];
    expect(texts(detect(sw, '5.1'))).toContain('C und LFE vertauscht');
  });
  it('BLITS 5.1 with L/R swapped and a silent Rs', () => {
    const chs = render('blits', 20, 6);
    const r = detect([chs[1], chs[0], chs[2], chs[3], chs[4], new Float32Array(chs[5].length)], '5.1');
    expect(texts(r)).toContain('L/R vertauscht');
    expect(texts(r)).toContain('Kanal Rb fehlt');
  });
  it('EBU multichannel ident 7.1: order right, then Ls/Rs swapped', () => {
    const chs = render('ebu-multi', 2 * ebuMultiCycle(7) + 1, 8);
    const r = detect(chs, '7.1');
    expect(r.kind).toBe('ebu-multi');
    expect(texts(r)).toContain('Kanalfolge richtig');
    const sw = [...chs]; [sw[6], sw[7]] = [sw[7], sw[6]];
    expect(texts(detect(sw, '7.1'))).toContain('Ls und Rs vertauscht');
  });
});
