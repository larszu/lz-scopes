import { describe, expect, it, vi } from 'vitest';

// face.ts pulls in MediaPipe and a canvas at import time – stub both for the pure helpers
vi.mock('@mediapipe/tasks-vision', () => ({ FaceDetector: {}, FilesetResolver: {} }));
vi.stubGlobal('document', { createElement: () => ({}) });
const { matchFaces, overlap } = await import('../src/face');

describe('face tracking helpers', () => {
  it('keeps ids of faces that moved a little and numbers left to right', () => {
    const a = matchFaces([], [[500, 100, 600, 220], [100, 100, 200, 220]]);
    expect(a.map((f) => f.box[0])).toEqual([100, 500]);
    const b = matchFaces(a, [[110, 105, 210, 225], [505, 100, 605, 220]]);
    expect(b.map((f) => f.id)).toEqual(a.map((f) => f.id));
    // smoothed towards the new position
    expect(b[0].box[0]).toBeGreaterThan(100); expect(b[0].box[0]).toBeLessThan(110);
  });
  it('gives a new id to a face far away', () => {
    const a = matchFaces([], [[100, 100, 200, 220]]);
    const b = matchFaces(a, [[900, 100, 1000, 220]]);
    expect(b[0].id).not.toBe(a[0].id);
  });
  it('overlap relative to the smaller box', () => {
    expect(overlap([0, 0, 100, 100], [0, 0, 100, 100])).toBe(1);
    expect(overlap([0, 0, 100, 100], [50, 0, 150, 100])).toBe(0.5);
    expect(overlap([0, 0, 10, 10], [0, 0, 1000, 1000])).toBe(1);
    expect(overlap([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0);
  });
});
