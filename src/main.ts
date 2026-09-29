import './style.css';
import { DISPLAY_LABELS, FALSE_COLOR_PRESETS, LUMA, detectDisplay, type DisplaySpace } from './color';
import { SCOPE_LABELS, isWaveform, plotRect, type ScopeType, type Unit } from './graticule';
import { DEFAULT_SKIN, defaultPanel as panel, drawPanel, panelSignature, type DrawOptions, type PanelState, type Tint } from './panel';
import type { OutputHost } from './outputView';
import { PATTERNS, RESOLUTIONS, addImagePatterns, patternById } from './patterns';
import { Renderer, type PictureMode, type SkinRange } from './renderer';
import { Source, type SourceKind, type SourceSettings } from './sources';

// ---------------------------------------------------------------- state

type PatternState = Source['pattern'];
interface Persisted {
  layout: string; panels: PanelState[]; unit: Unit; tint: Tint; falsePreset: string;
  zebra: number; zebraLow: number; maxSamples: number; bridge: string; sidebar: boolean;
  skin: SkinRange; display: 'auto' | DisplaySpace;
  sources: { kind: SourceKind; name: string; url: string; settings: SourceSettings; pattern?: PatternState }[];
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
const STORE_KEY = 'lz-scopes.v1';

function load(): Persisted {
  const base: Persisted = {
    layout: 'lc', panels: DEFAULT_SCOPES.map(panel), unit: 'percent', tint: 'green', falsePreset: 'ARRI', zebra: 0.95, zebraLow: 0,
    maxSamples: 1_000_000, bridge: '', sidebar: true, skin: { ...DEFAULT_SKIN }, display: 'auto',
    sources: [{ kind: 'pattern', name: 'Testbild', url: '', settings: { transfer: 'auto', colorspace: 'auto', width: 960, fps: 0, depth: 8, transport: 'tcp' }, pattern: { id: 'smpte75', width: 1920, height: 1080, label: '' } }],
  };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (s && Array.isArray(s.panels)) return { ...base, ...s, layout: s.layout in LAYOUTS ? s.layout : base.layout, panels: DEFAULT_SCOPES.map((d, i) => ({ ...panel(d), ...s.panels[i] })) };
  } catch { /* storage unavailable */ }
  return base;
}

const state = load();
const detected = detectDisplay();
const sources: Source[] = [];
let solo: number | null = null;
let frozen = false;
let fpsFrames = 0, displayFps = 0, fpsT = performance.now();

