// "Farbabgleich" panel (issue #55): measured colour of the panel's source against a colour
// target or against the same object measured in another source (camera matching).

import { barTargets, isLog, ycbcr, type DisplaySpace } from '../color';
import type { Space } from '../deltae';
import type { Rect } from '../renderer';
import type { Source } from '../sources';
import {
  aggregate, cameraText, codes, compare, convertSignal, correctionText, deVerdict, hexLine, swatchCss, targetSignal, type ColorTarget, type Rgb,
} from './core';

export interface MatchSettings {
  /** 'target:<name>' (colour target) or 'src:<id>' (reference camera) */
  ref?: string;
  /** series of measurements (effect paints: several spots/angles), signals in `seriesSpace` */
  series?: number[][];
  seriesSpace?: Space;
  /** ΔE up to which the difference counts as "visible side by side" (default 3) */
  tol?: number;
}

export const spaceOf = (s: Source): Space => ({ transfer: s.transfer, gamut: s.gamut, hlgLw: s.hlgLw });

/** What the source measures: mean of the ROI / tracked faces, else the probe pixel. */
export function measure(s: Source): { rgb: Rgb; how: string } | null {
  if (!s.ready) return null;
  if (s.activeRois().length && s.stats?.samples) return { rgb: [...s.stats.rgbAvg] as Rgb, how: 'Messrahmen (Mittel)' };
  if (s.probe) { const rgb = s.readPixel(s.probe.x, s.probe.y); if (rgb) return { rgb, how: `Messpunkt ${s.probe.x}/${s.probe.y}` }; }
  return null;
}

export interface MatchContext {
  targets: ColorTarget[];
  sourceById: (id: string) => Source | null;
  display: DisplaySpace;
}

/** Source side (series mean when a series exists) and reference side, both in the source's encoding. */
export function matchValues(m: MatchSettings, src: Source, c: MatchContext) {
  const sp = spaceOf(src);
  let a: { rgb: Rgb; how: string } | null = measure(src);
  let spread: ReturnType<typeof aggregate> = null;
  if (m.series?.length) {
    const samples = m.series.map((v) => (m.seriesSpace ? convertSignal(v, m.seriesSpace, sp) : (v as Rgb)));
    spread = aggregate(samples, sp);
    if (spread) a = { rgb: spread.mean, how: `Mittel aus ${spread.n} Messungen` };
  }
  const ref = m.ref ?? '';
  let b: { rgb: Rgb; name: string; how: string } | null = null;
  if (ref.startsWith('src:')) {
    const o = c.sourceById(ref.slice(4));
    const mb = o ? measure(o) : null;
    if (o && mb) b = { rgb: convertSignal(mb.rgb, spaceOf(o), sp), name: o.name, how: mb.how };
    else if (o) b = null;
  } else if (ref.startsWith('target:')) {
    const t = c.targets.find((x) => x.name === ref.slice(7));
    if (t) b = { rgb: targetSignal(t, sp), name: t.name, how: t.ci ? `CI ${t.ci.interp === 'srgb' ? 'sRGB-Licht' : 'Videowert'}` : t.space ? 'gemessen' : 'Signalwert' };
  }
  return { a, b, spread, sp };
}

/** Redraw key: everything the panel's numbers depend on. */
export function matchSignature(m: MatchSettings | undefined, src: Source, c: MatchContext) {
  const ref = m?.ref ?? '';
  const o = ref.startsWith('src:') ? c.sourceById(ref.slice(4)) : null;
  const st = (s: Source) => `${s.id}:${s.frameSeq}:${s.statsVersion}:${s.probe?.x},${s.probe?.y}:${s.roi?.join(',')}`;
  return `M${st(src)}|${o ? st(o) : ''}|${JSON.stringify(c.targets)}`;
}

