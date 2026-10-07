// ⚙ settings of the colour targets, the "Farbabgleich" panel and the green qualifier (issue #55).

import type { PanelState } from '../panel';
import type { SkinRange } from '../renderer';
import type { Source } from '../sources';
import {
  GREEN_DEFAULT, GREEN_PRESETS, INPUT_FORMATS, meanHue, parseColor, toHex, wedgeLumaRange, type ColorTarget, type InputFormat, type Interp, type Rgb,
} from './core';
import { measure, spaceOf } from './panel';
import { t } from '../i18n';

type Kid = Node | string;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Kid[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  el.append(...kids);
  return el;
};
const select = (value: string, options: [string, string][], onchange: (v: string) => void, title = '') =>
  h('select', { title, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
    ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
const row = (label: string, ...kids: Kid[]) => h('label', { class: 'mrow' }, h('span', {}, label), ...kids);
const num = (value: number, min: number, max: number, set: (v: number) => void) =>
  h('input', { type: 'number', class: 'num', min, max, step: 1, value, onchange: (e: Event) => set(Number((e.target as HTMLInputElement).value)) });

export interface MatchUi {
  targets: ColorTarget[];
  sources: Source[];
  save: () => void;
  /** rebuild the open menu (rows appear/disappear) */
  refresh: () => void;
  alert: (msg: string) => void;
}

// last used input settings (per session)
const input = { fmt: 'hex' as InputFormat, interp: 'video' as Interp, group: '' };

const groups = (list: ColorTarget[]) => [...new Set(list.map((x) => x.group ?? '').filter(Boolean))];
const uniqueName = (list: ColorTarget[], base: string) => { let n = base, i = 2; while (list.some((x) => x.name === n)) n = `${base} ${i++}`; return n; };
const targetCss = (tg: ColorTarget) => (tg.ci ? toHex(tg.ci.v) : `rgb(${tg.rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`);

/** Target list ("Kunden-CI") with input as hex/RGB, from the probe/ROI and from a logo. */
export function targetEditor(src: Source | null, c: MatchUi): Node[] {
  const rows: Node[] = [h('div', { class: 'mtitle' }, t('match.targetsTitle'))];
  const add = (tg: Omit<ColorTarget, 'name'> & { name?: string }) => {
    c.targets.push({ ...tg, name: uniqueName(c.targets, tg.name || t('match.targetN', { n: c.targets.length + 1 })), ...(input.group ? { group: input.group } : {}) });
    c.save(); c.refresh();
  };
  c.targets.forEach((tg, i) => {
    const name = h('input', { value: tg.name, title: t('match.name') }) as HTMLInputElement;
    name.onchange = () => { tg.name = uniqueName(c.targets.filter((x) => x !== tg), name.value.trim() || tg.name); c.save(); c.refresh(); };
    const info = tg.ci ? `${toHex(tg.ci.v)} ${tg.ci.interp === 'srgb' ? 'sRGB' : t('match.video')}` : tg.space ? t('match.measured') : t('match.signal');
    rows.push(h('div', { class: 'mrow', title: `${tg.group ? `${t('match.listPrefix', { group: tg.group })} · ` : ''}${info}` },
      h('span', { class: 'swatch', style: `background:${targetCss(tg)}` }), name,
      h('span', { class: 'hint' }, `${tg.group ? `${tg.group} · ` : ''}${info}`),
      h('button', { class: 'mini', title: t('match.remove'), onclick: () => { c.targets.splice(i, 1); c.save(); c.refresh(); } }, '✕')));
  });
  const grp = h('input', { value: input.group, placeholder: t('match.groupPlaceholder'), list: 'lzs-target-groups' }) as HTMLInputElement;
  grp.onchange = () => { input.group = grp.value.trim(); };
  rows.push(row(t('match.newTargetsIn'), grp, h('datalist', { id: 'lzs-target-groups' }, ...groups(c.targets).map((g) => h('option', { value: g })))));
  rows.push(h('div', { class: 'mrow' },
    h('button', { title: t('match.fromProbeTitle'), onclick: () => {
      const m = src && src.probe ? src.readPixel(src.probe.x, src.probe.y) : null;
      if (!src || !m) { c.alert(t('match.noValueProbe')); return; }
      add({ rgb: m, space: spaceOf(src), name: t('match.namePoint', { src: src.name }) });
    } }, t('match.fromProbe')),
    h('button', { title: t('match.fromRoiTitle'), onclick: () => {
      const m = src ? measure(src) : null;
      if (!src || !m || !src.activeRois().length) { c.alert(t('match.noValueRoi')); return; }
      add({ rgb: m.rgb, space: spaceOf(src), name: t('match.nameRoi', { src: src.name }) });
    } }, t('match.fromRoi')),
    h('button', { title: t('match.logoTitle'), onclick: () => openLogoPicker((v, name) => add({ rgb: v, ci: { v, interp: 'video' }, name })) }, t('match.logo'))));
  const text = h('input', { class: 'url', placeholder: t('match.colorPlaceholder') }) as HTMLInputElement;
  const addTyped = () => {
    const v = parseColor(text.value, input.fmt);
    if (!v) { c.alert(t('match.invalidFor', { fmt: INPUT_FORMATS.find(([k]) => k === input.fmt)![1] })); return; }
    const legal = input.fmt === 'legal8' || input.fmt === 'legal10';
    add({ rgb: v, ci: { v, interp: legal ? 'video' : input.interp }, name: input.fmt === 'hex' ? toHex(v) : text.value.trim() });
  };
  text.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } };
  rows.push(row(t('match.input'), select(input.fmt, INPUT_FORMATS, (v) => { input.fmt = v as InputFormat; })));
  rows.push(row(t('match.meaning'), select(input.interp, [['video', t('match.interpVideo')], ['srgb', t('match.interpSrgb')]], (v) => { input.interp = v as Interp; },
    t('match.interpTitle'))));
  rows.push(h('div', { class: 'mrow' }, text, h('button', { onclick: addTyped }, '+')));
  rows.push(h('div', { class: 'mrow' },
    h('button', { class: 'mini', title: t('match.exportTitle'), onclick: () => exportTargets(c.targets) }, t('match.export')),
    h('button', { class: 'mini', title: t('match.importTitle'), onclick: () => importTargets(c) }, t('match.import'))));
  return rows;
}

