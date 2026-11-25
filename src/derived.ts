// Sources built from other sources, so every panel, tool and the control API can use them like
// any input:
//  - CameraSource (#217): a whole input or one tile of a multiviewer input (crop + border).
//  - SplitSource (#177): the A/B split of a picture panel as one picture (left A, right B).
// Both copy pixels on the CPU when their input has a new picture (sync(), once per drawn frame
// in src/main.ts). The crop happens after the bridge scaled the input to the analysis width:
// a 2×2 tile of a 960-wide stream is 480 wide. Cropping in the bridge before scaling is the
// next step (docs/research/kameras-multiviewer.md).

import { Source, type SourceSettings } from './sources';
import type { Transfer } from './color';
import { WHOLE, composeSplit, copyCrop, cropPixels, isWhole, type Frac } from './cameras';
import { t } from './i18n';
import { unpackV210 } from './v210';

type Status = Source['status'];

/**
 * The input's raw frame with one sample per channel: a packed v210 frame (#258) is unpacked to
 * 16-bit A Y′ Cb Cr once per input frame, because crop and split copy pixels.
 */
const unpacked = new WeakMap<Source, { seq: number; buf: Uint16Array }>();
function pixelsOf(s: Source): Uint8Array | Uint16Array | null {
  if (!s.data) return null;
  if (s.pack !== 'v210') return s.data as Uint8Array | Uint16Array;
  const n = s.width * s.height * 4;
  let c = unpacked.get(s);
  if (!c || c.buf.length !== n) { c = { seq: -1, buf: new Uint16Array(n) }; unpacked.set(s, c); }
  if (c.seq !== s.frameSeq) { unpackV210(s.data as Uint32Array, s.width, s.height, c.buf); c.seq = s.frameSeq; }
  return c.buf;
}

/** Common part: mirror the input's status and decoding, keep the own picture. */
abstract class Derived extends Source {
  private canvas: HTMLCanvasElement | null = null;
  private seen = '';
  /** the source whose decoding (transfer, matrix, gamut) this one uses */
  protected abstract get basis(): Source | null;
  override get transfer(): Transfer { return this.basis?.transfer ?? super.transfer; }
  override get transferOrigin(): string { return this.basis?.transferOrigin ?? super.transferOrigin; }
  override get colorspace() { return this.basis?.colorspace ?? super.colorspace; }
  override get colorspaceOrigin(): string { return this.basis?.colorspaceOrigin ?? super.colorspaceOrigin; }
  override get gamut() { return this.basis?.gamut ?? super.gamut; }
  override get hlgLw(): number { return this.basis?.hlgLw ?? super.hlgLw; }

  /** Set status and message; true when the status changed (the card is rebuilt then). */
  protected mirror(status: Status, message = ''): boolean {
    const moved = this.status !== status;
    this.status = status; this.message = message;
    return moved;
  }
  protected clear() { this.data = null; this.element = null; this.width = 0; this.height = 0; this.seen = ''; this.stats = null; }
  /** Take a new picture when `key` changed; `draw` fills it. */
  protected take(key: string, draw: () => void) {
    if (this.frozen || key === this.seen) return;
    this.seen = key;
    draw();
    this.tick();
  }
  protected ownCanvas(w: number, h: number) {
    const c = (this.canvas ??= document.createElement('canvas'));
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    return c;
  }
  /** Copy the input's picture in, if it has a new one. Returns true when the status changed. */
  abstract sync(): boolean;
}

