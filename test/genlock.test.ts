import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { PhaseTracker, circularStats, framePhaseSeconds } from '../server/phase.mjs';
// @ts-expect-error plain JS module
import { applyDecodeOverride, deviceOptions } from '../server/devices.mjs';
// @ts-expect-error plain JS module
import { startHelperStream } from '../server/helper-input.mjs';
// @ts-expect-error plain JS module
import { decodeParams, ffmpegCandidates, outputSize } from '../server/index.mjs';
import { genlockLines, modeText, referenceKind, type RefStatus } from '../src/genlock';

const fake = fileURLToPath(new URL('./fixtures/fake-helper.mjs', import.meta.url));

describe('frame phase against the ST 2059-1 grid', () => {
  it('phase inside the frame period, also for large PTP times', () => {
    // 25 fps: frames start at multiples of 40 ms since the SMPTE epoch
    expect(framePhaseSeconds(1_800_000_000.012, 0.04)).toBeCloseTo(0.012, 6);
    expect(framePhaseSeconds(1_800_000_000.04, 0.04)).toBeCloseTo(0, 6);
    // 29.97: period 1001/30000 s
    expect(framePhaseSeconds(1001 / 30000 * 1000 + 0.005, 1001 / 30000)).toBeCloseTo(0.005, 6);
  });
  it('circular mean handles the wrap at the frame boundary', () => {
    const { mean, sd } = circularStats([0.0395, 0.0005, 0.0399, 0.0001], 0.04);
    expect(Math.min(mean, 0.04 - mean)).toBeLessThan(0.0002);
    expect(sd).toBeLessThan(0.0006);
  });
  it('drift in ppm from a source running 10 ppm slow, 0 ppm when locked', () => {
    for (const ppm of [0, 10, -25]) {
      const tr = new PhaseTracker(25, 1, 30);
      // frame k arrives at k · 40 ms · (1 + ppm·1e−6) + constant 7.3 ms latency
      for (let k = 0; k < 25 * 20; k++) tr.add(1_800_000_000 + k * 0.04 * (1 + ppm * 1e-6) + 0.0073);
      const r = tr.report();
      expect(r.driftPpm).toBeCloseTo(ppm, 1);
      expect(r.jumps).toBe(0);
      expect(r.n).toBe(500);
    }
  });
  it('a dropped frame is a jump, not drift', () => {
    const tr = new PhaseTracker(25, 1, 30);
    // locked, but from frame 200 on every arrival is 15 ms later (resync / buffer change)
    for (let k = 0; k < 400; k++) tr.add(1_800_000_000 + k * 0.04 + (k >= 200 ? 0.015 : 0) + 0.003);
    const r = tr.report();
    expect(r.jumps).toBe(1);
  });
  it('locked source with 0.3 ms jitter: drift ≈ 0, scatter ≈ jitter', () => {
    const tr = new PhaseTracker(50, 1, 30);
    let seed = 1;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
    for (let k = 0; k < 50 * 10; k++) tr.add(1_800_000_000 + k * 0.02 + 0.005 + rnd() * 0.0006);
    const r = tr.report();
    // 0.17 ms rms over 10 s and 500 frames: standard error ≈ 3 ppm; zero lies within 3 SE
    expect(r.driftSePpm).toBeGreaterThan(1); expect(r.driftSePpm).toBeLessThan(6);
    expect(Math.abs(r.driftPpm)).toBeLessThan(3 * r.driftSePpm);
    expect(r.jumps).toBe(0);
    expect(r.meanMs).toBeCloseTo(5, 0);
    expect(r.sdMs).toBeGreaterThan(0.1); expect(r.sdMs).toBeLessThan(0.25);
  });
});

describe('reference / genlock panel', () => {
  // same shape as lz-decklink --reference (fixture)
  const st = JSON.parse(execFileSync(process.execPath, [fake, '--reference', '0']).toString()) as RefStatus;
  it('black burst for SD, tri-level for HD reference formats', () => {
    expect(referenceKind({ name: 'PAL', width: 720, height: 576, fpsNum: 25000, fpsDen: 1000, field: 'interlaced' })).toBe('bb');
    expect(referenceKind({ name: 'NTSC', width: 720, height: 486, fpsNum: 30000, fpsDen: 1001, field: 'interlaced' })).toBe('bb');
    expect(referenceKind(st.referenceMode)).toBe('tls');
    expect(referenceKind(null)).toBeNull();
    expect(modeText(st.referenceMode)).toBe('1080i50 · 1920×1080 · 25 fps i');
  });
  it('lines: lock, format, offset, no invented input↔reference timing', () => {
    const L = genlockLines(st, null, null, 'de');
    const text = L.ref.map((r) => `${r.label}: ${r.value}`).join('\n');
    expect(text).toContain('● gelockt');
    expect(text).toContain('Tri-Level-Sync (HD-Format) (aus dem Format abgeleitet)');
    expect(text).toContain('+12 Pixel (Bereich ±511 Pixel)');
    expect(text).toContain('liefert die DeckLink-API nicht');
    const en = genlockLines(st, { periodMs: 40, meanMs: 7.3, sdMs: 0.2, driftPpm: 10, n: 250, spanS: 10, ref: 'ptp' }, '10:00:00:01', 'en');
    expect(en.phase).toEqual({ ref: 'PTP (clock panel)', mean: 'Position 7.300 ms / 40.000 ms', sd: 'Scatter 0.200 ms', drift: 'Drift +10.0 ppm' });
    expect(en.tc).toBe('Source timecode 10:00:00:01');
    expect(genlockLines({ ok: false, error: 'DeckLink-Helfer nicht gebaut' }, null, null).ref[0]).toMatchObject({ label: 'DeckLink nicht verfügbar', tone: 'warn' });
    expect(genlockLines({ ok: true, index: 1, name: 'Mini Recorder', hasReference: false }, null, null, 'en').ref[1].value).toBe('This card has no reference input');
  });

  const ffmpeg = ffmpegCandidates()[0];
  it.skipIf(!ffmpeg)('helper stream: TIME records become tc messages, stats carry the phase', async () => {
    const msgs: Record<string, unknown>[] = [];
    let t = 1_800_000_000;
    await new Promise<void>((done) => {
      const ws = Object.assign(new EventEmitter(), {
        OPEN: 1, readyState: 1, bufferedAmount: 0,
        send(d: Buffer | string) { if (typeof d === 'string') msgs.push(JSON.parse(d)); },
        close() { ws.readyState = 3; ws.emit('close'); done(); },
      });
      startHelperStream(ws, {
        bin: process.execPath, args: [fake, '--capture', '940', '30'], label: 'DeckLink', params: new URLSearchParams('width=0&depth=16'),
        ctx: { ffmpeg, fail: () => ws.close(), outputSize, decodeParams, applyDecodeOverride, deviceOptions, now: () => ({ seconds: (t += 0.04), ref: 'system' }) },
      });
    });
    const tcs = msgs.filter((m) => m.type === 'tc');
    expect(tcs[0]).toMatchObject({ tc: '10:00:00:00', kind: 'decklink', fps: 25, df: false });
    expect(tcs.length).toBe(30);
    const withPhase = msgs.filter((m) => m.type === 'stats' && m.phase);
    expect(withPhase.length).toBeGreaterThan(0);
    expect((withPhase.at(-1)!.phase as { driftPpm: number | null; periodMs: number }).periodMs).toBe(40);
  }, 20000);
});
