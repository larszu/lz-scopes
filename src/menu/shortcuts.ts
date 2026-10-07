import { t } from '../i18n';
// Keyboard shortcuts of the main window: one list for the menu labels, the settings page
// "Keyboard", Help → Keyboard Shortcuts and the README. The keys themselves are handled in
// src/main.ts (keydown) and src/menu/appMenu.ts (Cmd/Ctrl+,).

export interface Shortcut { keys: string[]; what: string; group: string }

export const SHORTCUTS: Shortcut[] = [
  { group: t('keys.g.general'), keys: ['CmdOrCtrl+,'], what: t('keys.settings') },
  { group: t('keys.g.general'), keys: ['F'], what: t('keys.full') },
  { group: t('keys.g.general'), keys: ['S'], what: t('keys.snapshot') },
  { group: t('keys.g.general'), keys: ['B'], what: t('keys.sidebar') },
  { group: t('keys.g.view'), keys: ['1', '2', '3', '4', '5', '6'], what: t('keys.layout') },
  { group: t('keys.g.view'), keys: ['Space'], what: t('keys.freeze') },
  { group: t('keys.g.view'), keys: ['Escape'], what: t('keys.escape') },
  { group: t('keys.g.view'), keys: ['C'], what: t('keys.stage') },
  { group: t('keys.g.video'), keys: ['Left', 'Right'], what: t('keys.frame') },
  { group: t('keys.g.video'), keys: ['Shift+Left', 'Shift+Right'], what: t('keys.second') },
  { group: t('keys.g.video'), keys: ['J', 'K', 'L'], what: t('keys.shuttle') },
  { group: t('keys.g.video'), keys: ['Home', 'End'], what: t('keys.startEnd') },
  { group: t('keys.g.mouse'), keys: [t('keys.dbl')], what: t('keys.dblWhat') },
  { group: t('keys.g.mouse'), keys: [t('keys.wheel')], what: t('keys.wheelWhat') },
  { group: t('keys.g.mouse'), keys: [t('keys.pan')], what: t('keys.panWhat') },
  { group: t('keys.g.mouse'), keys: [t('keys.touch')], what: t('keys.touchWhat') },
  { group: t('keys.g.mouse'), keys: [t('keys.click')], what: t('keys.clickWhat') },
  { group: t('keys.g.mouse'), keys: [t('keys.right')], what: t('keys.rightWhat') },
  { group: t('keys.g.output'), keys: ['F'], what: t('keys.full') },
  { group: t('keys.g.output'), keys: ['E'], what: t('keys.overlay') },
];
