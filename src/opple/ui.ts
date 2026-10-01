// Light meter panel in the sidebar (#11): find and connect one or more Opple Light Masters over
// Web Bluetooth, name them, show lux / CCT / Duv / xy, take measuring points (grid, comparison
// with gel suggestion), export CSV, open the light scopes in the dock.

import { bluetoothSupport } from './meter';
import { LM3_MODE_NAMES, readingsCsv, type Reading } from './photometry';
import { compareLights, greenMagentaHint } from './lightScience';
import { desktopBluetooth, lightStore, oppleMeter, type LightStore } from './store';

export { oppleMeter };

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
const de = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',').replace('-', '−') : '–');
const sgn = (v: number, d: number) => (Number.isFinite(v) ? (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(d).replace('.', ',') : '–');

const CSS = `
.opple .big { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; margin-top: 6px; }
.opple .big div { display: flex; flex-direction: column; }
.opple .big b { font-size: 18px; color: var(--text, #ddd); font-variant-numeric: tabular-nums; }
.opple .big span { font-size: 10px; color: var(--muted, #888); text-transform: uppercase; letter-spacing: .05em; }
.opple .warnbox { color: var(--warn, #ffb44a); font-size: 11px; margin-top: 4px; }
.opple canvas { width: 100%; height: 40px; margin-top: 6px; }
.opple .row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; align-items: center; }
.opple .dev { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 0; border-top: 1px solid var(--line, #2a2d33); }
.opple .dev input.alias { flex: 1 1 90px; min-width: 60px; }
.opple .dev .val { font-size: 11px; color: var(--muted, #999); font-variant-numeric: tabular-nums; width: 100%; }
.opple .dev.active .val { color: var(--text, #ddd); }
.opple .dot { width: 8px; height: 8px; border-radius: 50%; background: #555; display: inline-block; }
.opple .dot.on { background: #8cff9e; } .opple .dot.busy { background: #ffb44a; } .opple .dot.err { background: #ff5c5c; }
.opple .picker { border: 1px solid var(--accent, #00dcff); border-radius: 4px; padding: 6px; margin-top: 6px; }
.opple .picker button.pick { display: block; width: 100%; text-align: left; margin-top: 3px; }
.opple table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; font-variant-numeric: tabular-nums; }
.opple td { padding: 1px 3px; } .opple td.n { text-align: right; }
.opple .cmp { font-size: 11px; margin-top: 6px; line-height: 1.45; }
.opple h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--muted, #888); margin: 10px 0 2px; }
.opple input.num { width: 3.2em; }
`;

function download(name: string, text: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name }) as HTMLAnchorElement;
  document.body.append(a); a.click(); a.remove();
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export const NO_PAIRING_HINT = 'Keine Kopplung nötig: Light Master einschalten (Schieber auf), in Reichweite bringen, dann „Light Master suchen“. Er erscheint nicht in den Bluetooth-Einstellungen des Systems – das ist normal. Die Opple-App schließen (nur eine Verbindung je Gerät).';

/**
 * Device list of the Electron app while a scan runs (Chrome shows its own chooser). Also used by
 * the LED-wall dialog.
 */
export function pickerBox(s: LightStore = lightStore()): HTMLElement {
  const box = h('div');
  const render = () => {
    if (!s.picker) { box.replaceChildren(); return; }
    const p = s.picker;
    box.replaceChildren(h('div', { class: 'picker' },
      h('div', { class: 'hint' }, p.devices.length ? 'Gefundene Light Master – zum Verbinden anklicken:' : 'Suche Light Master … (einschalten, Schieber auf, in die Nähe legen)'),
      ...p.devices.map((d) => {
        const known = s.known.find((k) => k.nativeId === d.id);
        const busy = [...s.meters.keys()].includes(known?.key ?? '-');
        return h('button', { class: 'pick', disabled: busy, onclick: () => s.pick(d.id) }, `${known ? `${known.alias} · ` : ''}${d.name || 'Light Master'}${busy ? ' (schon verbunden)' : known ? '' : ' (neu)'}`);
      }),
      h('div', { class: 'row' }, h('button', { onclick: () => s.cancelPick() }, 'Abbrechen'), p.scanning ? h('span', { class: 'hint' }, 'Suche läuft …') : '')));
  };
  s.addEventListener('change', render);
  render();
  return box;
}