function exportTargets(list: ColorTarget[]) {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ lzScopesTargets: 1, targets: list }, null, 2)], { type: 'application/json' })), download: t('match.exportFileName') }) as HTMLAnchorElement;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Accepts our export and plain lists [{ name, hex, group? }]. */
export function parseTargetFile(json: unknown): ColorTarget[] {
  const list = Array.isArray(json) ? json : (json as { targets?: unknown[] })?.targets;
  if (!Array.isArray(list)) return [];
  const out: ColorTarget[] = [];
  for (const x of list as Record<string, unknown>[]) {
    if (!x || typeof x.name !== 'string') continue;
    const group = typeof x.group === 'string' ? x.group : undefined;
    if (typeof x.hex === 'string') {
      const v = parseColor(x.hex, 'hex');
      if (v) out.push({ name: x.name, rgb: v, ci: { v, interp: x.interp === 'srgb' ? 'srgb' : 'video' }, ...(group ? { group } : {}) });
    } else if (Array.isArray(x.rgb) && x.rgb.length === 3 && x.rgb.every((v) => typeof v === 'number')) {
      out.push({ ...(x as unknown as ColorTarget), name: x.name, ...(group ? { group } : {}) });
    }
  }
  return out;
}

function importTargets(c: MatchUi) {
  const f = h('input', { type: 'file', accept: '.json,application/json' }) as HTMLInputElement;
  f.onchange = async () => {
    const file = f.files?.[0];
    if (!file) return;
    try {
      const add = parseTargetFile(JSON.parse(await file.text()));
      if (!add.length) { c.alert(t('match.noTargetsInFile')); return; }
      for (const tg of add) c.targets.push({ ...tg, name: uniqueName(c.targets, tg.name) });
      c.save(); c.refresh();
    } catch { c.alert(t('match.invalidJson')); }
  };
  f.click();
}