/** A camera: a whole input or a tile of it (#217). */
export class CameraSource extends Derived {
  parent: Source;
  crop: Frac;
  /** border taken off every side, share of the tile height (labels, tally frame) */
  inset: number;
  /** which tile of which layout, e.g. "2×2 · 3"; '' for a whole input */
  tile: string;
  constructor(parent: Source, crop: Frac = WHOLE, inset = 0, name?: string, tile = '') {
    super('camera', name);
    this.parent = parent; this.crop = crop; this.inset = inset; this.tile = tile;
    // same decoding and chain as the input: a tile is the same signal
    this.settings = parent.settings;
  }
  protected get basis() { return this.parent; }
  /** Hang the camera on another input (keeps name and place), e.g. "Replace by input …". */
  rehang(parent: Source, crop: Frac = WHOLE, inset = 0, tile = '') {
    this.parent = parent; this.crop = crop; this.inset = inset; this.tile = tile;
    this.settings = parent.settings; this.clear();
  }
  /** From a multiviewer tile (not a whole input): scaled, often 8 bit, possibly overlays. */
  get fromTile() { return !isWhole(this.crop) || this.inset > 0; }
  /** Size of the crop in the input as it arrives here. */
  get cropSize(): [number, number] | null {
    const p = this.parent;
    if (!p.width || !p.height) return null;
    const r = cropPixels(this.crop, this.inset, p.width, p.height);
    return [r[2], r[3]];
  }
  sync(): boolean {
    const p = this.parent;
    if (!p.ready) { const moved = this.mirror(p.status === 'live' ? 'connecting' : p.status, p.message); if (this.width) this.clear(); return moved; }
    const moved = this.mirror('live');
    const r = cropPixels(this.crop, this.inset, p.width, p.height);
    this.take(`${p.frameSeq}:${p.width}x${p.height}:${r.join(',')}:${p.data ? 'd' : 'e'}`, () => {
      const px = pixelsOf(p);
      if (px && px.length >= p.width * p.height * 4) {
        this.data = copyCrop(px, p.width, r); this.element = null;
        this.depth = p.pack ? 16 : p.depth; this.yuv = p.yuv;
      } else if (p.element) {
        const c = this.ownCanvas(r[2], r[3]);
        c.getContext('2d')!.drawImage(p.element, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
        this.data = null; this.element = c; this.depth = 8; this.yuv = null;
      }
      this.width = r[2]; this.height = r[3];
      this.info = p.info ? { ...p.info, width: r[2], height: r[3] } : null;
      this.fps = p.fps; this.nominalFps = p.nominalFps;
    });
    return moved;
  }
}

/** What a split needs from the picture panel: A, B (another source; null for a stage of A) and the line. */
export interface SplitInput { a: Source | null; b: Source | null; pos: number; stageB: boolean }

/** The A/B split of a picture panel as a source (#177): left of the line A, right of it B. */
export class SplitSource extends Derived {
  /** 0-based panel index */
  readonly panel: number;
  input: SplitInput = { a: null, b: null, pos: 0.5, stageB: false };
  private settingsOf: Source | null = null;
  constructor(panel: number) {
    super('split', t('split.name', { n: panel + 1 }), undefined, `split${panel + 1}`);
    this.panel = panel;
  }
  protected get basis() { return this.input.a; }
  sync(): boolean {
    const { a, b, pos, stageB } = this.input;
    // A's decoding and stage settings, without A's CST/LUT chain: B has its own (or none)
    if (a && this.settingsOf !== a) { this.settingsOf = a; this.settings = { ...a.settings, chain: undefined } as SourceSettings; }
    if (!a || stageB || !b) { const moved = this.mirror('error', stageB ? t('split.stageB') : t('split.noB')); this.clear(); return moved; }
    if (!a.ready || !b.ready) { const moved = this.mirror('connecting', t('split.waiting')); this.clear(); return moved; }
    const bothData = !!a.data && !!b.data, bothElement = !a.data && !b.data && !!a.element && !!b.element;
    const pa = pixelsOf(a), pb = pixelsOf(b);
    const depthOf = (s: Source) => (s.pack ? 16 : s.depth);
    const sameFormat = bothData && depthOf(a) === depthOf(b) && JSON.stringify(a.yuv) === JSON.stringify(b.yuv)
      && pa!.length >= a.width * a.height * 4 && pb!.length >= b.width * b.height * 4;
    if (!(sameFormat || bothElement)) { const moved = this.mirror('error', t('split.mixed')); this.clear(); return moved; }
    const moved = this.mirror('live');
    this.take(`${a.frameSeq}:${b.frameSeq}:${a.width}x${a.height}:${b.width}x${b.height}:${pos}`, () => {
      if (sameFormat) {
        this.data = composeSplit(pa!, a.width, a.height, pb!, b.width, b.height, pos);
        this.element = null; this.depth = depthOf(a); this.yuv = a.yuv;
      } else {
        const c = this.ownCanvas(a.width, a.height), ctx = c.getContext('2d')!;
        const cut = Math.round(pos * a.width);
        ctx.drawImage(a.element!, 0, 0, a.width, a.height);
        ctx.save(); ctx.beginPath(); ctx.rect(cut, 0, a.width - cut, a.height); ctx.clip();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(b.element!, 0, 0, a.width, a.height);
        ctx.restore();
        this.data = null; this.element = c; this.depth = 8; this.yuv = null;
      }
      this.width = a.width; this.height = a.height;
      this.info = a.info ? { ...a.info } : null;
      this.fps = Math.min(a.fps, b.fps);
    });
    return moved;
  }
}

export const isDerived = (s: Source | null | undefined): s is CameraSource | SplitSource => s instanceof CameraSource || s instanceof SplitSource;
