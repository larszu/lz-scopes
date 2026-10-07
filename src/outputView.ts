// Output windows: show scopes on another screen of this computer, and optionally push
// them as a stream. Opened from the main window (window.opener), whose live sources
// and settings are used directly – same origin, so the objects are shared.
//
//   ?view=panel&idx=3          one panel of the main layout
//   ?view=grid                 the whole layout without headers
//   ?view=clean&src=s1         the source picture only
//   ?view=overlay&src=s1&scene=<id>&bg=picture|black   overlay scene over the picture (black = for a luma key)
//   &name=<output name>        how the main window (and the control API) addresses this window
//   &stream=<name>[&target=rtmp://…]   also send JPEG frames to the bridge (/out/<name>.mjpeg, optional push)
//   &codec=hevc10|hevc422|v210|prores   instead: 10-bit Y′CbCr frames to the bridge, pushed to &target (server/out10.mjs)
//
// The WebGL canvas asks for a RGBA16F drawing buffer (src/deep.ts); the HUD says which one it got.
//
// Overlay view: E (or the ✎ button) toggles the edit mode – drag scopes, resize them by
// their handles, add and remove them. Outside the edit mode there is no cursor and no
// handle; the stream never contains the edit layer.

import { SCOPE_LABELS, isWaveform, plotRect, type ScopeType } from './graticule';
import { defaultPanel, drawPanel, panelSignature, type DrawOptions, type PanelState } from './panel';
import { Renderer, type Rect } from './renderer';
import type { Source } from './sources';
import { drawVectorGraticule, drawWaveGraticule, drawCieGraticule, drawSkinRange, drawHistogram } from './graticule';
import { LUMA } from './color';
import { displayParams, vectorTargets } from './panel';
import { CURSORS, MAX_ELEMENTS, dragElement, hitTest, newElement, type Handle, type OverlayElement, type OverlayScene } from './scene';
import { OVERLAY_SCOPES } from '../server/control.mjs';
import { HUD_STYLE, onThemeChange, storedTheme } from './theme';
import { deepContext, isCodec10, pipelineText, pixelsToFrame10, readPixels, startStream10, type Codec10 } from './deep';
import { t } from './i18n';

export interface OutputHost {
  panels: PanelState[];
  /** Open panels as fractions of the main window's scope area. */
  panelRects: () => { idx: number; x: number; y: number; w: number; h: number }[];
  panelSource: (p: PanelState) => Source | null;
  source: (id: string) => Source | null;
  sources: () => { id: string; name: string }[];
  drawOptions: () => DrawOptions;
  bridgeUrl: () => string;
  /** Scene shown by the output window `name` (URL scene as fallback). */
  sceneFor: (name: string, fallbackId: string) => OverlayScene | null;
  /** A scene was edited in an output window: persist it. */
  sceneChanged: () => void;
}

/** What the main window can call on an open output window (control API). */
export interface OutputWindowApi {
  startStream: (name: string, target: string, codec?: string) => void;
  stopStream: () => void;
  stream: () => string;
}

interface Cell { state: PanelState; src: () => Source | null; body: HTMLElement; overlay: HTMLCanvasElement }

