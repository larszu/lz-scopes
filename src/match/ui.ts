// ⚙ settings of the colour targets, the "Farbabgleich" panel and the green qualifier (issue #55).

import type { PanelState } from '../panel';
import type { SkinRange } from '../renderer';
import type { Source } from '../sources';
import {
  GREEN_DEFAULT, GREEN_PRESETS, INPUT_FORMATS, meanHue, parseColor, toHex, wedgeLumaRange, type ColorTarget, type InputFormat, type Interp, type Rgb,
} from './core';
import { measure, spaceOf } from './panel';

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

const groups = (t: ColorTarget[]) => [...new Set(t.map((x) => x.group ?? '').filter(Boolean))];
const uniqueName = (t: ColorTarget[], base: string) => { let n = base, i = 2; while (t.some((x) => x.name === n)) n = `${base} ${i++}`; return n; };
const targetCss = (t: ColorTarget) => (t.ci ? toHex(t.ci.v) : `rgb(${t.rgb.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`);

/** Target list ("Kunden-CI") with input as hex/RGB, from the probe/ROI and from a logo. */
export function targetEditor(src: Source | null, c: MatchUi): Node[] {
  const rows: Node[] = [h('div', { class: 'mtitle' }, 'Farbziele (Color Matching, Kunden-CI)')];
  const add = (t: Omit<ColorTarget, 'name'> & { name?: string }) => {
    c.targets.push({ ...t, name: uniqueName(c.targets, t.name || `Ziel ${c.targets.length + 1}`), ...(input.group ? { group: input.group } : {}) });
    c.save(); c.refresh();
  };
  c.targets.forEach((t, i) => {
    const name = h('input', { value: t.name, title: 'Name' }) as HTMLInputElement;
    name.onchange = () => { t.name = uniqueName(c.targets.filter((x) => x !== t), name.value.trim() || t.name); c.save(); c.refresh(); };
    const info = t.ci ? `${toHex(t.ci.v)} ${t.ci.interp === 'srgb' ? 'sRGB' : 'Video'}` : t.space ? 'gemessen' : 'Signal';
    rows.push(h('div', { class: 'mrow', title: `${t.group ? `Liste ${t.group} · ` : ''}${info}` },
      h('span', { class: 'swatch', style: `background:${targetCss(t)}` }), name,
      h('span', { class: 'hint' }, `${t.group ? `${t.group} · ` : ''}${info}`),
      h('button', { class: 'mini', title: 'Entfernen', onclick: () => { c.targets.splice(i, 1); c.save(); c.refresh(); } }, '✕')));
  });
  const grp = h('input', { value: input.group, placeholder: 'Liste, z. B. Kunden-CI', list: 'lzs-target-groups' }) as HTMLInputElement;
  grp.onchange = () => { input.group = grp.value.trim(); };
  rows.push(row('Neue Ziele in', grp, h('datalist', { id: 'lzs-target-groups' }, ...groups(c.targets).map((g) => h('option', { value: g })))));
  rows.push(h('div', { class: 'mrow' },
    h('button', { title: 'Farbe des Messpunkts (Klick ins Bild) als Ziel – mit der Codierung der Quelle gespeichert', onclick: () => {
      const m = src && src.probe ? src.readPixel(src.probe.x, src.probe.y) : null;
      if (!src || !m) { c.alert('Kein Wert – erst Messpunkt setzen'); return; }
      add({ rgb: m, space: spaceOf(src), name: `${src.name} Punkt` });
    } }, '+ Messpunkt'),
    h('button', { title: 'Mittelwert des Messrahmens als Ziel – z. B. Referenzkamera', onclick: () => {
      const m = src ? measure(src) : null;
      if (!src || !m || !src.activeRois().length) { c.alert('Kein Wert – erst Messrahmen ziehen'); return; }
      add({ rgb: m.rgb, space: spaceOf(src), name: `${src.name} Rahmen` });
    } }, '+ Messrahmen'),
    h('button', { title: 'Logo oder Farbmuster laden und Farbe daraus picken (Pixel oder Rahmen-Mittel)', onclick: () => openLogoPicker((v, name) => add({ rgb: v, ci: { v, interp: 'video' }, name })) }, 'Logo …')));
  const text = h('input', { class: 'url', placeholder: '#E2001A oder 226 0 26' }) as HTMLInputElement;
  const addTyped = () => {
    const v = parseColor(text.value, input.fmt);
    if (!v) { c.alert(`Ungültig für ${INPUT_FORMATS.find(([k]) => k === input.fmt)![1]}`); return; }
    const legal = input.fmt === 'legal8' || input.fmt === 'legal10';
    add({ rgb: v, ci: { v, interp: legal ? 'video' : input.interp }, name: input.fmt === 'hex' ? toHex(v) : text.value.trim() });
  };
  text.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(); } };
  rows.push(row('Eingabe', select(input.fmt, INPUT_FORMATS, (v) => { input.fmt = v as InputFormat; })));
  rows.push(row('Bedeutung', select(input.interp, [['video', 'Videowert (Grafik-Workflow)'], ['srgb', 'sRGB-Licht (Bildschirm)']], (v) => { input.interp = v as Interp; },
    'Videowert: #RRGGBB/255 ist das Rec.709-Signal (0 → 16, 255 → 235), wie Grafik in Mischer und Resolve. sRGB-Licht: die Farbe, die ein sRGB-Monitor zeigt; das Signal folgt aus BT.1886 – Schatten werden heller. Gilt nicht für 16–235/64–940.')));
  rows.push(h('div', { class: 'mrow' }, text, h('button', { onclick: addTyped }, '+')));
  rows.push(h('div', { class: 'mrow' },
    h('button', { class: 'mini', title: 'Zielliste als JSON-Datei sichern', onclick: () => exportTargets(c.targets) }, 'Export'),
    h('button', { class: 'mini', title: 'Zielliste aus JSON-Datei hinzufügen', onclick: () => importTargets(c) }, 'Import')));
  return rows;
}

