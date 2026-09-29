// Output windows: show scopes on another screen of this computer, and optionally push
// them as a stream. Opened from the main window (window.opener), whose live sources
// and settings are used directly – same origin, so the objects are shared.
//
//   ?view=panel&idx=3          one panel of the main layout
//   ?view=grid                 the whole layout without headers
//   ?view=clean&src=s1         the source picture only
//   ?view=overlay&src=s1&scope=wf-luma&bg=picture|black   scope over the picture (black = for a luma key)
//   &stream=<name>[&target=rtmp://…]   also send JPEG frames to the bridge (/out/<name>.mjpeg, optional push)

import { SCOPE_LABELS, isWaveform, plotRect, type ScopeType } from './graticule';
import { defaultPanel, drawPanel, panelSignature, type DrawOptions, type PanelState } from './panel';
import { Renderer, type Rect } from './renderer';
import type { Source } from './sources';
import { drawVectorGraticule, drawWaveGraticule, drawCieGraticule, drawSkinRange } from './graticule';
import { LUMA } from './color';

export interface OutputHost {
  panels: PanelState[];
  layout: () => { areas: string[]; n: number };
  panelSource: (p: PanelState) => Source | null;
  source: (id: string) => Source | null;
  drawOptions: () => DrawOptions;
  bridgeUrl: () => string;
}

interface Cell { state: PanelState; src: () => Source | null; body: HTMLElement; overlay: HTMLCanvasElement }

export function runOutputView() {
  const q = new URLSearchParams(location.search);
  const host = (window.opener as (Window & { lzs?: OutputHost }) | null)?.lzs;
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;color:#ddd;font:12px system-ui';
  if (!host) {
    document.body.textContent = 'Dieses Ausgabefenster braucht das geöffnete LZ-Scopes-Hauptfenster.';
    return;
  }
  const view = q.get('view') ?? 'grid';
  document.title = `LZ Scopes – Ausgabe ${view}`;
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;display:grid;gap:2px;background:#000';
  const glCanvas = document.createElement('canvas');
  glCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  root.append(glCanvas);
  document.body.replaceChildren(root);
  const renderer = new Renderer(glCanvas);

  const cells: Cell[] = [];
  const addCell = (state: PanelState, src: () => Source | null, area = '') => {
    const body = document.createElement('div');
    body.style.cssText = `position:relative;min-width:0;min-height:0${area ? `;grid-area:${area}` : ''}`;
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    body.append(overlay); root.append(body);
    cells.push({ state, src, body, overlay });
  };

  if (view === 'grid') {
    const L = host.layout();
    root.style.gridTemplateAreas = L.areas.map((a) => `"${a}"`).join(' ');
    for (let i = 0; i < L.n; i++) addCell(host.panels[i], () => host.panelSource(host.panels[i]), 'abcdefghi'[i]);
  } else if (view === 'panel') {
    const i = Number(q.get('idx') ?? 0);
    addCell(host.panels[i], () => host.panelSource(host.panels[i]));
  } else {
    const state = defaultPanel('picture');
    const srcId = q.get('src') ?? '';
    addCell(state, () => host.source(srcId) ?? host.panelSource(host.panels[0]));
  }

  const overlayScope = (q.get('scope') ?? 'wf-luma') as ScopeType;
  const blackBg = q.get('bg') === 'black';
  const sigs = new Map<number, string>();
  let clear = true;

  const frame = () => {
    requestAnimationFrame(frame);
    const g = root.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (renderer.resize(g.width, g.height, dpr)) clear = true;
    renderer.beginFrame(clear);
    if (clear) { sigs.clear(); clear = false; }
    const o = { ...host.drawOptions(), emptyText: 'Kein Signal' };
    cells.forEach((c, i) => {
      const src = c.src();
      if (src) { const { kr, kb } = LUMA[src.colorspace]; src.updateStats(kr, kb); }
      const b = c.body.getBoundingClientRect();
      const body: Rect = { x: b.left - g.left, y: b.top - g.top, w: b.width, h: b.height };
      const sig = panelSignature(c.state, src, body, o) + dpr + view + overlayScope + blackBg;
      if (sigs.get(i) === sig) return;
      sigs.set(i, sig);
      const W = Math.round(b.width * dpr), H = Math.round(b.height * dpr);
      if (c.overlay.width !== W || c.overlay.height !== H) { c.overlay.width = W; c.overlay.height = H; }
      const ctx = c.overlay.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, b.width, b.height);
      if (view === 'overlay') drawOverlay(renderer, ctx, src, body, overlayScope, blackBg, o);
      else if (view === 'clean') {
        // picture without probe/ROI/legend markings
        if (!src?.ready) return;
        const r = plotRect('picture', body.w, body.h, src.width / src.height);
        renderer.clearRect({ x: body.x, y: body.y, w: body.w, h: body.h });
        renderer.drawPicture(src, { x: body.x + r.x, y: body.y + r.y, w: r.w, h: r.h }, {
          mode: 'normal', bands: [], zebra: 2, zebraLow: 0, roi: null, skin: o.skin, display: displayOf(o, src),
        });
      } else drawPanel(renderer, ctx, `o${i}`, c.state, src, body, o);
    });
  };
  requestAnimationFrame(frame);

  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:10px;bottom:10px;background:rgba(0,0,0,.75);padding:4px 8px;border-radius:4px;transition:opacity .5s;pointer-events:none';
  document.body.append(hud);
  let hudT = 0;
  const showHud = (extra = '') => {
    hud.textContent = `${view}${view === 'overlay' ? ` · ${SCOPE_LABELS[overlayScope]}` : ''}${extra}  ·  F Vollbild · Doppelklick Vollbild`;
    hud.style.opacity = '1'; clearTimeout(hudT); hudT = window.setTimeout(() => (hud.style.opacity = '0'), 2500);
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') toggleFs(); });
  root.addEventListener('dblclick', toggleFs);
  document.addEventListener('mousemove', () => showHud());
  showHud();

  const name = q.get('stream');
  if (name) startStream(host, glCanvas, cells, name, q.get('target') ?? '', Number(q.get('fps') ?? 25), (m) => showHud(` · Stream ${m}`));
}

