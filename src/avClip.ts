// “A/V offset from a clip” (#153): drop a phone recording of the test pattern “A/V-Sync” with
// the generator “A/V-Sync-Piep”; the frames are read with requestVideoFrameCallback (mean luma
// of a 64×36 copy, media time as PTS), the sound with decodeAudioData, both from t = 0 of the
// file. Detection: src/audio/dsp/avclip.ts.

import { analyzeClip, type ClipResult } from './audio/dsp/avclip';
import { AV_RATING_TEXT, rateAv } from './audio/dsp/avsync';
import { t } from './i18n';
import { button, filePicker, h, hint, modal, type Modal } from './ui';

let dlg: Modal | null = null;

/** Mean luma 0…1 of a CPU-side frame (Y plane of the YUV formats, BT.709 weights for RGB); null if not readable. */
async function frameLuma(vf: VideoFrame): Promise<number | null> {
  const fmt = vf.format;
  if (!fmt) return null; // GPU-only frame
  const rect = vf.visibleRect!;
  const buf = new Uint8Array(vf.allocationSize());
  const layout = await vf.copyTo(buf);
  const { offset, stride } = layout[0];
  const w = rect.width, hgt = rect.height, sx = Math.max(1, w >> 6), sy = Math.max(1, hgt >> 6);
  let s = 0, n = 0;
  if ((fmt.startsWith('I4') && !/P1[02]/.test(fmt)) || fmt === 'NV12') {
    for (let y = 0; y < hgt; y += sy) for (let x = 0; x < w; x += sx) { s += buf[offset + y * stride + x]; n++; }
  } else if (/^(RGB|BGR)/.test(fmt)) {
    const [r, b] = fmt.startsWith('RGB') ? [0, 2] : [2, 0];
    for (let y = 0; y < hgt; y += sy) for (let x = 0; x < w; x += sx) { const i = offset + y * stride + x * 4; s += 0.2126 * buf[i + r] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + b]; n++; }
  } else return null; // 10/12-bit formats: fall back to the canvas
  return n ? s / (n * 255) : null;
}

async function readFrames(file: File, onProgress: (p: number) => void) {
  const url = URL.createObjectURL(file);
  const v = h('video', { muted: true, playsInline: true, preload: 'auto' });
  v.muted = true; v.src = url;
  try {
    await new Promise<void>((ok, bad) => { v.onloadedmetadata = () => ok(); v.onerror = () => bad(new Error(t('avclip.noVideo'))); });
    const c = h('canvas', { width: 64, height: 36 }), g = c.getContext('2d', { willReadFrequently: true })!;
    const frames: { t: number; y: number }[] = [];
    const pending: Promise<void>[] = [];
    const viaCanvas = () => {
      g.drawImage(v, 0, 0, 64, 36);
      const d = g.getImageData(0, 0, 64, 36).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      return s / (64 * 36 * 255);
    };
    /** Luma of the current frame (CPU copy via WebCodecs, else canvas) and its timestamp in s (NaN if unknown). */
    const luma = async (): Promise<{ y: number; ts: number }> => {
      let vf: VideoFrame | null = null;
      try { vf = typeof VideoFrame === 'function' ? new VideoFrame(v) : null; } catch { vf = null; }
      if (!vf) return { y: viaCanvas(), ts: NaN };
      try { return { y: (await frameLuma(vf)) ?? viaCanvas(), ts: vf.timestamp / 1e6 }; }
      catch { return { y: viaCanvas(), ts: vf.timestamp / 1e6 }; }
      finally { vf.close(); }
    };
    await new Promise<void>((ok, bad) => {
      const grab = (_: number, md: VideoFrameCallbackMetadata) => {
        // Read the decoded frame on the CPU (WebCodecs) where possible: drawing a <video> into a
        // 2D canvas reads back from the GPU, which gives a constant (black) picture under a
        // software GL such as SwiftShader – no flash would ever be seen.
        const tMedia = md.mediaTime;
        pending.push(luma().then(({ y }) => { frames.push({ t: tMedia, y }); }));
        onProgress(v.duration ? tMedia / v.duration : 0);
        if (!v.ended) v.requestVideoFrameCallback(grab);
      };
      v.requestVideoFrameCallback(grab);
      v.onended = () => ok();
      v.play().catch(bad);
    });
    await Promise.all(pending);
    // Playback only reports the frames that were presented. Without a compositor running at
    // the video rate (hidden/occluded window, software GL in CI: 6 callbacks for a 6 s clip)
    // the flash is never seen. Then step through the clip frame by frame with seeks instead
    // (slower, but independent of presentation).
    if (frames.length < v.duration * 10) return await stepFrames(v, luma, onProgress);
    return frames;
  } finally { URL.revokeObjectURL(url); }
}

/** Frame-by-frame reading with seeks; the frame time comes from the decoded frame's timestamp. */
async function stepFrames(v: HTMLVideoElement, luma: () => Promise<{ y: number; ts: number }>, onProgress: (p: number) => void) {
  v.pause();
  const at = async (time: number) => {
    await new Promise<void>((ok) => { v.addEventListener('seeked', () => ok(), { once: true }); v.currentTime = time; });
    const r = await luma();
    return { y: r.y, ts: Number.isFinite(r.ts) ? r.ts : time };
  };
  const frames: { t: number; y: number }[] = [];
  let cur = await at(0);
  frames.push({ t: cur.ts, y: cur.y });
  // frame duration: smallest step that reaches the next frame
  let dur = 0;
  for (let d = 0.004; d < 0.1 && !dur; d += 0.004) { const n = await at(cur.ts + d); if (n.ts > cur.ts + 1e-4) { dur = n.ts - cur.ts; frames.push({ t: n.ts, y: n.y }); cur = n; } }
  if (!dur) return frames;
  while (cur.ts + dur < v.duration) {
    let n = await at(cur.ts + dur * 1.25);
    if (n.ts <= cur.ts + 1e-4) n = await at(cur.ts + dur * 2); // variable frame rate: a longer frame
    if (n.ts <= cur.ts + 1e-4) break;
    frames.push({ t: n.ts, y: n.y });
    cur = n;
    onProgress(cur.ts / v.duration);
  }
  return frames;
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
      h('p', {}, t('avclip.none', { flashes: r.flashes, beeps: r.beeps, frames: r.frameCount, span: (r.lumaSpan * 100).toFixed(1) })),
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
