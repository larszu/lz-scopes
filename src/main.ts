import './style.css';
import { FALSE_COLOR_PRESETS, LUMA } from './color';
import {
  SCOPE_LABELS, cieToPlot, drawCieGraticule, drawHistogram, drawTextBox, drawVectorGraticule, drawWaveGraticule, drawWaveProbe,
  isWaveform, plotRect, probeLines, statsLines, vectorPoint, type ScopeType, type Unit,
} from './graticule';
import { Renderer, type PictureMode, type ScatterMode } from './renderer';
import { Source, type SourceKind, type SourceSettings } from './sources';
import { ycbcr } from './color';

// ---------------------------------------------------------------- state

interface PanelState {
  scope: ScopeType; sourceId: string; gain: number; colorize: boolean; zoom: number;
  picture: PictureMode; hist: 'rgb' | 'luma' | 'split'; log: boolean;
}
interface Persisted {
  layout: string; panels: PanelState[]; unit: Unit; tint: 'white' | 'green' | 'amber'; falsePreset: string;
  zebra: number; zebraLow: number; maxSamples: number; bridge: string; sidebar: boolean;
  sources: { kind: SourceKind; name: string; url: string; settings: SourceSettings }[];
}

const LAYOUTS: Record<string, { label: string; areas: string[]; n: number }> = {
  // non-numeric keys keep insertion order (= keyboard shortcuts 1–6)
  l1: { label: '1', areas: ['a'], n: 1 },
  l2: { label: '1+1', areas: ['a b'], n: 2 },
  l4: { label: '2×2', areas: ['a b', 'c d'], n: 4 },
  lc: { label: 'Colorist', areas: ['a a b', 'a a c', 'd e f'], n: 6 },
  l6: { label: '3×2', areas: ['a b c', 'd e f'], n: 6 },
  l9: { label: '3×3', areas: ['a b c', 'd e f', 'g h i'], n: 9 },
};
const DEFAULT_SCOPES: ScopeType[] = ['picture', 'wf-luma', 'vector', 'parade', 'hist', 'cie', 'stats', 'yrgb', 'ycbcr'];
const TINTS = { white: [1, 1, 1], green: [0.55, 1, 0.62], amber: [1, 0.82, 0.45] } as const;
const STORE_KEY = 'lz-scope.v1';

const panel = (scope: ScopeType): PanelState => ({
  scope, sourceId: '', gain: 1, colorize: scope === 'vector' || scope === 'cie', zoom: 1, picture: 'normal', hist: 'rgb', log: false,
});

function load(): Persisted {
  const base: Persisted = {
    layout: 'lc', panels: DEFAULT_SCOPES.map(panel), unit: 'percent', tint: 'green', falsePreset: 'ARRI', zebra: 0.95, zebraLow: 0,
    maxSamples: 1_000_000, bridge: '', sidebar: true,
    sources: [{ kind: 'stream', name: 'Testbild', url: 'test:bars', settings: { transfer: 'auto', colorspace: 'auto', width: 960, fps: 0, depth: 8, transport: 'tcp' } }],
  };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (s && Array.isArray(s.panels)) return { ...base, ...s, layout: s.layout in LAYOUTS ? s.layout : base.layout, panels: DEFAULT_SCOPES.map((d, i) => ({ ...panel(d), ...s.panels[i] })) };
  } catch { /* storage unavailable */ }
  return base;
}

const state = load();
const sources: Source[] = [];
let solo: number | null = null;
let frozen = false;
let fpsFrames = 0, displayFps = 0, fpsT = performance.now();

