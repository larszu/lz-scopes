// ⚙ settings of the colour targets, the "Farbabgleich" panel and the green qualifier (issue #55).

import type { PanelState } from '../panel';
import type { SkinRange } from '../renderer';
import type { Source } from '../sources';
import {
  GREEN_DEFAULT, GREEN_PRESETS, INPUT_FORMATS, meanHue, parseColor, toHex, wedgeLumaRange, type ColorTarget, type InputFormat, type Interp, type Rgb,
} from './core';
import { measure, spaceOf } from './panel';
import { t } from '../i18n';
import { button, download, field, filePicker, h, hint, iconButton, kicker, numberInput, openModal, row as line, select, textInput } from '../ui';

const row = field;

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
  const rows: Node[] = [kicker(t('match.targetsTitle'))];
  const add = (tg: Omit<ColorTarget, 'name'> & { name?: string }) => {
    c.targets.push({ ...tg, name: uniqueName(c.targets, tg.name || t('match.targetN', { n: c.targets.length + 1 })), ...(input.group ? { group: input.group } : {}) });
    c.save(); c.refresh();
  };
  c.targets.forEach((tg, i) => {
    const name = textInput(tg.name, (v) => { tg.name = uniqueName(c.targets.filter((x) => x !== tg), v.trim() || tg.name); c.save(); c.refresh(); }, { title: t('match.name') });
    const info = tg.ci ? `${toHex(tg.ci.v)} ${tg.ci.interp === 'srgb' ? 'sRGB' : t('match.video')}` : tg.space ? t('match.measured') : t('match.signal');
    rows.push(h('div', { class: 'field target', title: `${tg.group ? `${t('match.listPrefix', { group: tg.group })} · ` : ''}${info}` },
      h('span', { class: 'swatch', style: `background:${targetCss(tg)}` }), name,
      h('span', { class: 'hint' }, `${tg.group ? `${tg.group} · ` : ''}${info}`),
      iconButton('✕', t('match.remove'), () => { c.targets.splice(i, 1); c.save(); c.refresh(); }, { small: true })));
  });
  const grp = textInput(input.group, (v) => { input.group = v.trim(); }, { placeholder: t('match.groupPlaceholder'), attrs: { list: 'lzs-target-groups' } });
  rows.push(row(t('match.newTargetsIn'), grp, h('datalist', { id: 'lzs-target-groups' }, ...groups(c.targets).map((g) => h('option', { value: g })))));
  rows.push(line(
    button(t('match.fromProbe'), () => {
      const m = src && src.probe ? src.readPixel(src.probe.x, src.probe.y) : null;
      if (!src || !m) { c.alert(t('match.noValueProbe')); return; }
      add({ rgb: m, space: spaceOf(src), name: t('match.namePoint', { src: src.name }) });
    }, { title: t('match.fromProbeTitle') }),
    button(t('match.fromRoi'), () => {
      const m = src ? measure(src) : null;
      if (!src || !m || !src.activeRois().length) { c.alert(t('match.noValueRoi')); return; }
      add({ rgb: m.rgb, space: spaceOf(src), name: t('match.nameRoi', { src: src.name }) });
    }, { title: t('match.fromRoiTitle') }),
    button(t('match.logo'), () => openLogoPicker((v, name) => add({ rgb: v, ci: { v, interp: 'video' }, name })), { title: t('match.logoTitle') })));
  const addTyped = () => {
    const v = parseColor(text.value, input.fmt);
    if (!v) { c.alert(t('match.invalidFor', { fmt: INPUT_FORMATS.find(([k]) => k === input.fmt)![1] })); return; }
    const legal = input.fmt === 'legal8' || input.fmt === 'legal10';
    add({ rgb: v, ci: { v, interp: legal ? 'video' : input.interp }, name: input.fmt === 'hex' ? toHex(v) : text.value.trim() });
  };
  const text = textInput('', () => {}, { placeholder: t('match.colorPlaceholder'), mono: true, onEnter: () => addTyped() });
  rows.push(row(t('match.input'), select(input.fmt, INPUT_FORMATS, (v) => { input.fmt = v as InputFormat; })));
  rows.push(row(t('match.meaning'), select(input.interp, [['video', t('match.interpVideo')], ['srgb', t('match.interpSrgb')]], (v) => { input.interp = v as Interp; },
    t('match.interpTitle'))));
  rows.push(line(text, button('+', addTyped)));
  rows.push(line(
    button(t('match.export'), () => exportTargets(c.targets), { small: true, title: t('match.exportTitle') }),
    button(t('match.import'), () => importTargets(c), { small: true, title: t('match.importTitle') })));
  return rows;
}

function exportTargets(list: ColorTarget[]) {
  download(t('match.exportFileName'), JSON.stringify({ lzScopesTargets: 1, targets: list }, null, 2), 'application/json');
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
  filePicker('.json,application/json', async ([file]) => {
    try {
      const add = parseTargetFile(JSON.parse(await file.text()));
      if (!add.length) { c.alert(t('match.noTargetsInFile')); return; }
      for (const tg of add) c.targets.push({ ...tg, name: uniqueName(c.targets, tg.name) });
      c.save(); c.refresh();
    } catch { c.alert(t('match.invalidJson')); }
  }).pick();
}

