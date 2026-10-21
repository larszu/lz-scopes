// Local recording of bridge sources (issue #140 step 5, docs/research/aufzeichnung.md).
//
// The recording is a second output of the same ffmpeg process that feeds the analysis: a
// capture device (DeckLink, V4L2, AVFoundation) cannot be opened twice, and a network camera
// should not get a second session. Network sources are copied unchanged (`-c copy`); raw
// sources (test patterns, capture devices, DeckLink/NDI helpers) are encoded with ProRes 422 HQ,
// DNxHR HQX, HEVC 10 bit (hardware encoder with fallback) or FFV1.
//
// Output: ffmpeg's segment muxer writes Matroska or MOV segments (a crash costs at most the
// segment being written) and reports every finished segment as a CSV line
// (`file,start,end`) on a pipe (POSIX) or into a list file (Windows). The bridge keeps a
// companion JSON file next to the segments: source settings, wall clock and PTP time of the
// first picture, time code, measured latency, segments, markers and events.
//
// Target folders: only folders released with --record-dir / LZS_RECORD_DIRS (or chosen in the
// desktop app); a client names a folder by its name, never by path, like the watch folders
// (server/folder.mjs). File and take names are sanitised; the result must stay inside the root.

import { spawn } from 'node:child_process';
import { createReadStream, statfsSync } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, delimiter, join, resolve, sep } from 'node:path';
import { bmsg } from './messages.mjs';

/** Codecs for raw sources. */
export const RECORD_CODECS = ['prores', 'dnxhr', 'hevc', 'ffv1'];
export const RECORD_CONTAINERS = ['mkv', 'mov'];
/** HEVC encoders tried in this order (hardware first), per platform. */
export const HEVC_ENCODERS = {
  darwin: ['hevc_videotoolbox', 'libx265'],
  win32: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'libx265'],
  linux: ['hevc_nvenc', 'hevc_qsv', 'hevc_vaapi', 'libx265'],
};

/** Released recording folders: [{ name, dir }] from --record-dir and LZS_RECORD_DIRS; names unique. */
export function recordRoots(argv = process.argv.slice(2), env = process.env, extra = []) {
  const dirs = [...extra];
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--record-dir' && argv[i + 1]) dirs.push(argv[++i]);
  for (const d of (env.LZS_RECORD_DIRS ?? '').split(delimiter)) if (d.trim()) dirs.push(d.trim());
  const out = [];
  for (const d of dirs) {
    const dir = resolve(d);
    if (out.some((r) => r.dir === dir)) continue;
    const base = (basename(dir) || 'recordings').replace(/[^\w .-]/g, '_').slice(0, 60);
    let name = base, k = 2;
    while (out.some((r) => r.name === name)) name = `${base}-${k++}`;
    out.push({ name, dir });
  }
  return out;
}

/** File-name part from free text (source names): letters, digits, `_ . -`; never empty, never dots only. */
export function safeName(s, fallback = 'source') {
  const x = String(s ?? '').normalize('NFC').replace(/[^\p{L}\p{N}_.-]+/gu, '_').replace(/^[._]+|_+$/g, '').slice(0, 60);
  return x || fallback;
}

/** Take name sent by the app: `YYYYMMDD-HHMMSS` style, letters/digits/`_-.`, at most 80. */
export const validTake = (t) => typeof t === 'string' && /^[\w-][\w.-]{0,79}$/.test(t) && !t.includes('..');

/** Take name from a date (local time): 20261010-213005. */
export function takeName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Where a recording goes: <root>/<take>/<name>…; null when the root is not released or the
 * result would leave it.
 */
export function resolveTarget(roots, rootName, take, name) {
  const root = roots.find((r) => r.name === rootName) ?? (rootName ? null : roots[0]);
  if (!root || !validTake(take)) return null;
  const rootDir = resolve(root.dir);
  const dir = resolve(rootDir, take);
  if (!dir.startsWith(rootDir + sep)) return null;
  const base = safeName(name);
  return { root, dir, base };
}

