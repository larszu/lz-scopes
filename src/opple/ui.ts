// Light meter panel in the sidebar (#11): find and connect one or more Opple Light Masters over
// Web Bluetooth, name them, show lux / CCT / Duv / xy, take measuring points (grid, comparison
// with gel suggestion), export CSV, open the light scopes in the dock.

import { bluetoothSupport } from './meter';
import { LM3_MODE_NAMES, readingsCsv, type Reading } from './photometry';
import { compareLights, greenMagentaHint } from './lightScience';
import { desktopBluetooth, lightStore, oppleMeter, type LightStore } from './store';
import { ArgyllLightMeter, DRIVER_LABELS } from './drivers';
import type { SpectrumUnit } from './spectrum';
import { num, t } from '../i18n';

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
const de = (v: number, d: number) => (Number.isFinite(v) ? num(v, d).replace('-', '−') : '–');
const sgn = (v: number, d: number) => (Number.isFinite(v) ? (v >= 0 ? '+' : '−') + num(Math.abs(v), d) : '–');

const CSS = `
.opple .big { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; margin-top: 6px; }
.opple .big div { display: flex; flex-direction: column; }
.opple .big b { font-size: 18px; color: var(--text, #ddd); font-variant-numeric: tabular-nums; }
.opple .big span { font-size: 10px; color: var(--text-muted, #888); text-transform: uppercase; letter-spacing: .05em; }
.opple .warnbox { color: var(--warn, #ffb44a); font-size: 11px; margin-top: 4px; }
.opple canvas { width: 100%; height: 40px; margin-top: 6px; }
.opple .row { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; align-items: center; }
.opple .dev { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 4px 0; border-top: 1px solid var(--line-1, #2a2d33); }
.opple .dev input.alias { flex: 1 1 90px; min-width: 60px; }
.opple .dev .val { font-size: 11px; color: var(--text-muted, #999); font-variant-numeric: tabular-nums; width: 100%; }
.opple .dev.active .val { color: var(--text, #ddd); }
.opple .dot { width: 8px; height: 8px; border-radius: 50%; background: #555; display: inline-block; }
.opple .dot.on { background: #8cff9e; } .opple .dot.busy { background: #ffb44a; } .opple .dot.err { background: #ff5c5c; }
.opple .picker { border: 1px solid var(--accent, #00dcff); border-radius: 4px; padding: 6px; margin-top: 6px; }
.opple .picker button.pick { display: block; width: 100%; text-align: left; margin-top: 3px; }
.opple table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; font-variant-numeric: tabular-nums; }
.opple td { padding: 1px 3px; } .opple td.n { text-align: right; }
.opple .cmp { font-size: 11px; margin-top: 6px; line-height: 1.45; }
.opple h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted, #888); margin: 10px 0 2px; }
.opple input.num { width: 3.2em; }
`;

function download(name: string, text: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name }) as HTMLAnchorElement;
  document.body.append(a); a.click(); a.remove();
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

export const NO_PAIRING_HINT = t('opple.ui.noPairing');

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
      h('div', { class: 'hint' }, p.devices.length ? t('opple.ui.found') : t('opple.ui.searching')),
      ...p.devices.map((d) => {
        const known = s.known.find((k) => k.nativeId === d.id);
        const busy = [...s.meters.keys()].includes(known?.key ?? '-');
        return h('button', { class: 'pick', disabled: busy, onclick: () => s.pick(d.id) }, `${known ? `${known.alias} · ` : ''}${d.name || 'Light Master'}${busy ? ` ${t('opple.ui.alreadyConnected')}` : known ? '' : ` ${t('opple.ui.new')}`}`);
      }),
      h('div', { class: 'row' }, h('button', { onclick: () => s.cancelPick() }, t('opple.ui.cancel')), p.scanning ? h('span', { class: 'hint' }, t('opple.ui.scanning')) : '')));
  };
  s.addEventListener('change', render);
  render();
  return box;
}