/** Logo pipette: load an image (PNG/JPEG/SVG …), click = pixel, drag = mean of the rectangle (sRGB). */
export function openLogoPicker(onPick: (v: Rgb, name: string) => void) {
  const canvas = h('canvas', { class: 'logopick', width: 640, height: 200 }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!;
  let img: HTMLImageElement | null = null, pick: Rgb | null = null, sel: [number, number, number, number] | null = null;
  const sw = h('span', { class: 'swatch big' }), val = h('span', { class: 'hint' }, t('match.logoHint'));
  const name = h('input', { placeholder: t('match.logoNamePlaceholder') }) as HTMLInputElement;
  const draw = () => {
    if (!img) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };
  const read = (x0: number, y0: number, x1: number, y1: number) => {
    draw();
    const w = Math.max(1, x1 - x0), hh = Math.max(1, y1 - y0);
    const d = ctx.getImageData(x0, y0, w, hh).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; } // transparent pixels ignored
    if (!n) { val.textContent = t('match.onlyTransparent'); return; }
    pick = [r / n / 255, g / n / 255, b / n / 255];
    sw.setAttribute('style', `background:${toHex(pick)}`);
    val.textContent = `${toHex(pick)}  RGB ${pick.map((v) => Math.round(v * 255)).join(',')}  ${w * hh > 1 ? t('match.meanPx', { n }) : t('match.pixel')}`;
    if (w * hh > 1) { ctx.strokeStyle = '#00dcff'; ctx.lineWidth = 2; ctx.strokeRect(x0, y0, w, hh); }
  };
  const at = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return [Math.floor(((e.clientX - r.left) / r.width) * canvas.width), Math.floor(((e.clientY - r.top) / r.height) * canvas.height)] as const;
  };
  canvas.addEventListener('pointerdown', (e) => { if (!img) return; const [x, y] = at(e); sel = [x, y, x, y]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (!sel) return; const [x, y] = at(e); sel[2] = x; sel[3] = y; });
  canvas.addEventListener('pointerup', () => {
    if (!sel) return;
    const [a, b, c2, d] = sel; sel = null;
    read(Math.min(a, c2), Math.min(b, d), Math.max(a, c2) + 1, Math.max(b, d) + 1);
  });
  const file = h('input', { type: 'file', accept: 'image/*,.svg' }) as HTMLInputElement;
  file.onchange = () => {
    const f = file.files?.[0];
    if (!f) return;
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, 4096 / Math.max(im.naturalWidth || 1, im.naturalHeight || 1));
      canvas.width = Math.max(1, Math.round((im.naturalWidth || 640) * s)); canvas.height = Math.max(1, Math.round((im.naturalHeight || 200) * s));
      img = im; draw();
      if (!name.value) name.value = f.name.replace(/\.[^.]+$/, '');
    };
    im.onerror = () => { val.textContent = t('match.imageUnreadable'); };
    im.src = URL.createObjectURL(f);
  };
  const dlg = h('dialog', { class: 'lutlib logodlg' },
    h('h3', {}, t('match.logoDlgTitle')),
    h('p', { class: 'hint' }, t('match.logoDlgHint')),
    h('div', { class: 'row' }, file),
    canvas,
    h('div', { class: 'row' }, sw, val),
    h('div', { class: 'row' }, name,
      h('button', { onclick: () => { if (!pick) return; onPick(pick, name.value.trim() || toHex(pick)); dlg.close(); } }, t('match.useAsTarget')),
      h('button', { onclick: () => dlg.close() }, t('match.close'))));
  document.body.append(dlg);
  dlg.addEventListener('close', () => { if (img) URL.revokeObjectURL(img.src); dlg.remove(); });
  dlg.showModal();
}

