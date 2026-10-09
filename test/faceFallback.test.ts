import { describe, expect, it, vi } from 'vitest';

// The GPU delegate is created fine but fails on the first picture (seen on a Windows PC):
// detection must continue on the CPU instead of switching itself off.
const created: string[] = [];
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  FaceDetector: {
    createFromOptions: async (_f: unknown, o: { baseOptions: { delegate: string } }) => {
      const d = o.baseOptions.delegate; created.push(d);
      return {
        close: () => {},
        detectForVideo: () => {
          if (d === 'GPU') throw new Error('WebGL context lost');
          return { detections: [{ boundingBox: { originX: 10, originY: 20, width: 100, height: 100 } }] };
        },
      };
    },
  },
}));
vi.stubGlobal('document', { createElement: () => ({}) });
vi.stubGlobal('location', { href: 'http://localhost/' });
const { trackFaces, faceStatus } = await import('../src/face');

describe('face tracking fallback', () => {
  it('falls back to the CPU when the GPU delegate fails on the first picture', async () => {
    const src = { faceTrack: true, ready: true, element: {}, width: 1920, height: 1080, faces: [] as unknown[], faceMode: 'all' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await trackFaces([src as never], () => {});
    warn.mockRestore();
    expect(created).toEqual(['GPU', 'CPU']);
    expect(faceStatus.delegate).toBe('CPU');
    expect(faceStatus.error).toBe('');
    expect(src.faceMode).toBe('all');
    expect(src.faces).toHaveLength(1);
  });
});