/** Is this an already compressed network input that is copied rather than encoded? */
export const isNetworkUrl = (url) => /^(rtsps?|rtmps?|rtp|udp|srt|http|https|tcp):\/\//i.test(url ?? '');

/** copy | encode | null (not recordable: stills, audio only, Resolve). */
export function recordMode(url) {
  if (isNetworkUrl(url)) return 'copy';
  if (/^(test:|device:|decklink:|ndi:)/.test(url ?? '')) return 'encode';
  return null;
}

/** Credentials out of a URL before it goes into a file. */
export function stripCredentials(url) {
  return String(url ?? '').replace(/^([a-z][\w+.-]*:\/\/)[^@/?#]*@/i, '$1');
}

/** `%` is special in ffmpeg's segment pattern. */
export const escapePattern = (p) => p.replace(/%/g, '%%');

/** Video bit rate for HEVC: about 0.5 bit per pixel and frame (1080p50 ≈ 52 Mbit/s). */
export function hevcBitrate(width, height, fps) {
  const b = Math.round((Math.max(1, width) * Math.max(1, height) * Math.max(1, fps || 25) * 0.5) / 1e6);
  return `${Math.min(400, Math.max(8, b))}M`;
}

/**
 * Video encoder arguments for raw sources. `gopSeconds` > 0 forces a key frame at least that
 * often (ring buffer: every segment must start with one); the intra codecs have one per frame.
 */
export function videoCodecArgs(codec, { encoder = '', width = 1920, height = 1080, fps = 25, container = 'mkv', gopSeconds = 0 } = {}) {
  switch (codec) {
    case 'prores': return ['-c:v', 'prores_ks', '-profile:v', '3', '-vendor', 'apl0', '-pix_fmt', 'yuv422p10le'];
    case 'dnxhr': return ['-c:v', 'dnxhd', '-profile:v', 'dnxhr_hqx', '-pix_fmt', 'yuv422p10le'];
    // lossless: the source's own pixel format, sub-black and super-white codes stay
    case 'ffv1': return ['-c:v', 'ffv1', '-level', '3', '-g', '1', '-slices', '16', '-slicecrc', '1'];
    case 'hevc': {
      const enc = encoder || 'libx265';
      const gop = Math.max(1, Math.round((fps || 25) * (gopSeconds || 2)));
      const a = ['-c:v', enc];
      if (enc === 'libx265') a.push('-preset', 'fast', '-crf', '16', '-pix_fmt', 'yuv420p10le', '-x265-params', 'log-level=error');
      else if (enc === 'hevc_vaapi') a.push('-vf', 'format=p010le,hwupload', '-b:v', hevcBitrate(width, height, fps));
      else a.push('-profile:v', 'main10', '-pix_fmt', 'p010le', '-b:v', hevcBitrate(width, height, fps));
      a.push('-g', String(gop));
      if (gopSeconds) a.push('-force_key_frames', `expr:gte(t,n_forced*${gopSeconds})`);
      if (container === 'mov') a.push('-tag:v', 'hvc1');
      return a;
    }
  }
  throw new Error(`unknown codec ${codec}`);
}

/**
 * Arguments of one segmenting output (appended after the analysis output of the same ffmpeg).
 *   mode 'copy' | 'encode', codec (encode), encoder (HEVC), container 'mkv' | 'mov',
 *   videoMap ('0:v:0'), audioMap (stream specifier or null), sourceCodec (copy: 'hevc' → hvc1 tag in MOV),
 *   segmentSeconds, wrap (ring buffer: number of files), list (pipe:N or file), pattern (file pattern),
 *   metadata { key: value }.
 */
export function segmentOutputArgs({ mode, codec = 'prores', encoder = '', container = 'mkv', videoMap = '0:v:0', audioMap = null, sourceCodec = '',
  width = 1920, height = 1080, fps = 25, segmentSeconds = 300, wrap = 0, list, pattern, metadata = {}, gopSeconds = 0 }) {
  const a = ['-map', videoMap];
  if (audioMap) a.push('-map', audioMap);
  if (mode === 'copy') {
    a.push('-c:v', 'copy');
    if (container === 'mov' && /^(hevc|h265)$/i.test(sourceCodec)) a.push('-tag:v', 'hvc1');
  } else a.push(...videoCodecArgs(codec, { encoder, width, height, fps, container, gopSeconds }));
  if (audioMap) a.push('-c:a', mode === 'copy' && container === 'mkv' ? 'copy' : 'pcm_s24le');
  a.push('-sn', '-dn');
  for (const [k, v] of Object.entries(metadata)) a.push('-metadata', `${k}=${v}`);
  a.push('-f', 'segment', '-segment_time', String(segmentSeconds), '-segment_format', container === 'mov' ? 'mov' : 'matroska',
    '-reset_timestamps', '1');
  if (wrap > 0) a.push('-segment_wrap', String(wrap));
  a.push('-segment_list', list, '-segment_list_type', 'csv', pattern);
  return a;
}

/** One CSV line of the segment list: `file,start,end` (file may be quoted). */
export function parseSegmentLine(line) {
  const m = /^"?((?:[^"]|"")*?)"?,(-?[\d.]+),(-?[\d.]+)\s*$/.exec(String(line).trim());
  if (!m) return null;
  return { file: m[1].replace(/""/g, '"'), start: Number(m[2]), end: Number(m[3]) };
}

