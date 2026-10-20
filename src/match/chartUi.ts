// Corner dialog of the colour-chart match (#149): grab a frame of one source, click the four
// chart corners (TL, TR, BR, BL), drag to correct. Same interaction as the LED camera check.

import type { Source } from '../sources';
import { homography, project, type Pt } from '../led/analysis';
import { grabFrame } from '../led/ui';
import { CLASSIC_24, toFractions, toPixels } from './chart';
import { button, h, hint, openModal } from '../ui';
import { t } from '../i18n';

export function openChartCorners(src: Source, initial: Pt[] | undefined, onSave: (pts: Pt[] | null) => void) {
  const f = grabFrame(src);
  if (!f) { openModal({ title: t('chart.cornersTitle', { name: src.name }), size: 'sm', body: [hint(t('chart.noPicture'))] }); return; }
  let corners: Pt[] = initial?.length === 4 ? toPixels(initial, f.width, f.height) : [];
  const img = h('canvas', { width: f.width, height: f.height });
  const ictx = img.getContext('2d')!, id = ictx.createImageData(f.width, f.height);
  for (let i = 0, o = 0; o < f.rgb.length; i += 4, o += 3) { id.data[i] = f.rgb[o] * 255; id.data[i + 1] = f.rgb[o + 1] * 255; id.data[i + 2] = f.rgb[o + 2] * 255; id.data[i + 3] = 255; }
  ictx.putImageData(id, 0, 0);
  const cv = h('canvas', { class: 'cam', width: f.width, height: f.height, 'aria-label': t('chart.cornersTitle', { name: src.name }) });
  const msg = h('p', { class: 'hint', 'aria-live': 'polite' });
  const names = () => [t('led.cam.tl'), t('led.cam.tr'), t('led.cam.br'), t('led.cam.bl')];
  function draw() {
    const ctx = cv.getContext('2d')!, lw = Math.max(1, f!.width / 700);
    ctx.drawImage(img, 0, 0);
    if (corners.length === 4) {
      // patch grid as a check that the corners sit right
      ctx.strokeStyle = 'rgba(140,255,158,.85)'; ctx.lineWidth = lw; ctx.beginPath();
      const { cols, rows } = CLASSIC_24, H = homography([[0, 0], [cols, 0], [cols, rows], [0, rows]], corners);
      for (let c = 0; c <= cols; c++) { ctx.moveTo(...project(H, c, 0)); ctx.lineTo(...project(H, c, rows)); }
      for (let r = 0; r <= rows; r++) { ctx.moveTo(...project(H, 0, r)); ctx.lineTo(...project(H, cols, r)); }
      ctx.stroke();
    }
    corners.forEach((p) => { ctx.fillStyle = '#ffb44a'; ctx.beginPath(); ctx.arc(p[0], p[1], lw * 6, 0, Math.PI * 2); ctx.fill(); });
    msg.textContent = corners.length < 4 ? t('led.cam.clickCorners', { corner: names()[corners.length] }) : t('chart.cornersPlaced');
  }
  const toImg = (e: PointerEvent): Pt => {
    const r = cv.getBoundingClientRect(), W = cv.width, H = cv.height;
    const sc = Math.min(r.width / W, r.height / H), ox = (r.width - W * sc) / 2, oy = (r.height - H * sc) / 2;
    return [(e.clientX - r.left - ox) / sc, (e.clientY - r.top - oy) / sc];
  };
  let drag = -1;
  cv.addEventListener('pointerdown', (e) => {
    const p = toImg(e), near = corners.findIndex((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < f.width / 40);
    if (near >= 0) drag = near; else if (corners.length < 4) { corners.push(p); drag = corners.length - 1; }
    cv.setPointerCapture(e.pointerId); draw();
  });
  cv.addEventListener('pointermove', (e) => { if (drag >= 0) { corners[drag] = toImg(e); draw(); } });
  cv.addEventListener('pointerup', () => { drag = -1; });
  const m = openModal({
    title: t('chart.cornersTitle', { name: src.name }), size: 'lg', cls: 'ledtool',
    body: [hint(t('chart.cornersHint')), h('div', { class: 'cam-wrap' }, cv), msg],
    actions: [
      button(t('chart.cornersReset'), () => { corners = []; draw(); }, { variant: 'ghost' }),
      button(t('chart.cornersAuto'), () => { onSave(null); m.close(); }),
      button(t('chart.cornersSave'), () => { if (corners.length === 4) { onSave(toFractions(corners, f.width, f.height)); m.close(); } }, { variant: 'primary' }),
    ],
  });
  draw();
}
