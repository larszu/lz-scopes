// Central settings window ("Einstellungen …", Cmd/Ctrl+,): one native <dialog> with a list of
// categories on the left, like the settings windows of OBS (General, Stream, Output, Audio,
// Video, Hotkeys, Advanced) and the macOS Settings convention. Panel-specific options stay in
// the panel's ⚙ menu.
//
// Other modules add their own pages or rows without touching main.ts:
//   registerSettingsSection({ id: 'led', label: 'LED-Wand', order: 55, render: () => [...] })
//   extendSettingsSection('clock', () => [...])

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
  if (dlg?.open) renderNav();
}

export function extendSettingsSection(id: string, render: () => Node[]) {
  const l = extras.get(id) ?? [];
  l.push(render);
  extras.set(id, l);
}

export const settingsSections = () => [...sections.values()].sort((a, b) => a.order - b.order);

let dlg: HTMLDialogElement | null = null;
let nav: HTMLElement, body: HTMLElement;
let current = '';

function lastPage() {
  try { return localStorage.getItem(LAST_KEY) ?? ''; } catch { return ''; }
}

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'settings';
  dlg.id = 'settings';
  dlg.setAttribute('aria-label', 'Einstellungen');
  const head = document.createElement('div');
  head.className = 'set-head';
  const title = document.createElement('h2');
  title.textContent = 'Einstellungen';
  const close = document.createElement('button');
  close.className = 'icon';
  close.title = 'Schließen (Esc)';
  close.setAttribute('aria-label', 'Schließen');
  close.textContent = '✕';
  close.onclick = () => dlg!.close();
  head.append(title, close);
  nav = document.createElement('div');
  nav.className = 'set-nav';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-orientation', 'vertical');
  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = settingsSections(), i = list.findIndex((s) => s.id === current);
    const next = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
    show(next.id);
    nav.querySelector<HTMLElement>(`[data-page="${next.id}"]`)?.focus();
  });
  body = document.createElement('div');
  body.className = 'set-body';
  body.setAttribute('role', 'tabpanel');
  const main = document.createElement('div');
  main.className = 'set-main';
  main.append(nav, body);
  dlg.append(head, main);
  // keys typed in the settings must not trigger the global shortcuts (S, F, 1–6 …)
  dlg.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg!.close(); });
  document.body.append(dlg);
}

function renderNav() {
  nav.replaceChildren(...settingsSections().map((s) => {
    const b = document.createElement('button');
    b.className = `set-tab${s.id === current ? ' on' : ''}`;
    b.textContent = s.label;
    b.dataset.page = s.id;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(s.id === current));
    b.tabIndex = s.id === current ? 0 : -1;
    b.onclick = () => show(s.id);
    return b;
  }));
}

function show(id: string) {
  const s = sections.get(id) ?? settingsSections()[0];
  if (!s) return;
  current = s.id;
  try { localStorage.setItem(LAST_KEY, s.id); } catch { /* ignore */ }
  renderNav();
  const h = document.createElement('h3');
  h.className = 'set-kicker';
  h.textContent = s.label;
  body.replaceChildren(h, ...s.render(), ...(extras.get(s.id) ?? []).flatMap((f) => f()));
  body.dataset.page = s.id;
}

/** Open the settings window, optionally on a given page. */
export function openSettings(page?: string) {
  if (!dlg) build();
  show(page ?? (current || lastPage()));
  if (!dlg!.open) dlg!.showModal();
}

/** Re-render the visible page (state changed elsewhere, e.g. by the control API). */
export function refreshSettings() {
  if (dlg?.open) {
    const scroll = body.scrollTop;
    show(current);
    body.scrollTop = scroll;
  }
}

export const settingsOpen = () => !!dlg?.open;
