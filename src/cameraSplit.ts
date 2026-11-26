// "Split …" (#217): turn one input – a multiviewer – into cameras, one per tile. Shows the
// input with the layout's grid on top; tiles can be named and left out (program/preview,
// clock, audio), a border is taken off each tile (labels, tally frame).

import { button, checkbox, field, h, hint, openModal, segmented, slider, textInput } from './ui';
import { DEFAULT_INSET, LAYOUTS, LAYOUT_LABELS, MAX_INSET, cropPixels, layoutTiles, type LayoutId } from './cameras';
import type { Source } from './sources';
import { t } from './i18n';

export interface SplitChoice { layout: LayoutId; inset: number; tiles: { name: string; on: boolean }[] }
export interface SplitDialogOpts {
  input: Source;
  /** current split of this input (to edit it), if any */
  current?: SplitChoice;
  /** default camera name of tile `k` (0-based) */
  defaultName: (k: number) => string;
  apply: (c: SplitChoice) => void;
  /** remove the input's tile cameras; only offered when there are some */
  remove?: () => void;
}

/** Paint the input into the preview canvas (8-bit, for orientation only – not a measurement). */
function paintInput(c: HTMLCanvasElement, s: Source) {
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  if (!s.ready) return;
  if (!s.data && s.element) { try { ctx.drawImage(s.element, 0, 0, c.width, c.height); } catch { /* not decodable yet */ } return; }
  const f = s.cpuFrame();
  if (!f) return;
  const img = ctx.createImageData(c.width, c.height), d = img.data;
  for (let y = 0; y < c.height; y++) {
    const sy = Math.min(f.h - 1, Math.floor(((y + 0.5) * f.h) / c.height));
    for (let x = 0; x < c.width; x++) {
      const sx = Math.min(f.w - 1, Math.floor(((x + 0.5) * f.w) / c.width));
      const [r, g, b] = f.decode(f.px, (sy * f.w + sx) * 4), o = (y * c.width + x) * 4;
      d[o] = r * 255; d[o + 1] = g * 255; d[o + 2] = b * 255; d[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function openCameraSplit(o: SplitDialogOpts) {
  const s = o.input;
  let layout: LayoutId = o.current?.layout ?? '2x2';
  let inset = o.current?.inset ?? DEFAULT_INSET;
  const names = new Map<number, string>(), off = new Set<number>();
  o.current?.tiles.forEach((tl, k) => { names.set(k, tl.name); if (!tl.on) off.add(k); });
  const nameOf = (k: number) => names.get(k) ?? o.defaultName(k);

  const W = 640, aspect = s.width && s.height ? s.height / s.width : 9 / 16;
  const canvas = h('canvas', { class: 'camsplit-view', width: W, height: Math.round(W * aspect), 'aria-label': t('cam.previewLabel') });
  const draw = () => {
    paintInput(canvas, s);
    const ctx = canvas.getContext('2d')!, cw = canvas.width, ch = canvas.height;
    layoutTiles(layout).forEach((f, k) => {
      const x = f[0] * cw, y = f[1] * ch, w = f[2] * cw, hh = f[3] * ch;
      if (off.has(k)) { ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(x, y, w, hh); }
      ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.strokeRect(x + 1, y + 1, w - 2, hh - 2);
      ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.strokeRect(x + 1, y + 1, w - 2, hh - 2);
      if (!off.has(k) && inset > 0) {
        // the part that is measured: the tile without its border
        const [px, py, pw, ph] = cropPixels(f, inset, cw, ch);
        ctx.setLineDash([4, 3]); ctx.strokeStyle = '#fff'; ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1); ctx.setLineDash([]);
      }
      const label = `${k + 1} ${off.has(k) ? '–' : nameOf(k)}`;
      ctx.font = '600 12px system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x + 4, y + 4, tw, 17);
      ctx.fillStyle = '#fff'; ctx.fillText(label, x + 8, y + 17);
    });
  };
  // a click on a tile leaves it out or takes it back
  canvas.addEventListener('click', (e) => {
    const b = canvas.getBoundingClientRect(), fx = (e.clientX - b.left) / b.width, fy = (e.clientY - b.top) / b.height;
    const k = layoutTiles(layout).findIndex((f) => fx >= f[0] && fx < f[0] + f[2] && fy >= f[1] && fy < f[1] + f[3]);
    if (k < 0) return;
    if (off.has(k)) off.delete(k); else off.add(k);
    render();
  });

  const size = () => {
    if (!s.width || !s.height) return '';
    const r = cropPixels(layoutTiles(layout)[layout === '2+8' || layout === '1+5' ? layoutTiles(layout).length - 1 : 0], inset, s.width, s.height);
    return `${r[2]}×${r[3]}`;
  };
  const list = h('div', { class: 'camsplit-tiles' });
  const quality = hint('');
  const render = () => {
    draw();
    list.replaceChildren(...layoutTiles(layout).map((_, k) => h('div', { class: 'camsplit-tile' },
      checkbox(!off.has(k), String(k + 1), (v) => { if (v) off.delete(k); else off.add(k); render(); }, t('cam.tileOnTitle')),
      textInput(nameOf(k), (v) => { names.set(k, v.trim() || o.defaultName(k)); draw(); }, { attrs: { 'aria-label': t('cam.tileName', { n: k + 1 }) } }))));
    quality.textContent = t('cam.quality', { size: size() || '?', width: s.width || '?' });
  };
  const insetSlider = slider(inset, (v) => { inset = v; render(); }, { min: 0, max: MAX_INSET, step: 0.01, reset: DEFAULT_INSET, title: t('cam.insetTitle') });
  const layoutSeg = () => segmented(layout, LAYOUTS.map((id) => [id, LAYOUT_LABELS[id], t(`cam.layout.${id}` as 'cam.layout.2x2')] as const), (v) => {
    layout = v as LayoutId; off.clear(); segHost.replaceChildren(layoutSeg()); render();
  }, t('cam.layout'));
  const segHost = h('div', { class: 'camsplit-layouts' }, layoutSeg());

  const dlg = openModal({
    title: t('cam.dialogTitle', { name: s.name }), size: 'lg', cls: 'camsplit',
    body: [
      hint(t('cam.dialogHint')),
      field(t('cam.layout'), segHost),
      canvas,
      field(t('cam.inset'), checkbox(inset > 0, t('cam.insetOn'), (v) => { inset = v ? DEFAULT_INSET : 0; (insetSlider as HTMLInputElement).value = String(inset); render(); }, t('cam.insetTitle')), insetSlider),
      list,
      quality,
    ],
    actions: [
      ...(o.remove ? [button(t('cam.remove'), () => { o.remove!(); dlg.close(); }, { title: t('cam.removeTitle') })] : []),
      button(t('common.cancel'), () => dlg.close()),
      button(t('cam.apply'), () => {
        o.apply({ layout, inset, tiles: layoutTiles(layout).map((_, k) => ({ name: nameOf(k), on: !off.has(k) })) });
        dlg.close();
      }, { variant: 'primary' }),
    ],
  });
  render();
  // the input keeps running: refresh the picture twice a second while the dialog is open
  const timer = setInterval(() => { if (!dlg.dlg.open) clearInterval(timer); else draw(); }, 500);
  return dlg;
}