export function runOutputView() {
  const q = new URLSearchParams(location.search);
  const host = (window.opener as (Window & { lzs?: OutputHost }) | null)?.lzs;
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;color:#ddd;font:12px system-ui;cursor:none';
  if (!host) {
    document.body.style.cursor = '';
    document.body.textContent = t('output.needsMain');
    return;
  }
  const view = q.get('view') ?? 'grid';
  const outName = q.get('name') ?? '';
  document.title = `${t('output.title')} ${outName || view}`;
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;inset:0;display:grid;gap:2px;background:#000';
  const glCanvas = document.createElement('canvas');
  glCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  root.append(glCanvas);
  document.body.replaceChildren(root);
  const renderer = new Renderer(glCanvas, { deep: true });

  const cells: Cell[] = [];
  const sigs = new Map<number, string>();
  let clear = true;
  const addCell = (state: PanelState, src: () => Source | null, area = '') => {
    const body = document.createElement('div');
    body.style.cssText = `position:relative;min-width:0;min-height:0${area ? `;grid-area:${area}` : ''}`;
    const overlay = document.createElement('canvas');
    overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    body.append(overlay); root.append(body);
    cells.push({ state, src, body, overlay });
  };

  if (view === 'grid') {
    // mirror the main window's dock layout; follows changes twice a second
    root.style.display = 'block';
    const place = () => {
      const rects = host.panelRects();
      const key = JSON.stringify(rects);
      if (key === root.dataset.layout) return;
      root.dataset.layout = key;
      cells.forEach((c) => c.body.remove()); cells.length = 0; clear = true;
      for (const r of rects) {
        addCell(host.panels[r.idx], () => host.panelSource(host.panels[r.idx]));
        cells[cells.length - 1].body.style.cssText += `;position:absolute;left:${r.x * 100}%;top:${r.y * 100}%;width:${r.w * 100}%;height:${r.h * 100}%`;
      }
    };
    place();
    setInterval(place, 500);
  } else if (view === 'panel') {
    const i = Number(q.get('idx') ?? 0);
    addCell(host.panels[i], () => host.panelSource(host.panels[i]));
  } else {
    const state = defaultPanel('picture');
    const srcId = q.get('src') ?? '';
    addCell(state, () => host.source(srcId) ?? host.panelSource(host.panels[0]));
  }

  const blackBg = q.get('bg') === 'black';
  const scene = () => host.sceneFor(outName, q.get('scene') ?? '');
  const editor = view === 'overlay' ? createEditor(host, root, scene, () => cells[0]?.src() ?? null) : null;

  const frame = () => {
    requestAnimationFrame(frame);
    const g = root.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (renderer.resize(g.width, g.height, dpr)) { clear = true; document.body.dataset.pipeline = renderer.bufferFormat; showHud(); }
    renderer.beginFrame(clear);
    if (clear) { sigs.clear(); clear = false; }
    const o = { ...host.drawOptions(), emptyText: t('output.noSignal') };
    cells.forEach((c, i) => {
      const src = c.src();
      if (src) { const { kr, kb } = LUMA[src.colorspace]; src.updateStats(kr, kb); }
      const b = c.body.getBoundingClientRect();
      const body: Rect = { x: b.left - g.left, y: b.top - g.top, w: b.width, h: b.height };
      let sig = panelSignature(c.state, src, body, o) + dpr + view + blackBg;
      const sc = view === 'overlay' ? scene() : null;
      if (sc) {
        sig += JSON.stringify(sc);
        for (const el of sc.elements) {
          const s = el.src ? host.source(el.src) : null;
          if (s) { const { kr, kb } = LUMA[s.colorspace]; s.updateStats(kr, kb); sig += `${s.id}:${s.frameSeq}:${s.statsVersion}`; }
        }
      }
      if (sigs.get(i) === sig) return;
      sigs.set(i, sig);
      const W = Math.round(b.width * dpr), H = Math.round(b.height * dpr);
      if (c.overlay.width !== W || c.overlay.height !== H) { c.overlay.width = W; c.overlay.height = H; }
      const ctx = c.overlay.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, b.width, b.height);
      if (view === 'overlay') drawOverlay(renderer, ctx, src, body, sc?.elements ?? [], blackBg, o, host);
      else if (view === 'clean') {
        // picture without probe/ROI/legend markings
        if (!src?.ready) return;
        const r = plotRect('picture', body.w, body.h, src.width / src.height);
        renderer.clearRect({ x: body.x, y: body.y, w: body.w, h: body.h });
        renderer.drawPicture(src, { x: body.x + r.x, y: body.y + r.y, w: r.w, h: r.h }, {
          mode: 'normal', bands: [], zebra: 2, zebraLow: 0, roi: [], skin: o.skin, display: displayOf(o, src),
        });
      } else drawPanel(renderer, ctx, `o${i}`, c.state, src, body, o);
    });
    editor?.draw();
    renderer.endFrame();
  };
  requestAnimationFrame(frame);

  const hud = document.createElement('div');
  // chrome follows the UI skin; scopes, picture and the black surround never do
  const skinHud = () => { const s = HUD_STYLE[storedTheme()]; Object.assign(hud.style, { font: s.font, color: s.fg, background: s.bg, borderRadius: s.radius }); };
  hud.style.cssText = 'position:fixed;left:10px;bottom:10px;padding:4px 8px;transition:opacity .5s;pointer-events:none';
  skinHud(); onThemeChange(skinHud);
  document.body.append(hud);
  let hudT = 0, streamMsg = '';
  const showHud = () => {
    if (editor?.editing()) { hud.style.opacity = '0'; return; }
    const sc = view === 'overlay' ? scene() : null;
    const buf = renderer.bufferFormat === 'RGBA16F' ? 'WebGL RGBA16F' : t('output.webgl8');
    hud.replaceChildren(
      `${outName ? `${outName} · ` : ''}${view}${sc ? ` · ${sc.name}` : ''}${streamMsg ? ` · Stream ${streamMsg}` : ''}  ·  ${editor ? `${t('output.keyEdit')} · ` : ''}${t('output.keysView')}`,
      Object.assign(document.createElement('div'), { textContent: `${pipelineText(`${buf}, ${t('output.labels8')}`)}` }),
    );
    hud.style.opacity = '1'; clearTimeout(hudT); hudT = window.setTimeout(() => (hud.style.opacity = '0'), 2500);
  };
  document.addEventListener('keydown', (e) => {
    if ((e.target as Element | null)?.closest?.('input, select')) return;
    if (e.key === 'f' || e.key === 'F') toggleFs();
    else if ((e.key === 'e' || e.key === 'E') && editor) { editor.toggle(); showHud(); }
    else editor?.key(e);
  });
  root.addEventListener('dblclick', () => { if (!editor?.editing()) toggleFs(); });
  document.addEventListener('mousemove', () => showHud());
  showHud();

  let stopStream: (() => void) | null = null, streamName = '';
  const api: OutputWindowApi = {
    startStream: (name, target, codec) => {
      stopStream?.();
      streamName = name;
      const fps = Number(q.get('fps') ?? 25), status = (m: string) => { streamMsg = m; showHud(); };
      stopStream = isCodec10(codec ?? null)
        ? startDeepStream(host, glCanvas, cells, name, target, codec as Codec10, fps, status)
        : startStream(host, glCanvas, cells, name, target, fps, status);
    },
    stopStream: () => { stopStream?.(); stopStream = null; streamName = ''; streamMsg = ''; },
    stream: () => streamName,
  };
  (window as unknown as { lzsOut: OutputWindowApi }).lzsOut = api;
  const name = q.get('stream');
  if (name) api.startStream(name, q.get('target') ?? '', q.get('codec') ?? '');
}

