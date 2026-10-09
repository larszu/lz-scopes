// The application menu of LZ Scopes: model (one for page and native menu) and command dispatch.
// Desktop app: the model goes to electron/menu.cjs over the preload bridge and the native menu
// sends the chosen command id back. Browser: src/menu/menubar.ts draws it in the header.

import { isMac, registersNatively, sep, type MenuItem, type TopMenu } from './model';
import { MenuBar } from './menubar';
import { lang, t } from '../i18n';

export const REPO = 'https://github.com/larszu/lz-scopes';
/** Guides in the Help menu (links). The inputs manual (#78) opens inside the app, see `manual:`. */
export const GUIDES: { id: string; label: string; url: string }[] = [
  { id: 'readme', label: t('menu.guide.readme'), url: `${REPO}/blob/main/${lang() === 'de' ? 'README.de.md' : 'README.md'}` },
  { id: 'control', label: t('menu.guide.control'), url: `${REPO}/blob/main/docs/control-api${lang() === 'de' ? '.de' : ''}.md` },
  { id: 'cable', label: t('menu.guide.cable'), url: `${REPO}/blob/main/docs/cable-planner-integration${lang() === 'de' ? '.de' : ''}.md` },
];

export interface MenuState {
  sidebar: boolean;
  frozen: boolean;
  layout: string;
  layouts: [key: string, label: string][];
  theme: string;
  themes: [id: string, label: string][];
  stage: string;
  stages: [id: string, label: string][];
  scopes: [id: string, label: string][];
  /** pattern source present (Ausgabe → Testbild ausgeben) */
  hasPattern: boolean;
  /** extra menu items registered by other modules, by top menu id */
  extra?: Record<string, MenuItem[]>;
}

export interface MenuActions {
  settings: (page?: string) => void;
  /** in-app manual docs/manual (#78) */
  manual?: (lang: 'de' | 'en') => void;
  layouts: () => void;
  layoutsExport: () => void;
  layoutsImport: () => void;
  snapshot: () => void;
  sidebar: () => void;
  layout: (key: string) => void;
  addPanel: (scope?: string) => void;
  exitSolo: () => void;
  freeze: () => void;
  stageNext: () => void;
  stage: (id: string) => void;
  theme: (id: string) => void;
  fullscreen: () => void;
  addSource: (kind: string) => void;
  output: () => void;
  outputPattern: () => void;
  led: () => void;
  calibration: () => void;
  /** Help → Send Feedback … (src/feedback) */
  feedback?: () => void;
  /** commands added by other modules (registerMenuCommand) */
  other?: (id: string) => boolean;
}

/** Commands of other modules (LED, clock, …) without touching main.ts. */
const extraItems: Record<string, MenuItem[]> = {};
const extraRun = new Map<string, () => void>();
export function registerMenuCommand(menu: string, item: MenuItem, run: () => void) {
  if (!item.id) throw new Error('menu item needs an id');
  (extraItems[menu] ??= []).push(item);
  extraRun.set(item.id, run);
  scheduleRefresh();
}

export const SOURCE_ITEMS: [kind: string, label: string, title: string][] = [
  ['pattern', t('menu.src.pattern'), ''],
  ['stream', t('menu.src.stream'), t('menu.src.streamTitle')],
  ['resolve', 'DaVinci Resolve', t('menu.src.resolveTitle')],
  ['webcam', t('menu.src.webcam'), t('menu.src.webcamTitle')],
  ['screen', t('menu.src.screen'), t('menu.src.screenTitle')],
  ['file', t('menu.src.file'), t('menu.src.fileTitle')],
  ['folder', t('menu.src.folder'), t('menu.src.folderTitle')],
  ['audio', t('menu.src.audio'), t('menu.src.audioTitle')],
  ['generator', t('menu.src.generator'), t('menu.src.generatorTitle')],
];

