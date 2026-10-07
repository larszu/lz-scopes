// iOS/iPadOS app (Capacitor, ios/): set-up around the unchanged web app. Loaded by boot.ts only
// inside the native shell (window.Capacitor.isNativePlatform()), so the browser and Electron
// bundles never run it. See docs/ios.md and docs/research/ios-app.md.
//
// beforeApp: device class on <html>, viewport, navigator.bluetooth (CoreBluetooth), compact
//            first layout on the iPhone.
// afterApp:  Settings → Bridge gets the bridges found via Bonjour (src/bridgeField.ts, no DOM
//            search); Settings → "iPhone/iPad: cameras" compares what the system sees (built-in
//            and USB/UVC from iPadOS 17) with what WebKit offers; rtsp:// sources are received
//            on the device itself (src/native/rtspDirect.ts, #90).

import './mobile.css';
import { registerPlugin } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { bridgeAddress, normaliseBridgeInput, uniqueBridges, type FoundBridge } from './discovery';
import { createBluetooth } from './webBluetooth';
import { bridgeText } from '../i18n/bridgeMessage';
import { t } from '../i18n';
import { button, field, h, hint } from '../ui';
import { bridgeField, type BridgeField } from '../bridgeField';
import { extendSettingsSection, refreshSettings, registerSettingsSection, type SettingsSection } from '../menu/settings';
import { installRtspDirect, rtspSection, type RtspNative } from './rtspDirect';
import { streamRoute } from '../streamRoute';
import { Source } from '../sources';

export interface NativeInfo {
  idiom: 'pad' | 'phone' | 'mac' | 'other'; system: string; version: string; model: string; iosAppOnMac: boolean; multitasking: boolean;
  /** debug builds: RTSP URLs from the launch argument -LzsAutoStreams (simulator test in CI) */
  autoStreams?: string[];
}
export interface NativeCamera { id: string; name: string; manufacturer: string; external: boolean; position: string }
interface LzNativePlugin extends RtspNative {
  info(): Promise<NativeInfo>;
  browseBridges(o: { timeout?: number }): Promise<{ bridges: FoundBridge[]; error?: string; errorCode?: string; errorParams?: Record<string, unknown> }>;
  cameras(): Promise<{ cameras: NativeCamera[]; authorization: string }>;
}
const LzNative = registerPlugin<LzNativePlugin>('LzNative');

const STORE_KEY = 'lz-scopes.v1';
let info: NativeInfo | null = null;

export async function beforeApp() {
  info = await LzNative.info().catch(() => null);
  const html = document.documentElement;
  html.classList.add('lzs-native', 'lzs-ios');
  html.dataset.idiom = info?.idiom ?? 'other';
  document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no');
  if (!(navigator as Navigator & { bluetooth?: unknown }).bluetooth) {
    Object.defineProperty(navigator, 'bluetooth', { value: Object.assign(createBluetooth(BleClient), { native: true }), configurable: true });
  }
  logGpu();
  // first start on the iPhone: picture above waveform, sidebar closed (the iPad keeps the default)
  try {
    if (info?.idiom === 'phone' && !localStorage.getItem(STORE_KEY)) {
      localStorage.setItem(STORE_KEY, JSON.stringify({ panels: [], layout: 'l2v', sidebar: false }));
    }
  } catch { /* storage unavailable */ }
}

/** What this WebView's WebGL2 offers (Xcode/simulator console; docs/research/ios-app.md). */
function logGpu() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) { console.warn('[lzs-ios] WebGL2: not available'); return; }
    const want = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'EXT_float_blend', 'OES_texture_float_linear'];
    const have = want.map((e) => `${e}=${gl.getExtension(e) ? 'yes' : 'no'}`).join(' ');
    console.info(`[lzs-ios] ${info?.idiom ?? '?'} iOS ${info?.version ?? '?'} · WebGL2 ${gl.getParameter(gl.VERSION)} · ${have} · VideoDecoder=${'VideoDecoder' in window ? 'yes' : 'no'}`);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch (e) { console.warn('[lzs-ios] WebGL2 query failed', e); }
}

export interface AfterAppDeps {
  bridge: BridgeField;
  extend: typeof extendSettingsSection;
  register: typeof registerSettingsSection;
  refresh: typeof refreshSettings;
  route?: typeof streamRoute;
}
const DEFAULT_DEPS: AfterAppDeps = { bridge: bridgeField, extend: extendSettingsSection, register: registerSettingsSection, refresh: refreshSettings, route: streamRoute };

/** Bonjour state shown under Settings → Bridge; rendered when the page is shown. */
let searching = false;
let found: FoundBridge[] | null = null;
let failure = '';

export async function browseBridges(d: Pick<AfterAppDeps, 'bridge' | 'refresh'>, auto: boolean) {
  searching = true; d.refresh();
  const r = await LzNative.browseBridges({ timeout: 3000 }).catch((e: Error) => ({ bridges: [] as FoundBridge[], error: e.message }));
  found = uniqueBridges(r.bridges);
  failure = bridgeText(r, 'error');
  console.info(`[lzs-ios] Bonjour: ${found.length} Bridge(s)${'error' in r && r.error ? ` · ${r.error}` : ''}`);
  searching = false;
  // empty field and exactly one bridge: take it
  if (auto && !d.bridge.get().trim() && found.length === 1) d.bridge.set(bridgeAddress(found[0]));
  d.refresh();
}