function toggleFs() {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {});
}

const displayOf = (o: DrawOptions, src: Source) => displayParams(src, o.display, o.hdrPreview);

/** Picture area of the overlay view (fractions of it position the scene elements). */
function pictureRect(body: { w: number; h: number }, src: Source | null): Rect {
  return plotRect('picture', body.w, body.h, src?.ready ? src.width / src.height : 16 / 9);
}
const elementRect = (e: OverlayElement, pic: Rect): Rect => ({ x: pic.x + e.x * pic.w, y: pic.y + e.y * pic.h, w: e.w * pic.w, h: e.h * pic.h });

const SCATTER_MODE: Partial<Record<ScopeType, 'vector' | 'cie' | 'skin' | 'parade' | 'yrgb' | 'ycbcr' | 'rgb' | 'luma'>> = {
  vector: 'vector', cie: 'cie', 'wf-skin': 'skin', parade: 'parade', yrgb: 'yrgb', ycbcr: 'ycbcr', 'wf-rgb': 'rgb', 'wf-luma': 'luma', 'wf-color': 'luma',
};

/** Picture with the scene's scopes on top. */
function drawOverlay(renderer: Renderer, ctx: CanvasRenderingContext2D, src: Source | null, body: Rect, elements: OverlayElement[], blackBg: boolean, o: DrawOptions, host: OutputHost) {
  renderer.clearRect(body);
  const pic = pictureRect(body, src);
  const abs = (r: Rect) => ({ x: body.x + r.x, y: body.y + r.y, w: r.w, h: r.h });
  if (!blackBg && src?.ready) {
    renderer.drawPicture(src, abs(pic), { mode: 'normal', bands: [], zebra: 2, zebraLow: 0, roi: [], skin: o.skin, display: displayOf(o, src) });
  }
  for (const el of elements) {
    const s = (el.src ? host.source(el.src) : null) ?? src;
    if (!s?.ready) continue;
    const box = elementRect(el, pic);
    if (!blackBg && el.dim > 0) renderer.shade(abs(box), el.dim);
    const inner = plotRect(el.scope, box.w, box.h, s.width / s.height);
    const r: Rect = { x: box.x + inner.x, y: box.y + inner.y, w: inner.w, h: inner.h };
    ctx.save();
    ctx.globalAlpha = el.opacity;
    const mode = SCATTER_MODE[el.scope];
    if (mode) {
      renderer.drawScatter(`overlay-${el.id}`, s, abs(r), {
        mode, gain: 2.5, colorize: el.scope === 'wf-color' || el.scope === 'vector' || el.scope === 'cie', zoom: 1,
        tint: [0.55, 1, 0.62], maxSamples: o.maxSamples, roi: s.activeRois(), skin: o.skin,
      }, true, el.opacity);
    }
    if (isWaveform(el.scope)) { drawWaveGraticule(ctx, el.scope, r, o.unit, s.transfer, { lw: s.hlgLw }); if (el.scope === 'wf-skin') drawSkinRange(ctx, r, o.skin); }
    else if (el.scope === 'vector') drawVectorGraticule(ctx, r, s.colorspace, 1, 0, vectorTargets(s));
    else if (el.scope === 'cie') drawCieGraticule(ctx, r, s.colorspace, { gamut: s.gamut });
    else if (el.scope === 'hist') drawHistogram(ctx, r, s, 'rgb', false);
    ctx.restore();
  }
}