function toggleFs() {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
}

import { displayParams } from './panel';
const displayOf = (o: DrawOptions, src: Source) => displayParams(src, o.display);

/** Picture with a scope on top: waveforms in the lower third, round scopes in the right corner. */
function drawOverlay(renderer: Renderer, ctx: CanvasRenderingContext2D, src: Source | null, body: Rect, scope: ScopeType, blackBg: boolean, o: DrawOptions) {
  renderer.clearRect(body);
  if (!src?.ready) return;
  const pic = plotRect('picture', body.w, body.h, src.width / src.height);
  const abs = (r: Rect) => ({ x: body.x + r.x, y: body.y + r.y, w: r.w, h: r.h });
  if (!blackBg) {
    renderer.drawPicture(src, abs(pic), { mode: 'normal', bands: [], zebra: 2, zebraLow: 0, roi: null, skin: o.skin, display: displayOf(o, src) });
  }
  const wave = isWaveform(scope);
  const r: Rect = wave
    ? { x: pic.x + pic.w * 0.04, y: pic.y + pic.h * 0.62, w: pic.w * 0.92, h: pic.h * 0.34 }
    : { x: pic.x + pic.w - pic.h * 0.42, y: pic.y + pic.h * 0.56, w: pic.h * 0.4, h: pic.h * 0.4 };
  if (!blackBg) renderer.shade(abs(r), 0.55);
  const mode = scope === 'vector' ? 'vector' : scope === 'cie' ? 'cie' : scope === 'wf-skin' ? 'skin' : scope === 'parade' ? 'parade' : scope === 'yrgb' ? 'yrgb' : scope === 'ycbcr' ? 'ycbcr' : scope === 'wf-rgb' ? 'rgb' : 'luma';
  renderer.drawScatter('overlay', src, abs(r), {
    mode, gain: 2.5, colorize: scope === 'wf-color' || scope === 'vector' || scope === 'cie', zoom: 1,
    tint: [0.55, 1, 0.62], maxSamples: o.maxSamples, roi: src.roi, skin: o.skin,
  }, true);
  if (wave) { drawWaveGraticule(ctx, scope, r, o.unit, src.transfer); if (scope === 'wf-skin') drawSkinRange(ctx, r, o.skin); }
  else if (scope === 'vector') drawVectorGraticule(ctx, r, src.colorspace, 1);
  else if (scope === 'cie') drawCieGraticule(ctx, r, src.colorspace);
}

/** Composite GL + overlays, send JPEG frames to the bridge (MJPEG pull URL, optional push). */
function startStream(host: OutputHost, gl: HTMLCanvasElement, cells: Cell[], name: string, target: string, fps: number, status: (m: string) => void) {
  const q = new URLSearchParams({ name, fps: String(fps) });
  if (target) q.set('target', target);
  const ws = new WebSocket(`${host.bridgeUrl()}/out?${q}`);
  const comp = document.createElement('canvas');
  ws.onmessage = (e) => { try { const m = JSON.parse(e.data); status(m.message ?? m.type); } catch { /* ignore */ } };
  ws.onclose = () => status('beendet');
  ws.onerror = () => status('Bridge nicht erreichbar');
  let busy = false;
  const timer = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) { if (ws.readyState > 1) clearInterval(timer); return; }
    if (busy || ws.bufferedAmount > 2_000_000) return;
    busy = true;
    comp.width = gl.width; comp.height = gl.height;
    const ctx = comp.getContext('2d')!;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, comp.width, comp.height);
    ctx.drawImage(gl, 0, 0);
    const g = gl.getBoundingClientRect(), dpr = gl.width / Math.max(1, g.width);
    for (const c of cells) {
      const b = c.body.getBoundingClientRect();
      ctx.drawImage(c.overlay, (b.left - g.left) * dpr, (b.top - g.top) * dpr);
    }
    comp.toBlob((blob) => { if (blob && ws.readyState === WebSocket.OPEN) ws.send(blob); busy = false; }, 'image/jpeg', 0.85);
  }, 1000 / fps);
}