function save() {
  const p: Persisted = {
    ...state,
    sources: sources.filter((s) => s.kind === 'stream' || s.kind === 'pattern')
      .map((s) => ({ kind: s.kind, name: s.name, url: s.url, settings: s.settings, pattern: s.pattern })),
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
    <div class="brand"><span class="mark">LZ</span> Scopes</div>
    <button class="icon" id="toggle-side" title="Quellen ein/aus (B)">☰</button>
    <div class="group" id="layouts"></div>
    <div class="group" id="globals"></div>
    <div class="spacer"></div>
    <span class="fps" id="fps"></span>
    <button id="freeze" title="Standbild (Leertaste)">❚❚ Einfrieren</button>
    <details class="menu" id="outmenu"><summary title="Ausgabe auf einen Bildschirm dieses Rechners oder als Stream">⧉ Ausgabe</summary><div class="menu-body right" id="outbody"></div></details>
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
  const disp = state.display === 'auto' ? detected.space : state.display;
  $('#globals').replaceChildren(
    select(state.unit, [['percent', '%'], ['bit8', '8 bit'], ['bit10', '10 bit'], ['nits', 'cd/m²']], (v) => { state.unit = v as Unit; save(); }, 'Skala'),
    h('details', { class: 'menu' },
      h('summary', { title: 'Einstellungen' }, `⚙ ${DISPLAY_LABELS[disp].split(' ')[0]}${state.display === 'auto' ? ' auto' : ''}`),
      h('div', { class: 'menu-body' }, ...settingsItems())),
  );
}

function settingsItems(): Node[] {
  const row = (label: string, ...kids: (Node | string)[]) => h('label', { class: 'mrow' }, h('span', {}, label), ...kids);
  return [
    row('Display', select(state.display, [['auto', `auto: ${DISPLAY_LABELS[detected.space]}${detected.hdr ? ' (HDR-fähig)' : ''}`], ...(Object.entries(DISPLAY_LABELS) as [string, string][])],
      (v) => { state.display = v as Persisted['display']; save(); renderHeader(); }, 'Display-Farbraum der Bildansicht; die Scopes messen immer das Signal')),
    row('Spurfarbe', select(state.tint, [['green', 'Grün'], ['white', 'Weiß'], ['amber', 'Bernstein']], (v) => { state.tint = v as Tint; save(); })),
    row('Präzision', select(String(state.maxSamples), [['250000', 'Schnell'], ['1000000', 'Standard'], ['4000000', 'Voll']], (v) => { state.maxSamples = Number(v); save(); }, 'Abtastpunkte je Scope')),
    row('Falschfarben', select(state.falsePreset, Object.keys(FALSE_COLOR_PRESETS).map((k) => [k, k]), (v) => { state.falsePreset = v; save(); })),
    row('Hautton Luma',
      numIn(Math.round(state.skin.lo * 100), 0, 100, (v) => { state.skin.lo = v / 100; }), '–',
      numIn(Math.round(state.skin.hi * 100), 0, 100, (v) => { state.skin.hi = v / 100; }), '%'),
    row('Hautton Farbton ±', numIn(state.skin.tol, 2, 45, (v) => { state.skin.tol = v; }), '° um die Hautton-Linie'),
    row('Zebra', numIn(Math.round(state.zebra * 100), 50, 109, (v) => { state.zebra = v / 100; }), '%'),
  ];
}

function numIn(value: number, min: number, max: number, set: (v: number) => void) {
  return h('input', { type: 'number', class: 'num', min, max, step: 1, value, onchange: (e: Event) => { set(Number((e.target as HTMLInputElement).value)); save(); } });
}

function setLayout(k: string) {
  state.layout = k; solo = null; save(); renderHeader(); renderPanels();
}

$<HTMLDetailsElement>('#outmenu').addEventListener('toggle', (e) => { if ((e.target as HTMLDetailsElement).open) renderOutputMenu(); });
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
    } else if (s.kind === 'pattern') {
      card.append(...patternControls(s));
    } else {
      if (s.isVideoFile) card.append(...transportControls(s));
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

function patternSelect(value: string, onchange: (id: string) => void) {
  const groups = [...new Set(PATTERNS.map((p) => p.group))];
  return h('select', { class: 'pattern', title: 'Testbild', onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
    ...groups.map((g) => h('optgroup', { label: g },
      ...PATTERNS.filter((p) => p.group === g).map((p) => h('option', { value: p.id, selected: p.id === value }, p.name)))));
}

function patternControls(s: Source): Node[] {
  const pt = s.pattern;
  const apply = (patch: Partial<PatternState>) => { Object.assign(pt, patch); save(); s.startPattern(); };
  const step = (d: number) => {
    const i = PATTERNS.findIndex((p) => p.id === pt.id);
    apply({ id: PATTERNS[(i + d + PATTERNS.length) % PATTERNS.length].id });
  };
  const label = h('input', { class: 'url', value: pt.label, placeholder: 'Kennung / Label (optional)' }) as HTMLInputElement;
  label.onchange = () => apply({ label: label.value });
  const imgs = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true }) as HTMLInputElement;
  imgs.onchange = () => {
    const added = addImagePatterns([...(imgs.files ?? [])]);
    if (added.length) apply({ id: added[0].id });
  };
  return [
    h('div', { class: 'row' },
      h('button', { class: 'mini', title: 'Vorheriges Testbild', onclick: () => step(-1) }, '◀'),
      patternSelect(pt.id, (id) => apply({ id })),
      h('button', { class: 'mini', title: 'Nächstes Testbild', onclick: () => step(1) }, '▶')),
    h('div', { class: 'row' },
      select(`${pt.width}x${pt.height}`, RESOLUTIONS.map(([w, hh]) => [`${w}x${hh}`, `${w}×${hh}`]), (v) => {
        const [w, hh] = v.split('x').map(Number); apply({ width: w, height: hh });
      }, 'Auflösung'),
      label),
    h('div', { class: 'row' },
      h('button', { class: 'primary', title: 'Testbild im eigenen Fenster ausgeben (für Monitor, Beamer, Capture)', onclick: () => openOutput(pt) }, '⧉ Ausgeben'),
      h('button', { title: 'Eigene Bilder als Testbilder laden', onclick: () => imgs.click() }, '+ Bilder'), imgs),
  ];
}

