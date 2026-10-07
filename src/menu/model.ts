import { t } from '../i18n';
// Menu model shared by the in-page menu bar (browser, GitHub Pages) and the native
// application menu of the desktop app (electron/menu.cjs builds it from this JSON).
// Order and names follow the macOS HIG menu bar anatomy (app menu, File, Edit, View,
// app-specific menus, Window, Help); see docs/research/menue.md.

export interface MenuItem {
  /** command id, dispatched by src/menu/appMenu.ts; absent for separators and pure roles */
  id?: string;
  label?: string;
  type?: 'separator' | 'checkbox' | 'radio' | 'submenu';
  checked?: boolean;
  enabled?: boolean;
  /**
   * Shortcut in Electron accelerator syntax ('CmdOrCtrl+,', 'B', 'Space'). Single keys are
   * only shown, never registered (they would swallow typing in input fields); the page's own
   * keydown handler executes them.
   */
  accel?: string;
  /** Electron role (copy, paste, minimize …); such items exist only in the native menu */
  role?: string;
  /** native menu only (roles, Edit menu) */
  nativeOnly?: boolean;
  /** macOS: moved into the app menu (About, Settings …) by electron/menu.cjs */
  appMenu?: boolean;
  submenu?: MenuItem[];
  /** tooltip in the page menu */
  title?: string;
}

export interface TopMenu { id: string; label: string; items: MenuItem[]; nativeOnly?: boolean }

export const sep = (): MenuItem => ({ type: 'separator' });

/** Accelerators with a modifier are registered natively; single keys are display-only. */
export const registersNatively = (accel: string) => /(Cmd|Ctrl|CmdOrCtrl|CommandOrControl|Alt|Option|Super)\+/i.test(accel);

/** Human-readable shortcut: ⌘, on the Mac, Ctrl+, (German: Strg+,) elsewhere. */
export function formatAccel(accel: string, mac: boolean): string {
  const parts = accel.split('+');
  const key = parts.pop() ?? '';
  const keyName: Record<string, string> = { Space: t('key.space'), Escape: 'Esc', Left: '←', Right: '→', Up: '↑', Down: '↓', Home: t('key.home'), End: t('key.end') };
  const k = keyName[key] ?? key;
  const mods = parts.map((m) => {
    const x = m.toLowerCase();
    if (x === 'cmdorctrl' || x === 'commandorcontrol') return mac ? '⌘' : t('key.ctrl');
    if (x === 'cmd' || x === 'command') return '⌘';
    if (x === 'ctrl' || x === 'control') return mac ? '⌃' : t('key.ctrl');
    if (x === 'shift') return mac ? '⇧' : t('key.shift');
    if (x === 'alt' || x === 'option') return mac ? '⌥' : 'Alt+';
    return `${m}+`;
  });
  return mods.join('') + k;
}

/** Drop items the page cannot show (roles, native-only) and separators left dangling. */
export function forPage(menus: TopMenu[]): TopMenu[] {
  const clean = (items: MenuItem[]): MenuItem[] => {
    const out: MenuItem[] = [];
    for (const it of items) {
      if (it.nativeOnly || (it.role && !it.id)) continue;
      if (it.type === 'separator' && (!out.length || out[out.length - 1].type === 'separator')) continue;
      out.push(it.submenu ? { ...it, submenu: clean(it.submenu) } : it);
    }
    while (out.length && out[out.length - 1].type === 'separator') out.pop();
    return out;
  };
  return menus.filter((m) => !m.nativeOnly).map((m) => ({ ...m, items: clean(m.items) })).filter((m) => m.items.length);
}

/** All command ids in a model (for tests: unique, each one handled). */
export function commandIds(menus: TopMenu[]): string[] {
  const ids: string[] = [];
  const walk = (items: MenuItem[]) => items.forEach((it) => { if (it.id) ids.push(it.id); if (it.submenu) walk(it.submenu); });
  menus.forEach((m) => walk(m.items));
  return ids;
}

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
