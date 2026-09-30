// Fullscreen pattern output: ?out=<id>&w=&h=&label=  (← → switch, F fullscreen, L label, Esc exit).
// Measurement patches sent with sendPatch() (src/patchSequencer.ts) take over while active.

import { PATTERNS, patternById, renderPattern } from './patterns';
import { drawPatch, listenPatches, type PatchFrame } from './patchSequencer';
import { avCalibration } from './audio/avcal';
import { HUD_STYLE, onThemeChange, storedTheme } from './theme';

export function runOutputWindow() {
  const q = new URLSearchParams(location.search);
  let idx = Math.max(0, PATTERNS.findIndex((p) => p.id === q.get('out')));
  const w = Number(q.get('w')) || 1920, h = Number(q.get('h')) || 1080;
  let label = q.get('label') ?? '', showLabel = !!label;
  document.title = 'LZ Scopes – Ausgabe';
  document.body.style.cssText = 'margin:0;background:#000;overflow:hidden;cursor:none';
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  // object-fit keeps the aspect; at native screen size this is 1:1
  canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;image-rendering:pixelated';
  document.body.replaceChildren(canvas);
  const ctx = canvas.getContext('2d')!;
  const hud = document.createElement('div');
  // chrome follows the UI skin; the pattern and the black surround never do
  const skinHud = () => { const t = HUD_STYLE[storedTheme()]; Object.assign(hud.style, { font: t.font, color: t.fg, background: t.bg, borderRadius: t.radius }); };
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
    const av = p.id === 'avsync' ? `   Bildwechsel ${r ? `${r.toFixed(1).replace('.', ',')} ms (${Math.round(1000 / r)} Hz)` : '–'} · Blitz-Raster ±${(r / 2).toFixed(1).replace('.', ',')} ms · Bild-Vorlauf ${Math.round(avCalibration().videoLeadMs)} ms${avCalibration().note ? '' : ' (unkalibriert)'}` : '';
    hud.textContent = `${p.group} · ${p.name} · ${w}×${h}${p.note ? ' · 8 bit: unter 0 % / über 100 % abgeschnitten' : ''}${av}   ← → wechseln · F Vollbild · L Label`;
    hud.style.opacity = '1';
    clearTimeout(hudTimer); hudTimer = window.setTimeout(() => (hud.style.opacity = '0'), 2500);
  };
  const t0 = performance.now();
  let busy = false;
  listenPatches((f) => { patch = f; hud.style.opacity = '0'; draw(); });
  const draw = async () => {
    if (patch) { drawPatch(ctx, w, h, patch); return; }
    if (busy) return;
    busy = true;
    await renderPattern(ctx, patternById(PATTERNS[idx].id), w, h, (performance.now() - t0) / 1000, showLabel ? label : '');
    busy = false;
  };
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
    else if (e.key === 'l' || e.key === 'L') { showLabel = !showLabel; if (showLabel && !label) label = prompt('Label / Kennung') ?? ''; }
    else return;
    draw(); showHud();
  });
  // LED wall settings changed in the main window (src/led/wall.ts): redraw
  window.addEventListener('storage', (e) => { if (e.key === 'lz-scopes.led') draw(); });
  canvas.addEventListener('dblclick', () => document.documentElement.requestFullscreen());
  document.addEventListener('mousemove', showHud);
  draw(); showHud(); loop();
}
