// Source-card controls for inputs that live in the bridge: capture devices (device:…)
// with mode/pixel format, Blackmagic DeckLink through the native helper, and the
// explicit decode matrix of the bridge's Y′CbCr → R′G′B′ step.

import type { Source, SourceSettings } from './sources';
import { t } from './i18n';
import { bridgeText } from './i18n/bridgeMessage';
import { button, h, hint, link, row, select } from './ui';

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
  if (!f || f === 'loading') return h('div', { class: 'row hint' }, t('bridgeui.readingFormats'));
  const d = s.settings.device ?? {};
  const sizes = [...new Set(f.modes.map((m) => `${m.width}x${m.height}`))];
  const rates = [...new Set(f.modes.filter((m) => !d.size || `${m.width}x${m.height}` === d.size).flatMap((m) => [m.fpsMax, m.fpsMin]).filter((r) => r > 0))].sort((a, b) => b - a);
  const set = (patch: Partial<NonNullable<SourceSettings['device']>>) => {
    const device = { ...d, ...patch };
    for (const k of Object.keys(device) as (keyof typeof device)[]) if (!device[k]) delete device[k];
    // deep pixel formats only pay off with 16-bit transport
    ui.upd({ device, ...(patch.pixfmt && DEEP.test(patch.pixfmt) ? { depth: 16 as const } : {}) }, true);
  };
  return row(
    sizes.length ? select(d.size ?? '', [['', `${t('bridgeui.modeAuto')}${f.defaultSize ? ` (${f.defaultSize})` : ''}`], ...sizes.map((x) => [x, x.replace('x', '×')] as [string, string])], (v) => set({ size: v, rate: '' }), t('bridgeui.resolutionTitle')) : '',
    rates.length ? select(d.rate ?? '', [['', 'fps auto'], ...rates.map((r) => [String(r), `${r} fps`] as [string, string])], (v) => set({ rate: v }), t('bridgeui.rateTitle')) : '',
    f.pixfmts.length ? select(d.pixfmt ?? '', [['', `Pixel auto${f.preferred ? ` (${f.preferred})` : ''}`], ...f.pixfmts.map((p) => [p, DEEP.test(p) ? `${p} · >8 bit` : p] as [string, string])], (v) => set({ pixfmt: v }),
      t('bridgeui.pixfmtTitle')) : h('span', { class: 'hint' }, t('bridgeui.noFormatList')));
}

/** Matrix and range the bridge uses for Y′CbCr → R′G′B′ (all bridge sources). */
export function decodeRow(s: Source, ui: BridgeUi): Node | null {
  if (s.kind !== 'stream' || s.url === 'resolve:' || s.url.startsWith('test:')) return null;
  const set = s.settings;
  const auto = (s.info as { decodeMatrix?: string } | null)?.decodeMatrix;
  return row(
    select(set.decodeMatrix ?? 'auto', [['auto', `${t('bridgeui.convAuto')}${auto ? ` (${auto})` : ''}`], ['bt709', t('bridgeui.conv', { m: 'BT.709' })], ['bt601', t('bridgeui.conv', { m: 'BT.601' })], ['bt2020', t('bridgeui.conv', { m: 'BT.2020' })]],
      (v) => ui.upd({ decodeMatrix: v as SourceSettings['decodeMatrix'] }, true), t('bridgeui.matrixTitle')),
    select(set.decodeRange ?? 'auto', [['auto', t('bridgeui.rangeAuto')], ['tv', t('bridgeui.rangeTv')], ['pc', t('bridgeui.rangePc')]],
      (v) => ui.upd({ decodeRange: v as SourceSettings['decodeRange'] }, true), t('bridgeui.rangeTitle')));
}

/** Button that lists capture devices of the bridge's machine (ffmpeg). */
export function deviceButton(ui: BridgeUi): HTMLElement {
  return button(t('bridgeui.device'), async (e: Event) => {
    const btn = e.currentTarget as HTMLElement;
    let list: { name: string; url: string; kind?: string }[] = [];
    try { list = await (await fetch(`${ui.http()}/api/devices`)).json(); } catch { /* bridge missing */ }
    const video = list.filter((d) => d.kind !== 'audio'), audio = list.filter((d) => d.kind === 'audio');
    if (!video.length) { ui.hud(t('bridgeui.noCaptureDevices')); return; }
    // sound to the picture from the same ffmpeg process (#audio=…): A/V timestamps comparable (#24)
    const snd = select('', [['', t('bridgeui.noSound')], ...audio.map((d) => [d.url, t('bridgeui.soundOf', { name: d.name })] as [string, string])], () => {}, t('bridgeui.soundTitle'));
    const guess = audio.find((a) => video.some((v) => v.name === a.name)) ?? audio.find((a) => /capture|hdmi|usb3/i.test(a.name));
    if (guess) snd.value = guess.url;
    btn.replaceWith(select('', [['', t('bridgeui.chooseDevice')], ...video.map((d) => [d.url, d.name] as [string, string])], (v) => {
      if (!v) return;
      // audio:<api>:<name> → #audio=<name> (ALSA: hw:…)
      const a = snd.value.replace(/^audio:[a-z]+:/, '');
      ui.connect(a ? `${v}#audio=${a}` : v, video.find((d) => d.url === v)?.name);
    }), snd);
  }, { small: true, title: t('bridgeui.deviceTitle') });
}

