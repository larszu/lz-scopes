// Local recording of the sources (#140 step 5, docs/research/aufzeichnung.md): state per
// source, the controls in the source card and the header, the settings page, control API.
// Bridge sources record inside the bridge (server/recorder.mjs: second output of the
// source's ffmpeg); browser sources with MediaRecorder (src/record/browser.ts), uploaded to
// the same released folder.

import { t } from '../i18n';
import { bridgeMessage } from '../i18n/bridgeMessage';
import type { Source } from '../sources';
import { button, field, h, hint, numberInput, row, select, type Option } from '../ui';
import type { SettingsSection } from '../menu/settings';
import { BrowserRecorder } from './browser';

export type RecordCodec = 'prores' | 'dnxhr' | 'hevc' | 'ffv1';
export interface RecordPrefs { root: string; codec: RecordCodec; container: 'mkv' | 'mov'; segmentMin: number }
export interface RecState {
  state: 'starting' | 'recording' | 'stopped' | 'error';
  take?: string; file?: string; seconds?: number; bytes?: number; segments?: number;
  mode?: string; codec?: string; encoder?: string | null; hardware?: boolean; minutesLeft?: number | null;
  note?: string; warn?: string; message?: string; since: number;
}

const KEY = 'lz-scopes.record';
const DEFAULTS: RecordPrefs = { root: '', codec: 'prores', container: 'mkv', segmentMin: 5 };

export function loadPrefs(): RecordPrefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULTS }; }
}
let prefs = loadPrefs();
function savePrefs() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ } }

/** Take name in local time, same as the bridge's (server/record.mjs takeName). */
export function takeName(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Where a source can be recorded: in the bridge, in the page, or not at all. */
export function recordKind(s: Pick<Source, 'kind' | 'url' | 'status'> & { isVideoFile?: boolean }): 'bridge' | 'browser' | null {
  if (s.status !== 'live') return null;
  if (s.kind === 'stream') return /^(test:|device:|decklink:|ndi:|(rtsps?|rtmps?|rtp|udp|srt|https?|tcp):\/\/)/i.test(s.url) ? 'bridge' : null;
  if (s.kind === 'webcam' || s.kind === 'screen' || s.kind === 'pattern' || (s.kind === 'file' && s.isVideoFile)) return 'browser';
  return null;
}

interface Ctx { sources: () => Source[]; bridgeUrl: () => string; changed: () => void; hud: (text: string) => void; latencyOf: (s: Source) => number | null }
let ctx: Ctx | null = null;
const recs = new Map<string, RecState>();
const browser = new Map<string, { r: BrowserRecorder; sidecar: Record<string, unknown>; stream: MediaStream; own: boolean }>();
let roots: { name: string; free: number | null }[] = [];
let markNo = 0;

export function initRecording(c: Ctx) {
  ctx = c;
  setInterval(tick, 1000);
  refreshRoots();
}

export async function refreshRoots() {
  if (!ctx) return roots;
  try { roots = await (await fetch(`${ctx.bridgeUrl().replace(/^ws/, 'http')}/api/record/roots`)).json(); } catch { roots = []; }
  return roots;
}

/** A recording message of the bridge for this source (Source.onRecord). */
export function onBridgeRecord(s: Source, m: Record<string, unknown>) {
  const prev = recs.get(s.id);
  const st = m.state as RecState['state'] | 'mark';
  if (st === 'mark') return;
  if (st === 'error') {
    recs.set(s.id, { state: 'error', message: bridgeMessage(m as never), since: Date.now() });
    ctx?.hud(t('record.failed', { source: s.name, error: bridgeMessage(m as never) }));
  } else if (st === 'stopped') {
    if (prev?.state === 'recording' || prev?.state === 'starting') recs.delete(s.id);
    if (m.code) ctx?.hud(bridgeMessage(m as never));
  } else {
    recs.set(s.id, { ...(m as object), state: 'recording', note: m.noteCode ? bridgeMessage({ message: String(m.note), code: String(m.noteCode), params: m.noteParams as Record<string, unknown> }) : undefined, since: prev?.since ?? Date.now() } as RecState);
  }
  ctx?.changed();
}

export const recState = (s: Source) => recs.get(s.id) ?? null;
export const isRecording = (s: Source) => { const r = recs.get(s.id); return !!r && (r.state === 'recording' || r.state === 'starting'); };
export const anyRecording = () => !!ctx?.sources().some(isRecording);

function settingsOf(s: Source) {
  return { ...s.settings, effective: { transfer: s.transfer, colorspace: s.colorspace, gamut: s.gamut } };
}

export function startRecording(s: Source, take = takeName()): boolean {
  if (!ctx || isRecording(s)) return false;
  const kind = recordKind(s);
  if (!kind) return false;
  const latencyMs = ctx.latencyOf(s);
  if (kind === 'bridge') {
    const ok = s.sendBridge({
      type: 'record', on: true, root: prefs.root, take, name: s.name, codec: prefs.codec, container: prefs.container,
      segment: Math.round(prefs.segmentMin * 60), settings: settingsOf(s), latencyMs,
    });
    if (!ok) return false;
    recs.set(s.id, { state: 'starting', take, since: Date.now() });
  } else {
    const stream = s.captureStream();
    if (!stream) { ctx.hud(t('record.noStream', { source: s.name })); return false; }
    const r = new BrowserRecorder(stream, { bridge: ctx.bridgeUrl(), root: prefs.root, take, name: s.name }, Math.round(prefs.segmentMin * 60_000));
    const sidecar: Record<string, unknown> = {
      take, source: { name: s.name, kind: s.kind }, settings: settingsOf(s), latencyMs,
      video: { mode: 'mediarecorder', mime: r.mime, width: s.width, height: s.height, bitDepth: 8 },
      start: { utcMs: Date.now(), utc: new Date().toISOString() }, markers: [], events: [], end: null,
    };
    r.onError = (msg) => { recs.set(s.id, { state: 'error', message: msg, since: Date.now() }); browser.delete(s.id); r.stop(); ctx?.hud(t('record.failed', { source: s.name, error: msg })); ctx?.changed(); };
    try { r.start(); } catch { ctx.hud(t('record.noMediaRecorder')); return false; }
    r.sidecar(sidecar);
    browser.set(s.id, { r, sidecar, stream, own: s.kind !== 'webcam' && s.kind !== 'screen' });
    recs.set(s.id, { state: 'recording', take, mode: 'mediarecorder', codec: r.mime, since: Date.now() });
  }
  ctx.changed();
  return true;
}

export function stopRecording(s: Source) {
  const b = browser.get(s.id);
  if (b) {
    browser.delete(s.id);
    b.r.stop({ ...b.sidecar, segments: b.r.parts, end: { utcMs: Date.now(), utc: new Date().toISOString(), reason: 'user' } });
    // tracks made for the recording (canvas, video element) end with it; a camera stream stays
    if (b.own) setTimeout(() => b.stream.getTracks().forEach((tr) => tr.stop()), 1500);
    recs.delete(s.id);
  } else if (isRecording(s)) {
    s.sendBridge({ type: 'record', on: false });
  }
  ctx?.changed();
}

export function toggleRecording(s: Source) { if (isRecording(s)) stopRecording(s); else startRecording(s); }

/** "Record all": every recordable source into one take; stops all when any is running. */
export function recordAll(on = !anyRecording(), list?: Source[]) {
  if (!ctx) return { started: 0, stopped: 0 };
  const all = list ?? ctx.sources();
  let started = 0, stopped = 0;
  const take = takeName();
  for (const s of all) {
    if (on && !isRecording(s) && startRecording(s, take)) started++;
    else if (!on && isRecording(s)) { stopRecording(s); stopped++; }
  }
  return { started, stopped };
}

/** Marker in every running recording (key M, control API record.mark). */
export function markAll(label = '', list?: Source[]) {
  const text = label || `M${++markNo}`;
  let n = 0;
  for (const s of list ?? ctx?.sources() ?? []) {
    if (!isRecording(s)) continue;
    n++;
    const b = browser.get(s.id);
    if (b) {
      const start = (b.sidecar.start as { utcMs: number }).utcMs;
      (b.sidecar.markers as unknown[]).push({ t: (Date.now() - start) / 1000, utcMs: Date.now(), label: text });
      b.r.sidecar(b.sidecar);
    } else s.sendBridge({ type: 'mark', label: text });
  }
  if (n) ctx?.hud(t('record.marked', { label: text, n }));
  return n;
}

/** Event in the companion files (later: paint changes of the closed loop, #140 step 4). */
export function eventAll(kind: string, data: unknown, list?: Source[]) {
  let n = 0;
  for (const s of list ?? ctx?.sources() ?? []) {
    if (!isRecording(s)) continue;
    n++;
    const b = browser.get(s.id);
    if (b) {
      const start = (b.sidecar.start as { utcMs: number }).utcMs;
      (b.sidecar.events as unknown[]).push({ t: (Date.now() - start) / 1000, utcMs: Date.now(), kind, data });
      b.r.sidecar(b.sidecar);
    } else s.sendBridge({ type: 'event', kind, data });
  }
  return n;
}

/** The source is gone or stopped: browser recordings end with it. */
export function sourceStopped(s: Source) {
  if (browser.has(s.id)) stopRecording(s);
  else recs.delete(s.id);
}

const pad = (n: number) => String(n).padStart(2, '0');
export function duration(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${s >= 3600 ? `${Math.floor(s / 3600)}:` : ''}${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const CODEC_LABEL: Record<string, string> = { prores: 'ProRes 422 HQ', dnxhr: 'DNxHR HQX', hevc: 'HEVC 10 bit', ffv1: 'FFV1' };

function statusText(s: Source): string {
  const r = recs.get(s.id);
  if (!r) return '';
  if (r.state === 'error') return r.message ?? '';
  if (r.state === 'starting') return t('record.starting');
  const b = browser.get(s.id);
  const parts = [duration((Date.now() - r.since) / 1000)];
  if (r.mode === 'copy') parts.push(t('record.copy'));
  else if (r.mode === 'mediarecorder') parts.push(`MediaRecorder · ${(r.codec ?? '').split(';')[0]}`);
  else parts.push(`${CODEC_LABEL[r.codec ?? ''] ?? r.codec}${r.encoder && r.codec === 'hevc' ? ` (${r.encoder})` : ''}`);
  const bytes = b ? b.r.bytes : r.bytes ?? 0;
  if (bytes) parts.push(mb(bytes));
  if (r.minutesLeft !== undefined && r.minutesLeft !== null && r.minutesLeft < 60) parts.push(t('record.minutesLeft', { min: r.minutesLeft }));
  if (r.note) parts.push(r.note);
  return parts.join(' · ');
}

/** Record row of a source card; null for sources that cannot be recorded. */
export function recordRow(s: Source): HTMLElement | null {
  const kind = recordKind(s);
  const r = recs.get(s.id);
  if (!kind && !r) return null;
  const on = isRecording(s);
  return row(
    button(h('span', { class: 'rec-label' }, on ? t('record.stop') : t('record.rec')), () => toggleRecording(s),
      { small: true, pressed: on, title: kind === 'browser' ? t('record.titleBrowser') : t('record.title'), attrs: { class: ['btn', 'mini', 'rec', on ? 'on' : ''], 'data-rec': s.id } }),
    h('span', { class: ['rec-status', r?.state === 'error' ? 'bad' : ''], 'data-recstat': s.id, role: r?.state === 'error' ? 'alert' : null }, statusText(s)),
  );
}

/** Header button "record all". */
export const recordAllButton = button(t('record.all'), () => {
  const r = recordAll();
  if (!r.started && !r.stopped) ctx?.hud(t('record.nothing'));
}, { title: t('record.allTitle'), pressed: false, attrs: { id: 'rec-all', class: 'btn rec' } });

function tick() {
  if (!ctx) return;
  for (const s of ctx.sources()) {
    const el = document.querySelector<HTMLElement>(`[data-recstat="${s.id}"]`);
    if (el) el.textContent = statusText(s);
  }
  const on = anyRecording();
  recordAllButton.classList.toggle('on', on);
  recordAllButton.setAttribute('aria-pressed', String(on));
  const first = ctx.sources().map((s) => recs.get(s.id)).find((r) => r?.state === 'recording');
  recordAllButton.textContent = on && first ? `${t('record.allStop')} ${duration((Date.now() - first.since) / 1000)}` : t('record.all');
}

/** State for the control API (Companion feedbacks). */
export function recordingState() {
  const list = (ctx?.sources() ?? []).filter(isRecording);
  return { active: list.length, sources: list.map((s) => ({ name: s.name, id: s.id, seconds: Math.round((Date.now() - (recs.get(s.id)?.since ?? Date.now())) / 1000), take: recs.get(s.id)?.take ?? null })) };
}

/** Settings → Recording. */
export function recordSection(order: number, chooseFolder?: () => Promise<{ name: string } | null>): SettingsSection {
  const body = h('div', {});
  const render = () => {
    const codecs: Option[] = [['prores', 'ProRes 422 HQ (10 bit)'], ['dnxhr', 'DNxHR HQX (10 bit)'], ['hevc', t('record.codec.hevc')], ['ffv1', t('record.codec.ffv1')]];
    const rootOpts: Option[] = roots.length ? roots.map((r) => [r.name, r.free !== null ? `${r.name} · ${Math.round((r.free / 1e9) * 10) / 10} GB ${t('record.free')}` : r.name]) : [['', t('record.noRoot')]];
    body.replaceChildren(
      field(t('record.folder'), select(prefs.root || roots[0]?.name || '', rootOpts, (v) => { prefs.root = v; savePrefs(); }),
        ...(chooseFolder ? [button(t('record.addFolder'), async () => { const r = await chooseFolder(); if (r) { prefs.root = r.name; savePrefs(); await refreshRoots(); render(); } }, { small: true })] : [])),
      hint(t('record.folderHint')),
      field(t('record.codec'), select(prefs.codec, codecs, (v) => { prefs.codec = v as RecordCodec; savePrefs(); })),
      hint(t('record.codecHint')),
      field(t('record.container'), select(prefs.container, [['mkv', 'Matroska (.mkv)'], ['mov', 'QuickTime (.mov)']], (v) => { prefs.container = v as 'mkv' | 'mov'; savePrefs(); })),
      field(t('record.segment'), numberInput(prefs.segmentMin, (v) => { prefs.segmentMin = v; savePrefs(); }, { min: 1, max: 60, clamp: true, size: 's' }), 'min'),
      hint(t('record.segmentHint')),
    );
  };
  return { id: 'record', label: t('record.settings'), order, render: () => { render(); refreshRoots().then(render); return [body]; } };
}