/** Edit layer of the overlay view: frames, handles and a toolbar – never streamed. */
function createEditor(host: OutputHost, root: HTMLElement, scene: () => OverlayScene | null, windowSrc: () => Source | null) {
  let editing = false, sel = -1, sceneId = '';
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:none;cursor:default';
  root.append(canvas);
  const bar = document.createElement('div');
  const sk = HUD_STYLE[storedTheme()];
  bar.style.cssText = `position:fixed;left:50%;top:10px;transform:translateX(-50%);display:none;gap:6px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 20px);background:${sk.bg};color:${sk.fg};border:1px solid ${sk.line};border-radius:${sk.radius};padding:6px 8px;cursor:default;z-index:5`;
  document.body.append(bar);
  const inputCss = `background:${sk.field};color:${sk.fg};border:1px solid ${sk.line};border-radius:${sk.radius};padding:2px 6px;font:${sk.font}`;

  const geom = () => {
    const b = root.getBoundingClientRect();
    return { b, pic: pictureRect({ w: b.width, h: b.height }, windowSrc()) };
  };
  const toFrac = (e: PointerEvent) => {
    const { b, pic } = geom();
    return { fx: (e.clientX - b.left - pic.x) / pic.w, fy: (e.clientY - b.top - pic.y) / pic.h, pic };
  };
  const changed = () => { host.sceneChanged(); };

  let drag: { index: number; handle: Handle; fx: number; fy: number; start: OverlayElement } | null = null;
  canvas.addEventListener('pointerdown', (e) => {
    const sc = scene();
    if (!sc || e.button !== 0) return;
    const { fx, fy, pic } = toFrac(e);
    const hit = hitTest(sc.elements, fx, fy, [9 / pic.w, 9 / pic.h]);
    sel = hit ? hit.index : -1;
    if (hit) {
      drag = { ...hit, fx, fy, start: { ...sc.elements[hit.index] } };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    }
    renderBar();
  });
  canvas.addEventListener('pointermove', (e) => {
    const sc = scene();
    if (!sc) return;
    const { fx, fy, pic } = toFrac(e);
    if (!drag) {
      const hit = hitTest(sc.elements, fx, fy, [9 / pic.w, 9 / pic.h]);
      canvas.style.cursor = hit ? CURSORS[hit.handle] : 'default';
      return;
    }
    const el = dragElement(drag.start, drag.handle, fx - drag.fx, fy - drag.fy);
    if (sc.elements[drag.index]) Object.assign(sc.elements[drag.index], el);
  });
  canvas.addEventListener('pointerup', () => { if (drag) { drag = null; changed(); renderBar(); } });

  const el = (tag: string, attrs: Record<string, string> = {}, text = '') => {
    const x = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) x.setAttribute(k, v);
    if (text) x.textContent = text;
    return x;
  };
  const selectEl = (value: string, options: [string, string][], onchange: (v: string) => void, title = '') => {
    const s = el('select', { style: inputCss, title }) as HTMLSelectElement;
    for (const [v, l] of options) { const o = el('option', { value: v }, l) as HTMLOptionElement; o.selected = v === value; s.append(o); }
    s.onchange = () => onchange(s.value);
    return s;
  };
  const button = (label: string, title: string, fn: () => void) => {
    const b = el('button', { style: `${inputCss};cursor:pointer`, title }, label);
    b.onclick = fn;
    return b;
  };
  const slider = (label: string, value: number, set: (v: number) => void) => {
    const wrap = el('label', { style: `display:flex;align-items:center;gap:4px;color:${sk.muted}` }, label);
    const r = el('input', { type: 'range', min: '0', max: '100', step: '1', value: String(Math.round(value * 100)), style: 'width:90px' }) as HTMLInputElement;
    r.oninput = () => set(Number(r.value) / 100);
    r.onchange = changed;
    wrap.append(r);
    return wrap;
  };
  const scopeOptions = (): [string, string][] => OVERLAY_SCOPES.map((k) => [k, SCOPE_LABELS[k as ScopeType]]);

  function renderBar() {
    const sc = scene();
    if (!sc) { bar.replaceChildren(el('span', {}, t('output.noScene'))); return; }
    const name = el('input', { style: `${inputCss};width:150px`, title: t('output.sceneName'), value: sc.name }) as HTMLInputElement;
    name.onchange = () => { const n = name.value.trim(); if (n) { sc.name = n; changed(); } };
    const add = selectEl('', [['', t('output.addScope')], ...scopeOptions()], (v) => {
      if (!v || sc.elements.length >= MAX_ELEMENTS) return;
      sc.elements.push(newElement(v as ScopeType, sc.elements.length));
      sel = sc.elements.length - 1; changed(); renderBar();
    }, t('output.addScopeTitle'));
    const kids: Node[] = [el('span', { style: 'color:#7fd08f' }, t('output.sceneEdit')), name, add];
    const cur = sc.elements[sel];
    if (cur) {
      const sources: [string, string][] = [['', t('output.windowSource')], ...host.sources().map((s, i): [string, string] => [s.id, `${i + 1} ${s.name}`])];
      kids.push(
        el('span', { style: `width:1px;height:18px;background:${sk.line}` }),
        selectEl(cur.scope, scopeOptions(), (v) => { cur.scope = v as ScopeType; changed(); }, 'Scope'),
        selectEl(cur.src, sources, (v) => { cur.src = v; changed(); }, t('output.scopeSource')),
        slider(t('output.opacity'), cur.opacity, (v) => { cur.opacity = v; }),
        slider(t('output.dim'), cur.dim, (v) => { cur.dim = v; }),
        button('✕', t('output.removeScope'), () => remove()),
      );
    }
    kids.push(button(t('output.done'), t('output.endEdit'), () => toggle()));
    bar.replaceChildren(...kids);
  }
  const remove = () => {
    const sc = scene();
    if (!sc || !sc.elements[sel]) return;
    sc.elements.splice(sel, 1); sel = -1; changed(); renderBar();
  };
  function toggle() {
    editing = !editing;
    canvas.style.display = editing ? 'block' : 'none';
    bar.style.display = editing ? 'flex' : 'none';
    document.body.style.cursor = editing ? 'default' : 'none';
    if (editing) renderBar();
  }

  return {
    editing: () => editing,
    toggle,
    key(e: KeyboardEvent) {
      if (!editing) return;
      const sc = scene(), cur = sc?.elements[sel];
      if (e.key === 'Escape') toggle();
      else if ((e.key === 'Delete' || e.key === 'Backspace') && cur) remove();
      else if (cur && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? 0.01 : 0.002;
        const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
        Object.assign(cur, dragElement(cur, 'move', dx, dy)); changed();
      }
    },
    /** Redraw frames and handles (every animation frame while editing). */
    draw() {
      const sc = scene();
      if (sc && sc.id !== sceneId) { sceneId = sc.id; sel = -1; if (editing) renderBar(); }
      if (!editing) return;
      const { b, pic } = geom(), dpr = window.devicePixelRatio || 1;
      const W = Math.round(b.width * dpr), H = Math.round(b.height * dpr);
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      const ctx = canvas.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, b.width, b.height);
      ctx.strokeStyle = 'rgba(255,255,255,.25)'; ctx.setLineDash([4, 4]);
      ctx.strokeRect(pic.x + 0.5, pic.y + 0.5, pic.w - 1, pic.h - 1);
      ctx.setLineDash([]);
      (sc?.elements ?? []).forEach((e, i) => {
        const r = elementRect(e, pic), on = i === sel;
        ctx.strokeStyle = on ? '#7fd08f' : 'rgba(127,208,143,.55)'; ctx.lineWidth = on ? 2 : 1;
        ctx.strokeRect(r.x, r.y, r.w, r.h);
        ctx.font = '11px system-ui'; ctx.textBaseline = 'top'; ctx.fillStyle = 'rgba(0,0,0,.7)';
        const label = `${i + 1} ${SCOPE_LABELS[e.scope]}`;
        ctx.fillRect(r.x, r.y, ctx.measureText(label).width + 8, 16);
        ctx.fillStyle = '#cfe9d4'; ctx.fillText(label, r.x + 4, r.y + 2);
        if (!on) return;
        ctx.fillStyle = '#7fd08f';
        for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]]) {
          ctx.fillRect(r.x + hx * r.w - 4, r.y + hy * r.h - 4, 8, 8);
        }
      });
    },
  };
}

