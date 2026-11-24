// Workspaces (#238): saved layouts as tabs, a link that opens the same workspace on another
// device (iPad, second computer), and embeddable single scopes per URL (?widget=…).
// Pure helpers – no DOM, no app state – so they are unit-tested (test/workspace.test.ts).

import type { ScopeType, Unit } from './graticule';

// ---------------------------------------------------------------- share link

/**
 * A workspace travels in the URL fragment (`#ws=<name>~<payload>`): the fragment never reaches
 * the server, so nothing of it lands in a bridge log. The payload is the layout configuration as
 * JSON, deflate-compressed when the browser has CompressionStream ('z'), plain otherwise ('j'),
 * both base64url. Source addresses are not part of a layout configuration, so the link carries
 * no camera address or password; the other device uses its own sources.
 */
export const SHARE_KEY = 'ws';

const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

const canDeflate = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

/** Encode a workspace (name + configuration) for the URL fragment. */
export async function encodeWorkspace(name: string, config: unknown, compress = canDeflate()): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(config));
  const payload = compress ? `z${b64url(await pipe(json, new CompressionStream('deflate-raw')))}` : `j${b64url(json)}`;
  return `${encodeURIComponent(name)}~${payload}`;
}

/** A layout configuration as it comes out of a link or file: at least panels and a dock. */
export interface SharedConfig { panels: unknown[]; dock: unknown; [k: string]: unknown }

const isConfig = (c: unknown): c is SharedConfig =>
  !!c && typeof c === 'object' && Array.isArray((c as SharedConfig).panels) && (c as SharedConfig).panels.every((p) => !!p && typeof p === 'object')
  && 'dock' in (c as object);

/** Decode `encodeWorkspace`'s output; null when it is not a workspace. */
export async function decodeWorkspace(s: string): Promise<{ name: string; config: SharedConfig } | null> {
  const cut = s.indexOf('~');
  if (cut < 0) return null;
  try {
    const name = decodeURIComponent(s.slice(0, cut)).trim().slice(0, 80);
    const kind = s[cut + 1], body = unb64url(s.slice(cut + 2));
    let bytes: Uint8Array;
    if (kind === 'z') { if (!canDeflate()) return null; bytes = await pipe(body, new DecompressionStream('deflate-raw')); }
    else if (kind === 'j') bytes = body;
    else return null;
    const config: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return name && isConfig(config) ? { name, config } : null;
  } catch { return null; }
}

/** The workspace part of a location hash (`#ws=…`, possibly next to other `&` parameters), or null. */
export function shareFromHash(hash: string): string | null {
  const v = new URLSearchParams(hash.replace(/^#/, '')).get(SHARE_KEY);
  return v || null;
}

/** Link to this app with the workspace in the fragment. `base` is the page URL (query kept, hash replaced). */
export function shareUrl(base: string, encoded: string): string {
  const u = new URL(base);
  u.hash = `${SHARE_KEY}=${encoded}`;
  return u.toString();
}

/** A name that is not taken yet: "Studio", "Studio (2)", "Studio (3)" … */
export function freeName(name: string, taken: Iterable<string>): string {
  const have = new Set(taken);
  if (!have.has(name)) return name;
  for (let i = 2; ; i++) if (!have.has(`${name} (${i})`)) return `${name} (${i})`;
}

/** Next automatic workspace name ("Workspace 1", "Workspace 2" …) for the given prefix. */
export function nextName(prefix: string, taken: Iterable<string>): string {
  const have = new Set(taken);
  for (let i = 1; ; i++) if (!have.has(`${prefix} ${i}`)) return `${prefix} ${i}`;
}

// ---------------------------------------------------------------- embeddable widgets

/**
 * Scopes a widget can show: the ones that measure one source on their own. Scopes that need the
 * app around them (camera tiles, matching, audio, light, timelines) stay in the app.
 */
export const WIDGET_SCOPES: readonly ScopeType[] = [
  'picture', 'wf-luma', 'wf-color', 'wf-rgb', 'parade', 'yrgb', 'ycbcr', 'wf-skin', 'wf-green',
  'vector', 'hls', 'diamond', 'cie', 'satlum', 'hist',
];
export const MAX_WIDGET_SCOPES = 4;

export interface WidgetParams {
  scopes: ScopeType[];
  /** bridge input URL (rtsp://…, decklink:0, ndi:…) or `pattern:<id>` */
  src: string;
  /** bridge WebSocket base; '' = the server that serves this page */
  bridge: string;
  /** a frame-protocol endpoint (docs/frame-protocol.md) instead of src, e.g. ws://host/scope/3 */
  frames: string;
  unit: Unit | '';
  lang: 'de' | 'en' | '';
  /** scope selector above each scope (off by default: a widget is a view, not a tool) */
  selectors: boolean;
}

const UNITS: readonly Unit[] = ['percent', 'bit8', 'bit10', 'nits', 'stop'];

/** Read `?widget=wf-luma,vector&src=…` – unknown scopes are dropped, at most four, default wf-luma. */
export function parseWidget(q: URLSearchParams): WidgetParams {
  const scopes = (q.get('widget') ?? '').split(',').map((s) => s.trim())
    .filter((s): s is ScopeType => (WIDGET_SCOPES as readonly string[]).includes(s)).slice(0, MAX_WIDGET_SCOPES);
  const unit = q.get('unit') ?? '';
  const lang = q.get('lang') ?? '';
  const bridge = q.get('bridge') ?? '', frames = q.get('frames') ?? '';
  return {
    scopes: scopes.length ? scopes : ['wf-luma'],
    src: q.get('src') ?? '',
    bridge: /^wss?:\/\//.test(bridge) ? bridge.replace(/\/$/, '') : '',
    frames: /^wss?:\/\//.test(frames) ? frames : '',
    unit: (UNITS as readonly string[]).includes(unit) ? unit as Unit : '',
    lang: lang === 'de' || lang === 'en' ? lang : '',
    selectors: q.get('selectors') === '1',
  };
}

/** Widget link for a page base URL (query and hash of the base are dropped). */
export function widgetUrl(base: string, p: Partial<WidgetParams> & { scopes: readonly ScopeType[] }): string {
  const u = new URL(base);
  u.search = ''; u.hash = '';
  u.searchParams.set('widget', p.scopes.join(','));
  if (p.src) u.searchParams.set('src', p.src);
  if (p.frames) u.searchParams.set('frames', p.frames);
  if (p.bridge) u.searchParams.set('bridge', p.bridge);
  if (p.unit) u.searchParams.set('unit', p.unit);
  if (p.lang) u.searchParams.set('lang', p.lang);
  if (p.selectors) u.searchParams.set('selectors', '1');
  return u.toString();
}

/** `<iframe>` snippet for a widget link (Companion web buttons, Bridge pages, own pages). */
export const iframeSnippet = (url: string, title: string) =>
  `<iframe src="${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" title="${title.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" width="640" height="360" style="border:0" allow="fullscreen"></iframe>`;
