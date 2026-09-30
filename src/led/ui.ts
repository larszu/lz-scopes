// LED wall tool (#10): wall configuration, LED test patterns and the camera-based check,
// as one dialog of the main window. The wall itself is calibrated by its processor
// (Brompton Tessera, NovaStar NovaLCT/NovaCLB, Colorlight) – the dialog says so.

import type { Source } from '../sources';
import {
  analyseWall, angleSeries, cameraMatrix, compareResults, findOutlierPixels, locateOnWall, ocioMatrix, project,
  reportCsv, scanLineIndex, wallToImage, bbox, type CameraTransfer, type DeltaStat, type Frame, type PixelHit, type Pt, type WallResult,
} from './analysis';
import { LED_PATTERNS } from './patterns';
import {
  PATCH_PRESETS, cabinets, deleteWall, ledSettings, parsePatchList, pictureSize, saveWall, savedWalls, setLedSettings, wallSize,
  type LedSettings, type WallConfig,
} from './wall';
import { bt709InverseOetf } from '../color';

export interface LedHost {
  sources: () => Source[];
  /** show an LED pattern at w×h in a pattern source and open the output window */
  showPattern: (id: string, w: number, h: number) => void;
  /** LED settings changed: redraw pattern sources that show LED patterns */
  patternsChanged: () => void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
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
const numIn = (value: number, title: string, onchange: (n: number) => void, step = '1', width = 64) => {
  const i = h('input', { type: 'number', value: String(value), step, title, style: `width:${width}px` }) as HTMLInputElement;
  i.onchange = () => { const n = Number(i.value); if (Number.isFinite(n)) onchange(n); };
  return i;
};
const sel = (value: string, opts: [string, string][], onchange: (v: string) => void, title = '') =>
  h('select', { title, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
const lab = (text: string, ...kids: (Node | string)[]) => h('label', { class: 'inline' }, text, ...kids);
const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');
const signed = (v: number, d = 1) => (Number.isFinite(v) ? `${v > 0 ? '+' : ''}${fmt(v, d)}` : '–');

function download(name: string, blob: Blob) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name }) as HTMLAnchorElement;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

const CSS = `
dialog.ledtool { width: min(1180px, 96vw); max-height: 94vh; background: var(--card-bg, #111316); color: var(--text, #d9dce0); border: 1px solid var(--line-2, #2d3238); border-radius: var(--radius-lg, 8px); padding: 12px 14px; }
dialog.ledtool::backdrop { background: var(--modal-bg, rgba(0,0,0,.55)); }
.ledtool h3 { margin: 0 0 4px; font-size: 15px; }
.ledtool details { border-top: 1px solid var(--line, #22262b); padding: 8px 0; }
.ledtool summary { cursor: pointer; font-weight: 600; }
.ledtool .row { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-top: 6px; }
.ledtool .note { color: #ffb44a; }
.ledtool canvas.cam { width: 100%; max-height: 60vh; object-fit: contain; background: #000; cursor: crosshair; border: 1px solid var(--line-2, #2d3238); }
.ledtool canvas.heat { width: 100%; background: #000; border: 1px solid var(--line-2, #2d3238); }
.ledtool table { border-collapse: collapse; font-size: 12px; margin-top: 6px; }
.ledtool td, .ledtool th { border-bottom: 1px solid var(--line, #22262b); padding: 2px 8px; text-align: right; font-variant-numeric: tabular-nums; }
.ledtool th { color: var(--muted, #8a9098); font-weight: 500; }
.ledtool td:first-child, .ledtool th:first-child { text-align: left; }
.ledtool textarea { width: 260px; height: 70px; font: 11px ui-monospace, Menlo, monospace; background: var(--field-bg, #181b1f); color: var(--text, #d9dce0); border: 1px solid var(--line-2, #2d3238); }
.ledtool .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
@media (max-width: 800px) { .ledtool .cols { grid-template-columns: 1fr; } }
`;

/** Copy the current frame of a source into an RGB float frame (at most 3840 px wide). */
export function grabFrame(s: Source): Frame | null {
  if (!s.ready) return null;
  if (s.data) {
    const scale = s.depth === 16 ? 65535 : 255, st = Math.max(1, Math.ceil(s.width / 3840));
    const w = Math.floor(s.width / st), hh = Math.floor(s.height / st), rgb = new Float32Array(w * hh * 3);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const i = (y * st * s.width + x * st) * 4, o = (y * w + x) * 3;
      rgb[o] = s.data[i] / scale; rgb[o + 1] = s.data[i + 1] / scale; rgb[o + 2] = s.data[i + 2] / scale;
    }
    return { width: w, height: hh, rgb };
  }
  if (!s.element) return null;
  const w = Math.min(3840, s.width), hh = Math.round((s.height * w) / s.width);
  const c = h('canvas', { width: w, height: hh }) as HTMLCanvasElement;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(s.element, 0, 0, w, hh);
  const d = ctx.getImageData(0, 0, w, hh).data, rgb = new Float32Array(w * hh * 3);
  for (let i = 0, o = 0; i < d.length; i += 4, o += 3) { rgb[o] = d[i] / 255; rgb[o + 1] = d[i + 1] / 255; rgb[o + 2] = d[i + 2] / 255; }
  return { width: w, height: hh, rgb };
}

