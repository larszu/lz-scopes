// "Systemprofil mitschalten" (#17): when the display colour space in ⚙ changes, the desktop app
// can switch the operating system's display profile (and optionally the monitor preset via
// DDC/CI) to match. Only in the desktop app (electron/displayProfile.cjs); in the browser this
// section does not appear. The previous profile is restored on quit, on request and after a crash.

import type { DisplaySpace } from './color';

type Res<T> = { ok: true; value: T } | { ok: false; error: string };
interface Display { id: number | string; name: string; current: string | null; custom: string | null; switched?: boolean; builtin?: boolean }
interface Support { platform: string; profiles: boolean; tested: boolean; reason: string; ddc: { tool: string | null; preset: boolean; brightness: boolean; tested: boolean } }
interface Api {
  support: () => Promise<Res<Support>>;
  list: () => Promise<Res<{ displays: Display[]; profiles: { name: string; path: string }[] }>>;
  set: (id: number | string, profile: string) => Promise<Res<Display[]>>;
  restore: (id?: number | string) => Promise<Res<Display[]>>;
  ddc: (id: number | string, code: number, value: number) => Promise<Res<unknown>>;
}
const api = (window as unknown as { lzsDesktop?: { displayProfile?: Api } }).lzsDesktop?.displayProfile;
export const sysProfileAvailable = () => !!api;

type Space = Exclude<DisplaySpace, 'raw'>;
interface Settings { enabled: boolean; display: string; map: Partial<Record<Space, string>> }
const KEY = 'lzs-sysprofile';
const load = (): Settings => {
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? ''); if (s && typeof s === 'object') return { enabled: !!s.enabled, display: String(s.display ?? ''), map: s.map ?? {} }; } catch { /* default */ }
  return { enabled: false, display: '', map: {} };
};
const store = (s: Settings) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ } };

/** Which bundled system profile fits a display space (matched by file name). */
const DEFAULT_NAMES: Record<Space, RegExp> = { srgb: /^srgb( profile| color space profile)?$/i, p3: /^display p3$/i, rec709: /^itu-709$/i };
const SPACE_LABELS: Record<Space, string> = { srgb: 'sRGB', p3: 'Display P3', rec709: 'Rec.709' };
/** VCP 0x14 values (MCCS, as listed by ddcutil – docs/research/systemprofil.md). */
const PRESETS: [number, string][] = [[1, 'sRGB'], [2, 'Nativ'], [3, '4000 K'], [4, '5000 K'], [5, '6500 K'], [6, '7500 K'], [7, '8200 K'], [8, '9300 K'], [9, '10000 K'], [10, '11500 K'], [11, 'User 1'], [12, 'User 2'], [13, 'User 3']];

let cache: { support: Support; displays: Display[]; profiles: { name: string; path: string }[] } | null = null;
let status = '';

async function refresh() {
  if (!api) return;
  const [s, l] = await Promise.all([api.support(), api.list()]);
  if (!s.ok) { status = s.error; return; }
  cache = { support: s.value, displays: l.ok ? l.value.displays : [], profiles: l.ok ? l.value.profiles : [] };
  if (!l.ok) status = l.error;
}

const profileFor = (space: Space, s: Settings) => s.map[space] ?? cache?.profiles.find((p) => DEFAULT_NAMES[space].test(p.name))?.path ?? '';

/**
 * Called when the display space setting changes. `space` null = auto/raw: give the display its
 * previous profile back. Does nothing unless the user switched it on.
 */
export async function applySysProfile(space: DisplaySpace | null): Promise<string> {
  const s = load();
  if (!api || !s.enabled || !s.display) return '';
  if (!cache) await refresh();
  const id = cache?.displays.find((d) => String(d.id) === s.display)?.id ?? s.display;
  const r = !space || space === 'raw' ? await api.restore(id) : await api.set(id, profileFor(space, s));
  status = r.ok ? (!space || space === 'raw' ? 'Vorheriges Profil wiederhergestellt' : `Systemprofil: ${SPACE_LABELS[space as Space]}`) : `Fehler: ${r.error}`;
  if (r.ok && cache) cache.displays = r.value;
  return status;
}

type H = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Record<string, unknown>, ...kids: (Node | string)[]) => HTMLElementTagNameMap[K];