const MONO = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
const VERDICT = ['#4ade80', '#facc15', '#f87171'];
const f1 = (v: number) => v.toFixed(1).replace('.', ',');
const sg = (v: number, d = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d).replace('.', ',')}`;

function valueLines(rgb: Rgb, src: Source, sp: Space): string[] {
  const { y } = ycbcr(rgb[0], rgb[1], rgb[2], src.colorspace);
  const c10 = codes(rgb, 10, true);
  return [hexLine(rgb, sp), `10 bit ${c10.join(' ')}  Y′ ${f1(y * 100)} %`];
}

export function drawMatchPanel(ctx: CanvasRenderingContext2D, w: number, h: number, m: MatchSettings | undefined, src: Source, c: MatchContext) {
  const { a, b, spread, sp } = matchValues(m ?? {}, src, c);
  const pad = 10, gap = 10;
  const sw = (w - 2 * pad - gap) / 2, sh = Math.max(36, Math.min(110, h * 0.28));
  ctx.font = MONO; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
  const side = (x: number, title: string, sub: string, rgb: Rgb | null, empty: string) => {
    ctx.fillStyle = '#9aa0a8'; ctx.fillText(title, x, pad);
    ctx.fillStyle = '#6b7078'; ctx.fillText(sub, x, pad + 14);
    const y0 = pad + 30;
    if (!rgb) {
      ctx.strokeStyle = '#3a3f46'; ctx.setLineDash([4, 3]); ctx.strokeRect(x + 0.5, y0 + 0.5, sw - 1, sh - 1); ctx.setLineDash([]);
      ctx.fillStyle = '#6b7078'; ctx.fillText(empty, x + 6, y0 + sh / 2 - 6);
      return;
    }
    const sc = swatchCss(rgb, sp, c.display);
    ctx.fillStyle = sc.css; ctx.fillRect(x, y0, sw, sh);
    if (sc.clipped) { ctx.fillStyle = 'rgba(8,9,11,0.7)'; ctx.fillRect(x, y0 + sh - 15, sw, 15); ctx.fillStyle = '#facc15'; ctx.fillText('außerhalb Display-Gamut, beschnitten', x + 4, y0 + sh - 13); }
    ctx.fillStyle = '#d6d6d6';
    valueLines(rgb, src, sp).forEach((l, i) => ctx.fillText(l, x, y0 + sh + 6 + i * 14));
  };
  side(pad, `Quelle: ${src.name}`, a?.how ?? '', a?.rgb ?? null, 'Messpunkt setzen oder Rahmen ziehen');
  const refName = m?.ref ? (b ? `${m.ref.startsWith('src:') ? 'Referenz' : 'Ziel'}: ${b.name}` : 'Ziel: –') : 'Ziel: –';
  side(pad + sw + gap, refName, b?.how ?? '', b?.rgb ?? null, m?.ref?.startsWith('src:') ? 'Referenzquelle: Messpunkt/Rahmen setzen' : 'Ziel im ⚙ wählen');

  let y = pad + 30 + sh + 40;
  const line = (t: string, col = '#d6d6d6') => { if (y > h - 14) return; ctx.fillStyle = col; ctx.fillText(t, pad, y); y += 15; };
  if (!a || !b) {
    line(c.display === 'p3' ? 'Farbfelder für Display P3 umgerechnet' : `Farbfelder für ${c.display === 'srgb' ? 'sRGB-Display' : c.display}`, '#6b7078');
    return;
  }
  const cmp = compare(a.rgb, b.rgb, sp, src.colorspace);
  const v = deVerdict(cmp.de.value, m?.tol ?? 3);
  ctx.font = '600 20px ui-monospace, SFMono-Regular, Menlo, monospace'; ctx.fillStyle = VERDICT[v.level];
  ctx.fillText(`${cmp.de.metric} ${cmp.de.value.toFixed(2).replace('.', ',')}`, pad, y);
  ctx.font = MONO; ctx.fillStyle = '#9aa0a8';
  ctx.fillText(`${v.text}${cmp.de.metric === 'ΔITP' ? ' (Stufen wie ΔE00, für ΔITP nicht belegt)' : ''}`, pad + 170, y + 5);
  y += 28;
  line(`ΔL* ${sg(cmp.dL)}  ΔC* ${sg(cmp.dC)}  ΔH* ${sg(cmp.dH)}  (Lab, Ziel − Quelle)`);
  line(`Farbton ${f1(cmp.src.deg)}° → ${f1(cmp.ref.deg)}°   Sättigung ${f1(cmp.src.sat * 100)} → ${f1(cmp.ref.sat * 100)} %`);
  if (spread) line(`Messreihe: ${spread.n} Werte, Streuung ${cmp.de.metric} Ø ${f1(spread.avg)} / max ${f1(spread.max)} zum Mittel`, '#9aa0a8');
  y += 4;
  line('Korrektur der Quelle', '#9aa0a8');
  for (const t of correctionText(cmp, src.colorspace)) line(`· ${t}`);
  for (const t of cameraText(cmp, a.rgb, b.rgb, sp, src.colorspace)) line(`· ${t}`, '#b8bec6');
  if (isLog(sp.transfer)) line('Log-Quelle: CI-Ziele als Rec.709-Kamerasignal gelesen (Näherung)', '#6b7078');

  // mini vectorscope with the correction arrow (right of the text when there is room)
  const R = Math.min(90, (h - (pad + 30 + sh + 40)) / 2 - 6);
  if (w > 760 && R > 30) drawMiniVector(ctx, { x: w - pad - 2 * R, y: pad + 30 + sh + 40, w: 2 * R, h: 2 * R }, src, a.rgb, b.rgb);
}

function drawMiniVector(ctx: CanvasRenderingContext2D, r: Rect, src: Source, a: Rgb, b: Rgb) {
  const R = r.w / 2, cx = r.x + R, cy = r.y + R;
  // auto zoom: both points comfortably inside
  const ca = ycbcr(a[0], a[1], a[2], src.colorspace), cb = ycbcr(b[0], b[1], b[2], src.colorspace);
  const maxC = Math.max(Math.hypot(ca.cb, ca.cr), Math.hypot(cb.cb, cb.cr), 0.02);
  const k = (R * 0.85) / Math.min(0.6, maxC * 1.3);
  const pt = (c: { cb: number; cr: number }) => [cx + c.cb * k, cy - c.cr * k] as const;
  ctx.save();
  ctx.strokeStyle = 'rgba(210,190,120,0.3)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
  ctx.font = '9px ui-monospace, Menlo, monospace'; ctx.fillStyle = 'rgba(230,215,170,0.7)'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const t of barTargets(src.colorspace, 0.75)) {
    const ang = Math.atan2(t.cr, t.cb);
    ctx.fillText(t.label, cx + Math.cos(ang) * (R - 8), cy - Math.sin(ang) * (R - 8));
  }
  const [ax, ay] = pt(ca), [bx, by] = pt(cb);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  const ang = Math.atan2(by - ay, bx - ax);
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - 8 * Math.cos(ang - 0.4), by - 8 * Math.sin(ang - 0.4)); ctx.lineTo(bx - 8 * Math.cos(ang + 0.4), by - 8 * Math.sin(ang + 0.4)); ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.fillStyle = '#00dcff'; ctx.beginPath(); ctx.arc(ax, ay, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#6b7078'; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText(`×${(0.5 / Math.min(0.6, maxC * 1.3)).toFixed(1)}`, r.x + r.w, r.y + r.h + 10);
  ctx.restore();
}
