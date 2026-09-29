// Face auto-tracking: the ROI follows the largest face (MediaPipe Tasks Vision
// FaceDetector, BlazeFace short range, Apache-2.0). Runs ~10×/s per tracked source,
// model and WASM are served locally (public/models, public/mediapipe).

import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import type { Source } from './sources';

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
/** Something MediaPipe can read: the element itself or a downscaled copy of raw frames. */
function imageOf(src: Source): TexImageSource | null {
  if (src.element) return src.element;
  if (!src.data) return null;
  const scale = src.depth === 16 ? 257 : 1;
  const w = src.width, h = src.height;
  let px: Uint8ClampedArray;
  if (src.depth === 8) px = new Uint8ClampedArray(src.data.buffer, src.data.byteOffset, w * h * 4);
  else { px = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < px.length; i++) px[i] = src.data[i] / scale; }
  scratch.width = w; scratch.height = h;
  scratch.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0);
  return scratch;
}

let busy = false;
let lastTs = 0;

/** Call regularly (e.g. every 100 ms) with all sources; updates the ROI of tracked ones. */
export async function trackFaces(sources: Source[], onChange: () => void) {
  const tracked = sources.filter((s) => s.faceTrack && s.ready);
  if (!tracked.length || busy) return;
  busy = true;
  try {
    const det = await getDetector();
    for (const s of tracked) {
      const img = imageOf(s);
      if (!img) continue;
      lastTs = Math.max(lastTs + 1, performance.now());
      const res = det.detectForVideo(img as HTMLVideoElement, lastTs);
      const faces = res.detections.map((d) => d.boundingBox).filter((b): b is NonNullable<typeof b> => !!b);
      if (!faces.length) continue;
      const b = faces.sort((a, c) => c.width * c.height - a.width * a.height)[0];
      // face box → a bit larger, clamped; smoothed against jitter
      const pad = 0.12;
      const tgt = [b.originX - b.width * pad, b.originY - b.height * pad, b.originX + b.width * (1 + pad), b.originY + b.height * (1 + pad)]
        .map((v, i) => Math.max(0, Math.min(i % 2 ? s.height : s.width, v)));
      const cur = s.roi ?? tgt;
      const k = 0.25; // smoothing: follows movement, ignores detector jitter
      s.roi = cur.map((v, i) => Math.round(v + (tgt[i] - v) * k)) as [number, number, number, number];
    }
  } catch (e) {
    console.warn('face tracking', e);
    tracked.forEach((s) => (s.faceTrack = false));
    onChange();
  } finally {
    busy = false;
  }
}