/** Grab n frames (waiting for new frames of the source) and average them. */
async function grabAveraged(s: Source, n: number): Promise<Frame | null> {
  let sum: Frame | null = null, got = 0, seq = -1;
  for (let k = 0; k < n; k++) {
    const t0 = performance.now();
    while (s.frameSeq === seq && performance.now() - t0 < 600) await new Promise((r) => setTimeout(r, 15));
    seq = s.frameSeq;
    const f = grabFrame(s);
    if (!f) break;
    if (!sum) sum = { ...f, rgb: new Float32Array(f.rgb) };
    else if (f.width === sum.width && f.height === sum.height) for (let i = 0; i < f.rgb.length; i++) sum.rgb[i] += f.rgb[i];
    else break;
    got++;
  }
  if (!sum || !got) return null;
  if (got > 1) for (let i = 0; i < sum.rgb.length; i++) sum.rgb[i] /= got;
  return sum;
}

/** Diverging colour for a deviation: blue (darker) – grey – red (brighter). */
function heatColor(v: number, range: number) {
  if (!Number.isFinite(v)) return '#333';
  const t = Math.max(-1, Math.min(1, v / range)), a = Math.abs(t);
  const base = [60, 62, 66], hot = t > 0 ? [230, 70, 50] : [60, 120, 235];
  return `rgb(${base.map((b, i) => Math.round(b + (hot[i] - b) * a)).join(',')})`;
}

let open: HTMLDialogElement | null = null;

