import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
// @ts-expect-error plain JS module
import { benchFfmpeg } from '../server/bench.mjs';

const ff = `vendor/ffmpeg/${process.platform}-${process.arch}/ffmpeg`;

describe.skipIf(!existsSync(ff))('bridge benchmark with the shipped ffmpeg (#245)', () => {
  it('measures every case in ms per picture', async () => {
    const r = await benchFfmpeg(ff, { frames: 10 });
    expect(r.cases).toHaveLength(4);
    for (const c of r.cases) expect(c.msPerFrame).toBeGreaterThan(0);
  }, 60_000);
});
