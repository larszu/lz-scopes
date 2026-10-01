// ⚙ menu of the light scopes (src/opple/scopes.ts).

import type { PanelState } from '../panel';
import { lightStore } from './store';
import { TARGET_LABELS, lightOpts, type LightPanelOptions } from './scopes';

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
    rows.push(row('Gerät', sel(o.device, [['', 'alle verbundenen'], ...s.known.map((k) => [k.key, k.alias || k.name] as [string, string])], (v) => set({ device: v }))));
  }
  if (p.scope === 'light-cie') {
    rows.push(row('Diagramm', sel(o.diagram, [['1976', 'CIE 1976 u′v′ (gleichabständiger)'], ['1931', 'CIE 1931 xy']], (v) => set({ diagram: v as LightPanelOptions['diagram'] }))));
    rows.push(row('Ausschnitt', sel(o.zoom, [['planck', 'um die Planck-Kurve'], ['full', 'ganzes Diagramm']], (v) => set({ zoom: v as LightPanelOptions['zoom'] }))));
  }
  if (p.scope === 'light-cie' || p.scope === 'light-vector') {
    rows.push(row(p.scope === 'light-vector' ? 'Mitte (Ziel)' : 'Ziel', sel(o.target, Object.entries(TARGET_LABELS) as [string, string][], (v) => set({ target: v as LightPanelOptions['target'] }), 'Bezugsweiß für Δu′v′, Farbton, Sättigung und Mired')));
    rows.push(row('Spur', sel(String(o.trail), [['1', 'nur aktuell'], ['20', '20 Messungen'], ['60', '60 Messungen'], ['300', '300 Messungen']], (v) => set({ trail: Number(v) }))));
  }
  if (p.scope === 'light-vector') {
    rows.push(row('Skala', sel(String(o.scale), [['0', 'automatisch'], ['0.05', 's 0,05'], ['0.1', 's 0,1'], ['0.2', 's 0,2'], ['0.5', 's 0,5']], (v) => set({ scale: Number(v) }), 'Äußerer Ring als CIELUV-Sättigung s = 13·Δu′v′')));
  }
  if (p.scope === 'light-bands') {
    rows.push(row('Darstellung', sel(o.bands, [['abs', 'relativ zum stärksten Kanal'], ['ref', 'Verhältnis zum Referenzpunkt']], (v) => set({ bands: v as LightPanelOptions['bands'] }))));
  }
  if (p.scope === 'light-trend') {
    rows.push(row('Größe', sel(o.trend, [['all', 'Lux, CCT und Duv'], ['lux', 'nur Lux'], ['cct', 'nur CCT'], ['duv', 'nur Duv']], (v) => set({ trend: v as LightPanelOptions['trend'] }))));
    rows.push(row('Zeitfenster', sel(String(o.window), [['30', '30 s'], ['120', '2 min'], ['600', '10 min'], ['3600', '1 h']], (v) => set({ window: Number(v) }))));
  }
  if (p.scope === 'light-map') {
    rows.push(row('Karte', sel(o.map, [['lux', 'Beleuchtungsstärke'], ['duv', 'Δu′v′ zum Mittel'], ['cct', 'CCT zum Mittel']], (v) => set({ map: v as LightPanelOptions['map'] }))));
    rows.push(h('p', { class: 'hint' }, 'Rastergröße, Punkte aufnehmen und Vergleich: Seitenleiste → Lichtmesser (Opple).'));
  }
  rows.push(h('p', { class: 'hint' }, 'Der Light Master misst einen Wert an einer Stelle (Filtersensor, 6 bzw. 8 Kanäle), kein Bild. Werte sind Trendmessungen.'));
  return rows;
}
