// "Systemprofil mitschalten" (#17): when the display colour space in ⚙ changes, the desktop app
// can switch the operating system's display profile (and optionally the monitor preset via
// DDC/CI) to match. Only in the desktop app (electron/displayProfile.cjs); in the browser this
// section does not appear. The previous profile is restored on quit, on request and after a crash.

import type { DisplaySpace } from './color';
import { hasKey, t } from './i18n';
import { button, checkbox, field, h, hint, kicker, numberInput, select, type Kid } from './ui';

type Res<T> = { ok: true; value: T } | { ok: false; error: string; code?: string };
interface Display { id: number | string; name: string; current: string | null; custom: string | null; switched?: boolean; builtin?: boolean }
interface Support { platform: string; profiles: boolean; tested: boolean; reason: string; reasonCode?: string; ddc: { tool: string | null; preset: boolean; brightness: boolean; tested: boolean } }
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
const PRESETS: [number, string][] = [[1, 'sRGB'], [2, t('sysprofile.native')], [3, '4000 K'], [4, '5000 K'], [5, '6500 K'], [6, '7500 K'], [7, '8200 K'], [8, '9300 K'], [9, '10000 K'], [10, '11500 K'], [11, 'User 1'], [12, 'User 2'], [13, 'User 3']];

/** Main-process messages carry a code (electron/displayProfile.cjs); English text is the fallback. */
const errText = (r: { error: string; code?: string }) => { const k = `sysprofile.err.${r.code}`; return r.code && hasKey(k) ? t(k) : r.error; };
const reasonText = (s: Support) => { const k = `sysprofile.reason.${s.reasonCode}`; return s.reasonCode && hasKey(k) ? t(k) : s.reason; };
const failed = (r: { error: string; code?: string }) => t('sysprofile.error', { msg: errText(r) });
let statusBad = false;

let cache: { support: Support; displays: Display[]; profiles: { name: string; path: string }[] } | null = null;
let status = '';

async function refresh() {
  if (!api) return;
  const [s, l] = await Promise.all([api.support(), api.list()]);
  if (!s.ok) { status = errText(s); return; }
  cache = { support: s.value, displays: l.ok ? l.value.displays : [], profiles: l.ok ? l.value.profiles : [] };
  if (!l.ok) status = errText(l);
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
  status = r.ok ? (!space || space === 'raw' ? t('sysprofile.restored') : t('sysprofile.applied', { space: SPACE_LABELS[space as Space] })) : failed(r);
  statusBad = !r.ok;
  if (r.ok && cache) cache.displays = r.value;
  return status;
}

/** ⚙ section. `current` = the display space now in effect (null = auto). */
export function sysProfileSection(current: () => DisplaySpace | null): HTMLElement {
  const box = h('div', { class: 'sysprofile section' });
  const render = () => {
    const s = load();
    const save = (patch: Partial<Settings>) => { Object.assign(s, patch); store(s); };
    if (!cache) { box.replaceChildren(hint(t('sysprofile.reading'))); return; }
    const sup = cache.support;
    if (!sup.profiles) { box.replaceChildren(hint(t('sysprofile.unavailable', { reason: reasonText(sup) }))); return; }
    const base = (p: string | null) => (p ? p.split(/[\\/]/).pop()!.replace(/\.ic[cm]$/i, '') : t('sysprofile.factory'));
    if (!s.display && cache.displays.length) save({ display: String(cache.displays[0].id) });
    const disp = cache.displays.find((d) => String(d.id) === s.display);
    const enable = checkbox(s.enabled, t('sysprofile.switchLabel'), async (on) => {
      if (on && !confirm(t('sysprofile.confirm'))) { enable.querySelector('input')!.checked = false; return; }
      save({ enabled: on });
      status = await applySysProfile(on ? current() : null);
      render();
    });
    const profOpts: [string, string][] = [['', `– ${t('sysprofile.default')} –`], ...cache.profiles.map((p): [string, string] => [p.path, p.name])];
    const send = (code: number, value: () => number, ok: string) => button(t('sysprofile.send'), async () => {
      const r = await api!.ddc(disp?.id ?? s.display, code, value()); status = r.ok ? ok : failed(r); statusBad = !r.ok; render();
    }, { small: true });
    const kids: Kid[] = [
      kicker(t('sysprofile.title')),
      field(t('sysprofile.switchAlong'), enable),
      field(t('sysprofile.screen'), select(s.display, cache.displays.map((d) => [String(d.id), `${d.name || t('sysprofile.screen')} – ${base(d.current)}${d.switched ? ` ${t('sysprofile.switched')}` : ''}`]), (v) => { save({ display: v }); render(); })),
      ...(Object.keys(SPACE_LABELS) as Space[]).map((sp) => field(t('sysprofile.profileFor', { space: SPACE_LABELS[sp] }), select(s.map[sp] ?? '', profOpts.map(([v, l]) => [v, v ? l : `– ${t('sysprofile.default')}: ${base(profileFor(sp, { ...s, map: {} })) || t('sysprofile.none')} –`]), (v) => { save({ map: { ...s.map, [sp]: v || undefined } }); }))),
      field('', button(t('sysprofile.applyNow'), async () => { status = await applySysProfile(current()); render(); }, { small: true }),
        button(t('sysprofile.reset'), async () => { const r = await api!.restore(disp?.id); status = r.ok ? t('sysprofile.restored') : failed(r); statusBad = !r.ok; if (r.ok) cache!.displays = r.value; render(); }, { small: true })),
      hint(`${t('sysprofile.hint1')} ${sup.tested ? t('sysprofile.testedMac') : t('sysprofile.untested', { reason: reasonText(sup) })} ${t('sysprofile.hintXdr')}`),
    ];
    if (sup.ddc.tool) {
      let preset = 1, bright = 50;
      kids.push(kicker(t('sysprofile.ddcTitle', { tool: sup.ddc.tool })));
      if (sup.ddc.preset) kids.push(field(t('sysprofile.preset'), select('1', PRESETS.map(([v, l]) => [String(v), l]), (v) => (preset = Number(v))), send(0x14, () => preset, t('sysprofile.presetSent'))));
      if (sup.ddc.brightness) kids.push(field(t('sysprofile.brightness'), numberInput(bright, (v) => (bright = v), { min: 0, max: 100, size: 's' }), send(0x10, () => bright, t('sysprofile.brightnessSent'))));
      if (!sup.ddc.preset) kids.push(hint(t('sysprofile.noPreset')));
    }
    if (status) kids.push(h('p', { class: ['hint', statusBad && 'bad'] }, status));
    box.replaceChildren(...(kids.filter(Boolean) as Node[]));
  };
  render();
  if (!cache) refresh().then(render);
  return box;
}
