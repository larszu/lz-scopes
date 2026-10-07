// ⚙ settings of the clock panel (and the picture overlay's time settings).

import type { PanelState } from '../panel';
import type { Source } from '../sources';
import { clockOpts, type ClockOptions } from './panel';
import { ptpClient } from './ptpClient';
import { RATES, rateById } from './timecode';
import { t } from '../i18n';

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
  const hint = (text: string) => rows.push(h('p', { class: 'hint' }, text));

  rows.push(h('div', { class: 'mtitle' }, t('clock.set.todTitle')));
  row(t('clock.set.rate'), select(o.rate, RATES.map((r) => [r.id, r.label]), (v) => set({ rate: v, df: rateById(v).dfAllowed && o.df }, true)));
  if (rateById(o.rate).nominal > 30) {
    row(t('clock.set.display30'), select(o.tcDisplay, [['frames', t('clock.set.framesN', { n: rateById(o.rate).nominal - 1 })], ['pairs', t('clock.set.pairs')]], (v) => set({ tcDisplay: v as ClockOptions['tcDisplay'] })));
  }
  if (rateById(o.rate).dfAllowed) row(t('clock.set.counting'), select(o.df ? 'df' : 'ndf', [['ndf', 'Non-Drop-Frame'], ['df', 'Drop-Frame']], (v) => set({ df: v === 'df' })));
  row('Daily Jam', select(o.jam, JAMS, (v) => set({ jam: v })), t('clock.set.localTime'));
  hint(t('clock.set.noPtpHint'));

  rows.push(h('div', { class: 'mtitle' }, t('clock.set.ltcTitle')));
  const audioSources = sources.filter((s) => s.audio || s.kind === 'audio' || (s.kind === 'stream' && s.settings.audio !== false) || s.kind === 'file');
  row(t('clock.set.source'), select(o.ltcSource, [['', t('clock.set.off')], ...audioSources.map((s, i) => [s.id, `${i + 1} ${s.name}`] as [string, string])], (v) => set({ ltcSource: v }, true)));
  if (o.ltcSource) {
    const a = sources.find((s) => s.id === o.ltcSource)?.audio;
    const names = a ? a.names : ['1', '2'];
    row(t('clock.set.channel'), select(String(o.ltcChannel), names.map((n, i) => [String(i), n]), (v) => set({ ltcChannel: Number(v) })));
    hint(t('clock.set.ltcHint'));
  }

  rows.push(h('div', { class: 'mtitle' }, 'PTP (SMPTE ST 2059-2)'));
  row('Monitor', check(o.ptp, t('clock.set.passive'), (v) => set({ ptp: v }, true), t('clock.set.passiveTitle')));
  if (o.ptp) {
    if (ptpClient.conn === 'denied' && ptpClient.allowUrl) {
      rows.push(h('div', { class: 'mrow' }, h('button', { title: t('clock.set.allowTitle'), onclick: () => window.open(ptpClient.allowUrl, '_blank', 'noopener') }, t('clock.set.allow'))));
      hint(t('clock.set.allowHint', { origin: location.origin }));
    }
    const ifaces = ptpClient.status?.ifaces ?? [];
    row(t('clock.set.iface'), select(o.iface, [['', t('clock.set.ifaceDefault')], ...ifaces.map((i) => [i.address, `${i.name} ${i.address}`] as [string, string])], (v) => set({ iface: v })));
    row(t('clock.set.delay'), check(o.delayReq, t('clock.set.delayMeasure'), (v) => set({ delayReq: v }), t('clock.set.delayTitle')));
    row(t('clock.set.clock'), check(o.usePtp, t('clock.set.usePtp'), (v) => set({ usePtp: v })));
    row('SM-TLV', check(o.useSm, t('clock.set.useSm'), (v) => set({ useSm: v })));
    rows.push(h('div', { class: 'mtitle' }, t('clock.set.rtpTitle')));
    const g = h('input', { value: o.rtpGroup, placeholder: '239.x.x.x', class: 'num wide' }) as HTMLInputElement;
    const port = h('input', { value: o.rtpPort || '', placeholder: 'Port', type: 'number', min: 1024, max: 65535, class: 'num' }) as HTMLInputElement;
    const apply = () => set({ rtpGroup: g.value.trim(), rtpPort: Number(port.value) || 0 });
    g.onchange = apply; port.onchange = apply;
    row('Multicast', g, port);
    hint(t('clock.set.rtpHint'));
  }
  return rows;
}
