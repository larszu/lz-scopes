// Fullscreen pattern output: ?out=<id>&w=&h=&label=  (← → switch, F fullscreen, L label, Esc exit)

import { PATTERNS, patternById, renderPattern } from './patterns';

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
  hud.style.cssText = 'position:fixed;left:12px;bottom:12px;font:12px system-ui;color:#fff;background:rgba(0,0,0,.7);padding:4px 8px;border-radius:4px;transition:opacity .4s';
  document.body.append(hud);
  let hudTimer = 0;
  const showHud = () => {
    const p = PATTERNS[idx];
    hud.textContent = `${p.group} · ${p.name} · ${w}×${h}   ← → wechseln · F Vollbild · L Label`;
    hud.style.opacity = '1';
    clearTimeout(hudTimer); hudTimer = window.setTimeout(() => (hud.style.opacity = '0'), 2500);
  };
  const t0 = performance.now();
  let busy = false;
  const draw = async () => {
    if (busy) return;
    busy = true;
    await renderPattern(ctx, patternById(PATTERNS[idx].id), w, h, (performance.now() - t0) / 1000, showLabel ? label : '');
    busy = false;
  };
  const loop = () => { if (PATTERNS[idx].animated) draw(); requestAnimationFrame(loop); };
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
