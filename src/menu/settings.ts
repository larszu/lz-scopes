// Central settings window ("Einstellungen …", Cmd/Ctrl+,): one native <dialog> with a list of
// categories on the left, like the settings windows of OBS (General, Stream, Output, Audio,
// Video, Hotkeys, Advanced) and the macOS Settings convention. Panel-specific options stay in
// the panel's ⚙ menu.
//
// Built from the shared modal and tabs (src/ui/). Other modules add their own pages or rows without touching main.ts:
//   registerSettingsSection({ id: 'led', label: t('led.title'), order: 55, render: () => [...] })
//   extendSettingsSection('clock', () => [...])

import { t } from '../i18n';
import { h, kicker, modal, tabs, type Modal } from '../ui';

export interface SettingsSection {
  id: string;
  label: string;
  /** position in the list (10, 20, …) */
  order: number;
  render: () => Node[];
}

const sections = new Map<string, SettingsSection>();
const extras = new Map<string, (() => Node[])[]>();
const LAST_KEY = 'lz-scopes.settings-page';

export function registerSettingsSection(s: SettingsSection) {
  sections.set(s.id, s);
  if (win?.dlg.open) renderNav();
}

export function extendSettingsSection(id: string, render: () => Node[]) {
  const l = extras.get(id) ?? [];
  l.push(render);
  extras.set(id, l);
}

export const settingsSections = () => [...sections.values()].sort((a, b) => a.order - b.order);

let win: Modal | null = null;
let nav: HTMLElement, body: HTMLElement;
let current = '';

function lastPage() {
  try { return localStorage.getItem(LAST_KEY) ?? ''; } catch { return ''; }
}

function build() {
  win = modal({ id: 'settings', title: t('common.settings'), cls: 'settings', size: 'lg' });
  nav = h('div', { class: 'set-nav' });
  body = h('div', { class: 'set-body', role: 'tabpanel' });
  win.setBody(h('div', { class: 'set-main' }, nav, body));
  document.body.append(win.dlg);
}

function renderNav() {
  // a click on a tab rebuilds the list: keep the focus on the (new) selected tab, keep it in view
  const hadFocus = nav.contains(document.activeElement);
  nav.replaceWith(nav = tabs({ items: settingsSections(), current, onSelect: show, label: t('common.settings'), orientation: innerWidth <= 640 ? 'horizontal' : 'vertical' }));
  const on = nav.querySelector<HTMLElement>('[role=tab][aria-selected=true]');
  if (hadFocus) on?.focus();
  // horizontal strip on phones scrolls sideways: show the selected tab (only the strip scrolls)
  if (on && nav.scrollWidth > nav.clientWidth) requestAnimationFrame(() => { nav.scrollLeft = Math.max(0, on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2); });
}

function show(id: string) {
  const s = sections.get(id) ?? settingsSections()[0];
  if (!s) return;
  current = s.id;
  try { localStorage.setItem(LAST_KEY, s.id); } catch { /* ignore */ }
  renderNav();
  body.replaceChildren(kicker(s.label), ...s.render(), ...(extras.get(s.id) ?? []).flatMap((f) => f()));
  body.dataset.page = s.id;
}

/** Open the settings window, optionally on a given page. */
export function openSettings(page?: string) {
  if (!win) build();
  show(page ?? (current || lastPage()));
  win!.open();
}

/** Re-render the visible page (state changed elsewhere, e.g. by the control API). */
export function refreshSettings() {
  if (win?.dlg.open) {
    const scroll = body.scrollTop;
    show(current);
    body.scrollTop = scroll;
  }
}

export const settingsOpen = () => !!win?.dlg.open;
