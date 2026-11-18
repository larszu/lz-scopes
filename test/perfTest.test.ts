import { describe, expect, it } from 'vitest';
import { percentile, perfReport, verdict, type PerfResult } from '../src/perfTest';

const base: PerfResult = {
  displayFps: 60, frameP95: 17, slowFrames: 0, longTaskMs: 0, seconds: 8, gpu: 'Apple M2', gpuMsPer2M: 2, cpuMsPerFrame: 3,
  sources: [], panels: ['parade', 'vector'], bridge: { generateMs: 3, cases: [{ label: '960 px · 16 bit', width: 960, depth: 16, msPerFrame: 4 }] },
  cores: 8, memoryGb: 16, dpr: 2, screen: '1512×982',
};

describe('performance test verdict (#245)', () => {
  it('percentile', () => { expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3); expect(percentile([], 0.9)).toBe(0); });
  it('a fast machine is all ok', () => {
    expect(verdict(base).every((f) => f.level === 'ok')).toBe(true);
  });
  it('names a slow integrated GPU, software rendering, dropped pictures and a slow ffmpeg', () => {
    const v = verdict({
      ...base, displayFps: 20, gpu: 'ANGLE (Intel, SwiftShader)', gpuMsPer2M: 9, panels: ['a', 'b', 'c', 'd'],
      sources: [{ name: '1 stream', fpsIn: 25, droppedPerS: 20, size: '960×540', latency: 'fastest' }],
      bridge: { generateMs: 5, cases: [{ label: '960 px · 16 bit', width: 960, depth: 16, msPerFrame: 25 }] },
    });
    const keys = Object.fromEntries(v.map((f) => [f.key, f.level]));
    expect(keys['perf.v.display']).toBe('bad');
    expect(keys['perf.v.gpu']).toBe('bad');
    expect(keys['perf.v.software']).toBe('bad');
    expect(keys['perf.v.dropped']).toBe('warn');
    expect(keys['perf.v.bridge']).toBe('bad');
  });
  it('the report carries the numbers a tester would send', () => {
    const r = perfReport(base, '1.15.0');
    expect(r).toContain('60 fps');
    expect(r).toContain('Apple M2');
    expect(r).toContain('960 px · 16 bit 4 ms');
  });
});