function bonjourRows(d: AfterAppDeps): Node[] {
  const search = button(searching ? t('native.searching') : t('native.search'), () => void browseBridges(d, false), { disabled: searching });
  const list = h('div', { class: 'lzs-native-list' },
    ...(searching ? [h('span', { class: 'muted' }, 'Bonjour: _lz-scopes._tcp …')]
      : !found ? []
      : found.length ? found.map((b) => {
        const url = bridgeAddress(b);
        return button(`${b.name} · ${url.replace(/^ws:\/\//, '')}`, () => d.bridge.set(url), { title: b.host });
      })
      : [h('span', { class: 'muted' }, failure || t('native.noBridge'))]));
  return [field('', search), list, hint(t('native.note'))];
}

/** Hooks into the settings (bridge address, Bonjour, cameras) through explicit hooks, no DOM search. */
export function afterApp(d: AfterAppDeps = DEFAULT_DEPS) {
  // "192.168.1.20:4192" → ws://192.168.1.20:4192 before it is stored
  d.bridge.setNormaliser(normaliseBridgeInput);
  d.bridge.setPlaceholder(t('native.bridgePh'));
  d.extend('bridge', () => bonjourRows(d));
  d.register(camerasSection(75));
  if (d.route) {
    installRtspDirect(LzNative, d.route, (msg) => alert(msg));
    d.register(rtspSection(LzNative, d.refresh, 74));
    openAutoStreams(d.route);
  }
  navigator.mediaDevices?.addEventListener?.('devicechange', () => d.refresh());
  if (!d.bridge.get().trim()) void browseBridges(d, true);
  markUnavailable();
}

/** Inputs WKWebView cannot offer: say so on the button instead of failing later. */
function markUnavailable() {
  const why: Record<string, string> = { screen: t('native.noScreen'), folder: t('native.noFolder') };
  // buttons are found by data-kind, else by their label in the UI language (main.add.*)
  const byLabel: Record<string, string> = { [t('main.add.screen')]: 'screen', [t('main.add.folder')]: 'folder' };
  document.querySelectorAll<HTMLButtonElement>('#add button').forEach((b) => {
    const reason = why[b.dataset.kind ?? byLabel[b.textContent?.trim() ?? ''] ?? ''];
    if (reason) { b.disabled = true; b.title = reason; }
  });
}

/** Cameras the system sees vs. what WebKit's enumerateDevices offers (USB/UVC: iPadOS 17). */
function camerasSection(order: number): SettingsSection {
  const label = info?.idiom === 'phone' ? t('native.camsPhone') : t('native.camsPad');
  return { id: 'ios-cameras', label, order, render: () => {
    const body = h('div', { class: 'lzs-native-list' }, h('span', { class: 'muted' }, t('native.searching')));
    void (async () => {
      const sys = await LzNative.cameras().catch(() => ({ cameras: [] as NativeCamera[], authorization: 'unknown' }));
      let web: MediaDeviceInfo[] = [];
      try { web = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch { /* none */ }
      const labelled = web.some((d) => d.label);
      const rows = sys.cameras.map((c) => {
        const inWeb = web.some((d) => d.label && d.label === c.name);
        const state = !labelled ? t('native.noPermission') : inWeb ? t('native.selectable') : t('native.notOffered');
        return h('div', { class: 'cam' }, h('span', {}, `${c.external ? 'USB · ' : ''}${c.name}`), h('span', { class: 'muted' }, state));
      });
      body.replaceChildren(...(rows.length ? rows : [h('span', { class: 'muted' }, t('native.noCamera'))]));
    })();
    return [body, hint(t('native.camHint'))];
  } };
}

/**
 * Debug builds: open the RTSP sources given at launch and log, every 5 s, what arrives in the
 * WebView – frame count, size and the R′G′B′ in the middle of the 75 % white bar of SMPTE bars
 * (the iOS workflow checks these lines in the simulator console).
 */
function openAutoStreams(route: typeof streamRoute) {
  const urls = info?.autoStreams ?? [];
  if (!urls.length) return;
  const frames = new Map<Source, number>();
  const prev = Source.onArrive;
  Source.onArrive = (s) => { prev?.(s); frames.set(s, (frames.get(s) ?? 0) + 1); };
  urls.forEach((u, i) => route.add(u, `RTSP ${i + 1}`));
  setInterval(() => {
    for (const [s, n] of frames) {
      const d = s.data, w = s.width, h = s.height;
      let bar = '';
      if (d && w && h) {
        const o = (Math.floor(h / 2) * w + Math.floor(((240 + 205.7 / 2) / 1920) * w)) * 4;
        bar = ` bar75=${d[o]},${d[o + 1]},${d[o + 2]}`;
      }
      console.info(`[lzs-ios] rtsp-direct frames: ${s.name} ${s.status} n=${n} ${w}x${h}${bar} · ${s.message}`);
    }
  }, 5000);
}
