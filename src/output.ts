// Fullscreen pattern output: ?out=<id>&w=&h=&label=  (← → switch, F fullscreen, L label, R levels, Esc exit).
// Measurement patches sent with sendPatch() (src/patchSequencer.ts) take over while active.
// More than 8 bit (src/deep.ts): float16 canvas where available, 10-bit patterns with exact
// codes; &levels=code starts in “codes 1:1”. &stream=<name>&codec=hevc10|hevc422|v210|prores
// [&target=udp://…] sends the pattern as exact 10-bit Y′CbCr to the bridge (server/out10.mjs).

import { PATTERNS, drawCaptions, drawLabel, patternById, renderPattern } from './patterns';
import { deepContext, isCodec10, pipelineText, pixelsToFrame10, putRaster, rasterToFrame10, readPixels, remapToCodes, startStream10, type LevelMode } from './deep';
import { drawPatch, listenPatches, type PatchFrame } from './patchSequencer';
import { avCalibration } from './audio/avcal';
import { HUD_STYLE, onThemeChange, storedTheme } from './theme';
import { num, t } from './i18n';
// DOM helper only: the pattern window loads none of the app styles
import { h as make } from './ui/dom';

export function runOutputWindow() {
  const q = new URLSearchParams(location.search);
  let idx = Math.max(0, PATTERNS.findIndex((p) => p.id === q.get('out')));
  const w = Number(q.get('w')) || 1920, h = Number(q.get('h')) || 1080;
  let label = q.get('label') ?? '', showLabel = !!label;
  document.title = t('output.title');
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;cursor:none';
  const canvas = make('canvas', { width: w, height: h });
  // object-fit keeps the aspect; at native screen size this is 1:1
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;image-rendering:pixelated';
  document.body.replaceChildren(canvas);
  const dc = deepContext(canvas), ctx = dc.ctx;
  let mode: LevelMode = q.get('levels') === 'code' ? 'code' : 'full';
  const pipeline = dc.colorType === 'float16' ? 'Canvas 2D float16' : t('output.canvas8');
  document.body.dataset.pipeline = dc.colorType;
  let streamMsg = '';
  const hud = make('div');
  // chrome follows the UI skin; the pattern and the black surround never do
  const skinHud = () => { const s = HUD_STYLE[storedTheme()]; Object.assign(hud.style, { font: s.font, color: s.fg, background: s.bg, borderRadius: s.radius }); };
  hud.style.cssText = 'position:fixed;left:12px;bottom:12px;padding:4px 8px;transition:opacity .4s';
  skinHud(); onThemeChange(skinHud);
  document.body.append(hud);
  let hudTimer = 0;
  // Measurement patches from the main window (calibration, LED wall) replace the pattern.
  let patch: PatchFrame | null = null;
  const showHud = () => {
    if (patch) return;
    const p = PATTERNS[idx];
    const r = refreshMs();
    const av = p.id === 'avsync' ? `   ${t('output.av', { refresh: r ? `${num(r, 1)} ms (${Math.round(1000 / r)} Hz)` : '–', jitter: num(r / 2, 1), lead: Math.round(avCalibration().videoLeadMs) })}${avCalibration().note ? '' : ` ${t('output.uncalibrated')}`}` : '';
    hud.replaceChildren(
      `${p.group} · ${p.name} · ${w}×${h}${av}   ${t('output.keys')}`,
      make('div', null, `${pipelineText(pipeline, mode)}${streamMsg ? ` · Stream ${streamMsg}` : ''}`),
      p.note ? make('div', null, p.note) : '',
    );
    hud.style.opacity = '1';
    clearTimeout(hudTimer); hudTimer = window.setTimeout(() => (hud.style.opacity = '0'), 2500);
  };
  const t0 = performance.now();
  let busy = false;
  listenPatches((f) => { patch = f; hud.style.opacity = '0'; draw(); });
  let dirty = true;
  const draw = async () => {
    dirty = true;
    if (patch) { drawPatch(ctx, w, h, patch); return; }
    if (busy) return;
    busy = true;
    const def = patternById(PATTERNS[idx].id);
    if (def.raster) {
      // exact codes (float16) – or rounded to 8 bit where the canvas has no float16
      putRaster(dc, def.raster(w, h), !!def.rasterFull, mode);
      if (def.labels) drawCaptions(ctx, h, def.labels(w, h));
      if (showLabel && label) drawLabel(ctx, w, h, label);
    } else {
      await renderPattern(ctx, def, w, h, (performance.now() - t0) / 1000, showLabel ? label : '');
      if (mode === 'code') remapToCodes(dc, w, h);
    }
    busy = false;
  };
  // readable for the E2E test and for checks by hand (DevTools)
  (window as unknown as { lzsOut10: unknown }).lzsOut10 = { colorType: dc.colorType, mode: () => mode, pixels: () => readPixels(dc, w, h) };
  // refresh interval of this display (median of rAF deltas): the flash of “A/V-Sync” can
  // only change at these instants, so ±½ interval stays as jitter after calibration
  const deltas: number[] = [];
  let lastTs = 0;
  const loop = (ts?: number) => {
    if (ts !== undefined) { if (lastTs) { deltas.push(ts - lastTs); if (deltas.length > 120) deltas.shift(); } lastTs = ts; }
    if (!patch && PATTERNS[idx].animated) draw();
    requestAnimationFrame(loop);
  };
  const refreshMs = () => { const d = [...deltas].sort((a, b) => a - b); return d.length ? d[d.length >> 1] : 0; };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ') idx = (idx + 1) % PATTERNS.length;
    else if (e.key === 'ArrowLeft') idx = (idx - 1 + PATTERNS.length) % PATTERNS.length;
    else if (e.key === 'f' || e.key === 'F') { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen(); return; }
    else if (e.key === 'l' || e.key === 'L') { showLabel = !showLabel; if (showLabel && !label) label = prompt(t('output.labelPrompt')) ?? ''; }
    else if (e.key === 'r' || e.key === 'R') mode = mode === 'full' ? 'code' : 'full';
    else return;
    draw(); showHud();
  });
  // LED wall settings changed in the main window (src/led/wall.ts): redraw
  window.addEventListener('storage', (e) => { if (e.key === 'lz-scopes.led') draw(); });
  canvas.addEventListener('dblclick', () => document.documentElement.requestFullscreen());
  document.addEventListener('mousemove', showHud);
  draw(); showHud(); loop();

  // 10-bit stream: raster patterns as exact codes, everything else from the canvas
  const codec = q.get('codec'), streamName = (q.get('stream') ?? '').replace(/[^\w-]/g, '');
  if (streamName && isCodec10(codec)) {
    const opener = window.opener as (Window & { lzs?: { bridgeUrl: () => string } }) | null;
    let bridge = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    try { bridge = opener?.lzs?.bridgeUrl() ?? bridge; } catch { /* other origin */ }
    let cacheKey = '', cached: ArrayBuffer | null = null;
    startStream10(bridge, streamName, q.get('target') ?? '', codec, Math.min(60, Math.max(1, Number(q.get('fps')) || 25)), () => {
      if (!dirty || busy) return null;
      dirty = false;
      const def = patternById(PATTERNS[idx].id), cs = def.colorspace ?? '709', tf = def.transfer ?? 'sdr';
      if (!patch && def.raster) {
        const key = `${def.id}|${w}|${h}`;
        if (key !== cacheKey) { cached = rasterToFrame10(def.raster(w, h), !!def.rasterFull, cs, tf); cacheKey = key; }
        return cached;
      }
      const px = readPixels(dc, w, h);
      if (mode === 'code') {
        const back = new Float32Array(px.length);
        for (let i = 0; i < px.length; i++) back[i] = (i & 3) === 3 ? px[i] : (px[i] * 1023 - 64) / 876;
        return pixelsToFrame10(back, w, h, cs, tf);
      }
      return pixelsToFrame10(px, w, h, cs, tf);
    }, (m) => { streamMsg = m; showHud(); });
  }
}
