import { describe, expect, it } from 'vitest';
import { DEFAULT_SURFACE, TOP_VIEW, surfaceQ, surfaceRamp, surfaceValue } from '../src/hecto';
import { cubeProject, cubeRotation } from '../src/cube';
import { LUMA } from '../src/color';

describe('Hectorscope (#178)', () => {
  it('Y′, channels and saturation as heights', () => {
    const k = LUMA['709'];
    expect(surfaceValue('luma', [1, 1, 1], k)).toBeCloseTo(1, 6);
    expect(surfaceValue('luma', [1, 0, 0], k)).toBeCloseTo(0.2126, 6);
    expect(surfaceValue('g', [0.1, 0.6, 0.3], k)).toBe(0.6);
    expect(surfaceValue('sat', [0.5, 0.5, 0.5], k)).toBeCloseTo(0, 6);
    // 100 % red: radius of the CbCr vector over 0.5, as in the saturation-over-luma scope
    expect(surfaceValue('sat', [1, 0, 0], k)).toBeCloseTo(Math.hypot((0 - 0.2126) / (2 * (1 - 0.0722)), (1 - 0.2126) / (2 * (1 - 0.2126))) / 0.5, 6);
  });
  it('view from above shows the picture the right way up, height does not move it', () => {
    const rot = cubeRotation(TOP_VIEW.yaw, TOP_VIEW.pitch);
    const tl = cubeProject(rot, surfaceQ(0, 0, 0.2, 9 / 16)), br = cubeProject(rot, surfaceQ(1, 1, 0.9, 9 / 16));
    expect(tl[0]).toBeLessThan(br[0]); // left stays left
    expect(tl[1]).toBeGreaterThan(br[1]); // top row on top (clip y up)
    const hi = cubeProject(rot, surfaceQ(0.3, 0.4, 1, 9 / 16)), lo = cubeProject(rot, surfaceQ(0.3, 0.4, 0, 9 / 16));
    expect(hi[0]).toBeCloseTo(lo[0], 9); expect(hi[1]).toBeCloseTo(lo[1], 9);
  });
  it('in the default view higher values sit higher on screen', () => {
    const rot = cubeRotation(DEFAULT_SURFACE.yaw, DEFAULT_SURFACE.pitch);
    expect(cubeProject(rot, surfaceQ(0.5, 0.5, 1, 9 / 16))[1]).toBeGreaterThan(cubeProject(rot, surfaceQ(0.5, 0.5, 0, 9 / 16))[1]);
  });
  it('colour ramp: blue at 0 %, green at 50 %, red at 100 %, clamped outside', () => {
    expect(surfaceRamp(0)).toEqual([0, 0, 0.5]);
    expect(surfaceRamp(0.5)).toEqual([0.5, 1, 0.5]);
    expect(surfaceRamp(1)).toEqual([0.5, 0, 0]);
    expect(surfaceRamp(1.2)).toEqual(surfaceRamp(1));
  });
});