function openOutput(pt: PatternState) {
  const q = new URLSearchParams({ out: pt.id, w: String(pt.width), h: String(pt.height), label: pt.label });
  if (patternById(pt.id).group === 'Eigene Bilder') q.set('out', 'smpte75'); // object URLs don't cross windows
  window.open(`${location.pathname}?${q}`, 'lz-scopes-pattern', 'popup,width=1280,height=720');
}

async function startLocal(s: Source) {
  if (s.kind === 'pattern') return s.startPattern();
  if (s.kind === 'webcam' || s.kind === 'screen') return s.startCapture(s.kind);
  const input = h('input', { type: 'file', accept: 'video/*,image/*' }) as HTMLInputElement;
  input.onchange = () => { const f = input.files?.[0]; if (f) s.openFile(f).then(renderPanels); };
  input.click();
}

$('#add').replaceChildren(
  h('span', {}, '+ Quelle'),
  h('button', { onclick: () => startLocal(addSource('pattern', `Testbild ${sources.length + 1}`)) }, 'Testbild'),
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
  needClear = true;
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
        sources.length > 1 ? select(panelSource(p)?.id ?? '', sources.map((s, i) => [s.id, `${i + 1} ${s.name}`]), (v) => switchSource(p, v), 'Quelle – alle nicht angehefteten Panels folgen') : '',
        sources.length > 1 ? h('button', { class: `icon pin ${p.pin ? 'on' : ''}`, title: p.pin ? 'Angeheftet: behält seine Quelle' : 'Anheften: Panel behält seine Quelle, wenn andere umschalten', onclick: () => { p.pin = !p.pin; save(); renderPanels(); } }, '📌') : '',
        h('div', { class: 'opts' }, ...opts),
        h('button', { class: 'icon', title: solo === idx ? 'Zurück (Esc)' : 'Solo', onclick: () => toggleSolo(idx) }, solo === idx ? '⤡' : '⤢')),
      body);
    body.addEventListener('dblclick', () => toggleSolo(idx));
    attachPointer(p, body);
    body.addEventListener('contextmenu', (e) => { e.preventDefault(); const s = panelSource(p); if (s) { s.probe = null; s.roi = null; } });
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
    out.push(select(p.picture, [['normal', 'Normal'], ['false', 'Falschfarben'], ['zebra', 'Zebra'], ['clip', 'Clipping'], ['skin', 'Hautton'], ['luma', 'Luma']], (v) => { p.picture = v as PictureMode; save(); }, 'Bild-Overlay'));
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

/** Switching the source in one panel switches every panel that is not pinned. */
function switchSource(from: PanelState, id: string) {
  from.sourceId = id;
  for (const q of state.panels) if (!q.pin) q.sourceId = id;
  save(); renderPanels();
}