function exportTargets(t: ColorTarget[]) {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify({ lzScopesTargets: 1, targets: t }, null, 2)], { type: 'application/json' })), download: 'farbziele.json' }) as HTMLAnchorElement;
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
      if (!add.length) { c.alert('Keine Ziele in der Datei'); return; }
      for (const t of add) c.targets.push({ ...t, name: uniqueName(c.targets, t.name) });
      c.save(); c.refresh();
    } catch { c.alert('Datei ist kein gültiges JSON'); }
  };
  f.click();
}

/** Logo pipette: load an image (PNG/JPEG/SVG …), click = pixel, drag = mean of the rectangle (sRGB). */
export function openLogoPicker(onPick: (v: Rgb, name: string) => void) {
  const canvas = h('canvas', { class: 'logopick', width: 640, height: 200 }) as HTMLCanvasElement;
  const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!;
  let img: HTMLImageElement | null = null, pick: Rgb | null = null, sel: [number, number, number, number] | null = null;
  const sw = h('span', { class: 'swatch big' }), val = h('span', { class: 'hint' }, 'Bild laden, dann klicken (Pixel) oder Rahmen ziehen (Mittel)');
  const name = h('input', { placeholder: 'Name, z. B. CI Rot' }) as HTMLInputElement;
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
    if (!n) { val.textContent = 'nur transparente Pixel'; return; }
    pick = [r / n / 255, g / n / 255, b / n / 255];
    sw.setAttribute('style', `background:${toHex(pick)}`);
    val.textContent = `${toHex(pick)}  RGB ${pick.map((v) => Math.round(v * 255)).join(',')}  ${w * hh > 1 ? `Mittel ${n} px` : 'Pixel'}`;
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
    im.onerror = () => { val.textContent = 'Bild nicht lesbar'; };
    im.src = URL.createObjectURL(f);
  };
  const dlg = h('dialog', { class: 'lutlib logodlg' },
    h('h3', {}, 'Farbe aus Logo picken'),
    h('p', { class: 'hint' }, 'Der Browser wandelt eingebettete Farbprofile nach sRGB; gepickt wird der sRGB-Codewert. Für Druck-CI (CMYK, Pantone) die vom Kunden genannten RGB-/Hex-Werte eintragen – eine eigene Umrechnung wäre geraten.'),
    h('div', { class: 'row' }, file),
    canvas,
    h('div', { class: 'row' }, sw, val),
    h('div', { class: 'row' }, name,
      h('button', { onclick: () => { if (!pick) return; onPick(pick, name.value.trim() || toHex(pick)); dlg.close(); } }, 'Als Ziel übernehmen'),
      h('button', { onclick: () => dlg.close() }, 'Schließen')));
  document.body.append(dlg);
  dlg.addEventListener('close', () => { if (img) URL.revokeObjectURL(img.src); dlg.remove(); });
  dlg.showModal();
}