/** Splits a text stream into lines (segment list on a pipe or tailed from a file). */
export class LineSplitter {
  constructor(onLine) { this.onLine = onLine; this.rest = ''; }
  push(text) {
    const parts = (this.rest + text).split(/\r?\n/);
    this.rest = parts.pop() ?? '';
    for (const l of parts) if (l.trim()) this.onLine(l);
  }
}

/** Free bytes on the volume of `dir` (null when unknown). */
export function freeBytes(dir) {
  try { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

/**
 * Rough data rate in bytes/s for the space check. Copy: the source's own rate, unknown before
 * the first segment → 2 MB/s (16 Mbit/s); encode: ProRes 422 HQ 1080p50 ≈ 2.7 GB/min, scaled by
 * pixel rate; DNxHR HQX similar; HEVC: the set bit rate; FFV1 ≈ 1.5× ProRes HQ.
 */
export function estimateRate(mode, codec, width = 1920, height = 1080, fps = 25) {
  if (mode === 'copy') return 2e6;
  const scale = (width * height * (fps || 25)) / (1920 * 1080 * 50);
  const proresHq = 2.7e9 / 60;
  if (codec === 'hevc') return (Number.parseInt(hevcBitrate(width, height, fps), 10) * 1e6) / 8;
  if (codec === 'ffv1') return proresHq * 1.5 * scale;
  return proresHq * scale;
}

/** Minimum free space to start: two segments plus 1 GB reserve. */
export function spaceProblem(free, rate, segmentSeconds) {
  if (free === null) return null;
  const need = rate * segmentSeconds * 2 + 1e9;
  return free < need ? bmsg('record.diskFull', `Not enough free space (${gb(free)} GB free, ${gb(need)} GB needed)`, { free: gb(free), need: gb(need) }) : null;
}
const gb = (b) => Math.round((b / 1e9) * 10) / 10;

/** Minutes of recording left at `rate`. */
export const minutesLeft = (free, rate) => (free === null || !rate ? null : Math.floor((free - 1e9) / rate / 60));

// ---- companion file

/**
 * Companion JSON file of one recording (format `lz-scopes-recording`, version 1). Times are
 * wall clock (Unix ms, UTC) plus, when known, PTP seconds (TAI) of the same moment; `t` of a
 * marker or event is seconds since the first picture.
 */
export class Sidecar {
  constructor(meta) {
    this.data = {
      format: 'lz-scopes-recording', version: 1,
      ...meta,
      start: { requestedUtcMs: meta.requestedUtcMs ?? Date.now(), utcMs: null, utc: null, ptp: null, clock: null, timecode: null },
      segments: [], markers: [], events: [], end: null,
    };
    delete this.data.requestedUtcMs;
  }
  /** Wall clock of the first picture (from the first segment line) and the PTP time of that moment. */
  setStart(utcMs, ptp = null, clock = null) {
    if (this.data.start.utcMs !== null) return;
    Object.assign(this.data.start, { utcMs, utc: new Date(utcMs).toISOString(), ptp, clock });
  }
  setTimecode(tc) { if (tc && !this.data.start.timecode) this.data.start.timecode = tc; }
  /** Seconds since the first picture (or since the request while that is unknown). */
  rel(utcMs) { return Math.round((utcMs - (this.data.start.utcMs ?? this.data.start.requestedUtcMs)) / 1) / 1000; }
  addSegment(seg) { this.data.segments.push(seg); }
  mark(label, utcMs) {
    const m = { t: this.rel(utcMs), utcMs, label: String(label ?? '').slice(0, 200) };
    this.data.markers.push(m);
    return m;
  }
  event(kind, data, utcMs) {
    const e = { t: this.rel(utcMs), utcMs, kind: String(kind).slice(0, 40), data };
    this.data.events.push(e);
    return e;
  }
  finish(reason, utcMs) { this.data.end = { utcMs, utc: new Date(utcMs).toISOString(), reason }; }
  toJSON() { return this.data; }
}

/** Writes JSON atomically (temp file + rename): a reader never sees half a file. */
export async function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

// ---- HEVC encoder detection

const hevcCache = new Map();
/**
 * First HEVC 10-bit encoder that really encodes on this machine (a listed hardware encoder may
 * still fail without the GPU or driver); one short test encode each, cached per ffmpeg.
 * → { encoder, hardware, tried: [{ encoder, ok }] } or { encoder: null }.
 */
export function pickHevcEncoder(ffmpeg, platform = process.platform, runner = testEncode) {
  const key = `${ffmpeg}|${platform}`;
  if (!hevcCache.has(key)) {
    hevcCache.set(key, (async () => {
      const tried = [];
      for (const enc of HEVC_ENCODERS[platform] ?? HEVC_ENCODERS.linux) {
        const ok = await runner(ffmpeg, enc);
        tried.push({ encoder: enc, ok });
        if (ok) return { encoder: enc, hardware: enc !== 'libx265', tried };
      }
      return { encoder: null, hardware: false, tried };
    })());
  }
  return hevcCache.get(key);
}

function testEncode(ffmpeg, enc) {
  const a = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=0.2',
    ...videoCodecArgs('hevc', { encoder: enc, width: 320, height: 240, fps: 25 }), '-f', 'null', '-'];
  return new Promise((ok) => {
    let p;
    try { p = spawn(ffmpeg, a, { stdio: 'ignore', windowsHide: true }); } catch { return ok(false); }
    const timer = setTimeout(() => p.kill('SIGKILL'), 15000);
    p.on('error', () => { clearTimeout(timer); ok(false); });
    p.on('close', (code) => { clearTimeout(timer); ok(code === 0); });
  });
}

// ---- segment list from a file (Windows: no extra pipes)

/** Follows a growing text file; `stop()` reads the rest once more. */
export function tailFile(file, onText, everyMs = 100) {
  let pos = 0, busy = null, stopped = false;
  const read = () => busy ?? (busy = new Promise((ok) => {
    stat(file).then((st) => {
      if (st.size <= pos) return ok();
      const s = createReadStream(file, { start: pos, end: st.size - 1, encoding: 'utf8' });
      s.on('data', (d) => onText(d));
      s.on('close', () => { pos = st.size; ok(); });
      s.on('error', () => ok());
    }, () => ok());
  }).finally(() => { busy = null; }));
  const timer = setInterval(() => { if (!stopped) read(); }, everyMs);
  // a read still running would miss the last lines: wait for it, then read the rest
  return { stop: async () => { stopped = true; clearInterval(timer); await busy; await read(); } };
}

export const ensureDir = (dir) => mkdir(dir, { recursive: true });
export { join };