/** DeckLink/UltraStudio via the native helper; says plainly when it is not available. */
export function deckLinkButton(ui: BridgeUi): HTMLElement {
  return button('DeckLink…', async (e: Event) => {
    const btn = e.currentTarget as HTMLElement;
    let st: DeckLinkStatus | null = null;
    try { st = await (await fetch(`${ui.http()}/api/decklink`)).json(); } catch { /* bridge missing */ }
    if (!st) { ui.hud(t('bridgeui.bridgeUnreachable')); return; }
    if (!st.available) { ui.hud(t('bridgeui.decklinkUnavailable', { why: bridgeText(st, 'error') || t('bridgeui.decklinkNeeds') })); return; }
    if (!st.devices.length) { ui.hud(t('bridgeui.noDecklinkDevice')); return; }
    btn.replaceWith(select('', [['', t('bridgeui.chooseDecklink')], ...st.devices.map((d) => [`decklink:${d.index}`, d.name] as [string, string])], (v) => { if (v) ui.connect(v, st!.devices.find((d) => `decklink:${d.index}` === v)?.name); }));
  }, { small: true, title: t('bridgeui.decklinkTitle') });
}

/** 8/10 bit for DeckLink sources. */
export function deckLinkRow(s: Source, ui: BridgeUi): Node | null {
  if (!s.url.startsWith('decklink:')) return null;
  return row(
    select(String(s.settings.deckLinkBits ?? 10), [['10', 'DeckLink 10 bit (v210)'], ['8', 'DeckLink 8 bit (UYVY)']], (v) => ui.upd({ deckLinkBits: Number(v) as 8 | 10, ...(v === '10' ? { depth: 16 as const } : {}) }, true), t('bridgeui.decklinkFormatTitle')),
    h('span', { class: 'hint' }, t('bridgeui.untestedHw')));
}

interface NdiStatus { available: boolean; helper: boolean; runtime: boolean; version?: string; sources: { name: string; url: string }[]; error?: string }

/** NDI SDK licence: link to ndi.video close to where NDI is selected, trademark notice. */
export const NDI_NOTICE = 'NDI® is a registered trademark of Vizrt NDI AB.';
const ndiLink = () => { const a = link('https://ndi.video/', 'ndi.video'); a.title = NDI_NOTICE; return a; };

/** NDI® sources found by the helper on the bridge's machine; says plainly when the runtime is missing. */
export function ndiButton(ui: BridgeUi): HTMLElement {
  return button('NDI®…', async (e: Event) => {
    const btn = e.currentTarget as HTMLElement;
    btn.textContent = 'NDI® …';
    let st: NdiStatus | null = null;
    try { st = await (await fetch(`${ui.http()}/api/ndi`)).json(); } catch { /* bridge missing */ }
    btn.textContent = 'NDI®…';
    if (!st) { ui.hud(t('bridgeui.bridgeUnreachable')); return; }
    if (!st.available) { ui.hud(t('bridgeui.ndiUnavailable', { why: bridgeText(st, 'error') || t('bridgeui.ndiNeeds') })); return; }
    if (!st.sources.length) { ui.hud(t('bridgeui.noNdiSources')); return; }
    btn.replaceWith(select('', [['', t('bridgeui.chooseNdi')], ...st.sources.map((s) => [`ndi:${s.name}`, s.name] as [string, string])], (v) => { if (v) ui.connect(v, v.slice(4).replace(/^.*\((.*)\)$/, '$1').slice(0, 40)); }));
  }, { small: true, title: `${t('bridgeui.ndiTitle')} ${NDI_NOTICE}` });
}

/** Link and trademark notice on NDI sources (NDI SDK licence). */
export function ndiRow(s: Source): Node | null {
  if (!s.url.startsWith('ndi:')) return null;
  return h('div', { class: 'row hint' }, `${t('bridgeui.ndiVia')} · `, ndiLink(), ` · ${NDI_NOTICE}`);
}

/** Watch folders of the bridge (released with --watch-dir, in the desktop app by dialog). */
export function folderButton(ui: BridgeUi, release?: () => Promise<{ name: string; url: string } | null>): HTMLElement {
  return button(t('bridgeui.folder'), async (e: Event) => {
    const btn = e.currentTarget as HTMLElement;
    let list: { name: string; url: string }[] = [];
    try { list = await (await fetch(`${ui.http()}/api/folders`)).json(); } catch { /* bridge missing */ }
    const add = async () => { const r = await release?.(); if (r) ui.connect(r.url, r.name); };
    if (!list.length && !release) { ui.hud(t('bridgeui.noFolders')); return; }
    if (!list.length) { await add(); return; }
    btn.replaceWith(select('', [['', t('bridgeui.chooseFolder')], ...list.map((f) => [f.url, f.name] as [string, string]), ...(release ? [['+', t('bridgeui.releaseFolder')] as [string, string]] : [])],
      (v) => { if (v === '+') add(); else if (v) ui.connect(v, list.find((f) => f.url === v)?.name); }));
  }, { small: true, title: t('bridgeui.folderTitle') });
}

/** How to get stills out of Lightroom, Capture One and Resolve into a watch folder. */
export function STILL_WORKFLOW(): HTMLElement {
  return h('div', {}, ([1, 2, 3, 4, 5] as const).map((n) => hint(t(`bridgeui.still.${n}`))));
}