/** ⚙ rows of the "Farbabgleich" panel. */
export function matchPanelSettings(p: PanelState, src: Source | null, c: MatchUi): Node[] {
  const m = (p.match ??= {});
  const rows: Node[] = [];
  const opts: [string, string][] = [['', '– wählen –'],
    ...c.targets.map((t) => [`target:${t.name}`, `Ziel: ${t.group ? `${t.group} · ` : ''}${t.name}`] as [string, string]),
    ...c.sources.filter((s) => s !== src && s.kind !== 'audio').map((s) => [`src:${s.id}`, `Referenzkamera: ${s.name}`] as [string, string])];
  rows.push(row('Vergleich mit', select(m.ref ?? '', opts, (v) => { m.ref = v || undefined; c.save(); },
    'Ziel = Farbziel (CI, gemessen); Referenzkamera = Messpunkt bzw. Messrahmen einer anderen Quelle auf demselben Objekt')));
  rows.push(row('Toleranz', select(String(m.tol ?? 3), [['2', 'ΔE 2'], ['3', 'ΔE 3'], ['5', 'ΔE 5']], (v) => { m.tol = Number(v); c.save(); },
    'Grün bis ΔE 1 (eben merklich), gelb bis zur Toleranz, darüber rot')));
  const n = m.series?.length ?? 0;
  rows.push(h('div', { class: 'mrow' },
    h('button', { title: 'Aktuellen Messwert (Rahmen-Mittel oder Punkt) zur Reihe nehmen – Effektlack: mehrere Stellen bzw. Winkel messen', onclick: () => {
      const v = src ? measure(src) : null;
      if (!src || !v) { c.alert('Erst Messpunkt setzen oder Rahmen ziehen'); return; }
      const sp = spaceOf(src);
      if (m.seriesSpace && JSON.stringify(m.seriesSpace) !== JSON.stringify(sp)) m.series = [];
      m.series = [...(m.series ?? []), v.rgb]; m.seriesSpace = sp; c.save(); c.refresh();
    } }, `+ Messreihe${n ? ` (${n})` : ''}`),
    n ? h('button', { class: 'mini', onclick: () => { m.series = undefined; m.seriesSpace = undefined; c.save(); c.refresh(); } }, 'Reihe löschen') : ''));
  rows.push(h('p', { class: 'hint' }, 'Gemessen wird der Messrahmen (Mittel) bzw. der Messpunkt im Bild-Panel dieser Quelle. Effekt- und Metalliclacke ändern ihre Farbe mit dem Winkel: über eine Fläche messen und mehrere Stellen zur Reihe nehmen; gleiche Werte an wenigen Stellen garantieren noch keinen visuellen Abgleich.'));
  return [...rows, ...targetEditor(src, c)];
}

/** Green/grass qualifier rows (waveform "Grüntöne", vectorscope wedge, picture overlay). */
export function greenSettings(g: SkinRange, src: Source | null, c: MatchUi, withRoi: boolean): Node[] {
  const set = (patch: Partial<SkinRange>) => { Object.assign(g, patch); c.save(); };
  const rows: Node[] = [
    row('Grün Luma', num(Math.round(g.lo * 100), 0, 100, (v) => set({ lo: v / 100 })), '–', num(Math.round(g.hi * 100), 0, 100, (v) => set({ hi: v / 100 })), '%'),
    row('Grün Farbton', num(Math.round(g.hue ?? GREEN_DEFAULT.hue), 0, 359, (v) => set({ hue: ((v % 360) + 360) % 360 })), '° ±', num(g.tol, 2, 60, (v) => set({ tol: v })), '°'),
    row('Vorgabe', select('', [['', 'BT.2408-Pegel …'], ...GREEN_PRESETS.map((p) => [p.id, p.label] as [string, string]), ['default', 'Standard (198° ± 20°, 40–55 %)']], (v) => {
      const p = GREEN_PRESETS.find((x) => x.id === v);
      if (p) set({ lo: p.lo, hi: p.hi }); else if (v === 'default') set({ ...GREEN_DEFAULT });
      c.refresh();
    }, 'BT.2408-8 Tab. 2 nennt Rasen-Pegel nur für HDR (HLG 40–55 %, PQ 40–45 %); für SDR gibt es keinen Normwert')),
  ];
  if (withRoi) {
    rows.push(row('', h('button', { title: 'Messrahmen im Bild auf den Rasen ziehen, dann hier übernehmen: Farbton = Mittel, Luma = 5.–95. Perzentil', onclick: () => {
      const s = src?.roiSamples() ?? [];
      const cs = src?.colorspace ?? '709';
      const hue = meanHue(s, cs);
      if (hue === null) { c.alert('Zu wenig gesättigte Pixel im Messrahmen'); return; }
      const r = wedgeLumaRange(s, cs, hue, g.tol);
      if (!r) { c.alert('Zu wenig Pixel im Farbkeil'); return; }
      set({ hue: Math.round(hue), lo: Math.round(r.lo * 100) / 100, hi: Math.round(r.hi * 100) / 100 }); c.refresh();
    } }, 'Bereich aus Messrahmen')));
    rows.push(h('p', { class: 'hint' }, 'Im Waveform: Linien ziehen = Luma-Bereich, Mausrad = Farbton-Toleranz.'));
  }
  return rows;
}
