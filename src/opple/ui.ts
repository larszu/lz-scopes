// Light meter panel in the sidebar (#11): connect an Opple Light Master over Web
// Bluetooth, show lux / CCT / Duv / xy, keep a history, export CSV.

import { OppleMeter, bluetoothSupport } from './meter';
import { LM3_MODE_NAMES, readingsCsv, type Reading } from './photometry';

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
const de = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');

const CSS = `
.opple .big { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; margin-top: 6px; }
.opple .big div { display: flex; flex-direction: column; }
.opple .big b { font-size: 18px; color: var(--text, #ddd); font-variant-numeric: tabular-nums; }
.opple .big span { font-size: 10px; color: var(--muted, #888); text-transform: uppercase; letter-spacing: .05em; }
.opple .warnbox { color: var(--warn, #ffb44a); font-size: 11px; margin-top: 4px; }
.opple canvas { width: 100%; height: 40px; margin-top: 6px; }
.opple .row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
`;

function download(name: string, text: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name }) as HTMLAnchorElement;
  document.body.append(a); a.click(); a.remove();
}

/** One meter per window: the sidebar panel and the LED-wall dialog share it. */
export const oppleMeter = new OppleMeter();

export function mountOpple(root: HTMLElement) {
  if (!document.getElementById('opple-css')) document.head.append(h('style', { id: 'opple-css' }, CSS));
  root.classList.add('opple');
  const meter = oppleMeter;
  const history: Reading[] = [];
  let last: Reading | null = null;

  const status = h('p', { class: 'hint' });
  const vals = h('div', { class: 'big' });
  const chart = h('canvas', { width: 280, height: 40, title: 'Beleuchtungsstärke der letzten Messungen' }) as HTMLCanvasElement;
  const info = h('p', { class: 'hint' });
  const buttons = h('div', { class: 'row' });

  const cell = (label: string, value: string) => h('div', {}, h('b', {}, value), h('span', {}, label));
  function render() {
    const r = last;
    vals.replaceChildren(
      cell('Lux', r ? de(r.lux, r.lux < 10 ? 2 : 0) : '–'),
      cell('CCT K (McCamy)', r ? de(r.cct, 0) : '–'),
      cell('Duv (Ohno)', r ? de(r.duv, 4) : '–'),
      cell('x / y (CIE 1931)', r ? `${de(r.x, 4)} / ${de(r.y, 4)}` : '–'),
    );
    info.textContent = r
      ? `${r.model === 'lm4' ? 'Light Master 4' : `Light Master 3${r.mode ? `, Matrix ${LM3_MODE_NAMES[r.mode]}` : ''}`} · ${r.calibrated ? 'mit Kalibrierfaktoren' : 'ohne Kalibrierfaktoren'}${r.temperature != null ? ` · ${de(r.temperature, 1)} °C` : ''} · ${history.length} Messungen im Verlauf`
      : '';
    const connected = meter.state === 'connected';
    buttons.replaceChildren(
      connected
        ? h('button', { onclick: () => { meter.disconnect(); render(); } }, 'Trennen')
        : h('button', { class: 'primary', disabled: !bluetoothSupport().ok, onclick: () => { meter.connect().then(() => meter.start()).catch(() => { /* status shows it */ }).finally(render); } }, 'Verbinden …'),
      connected ? h('button', { onclick: () => { if (meter.polling) meter.stop(); else meter.start(); render(); } }, meter.polling ? '❚❚ Anhalten' : '▶ Laufend') : '',
      history.length ? h('button', { title: 'Verlauf als CSV', onclick: () => download(`lichtmesser-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`, readingsCsv(history)) }, '⤓ CSV') : '',
      history.length ? h('button', { onclick: () => { history.length = 0; drawChart(); render(); } }, 'Verlauf leeren') : '',
      meter.frames.length ? h('button', { title: 'Mitgeschnittene BLE-Rahmen (hex) in die Zwischenablage – für Protokollprüfung und Tests', onclick: () => navigator.clipboard?.writeText(meter.frames.join('\n')) }, 'Rohdaten kopieren') : '',
    );
  }
  function drawChart() {
    const ctx = chart.getContext('2d')!, W = chart.width, H = chart.height, pts = history.slice(-120);
    ctx.clearRect(0, 0, W, H);
    if (pts.length < 2) return;
    const max = Math.max(...pts.map((p) => p.lux), 1e-6);
    ctx.strokeStyle = '#8cff9e'; ctx.beginPath();
    pts.forEach((p, i) => { const x = (i / (pts.length - 1)) * (W - 1), y = H - 2 - (p.lux / max) * (H - 4); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = '#888'; ctx.font = '10px system-ui'; ctx.fillText(`max ${de(max, 0)} lx`, 2, 10);
  }

  meter.addEventListener('status', (e) => {
    const { state, message } = (e as CustomEvent).detail as { state: string; message: string };
    status.textContent = message;
    status.style.color = state === 'error' ? 'var(--err, #ff5c5c)' : '';
    render();
  });
  meter.addEventListener('reading', (e) => {
    last = (e as CustomEvent).detail as Reading;
    history.push(last);
    if (history.length > 20000) history.splice(0, history.length - 20000);
    drawChart(); render();
  });

  const sup = bluetoothSupport();
  status.textContent = sup.ok ? 'Light Master wecken, Opple-App schließen (nur eine Verbindung), dann verbinden.' : sup.reason;
  root.replaceChildren(
    h('p', { class: 'warnbox' }, 'Ungeprüft: Gerät nicht vorhanden. Protokoll und Umrechnung sind mit aufgezeichneten Paketen aus offenen Projekten getestet, die Bluetooth-Verbindung nicht.'),
    buttons, status, vals, chart, info,
    h('p', { class: 'hint' }, 'Lux, xy, CCT und Duv rechnet LZ Scopes aus den Rohkanälen (Filtersensor, 6 bzw. 8 Kanäle, Matrizen der Opple-App). Für schmalbandige LED-Primärfarben, z. B. einer LED-Wand, nur als Trendmesser geeignet.'),
  );
  render();
}
