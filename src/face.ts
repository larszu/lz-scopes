// Face auto-tracking (MediaPipe Tasks Vision FaceDetector, BlazeFace short range,
// Apache-2.0). Detects all faces ~10×/s per tracked source, keeps them in a stable
// left-to-right order and smooths each box; Source.faceMode picks which act as ROI.
// Model and WASM are served locally (public/models, public/mediapipe).

import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Source } from './sources';

type Box = [number, number, number, number];
export interface Face { id: number; box: Box }
let nextId = 1;

/**
 * Which way the detector runs, and why it stopped. The GPU delegate can be created and still
 * fail on the first picture (some drivers, ANGLE/D3D11, software WebGL); then detection falls
 * back to the CPU instead of switching itself off silently. A failed load is not kept, so
 * switching face tracking on again retries.
 */
export const faceStatus: { delegate: 'GPU' | 'CPU' | null; error: string } = { delegate: null, error: '' };

let detector: Promise<FaceDetector> | null = null;
function getDetector(delegate: 'GPU' | 'CPU' = 'GPU') {
  detector ??= (async () => {
    const base = new URL('.', location.href).href;
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe`);
    const opts = (d: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: `${base}models/blaze_face_short_range.tflite`, delegate: d },
      runningMode: 'VIDEO' as const, minDetectionConfidence: 0.5,
    });
    if (delegate === 'GPU') {
      try { const det = await FaceDetector.createFromOptions(fileset, opts('GPU')); faceStatus.delegate = 'GPU'; return det; } catch (e) { console.warn('face tracking: GPU delegate unavailable, using CPU', e); }
    }
    const det = await FaceDetector.createFromOptions(fileset, opts('CPU'));
    faceStatus.delegate = 'CPU';
    return det;
  })();
  detector.catch(() => { detector = null; });
  return detector;
}

/** Drop the GPU detector after a runtime failure and continue on the CPU. */
async function fallBackToCpu(e: unknown) {
  console.warn('face tracking: GPU detection failed, switching to CPU', e);
  const old = detector; detector = null;
  try { (await old)?.close(); } catch { /* already gone */ }
  return getDetector('CPU');
}

const scratch = document.createElement('canvas');
/** Raw frames are decimated to this width for detection (the model looks at 128 × 128 anyway). */
const DETECT_W = 640;
/**
 * Something MediaPipe can read: the element itself or a decimated copy of raw frames, and the
 * factor from its pixels back to source pixels.
 */
function imageOf(src: Source): { img: TexImageSource; scale: number } | null {
  if (src.element) return { img: src.element, scale: 1 };
  if (!src.data) return null;
  const step = Math.max(1, Math.ceil(src.width / DETECT_W));
  const w = Math.floor(src.width / step), h = Math.floor(src.height / step), W = src.width;
  const px = new Uint8ClampedArray(w * h * 4), d = src.data;
  const dec = src.yuv ? src.decoder() : null, k = src.depth === 8 ? 1 : 1 / 257;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y * step) * W + x * step) * 4, o = (y * w + x) * 4;
      if (dec) { const c = dec(d, i); px[o] = c[0] * 255; px[o + 1] = c[1] * 255; px[o + 2] = c[2] * 255; }
      else { px[o] = d[i] * k; px[o + 1] = d[i + 1] * k; px[o + 2] = d[i + 2] * k; }
      px[o + 3] = 255;
    }
  }
  scratch.width = w; scratch.height = h;
  scratch.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return { img: scratch, scale: step };
}

const center = (b: Box) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

/** Match new detections to the previous faces (nearest centre), keep their ids, smooth the boxes. */
export function matchFaces(prev: Face[], next: Box[], k = 0.3): Face[] {
  const used = new Set<number>();
  const out = next.map((n): Face => {
    const [cx, cy] = center(n);
    let best = -1, bd = Infinity;
    prev.forEach((p, i) => {
      if (used.has(i)) return;
      const [px, py] = center(p.box);
      const d = Math.hypot(px - cx, py - cy);
      if (d < bd && d < (n[2] - n[0]) * 0.8) { bd = d; best = i; }
    });
    if (best < 0) return { id: nextId++, box: n };
    used.add(best);
    return { id: prev[best].id, box: prev[best].box.map((v, j) => Math.round(v + (n[j] - v) * k)) as Box };
  });
  return out.sort((a, b) => center(a.box)[0] - center(b.box)[0]); // numbering left to right
}

/** Overlap of two boxes relative to the smaller one. */
export function overlap(a: Box, b: Box) {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = (x: Box) => (x[2] - x[0]) * (x[3] - x[1]);
  return (w * h) / Math.max(1, Math.min(area(a), area(b)));
}

async function detect(s: Source): Promise<Box[]> {
  let det = await getDetector();
  const im = imageOf(s);
  if (!im) return [];
  const { img, scale } = im;
  lastTs = Math.max(lastTs + 1, performance.now());
  let res;
  try { res = det.detectForVideo(img as HTMLVideoElement, lastTs); } catch (e) {
    if (faceStatus.delegate !== 'GPU') throw e;
    det = await fallBackToCpu(e);
    lastTs += 1;
    res = det.detectForVideo(img as HTMLVideoElement, lastTs);
  }
  // BlazeFace boxes run from the brows to the chin: extend upwards to include the forehead
  // (skin measurement), only a little sideways and down
  const side = 0.08, top = 0.3, bottom = 0.02;
  return res.detections.map((d) => d.boundingBox).filter((b): b is NonNullable<typeof b> => !!b).map((b) =>
    [b.originX - b.width * side, b.originY - b.height * top, b.originX + b.width * (1 + side), b.originY + b.height * (1 + bottom)]
      .map((v, i) => Math.round(Math.max(0, Math.min(i % 2 ? s.height : s.width, v * scale)))) as Box);
}

/** One-off check: the face that lies inside a hand-drawn rectangle, if any. */
export async function faceInRect(s: Source, rect: Box): Promise<Box | null> {
  const boxes = await detect(s);
  let best: Box | null = null, bo = 0.4;
  for (const b of boxes) { const o = overlap(b, rect); if (o > bo) { bo = o; best = b; } }
  return best;
}

let busy = false;
let lastTs = 0;

/** Call regularly (every ~100 ms) with all sources; updates faces of tracked ones. */
export async function trackFaces(sources: Source[], onChange: () => void) {
  const tracked = sources.filter((s) => s.faceTrack && s.ready);
  if (!tracked.length || busy) return;
  busy = true;
  try {
    for (const s of tracked) {
      const boxes = await detect(s);
      const before = s.faces.map((f) => f.id).join();
      s.faces = matchFaces(s.faces, boxes);
      if (s.faces.map((f) => f.id).join() !== before) onChange(); // face list shows up in the UI
    }
    faceStatus.error = '';
  } catch (e) {
    console.warn('face tracking', e);
    faceStatus.error = e instanceof Error ? e.message : String(e);
    tracked.forEach((s) => (s.faceMode = 'off'));
    onChange();
  } finally {
    busy = false;
  }
}
