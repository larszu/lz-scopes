// The application menu of LZ Scopes: model (one for page and native menu) and command dispatch.
// Desktop app: the model goes to electron/menu.cjs over the preload bridge and the native menu
// sends the chosen command id back. Browser: src/menu/menubar.ts draws it in the header.

import { isMac, registersNatively, sep, type MenuItem, type TopMenu } from './model';
import { MenuBar } from './menubar';

export const REPO = 'https://github.com/larszu/lz-scopes';
/** Guides in the Help menu. Add new ones here (e.g. the Resolve guide of issue #78). */
export const GUIDES: { id: string; label: string; url: string }[] = [
  { id: 'readme', label: 'Anleitung (README)', url: `${REPO}/blob/main/README.de.md` },
  { id: 'resolve', label: 'Anleitung: DaVinci Resolve als Quelle', url: `${REPO}/issues/78` },
  { id: 'control', label: 'Steuer-API und Companion', url: `${REPO}/blob/main/docs/control-api.md` },
  { id: 'cable', label: 'cable-planner-Anbindung', url: `${REPO}/blob/main/docs/cable-planner-integration.md` },
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
  ['pattern', 'Testbild', ''],
  ['stream', 'RTSP / Netzwerk …', 'RTSP, SRT, HLS, NDI, DeckLink über die Bridge'],
  ['resolve', 'DaVinci Resolve', 'Aktuelles Frame aus dem Resolve-Viewer (Scripting-API, Resolve Studio)'],
  ['webcam', 'Kamera / Capture', 'Kamera oder USB-Capture-Gerät'],
  ['screen', 'Bildschirm / Fenster …', 'z. B. der Viewer eines Programmfensters'],
  ['file', 'Datei …', 'Bild oder Video'],
  ['folder', 'Ordner …', 'neuestes Bild eines Export-Ordners'],
  ['audio', 'Audio', 'Audiogerät, Audiodatei'],
  ['generator', 'Tongenerator', 'Testtöne erzeugen und messen'],
];

export function buildMenu(s: MenuState): TopMenu[] {
  const x = (id: string) => s.extra?.[id] ?? extraItems[id] ?? [];
  const extras = (id: string) => (x(id).length ? [sep(), ...x(id)] : []);
  return [
    {
      id: 'file', label: 'Datei', items: [
        { id: 'layouts', label: 'Layouts …', title: 'Layout-Konfigurationen speichern, laden, exportieren' },
        { id: 'layouts:export', label: 'Layouts exportieren …' },
        { id: 'layouts:import', label: 'Layouts importieren …' },
        sep(),
        { id: 'snapshot', label: 'Screenshot als PNG', accel: 'S' },
        sep(),
        { id: 'settings', label: 'Einstellungen …', accel: 'CmdOrCtrl+,', appMenu: true },
        ...extras('file'),
        { type: 'separator', nativeOnly: true },
        { role: 'quit', label: 'Beenden', nativeOnly: true, appMenu: true },
      ],
    },
    {
      id: 'edit', label: 'Bearbeiten', nativeOnly: true, items: [
        { role: 'undo', label: 'Widerrufen' }, { role: 'redo', label: 'Wiederholen' }, sep(),
        { role: 'cut', label: 'Ausschneiden' }, { role: 'copy', label: 'Kopieren' }, { role: 'paste', label: 'Einsetzen' }, { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      id: 'view', label: 'Ansicht', items: [
        { id: 'sidebar', label: 'Seitenleiste', type: 'checkbox', checked: s.sidebar, accel: 'B' },
        sep(),
        ...s.layouts.map(([k, l], i): MenuItem => ({ id: `layout:${k}`, label: `Layout ${l}`, type: 'radio', checked: s.layout === k, accel: i < 6 ? String(i + 1) : undefined })),
        { id: 'panel:add', label: 'Panel hinzufügen' },
        { id: 'solo:exit', label: 'Solo beenden', accel: 'Escape' },
        sep(),
        { id: 'freeze', label: 'Einfrieren', type: 'checkbox', checked: s.frozen, accel: 'Space' },
        { label: 'Messpunkt', type: 'submenu', submenu: [
          ...s.stages.map(([id, l]): MenuItem => ({ id: `stage:${id}`, label: l, type: 'radio', checked: s.stage === id })),
          sep(), { id: 'stage:next', label: 'Weiterschalten', accel: 'C' },
        ] },
        { label: 'Oberfläche', type: 'submenu', submenu: s.themes.map(([id, l]): MenuItem => ({ id: `theme:${id}`, label: l, type: 'radio', checked: s.theme === id })) },
        sep(),
        { id: 'fullscreen', label: 'Vollbild', accel: 'F' },
        ...extras('view'),
      ],
    },
    {
      id: 'sources', label: 'Quellen', items: [
        ...SOURCE_ITEMS.map(([k, l, t]): MenuItem => ({ id: `source:${k}`, label: l, title: t || undefined })),
        sep(),
        { id: 'settings:bridge', label: 'Bridge und ffmpeg …' },
        ...extras('sources'),
      ],
    },
    {
      id: 'scopes', label: 'Scopes', items: [
        { label: 'Panel hinzufügen', type: 'submenu', submenu: s.scopes.map(([id, l]): MenuItem => ({ id: `scope:${id}`, label: l })) },
        sep(),
        { id: 'settings:scopes', label: 'Darstellung …', title: 'Skala, Spurfarbe, Präzision, Falschfarben, Hautton, Zebra' },
        { id: 'settings:stage', label: 'Messpunkt und ΔE …' },
        ...extras('scopes'),
      ],
    },
    {
      id: 'output', label: 'Ausgabe', items: [
        { id: 'output', label: 'Ausgabe öffnen …', title: 'Gesamtansicht, Panel, Quellbild oder Overlay auf einen Bildschirm oder als Stream' },
        { id: 'output:pattern', label: 'Testbild ausgeben', enabled: s.hasPattern },
        sep(),
        { id: 'led', label: 'LED-Wand …' },
        { id: 'calibration', label: 'Display-Kalibrierung / Verifikation …' },
        ...extras('output'),
      ],
    },
    {
      id: 'window', label: 'Fenster', items: [
        { role: 'minimize', label: 'Minimieren', nativeOnly: true },
        { role: 'zoom', label: 'Zoomen', nativeOnly: true },
        { type: 'separator', nativeOnly: true },
        { id: 'fullscreen', label: 'Vollbild', accel: 'F' },
        ...extras('window'),
        { type: 'separator', nativeOnly: true },
        { role: 'front', label: 'Alle nach vorne bringen', nativeOnly: true },
      ],
    },
    {
      id: 'help', label: 'Hilfe', items: [
        { id: 'settings:keys', label: 'Tastenkürzel' },
        sep(),
        ...GUIDES.map((g): MenuItem => ({ id: `open:${g.id}`, label: g.label })),
        sep(),
        { id: 'open:issues', label: 'Fehler melden …' },
        { id: 'open:licenses', label: 'Lizenzen Dritter' },
        ...extras('help'),
        sep(),
        { id: 'settings:about', label: 'Über LZ Scopes', appMenu: true },
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
    case 'open': { const u = URLS[arg]; if (u) window.open(u, '_blank', 'noopener'); return; }
  }
  a.other?.(id);
}

interface NativeMenu { set: (m: TopMenu[]) => void; onCommand: (cb: (id: string) => void) => void }
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
  if (n) n.set(JSON.parse(JSON.stringify(m)));
  else bar?.set(m);
}

export { registersNatively };
