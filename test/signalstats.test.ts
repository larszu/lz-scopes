// QC metrics from ffmpeg signalstats (#202). The parser reads the same log shape as the time
// code: metadata lines of one frame, closed by the next frame marker.
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { SIGNALSTATS_VF, SignalstatsTracker } from '../server/signalstats.mjs';

const frame = (n: number, v: Record<string, number>) => [
  `[Parsed_metadata_1 @ 0x7f] frame:${n}    pts:${n}       pts_time:${n / 25}`,
  ...Object.entries(v).map(([k, x]) => `[Parsed_metadata_1 @ 0x7f] lavfi.signalstats.${k}=${x}`),
].join('\n') + '\n';

describe('signalstats', () => {
  it('reads one frame and hands it on when the next begins', () => {
    const got: Record<string, number>[] = [];
    const t = new SignalstatsTracker((m: Record<string, number>) => got.push(m), 0);
    t.push(frame(0, { YMIN: 16, YAVG: 120.5, YMAX: 235, TOUT: 0.000123, VREP: 0, BRNG: 0.0042 }));
    expect(got).toHaveLength(0); // not finished yet
    t.push(frame(1, { YAVG: 121 }));
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ frame: 0, yMin: 16, yAvg: 120.5, yMax: 235, tout: 0.000123, vrep: 0, brng: 0.0042 });
  });

  it('survives chunks that cut a line in half', () => {
    const got: Record<string, number>[] = [];
    const t = new SignalstatsTracker((m: Record<string, number>) => got.push(m), 0);
    const text = frame(0, { YAVG: 100, BRNG: 0.5 }) + frame(1, { YAVG: 101 });
    for (let i = 0; i < text.length; i += 7) t.push(text.slice(i, i + 7));
    expect(got).toHaveLength(1);
    expect(got[0].brng).toBe(0.5);
  });

  it('gives error lines back instead of swallowing them', () => {
    const t = new SignalstatsTracker(() => {}, 0);
    const rest = t.push('[Parsed_metadata_1 @ 0x7f] lavfi.signalstats.YAVG=12\nrtsp: connection timed out\n');
    expect(rest.join('\n')).toContain('connection timed out');
    expect(rest.join('\n')).not.toContain('signalstats');
  });

  it('reports at most as often as asked', () => {
    const got: unknown[] = [];
    const t = new SignalstatsTracker(() => got.push(1), 250);
    t.push(frame(0, { YAVG: 1 }));
    t.flush(1000);
    t.push(frame(1, { YAVG: 1 }));
    t.flush(1100); // too early
    t.push(frame(2, { YAVG: 1 }));
    t.flush(1300);
    expect(got).toHaveLength(2);
  });

  it('a frame without values is not reported', () => {
    const got: unknown[] = [];
    const t = new SignalstatsTracker(() => got.push(1), 0);
    t.push('[Parsed_metadata_1 @ 0x7f] frame:0    pts:0       pts_time:0\n');
    t.flush();
    expect(got).toHaveLength(0);
  });

  it('runs before the scaler, on the Y′CbCr picture', () => {
    expect(SIGNALSTATS_VF).toContain('signalstats=stat=tout+vrep+brng');
    expect(SIGNALSTATS_VF).toContain('metadata=mode=print');
  });
});

// End to end through the bridge with the shipped ffmpeg: the values have to arrive on the
// socket and describe the picture – a full-range colour pattern lies outside 16–235, the
// SMPTE bars do not.
import { afterAll, beforeAll } from 'vitest';
import { shippedFfmpeg } from './shippedFfmpeg';

const ffmpeg = shippedFfmpeg ?? '';
let bridge: { port: number; close: () => void } | null = null;
beforeAll(async () => {
  if (!ffmpeg) return;
  // @ts-expect-error plain JS module
  const { startBridge } = await import('../server/index.mjs');
  bridge = await startBridge({ port: 0 });
});
afterAll(() => bridge?.close());

async function signalOf(url: string, ms = 20_000) {
  const { default: WebSocket } = await import('ws');
  const ws = new WebSocket(`ws://127.0.0.1:${bridge!.port}/stream?url=${encodeURIComponent(url)}&width=640&fps=5&signal=1`);
  const seen: Record<string, number>[] = [];
  try {
    ws.on('message', (d: Buffer, bin: boolean) => {
      if (bin) return;
      const m = JSON.parse(String(d));
      if (m.type === 'signal') seen.push(m);
    });
    const end = Date.now() + ms;
    while (seen.length < 2 && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  } finally { ws.close(); }
  return seen;
}

describe('signalstats through the bridge', () => {
  it.skipIf(!ffmpeg)('reports levels and the broadcast range of a live source', async () => {
    const bars = await signalOf('test:bars');
    expect(bars.length).toBeGreaterThan(0);
    const b = bars[bars.length - 1];
    // SMPTE bars are a legal signal: levels inside 16…235, next to nothing outside
    expect(b.yMin).toBeGreaterThanOrEqual(0);
    expect(b.yMax).toBeLessThanOrEqual(255);
    expect(b.yAvg).toBeGreaterThan(16);
    expect(b.brng ?? 0).toBeLessThan(0.02);
    expect(b.tout).toBeDefined();
    expect(b.vrep).toBeDefined();
  }, 60_000);

  it.skipIf(!ffmpeg)('the values describe the picture: colour bars are saturated, a grey ramp is not', async () => {
    const bars = (await signalOf('test:bars')).pop()!;
    const ramp = (await signalOf('test:ramp')).pop()!;
    expect(bars.satAvg).toBeGreaterThan(ramp.satAvg * 3);
    // a grey ramp has no colour: U and V stay at the neutral 128
    expect(ramp.uAvg).toBeCloseTo(128, 0);
    expect(ramp.vAvg).toBeCloseTo(128, 0);
    // and it covers the whole range from black to white
    expect(ramp.yMax - ramp.yMin).toBeGreaterThan(150);
  }, 90_000);
});