/** Picture panel: click = probe, drag = region of interest (highlighted in all scopes). */
function attachPointer(p: PanelState, body: HTMLElement) {
  const toSrc = (e: PointerEvent, s: Source, clamp: boolean) => {
    const b = body.getBoundingClientRect();
    const r = plotRect('picture', b.width, b.height, s.width / s.height);
    let fx = (e.clientX - b.left - r.x) / r.w, fy = (e.clientY - b.top - r.y) / r.h;
    if (!clamp && (fx < 0 || fy < 0 || fx > 1 || fy > 1)) return null;
    fx = Math.min(1, Math.max(0, fx)); fy = Math.min(1, Math.max(0, fy));
    return { x: Math.min(s.width - 1, Math.floor(fx * s.width)), y: Math.min(s.height - 1, Math.floor(fy * s.height)) };
  };
  let start: { x: number; y: number; cx: number; cy: number } | null = null;
  body.addEventListener('pointerdown', (e) => {
    const s = panelSource(p);
    if (p.scope !== 'picture' || !s?.width || e.button !== 0) return;
    const pt = toSrc(e, s, false);
    if (!pt) return;
    start = { ...pt, cx: e.clientX, cy: e.clientY };
    try { body.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  });
  body.addEventListener('pointermove', (e) => {
    const s = panelSource(p);
    if (!start || !s) return;
    if (Math.hypot(e.clientX - start.cx, e.clientY - start.cy) < 5) return;
    const pt = toSrc(e, s, true)!;
    s.roi = [Math.min(start.x, pt.x), Math.min(start.y, pt.y), Math.max(start.x, pt.x) + 1, Math.max(start.y, pt.y) + 1];
  });
  body.addEventListener('pointerup', (e) => {
    const s = panelSource(p);
    if (start && s && Math.hypot(e.clientX - start.cx, e.clientY - start.cy) < 5) s.probe = { x: start.x, y: start.y };
    start = null;
  });
}

// ---------------------------------------------------------------- transport (video files)

/** The video file shown in the most panels (fallback: any video file). */
function activeVideo(): Source | null {
  const shown = views.map((v) => panelSource(state.panels[v.idx])).filter((s): s is Source => !!s && s.isVideoFile);
  return shown[0] ?? sources.find((s) => s.isVideoFile) ?? null;
}

function transportControls(s: Source): Node[] {
  const range = h('input', { type: 'range', class: 'playhead', 'data-src': s.id, min: 0, max: 1000, step: 1, value: 0, title: 'Playhead' }) as HTMLInputElement;
  range.oninput = () => { const v = s.video; if (v && v.duration) { v.pause(); s.seek((Number(range.value) / 1000) * v.duration); } };
  const btn = (label: string, title: string, fn: () => void) => h('button', { class: 'mini', title, onclick: fn }, label);
  return [
    h('div', { class: 'row' }, range),
    h('div', { class: 'row transport' },
      btn('⏮', 'Anfang (Pos1)', () => s.seek(0)),
      btn('◀◀', 'Rückwärts (J, mehrfach = schneller)', () => s.shuttle(-1)),
      btn('◀|', 'Frame zurück (←)', () => s.step(-1)),
      btn(s.video?.paused === false ? '❚❚' : '▶', 'Start/Stopp (Leertaste, K)', () => s.togglePlay()),
      btn('|▶', 'Frame vor (→)', () => s.step(1)),
      btn('▶▶', 'Vorwärts (L, mehrfach = schneller)', () => s.shuttle(1)),
      h('span', { class: 'tc', 'data-tc': s.id }, s.timecode())),
  ];
}

/** Move playheads and timecodes without re-rendering the source list. */
function updateTransport() {
  for (const s of sources) {
    const v = s.video;
    if (!v || !s.isVideoFile) continue;
    const r = document.querySelector<HTMLInputElement>(`input.playhead[data-src="${s.id}"]`);
    if (r && document.activeElement !== r && v.duration) r.value = String(Math.round((v.currentTime / v.duration) * 1000));
    const tc = document.querySelector<HTMLElement>(`[data-tc="${s.id}"]`);
    if (tc) tc.textContent = `${s.timecode()} / ${s.timecode(v.duration || 0)}${v.playbackRate !== 1 ? ` ×${v.playbackRate}` : ''}${s.reverseSpeed ? ` ◀×${s.reverseSpeed}` : ''}`;
  }
}

// ---------------------------------------------------------------- render loop

let lastStats = 0;
let needClear = true;
const panelSigs = new Map<number, string>();

function frame(now: number) {
  requestAnimationFrame(frame);
  const g = grid.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const displaySpace = state.display === 'auto' ? detected.space : state.display;
  renderer.setOutputSpace(displaySpace === 'p3' ? 'display-p3' : 'srgb');
  if (renderer.resize(g.width, g.height, dpr)) needClear = true;
  renderer.beginFrame(needClear);
  if (needClear) { panelSigs.clear(); needClear = false; }
  updateTransport();

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
    const bodyRect = { x: bx, y: by, w: b.width, h: b.height };
    const opts = drawOptions();
    // Skip panels whose inputs did not change: no GPU work, no overlay redraw.
    const sig = panelSignature(p, src, bodyRect, opts) + dpr;
    if (panelSigs.get(v.idx) === sig) continue;
    panelSigs.set(v.idx, sig);
    const W = Math.round(b.width * dpr), H = Math.round(b.height * dpr);
    if (v.overlay.width !== W || v.overlay.height !== H) { v.overlay.width = W; v.overlay.height = H; }
    const ctx = v.overlay.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, b.width, b.height);
    drawPanel(renderer, ctx, `p${v.idx}`, p, src, bodyRect, opts);
  }

  fpsFrames++;
  if (now - fpsT >= 1000) {
    displayFps = Math.round((fpsFrames * 1000) / (now - fpsT)); fpsFrames = 0; fpsT = now;
    $('#fps').textContent = `${displayFps} fps`;
  }
}