/** Logo pipette: load an image (PNG/JPEG/SVG …), click = pixel, drag = mean of the rectangle (sRGB). */
export function openLogoPicker(onPick: (v: Rgb, name: string) => void) {
  const canvas = h('canvas', { class: 'logopick', width: 640, height: 200 });
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!;
  let img: HTMLImageElement | null = null, pick: Rgb | null = null, sel: [number, number, number, number] | null = null;
  const sw = h('span', { class: 'swatch big' }), val = h('span', { class: 'hint' }, t('match.logoHint'));
  const name = textInput('', () => {}, { placeholder: t('match.logoNamePlaceholder') });
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
  const file = filePicker('image/*,.svg', ([f]) => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, 4096 / Math.max(im.naturalWidth || 1, im.naturalHeight || 1));
      canvas.width = Math.max(1, Math.round((im.naturalWidth || 640) * s)); canvas.height = Math.max(1, Math.round((im.naturalHeight || 200) * s));
      img = im; draw();
      if (!name.value) name.value = f.name.replace(/\.[^.]+$/, '');
    };
    im.onerror = () => { val.textContent = t('match.imageUnreadable'); };
    im.src = URL.createObjectURL(f);
  });
  const dlg = openModal({
    title: t('match.logoDlgTitle'), cls: 'logodlg', size: 'lg',
    body: [hint(t('match.logoDlgHint')), line(button(t('match.logo'), () => file.pick()), file.input), canvas, line(sw, val)],
    actions: [name,
      button(t('match.useAsTarget'), () => { if (!pick) return; onPick(pick, name.value.trim() || toHex(pick)); dlg.close(); }, { variant: 'primary' }),
      button(t('match.close'), () => dlg.close())],
    onClose: () => { if (img) URL.revokeObjectURL(img.src); },
  });
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
  rows.push(line(
    button(`${t('match.addSeries')}${n ? ` (${n})` : ''}`, () => {
      const v = src ? measure(src) : null;
      if (!src || !v) { c.alert(t('match.needProbeOrRoi')); return; }
      const sp = spaceOf(src);
      if (m.seriesSpace && JSON.stringify(m.seriesSpace) !== JSON.stringify(sp)) m.series = [];
      m.series = [...(m.series ?? []), v.rgb]; m.seriesSpace = sp; c.save(); c.refresh();
    }, { title: t('match.addSeriesTitle') }),
    n > 0 && button(t('match.clearSeries'), () => { m.series = undefined; m.seriesSpace = undefined; c.save(); c.refresh(); }, { small: true })));
  rows.push(hint(t('match.panelHint')));
  return [...rows, ...targetEditor(src, c)];
}

/** Green/grass qualifier rows (waveform "Grüntöne", vectorscope wedge, picture overlay). */
export function greenSettings(g: SkinRange, src: Source | null, c: MatchUi, withRoi: boolean): Node[] {
  const set = (patch: Partial<SkinRange>) => { Object.assign(g, patch); c.save(); };
  const rows: Node[] = [
    row(t('match.greenLuma'), numberInput(Math.round(g.lo * 100), (v) => set({ lo: v / 100 }), { min: 0, max: 100, size: 's' }), '–', numberInput(Math.round(g.hi * 100), (v) => set({ hi: v / 100 }), { min: 0, max: 100, size: 's' }), '%'),
    row(t('match.greenHue'), numberInput(Math.round(g.hue ?? GREEN_DEFAULT.hue), (v) => set({ hue: ((v % 360) + 360) % 360 }), { min: 0, max: 359, size: 's' }), '° ±', numberInput(g.tol, (v) => set({ tol: v }), { min: 2, max: 60, size: 's' }), '°'),
    row(t('match.preset'), select('', [['', t('match.bt2408Levels')], ...GREEN_PRESETS.map((p) => [p.id, p.label] as [string, string]), ['default', t('match.greenDefault')]], (v) => {
      const p = GREEN_PRESETS.find((x) => x.id === v);
      if (p) set({ lo: p.lo, hi: p.hi }); else if (v === 'default') set({ ...GREEN_DEFAULT });
      c.refresh();
    }, t('match.presetTitle'))),
  ];
  if (withRoi) {
    rows.push(row('', button(t('match.rangeFromRoi'), () => {
      const s = src?.roiSamples() ?? [];
      const cs = src?.colorspace ?? '709';
      const hue = meanHue(s, cs);
      if (hue === null) { c.alert(t('match.tooFewSaturated')); return; }
      const r = wedgeLumaRange(s, cs, hue, g.tol);
      if (!r) { c.alert(t('match.tooFewInWedge')); return; }
      set({ hue: Math.round(hue), lo: Math.round(r.lo * 100) / 100, hi: Math.round(r.hi * 100) / 100 }); c.refresh();
    }, { title: t('match.fromRoiRangeTitle') })));
    rows.push(hint(t('match.greenHint')));
  }
  return rows;
}
