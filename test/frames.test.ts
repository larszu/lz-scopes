import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { FrameAssembler } from '../server/frames.mjs';
// @ts-expect-error plain JS module
import { isInterlaced } from '../server/index.mjs';
import { persistDecay } from '../src/crt';

// Frames must reach the scopes as whole pictures, like from a global-shutter sensor: never the
// end of one frame together with the start of the next, whatever chunk sizes the pipe delivers.
describe('whole-frame assembly (server/frames.mjs)', () => {
  const frameBytes = 4 * 6 * 4; // 6×4 RGBA
  const frame = (n: number) => Buffer.alloc(frameBytes, n);
  it('emits complete frames in order for any chunking, each byte from exactly one frame', () => {
    for (const chunkSize of [1, 3, 17, frameBytes - 1, frameBytes, frameBytes + 5, 1000]) {
      const out: Buffer[] = [];
      const a = new FrameAssembler(frameBytes, (f: Buffer) => out.push(f));
      const stream = Buffer.concat([1, 2, 3, 4, 5].map(frame));
      for (let i = 0; i < stream.length; i += chunkSize) a.push(stream.subarray(i, i + chunkSize));
      expect(out.map((f) => f.length)).toEqual([frameBytes, frameBytes, frameBytes, frameBytes, frameBytes]);
      out.forEach((f, i) => expect([...new Set(f)], `chunk ${chunkSize}, frame ${i + 1}`).toEqual([i + 1]));
      expect(a.partial).toBe(0);
    }
  });
  it('a frame owns its memory: later chunks cannot change an emitted frame (no tearing)', () => {
    const out: Buffer[] = [];
    const a = new FrameAssembler(frameBytes, (f: Buffer) => out.push(f));
    const big = Buffer.concat([frame(7), frame(8).subarray(0, 10)]);
    a.push(big);
    big.fill(0); // the pipe's buffer is reused / overwritten
    a.push(frame(8).subarray(10));
    expect([...new Set(out[0])]).toEqual([7]);
    expect([...new Set(out[1])]).toEqual([8]);
  });
  it('holds an incomplete frame back', () => {
    const out: Buffer[] = [];
    const a = new FrameAssembler(frameBytes, (f: Buffer) => out.push(f));
    a.push(frame(1).subarray(0, frameBytes - 1));
    expect(out).toHaveLength(0);
    expect(a.partial).toBe(frameBytes - 1);
  });
});

describe('interlace', () => {
  it('ffprobe field orders tt/bb/tb/bt are interlaced, progressive/unknown not', () => {
    for (const f of ['tt', 'bb', 'tb', 'bt']) expect(isInterlaced(f)).toBe(true);
    for (const f of ['progressive', 'unknown', undefined, '']) expect(isInterlaced(f)).toBe(false);
  });
  const ff = spawnSync('ffmpeg', ['-version']).status === 0;
  it.skipIf(!ff)('field-wise scaling keeps the two fields apart (scale interl=1), plain scaling blends them', () => {
    // even lines 235, odd lines 16: two fields of different content woven into one frame
    const run = (interl: number) => {
      const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', "nullsrc=s=64x64,format=gray,geq=lum='if(mod(Y,2),16,235)'",
        '-frames:v', '1', '-vf', `scale=32:32:flags=area:interl=${interl}`, '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1']);
      return [0, 1, 2, 3].map((row) => r.stdout[row * 32 + 5]);
    };
    const fieldwise = run(1), blended = run(0);
    expect(Math.abs(fieldwise[0] - fieldwise[1])).toBeGreaterThan(150);
    expect(Math.abs(blended[0] - blended[1])).toBeLessThan(10);
  });
});

describe('CRT persistence is time-based per frame', () => {
  it('the same elapsed time decays the same, independent of the display frame rate', () => {
    // 4 frames of 25 ms (40 Hz) = 2 frames of 50 ms (20 Hz) = 1 step of 100 ms
    expect(persistDecay(25, 30) ** 4).toBeCloseTo(persistDecay(100, 30), 12);
    expect(persistDecay(50, 30) ** 2).toBeCloseTo(persistDecay(100, 30), 12);
  });
});
