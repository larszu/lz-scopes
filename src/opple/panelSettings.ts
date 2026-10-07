// ⚙ menu of the light scopes (src/opple/scopes.ts).

import type { PanelState } from '../panel';
import { lightStore } from './store';
import { TARGET_LABELS, lightOpts, type LightPanelOptions } from './scopes';
import { num, t } from '../i18n';

export { isLight, LIGHT_SCOPES } from './scopes';

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
const sel = (value: string, options: [string, string][], on: (v: string) => void, title = '') =>
  h('select', { title, onchange: (e: Event) => on((e.target as HTMLSelectElement).value) }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));

export function lightPanelSettings(p: PanelState, save: () => void): Node[] {
  const o = lightOpts(p.light);
  const set = (patch: Partial<LightPanelOptions>) => { p.light = { ...p.light, ...patch }; save(); };
  const row = (label: string, ...kids: (Node | string)[]) => h('label', { class: 'mrow' }, h('span', {}, label), ...kids);
  const s = lightStore();
  const rows: Node[] = [];
  if (p.scope !== 'light-map') {
    rows.push(row(t('opple.ps.device'), sel(o.device, [['', t('opple.ps.allConnected')], ...s.known.map((k) => [k.key, k.alias || k.name] as [string, string])], (v) => set({ device: v }))));
  }
  if (p.scope === 'light-cie') {
    rows.push(row(t('opple.ps.diagram'), sel(o.diagram, [['1976', t('opple.ps.uv')], ['1931', 'CIE 1931 xy']], (v) => set({ diagram: v as LightPanelOptions['diagram'] }))));
    rows.push(row(t('opple.ps.zoom'), sel(o.zoom, [['planck', t('opple.ps.aroundPlanck')], ['full', t('opple.ps.whole')]], (v) => set({ zoom: v as LightPanelOptions['zoom'] }))));
  }
  if (p.scope === 'light-cie' || p.scope === 'light-vector') {
    rows.push(row(p.scope === 'light-vector' ? t('opple.ps.centreTarget') : t('opple.ps.target'), sel(o.target, Object.entries(TARGET_LABELS) as [string, string][], (v) => set({ target: v as LightPanelOptions['target'] }), t('opple.ps.targetTitle'))));
    rows.push(row(t('opple.ps.trail'), sel(String(o.trail), [['1', t('opple.ps.current')], ...[20, 60, 300].map((n): [string, string] => [String(n), t('opple.ps.readings', { n })])], (v) => set({ trail: Number(v) }))));
  }
  if (p.scope === 'light-vector') {
    rows.push(row(t('opple.ps.scale'), sel(String(o.scale), [['0', t('opple.ps.auto')], ...[0.05, 0.1, 0.2, 0.5].map((v): [string, string] => [String(v), `s ${num(v)}`])], (v) => set({ scale: Number(v) }), t('opple.ps.scaleTitle'))));
  }
  if (p.scope === 'light-bands') {
    rows.push(row(t('opple.ps.display'), sel(o.bands, [['abs', t('opple.ps.relStrongest')], ['ref', t('opple.ps.ratioRef')]], (v) => set({ bands: v as LightPanelOptions['bands'] }))));
  }
  if (p.scope === 'light-trend') {
    rows.push(row(t('opple.ps.quantity'), sel(o.trend, [['all', t('opple.ps.all')], ['lux', t('opple.ps.lux')], ['cct', t('opple.ps.cct')], ['duv', t('opple.ps.duv')]], (v) => set({ trend: v as LightPanelOptions['trend'] }))));
    rows.push(row(t('opple.ps.window'), sel(String(o.window), [['30', '30 s'], ['120', '2 min'], ['600', '10 min'], ['3600', '1 h']], (v) => set({ window: Number(v) }))));
  }
  if (p.scope === 'light-map') {
    rows.push(row(t('opple.ps.map'), sel(o.map, [['lux', t('opple.sc.illuminance')], ['duv', t('opple.ps.duvMean')], ['cct', t('opple.ps.cctMean')]], (v) => set({ map: v as LightPanelOptions['map'] }))));
    rows.push(h('p', { class: 'hint' }, t('opple.ps.mapHint')));
  }
  rows.push(h('p', { class: 'hint' }, t('opple.ps.hint')));
  return rows;
}
