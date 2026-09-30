// ⚙ settings of the clock panel (and the picture overlay's time settings).

import type { PanelState } from '../panel';
import type { Source } from '../sources';
import { clockOpts, type ClockOptions } from './panel';
import { ptpClient } from './ptpClient';
import { RATES, rateById } from './timecode';

type Kid = Node | string;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Kid[]) => {
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
const check = (on: boolean, label: string, onchange: (v: boolean) => void, title = '') => {
  const c = h('input', { type: 'checkbox', checked: on }) as HTMLInputElement;
  c.onchange = () => onchange(c.checked);
  return h('label', { class: 'inline', title }, c, label);
};

const JAMS: [string, string][] = Array.from({ length: 144 }, (_, i) => {
  const t = `${String(Math.floor(i / 6)).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}`;
  return [t, t];
});

/**
 * Settings rows. `refresh` rebuilds the menu (after changes that show/hide rows);
 * `sources` lists the app's sources for the LTC input.
 */
export function clockPanelSettings(p: PanelState, save: () => void, sources: Source[], refresh: () => void): Node[] {
  const o = clockOpts(p.clock);
  const set = (patch: Partial<ClockOptions>, rebuild = false) => {
    p.clock = { ...o, ...patch };
    // switching LTC off (or to another source) stops the old reader
    if ('ltcSource' in patch && o.ltcSource && o.ltcSource !== patch.ltcSource) sources.find((s) => s.id === o.ltcSource)?.audio?.setLtc(-1);
    save();
    if (rebuild) refresh();
  };
  const rows: Node[] = [];
  const row = (label: string, ...kids: Kid[]) => rows.push(h('label', { class: 'mrow' }, h('span', {}, label), ...kids));
  const hint = (t: string) => rows.push(h('p', { class: 'hint' }, t));

  rows.push(h('div', { class: 'mtitle' }, 'Tageszeit-Timecode (ST 2059-1)'));
  row('Bildrate', select(o.rate, RATES.map((r) => [r.id, r.label]), (v) => set({ rate: v, df: rateById(v).dfAllowed && o.df }, true)));
  if (rateById(o.rate).dfAllowed) row('Zählung', select(o.df ? 'df' : 'ndf', [['ndf', 'Non-Drop-Frame'], ['df', 'Drop-Frame']], (v) => set({ df: v === 'df' })));
  row('Daily Jam', select(o.jam, JAMS, (v) => set({ jam: v })), 'Lokalzeit');
  hint('Ohne PTP zählt die Uhr aus der Systemzeit (UTC + TAI−UTC nach IERS) in der Zeitzone des Systems. Das ist keine Referenz. Bei 1/1,001-Raten läuft Drop-Frame bis zum nächsten Jam um bis zu 3 Frames pro Tag weg (ST 2059-1 §9.1.2).');

  rows.push(h('div', { class: 'mtitle' }, 'LTC aus dem Ton'));
  const audioSources = sources.filter((s) => s.audio || s.kind === 'audio' || (s.kind === 'stream' && s.settings.audio !== false) || s.kind === 'file');
  row('Quelle', select(o.ltcSource, [['', 'aus'], ...audioSources.map((s, i) => [s.id, `${i + 1} ${s.name}`] as [string, string])], (v) => set({ ltcSource: v }, true)));
  if (o.ltcSource) {
    const a = sources.find((s) => s.id === o.ltcSource)?.audio;
    const names = a ? a.names : ['1', '2'];
    row('Kanal', select(String(o.ltcChannel), names.map((n, i) => [String(i), n]), (v) => set({ ltcChannel: Number(v) })));
    hint('Eigener Biphase-Mark-Leser (24–30 fps, vorwärts und rückwärts). Die Latenz des Audiowegs ist nicht kompensiert.');
  }

  rows.push(h('div', { class: 'mtitle' }, 'PTP (SMPTE ST 2059-2)'));
  row('Monitor', check(o.ptp, 'passiv mithören (Bridge, UDP 319/320)', (v) => set({ ptp: v }, true), 'Die Node-Bridge lauscht auf 224.0.1.129; sie sendet nichts, solange „Laufzeit messen“ aus ist'));
  if (o.ptp) {
    const ifaces = ptpClient.status?.ifaces ?? [];
    row('Schnittstelle', select(o.iface, [['', 'Standard (Routing)'], ...ifaces.map((i) => [i.address, `${i.name} ${i.address}`] as [string, string])], (v) => set({ iface: v })));
    row('Laufzeit', check(o.delayReq, 'messen (sendet 1 Delay_Req/s)', (v) => set({ delayReq: v }), 'Aktiv: die Bridge sendet Delay_Req an 224.0.1.129; Ergebnis mit Software-Zeitstempeln'));
    row('Uhr', check(o.usePtp, 'mit PTP-Offset korrigieren (Schätzung)', (v) => set({ usePtp: v })));
    row('SM-TLV', check(o.useSm, 'Rate, DF, Lokal-Offset und Jam vom Grandmaster', (v) => set({ useSm: v })));
    rows.push(h('div', { class: 'mtitle' }, 'ST 2110 RTP-Zeitstempel'));
    const g = h('input', { value: o.rtpGroup, placeholder: '239.x.x.x', class: 'num wide' }) as HTMLInputElement;
    const port = h('input', { value: o.rtpPort || '', placeholder: 'Port', type: 'number', min: 1024, max: 65535, class: 'num' }) as HTMLInputElement;
    const apply = () => set({ rtpGroup: g.value.trim(), rtpPort: Number(port.value) || 0 });
    g.onchange = apply; port.onchange = apply;
    row('Multicast', g, port);
    hint('Vergleicht den RTP-Zeitstempel (90 kHz, Offset 0 zur Epoche: ST 2110-10 §7.3, ST 2110-20 §6.1.3) mit der Ankunftszeit und prüft das Frame-Raster. Bildrate = Einstellung oben.');
  }
  return rows;
}
