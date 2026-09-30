// Source-card controls for inputs that live in the bridge: capture devices (device:…)
// with mode/pixel format, Blackmagic DeckLink through the native helper, and the
// explicit decode matrix of the bridge's Y′CbCr → R′G′B′ step.

import type { Source, SourceSettings } from './sources';

export interface BridgeUi {
  /** http(s) base of the bridge */
  http: () => string;
  /** set URL + name and connect */
  connect: (url: string, name?: string) => void;
  upd: (patch: Partial<SourceSettings>, reconnect?: boolean) => void;
  hud: (msg: string) => void;
}

interface DeviceFormats { modes: { width: number; height: number; fpsMin: number; fpsMax: number; pixfmt?: string }[]; pixfmts: string[]; preferred: string | null; defaultSize: string | null }
interface DeckLinkStatus { available: boolean; helper: boolean; devices: { index: number; name: string; formatDetection?: boolean }[]; error?: string }

const formatCache = new Map<string, DeviceFormats | 'loading'>();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') e.className = String(v);
    else e.setAttribute(k, String(v));
  }
  e.append(...kids);
  return e;
}
function sel(value: string, options: [string, string][], onchange: (v: string) => void, title = '') {
  const s = el('select', { title }, ...options.map(([v, l]) => el('option', { value: v }, l))) as HTMLSelectElement;
  s.value = value;
  s.onchange = () => onchange(s.value);
  return s;
}

const DEEP = /(p10|p12|p16|p210|p216|y210|v210|48)/;

/** Mode and pixel format of a bridge capture device (lists come from ffmpeg on the bridge's machine). */
export function deviceRow(s: Source, ui: BridgeUi, rerender: () => void): Node | null {
  if (!s.url.startsWith('device:')) return null;
  const f = formatCache.get(s.url);
  if (!f) {
    formatCache.set(s.url, 'loading');
    fetch(`${ui.http()}/api/devices/formats?url=${encodeURIComponent(s.url)}`).then((r) => r.json())
      .then((j: DeviceFormats) => { formatCache.set(s.url, j); rerender(); })
      .catch(() => formatCache.delete(s.url));
  }
  if (!f || f === 'loading') return el('div', { class: 'row hint' }, 'Formate des Geräts werden gelesen …');
  const d = s.settings.device ?? {};
  const sizes = [...new Set(f.modes.map((m) => `${m.width}x${m.height}`))];
  const rates = [...new Set(f.modes.filter((m) => !d.size || `${m.width}x${m.height}` === d.size).flatMap((m) => [m.fpsMax, m.fpsMin]).filter((r) => r > 0))].sort((a, b) => b - a);
  const set = (patch: Partial<NonNullable<SourceSettings['device']>>) => {
    const device = { ...d, ...patch };
    for (const k of Object.keys(device) as (keyof typeof device)[]) if (!device[k]) delete device[k];
    // deep pixel formats only pay off with 16-bit transport
    ui.upd({ device, ...(patch.pixfmt && DEEP.test(patch.pixfmt) ? { depth: 16 as const } : {}) }, true);
  };
  return el('div', { class: 'row' },
    sizes.length ? sel(d.size ?? '', [['', `Modus auto${f.defaultSize ? ` (${f.defaultSize})` : ''}`], ...sizes.map((x) => [x, x.replace('x', '×')] as [string, string])], (v) => set({ size: v, rate: '' }), 'Auflösung des Geräts') : '',
    rates.length ? sel(d.rate ?? '', [['', 'fps auto'], ...rates.map((r) => [String(r), `${r} fps`] as [string, string])], (v) => set({ rate: v }), 'Aufnahmerate des Geräts') : '',
    f.pixfmts.length ? sel(d.pixfmt ?? '', [['', `Pixel auto${f.preferred ? ` (${f.preferred})` : ''}`], ...f.pixfmts.map((p) => [p, DEEP.test(p) ? `${p} · >8 bit` : p] as [string, string])], (v) => set({ pixfmt: v }),
      'Rohformat vom Gerät. 10-/16-bit-Formate bleiben bis zur Messung ohne 8-bit-Rundung (dann 16 bit wählen).') : el('span', { class: 'hint' }, 'Gerät meldet keine Formatliste'));
}

/** Matrix and range the bridge uses for Y′CbCr → R′G′B′ (all bridge sources). */
export function decodeRow(s: Source, ui: BridgeUi): Node | null {
  if (s.kind !== 'stream' || s.url === 'resolve:' || s.url.startsWith('test:')) return null;
  const set = s.settings;
  const auto = (s.info as { decodeMatrix?: string } | null)?.decodeMatrix;
  return el('div', { class: 'row' },
    sel(set.decodeMatrix ?? 'auto', [['auto', `Wandlung auto${auto ? ` (${auto})` : ''}`], ['bt709', 'Wandlung BT.709'], ['bt601', 'Wandlung BT.601'], ['bt2020', 'Wandlung BT.2020']],
      (v) => ui.upd({ decodeMatrix: v as SourceSettings['decodeMatrix'] }, true), 'Matrix der Bridge für Y′CbCr → R′G′B′. auto = Kennzeichnung im Signal, sonst BT.709 über SD und BT.601 bei SD. Fest einstellen, wenn eine Karte oder Kamera falsch oder gar nicht kennzeichnet.'),
    sel(set.decodeRange ?? 'auto', [['auto', 'Pegel auto'], ['tv', 'Pegel begrenzt (64–940)'], ['pc', 'Pegel voll (0–1023)']],
      (v) => ui.upd({ decodeRange: v as SourceSettings['decodeRange'] }, true), 'Wertebereich des Y′CbCr-Signals; auto = Kennzeichnung, sonst begrenzt'));
}