export function mountOpple(root: HTMLElement, hooks: { openScopes?: () => void } = {}) {
  if (!document.getElementById('opple-css')) document.head.append(h('style', { id: 'opple-css' }, CSS));
  root.classList.add('opple');
  const s = lightStore();
  const sup = bluetoothSupport();

  const status = h('p', { class: 'hint' });
  const devices = h('div');
  const vals = h('div', { class: 'big' });
  const chart = h('canvas', { width: 280, height: 40, title: 'Beleuchtungsstärke der letzten Messungen (aktives Gerät)' }) as HTMLCanvasElement;
  const info = h('p', { class: 'hint' });
  const buttons = h('div', { class: 'row' });
  const points = h('div');

  const cell = (label: string, value: string) => h('div', {}, h('b', {}, value), h('span', {}, label));
  const connect = (p: Promise<unknown>) => p.then(() => s.setRunning(true)).catch(() => { /* message shows it */ }).finally(render);

  function renderDevices() {
    const rows = s.known.map((k) => {
      const m = s.meters.get(k.key), st = m?.state ?? 'idle';
      const r = s.latest(k.key);
      const alias = h('input', { class: 'alias', value: k.alias, title: `Name für ${k.name} (wird gemerkt)`, onchange: (e: Event) => s.rename(k.key, (e.target as HTMLInputElement).value) });
      return h('div', { class: `dev${s.active === k.key ? ' active' : ''}` },
        h('span', { class: `dot ${st === 'connected' ? 'on' : st === 'error' ? 'err' : st === 'idle' ? '' : 'busy'}`, title: m?.message || 'nicht verbunden' }),
        alias,
        st === 'connected'
          ? h('button', { class: 'mini', onclick: () => s.disconnect(k.key) }, 'Trennen')
          : h('button', { class: 'mini', disabled: !sup.ok || (st !== 'idle' && st !== 'error'), title: 'Verbinden (in Reichweite und eingeschaltet)', onclick: () => connect(s.reconnect(k)) }, 'Verbinden'),
        st === 'connected' && s.active !== k.key ? h('button', { class: 'mini', title: 'Werte dieses Geräts oben anzeigen und für Messpunkte nutzen', onclick: () => { s.active = k.key; s.changed(); } }, 'aktiv') : '',
        h('button', { class: 'icon', title: 'Vergessen', onclick: () => s.forget(k.key) }, '✕'),
        h('div', { class: 'val' }, st === 'connected' && r ? `${de(r.lux, r.lux < 10 ? 1 : 0)} lx · ${de(r.cct, 0)} K · Duv ${sgn(r.duv, 4)}` : `${k.name}${k.model ? ` · ${k.model === 'lm4' ? 'LM4' : 'LM3'}` : ''}${m?.message && st !== 'connected' ? ` · ${m.message}` : ''}`));
    });
    devices.replaceChildren(...(rows.length ? [h('h3', {}, 'Geräte'), ...rows] : []));
  }

  function render() {
    renderDevices();
    const act = s.meters.get(s.active);
    const r = s.latest(s.active) ?? s.latest();
    vals.replaceChildren(
      cell('Lux', r ? de(r.lux, r.lux < 10 ? 2 : 0) : '–'),
      cell('CCT K (McCamy)', r ? de(r.cct, 0) : '–'),
      cell('Duv (Ohno)', r ? de(r.duv, 4) : '–'),
      cell('x / y (CIE 1931)', r ? `${de(r.x, 4)} / ${de(r.y, 4)}` : '–'),
    );
    info.textContent = r
      ? `${s.label(r.device ?? '')} · ${r.model === 'lm4' ? 'Light Master 4' : `Light Master 3${r.mode ? `, Matrix ${LM3_MODE_NAMES[r.mode]}` : ''}`} · ${r.calibrated ? 'mit Kalibrierfaktoren' : 'ohne Kalibrierfaktoren'}${r.temperature != null ? ` · ${de(r.temperature, 1)} °C` : ''} · ${s.history.length} Messungen im Verlauf`
      : '';
    const anyConnected = s.connected.length > 0;
    const scanning = [...s.meters.values()].some((m) => m.state === 'requesting' || m.state === 'connecting' || m.state === 'calibrating');
    buttons.replaceChildren(
      h('button', { class: 'primary', disabled: !sup.ok || scanning, title: NO_PAIRING_HINT, onclick: () => connect(s.connectNew()) }, anyConnected ? '+ Weiteren Light Master suchen …' : 'Light Master suchen …'),
      anyConnected ? h('button', { onclick: () => s.setRunning(!s.running) }, s.running ? '❚❚ Anhalten' : '▶ Laufend') : '',
      hooks.openScopes ? h('button', { title: 'Layout mit Farbort, Vectorscope, Filterkanälen, Zeitverlauf und Messfeld – zurück über die Layout-Knöpfe oben. Doppelklick auf ein Panel = groß; ⧉ Ausgabe → Panel zeigt es auf einem anderen Bildschirm.', onclick: () => hooks.openScopes!() }, '▦ Licht-Ansichten') : '',
      s.history.length ? h('button', { title: 'Verlauf als CSV', onclick: () => download(`lichtmesser-${stamp()}.csv`, readingsCsv(s.history)) }, '⤓ CSV') : '',
      s.history.length ? h('button', { onclick: () => { s.history.length = 0; s.changed(); } }, 'Verlauf leeren') : '',
      act?.frames.length ? h('button', { title: 'Mitgeschnittene BLE-Rahmen (hex) in die Zwischenablage – für Protokollprüfung und Tests', onclick: () => navigator.clipboard?.writeText(act.frames.join('\n')) }, 'Rohdaten kopieren') : '',
    );
    const msg = s.message || act?.message || '';
    status.textContent = msg || (sup.ok ? (anyConnected ? '' : NO_PAIRING_HINT) : sup.reason);
    status.style.color = act?.state === 'error' || s.message ? 'var(--err, #ff5c5c)' : '';
    renderPoints();
  }

  let label = '';
  function renderPoints() {
    const o = s.opts;
    const num = (v: number, set: (n: number) => void, max = 12) => h('input', { type: 'number', class: 'num', min: 1, max, value: v, onchange: (e: Event) => { set(Math.max(1, Math.min(max, Number((e.target as HTMLInputElement).value) || 1))); s.saveOpts(); s.changed(); } });
    const can = s.connected.length > 0;
    const take = (grid: boolean) => { s.capture(label, grid).then(() => { label = ''; }).catch((e) => { s.message = (e as Error).message; s.changed(); }); };
    const cellName = `${String.fromCharCode(65 + o.cursor[1])}${o.cursor[0] + 1}`;
    const a = s.point(o.ref), b = s.point(o.cmp);
    const cmp = a && b && a !== b ? compareLights(a.reading, b.reading, o.gelMaker) : null;
    points.replaceChildren(
      h('h3', {}, 'Messpunkte, Messfeld, Vergleich'),
      h('div', { class: 'row' },
        h('input', { placeholder: 'Name (optional)', value: label, style: 'flex:1 1 80px;min-width:60px', oninput: (e: Event) => { label = (e.target as HTMLInputElement).value; } }),
        h('select', { title: 'Messungen je Punkt mitteln', onchange: (e: Event) => { o.avg = Number((e.target as HTMLSelectElement).value); s.saveOpts(); } },
          ...[1, 3, 5, 10].map((n) => h('option', { value: n, selected: n === o.avg }, `⌀ ${n}`)))),
      h('div', { class: 'row' },
        h('button', { disabled: !can, title: 'Messung (gemittelt) als Punkt behalten – für Vergleich und Diagramme', onclick: () => take(false) }, '◉ Punkt'),
        h('button', { disabled: !can, title: 'Messung in die markierte Zelle des Messfelds, dann weiter zur nächsten', onclick: () => take(true) }, `▦ Zelle ${cellName}`),
        h('button', { class: 'mini', title: 'Zelle überspringen', onclick: () => s.advance() }, '→')),
      h('div', { class: 'row' }, 'Messfeld', num(o.cols, (n) => { o.cols = n; }), '×', num(o.rows, (n) => { o.rows = n; }, 26),
        h('span', { class: 'hint' }, 'Spalten × Zeilen (z. B. Set-Fläche, LED-Wand)')),
      s.points.length ? h('table', {},
        h('tr', {}, h('td', {}, ''), h('td', {}, 'Ref'), h('td', {}, 'B'), h('td', { class: 'n' }, 'lx'), h('td', { class: 'n' }, 'K'), h('td', { class: 'n' }, 'Duv'), h('td', {}, '')),
        ...s.points.map((p) => h('tr', {},
          h('td', {}, p.label),
          h('td', {}, h('input', { type: 'radio', name: 'opple-ref', checked: p.id === o.ref, title: 'Referenz (A)', onchange: () => { o.ref = p.id; s.saveOpts(); s.changed(); } })),
          h('td', {}, h('input', { type: 'radio', name: 'opple-cmp', checked: p.id === o.cmp, title: 'Vergleich (B)', onchange: () => { o.cmp = p.id; s.saveOpts(); s.changed(); } })),
          h('td', { class: 'n' }, de(p.reading.lux, p.reading.lux < 10 ? 1 : 0)), h('td', { class: 'n' }, de(p.reading.cct, 0)), h('td', { class: 'n' }, sgn(p.reading.duv, 3)),
          h('td', {}, h('button', { class: 'icon', title: 'Punkt löschen', onclick: () => s.removePoint(p.id) }, '✕'))))) : '',
      cmp ? h('div', { class: 'cmp' },
        h('b', {}, `${a!.label} (A) → ${b!.label} (B)`), h('br'),
        `Δu′v′ ${de(cmp.duv, 4)} · CCT ${de(cmp.cctA, 0)} → ${de(cmp.cctB, 0)} K · Helligkeit ${sgn(cmp.stops, 2)} Blenden`, h('br'),
        `Mired-Korrektur für B: ${sgn(cmp.shift, 0)} `,
        h('select', { onchange: (e: Event) => { o.gelMaker = (e.target as HTMLSelectElement).value as 'Lee' | 'Rosco'; s.saveOpts(); s.changed(); } },
          ...['Lee', 'Rosco'].map((m) => h('option', { value: m, selected: m === o.gelMaker }, m))), h('br'),
        ...(cmp.gels.length ? cmp.gels.map((g, i) => h('span', {}, `${i + 1}. ${g.gels.map((x) => x.name).join(' + ')} (${sgn(g.mired, 0)}) → ${de(g.resultK, 0)} K, Rest ${sgn(g.residual, 0)} mired`, h('br'))) : ['keine Farbtemperatur-Folie nötig (< 5 mired)', h('br')]),
        greenMagentaHint(cmp.dDuv), h('br'),
        h('span', { class: 'hint' }, 'Mired-Werte der Folien laut Tabelle (Sekundärquelle), Folien addieren sich in Mired. Grün/Magenta nur Richtung, Stärke nicht belegt.')) : '',
      s.points.length ? h('div', { class: 'row' },
        h('button', { class: 'mini', onclick: () => download(`lichtmesser-punkte-${stamp()}.csv`, pointsCsv(s)) }, '⤓ Punkte CSV'),
        h('button', { class: 'mini', onclick: () => s.clearPoints() }, 'Punkte löschen')) : '',
    );
  }

  function drawChart() {
    const ctx = chart.getContext('2d')!, W = chart.width, H = chart.height;
    const pts = s.history.filter((r) => !s.active || r.device === s.active).slice(-120);
    ctx.clearRect(0, 0, W, H);
    if (pts.length < 2) return;
    const max = Math.max(...pts.map((p) => p.lux), 1e-6);
    ctx.strokeStyle = '#8cff9e'; ctx.beginPath();
    pts.forEach((p, i) => { const x = (i / (pts.length - 1)) * (W - 1), y = H - 2 - (p.lux / max) * (H - 4); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
    ctx.fillStyle = '#888'; ctx.font = '10px system-ui'; ctx.fillText(`max ${de(max, 0)} lx`, 2, 10);
  }

  let queued = false;
  s.addEventListener('change', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      // don't rebuild while typing a name
      const f = document.activeElement;
      if (f && root.contains(f) && f.tagName === 'INPUT' && (f as HTMLInputElement).type !== 'radio') { drawChart(); return; }
      render(); drawChart();
    });
  });

  root.replaceChildren(
    h('p', { class: 'warnbox' }, 'Geprüft mit einem Light Master 3 (Verbindung, Kalibrierfaktoren, Messung) am 30.09.2026. Light Master 4, Flimmern und mehrere Geräte gleichzeitig nur ohne zweites Gerät bzw. mit aufgezeichneten Paketen getestet.'),
    buttons, pickerBox(s), status, devices, vals, chart, info, points,
    h('p', { class: 'hint' }, `Lux, xy, CCT und Duv rechnet LZ Scopes aus den Rohkanälen (Filtersensor, 6 bzw. 8 Kanäle, Matrizen der Opple-App). Ein Wert je Messung an einer Stelle, kein Bild. Für schmalbandige LED-Primärfarben, z. B. einer LED-Wand, und für Displays nur als Trendmesser geeignet.${desktopBluetooth() ? '' : ' Im Browser: Chrome/Edge zeigen die Geräteauswahl selbst; bekannte Geräte verbinden dort ohne Auswahl, wenn der Browser sie sich merkt.'}`),
  );
  render();
}

/** Captured points as CSV (comma, dot decimals). */
export function pointsCsv(s: LightStore) {
  const f = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '');
  const r0 = s.point(s.opts.ref);
  return [
    '# LZ Scopes – Opple Light Master, Messpunkte (Trendmessung; Δu′v′ zur Referenz)',
    'punkt,zelle,geraet,zeit,lux,x,y,cct_k,duv,du_v_ref',
    ...s.points.map((p) => {
      const r: Reading = p.reading;
      const d = r0 ? compareLights(r0.reading, r).duv : NaN;
      return [`"${p.label.replace(/"/g, '""')}"`, p.cell ? `${String.fromCharCode(65 + p.cell[1])}${p.cell[0] + 1}` : '', `"${s.label(r.device ?? '')}"`, new Date(r.ts).toISOString(), f(r.lux, 2), f(r.x, 5), f(r.y, 5), f(r.cct, 0), f(r.duv, 5), f(d, 5)].join(',');
    }),
  ].join('\n') + '\n';
}
