import { describe, expect, it, vi } from 'vitest';
import { buildMenu, dispatch, type MenuActions, type MenuState } from '../src/menu/appMenu';
import { commandIds, formatAccel, forPage, registersNatively } from '../src/menu/model';
import { SHORTCUTS } from '../src/menu/shortcuts';

const state: MenuState = {
  sidebar: true, frozen: false, layout: 'lc', layouts: [['1', '1'], ['lc', 'Colorist']], theme: 'neutral', themes: [['neutral', 'Neutral'], ['lzm', 'LZM']],
  stage: 'signal', stages: [['signal', 'Signal'], ['cst', 'nach CST']], scopes: [['wf-luma', 'Waveform Luma'], ['hist', 'Histogramm']], hasPattern: true,
};

describe('application menu (#53)', () => {
  it('top menus in HIG order: Datei, Bearbeiten, Ansicht, app menus, Fenster, Hilfe', () => {
    expect(buildMenu(state).map((m) => m.label)).toEqual(['Datei', 'Bearbeiten', 'Ansicht', 'Quellen', 'Scopes', 'Ausgabe', 'Fenster', 'Hilfe']);
  });

  it('page menu drops native-only menus, roles and dangling separators', () => {
    const page = forPage(buildMenu(state));
    expect(page.map((m) => m.id)).not.toContain('edit');
    for (const m of page) {
      expect(m.items[0].type).not.toBe('separator');
      expect(m.items[m.items.length - 1].type).not.toBe('separator');
      expect(m.items.some((i) => i.role && !i.id)).toBe(false);
    }
  });

  it('every command id is dispatched to an action', () => {
    const calls: string[] = [];
    const actions = new Proxy({}, { get: (_t, k) => (...a: unknown[]) => { calls.push(`${String(k)}(${a.join(',')})`); return true; } }) as MenuActions;
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    for (const id of new Set(commandIds(buildMenu(state)))) {
      const before = calls.length + open.mock.calls.length;
      dispatch(id, actions);
      expect(calls.length + open.mock.calls.length, id).toBe(before + 1);
      expect(calls.some((c) => c.startsWith('other(')), id).toBe(false);
    }
    vi.unstubAllGlobals();
  });

  it('Settings opens with Cmd/Ctrl+, and shows the shortcut per platform', () => {
    const settings = buildMenu(state)[0].items.find((i) => i.id === 'settings')!;
    expect(settings.accel).toBe('CmdOrCtrl+,');
    expect(registersNatively(settings.accel!)).toBe(true);
    expect(registersNatively('B')).toBe(false);
    expect(formatAccel('CmdOrCtrl+,', true)).toBe('⌘,');
    expect(formatAccel('CmdOrCtrl+,', false)).toBe('Strg+,');
    expect(formatAccel('Shift+Left', false)).toBe('Umschalt+←');
    expect(formatAccel('Space', true)).toBe('Leertaste');
  });

  it('checkmarks follow the state', () => {
    const view = buildMenu({ ...state, sidebar: false, frozen: true }).find((m) => m.id === 'view')!;
    expect(view.items.find((i) => i.id === 'sidebar')!.checked).toBe(false);
    expect(view.items.find((i) => i.id === 'freeze')!.checked).toBe(true);
    expect(view.items.find((i) => i.id === 'layout:lc')!.checked).toBe(true);
  });

  it('menu shortcuts are documented in the shortcut list', () => {
    const documented = new Set(SHORTCUTS.flatMap((s) => s.keys));
    const accels = commandIds(buildMenu(state)).length && buildMenu(state).flatMap((m) => m.items).filter((i) => i.accel).map((i) => i.accel!);
    for (const a of accels as string[]) expect(documented.has(a), a).toBe(true);
  });
});