/** ⚙ section. `current` = the display space now in effect (null = auto). */
export function sysProfileSection(h: H, current: () => DisplaySpace | null): HTMLElement {
  const box = h('div', { class: 'sysprofile' });
  const row = (label: string, ...kids: (Node | string)[]) => h('label', { class: 'mrow' }, h('span', {}, label), ...kids);
  const render = () => {
    const s = load();
    const save = (patch: Partial<Settings>) => { Object.assign(s, patch); store(s); };
    if (!cache) { box.replaceChildren(h('p', { class: 'hint' }, 'Systemprofil: lese Bildschirme …')); return; }
    const sup = cache.support;
    if (!sup.profiles) { box.replaceChildren(h('p', { class: 'hint' }, `Systemprofil mitschalten: nicht verfügbar – ${sup.reason}`)); return; }
    const sel = (value: string, opts: [string, string][], on: (v: string) => void) =>
      h('select', { onchange: (e: Event) => on((e.target as HTMLSelectElement).value) }, ...opts.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
    const base = (p: string | null) => (p ? p.split(/[\\/]/).pop()!.replace(/\.ic[cm]$/i, '') : 'Werksprofil');
    if (!s.display && cache.displays.length) save({ display: String(cache.displays[0].id) });
    const disp = cache.displays.find((d) => String(d.id) === s.display);
    const enable = h('input', { type: 'checkbox', checked: s.enabled }) as HTMLInputElement;
    enable.onchange = async () => {
      if (enable.checked && !confirm('Systemprofil mitschalten?\n\nDas Profil gilt für ALLE Programme auf diesem Bildschirm. Nur einschalten, wenn der Monitor wirklich im gewählten Modus läuft (z. B. per OSD auf sRGB/Rec.709). LZ Scopes setzt das vorherige Profil beim Beenden zurück.')) { enable.checked = false; return; }
      save({ enabled: enable.checked });
      status = await applySysProfile(enable.checked ? current() : null);
      render();
    };
    const profOpts: [string, string][] = [['', '– Standard –'], ...cache.profiles.map((p): [string, string] => [p.path, p.name])];
    const kids: (Node | string)[] = [
      h('div', { class: 'mtitle' }, 'Systemprofil'),
      row('Mitschalten', h('label', { class: 'inline' }, enable, 'Display-Profil des Systems passend zum Display-Farbraum setzen')),
      row('Bildschirm', sel(s.display, cache.displays.map((d) => [String(d.id), `${d.name || 'Bildschirm'} – ${base(d.current)}${d.switched ? ' (umgeschaltet)' : ''}`]), (v) => { save({ display: v }); render(); })),
      ...(Object.keys(SPACE_LABELS) as Space[]).map((sp) => row(`Profil ${SPACE_LABELS[sp]}`, sel(s.map[sp] ?? '', profOpts.map(([v, l]) => [v, v ? l : `– Standard: ${base(profileFor(sp, { ...s, map: {} })) || 'keins'} –`]), (v) => { save({ map: { ...s.map, [sp]: v || undefined } }); }))),
      row('', h('button', { class: 'mini', onclick: async () => { status = await applySysProfile(current()); render(); } }, 'Jetzt anwenden'),
        h('button', { class: 'mini', onclick: async () => { const r = await api!.restore(disp?.id); status = r.ok ? 'Vorheriges Profil wiederhergestellt' : `Fehler: ${r.error}`; if (r.ok) cache!.displays = r.value; render(); } }, 'Zurücksetzen')),
      h('p', { class: 'hint' }, `Wirkt auf alle Programme. Zurückgesetzt wird beim Beenden, mit „Zurücksetzen“ und nach einem Absturz beim nächsten Start. ${sup.tested ? 'Geprüft unter macOS (eingebautes Display); externe Displays ungeprüft.' : `Ungeprüft: ${sup.reason}.`} Referenzmodi der Apple-XDR-Displays lassen sich nicht schalten (keine öffentliche API).`),
    ];
    if (sup.ddc.tool) {
      let preset = 1, bright = 50;
      kids.push(h('div', { class: 'mtitle' }, `Monitor per DDC/CI (${sup.ddc.tool}, ungeprüft)`));
      if (sup.ddc.preset) kids.push(row('Farbpreset 0x14', sel('1', PRESETS.map(([v, l]) => [String(v), l]), (v) => (preset = Number(v))),
        h('button', { class: 'mini', onclick: async () => { const r = await api!.ddc(disp?.id ?? s.display, 0x14, preset); status = r.ok ? 'Preset gesendet' : `Fehler: ${r.error}`; render(); } }, 'Senden')));
      if (sup.ddc.brightness) kids.push(row('Helligkeit 0x10', h('input', { type: 'number', class: 'num', min: 0, max: 100, value: bright, onchange: (e: Event) => (bright = Number((e.target as HTMLInputElement).value)) }),
        h('button', { class: 'mini', onclick: async () => { const r = await api!.ddc(disp?.id ?? s.display, 0x10, bright); status = r.ok ? 'Helligkeit gesendet' : `Fehler: ${r.error}`; render(); } }, 'Senden')));
      if (!sup.ddc.preset) kids.push(h('p', { class: 'hint' }, 'Farbpreset (VCP 0x14) ist mit diesem Werkzeug nicht verfügbar.'));
    }
    if (status) kids.push(h('p', { class: `hint${status.startsWith('Fehler') ? ' bad' : ''}` }, status));
    box.replaceChildren(...kids);
  };
  render();
  if (!cache) refresh().then(render);
  return box;
}