export function buildMenu(s: MenuState): TopMenu[] {
  const x = (id: string) => s.extra?.[id] ?? extraItems[id] ?? [];
  const extras = (id: string) => (x(id).length ? [sep(), ...x(id)] : []);
  return [
    {
      id: 'file', label: t('menu.file'), items: [
        { id: 'layouts', label: 'Layouts …', title: t('menu.layoutsTitle') },
        { id: 'layouts:export', label: t('menu.layoutsExport') },
        { id: 'layouts:import', label: t('menu.layoutsImport') },
        sep(),
        { id: 'snapshot', label: t('menu.snapshot'), accel: 'S' },
        sep(),
        { id: 'settings', label: t('menu.settings'), accel: 'CmdOrCtrl+,', appMenu: true },
        ...extras('file'),
        { type: 'separator', nativeOnly: true },
        { role: 'quit', label: t('menu.quit'), nativeOnly: true, appMenu: true },
      ],
    },
    {
      id: 'edit', label: t('menu.edit'), nativeOnly: true, items: [
        { role: 'undo', label: t('menu.undo') }, { role: 'redo', label: t('menu.redo') }, sep(),
        { role: 'cut', label: t('menu.cut') }, { role: 'copy', label: t('menu.copy') }, { role: 'paste', label: t('menu.paste') }, { role: 'selectAll', label: t('menu.selectAll') },
      ],
    },
    {
      id: 'view', label: t('menu.view'), items: [
        { id: 'sidebar', label: t('menu.sidebar'), type: 'checkbox', checked: s.sidebar, accel: 'B' },
        sep(),
        ...s.layouts.map(([k, l], i): MenuItem => ({ id: `layout:${k}`, label: t('menu.layoutN', { name: l }), type: 'radio', checked: s.layout === k, accel: i < 6 ? String(i + 1) : undefined })),
        { id: 'panel:add', label: t('menu.addPanel') },
        { id: 'solo:exit', label: t('menu.exitSolo'), accel: 'Escape' },
        sep(),
        { id: 'freeze', label: t('menu.freeze'), type: 'checkbox', checked: s.frozen, accel: 'Space' },
        { label: t('menu.stage'), type: 'submenu', submenu: [
          ...s.stages.map(([id, l]): MenuItem => ({ id: `stage:${id}`, label: l, type: 'radio', checked: s.stage === id })),
          sep(), { id: 'stage:next', label: t('menu.stageNext'), accel: 'C' },
        ] },
        { label: t('menu.theme'), type: 'submenu', submenu: s.themes.map(([id, l]): MenuItem => ({ id: `theme:${id}`, label: l, type: 'radio', checked: s.theme === id })) },
        sep(),
        { id: 'fullscreen', label: t('menu.fullscreen'), accel: 'F' },
        ...extras('view'),
      ],
    },
    {
      id: 'sources', label: t('menu.sources'), items: [
        ...SOURCE_ITEMS.map(([k, l, title]): MenuItem => ({ id: `source:${k}`, label: l, title: title || undefined })),
        sep(),
        { id: 'settings:bridge', label: t('menu.bridge') },
        ...extras('sources'),
      ],
    },
    {
      id: 'scopes', label: t('menu.scopes'), items: [
        { label: t('menu.addPanel'), type: 'submenu', submenu: s.scopes.map(([id, l]): MenuItem => ({ id: `scope:${id}`, label: l })) },
        sep(),
        { id: 'settings:scopes', label: t('menu.scopesDisplay'), title: t('menu.scopesDisplayTitle') },
        { id: 'settings:stage', label: t('menu.stageDe') },
        ...extras('scopes'),
      ],
    },
    {
      id: 'output', label: t('menu.output'), items: [
        { id: 'output', label: t('menu.outputOpen'), title: t('menu.outputOpenTitle') },
        { id: 'output:pattern', label: t('menu.outputPattern'), enabled: s.hasPattern },
        sep(),
        { id: 'led', label: t('menu.led') },
        { id: 'calibration', label: t('menu.calibration') },
        ...extras('output'),
      ],
    },
    {
      id: 'window', label: t('menu.window'), items: [
        { role: 'minimize', label: t('menu.minimize'), nativeOnly: true },
        { role: 'zoom', label: t('menu.zoom'), nativeOnly: true },
        { type: 'separator', nativeOnly: true },
        { id: 'fullscreen', label: t('menu.fullscreen'), accel: 'F' },
        ...extras('window'),
        { type: 'separator', nativeOnly: true },
        { role: 'front', label: t('menu.front'), nativeOnly: true },
      ],
    },
    {
      id: 'help', label: t('menu.help'), items: [
        { id: 'settings:keys', label: t('menu.keys') },
        sep(),
        { id: `manual:${lang()}`, label: t('menu.manual') },
        { id: `manual:${lang() === 'de' ? 'en' : 'de'}`, label: lang() === 'de' ? 'Inputs manual (English)' : 'Anleitung Eingänge (Deutsch)' }, // lang-ok: the other language, named in that language
        ...GUIDES.map((g): MenuItem => ({ id: `open:${g.id}`, label: g.label })),
        sep(),
        { id: 'feedback', label: t('feedback.menu') },
        { id: 'open:licenses', label: t('menu.licenses') },
        ...extras('help'),
        sep(),
        { id: 'settings:about', label: t('menu.about'), appMenu: true },
      ],
    },
  ];
}

