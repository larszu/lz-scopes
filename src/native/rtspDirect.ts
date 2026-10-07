// iOS/iPadOS app: RTSP cameras without a bridge (#90, docs/research/ios-rtsp.md). The native
// package ios/LzRtsp receives RTSP/RTP itself and serves the frame protocol on a loopback
// WebSocket; this module routes rtsp:// sources there (src/streamRoute.ts), moves typed
// credentials into the Keychain and shows the settings section "RTSP direct".

import { t } from '../i18n';
import { button, field, h, hint, segmented } from '../ui';
import type { SettingsSection } from '../menu/settings';
import type { SourceSettings } from '../sources';
import type { streamRoute as StreamRouteApi } from '../streamRoute';

export interface RtspNative {
  rtspServer(): Promise<{ port: number; token: string }>;
  rtspSaveCredentials(o: { url: string; user: string; pass: string }): Promise<{ saved: boolean }>;
  rtspCredentials(): Promise<{ entries: { host: string; port: number; user: string }[] }>;
  rtspForget(o: { host: string; port: number }): Promise<{ removed: boolean }>;
}

const ROUTE_KEY = 'lz-scopes.ios.rtsp';
/** 'direct' (default) or 'bridge' */
export function rtspRoute(): 'direct' | 'bridge' {
  try { return localStorage.getItem(ROUTE_KEY) === 'bridge' ? 'bridge' : 'direct'; } catch { return 'direct'; }
}
function setRtspRoute(v: 'direct' | 'bridge') { try { localStorage.setItem(ROUTE_KEY, v); } catch { /* storage unavailable */ } }

/** Only plain rtsp:// goes direct; rtsps:// (TLS) and everything else keep the bridge. */
export const isDirectUrl = (url: string) => /^rtsp:\/\/[^/]/i.test(url.trim());

/**
 * rtsp://user:pass@host:554/path → { url: 'rtsp://host:554/path', user, pass }. Decodes
 * percent escapes; without credentials `user` is null.
 */
export function splitCredentials(url: string): { url: string; user: string | null; pass: string } {
  const m = /^(rtsp:\/\/)([^@/]*)@(.*)$/i.exec(url.trim());
  if (!m) return { url: url.trim(), user: null, pass: '' };
  const i = m[2].indexOf(':');
  const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
  return { url: m[1] + m[3], user: dec(i < 0 ? m[2] : m[2].slice(0, i)), pass: dec(i < 0 ? '' : m[2].slice(i + 1)) };
}

/** host:port of an rtsp:// URL (default port 554), the Keychain key. */
export function hostKey(url: string): string {
  const m = /^rtsp:\/\/(\[[^\]]+\]|[^:/?#]+)(?::(\d+))?/i.exec(url.trim());
  return m ? `${m[1].toLowerCase()}:${m[2] ?? 554}` : '';
}

/** The loopback frame server URL for one source. */
export function frameUrl(server: { port: number; token: string }, url: string, s: Pick<SourceSettings, 'transport' | 'width'>, webCodecs: string[]): string {
  const q = new URLSearchParams({ token: server.token, url, transport: s.transport ?? 'tcp', width: String(s.width ?? 0), wc: webCodecs.join(',') });
  return `ws://127.0.0.1:${server.port}/rtsp?${q}`;
}

/**
 * Codecs this WebView's WebCodecs decodes (H.264 High, HEVC Main, 8 bit). The native side
 * decodes the rest with VideoToolbox.
 */
export async function webCodecsSupport(): Promise<string[]> {
  if (typeof VideoDecoder === 'undefined') return [];
  const probe = async (codec: string) => { try { return (await VideoDecoder.isConfigSupported({ codec, optimizeForLatency: true })).supported === true; } catch { return false; } };
  const out: string[] = [];
  if (await probe('avc1.640028')) out.push('h264');
  if (await probe('hvc1.1.6.L120.B0')) out.push('hevc');
  return out;
}

export function installRtspDirect(native: RtspNative, route: typeof StreamRouteApi, onSaveError: (msg: string) => void) {
  let server: Promise<{ port: number; token: string }> | null = null;
  let codecs: Promise<string[]> | null = null;
  /** Keychain writes still running, per host:port – a connect waits for them */
  const saving = new Map<string, Promise<unknown>>();

  route.setNormaliser((typed) => {
    if (!isDirectUrl(typed)) return typed;
    const c = splitCredentials(typed);
    if (c.user === null) return c.url;
    const key = hostKey(c.url);
    const p = native.rtspSaveCredentials({ url: c.url, user: c.user, pass: c.pass })
      .then((r) => { if (!r.saved) onSaveError(t('native.rtsp.saveFailed')); })
      .catch(() => onSaveError(t('native.rtsp.saveFailed')))
      .finally(() => saving.delete(key));
    saving.set(key, p);
    return c.url;
  });

  route.set((url, settings) => {
    if (!isDirectUrl(url) || rtspRoute() !== 'direct') return null;
    return (async () => {
      await saving.get(hostKey(url));
      server ??= native.rtspServer().catch((e) => { server = null; throw e; });
      codecs ??= webCodecsSupport();
      const [srv, wc] = await Promise.all([server, codecs]);
      console.info(`[lzs-ios] rtsp-direct: ${hostKey(url)} · WebCodecs ${wc.join('+') || 'none'}`);
      return frameUrl(srv, url, settings, wc);
    })();
  });
}

/** Settings → "RTSP direct": route choice and the Keychain entries (user names only). */
export function rtspSection(native: RtspNative, refresh: () => void, order: number): SettingsSection {
  return { id: 'ios-rtsp', label: t('native.rtsp.section'), order, render: () => {
    const list = h('div', { class: 'lzs-native-list' }, h('span', { class: 'muted' }, t('native.searching')));
    void native.rtspCredentials().then(({ entries }) => {
      list.replaceChildren(...(entries.length
        ? entries.map((e) => h('div', { class: 'cam' }, h('span', {}, `${e.user} @ ${e.host}:${e.port}`),
          button(t('native.rtsp.forget'), () => { void native.rtspForget({ host: e.host, port: e.port }).then(refresh); }, { small: true })))
        : [h('span', { class: 'muted' }, t('native.rtsp.none'))]));
    }).catch(() => list.replaceChildren(h('span', { class: 'muted' }, t('native.rtsp.none'))));
    return [
      field(t('native.rtsp.route'), segmented(rtspRoute(), [['direct', t('native.rtsp.direct')], ['bridge', t('native.rtsp.viaBridge')]], (v) => { setRtspRoute(v as 'direct' | 'bridge'); refresh(); }, t('native.rtsp.route'))),
      hint(t('native.rtsp.hint')),
      field(t('native.rtsp.stored'), list),
      hint(t('native.rtsp.storedHint')),
    ];
  } };
}