/** ⚙ rows of the "Farbabgleich" panel. */
export function matchPanelSettings(p: PanelState, src: Source | null, c: MatchUi): Node[] {
  const m = (p.match ??= {});
  const rows: Node[] = [];
  const opts: [string, string][] = [['', t('match.choose')],
    ...c.targets.map((tg) => [`target:${tg.name}`, t('match.optTarget', { name: `${tg.group ? `${tg.group} · ` : ''}${tg.name}` })] as [string, string]),
    ...c.sources.filter((s) => s !== src && s.kind !== 'audio').map((s) => [`src:${s.id}`, t('match.optRefCam', { name: s.name })] as [string, string])];
  rows.push(row(t('match.compareWith'), select(m.ref ?? '', opts, (v) => { m.ref = v || undefined; c.save(); },
    t('match.compareWithTitle'))));
  rows.push(row(t('match.tolerance'), select(String(m.tol ?? 3), [['2', 'ΔE 2'], ['3', 'ΔE 3'], ['5', 'ΔE 5']], (v) => { m.tol = Number(v); c.save(); },
    t('match.toleranceTitle'))));
  const n = m.series?.length ?? 0;
  rows.push(h('div', { class: 'mrow' },
    h('button', { title: t('match.addSeriesTitle'), onclick: () => {
      const v = src ? measure(src) : null;
      if (!src || !v) { c.alert(t('match.needProbeOrRoi')); return; }
      const sp = spaceOf(src);
      if (m.seriesSpace && JSON.stringify(m.seriesSpace) !== JSON.stringify(sp)) m.series = [];
      m.series = [...(m.series ?? []), v.rgb]; m.seriesSpace = sp; c.save(); c.refresh();
    } }, `${t('match.addSeries')}${n ? ` (${n})` : ''}`),
    n ? h('button', { class: 'mini', onclick: () => { m.series = undefined; m.seriesSpace = undefined; c.save(); c.refresh(); } }, t('match.clearSeries')) : ''));
  rows.push(h('p', { class: 'hint narrow' }, t('match.panelHint')));
  return [...rows, ...targetEditor(src, c)];
}

/** Green/grass qualifier rows (waveform "Grüntöne", vectorscope wedge, picture overlay). */
export function greenSettings(g: SkinRange, src: Source | null, c: MatchUi, withRoi: boolean): Node[] {
  const set = (patch: Partial<SkinRange>) => { Object.assign(g, patch); c.save(); };
  const rows: Node[] = [
    row(t('match.greenLuma'), num(Math.round(g.lo * 100), 0, 100, (v) => set({ lo: v / 100 })), '–', num(Math.round(g.hi * 100), 0, 100, (v) => set({ hi: v / 100 })), '%'),
    row(t('match.greenHue'), num(Math.round(g.hue ?? GREEN_DEFAULT.hue), 0, 359, (v) => set({ hue: ((v % 360) + 360) % 360 })), '° ±', num(g.tol, 2, 60, (v) => set({ tol: v })), '°'),
    row(t('match.preset'), select('', [['', t('match.bt2408Levels')], ...GREEN_PRESETS.map((p) => [p.id, p.label] as [string, string]), ['default', t('match.greenDefault')]], (v) => {
      const p = GREEN_PRESETS.find((x) => x.id === v);
      if (p) set({ lo: p.lo, hi: p.hi }); else if (v === 'default') set({ ...GREEN_DEFAULT });
      c.refresh();
    }, t('match.presetTitle'))),
  ];
  if (withRoi) {
    rows.push(row('', h('button', { title: t('match.fromRoiRangeTitle'), onclick: () => {
      const s = src?.roiSamples() ?? [];
      const cs = src?.colorspace ?? '709';
      const hue = meanHue(s, cs);
      if (hue === null) { c.alert(t('match.tooFewSaturated')); return; }
      const r = wedgeLumaRange(s, cs, hue, g.tol);
      if (!r) { c.alert(t('match.tooFewInWedge')); return; }
      set({ hue: Math.round(hue), lo: Math.round(r.lo * 100) / 100, hi: Math.round(r.hi * 100) / 100 }); c.refresh();
    } }, t('match.rangeFromRoi'))));
    rows.push(h('p', { class: 'hint narrow' }, t('match.greenHint')));
  }
  return rows;
}
