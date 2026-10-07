// Simulator for Touch Shading: a picture without a camera whose paint the gestures move.
// Grey scale on top (11 steps, every zone of the waveform), ColorChecker approximation below
// (vectorscope). The paint is the model in model.ts – a test bench for the gestures, not a camera.

import { patternById, renderPattern } from '../patterns';
import type { Source } from '../sources';
import { paintFrame, type Paint } from './model';

export const SIM_URL = 'sim:shading';
export const SIM_W = 960, SIM_H = 540;

/** Base picture: RGBA, 8 bit full range. */
export async function simBase(w = SIM_W, h = SIM_H): Promise<Uint8ClampedArray> {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const top = Math.round(h * 0.45);
  const part = async (id: string, y: number, ph: number) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = ph;
    await renderPattern(c.getContext('2d')!, patternById(id), w, ph, 0);
    ctx.drawImage(c, 0, y);
  };
  await part('steps11', 0, top);
  await part('macbeth', top, h - top);
  return ctx.getImageData(0, 0, w, h).data;
}

export class ShadingSim {
  private base: Uint8ClampedArray | null = null;
  private pending = false;
  paint: Paint = {};

  constructor(readonly source: Source) {}

  async start(paint: Paint) {
    this.paint = { ...paint };
    this.base = await simBase();
    this.source.pushInfo({ width: SIM_W, height: SIM_H, sourceWidth: SIM_W, sourceHeight: SIM_H, depth: 8, fps: 0, codec: 'Shading-Simulator' });
    this.render();
  }

  set(paint: Paint) {
    this.paint = { ...paint };
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; this.render(); });
  }

  private render() {
    if (!this.base) return;
    const out = new Uint8Array(this.base.length);
    paintFrame(this.base, out, this.paint);
    this.source.pushFrame(out.buffer);
  }
}