export function mountOpple(root: HTMLElement, hooks: { openScopes?: () => void; bridgeWs?: () => string } = {}) {
  if (!document.getElementById('opple-css')) document.head.append(h('style', { id: 'opple-css' }, CSS));
  root.classList.add('opple');
  const s = lightStore();
  if (hooks.bridgeWs) s.bridgeWs = hooks.bridgeWs;
  const sup = bluetoothSupport();

  const status = h('p', { class: 'hint' });
  const devices = h('div');
  const vals = h('div', { class: 'big' });
  const chart = h('canvas', { width: 280, height: 40, title: t('opple.ui.chartTitle') }) as HTMLCanvasElement;
  const info = h('p', { class: 'hint' });
  const buttons = h('div', { class: 'row' });
  const points = h('div');

  const cell = (label: string, value: string) => h('div', {}, h('b', {}, value), h('span', {}, label));
  const connect = (p: Promise<unknown>) => p.then(() => s.setRunning(true)).catch(() => { /* message shows it */ }).finally(render);

  function renderDevices() {
    const rows = s.known.map((k) => {
      const m = s.meters.get(k.key), st = m?.state ?? 'idle';
      const r = s.latest(k.key);
      const alias = h('input', { class: 'alias', value: k.alias, title: t('opple.ui.aliasTitle', { name: k.name }), onchange: (e: Event) => s.rename(k.key, (e.target as HTMLInputElement).value) });
      return h('div', { class: `dev${s.active === k.key ? ' active' : ''}` },
        h('span', { class: `dot ${st === 'connected' ? 'on' : st === 'error' ? 'err' : st === 'idle' ? '' : 'busy'}`, title: m?.message || t('opple.ui.notConnected') }),
        alias,
        st === 'connected'
          ? h('button', { class: 'mini', onclick: () => s.disconnect(k.key) }, t('opple.ui.disconnect'))
          : h('button', { class: 'mini', disabled: (k.driver !== 'argyll' && !sup.ok) || (st !== 'idle' && st !== 'error'), title: t('opple.ui.connectTitle'), onclick: () => connect(s.reconnect(k)) }, t('opple.ui.connect')),
        m instanceof ArgyllLightMeter && st !== 'idle' ? h('button', { class: 'mini', title: t('opple.ui.calTitle'), onclick: () => m.key('k') }, t('opple.ui.calibrate')) : '',
        st === 'connected' && s.active !== k.key ? h('button', { class: 'mini', title: t('opple.ui.activeTitle'), onclick: () => { s.active = k.key; s.changed(); } }, t('opple.ui.active')) : '',
        h('button', { class: 'icon', title: t('opple.ui.forget'), onclick: () => s.forget(k.key) }, '✕'),
        h('div', { class: 'val' }, st === 'connected' && r ? `${de(r.lux, r.lux < 10 ? 1 : 0)} ${r.quantity ?? 'lx'} · ${de(r.cct, 0)} K · Duv ${sgn(r.duv, 4)}` : `${k.driver === 'argyll' ? `${DRIVER_LABELS.argyll} ${t('opple.ui.unverified')}` : `${k.name}${k.model ? ` · ${k.model === 'lm4' ? 'LM4' : 'LM3'}` : ''}`}${m?.message && st !== 'connected' ? ` · ${m.message}` : ''}`));
    });
    devices.replaceChildren(...(rows.length ? [h('h3', {}, t('opple.ui.devices')), ...rows] : []));
  }

  function render() {
    renderDevices();
    const act = s.meters.get(s.active);
    const r = s.latest(s.active) ?? s.latest();
    vals.replaceChildren(
      cell(r?.quantity === 'cd/m²' ? t('opple.ui.cdNoAmbient') : 'Lux', r ? de(r.lux, r.lux < 10 ? 2 : 0) : '–'),
      cell('CCT K (McCamy)', r ? de(r.cct, 0) : '–'),
      cell('Duv (Ohno)', r ? de(r.duv, 4) : '–'),
      cell('x / y (CIE 1931)', r ? `${de(r.x, 4)} / ${de(r.y, 4)}` : '–'),
    );
    info.textContent = r
      ? `${s.label(r.device ?? '')} · ${r.model === 'argyll' ? 'ArgyllCMS' : r.model === 'datei' /* lang-ok: driver id */ ? t('opple.ui.fromFile') : r.model === 'lm4' ? 'Light Master 4' : `Light Master 3${r.mode ? `, Matrix ${LM3_MODE_NAMES[r.mode]}` : ''}`}${r.spectrum ? ` · ${t('opple.ui.spectrumN', { n: r.spectrum.values.length })}` : ''}${r.cri ? ` · Ra ${de(r.cri.ra, 1)}` : ''} · ${r.model === 'lm3' || r.model === 'lm4' ? (r.calibrated ? t('opple.ui.withCal') : t('opple.ui.withoutCal')) : t('opple.ui.deviceValues')}${r.temperature != null ? ` · ${de(r.temperature, 1)} °C` : ''} · ${t('opple.ui.historyN', { n: s.history.length })}`
      : '';
    const anyConnected = s.connected.length > 0;
    const scanning = [...s.meters.values()].some((m) => m.state === 'requesting' || m.state === 'connecting' || m.state === 'calibrating');
    buttons.replaceChildren(
      h('button', { class: 'primary', disabled: !sup.ok || scanning, title: NO_PAIRING_HINT, onclick: () => connect(s.connectNew()) }, anyConnected ? t('opple.ui.searchMore') : t('opple.ui.search')),
      anyConnected ? h('button', { onclick: () => s.setRunning(!s.running) }, s.running ? t('opple.ui.pause') : t('opple.ui.run')) : '',
      hooks.openScopes ? h('button', { title: t('opple.ui.scopesTitle'), onclick: () => hooks.openScopes!() }, t('opple.ui.scopes')) : '',
      s.history.length ? h('button', { title: t('opple.ui.csvTitle'), onclick: () => download(`${t('opple.file.prefix')}-${stamp()}.csv`, readingsCsv(s.history)) }, '⤓ CSV') : '',
      s.history.length ? h('button', { onclick: () => { s.history.length = 0; s.changed(); } }, t('opple.ui.clearHistory')) : '',
      act?.frames.length ? h('button', { title: t('opple.ui.rawTitle'), onclick: () => navigator.clipboard?.writeText(act.frames.join('\n')) }, t('opple.ui.raw')) : '',
    );
    const msg = s.message || act?.message || '';
    status.textContent = msg || (sup.ok ? (anyConnected ? '' : NO_PAIRING_HINT) : sup.reason);
    status.style.color = act?.state === 'error' || s.message ? 'var(--err, #ff5c5c)' : '';
    renderPoints();
  }

  let label = '';
  function renderPoints() {
    const o = s.opts;
    const numIn = (v: number, set: (n: number) => void, max = 12) => h('input', { type: 'number', class: 'num', min: 1, max, value: v, onchange: (e: Event) => { set(Math.max(1, Math.min(max, Number((e.target as HTMLInputElement).value) || 1))); s.saveOpts(); s.changed(); } });
    const can = s.connected.length > 0;
    const take = (grid: boolean) => { s.capture(label, grid).then(() => { label = ''; }).catch((e) => { s.message = (e as Error).message; s.changed(); }); };
    const cellName = `${String.fromCharCode(65 + o.cursor[1])}${o.cursor[0] + 1}`;
    const a = s.point(o.ref), b = s.point(o.cmp);
    const cmp = a && b && a !== b ? compareLights(a.reading, b.reading, o.gelMaker) : null;
    points.replaceChildren(
      h('h3', {}, t('opple.ui.pointsTitle')),
      h('div', { class: 'row' },
        h('input', { placeholder: t('opple.ui.namePh'), value: label, style: 'flex:1 1 80px;min-width:60px', oninput: (e: Event) => { label = (e.target as HTMLInputElement).value; } }),
        h('select', { title: t('opple.ui.avgTitle'), onchange: (e: Event) => { o.avg = Number((e.target as HTMLSelectElement).value); s.saveOpts(); } },
          ...[1, 3, 5, 10].map((n) => h('option', { value: n, selected: n === o.avg }, `⌀ ${n}`)))),
      h('div', { class: 'row' },
        h('button', { disabled: !can, title: t('opple.ui.pointTitle'), onclick: () => take(false) }, t('opple.ui.point')),
        h('button', { disabled: !can, title: t('opple.ui.cellTitle'), onclick: () => take(true) }, t('opple.ui.cell', { cell: cellName })),
        h('button', { class: 'mini', title: t('opple.ui.skipCell'), onclick: () => s.advance() }, '→')),
      h('div', { class: 'row' }, t('opple.ui.grid'), numIn(o.cols, (n) => { o.cols = n; }), '×', numIn(o.rows, (n) => { o.rows = n; }, 26),
        h('span', { class: 'hint' }, t('opple.ui.gridHint'))),
      s.points.length ? h('table', {},
        h('tr', {}, h('td', {}, ''), h('td', {}, 'Ref'), h('td', {}, 'B'), h('td', { class: 'n' }, 'lx'), h('td', { class: 'n' }, 'K'), h('td', { class: 'n' }, 'Duv'), h('td', {}, '')),
        ...s.points.map((p) => h('tr', {},
          h('td', {}, p.label),
          h('td', {}, h('input', { type: 'radio', name: 'opple-ref', checked: p.id === o.ref, title: t('opple.ui.refTitle'), onchange: () => { o.ref = p.id; s.saveOpts(); s.changed(); } })),
          h('td', {}, h('input', { type: 'radio', name: 'opple-cmp', checked: p.id === o.cmp, title: t('opple.ui.cmpTitle'), onchange: () => { o.cmp = p.id; s.saveOpts(); s.changed(); } })),
          h('td', { class: 'n' }, de(p.reading.lux, p.reading.lux < 10 ? 1 : 0)), h('td', { class: 'n' }, de(p.reading.cct, 0)), h('td', { class: 'n' }, sgn(p.reading.duv, 3)),
          h('td', {}, h('button', { class: 'icon', title: t('opple.ui.deletePoint'), onclick: () => s.removePoint(p.id) }, '✕'))))) : '',
      cmp ? h('div', { class: 'cmp' },
        h('b', {}, `${a!.label} (A) → ${b!.label} (B)`), h('br'),
        t('opple.ui.cmpLine', { duv: de(cmp.duv, 4), a: de(cmp.cctA, 0), b: de(cmp.cctB, 0), stops: sgn(cmp.stops, 2) }), h('br'),
        `${t('opple.ui.miredFix', { v: sgn(cmp.shift, 0) })} `,
        h('select', { onchange: (e: Event) => { o.gelMaker = (e.target as HTMLSelectElement).value as 'Lee' | 'Rosco'; s.saveOpts(); s.changed(); } },
          ...['Lee', 'Rosco'].map((m) => h('option', { value: m, selected: m === o.gelMaker }, m))), h('br'),
        ...(cmp.gels.length ? cmp.gels.map((g, i) => h('span', {}, t('opple.ui.gelLine', { i: i + 1, gels: g.gels.map((x) => x.name).join(' + '), m: sgn(g.mired, 0), k: de(g.resultK, 0), rest: sgn(g.residual, 0) }), h('br'))) : [t('opple.ui.noGel'), h('br')]),
        greenMagentaHint(cmp.dDuv, cmp.cctB), h('br'),
        h('span', { class: 'hint' }, t('opple.ui.gelSources'))) : '',
      s.points.length ? h('div', { class: 'row' },
        h('button', { class: 'mini', onclick: () => download(`${t('opple.file.prefix')}-${t('opple.file.points')}-${stamp()}.csv`, pointsCsv(s)) }, t('opple.ui.pointsCsv')),
        h('button', { class: 'mini', onclick: () => s.clearPoints() }, t('opple.ui.clearPoints'))) : '',
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
    h('p', { class: 'warnbox' }, t('opple.ui.tested')),
    buttons, pickerBox(s), status, devices, vals, chart, info, points, otherMeters(s, () => render()),
    h('p', { class: 'hint' }, `${t('opple.ui.footer')}${desktopBluetooth() ? '' : ` ${t('opple.ui.footerBrowser')}`}`),
  );
  render();
}

/** Captured points as CSV (comma, dot decimals). */
export function pointsCsv(s: LightStore) {
  const f = (v: number, d: number) => (Number.isFinite(v) ? v.toFixed(d) : '');
  const r0 = s.point(s.opts.ref);
  return [
    `# ${t('opple.csv.pointsHead')}`,
    // column names: stable English ids, independent of the UI language
    'point,cell,device,time,lux,x,y,cct_k,duv,du_v_ref',
    ...s.points.map((p) => {
      const r: Reading = p.reading;
      const d = r0 ? compareLights(r0.reading, r).duv : NaN;
      return [`"${p.label.replace(/"/g, '""')}"`, p.cell ? `${String.fromCharCode(65 + p.cell[1])}${p.cell[0] + 1}` : '', `"${s.label(r.device ?? '')}"`, new Date(r.ts).toISOString(), f(r.lux, 2), f(r.x, 5), f(r.y, 5), f(r.cct, 0), f(r.duv, 5), f(d, 5)].join(',');
    }),
  ].join('\n') + '\n';
}

/** Other light meters: ArgyllCMS spectrometers/colorimeters (bridge) and spectrum files. */
function otherMeters(s: LightStore, done: () => void): HTMLElement {
  const box = h('details', { class: 'hint' });
  let unit: SpectrumUnit = 'relativ';
  let ports: { port: number; name: string }[] = [];
  let info = '';
  const render = () => {
    box.replaceChildren(
      h('summary', {}, t('opple.ui.others')),
      h('p', {}, t('opple.ui.othersHint')),
      h('div', { class: 'row' },
        h('select', { onchange: (e: Event) => { sel = Number((e.target as HTMLSelectElement).value) || undefined; } },
          h('option', { value: '' }, ports.length ? t('opple.ui.firstDevice') : t('opple.ui.deviceLoad')), ...ports.map((p) => h('option', { value: p.port }, `${p.port}: ${p.name}`))),
        h('button', { class: 'mini', title: t('opple.ui.listTitle'), onclick: () => {
          fetch(`${s.bridgeWs().replace(/^ws/, 'http')}/api/meter`).then((r) => r.json()).then((m: { found: boolean; instruments: { port: number; name: string }[]; version?: string }) => {
            ports = m.instruments ?? []; info = m.found ? t('opple.ui.argyllFound', { v: m.version ?? '', n: ports.length }) : t('opple.ui.argyllMissing'); render();
          }).catch(() => { info = t('opple.ui.noBridge'); render(); });
        } }, t('opple.ui.list')),
        h('button', { class: 'mini', onclick: () => { s.connectArgyll(sel).then(() => s.setRunning(true)).catch(() => {}).finally(done); } }, t('opple.ui.connect'))),
      info ? h('p', {}, info) : '',
      h('p', {}, t('opple.ui.fileHint')),
      h('div', { class: 'row' },
        h('select', { title: t('opple.ui.unitTitle'), onchange: (e: Event) => { unit = (e.target as HTMLSelectElement).value as SpectrumUnit; } },
          ...([['relativ', t('opple.ui.unitRel')], ['mW/(m²·nm)', t('opple.ui.unitIrr')], ['mW/(m²·sr·nm)', t('opple.ui.unitRad')]] as [SpectrumUnit, string][]).map(([v, l]) => h('option', { value: v, selected: v === unit }, l))),
        h('input', { type: 'file', accept: '.sp,.csv,.txt,.tsv', onchange: async (e: Event) => {
          const f = (e.target as HTMLInputElement).files?.[0];
          if (!f) return;
          try { s.importSpectrum(await f.text(), f.name, unit); s.message = ''; } catch (err) { s.message = (err as Error).message; s.changed(); }
        } })),
    );
  };
  let sel: number | undefined;
  render();
  return box;
}