function drawOptions(): DrawOptions {
  const displaySpace = state.display === 'auto' ? detected.space : state.display;
  return {
    unit: state.unit, tint: state.tint, maxSamples: state.maxSamples, falsePreset: state.falsePreset,
    zebra: state.zebra, zebraLow: state.zebraLow, frozen, displayFps, skin: state.skin, display: displaySpace,
  };
}

// ---------------------------------------------------------------- outputs

// The output windows read live sources and settings from here (same origin).
(window as unknown as { lzs: OutputHost }).lzs = {
  panels: state.panels,
  layout: () => LAYOUTS[state.layout] ?? LAYOUTS.lc,
  panelSource,
  source: (id) => sources.find((s) => s.id === id) ?? null,
  drawOptions,
  bridgeUrl,
};

interface DesktopApi { displays: () => Promise<{ id: number; label: string; bounds: { width: number; height: number }; primary: boolean }[]> }
const desktop = (window as unknown as { lzsDesktop?: DesktopApi }).lzsDesktop;

async function renderOutputMenu() {
  const out = { view: 'grid', idx: '0', src: sources[0]?.id ?? '', scope: 'wf-luma', bg: 'picture', display: '', fs: true, stream: '', target: '' };
  const screens: [string, string][] = [['', 'Neues Fenster']];
  if (desktop) {
    for (const d of await desktop.displays()) screens.push([String(d.id), `${d.label || 'Bildschirm'} ${d.bounds.width}×${d.bounds.height}${d.primary ? ' (Haupt)' : ''}`]);
  }
  const L = LAYOUTS[state.layout] ?? LAYOUTS.lc;
  const row = (label: string, ...kids: (Node | string)[]) => h('label', { class: 'mrow' }, h('span', {}, label), ...kids);
  const txt = (key: 'stream' | 'target', ph: string) => { const i = h('input', { placeholder: ph, spellcheck: 'false' }) as HTMLInputElement; i.oninput = () => (out[key] = i.value.trim()); return i; };
  const fsBox = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  fsBox.onchange = () => (out.fs = fsBox.checked);
  $('#outbody').replaceChildren(
    row('Inhalt', select(out.view, [['grid', 'Gesamtansicht (Layout)'], ['panel', 'Einzelnes Panel'], ['clean', 'Quellbild sauber'], ['overlay', 'Bild + Scope-Overlay']], (v) => (out.view = v))),
    row('Panel', select('0', [...Array(L.n).keys()].map((i) => [String(i), `${i + 1} · ${SCOPE_LABELS[state.panels[i].scope]}`]), (v) => (out.idx = v))),
    row('Quelle', select(out.src, sources.map((s, i) => [s.id, `${i + 1} ${s.name}`]), (v) => (out.src = v))),
    row('Overlay-Scope', select(out.scope, (['wf-luma', 'wf-color', 'wf-skin', 'parade', 'yrgb', 'vector', 'cie'] as ScopeType[]).map((k) => [k, SCOPE_LABELS[k]]), (v) => (out.scope = v))),
    row('Overlay-Hintergrund', select(out.bg, [['picture', 'Bild'], ['black', 'Schwarz (für Luma-Key am Mischer)']], (v) => (out.bg = v))),
    row('Ausgang', select('', screens, (v) => (out.display = v)), h('label', { class: 'inline' }, fsBox, 'Vollbild')),
    row('Stream-Name', txt('stream', 'optional, z. B. scopes → /out/scopes.mjpeg')),
    row('Push an', txt('target', 'optional: rtmp:// srt:// rtsp:// udp://')),
    h('div', { class: 'mrow' }, h('span', {}, ''), h('button', { class: 'primary', onclick: () => openOutputView(out) }, 'Ausgabe öffnen')),
    h('p', { class: 'hint' }, desktop ? 'Vollbild auf dem gewählten Bildschirm.' : 'Im Browser: Fenster auf den Zielbildschirm ziehen, dann F oder Doppelklick für Vollbild. Die Desktop-App wählt den Bildschirm direkt.'),
  );
}

