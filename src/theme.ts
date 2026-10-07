// UI skins ("Oberfläche"). Only the chrome changes; scope traces, graticules, false colours and
// measurement colours are identical in every skin. Colours of the main window live in
// src/ui/tokens.css (:root[data-theme=…][data-scheme=…]); output windows do not load it and take
// HUD_STYLE from here.
// Rationale for the neutral default: docs/research/ui-farben.md.

// Signet "lz." of Lars Zumpe Medienproduktion, unchanged files from the brand kit (own trademark).
import signetOffwhite from './brand/lzm_signet_offwhite_1c.svg';
import signetWhite from './brand/lzm_signet_weiss_1c.svg';
import signetNavy from './brand/lzm_signet_navy_1c.svg';
import { t } from './i18n';

export type UiTheme = 'neutral' | 'lzm' | 'original';
export const DEFAULT_THEME: UiTheme = 'neutral';
export const THEMES: [UiTheme, string][] = [
  ['neutral', t('theme.neutral')],
  ['lzm', t('theme.lzm')],
  ['original', t('theme.original')],
];

export const isTheme = (v: unknown): v is UiTheme => v === 'neutral' || v === 'lzm' || v === 'original';

/** Brand kit only allows navy, white or off-white for the logo: white (achromatic) in the neutral skin. */
export const SIGNET: Record<UiTheme, string> = { neutral: signetWhite, lzm: signetOffwhite, original: signetOffwhite };

/** Chrome colours for the output windows (HUD, scene editor bar). */
export const HUD_STYLE: Record<UiTheme, { bg: string; fg: string; muted: string; field: string; line: string; radius: string; font: string }> = {
  neutral: { bg: 'rgba(38,38,38,.9)', fg: '#d6d6d6', muted: '#a8a8a8', field: '#2e2e2e', line: '#474747', radius: '2px', font: "12px 'Public Sans', system-ui, sans-serif" },
  lzm: { bg: 'rgba(19,32,64,.85)', fg: '#F6F5F0', muted: '#8C9CB3', field: '#1D324F', line: 'rgba(246,245,240,.18)', radius: '0', font: "12px 'Public Sans', system-ui, sans-serif" },
  original: { bg: 'rgba(0,0,0,.75)', fg: '#dddddd', muted: '#aaaaaa', field: '#181b1f', line: '#333a41', radius: '4px', font: '12px system-ui' },
};

const STORE_KEY = 'lz-scopes.v1';

/** Skin saved by the main window (output windows share its origin and storage). */
export function storedTheme(): UiTheme {
  try {
    const t = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null')?.theme;
    return isTheme(t) ? t : DEFAULT_THEME;
  } catch { return DEFAULT_THEME; }
}

/** Signet for the current skin and scheme: navy on light chrome (brand kit: navy, white or off-white). */
export function currentSignet(doc: Document = document) {
  const root = doc.documentElement, t = isTheme(root.dataset.theme) ? root.dataset.theme : DEFAULT_THEME;
  return root.dataset.scheme === 'light' && t !== 'original' ? signetNavy : SIGNET[t];
}
const swapSignet = (doc: Document) => doc.querySelectorAll<HTMLImageElement>('img.signet').forEach((img) => { img.src = currentSignet(doc); });

/** Set the skin on <html> and swap the signet variant. */
export function applyTheme(t: UiTheme, doc: Document = document) {
  doc.documentElement.dataset.theme = t;
  swapSignet(doc);
}

/** Light or dark chrome (scopes stay dark). Dark is the default: colour-critical work. */
export type SchemePref = 'dark' | 'light' | 'system';
export const DEFAULT_SCHEME: SchemePref = 'dark';
export const SCHEMES = (): [SchemePref, string][] => [['dark', t('ui.scheme.dark')], ['light', t('ui.scheme.light')], ['system', t('ui.scheme.system')]];
export const isScheme = (v: unknown): v is SchemePref => v === 'dark' || v === 'light' || v === 'system';

let schemeQuery: MediaQueryList | null = null;
/** Set data-scheme (light|dark) on <html>; 'system' follows prefers-color-scheme live. */
export function applyScheme(pref: SchemePref, doc: Document = document) {
  const root = doc.documentElement;
  const set = () => {
    const p = root.dataset.schemePref;
    root.dataset.scheme = p === 'system' ? (schemeQuery?.matches ? 'light' : 'dark') : p === 'light' ? 'light' : 'dark';
    swapSignet(doc);
  };
  if (!schemeQuery && typeof matchMedia === 'function') {
    schemeQuery = matchMedia('(prefers-color-scheme: light)');
    schemeQuery.addEventListener('change', () => { if (root.dataset.schemePref === 'system') set(); });
  }
  root.dataset.schemePref = pref;
  set();
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', root.dataset.scheme === 'light' && root.dataset.theme !== 'original' ? 'light' : 'dark');
}

/** Call fn whenever another window of this app changes the saved skin. */
export function onThemeChange(fn: (t: UiTheme) => void) {
  window.addEventListener('storage', (e) => { if (e.key === STORE_KEY) fn(storedTheme()); });
}