function save() {
  const p: Persisted = {
    ...state,
    sources: sources.filter((s) => s.kind === 'stream').map((s) => ({ kind: s.kind, name: s.name, url: s.url, settings: s.settings })),
  };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

const bridgeUrl = () => {
  const b = state.bridge.trim();
  if (b) return b.replace(/^http/, 'ws').replace(/\/$/, '');
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
};

// ---------------------------------------------------------------- DOM

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
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
const select = (value: string, options: [string, string][], onchange: (v: string) => void, title = '') =>
  h('select', { title, onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
    ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));

const app = $('#app');
app.innerHTML = `
  <header class="bar">
    <div class="brand"><span class="mark">LZ</span> Scope</div>
    <button class="icon" id="toggle-side" title="Quellen ein/aus (B)">☰</button>
    <div class="group" id="layouts"></div>
    <div class="group" id="globals"></div>
    <div class="spacer"></div>
    <span class="fps" id="fps"></span>
    <button id="freeze" title="Standbild (Leertaste)">❚❚ Einfrieren</button>
    <button id="snap" title="Screenshot als PNG (S)">⤓ PNG</button>
    <button id="full" title="Vollbild (F)">⛶</button>
  </header>
  <div class="main">
    <aside class="side" id="side">
      <h2>Quellen</h2>
      <div id="source-list"></div>
      <div class="add" id="add"></div>
      <details class="bridge"><summary>Bridge</summary>
        <label>Adresse <input id="bridge" placeholder="leer = dieser Server"></label>
        <p class="hint">RTSP & Co. dekodiert die lokale Bridge (<code>npm start</code>) mit ffmpeg.</p>
      </details>
      <details class="help"><summary>Tastatur</summary>
        <p><kbd>1</kbd>–<kbd>6</kbd> Layout · <kbd>Leertaste</kbd> Einfrieren · <kbd>F</kbd> Vollbild · <kbd>S</kbd> PNG · <kbd>B</kbd> Seitenleiste ·
        Doppelklick = Solo, <kbd>Esc</kbd> zurück · Klick ins Bild = Messpunkt, Rechtsklick löscht</p>
      </details>
    </aside>
    <section class="grid" id="grid"><canvas id="gl"></canvas></section>
  </div>`;

const grid = $('#grid');
const glCanvas = $<HTMLCanvasElement>('#gl');
let renderer: Renderer;
try {
  renderer = new Renderer(glCanvas);
} catch (e) {
  grid.innerHTML = `<div class="fatal">${(e as Error).message}</div>`;
  throw e;
}

// ---------------------------------------------------------------- header

function renderHeader() {
  const lay = $('#layouts');
  lay.replaceChildren(...Object.entries(LAYOUTS).map(([k, l], i) =>
    h('button', { class: k === state.layout ? 'on' : '', title: `Layout ${l.label} (${i + 1})`, onclick: () => setLayout(k) }, l.label)));
  $('#globals').replaceChildren(
    select(state.unit, [['percent', '%'], ['bit8', '8 bit'], ['bit10', '10 bit'], ['nits', 'cd/m²']], (v) => { state.unit = v as Unit; save(); }, 'Skala'),
    select(state.tint, [['green', 'Grün'], ['white', 'Weiß'], ['amber', 'Bernstein']], (v) => { state.tint = v as Persisted['tint']; save(); }, 'Spurfarbe'),
    select(String(state.maxSamples), [['250000', 'Schnell'], ['1000000', 'Standard'], ['4000000', 'Voll']], (v) => { state.maxSamples = Number(v); save(); }, 'Präzision (Abtastpunkte)'),
    select(state.falsePreset, Object.keys(FALSE_COLOR_PRESETS).map((k) => [k, `Falschfarben ${k}`]), (v) => { state.falsePreset = v; save(); }, 'Falschfarben-Preset'),
    h('label', { class: 'inline', title: 'Zebra-Schwelle' }, 'Zebra ',
      h('input', { type: 'number', min: 50, max: 109, step: 1, value: Math.round(state.zebra * 100), onchange: (e: Event) => { state.zebra = Number((e.target as HTMLInputElement).value) / 100; save(); } }), '%'),
  );
}

function setLayout(k: string) {
  state.layout = k; solo = null; save(); renderHeader(); renderPanels();
}

$('#toggle-side').onclick = () => { state.sidebar = !state.sidebar; applySidebar(); save(); };
const applySidebar = () => $('#side').classList.toggle('hidden', !state.sidebar);
$('#freeze').onclick = () => toggleFreeze();
$('#snap').onclick = () => snapshot();
$('#full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
const bridgeInput = $<HTMLInputElement>('#bridge');
bridgeInput.value = state.bridge;
bridgeInput.onchange = () => { state.bridge = bridgeInput.value; save(); };

function toggleFreeze() {
  frozen = !frozen;
  sources.forEach((s) => (s.frozen = frozen));
  $('#freeze').classList.toggle('on', frozen);
  $('#freeze').textContent = frozen ? '▶ Weiter' : '❚❚ Einfrieren';
}

// ---------------------------------------------------------------- sources

function addSource(kind: SourceKind, name?: string, url = '', settings?: Partial<SourceSettings>) {
  const s = new Source(kind, name, settings);
  s.url = url;
  s.onChange = () => { renderSources(); };
  sources.push(s);
  renderSources(); renderPanels(); save();
  return s;
}

function removeSource(s: Source) {
  s.stop();
  renderer.dropSource(s.id);
  sources.splice(sources.indexOf(s), 1);
  renderSources(); renderPanels(); save();
}

function renderSources() {
  $('#source-list').replaceChildren(...sources.map((s, i) => {
    const set = s.settings;
    const upd = (patch: Partial<SourceSettings>, reconnect = false) => {
      Object.assign(s.settings, patch); save();
      if (reconnect && s.kind === 'stream' && s.status !== 'idle') s.connectStream(s.url, bridgeUrl());
      renderSources();
    };
    const running = s.status === 'live' || s.status === 'connecting';
    const card = h('div', { class: `src ${s.status}` },
      h('div', { class: 'src-head' },
        h('span', { class: 'dot', title: s.status }),
        h('span', { class: 'idx' }, String(i + 1)),
        h('input', { class: 'name', value: s.name, onchange: (e: Event) => { s.name = (e.target as HTMLInputElement).value; save(); renderPanels(); } }),
        h('button', { class: 'icon', title: 'Entfernen', onclick: () => removeSource(s) }, '✕')),
    );
    if (s.kind === 'stream') {
      const urlIn = h('input', { class: 'url', value: s.url, placeholder: 'rtsp://user:pass@host:554/stream', spellcheck: 'false' }) as HTMLInputElement;
      urlIn.onkeydown = (e) => { if (e.key === 'Enter') connect(); };
      const connect = () => { s.url = urlIn.value.trim(); save(); s.connectStream(s.url, bridgeUrl()); };
      card.append(
        h('div', { class: 'row' }, urlIn),
        h('div', { class: 'row' },
          select(String(set.width), [['640', '640 px'], ['960', '960 px'], ['1280', '1280 px'], ['1920', '1920 px'], ['0', 'nativ']], (v) => upd({ width: Number(v) }, true), 'Analyseauflösung'),
          select(String(set.fps), [['0', 'alle fps'], ['10', '10 fps'], ['25', '25 fps'], ['30', '30 fps']], (v) => upd({ fps: Number(v) }, true), 'Bildrate begrenzen'),
          select(String(set.depth), [['8', '8 bit'], ['16', '16 bit']], (v) => upd({ depth: Number(v) as 8 | 16 }, true), 'Bittiefe (16 bit für 10-bit/HDR-Quellen)'),
          select(set.transport, [['tcp', 'TCP'], ['udp', 'UDP']], (v) => upd({ transport: v as 'tcp' | 'udp' }, true), 'RTSP-Transport')),
        h('div', { class: 'row' },
          running ? h('button', { onclick: () => s.stop() }, '■ Trennen') : h('button', { class: 'primary', onclick: connect }, '▶ Verbinden'),
          h('div', { class: 'presets' }, ...['bars', 'ramp', 'testsrc', 'colors'].map((p) =>
            h('button', { class: 'mini', title: `Testbild ${p}`, onclick: () => { urlIn.value = `test:${p}`; connect(); } }, p)))),
      );
    } else {
      card.append(h('div', { class: 'row' },
        running ? h('button', { onclick: () => s.stop() }, '■ Stopp')
          : h('button', { class: 'primary', onclick: () => startLocal(s) }, s.kind === 'file' ? 'Datei wählen …' : '▶ Start')));
    }
    card.append(h('div', { class: 'row' },
      select(set.transfer, [['auto', `Transfer auto (${s.transfer.toUpperCase()})`], ['sdr', 'SDR BT.1886'], ['pq', 'PQ ST 2084'], ['hlg', 'HLG']], (v) => upd({ transfer: v as SourceSettings['transfer'] }), 'Transferfunktion'),
      select(set.colorspace, [['auto', `Farbraum auto (${s.colorspace})`], ['709', 'Rec.709'], ['2020', 'Rec.2020'], ['601', 'Rec.601']], (v) => upd({ colorspace: v as SourceSettings['colorspace'] }), 'Matrix & Primärfarben')));
    if (s.message) card.append(h('div', { class: 'msg' }, s.message));
    return card;
  }));
}

async function startLocal(s: Source) {
  if (s.kind === 'webcam' || s.kind === 'screen') return s.startCapture(s.kind);
  const input = h('input', { type: 'file', accept: 'video/*,image/*' }) as HTMLInputElement;
  input.onchange = () => { const f = input.files?.[0]; if (f) s.openFile(f).then(renderPanels); };
  input.click();
}

$('#add').replaceChildren(
  h('span', {}, '+ Quelle'),
  h('button', { onclick: () => addSource('stream', `Stream ${sources.length + 1}`) }, 'RTSP / Netz'),
  h('button', { onclick: () => startLocal(addSource('webcam')) }, 'Kamera'),
  h('button', { onclick: () => startLocal(addSource('screen')) }, 'Bildschirm'),
  h('button', { onclick: () => startLocal(addSource('file')) }, 'Datei'),
);

// ---------------------------------------------------------------- panels

interface PanelView { idx: number; el: HTMLElement; body: HTMLElement; overlay: HTMLCanvasElement }
let views: PanelView[] = [];

function panelSource(p: PanelState) {
  return sources.find((s) => s.id === p.sourceId) ?? sources[0] ?? null;
}

function renderPanels() {
  const L = LAYOUTS[state.layout] ?? LAYOUTS.lc;
  views.forEach((v) => v.el.remove());
  views = [];
  const letters = 'abcdefghi';
  if (solo !== null) {
    grid.style.gridTemplateAreas = '"a"';
  } else {
    grid.style.gridTemplateAreas = L.areas.map((a) => `"${a}"`).join(' ');
  }
  const indices = solo !== null ? [solo] : [...Array(L.n).keys()];
  indices.forEach((idx, k) => {
    const p = state.panels[idx];
    const body = h('div', { class: 'body' });
    const overlay = h('canvas', { class: 'overlay' }) as HTMLCanvasElement;
    body.append(overlay);
    const opts = panelOptions(p);
    const el = h('div', { class: 'panel', style: `grid-area:${letters[k]}` },
      h('div', { class: 'phead', ondblclick: () => toggleSolo(idx) },
        select(p.scope, Object.entries(SCOPE_LABELS) as [string, string][], (v) => { p.scope = v as ScopeType; if (v === 'vector' || v === 'cie') p.colorize = true; save(); renderPanels(); }),
        sources.length > 1 ? select(p.sourceId || sources[0]?.id || '', sources.map((s, i) => [s.id, `${i + 1} ${s.name}`]), (v) => { p.sourceId = v; save(); }) : '',
        h('div', { class: 'opts' }, ...opts),
        h('button', { class: 'icon', title: solo === idx ? 'Zurück (Esc)' : 'Solo', onclick: () => toggleSolo(idx) }, solo === idx ? '⤡' : '⤢')),
      body);
    body.addEventListener('dblclick', () => toggleSolo(idx));
    body.addEventListener('click', (e) => setProbe(p, body, e));
    body.addEventListener('contextmenu', (e) => { e.preventDefault(); const s = panelSource(p); if (s) s.probe = null; });
    grid.append(el);
    views.push({ idx, el, body, overlay });
  });
}

function panelOptions(p: PanelState): (Node | string)[] {
  const out: (Node | string)[] = [];
  const toggle = (label: string, key: 'colorize' | 'log', title: string) =>
    h('button', { class: `mini ${p[key] ? 'on' : ''}`, title, onclick: (e: Event) => { p[key] = !p[key]; save(); (e.target as HTMLElement).classList.toggle('on', p[key]); } }, label);
  if (isWaveform(p.scope) || p.scope === 'vector' || p.scope === 'cie') {
    const gain = h('input', { type: 'range', min: -3, max: 3, step: 0.1, value: Math.log2(p.gain), title: 'Helligkeit der Spur' }) as HTMLInputElement;
    gain.oninput = () => { p.gain = 2 ** Number(gain.value); save(); };
    gain.ondblclick = (e) => { e.stopPropagation(); p.gain = 1; gain.value = '0'; save(); };
    out.push(gain);
    if (p.scope !== 'wf-rgb') out.push(toggle('Farbe', 'colorize', 'Spur in Bildfarbe'));
  }
  if (p.scope === 'vector') {
    out.push(select(String(p.zoom), [['1', '×1'], ['2', '×2'], ['5', '×5']], (v) => { p.zoom = Number(v); save(); }, 'Zoom'));
  }
  if (p.scope === 'picture') {
    out.push(select(p.picture, [['normal', 'Normal'], ['false', 'Falschfarben'], ['zebra', 'Zebra'], ['clip', 'Clipping'], ['luma', 'Luma']], (v) => { p.picture = v as PictureMode; save(); }, 'Bild-Overlay'));
  }
  if (p.scope === 'hist') {
    out.push(select(p.hist, [['rgb', 'RGB'], ['luma', 'Luma'], ['split', 'Getrennt']], (v) => { p.hist = v as PanelState['hist']; save(); }));
    out.push(toggle('log', 'log', 'Logarithmische Skala'));
  }
  return out;
}

function toggleSolo(idx: number) {
  solo = solo === idx ? null : idx;
  renderPanels();
}

function setProbe(p: PanelState, body: HTMLElement, e: MouseEvent) {
  if (p.scope !== 'picture') return;
  const s = panelSource(p);
  if (!s || !s.width) return;
  const b = body.getBoundingClientRect();
  const r = plotRect('picture', b.width, b.height, s.width / s.height);
  const fx = (e.clientX - b.left - r.x) / r.w, fy = (e.clientY - b.top - r.y) / r.h;
  if (fx < 0 || fy < 0 || fx > 1 || fy > 1) return;
  s.probe = { x: Math.floor(fx * s.width), y: Math.floor(fy * s.height) };
}

// ---------------------------------------------------------------- render loop

const SCATTER: Partial<Record<ScopeType, ScatterMode>> = {
  'wf-luma': 'luma', 'wf-rgb': 'rgb', parade: 'parade', yrgb: 'yrgb', ycbcr: 'ycbcr', vector: 'vector', cie: 'cie',
};
let lastStats = 0;

function frame(now: number) {
  requestAnimationFrame(frame);
  const g = grid.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  renderer.resize(g.width, g.height, dpr);
  renderer.beginFrame();

  if (now - lastStats > 100) {
    lastStats = now;
    const used = new Set(views.map((v) => panelSource(state.panels[v.idx])).filter(Boolean) as Source[]);
    used.forEach((s) => { const { kr, kb } = LUMA[s.colorspace]; s.updateStats(kr, kb); });
  }

  for (const v of views) {
    const p = state.panels[v.idx];
    const src = panelSource(p);
    const b = v.body.getBoundingClientRect();
    const bx = b.left - g.left, by = b.top - g.top;
    const W = Math.round(b.width * dpr), H = Math.round(b.height * dpr);
    if (v.overlay.width !== W || v.overlay.height !== H) { v.overlay.width = W; v.overlay.height = H; }
    const ctx = v.overlay.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, b.width, b.height);
    const aspect = src && src.width ? src.width / src.height : 16 / 9;
    const r = plotRect(p.scope, b.width, b.height, aspect);
    const abs = { x: bx + r.x, y: by + r.y, w: r.w, h: r.h };
    renderer.clearRect(abs);

    if (!src || !src.ready) {
      ctx.fillStyle = '#6b7078'; ctx.font = '12px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(src ? (src.message || 'Keine Daten – Quelle starten') : 'Links eine Quelle hinzufügen', b.width / 2, b.height / 2);
      if (isWaveform(p.scope)) drawWaveGraticule(ctx, p.scope, r, state.unit, src?.transfer ?? 'sdr');
      continue;
    }
    const probeRgb = src.probe ? src.readPixel(src.probe.x, src.probe.y) : null;
    const mode = SCATTER[p.scope];
    if (mode) {
      renderer.drawScatter(`p${v.idx}`, src, abs, {
        mode, gain: p.gain, colorize: p.colorize, zoom: p.zoom, tint: [...TINTS[state.tint]] as [number, number, number], maxSamples: state.maxSamples,
      });
    }
    if (isWaveform(p.scope)) {
      drawWaveGraticule(ctx, p.scope, r, state.unit, src.transfer);
      if (probeRgb) drawWaveProbe(ctx, p.scope, r, src, probeRgb);
    } else if (p.scope === 'vector') {
      drawVectorGraticule(ctx, r, src.colorspace, p.zoom);
      if (probeRgb) {
        const { cb, cr } = ycbcr(probeRgb[0], probeRgb[1], probeRgb[2], src.colorspace);
        const [x, y] = vectorPoint(r, cb, cr, p.zoom);
        ctx.strokeStyle = '#00dcff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); ctx.stroke();
      }
    } else if (p.scope === 'cie') {
      drawCieGraticule(ctx, r, src.colorspace);
      void cieToPlot;
    } else if (p.scope === 'hist') {
      drawHistogram(ctx, r, src, p.hist, p.log);
    } else if (p.scope === 'picture') {
      renderer.drawPicture(src, abs, { mode: p.picture, bands: FALSE_COLOR_PRESETS[state.falsePreset] ?? [], zebra: state.zebra, zebraLow: state.zebraLow });
      if (p.picture === 'false') {
        const bands = FALSE_COLOR_PRESETS[state.falsePreset] ?? [];
        ctx.font = '10px ui-monospace, Menlo, monospace'; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        bands.forEach((bd, i) => {
          const y = r.y + r.h - 12 - (bands.length - 1 - i) * 14;
          ctx.fillStyle = 'rgba(8,9,11,0.75)'; ctx.fillRect(r.x + 4, y - 7, 150, 14);
          ctx.fillStyle = bd.color; ctx.fillRect(r.x + 6, y - 4, 8, 8);
          ctx.fillStyle = '#ddd'; ctx.fillText(`${bd.from}–${Math.min(100, bd.to)} % ${bd.label}`, r.x + 18, y);
        });
      }
      if (src.probe && probeRgb) {
        const x = r.x + ((src.probe.x + 0.5) / src.width) * r.w, y = r.y + ((src.probe.y + 0.5) / src.height) * r.h;
        ctx.strokeStyle = '#00dcff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x - 10, y); ctx.lineTo(x - 3, y); ctx.moveTo(x + 3, y); ctx.lineTo(x + 10, y);
        ctx.moveTo(x, y - 10); ctx.lineTo(x, y - 3); ctx.moveTo(x, y + 3); ctx.lineTo(x, y + 10); ctx.stroke();
        drawTextBox(ctx, r.x + r.w - 6, r.y + 6, probeLines(src, probeRgb, state.unit), 'right');
      }
      if (frozen) drawTextBox(ctx, r.x + 6, r.y + 6, ['STANDBILD']);
    } else if (p.scope === 'stats') {
      const lines = statsLines(src, displayFps);
      if (probeRgb) lines.push('', 'Messpunkt', ...probeLines(src, probeRgb, state.unit));
      ctx.font = '11px ui-monospace, Menlo, monospace'; ctx.fillStyle = '#d6d6d6'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      lines.forEach((l, i) => ctx.fillText(l, 12, 10 + i * 15));
    }
  }

  fpsFrames++;
  if (now - fpsT >= 1000) {
    displayFps = Math.round((fpsFrames * 1000) / (now - fpsT)); fpsFrames = 0; fpsT = now;
    $('#fps').textContent = `${displayFps} fps`;
  }
}

function snapshot() {
  const g = grid.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = glCanvas.width; c.height = glCanvas.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(glCanvas, 0, 0);
  for (const v of views) {
    const b = v.body.getBoundingClientRect();
    ctx.drawImage(v.overlay, (b.left - g.left) * dpr, (b.top - g.top) * dpr);
  }
  const a = document.createElement('a');
  a.download = `lz-scope-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
}

// ---------------------------------------------------------------- keys & boot

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const keys = Object.keys(LAYOUTS);
  if (/^[1-6]$/.test(e.key)) setLayout(keys[Number(e.key) - 1]);
  else if (e.key === ' ') { e.preventDefault(); toggleFreeze(); }
  else if (e.key === 'f' || e.key === 'F') $('#full').click();
  else if (e.key === 's' || e.key === 'S') snapshot();
  else if (e.key === 'b' || e.key === 'B') $('#toggle-side').click();
  else if (e.key === 'Escape') { if (solo !== null) toggleSolo(solo); else sources.forEach((s) => (s.probe = null)); }
});

for (const s of state.sources) addSource(s.kind, s.name, s.url, s.settings);
applySidebar();
renderHeader();
renderPanels();
requestAnimationFrame(frame);
// Auto-connect saved network sources (bridge must be running).
sources.forEach((s) => { if (s.kind === 'stream' && s.url) s.connectStream(s.url, bridgeUrl()); });