export const URLS: Record<string, string> = {
  ...Object.fromEntries(GUIDES.map((g) => [g.id, g.url])),
  issues: `${REPO}/issues`,
  licenses: `${REPO}/blob/main/THIRD_PARTY.md`,
};

/** Run a command id from the page or the native menu. */
export function dispatch(id: string, a: MenuActions) {
  const [cmd, arg] = [id.split(':')[0], id.slice(id.indexOf(':') + 1)];
  const has = id.includes(':');
  if (extraRun.has(id)) { extraRun.get(id)!(); return; }
  switch (cmd) {
    case 'settings': return a.settings(has ? arg : undefined);
    case 'layouts': return id === 'layouts:export' ? a.layoutsExport() : id === 'layouts:import' ? a.layoutsImport() : a.layouts();
    case 'snapshot': return a.snapshot();
    case 'sidebar': return a.sidebar();
    case 'layout': return a.layout(arg);
    case 'panel': return a.addPanel();
    case 'scope': return a.addPanel(arg);
    case 'solo': return a.exitSolo();
    case 'freeze': return a.freeze();
    case 'stage': return arg === 'next' ? a.stageNext() : a.stage(arg);
    case 'theme': return a.theme(arg);
    case 'fullscreen': return a.fullscreen();
    case 'source': return a.addSource(arg);
    case 'output': return has ? a.outputPattern() : a.output();
    case 'led': return a.led();
    case 'calibration': return a.calibration();
    case 'feedback': return a.feedback?.();
    case 'open': { const u = URLS[arg]; if (u) window.open(u, '_blank', 'noopener'); return; }
    case 'manual': return a.manual?.(arg === 'en' ? 'en' : 'de');
  }
  a.other?.(id);
}

interface NativeMenu { set: (m: TopMenu[], lang?: string) => void; onCommand: (cb: (id: string) => void) => void }
const native = (): NativeMenu | undefined => (window as unknown as { lzsDesktop?: { menu?: NativeMenu } }).lzsDesktop?.menu;

let state: (() => MenuState) | null = null;
let bar: MenuBar | null = null;
let pending = 0;
function scheduleRefresh() { if (state && !pending) pending = requestAnimationFrame(() => { pending = 0; refreshMenu(); }); }

/**
 * Mount the menu: native in the desktop app, else into `host` (header, top left).
 * Returns the element of the page menu bar (or null with a native menu).
 */
export function mountMenu(host: HTMLElement, getState: () => MenuState, actions: MenuActions) {
  state = getState;
  const run = (id: string) => dispatch(id, actions);
  const n = native();
  if (n) {
    document.documentElement.classList.add('native-menu');
    n.onCommand(run);
  } else {
    bar = new MenuBar(run);
    host.replaceWith(bar.el);
  }
  // Cmd/Ctrl+, opens the settings; with a native menu the accelerator does it
  document.addEventListener('keydown', (e) => {
    if (n || e.key !== ',' || !(isMac() ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return;
    e.preventDefault();
    actions.settings();
  });
  refreshMenu();
}

/** Rebuild the menu after a state change (checked items). */
export function refreshMenu() {
  if (!state) return;
  const m = buildMenu(state());
  const n = native();
  if (n) n.set(JSON.parse(JSON.stringify(m)), lang());
  else bar?.set(m);
}

export { registersNatively };
