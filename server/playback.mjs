// Playback of recordings as sources (#140 step 5, docs/research/aufzeichnung.md): a recording
// in a released folder becomes a stream source `rec:<folder>/<take>/<name>` and runs through
// the same scopes as a live source, so ghost trace, match matrix and A/B work afterwards.
//
// Several recordings play in sync on one common clock: the page sends every playback source
// the same scene time T (wall clock ms of the recorded moment) and the wall clock instant at
// which T is shown. Each source maps T into its own file with the companion file's first-frame
// time and measured latency (mediaPosition), decodes from there and the bridge paces the
// frames against the wall clock itself – no `-re`, so all sources share one time base.
//
// Messages from the page on the stream socket:
//   {type:'play', t: <scene ms>, at: <wall ms>, rate?}  {type:'pause', t}  {type:'seek', t}
// Messages to the page: info, frames (protocol 1), {type:'playback', state, t, start, end}.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { FrameAssembler } from './frames.mjs';
import { bmsg, toMsg } from './messages.mjs';
import { concatList } from './ring.mjs';

/** rec:<folder>/<take>/<name> */
export const REC_URL = /^rec:([\w .-]{1,80})\/([\w][\w.-]{0,79})\/([\p{L}\p{N}_.-]{1,80})$/u;

/** Media position (s) in a recording for scene time `t` (wall ms): first frame at start.utcMs, shown `latencyMs` late. */
export function mediaPosition(t, startUtcMs, latencyMs = 0) {
  return (t - startUtcMs + (Number.isFinite(latencyMs) ? latencyMs : 0)) / 1000;
}

/** Scene time (wall ms) of a media position – the inverse of mediaPosition. */
export function sceneTime(pos, startUtcMs, latencyMs = 0) {
  return startUtcMs + pos * 1000 - (Number.isFinite(latencyMs) ? latencyMs : 0);
}

/** Wall clock instant at which frame n (0-based, after a start at media `pos0`) is due: clock anchor (t0 at wall at0), rate. */
export function frameDue(n, { pos0, fps, startUtcMs, latencyMs = 0, t0, at0, rate = 1 }) {
  const t = sceneTime(pos0 + n / fps, startUtcMs, latencyMs);
  return at0 + (t - t0) / rate;
}

/** A recording folder's file → its segments for playback (companion file order), or null. */
export function resolveRecording(url, roots) {
  const m = REC_URL.exec(url ?? '');
  if (!m) return null;
  const root = roots.find((r) => r.name === m[1]);
  if (!root) return null;
  const dir = resolve(root.dir, m[2]);
  if (!dir.startsWith(root.dir + sep)) return null;
  const json = join(dir, `${m[3]}.json`);
  if (!existsSync(json)) return null;
  let meta;
  try { meta = JSON.parse(readFileSync(json, 'utf8')); } catch { return null; }
  if (meta?.format !== 'lz-scopes-recording') return null;
  const files = (meta.segments ?? []).map((s) => (typeof s === 'string' ? s : s.file)).filter((f) => typeof f === 'string' && !f.includes('/') && !f.includes('\\') && existsSync(join(dir, f)));
  if (!files.length) return null;
  return { dir, name: m[3], meta, files: files.map((f) => join(dir, f)), startUtcMs: Number(meta.start?.utcMs ?? meta.start?.requestedUtcMs ?? 0), latencyMs: Number(meta.latencyMs) || 0 };
}