export function openLedTool(host: LedHost) {
  if (open) { open.showModal(); return; }
  if (!document.getElementById('ledtool-css')) document.head.append(h('style', { id: 'ledtool-css' }, CSS));
  const dlg = h('dialog', { class: 'ledtool' }) as HTMLDialogElement;
  open = dlg;
  document.body.append(dlg);

  let s = ledSettings();
  const set = (patch: Partial<LedSettings>) => { s = setLedSettings(patch); host.patternsChanged(); };
  const setWall = (patch: Partial<WallConfig>) => { set({ wall: { ...s.wall, ...patch } }); renderWall(); };

  // ------------------------------------------------ wall
  const wallBox = h('div');
  function renderWall() {
    const w = s.wall, ws = wallSize(w), ps = pictureSize(w);
    const walls = savedWalls();
    wallBox.replaceChildren(
      h('div', { class: 'row' },
        lab('Name', (() => { const i = h('input', { value: w.name, style: 'width:140px' }) as HTMLInputElement; i.onchange = () => setWall({ name: i.value }); return i; })()),
        walls.length ? sel('', [['', 'Gespeicherte Wand …'], ...walls.map((x) => [x.name, x.name] as [string, string])], (v) => { const x = walls.find((y) => y.name === v); if (x) setWall(x); }) : '',
        h('button', { onclick: () => { saveWall(s.wall); renderWall(); } }, 'Speichern'),
        walls.some((x) => x.name === w.name) ? h('button', { onclick: () => { deleteWall(w.name); renderWall(); } }, 'Löschen') : ''),
      h('div', { class: 'row' },
        lab('Cabinet B×H px', numIn(w.cabW, 'Cabinet-Breite in Pixeln', (n) => setWall({ cabW: n })), '×', numIn(w.cabH, 'Cabinet-Höhe in Pixeln', (n) => setWall({ cabH: n }))),
        lab('Spalten × Reihen', numIn(w.cols, 'Cabinets nebeneinander', (n) => setWall({ cols: n }), '1', 52), '×', numIn(w.rows, 'Cabinets übereinander', (n) => setWall({ rows: n }), '1', 52)),
        lab('Modul B×H', numIn(w.modW, 'Modulbreite in Pixeln (0 = ohne Modulraster)', (n) => setWall({ modW: n }), '1', 52), '×', numIn(w.modH, 'Modulhöhe in Pixeln', (n) => setWall({ modH: n }), '1', 52))),
      h('div', { class: 'row' },
        lab('Versatz X/Y', numIn(w.offX, 'Lage der Wand im Ausgabebild (links)', (n) => setWall({ offX: n })), numIn(w.offY, 'Lage der Wand im Ausgabebild (oben)', (n) => setWall({ offY: n }))),
        lab('Zählung', sel(w.order, [['rows', 'zeilenweise'], ['cols', 'spaltenweise'], ['snake', 'Schlange']], (v) => setWall({ order: v as WallConfig['order'] })),
          'ab', numIn(w.start, 'Nummer des ersten Cabinets', (n) => setWall({ start: n }), '1', 52)),
        h('span', { class: 'hint' }, `Wand ${ws.w}×${ws.h} px · Ausgabebild ${ps.w}×${ps.h} px · ${w.cols * w.rows} Cabinets`)),
    );
  }

  // ------------------------------------------------ patterns
  const patBox = h('div');
  let patId = 'led-cabinet-grid';
  function renderPatterns() {
    const p = s.patch, ps = pictureSize(s.wall);
    const listText = h('textarea', { title: 'Eine Farbe je Zeile: r g b in 0–1, 0–255 oder mit %' }, p.list.map((c) => c.map((v) => Number(v.toFixed(4))).join(' ')).join('\n')) as HTMLTextAreaElement;
    listText.onchange = () => { const l = parsePatchList(listText.value); if (l.length) { set({ patch: { ...p, list: l, index: 0 } }); renderPatterns(); } };
    const code = Math.round((s.level / 100) * 255);
    patBox.replaceChildren(
      h('div', { class: 'row' },
        sel(patId, LED_PATTERNS.map((x) => [x.id, x.name] as [string, string]), (v) => { patId = v; }),
        h('button', { class: 'primary', title: `Im Ausgabefenster in ${ps.w}×${ps.h} (Wand + Versatz) zeigen`, onclick: () => host.showPattern(patId, ps.w, ps.h) }, `⧉ Ausgeben ${ps.w}×${ps.h}`)),
      h('div', { class: 'row' },
        lab('Vollfeld-Pegel %', numIn(s.level, 'Pegel 0–100 % (Codewert = gerundet auf 8 bit)', (n) => { set({ level: n }); renderPatterns(); }, '0.5', 70), h('span', { class: 'hint' }, `= Code ${code}`)),
        ...(['R', 'G', 'B'] as const).map((c, i) => lab(c, (() => {
          const cb = h('input', { type: 'checkbox', checked: s.channels[i] }) as HTMLInputElement;
          cb.onchange = () => { const ch = [...s.channels] as LedSettings['channels']; ch[i] = cb.checked; set({ channels: ch }); };
          return cb;
        })())),
        lab('Gitter alle', numIn(s.gridStep, 'Abstand des 1-px-Gitters im Pixel-Mapping', (n) => set({ gridStep: n }), '1', 52), 'px'),
        lab('Low-Level bis Code', numIn(s.lowMax, 'Höchster Codewert der feinen Graustufen/Rampen (8 bit)', (n) => set({ lowMax: n }), '1', 52)),
        lab('Scroll', sel(s.scroll, [['h', 'waagerecht'], ['v', 'senkrecht']], (v) => set({ scroll: v as 'h' | 'v' })))),
      h('p', { class: 'hint' }, 'Ausgabe über Canvas = 8 bit Full-Range-RGB: feinere Stufen als 1/255 (≈ 0,39 %) sind so nicht darstellbar; für tiefere Low-Level-Tests die Testbilder des Prozessors oder einen Signalgenerator nehmen.'),
      h('div', { class: 'row' },
        h('b', {}, 'Patch-Sequenzer'),
        lab('Fenster', sel(String(p.window), ['1', '4', '10', '25', '100'].map((v) => [v, `${v} %`] as [string, string]), (v) => set({ patch: { ...p, window: Number(v) } }))),
        lab('Umfeld %', numIn(p.surround, 'Pegel um das Feld', (n) => set({ patch: { ...p, surround: n } }), '1', 52)),
        sel('', [['', 'Satz laden …'], ...PATCH_PRESETS.map((x) => [x.id, x.name] as [string, string])], (v) => {
          const pr = PATCH_PRESETS.find((x) => x.id === v); if (pr) { set({ patch: { ...p, list: pr.list(), index: 0 } }); renderPatterns(); }
        })),
      h('div', { class: 'row' },
        listText,
        h('div', {},
          h('div', { class: 'row' },
            h('button', { class: 'mini', onclick: () => { set({ patch: { ...p, index: (p.index - 1 + p.list.length) % p.list.length } }); renderPatterns(); } }, '◀'),
            h('span', {}, `Feld ${Math.min(p.index, p.list.length - 1) + 1} / ${p.list.length}: ${p.list[Math.min(p.index, p.list.length - 1)].map((v) => Math.round(v * 255)).join(' ')}`),
            h('button', { class: 'mini', onclick: () => { set({ patch: { ...p, index: (p.index + 1) % p.list.length } }); renderPatterns(); } }, '▶')),
          h('div', { class: 'row' },
            lab('automatisch', (() => { const cb = h('input', { type: 'checkbox', checked: p.auto }) as HTMLInputElement; cb.onchange = () => set({ patch: { ...p, auto: cb.checked } }); return cb; })()),
            lab('je', numIn(p.seconds, 'Sekunden je Feld', (n) => set({ patch: { ...p, seconds: n } }), '0.5', 56), 's'),
            lab('Beschriftung', (() => { const cb = h('input', { type: 'checkbox', checked: p.label }) as HTMLInputElement; cb.onchange = () => set({ patch: { ...p, label: cb.checked } }); return cb; })())),
          h('p', { class: 'hint' }, 'Für Sonde, Opple oder Kamera: Muster „Messfeld / Patch-Sequenzer“ ausgeben. Automatisch zählt ab Öffnen des Ausgabefensters.'))),
    );
  }

  // ------------------------------------------------ camera check
  let frame: Frame | null = null, corners: Pt[] = [], result: WallResult | null = null, before: WallResult | null = null;
  let hits: PixelHit[] = [];
  const series: { angle: number; result: WallResult }[] = [];
  const scans: { note: string; index: number }[] = [];
  let transfer: CameraTransfer = 'code', margin = 15, captures = 4, srcId = '', camNote = '', heatMode: 'dev' | 'cb' | 'cr' | 'delta' = 'dev', range = 5, angle = 0;
  const camCanvas = h('canvas', { class: 'cam', width: 960, height: 540 }) as HTMLCanvasElement;
  const heat = h('canvas', { class: 'heat', width: 960, height: 400 }) as HTMLCanvasElement;
  const camMsg = h('span', { class: 'hint' });
  const resBox = h('div');
  const camImg = h('canvas') as HTMLCanvasElement;

  const cams = () => host.sources().filter((x) => x.ready);
  function drawCam() {
    const ctx = camCanvas.getContext('2d')!;
    if (!frame) { camCanvas.width = 960; camCanvas.height = 540; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 960, 540); ctx.fillStyle = '#888'; ctx.font = '16px system-ui'; ctx.textAlign = 'center'; ctx.fillText('Quelle wählen, „Bild holen“', 480, 270); return; }
    camCanvas.width = frame.width; camCanvas.height = frame.height;
    ctx.drawImage(camImg, 0, 0);
    const lw = Math.max(1, frame.width / 700);
    if (corners.length === 4) {
      const H = wallToImage(s.wall, corners), w = s.wall;
      ctx.strokeStyle = 'rgba(140,255,158,.8)'; ctx.lineWidth = lw; ctx.beginPath();
      for (let c = 0; c <= w.cols; c++) { const a = project(H, c * w.cabW, 0), b = project(H, c * w.cabW, w.rows * w.cabH); ctx.moveTo(...a); ctx.lineTo(...b); }
      for (let r = 0; r <= w.rows; r++) { const a = project(H, 0, r * w.cabH), b = project(H, w.cols * w.cabW, r * w.cabH); ctx.moveTo(...a); ctx.lineTo(...b); }
      ctx.stroke();
      ctx.fillStyle = 'rgba(140,255,158,.9)'; ctx.font = `${Math.round(lw * 11)}px system-ui`; ctx.textAlign = 'center';
      for (const cab of cabinets(w)) { const p = project(H, cab.x + cab.w / 2, cab.y + cab.h / 2); ctx.fillText(cab.label, p[0], p[1]); }
    }
    corners.forEach((p, i) => {
      ctx.fillStyle = '#ffb44a'; ctx.beginPath(); ctx.arc(p[0], p[1], lw * 5, 0, Math.PI * 2); ctx.fill();
      ctx.font = `bold ${Math.round(lw * 13)}px system-ui`; ctx.fillText(['OL', 'OR', 'UR', 'UL'][i], p[0] + lw * 14, p[1] - lw * 8);
    });
    ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = lw * 1.5;
    for (const hit of hits.slice(0, 500)) { ctx.beginPath(); ctx.arc(hit.x + 0.5, hit.y + 0.5, lw * 6, 0, Math.PI * 2); ctx.stroke(); }
  }
  const toImg = (e: MouseEvent): Pt => {
    const r = camCanvas.getBoundingClientRect(), W = camCanvas.width, H = camCanvas.height;
    const sc = Math.min(r.width / W, r.height / H), ox = (r.width - W * sc) / 2, oy = (r.height - H * sc) / 2;
    return [(e.clientX - r.left - ox) / sc, (e.clientY - r.top - oy) / sc];
  };
  let dragIdx = -1;
  camCanvas.addEventListener('pointerdown', (e) => {
    if (!frame) return;
    const p = toImg(e), tol = frame.width / 40;
    const near = corners.findIndex((c) => Math.hypot(c[0] - p[0], c[1] - p[1]) < tol);
    if (near >= 0) dragIdx = near;
    else if (corners.length < 4) { corners.push(p); dragIdx = corners.length - 1; }
    drawCam(); updateCamMsg();
  });
  camCanvas.addEventListener('pointermove', (e) => { if (dragIdx >= 0) { corners[dragIdx] = toImg(e); drawCam(); } });
  window.addEventListener('pointerup', () => { dragIdx = -1; });

  const updateCamMsg = () => {
    camMsg.textContent = !frame ? '' : corners.length < 4
      ? `Wandecken anklicken: ${['oben links', 'oben rechts', 'unten rechts', 'unten links'][corners.length]} (Ecken der äußeren Cabinets, ziehbar)`
      : 'Raster liegt? Sonst Ecken ziehen. Dann „Auswerten“.';
  };

  async function grab() {
    const src = cams().find((x) => x.id === srcId) ?? cams()[0];
    if (!src) { camMsg.textContent = 'Keine laufende Quelle.'; return; }
    srcId = src.id;
    camMsg.textContent = `Hole ${captures} Bild${captures > 1 ? 'er' : ''} …`;
    const f = await grabAveraged(src, captures);
    if (!f) { camMsg.textContent = 'Kein Bild erhalten.'; return; }
    if (frame && (frame.width !== f.width || frame.height !== f.height)) corners = [];
    frame = f; hits = [];
    camImg.width = f.width; camImg.height = f.height;
    const ictx = camImg.getContext('2d')!, img = ictx.createImageData(f.width, f.height);
    for (let i = 0, o = 0; o < f.rgb.length; i += 4, o += 3) { img.data[i] = f.rgb[o] * 255; img.data[i + 1] = f.rgb[o + 1] * 255; img.data[i + 2] = f.rgb[o + 2] * 255; img.data[i + 3] = 255; }
    ictx.putImageData(img, 0, 0);
    drawCam(); updateCamMsg();
  }

  function evaluate() {
    if (!frame || corners.length !== 4) { camMsg.textContent = 'Erst Bild holen und vier Ecken setzen.'; return; }
    try { result = analyseWall(frame, s.wall, corners, { margin: margin / 100, transfer, captures }); }
    catch (e) { camMsg.textContent = (e as Error).message; return; }
    renderResult();
  }

  const delta = (): DeltaStat[] | null => (before && result ? compareResults(before, result) : null);

  function drawHeat() {
    if (!result) return;
    const w = result.wall, ctx = heat.getContext('2d')!;
    const W = heat.width, sc = W / (w.cols * w.cabW), Ht = Math.round(w.rows * w.cabH * sc);
    heat.height = Ht + 28;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, heat.height);
    const d = delta(), cw = w.cabW * sc, ch = w.cabH * sc;
    for (const c of result.cabinets) {
      const v = heatMode === 'dev' ? c.dev : heatMode === 'cb' ? c.dCb : heatMode === 'cr' ? c.dCr : d?.find((x) => x.label === c.label)?.delta ?? NaN;
      ctx.fillStyle = heatColor(v, range); ctx.fillRect(c.c * cw, c.r * ch, cw, ch);
      ctx.strokeStyle = '#000'; ctx.strokeRect(c.c * cw + 0.5, c.r * ch + 0.5, cw - 1, ch - 1);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const fs = Math.max(8, Math.min(ch / 4.5, cw / 5.5));
      ctx.font = `600 ${fs}px system-ui`; ctx.fillText(signed(v, heatMode === 'dev' || heatMode === 'delta' ? 1 : 2), c.c * cw + cw / 2, c.r * ch + ch / 2 + fs * 0.45);
      ctx.font = `${fs * 0.7}px system-ui`; ctx.fillStyle = '#ddd'; ctx.fillText(`${c.label} #${c.id}`, c.c * cw + cw / 2, c.r * ch + ch / 2 - fs * 0.6);
    }
    // seams: colour lines by their contrast
    for (const sm of result.seams) {
      ctx.strokeStyle = heatColor(sm.contrast, range); ctx.lineWidth = Math.max(2, Math.min(cw, ch) / 18);
      ctx.beginPath();
      if (sm.dir === 'v') { const x = (sm.c + 1) * cw; ctx.moveTo(x, sm.r * ch + ch * 0.2); ctx.lineTo(x, sm.r * ch + ch * 0.8); }
      else { const y = (sm.r + 1) * ch; ctx.moveTo(sm.c * cw + cw * 0.2, y); ctx.lineTo(sm.c * cw + cw * 0.8, y); }
      ctx.stroke();
    }
    ctx.fillStyle = '#aaa'; ctx.font = '12px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const what = { dev: 'Helligkeit zum Wandmedian %', cb: 'ΔCb ×100', cr: 'ΔCr ×100', delta: 'Nachher − Vorher (Prozentpunkte)' }[heatMode];
    ctx.fillText(`${w.name} · ${what} · Skala ±${range} · ${new Date(result.date).toLocaleString('de-DE')} · Nähte als Linien`, 6, Ht + 14);
  }

  function renderResult() {
    if (!result) { resBox.replaceChildren(); return; }
    const r = result, d = delta();
    const seams = [...r.seams].sort((a, b) => Math.abs(b.contrast) - Math.abs(a.contrast)).slice(0, 8);
    const worst = [...r.cabinets].sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev)).slice(0, 8);
    const pts = angleSeries(series);
    resBox.replaceChildren(
      h('div', { class: 'row' },
        h('b', {}, `Uniformität (min/max) ${fmt(r.uniformity)} % · Streuung ${fmt(r.spread, 2)} % · ${r.cabinets.length} Cabinets`),
        lab('Karte', sel(heatMode, [['dev', 'Helligkeit'], ['cb', 'ΔCb'], ['cr', 'ΔCr'], ...(d ? [['delta', 'Vorher/Nachher'] as [string, string]] : [])], (v) => { heatMode = v as typeof heatMode; drawHeat(); })),
        lab('Skala ±', sel(String(range), ['1', '2', '5', '10', '20'].map((v) => [v, v] as [string, string]), (v) => { range = Number(v); drawHeat(); }))),
      heat,
      h('div', { class: 'row' },
        h('button', { onclick: () => download(`led-wand-${r.wall.name}-${r.date.slice(0, 16).replace(/[:T]/g, '-')}.csv`, new Blob([reportCsv(r, { Kamera: camNote }, d)], { type: 'text/csv' })) }, '⤓ CSV'),
        h('button', { onclick: () => heat.toBlob((b) => b && download(`led-wand-${r.wall.name}-heatmap.png`, b), 'image/png') }, '⤓ PNG'),
        h('button', { title: 'Diese Auswertung als Vorher-Stand merken (z. B. vor der Kalibrierung im Prozessor)', onclick: () => { before = r; renderResult(); } }, 'Als Vorher merken'),
        before ? h('span', { class: 'hint' }, `Vorher: ${new Date(before.date).toLocaleTimeString('de-DE')}, Streuung ${fmt(before.spread, 2)} % → jetzt ${fmt(r.spread, 2)} %`) : '',
        lab('Winkel °', numIn(angle, 'Kamerawinkel zur Wandnormalen', (n) => { angle = n; }, '1', 52)),
        h('button', { title: 'Auswertung mit diesem Kamerawinkel in die Blickwinkelserie übernehmen', onclick: () => { series.push({ angle, result: r }); renderResult(); } }, '+ Blickwinkelserie')),
      h('div', { class: 'cols' },
        h('table', {}, h('tr', {}, h('th', {}, 'Cabinet'), h('th', {}, 'Abw. %'), h('th', {}, 'ΔCb'), h('th', {}, 'ΔCr'), h('th', {}, 'Std')),
          ...worst.map((c) => h('tr', {}, h('td', {}, `${c.label} #${c.id}`), h('td', {}, signed(c.dev, 2)), h('td', {}, signed(c.dCb, 2)), h('td', {}, signed(c.dCr, 2)), h('td', {}, fmt(c.std * 100, 2))))),
        h('table', {}, h('tr', {}, h('th', {}, 'Naht'), h('th', {}, 'Kontrast %'), h('th', {}, 'Profil')),
          ...seams.map((sm) => h('tr', {}, h('td', {}, `${sm.a} | ${sm.b}`), h('td', {}, signed(sm.contrast, 2)), h('td', {}, sparkline(sm.profile)))))),
      pts.length ? h('table', {}, h('tr', {}, h('th', {}, 'Winkel °'), h('th', {}, 'Wandmedian'), h('th', {}, 'relativ %'), h('th', {}, 'Cb ×100'), h('th', {}, 'Cr ×100'), h('th', {}, 'Streuung %')),
        ...pts.map((p) => h('tr', {}, h('td', {}, fmt(p.angle, 0)), h('td', {}, fmt(p.median, 4)), h('td', {}, fmt(p.relative)), h('td', {}, signed(p.cb, 2)), h('td', {}, signed(p.cr, 2)), h('td', {}, fmt(p.spread, 2))))) : '',
    );
    drawHeat();
  }

  function sparkline(v: number[]) {
    const c = h('canvas', { width: 84, height: 18 }) as HTMLCanvasElement, ctx = c.getContext('2d')!;
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    ctx.strokeStyle = '#8cff9e'; ctx.beginPath();
    v.forEach((y, i) => { const px = (i / (v.length - 1)) * 83, py = 16 - ((y - lo) / span) * 14; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
    ctx.stroke(); ctx.fillStyle = '#555'; ctx.fillRect(42, 0, 1, 18);
    return c;
  }

  const scanBox = h('span', { class: 'hint' }), hitBox = h('div', { class: 'hint' });
  let scanNote = '', thr = 20;
  const camBox = h('div');
  function renderCam() {
    const list = cams();
    camBox.replaceChildren(
      h('div', { class: 'row' },
        sel(srcId, list.length ? list.map((x) => [x.id, x.name] as [string, string]) : [['', 'keine laufende Quelle']], (v) => { srcId = v; }, 'Kamera, Capture oder RTSP, die die Wand filmt'),
        h('button', { class: 'mini', title: 'Quellenliste neu lesen', onclick: renderCam }, '↻'),
        lab('mitteln', numIn(captures, 'Anzahl Bilder, die gemittelt werden (Rauschen, Scan-Linien)', (n) => { captures = Math.max(1, Math.min(32, Math.round(n))); }, '1', 48)),
        h('button', { class: 'primary', onclick: grab }, 'Bild holen'),
        h('button', { onclick: () => { corners = []; hits = []; drawCam(); updateCamMsg(); } }, 'Ecken zurücksetzen'),
        camMsg),
      camCanvas,
      h('div', { class: 'row' },
        lab('Randzone %', numIn(margin, 'Rand jedes Cabinets, der nicht in die Zellstatistik eingeht (Nähte werden getrennt ausgewertet)', (n) => { margin = n; }, '1', 48)),
        lab('Signal', sel(transfer, [['code', "Codewerte Y′ (wie aufgenommen)"], ['bt709', 'linearisiert (inverse BT.709-OETF)']], (v) => { transfer = v as CameraTransfer; })),
        lab('Kamera/Notiz', (() => { const i = h('input', { value: camNote, placeholder: 'Kamera, Blende, Shutter, ISO, WB', style: 'width:220px' }) as HTMLInputElement; i.onchange = () => { camNote = i.value; }; return i; })()),
        h('button', { class: 'primary', onclick: evaluate }, 'Auswerten')),
      h('p', { class: 'hint' }, 'Vorgehen: Muster „Vollfeld freier Pegel“ (z. B. 50 % Grau) ausgeben, Kamera fest, Belichtung und WB manuell, gegen Moiré leicht defokussieren. Prozentwerte sind relativ zum Wandmedian; mit Log-Kameras erst eine Rec.709-Kurve oder „Codewerte“ nehmen.'),
      resBox,
      h('div', { class: 'row' },
        h('b', {}, 'Scan-Linien-Index'),
        (() => { const i = h('input', { placeholder: 'Einstellung, z. B. 180° / Phase 0', style: 'width:200px' }) as HTMLInputElement; i.onchange = () => { scanNote = i.value; }; return i; })(),
        h('button', { title: 'Zeilenprofil-Varianz im Wandbereich des geholten Bildes (Muster: Vollfeld)', onclick: () => {
          if (!frame) { scanBox.textContent = 'Erst Bild holen.'; return; }
          const r = scanLineIndex(frame, corners.length === 4 ? corners : null);
          scans.push({ note: scanNote || `Messung ${scans.length + 1}`, index: r.index });
          scanBox.textContent = scans.map((x) => `${x.note}: ${fmt(x.index, 3)} %`).join(' · ');
        } }, 'Messen'), scanBox),
      h('p', { class: 'hint' }, 'Vergleichswert, keine Norm: RMS der Zeilenmittel nach Abzug des gleitenden Mittels, in % vom Mittel. Mit einem Bild (mitteln = 1) messen, Shutter/Phase ändern, erneut holen und messen – kleiner ist besser.'),
      h('div', { class: 'row' },
        h('b', {}, 'Tote/hängende Pixel'),
        lab('Schwelle %', numIn(thr, 'Abweichung vom Median der 8 Nachbarn', (n) => { thr = n; }, '1', 48)),
        h('button', { onclick: () => {
          if (!frame) { hitBox.textContent = 'Erst Bild holen.'; return; }
          hits = findOutlierPixels(frame, corners.length === 4 ? corners : null, thr / 100);
          drawCam();
          const where = hits.slice(0, 40).map((p) => {
            const loc = corners.length === 4 ? locateOnWall(s.wall, corners, p.x, p.y) : null;
            return `${p.kind} ${p.x}/${p.y}${loc ? ` → ${loc.label} Pixel ${loc.px}/${loc.py}` : ''}`;
          });
          hitBox.textContent = hits.length ? `${hits.length}${hits.length >= 500 ? '+' : ''} Auffälligkeiten: ${where.join(' · ')}` : 'Keine Ausreißer über der Schwelle.';
        } }, 'Suchen')),
      hitBox,
      h('p', { class: 'hint' }, 'Vollfelder Schwarz, Weiß, R, G, B nacheinander ausgeben und jeweils holen und suchen. Einzelne LEDs findet das nur, wenn die Kamera im Ausschnitt mehr Pixel hat als die Wand (nah heran, Teilbereiche).'),
    );
    drawCam();
  }

  // ------------------------------------------------ camera matrix (Unreal procedure)
  const matBox = h('div');
  const meas: Record<'r' | 'g' | 'b' | 'w', number[] | null> = { r: null, g: null, b: null, w: null };
  let matTransfer: CameraTransfer = 'bt709';
  async function measure(k: keyof typeof meas) {
    const src = cams().find((x) => x.id === srcId) ?? cams()[0];
    const f = src ? await grabAveraged(src, Math.max(1, captures)) : null;
    if (!f) { renderMatrix('Kein Bild.'); return; }
    // centre 20 % of the wall area (or of the frame)
    const region = corners.length === 4 ? corners : null;
    const b = bbox(f, region), cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, rw = (b.x1 - b.x0) * 0.1, rh = (b.y1 - b.y0) * 0.1;
    const sum = [0, 0, 0]; let n = 0;
    for (let y = Math.floor(cy - rh); y < cy + rh; y++) for (let x = Math.floor(cx - rw); x < cx + rw; x++) {
      const i = (y * f.width + x) * 3;
      for (let c = 0; c < 3; c++) sum[c] += matTransfer === 'bt709' ? bt709InverseOetf(f.rgb[i + c]) : f.rgb[i + c];
      n++;
    }
    meas[k] = sum.map((v) => v / n);
    renderMatrix();
  }
  function renderMatrix(msg = '') {
    const all = meas.r && meas.g && meas.b && meas.w;
    let out: Node | string = '';
    if (all) {
      try {
        const m = cameraMatrix(meas.r!, meas.g!, meas.b!, meas.w!);
        const txt = ocioMatrix(m);
        out = h('div', {},
          h('table', {}, ...[0, 1, 2].map((i) => h('tr', {}, ...[0, 1, 2].map((j) => h('td', {}, m[i * 3 + j].toFixed(5)))))),
          h('div', { class: 'row' }, h('code', {}, txt), h('button', { class: 'mini', onclick: () => navigator.clipboard?.writeText(txt) }, 'Kopieren')));
      } catch (e) { out = (e as Error).message; }
    }
    const showPatch = (i: number) => { set({ patch: { ...s.patch, list: PATCH_PRESETS[0].list(), index: i, auto: false, window: 25 } }); const ps = pictureSize(s.wall); host.showPattern('led-patch', ps.w, ps.h); renderPatterns(); };
    matBox.replaceChildren(
      h('p', { class: 'hint' }, 'Nach Epic „Camera Color Calibration for In-Camera VFX“ (UE 5.7): R-, G-, B-Feld als Spalten von F, S = F⁻¹·W/max(W), F spaltenweise mit S skalieren, Kalibriermatrix = Inverse. Voraussetzung laut Epic: Kamera-WB 6500 K, Belichtung ohne Clipping, Prozessor im nativen Farbraum, Kamerawerte linearisiert. Gemessen wird die Mitte (20 %) des Wandbereichs.'),
      h('div', { class: 'row' },
        lab('Linearisierung', sel(matTransfer, [['bt709', 'inverse BT.709-OETF'], ['code', 'Werte sind schon linear']], (v) => { matTransfer = v as CameraTransfer; })),
        ...(['r', 'g', 'b', 'w'] as const).map((k, i) => h('span', { class: 'row', style: 'margin:0' },
          h('button', { class: 'mini', title: 'Dieses Feld ausgeben', onclick: () => showPatch(i) }, `${'RGBW'[i]} zeigen`),
          h('button', { onclick: () => measure(k) }, `${'RGBW'[i]} messen`),
          h('span', { class: 'hint' }, meas[k] ? meas[k]!.map((v) => v.toFixed(3)).join(' ') : '–')))),
      msg ? h('p', { class: 'note' }, msg) : '', out);
  }

  // ------------------------------------------------ assemble
  dlg.append(
    h('div', { class: 'row', style: 'justify-content:space-between;margin:0' },
      h('h3', {}, 'LED-Wand: Testbilder und Kamera-Prüfung'),
      h('button', { onclick: () => dlg.close() }, 'Schließen')),
    h('p', { class: 'note' }, 'Kalibriert wird die Wand im LED-Prozessor (Brompton Tessera/Hydra, NovaStar NovaLCT/NovaCLB, Colorlight) – LZ Scopes schreibt keine Korrekturwerte. Hier: Testbilder in Wandauflösung und eine relative Prüfung mit der Kamera (die Kamera ist kein Kolorimeter). Die Auswertung ist mit synthetischen Bildern getestet, an einer echten Wand noch nicht erprobt.'),
    h('details', { open: true }, h('summary', {}, 'Wand und Cabinets'), wallBox),
    h('details', { open: true }, h('summary', {}, 'Testbilder'), patBox),
    h('details', {}, h('summary', {}, 'Kamera-Prüfung: Heatmap, Nähte, Vorher/Nachher, Blickwinkel, Scan-Linien, tote Pixel'), camBox),
    h('details', {}, h('summary', {}, 'Kameramatrix (Unreal-Verfahren)'), matBox),
  );
  renderWall(); renderPatterns(); renderCam(); renderMatrix();
  dlg.showModal();
}