/** Button that lists capture devices of the bridge's machine (ffmpeg). */
export function deviceButton(ui: BridgeUi): HTMLElement {
  return el('button', { class: 'mini', title: 'Capture-Gerät des Bridge-Rechners über ffmpeg (roh, eigene Matrix, auch entfernte Bridges): UVC/AVFoundation/DirectShow/V4L2 – z. B. Magewell, MEI, Blackmagic-Karten mit WDM-/AVFoundation-Treiber', onclick: async (e: Event) => {
    const btn = e.currentTarget as HTMLElement;
    let list: { name: string; url: string }[] = [];
    try { list = await (await fetch(`${ui.http()}/api/devices`)).json(); } catch { /* bridge missing */ }
    if (!list.length) { ui.hud('Keine Capture-Geräte über die Bridge gefunden'); return; }
    btn.replaceWith(sel('', [['', 'Gerät wählen …'], ...list.map((d) => [d.url, d.name] as [string, string])], (v) => { if (v) ui.connect(v, list.find((d) => d.url === v)?.name); }));
  } }, 'Gerät…');
}

/** DeckLink/UltraStudio via the native helper; says plainly when it is not available. */
export function deckLinkButton(ui: BridgeUi): HTMLElement {
  return el('button', { class: 'mini', title: 'Blackmagic DeckLink / UltraStudio über den DeckLink-Helfer (v210 10 bit, Formaterkennung, Timecode, HDR-Kennung). Braucht Blackmagic Desktop Video und einen mit dem DeckLink SDK gebauten Helfer – ungeprüft mit echter Hardware.', onclick: async (e: Event) => {
    const btn = e.currentTarget as HTMLElement;
    let st: DeckLinkStatus | null = null;
    try { st = await (await fetch(`${ui.http()}/api/decklink`)).json(); } catch { /* bridge missing */ }
    if (!st) { ui.hud('Bridge nicht erreichbar'); return; }
    if (!st.available) { ui.hud(`DeckLink nicht verfügbar – ${st.error ?? 'Desktop Video/SDK nötig'}`); return; }
    if (!st.devices.length) { ui.hud('Desktop Video installiert, aber kein DeckLink-Gerät gefunden'); return; }
    btn.replaceWith(sel('', [['', 'DeckLink wählen …'], ...st.devices.map((d) => [`decklink:${d.index}`, d.name] as [string, string])], (v) => { if (v) ui.connect(v, st!.devices.find((d) => `decklink:${d.index}` === v)?.name); }));
  } }, 'DeckLink…');
}

/** 8/10 bit for DeckLink sources. */
export function deckLinkRow(s: Source, ui: BridgeUi): Node | null {
  if (!s.url.startsWith('decklink:')) return null;
  return el('div', { class: 'row' },
    sel(String(s.settings.deckLinkBits ?? 10), [['10', 'DeckLink 10 bit (v210)'], ['8', 'DeckLink 8 bit (UYVY)']], (v) => ui.upd({ deckLinkBits: Number(v) as 8 | 10, ...(v === '10' ? { depth: 16 as const } : {}) }, true), 'Aufnahmeformat der Karte; RGB-4:4:4-Signale kommen immer als 10-bit-RGB'),
    el('span', { class: 'hint' }, 'ungeprüft mit Hardware'));
}

interface NdiStatus { available: boolean; helper: boolean; runtime: boolean; version?: string; sources: { name: string; url: string }[]; error?: string }

/** NDI SDK licence: link to ndi.video close to where NDI is selected, trademark notice. */
export const NDI_NOTICE = 'NDI® is a registered trademark of Vizrt NDI AB.';
const ndiLink = () => el('a', { href: 'https://ndi.video/', target: '_blank', rel: 'noopener', title: NDI_NOTICE }, 'ndi.video');

/** NDI® sources found by the helper on the bridge's machine; says plainly when the runtime is missing. */
export function ndiButton(ui: BridgeUi): HTMLElement {
  return el('button', { class: 'mini', title: `NDI®-Quellen im Netz über den NDI-Helfer der Bridge (8 bit UYVY bzw. 16 bit P216). Braucht die NDI-Runtime (NDI Tools, ndi.video). ${NDI_NOTICE}`, onclick: async (e: Event) => {
    const btn = e.currentTarget as HTMLElement;
    btn.textContent = 'NDI® …';
    let st: NdiStatus | null = null;
    try { st = await (await fetch(`${ui.http()}/api/ndi`)).json(); } catch { /* bridge missing */ }
    btn.textContent = 'NDI®…';
    if (!st) { ui.hud('Bridge nicht erreichbar'); return; }
    if (!st.available) { ui.hud(`NDI nicht verfügbar – ${st.error ?? 'NDI-Runtime nötig (ndi.video)'}`); return; }
    if (!st.sources.length) { ui.hud('Keine NDI-Quellen gefunden'); return; }
    btn.replaceWith(sel('', [['', 'NDI-Quelle wählen …'], ...st.sources.map((s) => [`ndi:${s.name}`, s.name] as [string, string])], (v) => { if (v) ui.connect(v, v.slice(4).replace(/^.*\((.*)\)$/, '$1').slice(0, 40)); }));
  } }, 'NDI®…');
}

/** Link and trademark notice on NDI sources (NDI SDK licence). */
export function ndiRow(s: Source): Node | null {
  if (!s.url.startsWith('ndi:')) return null;
  return el('div', { class: 'row hint' }, 'NDI® über die NDI-Runtime · ', ndiLink(), ` · ${NDI_NOTICE}`);
}