function openOutputView(o: { view: string; idx: string; src: string; scope: string; bg: string; display: string; fs: boolean; stream: string; target: string }) {
  const q = new URLSearchParams({ view: o.view });
  if (o.view === 'panel') q.set('idx', o.idx);
  if (o.view === 'clean' || o.view === 'overlay') q.set('src', o.src);
  if (o.view === 'overlay') { q.set('scope', o.scope); q.set('bg', o.bg); }
  if (o.stream) { q.set('stream', o.stream.replace(/[^\w-]/g, '')); if (o.target) q.set('target', o.target); }
  if (o.display) q.set('display', o.display);
  if (o.fs) q.set('fs', '1');
  window.open(`${location.pathname}?${q}`, `lzs-out-${Date.now()}`, 'popup,width=1280,height=720');
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
  a.download = `lz-scopes-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
  a.href = c.toDataURL('image/png');
  a.click();
}

// ---------------------------------------------------------------- keys & boot

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const keys = Object.keys(LAYOUTS);
  if (/^[1-6]$/.test(e.key)) setLayout(keys[Number(e.key) - 1]);
  else if (e.key === ' ') { e.preventDefault(); const v = activeVideo(); if (v) v.togglePlay(); else toggleFreeze(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const v = activeVideo(); if (!v) return;
    e.preventDefault();
    const d = e.key === 'ArrowRight' ? 1 : -1;
    if (e.shiftKey) v.seek((v.video?.currentTime ?? 0) + d); else v.step(d);
  }
  else if (e.key === 'j' || e.key === 'J') activeVideo()?.shuttle(-1);
  else if (e.key === 'k' || e.key === 'K') activeVideo()?.shuttle(0);
  else if (e.key === 'l' || e.key === 'L') activeVideo()?.shuttle(1);
  else if (e.key === 'Home') activeVideo()?.seek(0);
  else if (e.key === 'End') { const v = activeVideo(); v?.seek(v.video?.duration ?? 0); }
  else if (e.key === 'f' || e.key === 'F') $('#full').click();
  else if (e.key === 's' || e.key === 'S') snapshot();
  else if (e.key === 'b' || e.key === 'B') $('#toggle-side').click();
  else if (e.key === 'Escape') { if (solo !== null) toggleSolo(solo); else sources.forEach((s) => { s.probe = null; s.roi = null; }); }
});

for (const saved of state.sources) {
  const s = addSource(saved.kind, saved.name, saved.url, saved.settings);
  if (saved.pattern) Object.assign(s.pattern, saved.pattern);
  if (s.kind === 'pattern') s.startPattern();
}
applySidebar();
renderHeader();
renderPanels();
requestAnimationFrame(frame);
// Auto-connect saved network sources (bridge must be running).
sources.forEach((s) => { if (s.kind === 'stream' && s.url) s.connectStream(s.url, bridgeUrl()); });
