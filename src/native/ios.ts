// iOS/iPadOS app (Capacitor, ios/): set-up around the unchanged web app. Loaded by boot.ts only
// inside the native shell (window.Capacitor.isNativePlatform()), so the browser and Electron
// bundles never run it. See docs/ios.md and docs/research/ios-app.md.
//
// beforeApp: device class on <html>, viewport, navigator.bluetooth (CoreBluetooth), compact
//            first layout on the iPhone.
// afterApp:  sidebar panel "iPhone/iPad" – bridges found via Bonjour, cameras the system sees
//            (built-in and USB/UVC from iPadOS 17) compared with what WebKit offers.

import './mobile.css';
import { registerPlugin } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';
import { bridgeAddress, normaliseBridgeInput, uniqueBridges, type FoundBridge } from './discovery';
import { createBluetooth } from './webBluetooth';
import { bridgeText } from '../i18n/bridgeMessage';

export interface NativeInfo { idiom: 'pad' | 'phone' | 'mac' | 'other'; system: string; version: string; model: string; iosAppOnMac: boolean; multitasking: boolean }
export interface NativeCamera { id: string; name: string; manufacturer: string; external: boolean; position: string }
interface LzNativePlugin {
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
    if (!gl) { console.warn('[lzs-ios] WebGL2: nicht verfügbar'); return; }
    const want = ['EXT_color_buffer_float', 'EXT_color_buffer_half_float', 'EXT_float_blend', 'OES_texture_float_linear'];
    const have = want.map((e) => `${e}=${gl.getExtension(e) ? 'ja' : 'nein'}`).join(' ');
    console.info(`[lzs-ios] ${info?.idiom ?? '?'} iOS ${info?.version ?? '?'} · WebGL2 ${gl.getParameter(gl.VERSION)} · ${have} · VideoDecoder=${'VideoDecoder' in window ? 'ja' : 'nein'}`);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch (e) { console.warn('[lzs-ios] WebGL2-Abfrage fehlgeschlagen', e); }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]) => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

export function afterApp() {
  const input = document.querySelector<HTMLInputElement>('#bridge');
  const details = input?.closest('details');
  if (!input || !details) return; // UI changed: the panel simply stays away
  input.placeholder = 'z. B. 192.168.1.20:4192';
  // "192.168.1.20:4192" → ws://192.168.1.20:4192 before main.ts reads the field (capture on the parent)
  input.parentElement?.addEventListener('change', (e) => {
    if (e.target === input) input.value = normaliseBridgeInput(input.value);
  }, true);

  const list = el('div', { className: 'lzs-native-list' });
  const note = el('p', { className: 'lzs-native-note' },
    'iPhone/iPad dekodieren kein RTSP/SRT selbst. Die Bridge läuft auf einem Rechner im selben Netz: Desktop-App mit LZS_HOST=0.0.0.0 oder npm start -- --host 0.0.0.0. Sie meldet sich per Bonjour.');
  const search = el('button', { type: 'button', textContent: 'Bridge im Netz suchen' });
  const set = (url: string) => { input.value = url; input.dispatchEvent(new Event('change', { bubbles: true })); };
  const browse = async (auto: boolean) => {
    search.disabled = true; search.textContent = 'Suche …';
    list.replaceChildren(el('span', { className: 'muted', textContent: 'Bonjour: _lz-scopes._tcp …' }));
    const r = await LzNative.browseBridges({ timeout: 3000 }).catch((e: Error) => ({ bridges: [] as FoundBridge[], error: e.message }));
    const found = uniqueBridges(r.bridges);
    console.info(`[lzs-ios] Bonjour: ${found.length} Bridge(s)${r.error ? ` · ${r.error}` : ''}`);
    search.disabled = false; search.textContent = 'Bridge im Netz suchen';
    if (!found.length) {
      list.replaceChildren(el('span', { className: 'muted', textContent: bridgeText(r, 'error') || 'Keine Bridge gefunden. Läuft sie mit --host 0.0.0.0 im selben WLAN? Adresse sonst oben eintragen.' }));
      return;
    }
    list.replaceChildren(...found.map((b) => {
      const url = bridgeAddress(b);
      const btn = el('button', { type: 'button', textContent: `${b.name} · ${url.replace(/^ws:\/\//, '')}`, title: b.host });
      btn.onclick = () => set(url);
      return btn;
    }));
    // empty field and exactly one bridge: take it
    if (auto && !input.value.trim() && found.length === 1) set(bridgeAddress(found[0]));
  };
  search.onclick = () => browse(false);
  details.append(search, list, note);
  if (!input.value.trim()) { details.open = true; void browse(true); }

  addInputsPanel(details);
  markUnavailable();
}

/** Inputs WKWebView cannot offer: say so on the button instead of failing later. */
function markUnavailable() {
  const why: Record<string, string> = {
    'Bildschirm/Fenster': 'Bildschirmaufnahme (getDisplayMedia) gibt es in WKWebView auf iPhone/iPad nicht.',
    'Ordner': 'Ordner beobachten (File System Access) gibt es in WKWebView nicht; einzelne Dateien über „Datei“.',
  };
  document.querySelectorAll<HTMLButtonElement>('#add button').forEach((b) => {
    const reason = why[b.textContent?.trim() ?? ''];
    if (reason) { b.disabled = true; b.title = reason; }
  });
}

/** Cameras the system sees vs. what WebKit's enumerateDevices offers (USB/UVC: iPadOS 17). */
function addInputsPanel(after: Element) {
  const body = el('div', { className: 'lzs-native-list' });
  const wrap = el('details', { className: 'gen' }, el('summary', { textContent: info?.idiom === 'phone' ? 'iPhone: Kameras' : 'iPad: Kameras und USB-Capture' }), body);
  after.before(wrap);
  const refresh = async () => {
    const sys = await LzNative.cameras().catch(() => ({ cameras: [] as NativeCamera[], authorization: 'unknown' }));
    let web: MediaDeviceInfo[] = [];
    try { web = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch { /* none */ }
    const labelled = web.some((d) => d.label);
    const rows = sys.cameras.map((c) => {
      const inWeb = web.some((d) => d.label && d.label === c.name);
      const state = !labelled ? 'Kamera-Freigabe fehlt noch' : inWeb ? 'als Quelle wählbar' : 'von WebKit nicht angeboten';
      return el('div', { className: 'cam' }, el('span', { textContent: `${c.external ? 'USB · ' : ''}${c.name}` }), el('span', { className: 'muted', textContent: state }));
    });
    body.replaceChildren(
      ...(rows.length ? rows : [el('span', { className: 'muted', textContent: 'Keine Kamera gefunden.' })]),
      el('p', { className: 'lzs-native-note', textContent: 'Kamera als Quelle: oben „+ Quelle → Kamera/Capture“. USB-Capture-Karten (UVC) erscheinen ab iPadOS 17, nicht am iPhone. Belegt nur über die WebKit-Dokumentation, mit echter Karte ungeprüft.' }),
    );
  };
  wrap.addEventListener('toggle', () => { if (wrap.open) void refresh(); });
  navigator.mediaDevices?.addEventListener?.('devicechange', () => { if (wrap.open) void refresh(); });
}
