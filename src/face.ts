// Face auto-tracking (MediaPipe Tasks Vision FaceDetector, BlazeFace short range,
// Apache-2.0). Detects all faces ~10×/s per tracked source, keeps them in a stable
// left-to-right order and smooths each box; Source.faceMode picks which act as ROI.
// Model and WASM are served locally (public/models, public/mediapipe).

import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Source } from './sources';

type Box = [number, number, number, number];
export interface Face { id: number; box: Box }
let nextId = 1;

let detector: Promise<FaceDetector> | null = null;
function getDetector() {
  detector ??= (async () => {
    const base = new URL('.', location.href).href;
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe`);
    const opts = (delegate: 'GPU' | 'CPU') => ({
      baseOptions: { modelAssetPath: `${base}models/blaze_face_short_range.tflite`, delegate },
      runningMode: 'VIDEO' as const, minDetectionConfidence: 0.5,
    });
    try { return await FaceDetector.createFromOptions(fileset, opts('GPU')); } catch { return FaceDetector.createFromOptions(fileset, opts('CPU')); }
  })();
  return detector;
}

const scratch = document.createElement('canvas');
/** Something MediaPipe can read: the element itself or a copy of raw frames. */
function imageOf(src: Source): TexImageSource | null {
  if (src.element) return src.element;
  if (!src.data) return null;
  const w = src.width, h = src.height;
  let px: Uint8ClampedArray;
  if (src.depth === 8) px = new Uint8ClampedArray(src.data.buffer, src.data.byteOffset, w * h * 4);
  else { px = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < px.length; i++) px[i] = src.data[i] / 257; }
  scratch.width = w; scratch.height = h;
  scratch.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return scratch;
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
  const det = await getDetector();
  const img = imageOf(s);
  if (!img) return [];
  lastTs = Math.max(lastTs + 1, performance.now());
  const res = det.detectForVideo(img as HTMLVideoElement, lastTs);
  // BlazeFace boxes run from the brows to the chin: extend upwards to include the forehead
  // (skin measurement), only a little sideways and down
  const side = 0.08, top = 0.3, bottom = 0.02;
  return res.detections.map((d) => d.boundingBox).filter((b): b is NonNullable<typeof b> => !!b).map((b) =>
    [b.originX - b.width * side, b.originY - b.height * top, b.originX + b.width * (1 + side), b.originY + b.height * (1 + bottom)]
      .map((v, i) => Math.round(Math.max(0, Math.min(i % 2 ? s.height : s.width, v)))) as Box);
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
  } catch (e) {
    console.warn('face tracking', e);
    tracked.forEach((s) => (s.faceMode = 'off'));
    onChange();
  } finally {
    busy = false;
  }
}
