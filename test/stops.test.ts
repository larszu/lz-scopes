import { describe, expect, it } from 'vitest';
import { greySignal, linearOf, signalAtStop, stopLabel, stopTicks, stopsOf } from '../src/stops';
import { bt709Oetf, hlgInverseOetf, hlgOetf, pqDecode, pqEncode, sceneToSignal } from '../src/color';
import { waveTicks } from '../src/graticule';
import type { Transfer } from '../src/color';

const CURVES: Transfer[] = ['sdr', 'g22', 'g26', 'srgb', 'linear', 'hlg', 'pq', 'slog3', 'logc3', 'clog3', 'vlog'];

describe('stop scale', () => {
  it('the grey card is stop 0 on every curve', () => {
    for (const tr of CURVES) expect(stopsOf(greySignal(tr), tr), tr).toBeCloseTo(0, 6);
  });
  it('one stop is twice the linear light, on every curve (round trip signal ↔ stop)', () => {
    for (const tr of CURVES) for (const s of [-4, -2, -1, 1, 2, 3]) {
      const v = signalAtStop(s, tr);
      if (v <= 0 || v > 1.1) continue;
      expect(stopsOf(v, tr), `${tr} ${s}`).toBeCloseTo(s, 5);
      expect(linearOf(v, tr) / linearOf(greySignal(tr), tr)).toBeCloseTo(2 ** s, 5);
    }
  });
  it('known anchors: SDR grey ≈ 40.9 %, PQ grey card 38 % ≈ 26 cd/m², log grey from the curve', () => {
    expect(greySignal('sdr')).toBeCloseTo(0.409, 3);
    expect(pqDecode(greySignal('pq'))).toBeGreaterThan(25); expect(pqDecode(greySignal('pq'))).toBeLessThan(27);
    // S-Log3: 18 % grey at 41 % (Sony technical summary: code 420 of 1023)
    expect(greySignal('slog3')).toBeCloseTo(420 / 1023, 2);
    // HLG reference white 75 % is ≈ +2.47 stops above the 38 % grey card (BT.2408: 18 % of 203 cd/m² vs. 203)
    expect(stopsOf(0.75, 'hlg')).toBeCloseTo(Math.log2(1 / 0.18), 1);
  });
  it('a synthetic camera underexposed by one stop reads −1, encoded with the curves of color.ts', () => {
    // half the light of the grey card, encoded independently of stops.ts
    expect(stopsOf(bt709Oetf(0.09), 'sdr')).toBeCloseTo(-1, 6);
    expect(stopsOf(hlgOetf(hlgInverseOetf(0.38) / 2), 'hlg')).toBeCloseTo(-1, 6);
    expect(stopsOf(sceneToSignal(0.09, 'slog3'), 'slog3')).toBeCloseTo(-1, 6);
    expect(stopsOf(pqEncode(pqDecode(0.38) * 4), 'pq')).toBeCloseTo(2, 6);
  });
  it('ticks: whole stops labelled, grey card major, all inside the range; thirds when zoomed', () => {
    const t = stopTicks('slog3', [-0.07, 1.1]);
    expect(t.find((x) => x.major)?.label).toBe('0');
    expect(t.every((x) => x.level > 0 && x.level <= 1.1)).toBe(true);
    expect(t.map((x) => x.label)).toContain('+2');
    const z = stopTicks('slog3', [0.3, 0.55]);
    expect(z.filter((x) => x.label === '').length).toBeGreaterThan(0);
    expect(waveTicks('stop', 'sdr')).toEqual(stopTicks('sdr', [-0.07, 1.1]));
  });
  it('labels', () => {
    expect(stopLabel(2)).toBe('+2'); expect(stopLabel(-3)).toBe('−3'); expect(stopLabel(0)).toBe('0'); expect(stopLabel(1.33)).toBe('+1.3'); expect(stopLabel(-Infinity)).toBe('−∞');
  });
});