/** Takes in the released folders: [{ root, take, recordings: [{ name, url, source, startUtcMs, seconds, kind }] }], newest first. */
export function listRecordings(roots, limit = 50) {
  const out = [];
  for (const root of roots) {
    let takes = [];
    try { takes = readdirSync(root.dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch { continue; }
    for (const take of takes) {
      const dir = join(root.dir, take);
      const recordings = [];
      let files = [];
      try { files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp')); } catch { continue; }
      for (const f of files) {
        try {
          const meta = JSON.parse(readFileSync(join(dir, f), 'utf8'));
          if (meta?.format !== 'lz-scopes-recording') continue;
          const name = f.slice(0, -5);
          const segs = meta.segments ?? [];
          const seconds = segs.reduce((a, s) => a + Math.max(0, (Number(s.end) || 0) - (Number(s.start) || 0)), 0);
          recordings.push({ name, url: `rec:${root.name}/${take}/${name}`, source: meta.source?.name ?? name, startUtcMs: meta.start?.utcMs ?? null, seconds: Math.round(seconds * 10) / 10, kind: meta.kind ?? (meta.video?.mode === 'mediarecorder' ? 'browser' : 'bridge') });
        } catch { /* skip */ }
      }
      if (recordings.length) out.push({ root: root.name, take, recordings, mtime: statSync(dir).mtimeMs });
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, limit).map(({ mtime: _m, ...x }) => x);
}

function probeFile(ffprobe, file) {
  return new Promise((ok) => {
    const p = spawn(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,pix_fmt,avg_frame_rate,r_frame_rate,color_transfer,color_primaries,color_space,color_range', '-of', 'json', file], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => ok(null));
    p.on('close', () => {
      try {
        const s = JSON.parse(out).streams?.[0];
        const rate = (r) => { const [n, d] = String(r ?? '0/1').split('/').map(Number); return d ? n / d : 0; };
        ok(s ? { width: s.width, height: s.height, codec: s.codec_name, pixFmt: s.pix_fmt, fps: rate(s.avg_frame_rate) || rate(s.r_frame_rate) || 25, transfer: s.color_transfer ?? 'unknown', primaries: s.color_primaries ?? 'unknown', matrix: s.color_space ?? 'unknown', range: s.color_range ?? 'unknown' } : null);
      } catch { ok(null); }
    });
  });
}

/**
 * Stream a recording to a WebSocket (frame protocol 1), paced on the common clock.
 * ctx: { ffmpeg, ffprobe, roots, fail, outputSize, decodeParams, applyDecodeOverride, deviceOptions }
 */
export async function startPlayback(ws, params, url, ctx) {
  const rec = resolveRecording(url, ctx.roots());
  if (!rec) return ctx.fail(ws, bmsg('playback.notFound', 'Recording not found in a released folder'));
  const info = ctx.ffprobe ? await probeFile(ctx.ffprobe, rec.files[0]) : null;
  if (!info) return ctx.fail(ws, bmsg('playback.unreadable', 'Recording cannot be read (ffprobe)'));
  // MediaRecorder WebM has no fixed frame rate (ffprobe reports the 1 kHz time base): pace at 30 fps
  if (!(info.fps > 0 && info.fps <= 120)) info.fps = 30;
  if (ws.readyState !== ws.OPEN) return;
  const depth = params.get('depth') === '16' || params.get('format') === 'yuv' ? 16 : 8;
  const maxWidth = Math.min(3840, Math.max(0, Number(params.get('width') ?? 960) || 0));
  const { width, height } = ctx.outputSize(info.width, info.height, maxWidth);
  const { decodeMatrix, decodeRange } = ctx.applyDecodeOverride(ctx.decodeParams(info), ctx.deviceOptions(params));
  const bytes = width * height * 4 * (depth / 8);
  // MediaRecorder files carry no segment times: unknown length, playback simply runs to the end
  const duration = (rec.meta.segments ?? []).reduce((a, s) => a + Math.max(0, (Number(s.end) || 0) - (Number(s.start) || 0)), 0) || 24 * 3600;
  const tmp = await mkdtemp(join(tmpdir(), 'lzs-play-'));
  const list = join(tmp, 'list.txt');
  await writeFile(list, concatList(rec.files.map((path) => ({ path }))));
  ws.send(JSON.stringify({
    type: 'info', width, height, depth, fps: info.fps, sourceWidth: info.width, sourceHeight: info.height, sourceFps: info.fps,
    codec: `${info.codec} · ${rec.meta.source?.name ?? rec.name}`, pixFmt: info.pixFmt, decodeMatrix,
    transfer: info.transfer, primaries: info.primaries, matrix: info.matrix, range: info.range,
    ...(rec.meta.start?.timecode ? { timecode: rec.meta.start.timecode } : {}),
    playback: { startUtcMs: rec.startUtcMs, latencyMs: rec.latencyMs, duration, settings: rec.meta.settings ?? null, markers: rec.meta.markers ?? [], events: rec.meta.events ?? [] },
  }));

  let ff = null, asm = null, queue = [], n = 0, clock = null, pos0 = 0, timer = null, closed = false, sent = 0, dropped = 0;
  const startUtc = sceneTime(0, rec.startUtcMs, rec.latencyMs);
  const endUtc = sceneTime(duration, rec.startUtcMs, rec.latencyMs);
  const state = (s, t) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'playback', state: s, t, start: startUtc, end: endUtc })); };
  const stop = () => {
    clearInterval(timer); timer = null; queue = [];
    if (ff) { const p = ff; ff = null; p.stdout.removeAllListeners('data'); p.kill('SIGKILL'); }
  };
  /**
   * Decode from scene time `t`. Paused (`still`): the first picture goes out at once and the
   * decoder stays, a few pictures read ahead, so a play from here starts without ffmpeg's start-up
   * time (seek, first decode: 0.3 s on Windows) – otherwise the first pictures would come late.
   */
  const decode = (t, still = false) => {
    stop();
    pos0 = Math.max(0, Math.min(duration, mediaPosition(t, rec.startUtcMs, rec.latencyMs)));
    n = 0;
    const vf = `scale=${width}:${height}:flags=area:in_color_matrix=${decodeMatrix}:in_range=${decodeRange}`;
    const a = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-ss', pos0.toFixed(3), '-f', 'concat', '-safe', '0', '-i', list, '-map', '0:v:0', '-an', '-vf', vf,
      '-pix_fmt', depth === 16 ? 'rgba64le' : 'rgba', '-f', 'rawvideo', 'pipe:1'];
    const p = spawn(ctx.ffmpeg, a, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    ff = p;
    let shown = !still;
    asm = new FrameAssembler(bytes, (f) => {
      if (!shown) { shown = true; if (ws.readyState === ws.OPEN) { ws.send(f, { binary: true }); sent++; } }
      queue.push(f);
      // read ahead a little, never more: the pace comes from the clock, not from ffmpeg
      if (queue.length > 6) p.stdout.pause();
    });
    p.stdout.on('data', (d) => asm.push(d));
    p.on('close', () => { if (ff === p) ff = null; });
  };
  const pump = () => {
    if (!clock) return;
    const now = Date.now();
    while (queue.length) {
      const due = frameDue(n, { pos0, fps: info.fps, startUtcMs: rec.startUtcMs, latencyMs: rec.latencyMs, ...clock });
      if (due > now) break;
      const f = queue.shift();
      n++;
      // late by more than two frames (slow decoder or page): skip, the clock wins
      if (now - due > 2000 / info.fps && queue.length) { dropped++; continue; }
      if (ws.readyState === ws.OPEN && ws.bufferedAmount < bytes * 2) { ws.send(f, { binary: true }); sent++; } else dropped++;
    }
    if (queue.length < 3) ff?.stdout.resume();
    if (!ff && !queue.length) { clearInterval(timer); timer = null; clock = null; state('ended', endUtc); }
  };
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let m;
    try { m = JSON.parse(String(data)); } catch { return; }
    const t = Number(m.t);
    if (!Number.isFinite(t)) return;
    if (m.type === 'play') {
      const at = Number.isFinite(Number(m.at)) ? Number(m.at) : Date.now();
      // paused at this very picture: the waiting decoder plays on, else a new one from `t`
      const want = Math.max(0, Math.min(duration, mediaPosition(t, rec.startUtcMs, rec.latencyMs)));
      if (!(ff && !clock && n === 0 && Math.abs(want - pos0) < 0.5 / info.fps)) decode(t);
      clock = { t0: t, at0: at, rate: Math.min(4, Math.max(0.1, Number(m.rate) || 1)) };
      timer = setInterval(pump, 4);
      state('playing', t);
    } else if (m.type === 'pause' || m.type === 'seek') {
      clock = null;
      decode(t, true);
      state('paused', t);
    }
  });
  // first picture: the start of the recording
  decode(startUtc, true);
  state('paused', startUtc);
  const stats = setInterval(() => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped })); }, 1000);
  ws.on('close', () => { closed = true; clearInterval(stats); stop(); rm(tmp, { recursive: true, force: true }).catch(() => {}); });
  return closed;
}

export { toMsg };