/** Composite GL + overlays, send JPEG frames to the bridge (MJPEG pull URL, optional push). Returns stop(). */
function startStream(host: OutputHost, gl: HTMLCanvasElement, cells: Cell[], name: string, target: string, fps: number, status: (m: string) => void) {
  const q = new URLSearchParams({ name, fps: String(fps) });
  if (target) q.set('target', target);
  const ws = new WebSocket(`${host.bridgeUrl()}/out?${q}`);
  const comp = document.createElement('canvas');
  let stopped = false;
  ws.onmessage = (e) => { try { const m = JSON.parse(e.data); status(m.message ?? m.type); } catch { /* ignore */ } };
  ws.onclose = () => { if (!stopped) status(t('output.streamEnded')); };
  ws.onerror = () => status(t('output.bridgeUnreachable'));
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
  return () => { stopped = true; clearInterval(timer); ws.close(); };
}

/**
 * 10-bit stream: GL (RGBA16F where available) and overlays composited on a float16 canvas,
 * read back as floats, sent as exact 10-bit narrow-range Y′CbCr (BT.709 tags – the view is
 * display graphics, not the source signal). Returns stop().
 */
function startDeepStream(host: OutputHost, gl: HTMLCanvasElement, cells: Cell[], name: string, target: string, codec: Codec10, fps: number, status: (m: string) => void) {
  const comp = document.createElement('canvas');
  const dc = deepContext(comp);
  return startStream10(host.bridgeUrl(), name, target, codec, fps, () => {
    const W = gl.width & ~1, H = gl.height;
    if (W < 2 || H < 1) return null;
    if (comp.width !== W || comp.height !== H) { comp.width = W; comp.height = H; }
    const ctx = dc.ctx;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(gl, 0, 0);
    const g = gl.getBoundingClientRect(), dpr = gl.width / Math.max(1, g.width);
    for (const c of cells) {
      const b = c.body.getBoundingClientRect();
      ctx.drawImage(c.overlay, (b.left - g.left) * dpr, (b.top - g.top) * dpr);
    }
    return pixelsToFrame10(readPixels(dc, W, H), W, H, '709', 'sdr');
  }, status);
}
