// “A/V offset from a clip” (#153): drop a phone recording of the test pattern “A/V-Sync” with
// the generator “A/V-Sync-Piep”; the frames are read with requestVideoFrameCallback (mean luma
// of a 64×36 copy, media time as PTS), the sound with decodeAudioData, both from t = 0 of the
// file. Detection: src/audio/dsp/avclip.ts.

import { analyzeClip, type ClipResult } from './audio/dsp/avclip';
import { AV_RATING_TEXT, rateAv } from './audio/dsp/avsync';
import { t } from './i18n';
import { button, filePicker, h, hint, modal, type Modal } from './ui';

let dlg: Modal | null = null;

async function readFrames(file: File, onProgress: (p: number) => void) {
  const url = URL.createObjectURL(file);
  const v = h('video', { muted: true, playsInline: true, preload: 'auto' });
  v.muted = true; v.src = url;
  try {
    await new Promise<void>((ok, bad) => { v.onloadedmetadata = () => ok(); v.onerror = () => bad(new Error(t('avclip.noVideo'))); });
    const c = h('canvas', { width: 64, height: 36 }), g = c.getContext('2d', { willReadFrequently: true })!;
    const frames: { t: number; y: number }[] = [];
    await new Promise<void>((ok, bad) => {
      const grab = (_: number, md: VideoFrameCallbackMetadata) => {
        g.drawImage(v, 0, 0, 64, 36);
        const d = g.getImageData(0, 0, 64, 36).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        frames.push({ t: md.mediaTime, y: s / (64 * 36 * 255) });
        onProgress(v.duration ? md.mediaTime / v.duration : 0);
        if (!v.ended) v.requestVideoFrameCallback(grab);
      };
      v.requestVideoFrameCallback(grab);
      v.onended = () => ok();
      v.play().catch(bad);
    });
    return frames;
  } finally { URL.revokeObjectURL(url); }
}

async function readAudio(file: File) {
  const ctx = new OfflineAudioContext(1, 1, 48000);
  const buf = await ctx.decodeAudioData(await file.arrayBuffer());
  return { fs: buf.sampleRate, ch: Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)) };
}

const sgn = (x: number, d: number) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${Math.abs(x).toFixed(d)}`;

function resultCard(r: ClipResult, name: string) {
  if (r.offsetMs === null || r.frames === null || !r.verdict) {
    return h('div', { class: 'avclip-card bad' },
      h('p', {}, t('avclip.none', { flashes: r.flashes, beeps: r.beeps })),
      r.fps ? hint(t('avclip.fps', { fps: r.fps.toFixed(2) })) : null, hint(t('avclip.howTo')));
  }
  const rating = rateAv(r.offsetMs);
  return h('div', { class: ['avclip-card', r.verdict === 'sync' ? 'ok' : rating === 'unacceptable' ? 'bad' : 'warn'] },
    h('p', { class: 'avclip-verdict' }, t(`avclip.${r.verdict}`)),
    h('p', { class: 'avclip-big' },
      h('span', { 'data-testid': 'avclip-frames' }, t('avclip.frames', { n: sgn(r.frames, 1) })), ' · ',
      h('span', { 'data-testid': 'avclip-ms' }, `${sgn(r.offsetMs, 0)} ms`)),
    h('p', {}, r.verdict === 'sync' ? t('avclip.fixNone') : t(r.verdict === 'early' ? 'avclip.fixEarly' : 'avclip.fixLate', { ms: Math.abs(r.offsetMs).toFixed(0), n: Math.abs(r.frames).toFixed(1) })),
    hint(t('avclip.meta', { name, fps: r.fps!.toFixed(2), pairs: r.pairs, spread: (r.spreadMs ?? 0).toFixed(0) }), ' ', AV_RATING_TEXT[rating]),
    hint(t('avclip.caveat')));
}

async function analyse(file: File, out: HTMLElement) {
  const bar = h('progress', { max: 1, value: 0 });
  out.replaceChildren(hint(t('avclip.reading', { name: file.name })), bar);
  try {
    const [frames, audio] = await Promise.all([readFrames(file, (p) => { bar.value = p; }), readAudio(file)]);
    out.replaceChildren(resultCard(analyzeClip(frames, audio.ch, audio.fs), file.name));
  } catch (e) {
    out.replaceChildren(h('div', { class: 'avclip-card bad' }, h('p', {}, t('avclip.failed', { msg: (e as Error).message || String(e) }))));
  }
}

export function openAvClip() {
  if (!dlg) {
    const out = h('div', { class: 'avclip-out', 'aria-live': 'polite' });
    const pick = filePicker('video/*', ([f]) => { if (f) void analyse(f, out); });
    const zone = h('div', { class: 'avclip-drop', 'data-testid': 'avclip-drop' },
      h('p', {}, t('avclip.drop')),
      button(t('avclip.choose'), () => pick.pick(), { variant: 'primary' }), pick.input);
    zone.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); zone.classList.add('on'); } });
    zone.addEventListener('dragleave', () => zone.classList.remove('on'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('on'); const f = e.dataTransfer?.files[0]; if (f) void analyse(f, out); });
    dlg = modal({ title: t('avclip.title'), id: 'avclip', cls: 'avclip', size: 'md', body: [hint(t('avclip.intro')), zone, out] });
  }
  dlg.open();
}
