// Playback of recordings as sources (#140 step 5, server/playback.mjs): opening a take adds one
// source per recording (`rec:<folder>/<take>/<name>`); all of them run on one shared clock
// (src/record/sync.ts PlaybackClock), so the scopes of several cameras show the same recorded
// moment – ghost trace, match matrix and A/B afterwards.

import { t } from '../i18n';
import type { Source } from '../sources';
import { button, h, hint, openModal, row } from '../ui';
import { PlaybackClock, clockText } from './sync';

interface Range { start: number; end: number }
interface Ctx { sources: () => Source[]; bridgeUrl: () => string; addStream: (url: string, name: string) => Source; changed: () => void; hud: (text: string) => void }

let ctx: Ctx | null = null;
export const clock = new PlaybackClock();
const ranges = new Map<string, Range>();
/** sources that already got the clock once after connecting */
const synced = new Set<string>();

export function initPlayback(c: Ctx) {
  ctx = c;
  setInterval(tickUi, 100);
}

export const isPlayback = (s: Source) => s.kind === 'stream' && s.url.startsWith('rec:');
const players = () => (ctx?.sources() ?? []).filter((s) => isPlayback(s) && s.status === 'live');

/** Range of all open recordings on the scene time line. */
export function span(): Range | null {
  const list = players().map((s) => ranges.get(s.id)).filter((r): r is Range => !!r);
  if (!list.length) return null;
  return { start: Math.min(...list.map((r) => r.start)), end: Math.max(...list.map((r) => Math.min(r.end, r.start + 24 * 3600_000))) };
}

/** `playback` message of the bridge (Source.onRecord). */
export function onPlaybackMessage(s: Source, m: Record<string, unknown>) {
  const start = Number(m.start), end = Number(m.end);
  if (Number.isFinite(start) && Number.isFinite(end)) ranges.set(s.id, { start, end });
  if (!synced.has(s.id)) {
    synced.add(s.id);
    // a newly opened recording joins the shared clock; the first one sets it to its start
    if (players().length <= 1 && !clock.playing) clock.seek(start);
    send(s);
  }
  ctx?.changed();
}

function send(s: Source, now = Date.now()) {
  if (clock.playing) s.sendBridge({ type: 'play', t: clock.position(now), at: now, rate: clock.rate });
  else s.sendBridge({ type: 'seek', t: clock.position(now) });
}
function sendAll() { const now = Date.now(); for (const s of players()) send(s, now); tickUi(); }

export function play() { if (!players().length) return false; const r = span(); const now = Date.now(); if (r && clock.position(now) >= r.end) clock.seek(r.start, now); clock.play(now); sendAll(); return true; }
export function pause() { clock.pause(); sendAll(); }
export function toggle() { if (clock.playing) pause(); else play(); }
export function seek(t: number) { clock.seek(t); sendAll(); }
/** Step by frames (25 fps grid of the first source) while paused. */
export function step(n: number) {
  const fps = players()[0]?.info?.fps || 25;
  clock.pause(); clock.seek(clock.position() + (n * 1000) / fps); sendAll();
}
export function toStart() { const r = span(); if (r) seek(r.start); }
export function toEnd() { const r = span(); if (r) seek(r.end); }

export function sourceGone(s: Source) { ranges.delete(s.id); synced.delete(s.id); }

/** Transport control API on recordings (when no video file is the target). */
export function transport(op: string) {
  if (!players().length) return false;
  switch (op) {
    case 'play': play(); break;
    case 'pause': case 'stop': pause(); if (op === 'stop') toStart(); break;
    case 'toggle': toggle(); break;
    case 'next': step(1); break;
    case 'prev': step(-1); break;
    case 'forward': seek(clock.position() + 5000); break;
    case 'rewind': seek(clock.position() - 5000); break;
    case 'start': toStart(); break;
    case 'end': toEnd(); break;
  }
  return true;
}

// ---- UI: transport bar in the sidebar, "open recording" dialog

const slider = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': t('playback.position'), class: 'pb-pos' });
slider.addEventListener('input', () => { const r = span(); if (r) seek(r.start + ((r.end - r.start) * Number(slider.value)) / 1000); });
const timeEl = h('span', { class: 'pb-time' });
const playBtn = button(t('playback.play'), () => toggle(), { small: true, attrs: { 'data-pb': 'play' } });

/** Transport bar for the open recordings; empty without any. */
export function playbackBar(): HTMLElement | null {
  if (!(ctx?.sources() ?? []).some(isPlayback)) return null;
  return h('div', { class: 'pb-bar', role: 'group', 'aria-label': t('playback.title') },
    h('h2', {}, t('playback.title')),
    row(
      button('|◀', () => toStart(), { small: true, title: t('playback.start') }),
      button('◀|', () => step(-1), { small: true, title: t('playback.prev') }),
      playBtn,
      button('|▶', () => step(1), { small: true, title: t('playback.next') }),
    ),
    slider, timeEl,
    hint(t('playback.hint')));
}

function tickUi() {
  const r = span();
  const pos = clock.position();
  playBtn.textContent = clock.playing ? t('playback.pause') : t('playback.play');
  playBtn.setAttribute('aria-pressed', String(clock.playing));
  if (!r) { timeEl.textContent = ''; return; }
  if (document.activeElement !== slider) slider.value = String(Math.round((1000 * (pos - r.start)) / Math.max(1, r.end - r.start)));
  timeEl.textContent = `${clockText(pos)} · ${((pos - r.start) / 1000).toFixed(2)} s / ${((r.end - r.start) / 1000).toFixed(1)} s`;
  if (clock.playing && pos > r.end + 500) { clock.pause(); clock.seek(r.end); tickUi(); }
}

interface Take { root: string; take: string; recordings: { name: string; url: string; source: string; seconds: number; kind: string; startUtcMs: number | null }[] }

/** Dialog: takes in the released folders; open one recording or a whole take. */
export async function openRecordingsDialog() {
  if (!ctx) return;
  let list: Take[] = [];
  try { list = await (await fetch(`${ctx.bridgeUrl().replace(/^ws/, 'http')}/api/recordings`)).json(); } catch { list = []; }
  const open = (recs: Take['recordings'], take: string) => {
    for (const r of recs) if (!ctx!.sources().some((s) => s.url === r.url)) ctx!.addStream(r.url, `${r.source} · ${take}`);
    m.close();
  };
  const m = openModal({
    title: t('playback.dialog'), size: 'md',
    body: list.length ? list.map((tk) => h('div', { class: 'pb-take' },
      row(h('strong', {}, tk.take), h('span', { class: 'hint' }, tk.root), button(t('playback.openAll'), () => open(tk.recordings, tk.take), { small: true, variant: 'primary' })),
      ...tk.recordings.map((r) => row(h('span', {}, `${r.source}`), h('span', { class: 'hint' }, `${r.seconds ? `${r.seconds} s` : ''}${r.kind === 'ring' ? ' · Ring' : ''}`),
        button(t('playback.open'), () => open([r], tk.take), { small: true })))))
      : [hint(t('playback.none'))],
  });
}
