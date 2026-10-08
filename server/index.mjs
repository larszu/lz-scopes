// lz-scopes bridge: decodes network streams (RTSP, RTMP, UDP, RTP, HTTP/HLS …) with
// ffmpeg and pushes raw RGBA frames to the browser over a WebSocket.
//
//   node server/index.mjs [--port 4192] [--host 127.0.0.1] [--dev] [--watch-dir <folder> …]
//
// WebSocket: ws://host:port/stream?url=<input>&width=960&fps=25&depth=8|16&transport=tcp|udp[&audio=1][&video=0][&format=yuv]
//   text  {type:"info", width, height, depth, fps, codec, transfer, primaries, matrix, range[, proto:2, audio]}
//   text  {type:"error"|"end", message, code?, params?}  (code: server/messages.mjs)
//   binary one frame per message, width*height*4 samples (Uint8 or Uint16 LE)
//   with audio=1 (proto 2) every binary message starts with a 16-byte header, LZV1 = frame,
//   LZA1 = PCM (f32 interleaved); see docs/frame-protocol.md

import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { readTiff, toRgba } from './tiff.mjs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { basename, dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { FrameAssembler } from './frames.mjs';
import { COMMANDS, controlAccess, isLoopback as isLoopbackAddr, validateCommand } from './control.mjs';
import { applyDecodeOverride, deviceInputArgs, deviceOptions, formatListArgs, parseDeviceUrl, parseFormatList, pickPixfmt } from './devices.mjs';
import { helperList, helperPath, startHelperStream } from './helper-input.mjs';
import { resolveFolder, startFolderStream, watchRoots } from './folder.mjs';
import { resolveStatus } from './resolve.mjs';
import { createPlaybackWatch } from './resolveWatch.mjs';
import { handleMeterSocket, meterInfo } from './meter.mjs';
import { PtpMonitor, RtpMonitor, ipv4Interfaces, isMulticastV4, nowUtcNs } from './ptp.mjs';
import { taiMinusUtc } from './leap.mjs';
import { CONSENT_HEADERS, OriginStore, clockAccess, consentLang, consentPage, defaultOriginsFile, newNonce, normalizeOrigin, takeNonce } from './origins.mjs';
import { ffmpegCandidates, ffmpegFor, ffmpegInfo, noFfmpegMessage } from './ffmpeg.mjs';
import { BridgeError, bmsg, field, toMsg } from './messages.mjs';

export { ffmpegCandidates, ffmpegInfo };
import { FlvH264Demuxer } from './flv.mjs';
import { handleOut10 } from './out10.mjs';
import { readStamp, stampAge } from './stamp.mjs';
import { startOwnRtp } from './rtsp.mjs';
import { announce } from './bonjour.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
let DEV = args.includes('--dev');
/** Web origins allowed to use /clock (server/origins.mjs); set up in startBridge. */
let ORIGINS = new OriginStore(null);
/** Control API token (optional); with a token, clients outside 127.0.0.1 are allowed. */
let CONTROL_TOKEN = arg('control-token', process.env.LZS_CONTROL_TOKEN ?? '');
let DIST = resolve(fileURLToPath(new URL('../dist', import.meta.url)));

/** $FFPROBE, then ffprobe next to each ffmpeg (the shipped build has one; without it: parseFfmpegBanner). */
export function ffprobeCandidates(ffmpegs, env = process.env) {
  const list = [];
  if (env.FFPROBE) list.push(env.FFPROBE);
  for (const f of ffmpegs) {
    const name = basename(f);
    if (/^ffmpeg(\.exe)?$/.test(name)) list.push(join(dirname(f), name.replace('ffmpeg', 'ffprobe')));
  }
  return [...new Set(list)].filter((f) => existsSync(f));
}

// Only network inputs plus the built-in test pattern. No local files, no ffmpeg
// option injection: the URL is passed as a single argv element, never via a shell.
const ALLOWED = /^(rtsps?|rtmps?|rtp|udp|srt|http|https|tcp):\/\//i;
const TEST_PATTERNS = {
  'test:bars': 'smptehdbars=size=1920x1080:rate=25',
  'test:ramp': 'gradients=size=1920x1080:rate=25:c0=black:c1=white:x0=0:y0=0:x1=1919:y1=0:type=linear',
  'test:testsrc': 'testsrc2=size=1920x1080:rate=25',
  'test:colors': 'rgbtestsrc=size=1920x1080:rate=25',
};

/** Test tone for the lavfi patterns: 1 kHz stereo; lavfi's default amplitude 1/8 = −18.06 dBFS (EBU R 68). */
const TEST_TONE = 'sine=frequency=1000:sample_rate=48000,pan=stereo|c0=c0|c1=c0';

export function validateInput(url) {
  if (typeof url !== 'string' || url.length === 0 || url.length > 2048) return bmsg('input.missing', 'No source given');
  if (url in TEST_PATTERNS || url === 'resolve:') return null;
  if (/^(device|audio):/.test(url)) return parseDevice(url) ? null : bmsg('input.badDevice', 'Invalid device (device:<api>:<name>[#audio=<name>] or audio:<api>:<name>[#ch=<n>])');
  if (/^decklink:\d{1,2}$/.test(url)) return null;
  if (/^ndi:[^\n\r\0]{1,200}$/.test(url) && !url.slice(4).startsWith('-')) return null;
  if (/^folder:[\w .-]{1,80}$/.test(url)) return null;
  if (url.startsWith('-')) return bmsg('input.invalid', 'Invalid source');
  if (!ALLOWED.test(url)) return bmsg('input.scheme', 'Only rtsp://, rtsps://, rtmp://, rtp://, udp://, srt://, tcp://, http(s)://, resolve: or test:*');
  return null;
}

/**
 * Local capture devices through ffmpeg (cards that show up as system devices):
 *   device:<avfoundation|dshow|v4l2>:<video name>[#audio=<audio name>][#ch=<n>]
 *   audio:<avfoundation|dshow|alsa>:<audio name>[#ch=<n>]
 * The audio API follows the video API (v4l2 → alsa). Names are passed as one argv element,
 * never through a shell; #ch only takes a number (dshow/alsa `-channels`).
 * Dante: Dante Virtual Soundcard / Dante Via appear as normal system audio devices and
 * are picked up here like any other interface (no Dante protocol of our own).
 */
export function parseDevice(url) {
  const m = /^(device|audio):(avfoundation|dshow|v4l2|alsa):([^\n\r]{1,400})$/.exec(url ?? '');
  if (!m) return null;
  const [, kind, api, rest] = m;
  if (kind === 'device' && api === 'alsa') return null;
  if (kind === 'audio' && api === 'v4l2') return null;
  const parts = rest.split('#');
  const name = parts[0];
  let audio = null, ch = 0;
  for (const p of parts.slice(1)) {
    const a = /^audio=(.{1,200})$/.exec(p), c = /^ch=(\d{1,2})$/.exec(p);
    if (a) audio = a[1]; else if (c) ch = Number(c[1]); else return null;
  }
  if (kind === 'audio') { if (audio !== null || !name) return null; audio = name; }
  else if (!name) return null;
  if (ch && (ch < 1 || ch > 64)) return null;
  // avfoundation separates video and audio with ':' in one argument
  if (api === 'avfoundation' && audio !== null && (audio.includes(':') || (kind === 'device' && name.includes(':')))) return null;
  const audioApi = api === 'v4l2' ? 'alsa' : api;
  return { kind, api, video: kind === 'device' ? name : null, audio, audioApi, ch };
}

/** Capture rate that worked for each device (probed once, see probe()). */
const deviceRates = new Map();
export const DEVICE_RATES = ['60', '50', '30', '25', '59.94', '29.97', '24'];

/**
 * ffmpeg input arguments of a device URL. `opts` = mode/pixel format (server/devices.mjs)
 * plus `audio: false` to leave the sound of a `device:…#audio=` URL out.
 */
export function deviceArgs(url, rateOverride, opts = {}) {
  const d = parseDevice(url);
  if (!d) return null;
  const withAudio = opts.audio !== false && d.audio !== null;
  const chArgs = d.ch && d.audioApi !== 'avfoundation' ? ['-channels', String(d.ch)] : [];
  if (d.kind === 'audio') {
    if (d.api === 'avfoundation') return ['-f', 'avfoundation', '-i', `:${d.audio}`];
    if (d.api === 'dshow') return ['-f', 'dshow', ...chArgs, '-i', `audio=${d.audio}`];
    return ['-f', 'alsa', ...chArgs, '-i', d.audio];
  }
  // the device's own capture rate; the analysis rate is limited later by the fps filter
  // explicit mode/pixel format: see server/devices.mjs
  const v = deviceInputArgs(`device:${d.api}:${d.video}`, rateOverride ?? deviceRates.get(deviceKey(url)) ?? '30', opts);
  if (!withAudio || !v) return v;
  // sound of the same device in the same ffmpeg input (avfoundation, dshow) or as a second input (v4l2 + ALSA)
  if (d.api === 'avfoundation') return [...v.slice(0, -1), `${d.video}:${d.audio}`];
  if (d.api === 'dshow') return [...v.slice(0, -2), ...chArgs, '-i', `video=${d.video}:audio=${d.audio}`];
  return [...v, '-f', 'alsa', ...chArgs, '-i', d.audio];
}

/** Device URL without the #audio/#ch suffix (key of the rate and format caches). */
const deviceKey = (url) => url.split('#')[0];

/** Stream specifier of the sound for an input URL (second input for test patterns and v4l2+alsa). */
export function audioMap(url) {
  if (url in TEST_PATTERNS) return '1:a:0';
  const d = parseDevice(url);
  if (d?.kind === 'device' && d.api === 'v4l2' && d.audio !== null) return '1:a:0';
  return '0:a:0';
}

function inputArgs(url, transport, { audio = false, video = true, device = {} } = {}) {
  if (url in TEST_PATTERNS) {
    const a = [];
    if (video) a.push('-re', '-f', 'lavfi', '-i', TEST_PATTERNS[url]);
    if (audio) a.push('-re', '-f', 'lavfi', '-i', TEST_TONE);
    return a;
  }
  const dev = deviceArgs(url, undefined, { ...device, audio });
  if (dev) return dev;
  const a = ['-fflags', 'nobuffer', '-flags', 'low_delay', '-analyzeduration', '1000000', '-probesize', '2000000'];
  // low latency: no reorder queue, no demuxer delay (the probe already ran separately)
  if (/^rtsps?:/i.test(url)) a.push('-rtsp_transport', transport === 'udp' ? 'udp' : 'tcp', '-timeout', '5000000', '-reorder_queue_size', '0', '-max_delay', '0');
  else a.push('-rw_timeout', '5000000');
  return [...a, '-i', url];
}

/** First audio stream from ffmpeg's input banner: `Audio: aac (LC), 48000 Hz, stereo, fltp`. */
export function parseAudioBanner(stderr) {
  const line = stderr.split('\n').find((l) => /Stream #\d+:\d+.*: Audio: /.test(l));
  if (!line) return null;
  const m = /Audio: ([\w-]+)[^,]*,\s*(\d+) Hz,\s*([^,]+)/.exec(line);
  if (!m) return null;
  const layout = m[3].trim();
  const named = { mono: 1, stereo: 2, '2.1': 3, '3.0': 3, quad: 4, '4.0': 4, '5.0': 5, '5.0(side)': 5, '5.1': 6, '5.1(side)': 6, '6.1': 7, '7.1': 8 };
  const ch = named[layout] ?? Number(/(\d+) channels/.exec(layout)?.[1] ?? 0);
  return ch ? { codec: m[1], sampleRate: Number(m[2]), channels: ch, layout } : null;
}

/** Size and colour tags from ffmpeg's input banner (used when there is no ffprobe). */
export function parseFfmpegBanner(stderr) {
  const line = stderr.split('\n').find((l) => /Stream #\d+:\d+.*: Video: /.test(l));
  if (!line) {
    const audio = parseAudioBanner(stderr);
    return audio ? { width: 0, height: 0, fps: 0, audio } : null;
  }
  const size = /,\s*(\d{2,5})x(\d{2,5})\b/.exec(line);
  if (!size) return null;
  const codec = /Video: ([\w-]+)/.exec(line)?.[1];
  const fmt = /Video: [^,]+,\s*(\w+)(?:\(([^)]*)\))?/.exec(line);
  let range = 'unknown', matrix = 'unknown', primaries = 'unknown', transfer = 'unknown';
  for (const part of (fmt?.[2] ?? '').split(',').map((x) => x.trim())) {
    if (part === 'tv' || part === 'pc') range = part;
    else if (/^[\w-]+\/[\w-]+\/[\w-]+$/.test(part)) [matrix, primaries, transfer] = part.split('/');
    else if (/^(bt|smpte|arib|iec|gbr|ycgco|fcc)/.test(part)) matrix = primaries = transfer = part;
  }
  const fps = Number(/([\d.]+) fps/.exec(line)?.[1] ?? /([\d.]+) tbr/.exec(line)?.[1] ?? 0);
  return { width: Number(size[1]), height: Number(size[2]), codec, pixFmt: fmt?.[1], fps, transfer, primaries, matrix, range, audio: parseAudioBanner(stderr) };
}

function run(binary, a, timeoutMs) {
  return new Promise((ok) => {
    let p;
    try { p = spawn(binary, a, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch { return ok(null); }
    let out = '', err = '';
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => { err = (err + d).slice(-8000); });
    p.on('error', () => { clearTimeout(timer); ok(null); });
    p.on('close', (code) => { clearTimeout(timer); ok({ code, out, err }); });
  });
}

async function probe(url, transport, device = {}) {
  const dev = parseDevice(url);
  if (dev?.kind === 'audio') {
    // audio device: open it for a moment and read rate/channels from the banner
    const ffmpeg = ffmpegCandidates()[0];
    if (!ffmpeg) throw new BridgeError('ffmpeg.missing', 'ffmpeg not found');
    const r = await run(ffmpeg, ['-hide_banner', ...deviceArgs(url), '-t', '0.3', '-f', 'null', '-'], 15000);
    const audio = r && r.code === 0 ? parseAudioBanner(r.err) : null;
    if (audio) return { width: 0, height: 0, fps: 0, audio };
    throw (r && lastProblem(r.err)) ? new Error(lastProblem(r.err)) : new BridgeError('device.audioUnavailable', 'Audio device not available');
  }
  if (dev) {
    // devices: find a capture rate the device accepts, read size/format (and sound) from the banner
    const ffmpeg = ffmpegCandidates()[0];
    if (!ffmpeg) throw new BridgeError('ffmpeg.missing', 'ffmpeg not found');
    const key = url.split('#')[0];
    let last = '';
    const rates = device.rate ? [device.rate] : [deviceRates.get(key), ...DEVICE_RATES].filter(Boolean);
    for (const rate of rates) {
      const r = await run(ffmpeg, ['-hide_banner', ...deviceArgs(url, rate, device), '-frames:v', '1', '-f', 'null', '-'], 15000);
      if (!r) continue;
      const info = r.code === 0 ? parseFfmpegBanner(r.err) : null;
      if (info) { deviceRates.set(key, rate); return { ...info, fps: /\//.test(rate) ? Number(rate.split('/')[0]) / Number(rate.split('/')[1]) : Number(rate), audio: dev.audio !== null ? info.audio : null }; }
      last = lastProblem(r.err.split('\n').filter((l) => !/output file/i.test(l)).join('\n'));
    }
    throw last ? new Error(last) : new BridgeError('device.unavailable', 'Device not available');
  }
  if (url in TEST_PATTERNS) {
    return {
      width: 1920, height: 1080, codec: 'lavfi', fps: 25, transfer: 'bt709', primaries: 'bt709', matrix: 'bt709', range: 'tv',
      audio: { codec: 'lavfi', sampleRate: 48000, channels: 2, layout: 'stereo' },
    };
  }
  const ffmpegs = ffmpegCandidates();
  const probes = ffprobeCandidates(ffmpegs);
  if (!probes.length) {
    for (const ffmpeg of ffmpegs) {
      // Without an output ffmpeg prints the input banner and exits.
      const r = await run(ffmpeg, ['-hide_banner', ...inputArgs(url, transport)], 15000);
      if (!r) continue;
      const info = parseFfmpegBanner(r.err);
      if (info) return info;
      const line = r.err.trim().split('\n').filter((l) => !/output file/i.test(l)).pop();
      throw line ? new Error(line) : new BridgeError('source.unreachable', 'Source not reachable');
    }
    throw new BridgeError('ffmpeg.missing', 'ffmpeg not found');
  }
  const FFPROBE = probes[0];
  const a = ['-v', 'error', '-analyzeduration', '1000000', '-probesize', '2000000', '-show_entries',
    'stream=codec_type,width,height,codec_name,avg_frame_rate,r_frame_rate,color_transfer,color_primaries,color_space,color_range,pix_fmt,field_order,sample_rate,channels,channel_layout,start_time:stream_tags=timecode:format_tags=timecode',
    '-of', 'json'];
  if (/^rtsps?:/i.test(url)) a.push('-rtsp_transport', transport === 'udp' ? 'udp' : 'tcp');
  a.push('-i', url);
  return new Promise((ok, fail) => {
    const p = spawn(FFPROBE, a, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { p.kill('SIGKILL'); fail(new BridgeError('source.timeout', 'Timed out opening the source')); }, 15000);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => { clearTimeout(timer); fail(e); });
    p.on('close', (code) => {
      clearTimeout(timer);
      try {
        const json = JSON.parse(out);
        const streams = json.streams ?? [];
        const s = streams.find((x) => x.codec_type === 'video');
        const au = streams.find((x) => x.codec_type === 'audio' && Number(x.channels) > 0);
        if (!s && !au) throw err.trim() ? new Error(err.trim()) : new BridgeError('ffprobe.exit', `ffprobe exited with ${code}`, { code });
        const audio = au ? { codec: au.codec_name, sampleRate: Number(au.sample_rate), channels: Number(au.channels), layout: au.channel_layout ?? '' } : null;
        if (!s) return ok({ width: 0, height: 0, fps: 0, audio });
        const rate = (r) => { const [n, d] = String(r ?? '0/1').split('/').map(Number); return d ? n / d : 0; };
        // start time code of the container (MOV tmcd, MXF …): stream tag of the video, any stream, or the format
        const timecode = s.tags?.timecode ?? streams.find((x) => x.tags?.timecode)?.tags?.timecode ?? json.format?.tags?.timecode;
        ok({
          ...(timecode ? { timecode, startTime: Number(s.start_time) } : {}), frameRate: s.r_frame_rate,
          width: s.width, height: s.height, codec: s.codec_name, pixFmt: s.pix_fmt,
          fps: Math.round((rate(s.avg_frame_rate) || rate(s.r_frame_rate)) * 100) / 100,
          transfer: s.color_transfer ?? 'unknown', primaries: s.color_primaries ?? 'unknown',
          matrix: s.color_space ?? 'unknown', range: s.color_range ?? 'unknown', audio,
          ...(s.field_order && s.field_order !== 'unknown' ? { fieldOrder: s.field_order } : {}),
        });
      } catch (e) { fail(err.trim() ? new Error(err.trim().split('\n').pop()) : e); }
    });
  });
}

/**
 * Matrix and range for the Y'CbCr → R'G'B' conversion. swscale falls back to BT.601 for
 * untagged input, which skews every untagged HD camera stream – so decide explicitly:
 * tagged value first, otherwise BT.709 above SD and BT.601 for SD.
 */
export function decodeParams(info) {
  const m = String(info.matrix ?? '');
  const decodeMatrix = m.startsWith('bt2020') ? 'bt2020'
    : m === 'bt709' ? 'bt709'
      : m === 'smpte170m' || m === 'bt470bg' ? 'bt601'
        : m === 'smpte240m' ? 'smpte240m'
          : info.height > 576 ? 'bt709' : 'bt601';
  const decodeRange = info.range === 'pc' ? 'full' : 'limited';
  return { decodeMatrix, decodeRange };
}

/**
 * Unclipped Y′CbCr mode (format=yuv, issue #7): 4:4:4 16 bit as ffmpeg `ayuv64le` (A, Y′, Cb, Cr),
 * scaled without range or matrix conversion (in_range = out_range), so codes below black and
 * above white survive. n-bit codes arrive left-justified (× 2^(16−n)). RGB sources gain nothing
 * from it and stay on rgba64le.
 */
export function yuvParams(info, decodeMatrix, decodeRange) {
  const pf = String(info.pixFmt ?? '');
  if (/^(rgb|bgr|gbr|argb|abgr|0rgb|0bgr|x2rgb|x2bgr|pal8)/.test(pf)) {
    return { yuv: false, ...field('note', bmsg('yuv.rgbSource', `Source is R′G′B′ (${pf}) – Y′CbCr path not possible, 16 bit R′G′B′`, { pixFmt: pf })) };
  }
  const bits = Number(/p(\d+)(le|be)?$/.exec(pf)?.[1] ?? /^(?:gray|y)(\d+)/.exec(pf)?.[1] ?? 8) || 8;
  const range = pf.startsWith('yuvj') ? 'full' : decodeRange;
  const m = decodeMatrix;
  return {
    yuv: true, bits, range,
    scale: `in_color_matrix=${m}:out_color_matrix=${m}:in_range=${range}:out_range=${range}`,
  };
}

/** ffprobe field_order: tt/bb/tb/bt = interlaced (two fields woven into one frame), progressive otherwise. */
export const isInterlaced = (fieldOrder) => ['tt', 'bb', 'tb', 'bt'].includes(String(fieldOrder ?? ''));

/** Output size: fit into maxWidth keeping aspect, even dimensions. */
export function outputSize(w, h, maxWidth) {
  if (!w || !h) return { width: 960, height: 540 };
  const width = maxWidth > 0 && w > maxWidth ? maxWidth : w;
  const height = Math.round((h * width) / w);
  return { width: width & ~1, height: Math.max(2, height & ~1) };
}

/**
 * ffmpeg argument lists. `audio` = 'fd3' (one process, PCM on pipe:3), 'split' (video
 * process + separate audio process on pipe:1, fallback for Windows) or 'none'.
 * `video: false` = audio only (PCM on pipe:1).
 * `pts: true` (protocol 2): showinfo/ashowinfo print the presentation timestamps on stderr
 * (parsed by PtsTracker); needs `-loglevel info`. Not in 'split' mode: two ffmpeg
 * processes open two sessions whose timestamps cannot be compared.
 */
export function ffmpegArgs({ url, transport = 'tcp', vf = '', depth = 8, video = true, audio = 'none', pts = false, device = {}, pixFmt = '', log = 'error', codec = 'raw', gop = 50, ownInput = null }) {
  const test = url in TEST_PATTERNS;
  const withPts = pts && audio !== 'split';
  // time code (#28) and PTS (#24) both read showinfo output; level+info keeps the error lines recognisable
  const level = log !== 'error' ? log : withPts ? 'info' : 'error';
  const head = ['-hide_banner', '-loglevel', level, '-nostdin', ...(level === 'error' ? [] : ['-nostats'])];
  const pcm = (map, target) => ['-map', map, '-vn', '-sn', '-dn', ...(withPts ? ['-af', 'ashowinfo'] : []), '-c:a', 'pcm_f32le', '-f', 'f32le', target];
  // PTS need a showinfo at the end of the chain (after fps=); the time-code showinfo at the start serves when nothing drops frames
  const needShowinfo = withPts && !(/^showinfo=/.test(vf) && !/(^|,)fps=/.test(vf));
  const vfPts = needShowinfo ? `${vf},showinfo=checksum=0` : vf;
  // codec 'h264' (#16): 8-bit 4:2:0 H.264 in FLV framing for remote bridges; no B-frames, no
  // lookahead, every packet flushed at once. `vf` must then produce yuv420p.
  const vid = videoOut({ codec, vfPts, depth, pixFmt, gop });
  // own RTP reception (server/rtsp.mjs): the picture comes as Matroska on stdin; sound, if
  // wanted, from a second ffmpeg with its own RTSP session (like 'split', no common PTS)
  if (ownInput && video) {
    return {
      main: [...head.filter((x) => x !== '-nostdin'), ...ownInput, ...vid],
      audio: audio === 'none' ? null : [...head, ...inputArgs(url, transport, { audio: true, video: false, device }), ...pcm(audioMap(url), 'pipe:1')],
    };
  }
  if (!video) return { main: [...head, ...inputArgs(url, transport, { audio: true, video: false, device }), ...pcm(test ? '0:a:0' : audioMap(url), 'pipe:1')], audio: null };
  if (audio === 'fd3') return { main: [...head, ...inputArgs(url, transport, { audio: true, device }), ...vid, ...pcm(audioMap(url), 'pipe:3')], audio: null };
  if (audio === 'split') {
    return {
      main: [...head, ...inputArgs(url, transport, { device }), ...vid],
      audio: [...head, ...inputArgs(url, transport, { audio: true, video: false, device }), ...pcm(test ? '0:a:0' : audioMap(url), 'pipe:1')],
    };
  }
  return { main: [...head, ...inputArgs(url, transport, { device }), ...vid], audio: null };
}

function videoOut({ codec, vfPts, depth, pixFmt, gop }) {
  return codec === 'h264'
    ? ['-map', '0:v:0', '-an', '-sn', '-dn', '-vf', vfPts, '-fps_mode', 'passthrough', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-bf', '0', '-g', String(gop), '-pix_fmt', 'yuv420p', '-flush_packets', '1', '-f', 'flv', 'pipe:1']
    // '-threads 1' (encoder): ffmpeg's rawvideo encoder is frame-threaded and then hands each
    // frame out only when the next one comes in – one frame interval of latency for a memcpy
    // (measured, docs/research/low-latency.md)
    : ['-map', '0:v:0', '-an', '-sn', '-dn', '-vf', vfPts, '-fps_mode', 'passthrough', '-pix_fmt', pixFmt || (depth === 16 ? 'rgba64le' : 'rgba'), '-threads', '1', '-f', 'rawvideo', 'pipe:1'];
}

/**
 * Per-frame time code from ffmpeg's showinfo filter (`showinfo=checksum=0`, log level
 * `level+info`). Frame lines carry `n:` and `pts_time:`, side-data lines the time code of the
 * frame: "GOP timecode" (MPEG-2 GOP header) or "SMPTE 12-1 timecode" (H.264/HEVC SEI,
 * AV_FRAME_DATA_S12M_TIMECODE). Returns the parsed item or null.
 */
export function parseShowinfo(line) {
  if (!/Parsed_showinfo_\d+/.test(line)) return null;
  const f = /\bn:\s*(\d+)\s+pts:\s*(\S+)\s+pts_time:(\S+)/.exec(line);
  if (f) return { frame: Number(f[1]), pts: f[3] === 'NOPTS' ? NaN : Number(f[3]) };
  const sd = /side data - ([^:]*timecode[^:]*):\s*(.*)$/i.exec(line);
  if (sd) {
    const tc = /(\d{2}:\d{2}:\d{2}[:;.,]\d{2})/.exec(sd[2])?.[1];
    if (tc) return { timecode: tc, kind: /gop/i.test(sd[1]) ? 'gop' : 's12m' };
  }
  return null;
}

/**
 * Routes stderr of an ffmpeg with showinfo: showinfo lines → time code messages
 * ({type:"tc", tc, tcPts, pts, kind}, at most every `minMs`), errors → `onError` (warnings dropped).
 */
export class ShowinfoTracker {
  constructor(send, onError, minMs = 40) {
    this.send = send; this.onError = onError; this.minMs = minMs;
    this.rest = ''; this.pts = NaN; this.tc = null; this.tcPts = NaN; this.kind = ''; this.first = NaN; this.lastSent = 0;
  }
  push(chunk) {
    const lines = (this.rest + chunk).split(/\r?\n/);
    this.rest = lines.pop() ?? '';
    for (const l of lines) this.line(l);
  }
  line(l) {
    const r = parseShowinfo(l);
    if (!r) {
      const m = /\[(error|fatal|panic)\]\s*(.*)$/.exec(l);
      if (m) this.onError(m[2]);
      return;
    }
    if ('frame' in r) {
      this.pts = r.pts;
      if (!Number.isFinite(this.first)) this.first = r.pts;
      const now = Date.now();
      if (now - this.lastSent >= this.minMs) { this.lastSent = now; this.send({ type: 'tc', tc: this.tc, tcPts: this.tcPts, pts: this.pts, first: this.first, kind: this.kind || null }); }
    } else {
      // side data follows its frame line
      this.tc = r.timecode; this.tcPts = this.pts; this.kind = r.kind;
    }
  }
}

/**
 * One showinfo/ashowinfo frame line → { audio, inst, n, pts, samples } (null for other lines).
 * `inst` is the filter instance (Parsed_showinfo_<inst>); with two showinfo filters in the
 * chain the last one (highest number) counts the frames that leave ffmpeg.
 */
export function parsePtsLine(line) {
  const m = /\[Parsed_(a?)showinfo_(\d+) @ [^\]]+\]\s+(?:\[info\]\s*)?n:\s*(\d+)\s+pts:\s*-?\d+\s+pts_time:\s*(-?[\d.e+-]+)/.exec(line);
  if (!m) return null;
  const samples = m[1] ? Number(/nb_samples:(\d+)/.exec(line)?.[1] ?? 0) : 0;
  return { audio: m[1] === 'a', inst: Number(m[2]), n: Number(m[3]), pts: Number(m[4]), samples };
}

/**
 * Presentation timestamps from ffmpeg's stderr. Video: frame number → PTS. Audio: the
 * sample index of every audio frame is counted; an anchor {index, pts} is reported for the
 * first frame, after a jump of more than 5 ms (capture devices jitter by a few ms) and at
 * least every 5 s.
 */
export class PtsTracker {
  constructor(sampleRate, onAnchor) {
    this.fs = sampleRate; this.onAnchor = onAnchor;
    this.video = new Map(); this.inst = -1; this.samples = 0; this.last = null; this.lastAt = -Infinity; this.rest = '';
  }
  /** Feed raw stderr text; returns the lines that are not showinfo output. */
  feed(text) {
    const lines = (this.rest + text).split('\n');
    this.rest = lines.pop() ?? '';
    const other = [];
    for (const l of lines) {
      const r = parsePtsLine(l);
      if (!r) { if (!/Parsed_a?showinfo/.test(l)) other.push(l); continue; }
      if (!r.audio) {
        if (r.inst < this.inst) continue;
        if (r.inst > this.inst) { this.inst = r.inst; this.video.clear(); }
        this.video.set(r.n, r.pts); if (this.video.size > 600) this.video.delete(this.video.keys().next().value);
        continue;
      }
      const predicted = this.last ? this.last.pts + (this.samples - this.last.index) / this.fs : NaN;
      if (!this.last || Math.abs(r.pts - predicted) > 0.005 || r.pts - this.lastAt >= 5) {
        this.last = { index: this.samples, pts: r.pts }; this.lastAt = r.pts;
        this.onAnchor?.(this.samples, r.pts);
      }
      this.samples += r.samples;
    }
    return other;
  }
  videoPts(n) { const v = this.video.get(n); if (v !== undefined) this.video.delete(n); return v; }
}

/** 16-byte header of proto 2: 4 ASCII bytes, uint32, float64 (little endian). */
export function packetHeader(magic, count, value) {
  const b = Buffer.alloc(16);
  b.write(magic, 0, 'ascii'); b.writeUInt32LE(count >>> 0, 4); b.writeDoubleLE(value, 8);
  return b;
}

/** Splits a raw f32le stream into 20 ms packets with an LZA1 header; never drops. */
export class AudioPacketizer {
  constructor(sampleRate, channels, send) {
    this.frameBytes = channels * 4;
    this.packetFrames = Math.max(1, Math.round(sampleRate * 0.02));
    this.send = send; this.pending = []; this.bytes = 0; this.index = 0; this.packets = 0;
  }
  push(chunk) {
    this.pending.push(chunk); this.bytes += chunk.length;
    const want = this.packetFrames * this.frameBytes;
    while (this.bytes >= want) this.emit(want);
  }
  flush() { const b = this.bytes - (this.bytes % this.frameBytes); if (b > 0) this.emit(b); }
  emit(len) {
    const all = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending, this.bytes);
    const data = all.subarray(0, len), rest = all.subarray(len);
    this.pending = rest.length ? [rest] : []; this.bytes = rest.length;
    const n = len / this.frameBytes;
    this.send(Buffer.concat([packetHeader('LZA1', n, this.index), data]));
    this.index += n; this.packets++;
  }
}

async function startStream(ws, params) {
  const url = params.get('url') ?? '';
  const problem = validateInput(url);
  if (problem) return fail(ws, problem);
  if (url === 'resolve:') return startResolve(ws, params);
  if (url.startsWith('decklink:')) return startDeckLink(ws, params, url);
  if (url.startsWith('ndi:')) return startNdi(ws, params, url);
  if (url.startsWith('folder:')) return startFolder(ws, params, url);
  const transport = params.get('transport') ?? 'tcp';
  // compressed transport for remote bridges (#16): 8 bit only, decoded by the browser; excludes the Y'CbCr path (#7)
  const h264 = params.get('codec') === 'h264';
  const wantYuv = params.get('format') === 'yuv' && !h264;
  const depth = wantYuv || params.get('depth') === '16' ? 16 : 8;
  const maxWidth = Math.min(3840, Math.max(0, Number(params.get('width') ?? 960) || 0));
  const fpsLimit = Math.min(60, Math.max(0, Number(params.get('fps') ?? 0) || 0));
  const wantAudio = params.get('audio') === '1';

  const device = deviceOptions(params);
  if (url.startsWith('device:') && (!device.pixfmt || !device.size)) {
    // without an explicit choice: the deepest raw format the device lists, and on macOS
    // a defined mode (avfoundation otherwise takes an arbitrary one)
    const formats = await deviceFormats(url);
    device.pixfmt ??= pickPixfmt(formats.pixfmts) ?? undefined;
    if (!device.size && parseDeviceUrl(url)?.fmt === 'avfoundation') device.size = defaultMode(formats.modes) ?? undefined;
  }
  let info;
  try { info = await probe(url, transport, device); } catch (e) { return fail(ws, e); }
  if (ws.readyState !== ws.OPEN) return;
  const audioInfo = wantAudio && info.audio?.sampleRate && info.audio?.channels ? info.audio : null;
  const video = !!info.width && !(wantAudio && params.get('video') === '0');
  if (!video && !audioInfo) return fail(ws, wantAudio ? bmsg('source.noPictureNoSound', 'Neither picture nor sound in this source') : bmsg('source.noVideo', 'No video stream in this source'));
  const { width, height } = video ? outputSize(info.width, info.height, maxWidth) : { width: 0, height: 0 };
  const bytesPerFrame = width * height * 4 * (depth / 8);
  const outDepth = h264 ? 8 : depth;

  // The scale filter converts Y'CbCr → R'G'B' with the stream's own matrix/range but
  // leaves the transfer function untouched, so PQ/HLG code values arrive unchanged.
  const { decodeMatrix, decodeRange } = applyDecodeOverride(decodeParams(info), device);
  const yp = wantYuv ? yuvParams(info, decodeMatrix, decodeRange) : null;
  const vf = h264
    // H.264: stay in Y'CbCr with the source matrix, narrow range; the browser converts with decodeMatrix (src/yuv.ts)
    ? [`scale=${width}:${height}:flags=area:in_color_matrix=${decodeMatrix}:in_range=${decodeRange}:out_color_matrix=${decodeMatrix}:out_range=limited`, 'format=yuv420p']
    : [yp?.yuv ? `scale=${width}:${height}:flags=area:${yp.scale}` : `scale=${width}:${height}:flags=area:in_color_matrix=${decodeMatrix}:in_range=${decodeRange}`];
  // interlaced sources: scale each field on its own (swscale interl) so the two fields of a
  // frame are not blended vertically; the frame itself stays one picture (both fields woven)
  const interlaced = isInterlaced(info.fieldOrder);
  if (interlaced) vf[0] = vf[0].replace(/^scale=([^,]*)/, 'scale=$1:interl=1');
  if (fpsLimit) vf.push(`fps=${fpsLimit}`);
  // time code of every source frame (before scale/fps): showinfo side data, see ShowinfoTracker
  const wantTc = video && params.get('tc') !== '0';
  if (wantTc) vf.unshift('showinfo=checksum=0');
  // srt:// needs an ffmpeg with libsrt (the shipped one has it)
  const ffmpeg = await ffmpegFor(url);
  if (!ffmpeg) return fail(ws, noFfmpegMessage(url));

  // own RTP reception (low-latency mode, server/rtsp.mjs): access units end at the RTP
  // marker bit instead of one frame later in ffmpeg's parser; ffmpeg's RTSP is the fallback
  let own = null, ownNote = null;
  if (params.get('rtp') === 'own' && video) {
    if (!/^rtsp:\/\//i.test(url)) ownNote = bmsg('rtp.ownRtspOnly', 'Own RTP reception only for rtsp:// – ffmpeg receives');
    else {
      try { own = await startOwnRtp(url, { transport: transport === 'udp' ? 'udp' : 'tcp', width: info.width, height: info.height }); } catch (e) { ownNote = bmsg('rtp.ownFailed', `Own RTP reception not possible (${e.message}) – ffmpeg receives`, { reason: toMsg(e) }); }
      if (ws.readyState !== ws.OPEN) { own?.stop(); return; }
    }
  }

  const proto = wantAudio || h264 ? 2 : 1;
  const { audio: _probed, ...videoInfo } = info;
  const msg = { type: 'info', ...videoInfo, decodeMatrix, sourceWidth: info.width, sourceHeight: info.height, sourceFps: info.fps, width, height, depth: outDepth, fps: video ? (fpsLimit || info.fps) : 0 };
  if (interlaced) Object.assign(msg, { interlaced: true });
  if (own) msg.rtp = { own: true, transport: own.info.transport, codec: own.info.codec };
  else if (ownNote) msg.rtp = { own: false, ...field('note', ownNote) };
  if (h264 && video) Object.assign(msg, { transport: 'h264', range: 'tv' });
  else if (yp?.yuv) Object.assign(msg, { format: 'yuv', yuvRange: yp.range, bits: yp.bits });
  else if (yp) Object.assign(msg, { format: 'rgb', note: yp.note, noteCode: yp.noteCode, noteParams: yp.noteParams });
  if (proto === 2) {
    Object.assign(msg, {
      proto: 2,
      audio: audioInfo ? {
        sampleRate: audioInfo.sampleRate, channels: audioInfo.channels, format: 'f32le', layout: audioInfo.layout || '',
        codec: audioInfo.codec, sourceSampleRate: audioInfo.sampleRate, sourceChannels: audioInfo.channels,
      } : null,
    });
  }
  ws.send(JSON.stringify(msg));

  // own reception: the sound needs a second ffmpeg with its own session ('split')
  let sent = 0, dropped = 0, frameNo = 0, stderr = '', closed = false, split = process.env.LZS_AUDIO_SPLIT === '1' || !!own;
  const procs = new Set();
  const packetizer = audioInfo ? new AudioPacketizer(audioInfo.sampleRate, audioInfo.channels, (buf) => { if (ws.readyState === ws.OPEN) ws.send(buf, { binary: true }); }) : null;

  // H.264: whole access units from the FLV demuxer; when the browser falls behind, skip to
  // the next key frame (a dropped delta frame would corrupt everything up to it)
  let waitKey = false;
  const demux = h264 ? new FlvH264Demuxer(({ codec }) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'video', codec, format: 'annexb' }));
  }, ({ key, data }) => {
    if (ws.readyState !== ws.OPEN) return;
    if (key) waitKey = false;
    if (!waitKey && ws.bufferedAmount < 4 * 1024 * 1024) {
      ws.send(Buffer.concat([packetHeader(key ? 'LZHK' : 'LZHD', frameNo, Date.now()), data]), { binary: true });
      sent++;
    } else { waitKey = true; dropped++; }
    frameNo++;
  }) : null;
  // PTS (protocol 2 with picture and sound in one process): from showinfo/ashowinfo on stderr
  let pts = null;
  /** frames waiting for their PTS line (at most 150 ms, then sent with NaN) */
  const waiting = [];
  // latency stamps (server/stamp.mjs) read here on the raw 8-bit R′G′B′ path: stamp → out of
  // ffmpeg, reported with the 1-s stats (the H.264 path carries the bridge clock per frame)
  const stampAges = [];
  const canStamp = video && !h264 && depth === 8 && !yp?.yuv;
  const sendFrame = (no, frame, t) => {
    // Drop instead of queueing when the browser falls behind: scopes want the newest frame.
    // This applies to video only – audio is never dropped.
    if (ws.readyState !== ws.OPEN) return;
    if (canStamp && stampAges.length < 240) {
      const st = readStamp(frame, width, height, 255);
      if (st) stampAges.push(stampAge(st.ms, Date.now()));
    }
    if (ws.bufferedAmount < bytesPerFrame * 2) {
      ws.send(proto === 2 ? Buffer.concat([packetHeader('LZV1', no, t), frame]) : frame, { binary: true });
      sent++;
    } else dropped++;
  };
  const flushWaiting = (force = false) => {
    while (waiting.length) {
      const w = waiting[0];
      const t = pts?.videoPts(w.no);
      if (t === undefined && !force && Date.now() - w.at < 150) break;
      waiting.shift();
      sendFrame(w.no, w.frame, t ?? NaN);
    }
  };
  const onVideo = h264 ? (chunk) => {
    try { demux.push(chunk); } catch (e) { stderr += `\n${e.message}`; }
  } : (chunk) => assembler.push(chunk);
  // whole frames only (server/frames.mjs): never parts of two pictures in one message
  const assembler = new FrameAssembler(bytesPerFrame, (frame) => {
    if (pts) { waiting.push({ no: frameNo, frame, at: Date.now() }); if (waiting.length > 8) flushWaiting(true); flushWaiting(); }
    else sendFrame(frameNo, frame, NaN);
    frameNo++;
  });
  const ptsTimer = setInterval(() => flushWaiting(), 50);

  const finish = (code, text) => {
    if (closed) return;
    closed = true;
    packetizer?.flush();
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: code === 0 ? 'end' : 'error', ...toMsg(text || bmsg('ffmpeg.exit', `ffmpeg exited (${code})`, { code })) }));
      ws.close();
    }
  };

  const launch = (mode) => {
    // PTS (#24) only on the raw path: H.264 packets carry the bridge clock (#16) instead
    const withPts = proto === 2 && video && !!audioInfo && mode === 'fd3' && !h264;
    const args = ffmpegArgs({ url, transport, vf: vf.join(','), depth, video, audio: audioInfo ? mode : 'none', pts: withPts, device, pixFmt: yp?.yuv ? 'ayuv64le' : '', log: wantTc ? 'level+info' : 'error',
      codec: h264 ? 'h264' : 'raw', gop: Math.max(10, Math.round((fpsLimit || info.fps || 25) * 2)), ownInput: own?.inputArgs ?? null });
    const fd3 = mode === 'fd3' && video && !!audioInfo;
    pts = withPts ? new PtsTracker(audioInfo.sampleRate, (index, t) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'apts', index, pts: t })); }) : null;
    const t0 = Date.now();
    let audioBytes = 0;
    const onAudio = (c) => { audioBytes += c.length; packetizer.push(c); };
    const spawnOne = (a, withFd3, tracker, stdin = 'ignore') => {
      const p = spawn(ffmpeg, a, { stdio: withFd3 ? [stdin, 'pipe', 'pipe', 'pipe'] : [stdin, 'pipe', 'pipe'], windowsHide: true });
      procs.add(p);
      // time code (#28): showinfo side data; PTS (#24): PtsTracker; errors go to the stderr tail
      const tc = wantTc ? new ShowinfoTracker((m) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); }, (e) => { stderr = (stderr + '\n' + e).slice(-2000); }) : null;
      p.stderr.on('data', (d) => {
        const text = String(d);
        tc?.push(text);
        if (tracker) {
          const other = tracker.feed(text);
          if (!tc && other.length) stderr = (stderr + '\n' + other.join('\n')).slice(-2000);
          flushWaiting();
        } else if (!tc) stderr = (stderr + text).slice(-2000);
      });
      return p;
    };
    const main = spawnOne(args.main, fd3, pts, own ? 'pipe' : 'ignore');
    if (own) own.attach(main.stdin);
    main.stdout.on('data', video ? onVideo : onAudio);
    if (fd3) main.stdio[3].on('data', onAudio);
    let side = null;
    if (args.audio) {
      side = spawnOne(args.audio, false);
      side.stdout.on('data', onAudio);
      side.on('close', (code) => { procs.delete(side); if (code && !closed) stderr += `\nSound: ffmpeg exited (${code})`; });
    }
    main.on('error', (e) => fail(ws, bmsg('ffmpeg.spawn', `ffmpeg cannot be started: ${e.message}`, { reason: e.message })));
    main.on('close', (code) => {
      procs.delete(main);
      // pipe:3 not usable (e.g. handle inheritance on Windows): retry with a second process
      if (fd3 && code !== 0 && !closed && ws.readyState === ws.OPEN && audioBytes === 0 && Date.now() - t0 < 8000
        && /pipe:3|bad file descriptor|invalid argument|error opening output/i.test(stderr.split('\n').filter((l) => /error|invalid|bad file/i.test(l)).join('\n'))) {
        stderr = ''; split = true;
        return launch('split');
      }
      side?.kill('SIGKILL');
      flushWaiting(true);
      finish(code, lastProblem(stderr));
    });
  };
  launch(split ? 'split' : 'fd3');

  const stats = setInterval(() => {
    if (ws.readyState !== ws.OPEN) return;
    const st = { type: 'stats', sent, dropped };
    if (stampAges.length) { st.stampAge = ageStats(stampAges); stampAges.length = 0; }
    if (packetizer) Object.assign(st, { audioSent: packetizer.packets, audioDropped: 0, audioGaps: 0, audioSplit: split, pts: !!pts });
    if (own) st.rtp = own.report();
    ws.send(JSON.stringify(st));
  }, 1000);
  own?.on('error', (e) => { stderr = (stderr + `\nOwn RTP reception: ${e.message}`).slice(-2000); });
  ws.on('close', () => { clearInterval(stats); clearInterval(ptsTimer); closed = true; own?.stop(); for (const p of procs) p.kill('SIGKILL'); });
}

/** mean/min/max of stamp ages (ms) for the stats message */
export function ageStats(v) {
  let sum = 0, min = Infinity, max = -Infinity;
  for (const x of v) { sum += x; min = Math.min(min, x); max = Math.max(max, x); }
  return { mean: sum / v.length, min, max };
}

/** The line of ffmpeg's stderr that explains an exit (errors first, info lines skipped). */
export function lastProblem(stderr) {
  const lines = stderr.split('\n').map((l) => l.trim()).filter(Boolean);
  const err = lines.filter((l) => /error|fail|invalid|no such|not found|denied|unable|could not|cannot/i.test(l));
  return (err.length ? err : lines).pop() ?? '';
}

/**
 * DaVinci Resolve as input: server/resolve_helper.py exports the current (graded)
 * frame as 16-bit TIFF through Resolve's scripting API; we read it and send frames.
 */
function pythonCandidates() {
  const list = [process.env.LZ_PYTHON, process.platform === 'win32' ? 'python' : '/usr/bin/python3', 'python3'].filter(Boolean);
  return [...new Set(list)];
}

async function startResolve(ws, params) {
  const depth = params.get('depth') === '8' ? 8 : 16;
  const maxWidth = Math.min(3840, Math.max(0, Number(params.get('width') ?? 960) || 0));
  const fps = Math.min(30, Math.max(1, Number(params.get('fps')) || 10));
  const dir = await mkdtemp(join(tmpdir(), 'lz-scopes-resolve-'));
  const helper = fileURLToPath(new URL('./resolve_helper.py', import.meta.url)).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
  let py = null;
  for (const bin of pythonCandidates()) {
    py = spawn(bin, ['-u', helper, dir, String(fps)], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const ok = await new Promise((r) => { py.once('error', () => r(false)); py.once('spawn', () => r(true)); });
    if (ok) break;
    py = null;
  }
  if (!py) return fail(ws, bmsg('resolve.noPython', 'Python 3 not found (needed for the Resolve link)'));
  let sentInfo = false, busy = false, sent = 0, lastWait = '', stderr = '';
  py.stderr.on('data', (d) => { stderr = (stderr + d).slice(-1500); });
  // #88: the scripting API blocks while the timeline plays – tell the page, which can switch
  // to a live window capture meanwhile (src/resolvePlayback.ts)
  const watch = createPlaybackWatch({ fps });
  let project = null;
  const sendState = (ev) => { if (ev && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'resolve', ...ev, project })); };
  const watchTimer = setInterval(() => sendState(watch.check(Date.now())), 200);
  const lines = createInterface({ input: py.stdout });
  lines.on('line', async (line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg.project) project = msg.project;
    sendState(watch.line(Date.now(), msg.tc ?? null));
    if (msg.error) return fail(ws, { message: msg.error, code: msg.code, params: msg.params });
    if (msg.wait) { if (msg.wait !== lastWait && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped: 0, ...toMsg({ message: msg.wait, code: msg.code }) })); lastWait = msg.wait; return; }
    if (busy || ws.readyState !== ws.OPEN || ws.bufferedAmount > 32 * 1024 * 1024) return;
    busy = true;
    try {
      const img = readTiff(await readFile(msg.path));
      const out = toRgba(img, maxWidth, depth);
      if (!sentInfo) {
        ws.send(JSON.stringify({
          type: 'info', width: out.width, height: out.height, depth, fps, codec: `Resolve · ${msg.project} / ${msg.timeline}`,
          pixFmt: `tiff ${img.bits} bit`, sourceWidth: img.width, sourceHeight: img.height,
          transfer: 'unknown', primaries: 'unknown', matrix: 'unknown', range: 'pc', decodeMatrix: img.height > 576 ? 'bt709' : 'bt601',
        }));
        sentInfo = true;
      }
      // timeline time code of this still (Timeline.GetCurrentTimecode), before the frame
      if (msg.tc) ws.send(JSON.stringify({ type: 'tc', tc: msg.tc, kind: 'resolve', fps: msg.fps ?? null, df: !!msg.df }));
      ws.send(Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength), { binary: true });
      sent++;
    } catch (e) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'stats', sent, dropped: 0, ...toMsg(e) }));
    } finally { busy = false; }
  });
  py.on('close', (code) => { clearInterval(watchTimer); if (ws.readyState === ws.OPEN) fail(ws, stderr.trim().split('\n').pop() || bmsg('resolve.exit', `Resolve link ended (${code})`, { code })); rm(dir, { recursive: true, force: true }).catch(() => {}); });
  ws.on('close', () => { clearInterval(watchTimer); py.kill(); });
}

/**
 * Capture devices known to ffmpeg on this machine: video devices as device: URLs and
 * audio devices as audio: URLs ({ name, url, kind: 'video' | 'audio' }).
 */
export function parseDeviceList(stderr, fmt) {
  const out = [];
  if (fmt === 'avfoundation') {
    let kind = '';
    for (const l of stderr.split('\n')) {
      if (/video devices:/i.test(l)) { kind = 'video'; continue; }
      if (/audio devices:/i.test(l)) { kind = 'audio'; continue; }
      const m = /\]\s\[(\d+)\]\s(.+)$/.exec(l);
      if (!m || !kind) continue;
      const name = m[2].trim();
      if (kind === 'video' && !/^Capture screen/i.test(name)) out.push({ name, url: `device:avfoundation:${name}`, kind });
      if (kind === 'audio') out.push({ name, url: `audio:avfoundation:${name}`, kind });
    }
  } else if (fmt === 'dshow') {
    for (const l of stderr.split('\n')) {
      const m = /"([^"]+)"\s*\((video|audio)\)/.exec(l);
      if (m) out.push({ name: m[1], url: `${m[2] === 'video' ? 'device' : 'audio'}:dshow:${m[1]}`, kind: m[2] });
    }
  }
  return out;
}

/** ALSA capture devices from /proc/asound/pcm (`00-00: … : capture 1`) as audio:alsa:hw:C,D. */
export function parseAlsaPcm(text) {
  const out = [];
  for (const l of text.split('\n')) {
    const m = /^(\d+)-(\d+):\s*([^:]*):[^:]*:.*capture/.exec(l);
    if (m) out.push({ name: `${m[3].trim()} (hw:${Number(m[1])},${Number(m[2])})`, url: `audio:alsa:hw:${Number(m[1])},${Number(m[2])}`, kind: 'audio' });
  }
  return out;
}

/** Input devices (demuxers) of an ffmpeg from `ffmpeg -devices` (` D  alsa  ALSA audio input`). */
export function parseInputDevices(text) {
  const out = new Set();
  for (const l of String(text).split('\n')) {
    const m = /^\s*D[\s.E]*\s+([\w,]+)\s/.exec(l);
    if (m) for (const n of m[1].split(',')) out.add(n);
  }
  return out;
}
const indevCache = new Map();
/** What this ffmpeg can open (the shipped Linux build has v4l2 but no ALSA, docs/research/linux.md). */
async function inputDevices(ffmpeg) {
  if (!indevCache.has(ffmpeg)) indevCache.set(ffmpeg, run(ffmpeg, ['-hide_banner', '-devices'], 10000).then((r) => parseInputDevices(r?.out ?? '')));
  return indevCache.get(ffmpeg);
}

async function listDevices() {
  const ffmpeg = ffmpegCandidates()[0];
  if (!ffmpeg) return [];
  if (process.platform === 'linux') {
    const { readdir, readFile: rf } = await import('node:fs/promises');
    const can = await inputDevices(ffmpeg);
    // only what this ffmpeg can open: no ALSA entries for a build without ALSA (the UI must not offer them)
    const video = can.has('v4l2') ? (await readdir('/dev').catch(() => [])).filter((f) => /^video\d+$/.test(f)).map((f) => ({ name: f, url: `device:v4l2:/dev/${f}`, kind: 'video' })) : [];
    const audio = can.has('alsa') ? parseAlsaPcm(await rf('/proc/asound/pcm', 'utf8').catch(() => '')) : [];
    return [...video, ...audio];
  }
  const fmt = process.platform === 'win32' ? 'dshow' : 'avfoundation';
  const r = await run(ffmpeg, ['-hide_banner', '-f', fmt, '-list_devices', 'true', '-i', fmt === 'dshow' ? 'dummy' : ''], 10000);
  return r ? parseDeviceList(r.err, fmt) : [];
}

/** Modes and pixel formats of a capture device (cached 30 s; listing opens the device). */
const formatCache = new Map();
export async function deviceFormats(url) {
  const hit = formatCache.get(url);
  if (hit && Date.now() - hit.t < 30000) return hit.v;
  const ffmpeg = ffmpegCandidates()[0];
  const runs = formatListArgs(url);
  if (!ffmpeg || !runs) return { modes: [], pixfmts: [] };
  const fmt = parseDeviceUrl(url).fmt;
  const v = { modes: [], pixfmts: [] };
  for (const a of runs) {
    const r = await run(ffmpeg, a, 10000);
    if (!r) continue;
    const p = parseFormatList(r.err, fmt);
    v.modes.push(...p.modes);
    for (const x of p.pixfmts) if (!v.pixfmts.includes(x)) v.pixfmts.push(x);
  }
  formatCache.set(url, { t: Date.now(), v });
  return v;
}

/** Default mode: largest 16:9 mode (else largest) that reaches 25 fps. */
export function defaultMode(modes) {
  const ok = modes.filter((m) => !m.fpsMax || m.fpsMax >= 24.9);
  const wide = ok.filter((m) => Math.abs(m.width / m.height - 16 / 9) < 0.02);
  const best = (wide.length ? wide : ok).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  return best ? `${best.width}x${best.height}` : null;
}

/**
 * Blackmagic DeckLink/UltraStudio through the native helper (helpers/decklink, DeckLink
 * SDK). ffmpeg's own decklink device is "nonfree" and must not be redistributed.
 */
export async function deckLinkStatus() {
  const bin = helperPath('lz-decklink');
  if (!bin) return { available: false, helper: false, devices: [], ...field('error', bmsg('decklink.noHelper', 'DeckLink helper not built (helpers/decklink, DeckLink SDK needed)')) };
  const r = await helperList(bin);
  return { available: !!r.ok, helper: true, devices: r.devices ?? [], ...(r.ok ? {} : field('error', r.error ? { message: r.error, code: r.code } : bmsg('decklink.noDriver', 'Desktop Video not installed'))) };
}

/** Reference (genlock) status of one DeckLink device: `lz-decklink --reference <n>` (#72), cached 1 s. */
const refCache = new Map();
export async function deckLinkReference(index) {
  const hit = refCache.get(index);
  if (hit && Date.now() - hit.t < 1000) return hit.v;
  const bin = helperPath('lz-decklink');
  let v;
  if (!bin) v = { ok: false, helper: false, ...field('error', bmsg('decklink.noHelper', 'DeckLink helper not built (helpers/decklink, DeckLink SDK needed)')) };
  else {
    const r = await run(bin, ['--reference', String(index)], 4000);
    try {
      const j = JSON.parse((r?.out ?? '').trim().split('\n').pop() ?? '');
      v = { helper: true, ...j, ...(j.error ? field('error', { message: j.error, code: j.code, params: j.params }) : {}) };
    } catch { v = { ok: false, helper: true, ...field('error', r?.err?.trim().split('\n').pop() || bmsg('decklink.noReference', 'Helper returned no reference status')) }; }
  }
  refCache.set(index, { t: Date.now(), v });
  return v;
}

function startDeckLink(ws, params, url) {
  const bin = helperPath('lz-decklink');
  if (!bin) return fail(ws, bmsg('decklink.unavailable', 'DeckLink not available – helper not built; Desktop Video and the DeckLink SDK are needed (helpers/decklink/README.md)'));
  const ffmpeg = ffmpegCandidates()[0];
  if (!ffmpeg) return fail(ws, bmsg('ffmpeg.missing', 'ffmpeg not found'));
  const index = url.slice('decklink:'.length);
  const pixel = params.get('pixel') === '8' ? '8' : '10';
  startHelperStream(ws, {
    bin, args: ['--capture', index, '--bits', pixel], label: 'DeckLink', params,
    ctx: { ffmpeg, fail, outputSize, decodeParams, applyDecodeOverride, deviceOptions, now: clockNow },
  });
}

/**
 * NDI(R) through the native helper (helpers/ndi). The NDI runtime is installed by the
 * user and loaded by the helper at run time; lz-scopes ships nothing of NDI.
 * NDI(R) is a registered trademark of Vizrt NDI AB.
 */
export async function ndiStatus() {
  const bin = helperPath('lz-ndi');
  if (!bin) return { available: false, helper: false, runtime: false, sources: [], ...field('error', bmsg('ndi.noHelper', 'NDI helper not built (npm run build:helpers)')) };
  const r = await helperList(bin, ['--wait', '1500']);
  return { available: !!r.ok, helper: true, runtime: !!r.runtime, version: r.version, sources: r.sources ?? [], ...(r.ok ? {} : field('error', { message: r.error ?? '', code: r.code })) };
}

/** Watch folders released with --watch-dir / LZS_WATCH_DIRS (server/folder.mjs). */
let WATCH_ROOTS = watchRoots();
/** Release one more folder (desktop app: chosen by the user in a native dialog). */
export function addWatchDir(dir) {
  WATCH_ROOTS = watchRoots([...WATCH_ROOTS.flatMap((r) => ['--watch-dir', r.dir]), '--watch-dir', dir], {});
  const root = WATCH_ROOTS.find((r) => r.dir === resolve(dir));
  return { name: root.name, url: `folder:${root.name}` };
}
function startFolder(ws, params, url) {
  const root = resolveFolder(url, WATCH_ROOTS);
  if (!root) return fail(ws, bmsg('folder.notReleased', 'Folder not released – start the bridge with --watch-dir <folder>'));
  const ffmpeg = ffmpegCandidates()[0];
  if (!ffmpeg) return fail(ws, bmsg('ffmpeg.missing', 'ffmpeg not found'));
  startFolderStream(ws, { root, params, ctx: { ffmpeg, outputSize, decodeParams, applyDecodeOverride, deviceOptions } });
}

function startNdi(ws, params, url) {
  const bin = helperPath('lz-ndi');
  if (!bin) return fail(ws, bmsg('ndi.unavailable', 'NDI not available – helper not built (npm run build:helpers)'));
  const ffmpeg = ffmpegCandidates()[0];
  if (!ffmpeg) return fail(ws, bmsg('ffmpeg.missing', 'ffmpeg not found'));
  startHelperStream(ws, {
    bin, args: ['--capture', url.slice('ndi:'.length)], label: 'NDI', params,
    ctx: { ffmpeg, fail, outputSize, decodeParams, applyDecodeOverride, deviceOptions, now: clockNow },
  });
}

/** Send an error (text, Error or message object, server/messages.mjs) and close. */
function fail(ws, m) {
  if (ws.readyState === ws.OPEN) { ws.send(JSON.stringify({ type: 'error', ...toMsg(m) })); ws.close(); }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

const server = createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  if (path === '/allow') return handleAllow(req, res);
  if (path === '/api/clock-access') {
    if (req.method === 'OPTIONS') {
      // CORS / Private Network Access preflight of a page from another origin (no data in it)
      res.writeHead(204, { ...(req.headers.origin ? { 'access-control-allow-origin': req.headers.origin, vary: 'Origin' } : {}), 'access-control-allow-private-network': 'true', 'access-control-allow-methods': 'GET' });
      return res.end();
    }
    // may this page use /clock? Answered to any page (the answer reveals nothing else)
    const origin = req.headers.origin ?? '';
    const problem = clockAccess({ remote: req.socket.remoteAddress, origin, host: req.headers.host, store: ORIGINS });
    res.writeHead(200, { 'content-type': 'application/json', ...(origin ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) });
    return res.end(JSON.stringify({ allowed: !problem, origin: normalizeOrigin(origin) }));
  }
  if (path === '/api/health') {
    // which ffmpeg runs, read from the binary: origin, version, licence, SRT (UI: Bridge, output menu)
    const cands = ffmpegCandidates();
    return Promise.all([ffmpegInfo(cands[0]), ffmpegFor('srt://x', cands)]).then(async ([ffmpeg, srtBin]) => {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      const srt = srtBin && srtBin !== ffmpeg?.path ? await ffmpegInfo(srtBin) : null;
      res.end(JSON.stringify({ ok: true, name: 'lz-scopes-bridge', patterns: Object.keys(TEST_PATTERNS), ffmpeg, ...(srt ? { ffmpegSrt: srt } : {}) }));
    });
  }
  const mj = /^\/out\/([\w-]+)\.mjpeg$/.exec(path);
  if (mj) return serveMjpeg(mj[1], res);
  if (path === '/api/devices/formats') {
    const url = new URL(req.url ?? '/', 'http://x').searchParams.get('url') ?? '';
    const json = (code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(body)); };
    if (!parseDeviceUrl(url) || validateInput(url)) return json(400, field('error', bmsg('input.deviceUrl', 'device: URL expected')));
    deviceFormats(url).then((f) => json(200, { ...f, preferred: pickPixfmt(f.pixfmts), defaultSize: defaultMode(f.modes) }));
    return;
  }
  if (path === '/api/resolve') {
    const helper = fileURLToPath(new URL('./resolve_helper.py', import.meta.url)).replace(`app.asar${sep}`, `app.asar.unpacked${sep}`);
    resolveStatus({ helper, python: pythonCandidates() }).then((st) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(st)); });
    return;
  }
  if (path === '/api/folders') {
    // names only – the paths stay on the bridge machine
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify(WATCH_ROOTS.map((r) => ({ name: r.name, url: `folder:${r.name}` }))));
  }
  if (path === '/api/ndi') {
    ndiStatus().then((st) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(st)); });
    return;
  }
  if (path === '/api/decklink/reference') {
    const index = Math.max(0, Math.min(63, Number(new URL(req.url ?? '/', 'http://x').searchParams.get('index')) || 0));
    deckLinkReference(index).then((st) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(st)); });
    return;
  }
  if (path === '/api/decklink') {
    deckLinkStatus().then((st) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(st)); });
    return;
  }
  if (path === '/api/devices') {
    listDevices().then((list) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(list)); });
    return;
  }
  if (path === '/api/control' || path === '/api/control/commands') return handleControlHttp(req, res, path);
  if (path === '/api/meter') {
    // colour meter (ArgyllCMS spotread, server/meter.mjs): local app only
    const problem = controlAccess({ remote: req.socket.remoteAddress, origin: req.headers.origin, host: req.headers.host });
    if (problem) { res.writeHead(problem.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: problem.error })); }
    meterInfo().then((info) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(info)); });
    return;
  }
  if (path === '/api/outputs') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify([...outputs.entries()].map(([name, o]) => ({ name, url: `/out/${name}.mjpeg`, viewers: o.clients.size, target: o.target || null }))));
  }
  if (DEV) { res.writeHead(404); return res.end('bridge only (dev mode) – UI via vite'); }
  let file = normalize(join(DIST, decodeURIComponent(path)));
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html');
  if (!existsSync(file)) { res.writeHead(500); return res.end('dist missing – run `npm run build` first'); }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
wss.on('connection', (ws, req) => {
  startStream(ws, new URL(req.url ?? '', 'http://x').searchParams).catch((e) => fail(ws, e));
});

// ---- outputs: the UI sends JPEG frames of an output window; served as MJPEG and optionally pushed
/** @type {Map<string, { frame: Buffer | null, clients: Set<import('node:http').ServerResponse>, ff: import('node:child_process').ChildProcess | null, target: string }>} */
const outputs = new Map();
const outWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 40 * 1024 * 1024 }); // 10-bit UHD: 3840·2160·4 B

/** Container format for a push target, or null if the URL is not allowed. */
export function pushFormat(target) {
  if (!/^(rtmps?|srt|rtsp|udp|tcp):\/\//i.test(target) || target.length > 2048) return null;
  return /^rtmp/i.test(target) ? 'flv' : /^rtsp/i.test(target) ? 'rtsp' : 'mpegts';
}

outWss.on('connection', (ws, req) => {
  const q = new URL(req.url ?? '', 'http://x').searchParams;
  // 10-bit frames (yuv422p10le) → ffmpeg push, no MJPEG (server/out10.mjs)
  if (q.get('depth') === '10') return handleOut10(ws, q, ffmpegCandidates());
  const name = (q.get('name') ?? '').replace(/[^\w-]/g, '').slice(0, 40) || 'out';
  const fps = Math.min(60, Math.max(1, Number(q.get('fps')) || 25));
  const target = q.get('target') ?? '';
  const out = outputs.get(name) ?? { frame: null, clients: new Set(), ff: null, target: '' };
  outputs.set(name, out);
  const msg = (type, m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type, ...toMsg(m) }));
  const fmt = target ? pushFormat(target) : null;
  if (target && !fmt) msg('error', bmsg('push.scheme', 'Push target only rtmp(s)://, srt://, rtsp://, udp://'));
  // srt:// needs an ffmpeg with libsrt (the shipped one has it); frames before the start are only kept as MJPEG
  if (fmt) ffmpegFor(target).then((ffmpeg) => {
    if (ws.readyState !== ws.OPEN) return;
    if (!ffmpeg) msg('error', noFfmpegMessage(target));
    else {
      out.ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', String(fps * 2), '-f', fmt, target],
      { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
      out.target = target;
      let err = '';
      out.ff.stderr.on('data', (d) => { err = (err + d).slice(-1000); });
      out.ff.on('close', (code) => { if (code) { const why = err.trim().split('\n').pop() || String(code); msg('error', bmsg('push.exit', `Push ended: ${why}`, { reason: why })); } out.ff = null; });
      out.ff.stdin.on('error', () => {});
    }
  });
  msg('live', `/out/${name}.mjpeg${target ? ` → ${target}` : ''}`);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const frame = Buffer.from(data);
    out.frame = frame;
    for (const res of out.clients) {
      if (res.writableLength > frame.length * 2) continue; // slow viewer: skip
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      res.write(frame); res.write('\r\n');
    }
    if (out.ff?.stdin.writable && out.ff.stdin.writableLength < frame.length * 3) out.ff.stdin.write(frame);
  });
  ws.on('close', () => {
    out.ff?.stdin.end(); out.ff?.kill('SIGTERM'); out.ff = null;
    for (const res of out.clients) res.end();
    outputs.delete(name);
  });
});

function serveMjpeg(name, res) {
  const out = outputs.get(name);
  if (!out) { res.writeHead(404); return res.end('no output with this name'); }
  res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
  out.clients.add(res);
  res.on('close', () => out.clients.delete(res));
}

// ---- clock: passive PTP monitor and ST 2110 RTP check (server/ptp.mjs), WebSocket /clock
//   → {type:'ptp', …status, ifaces, rtp}  4 Hz
//   ← {type:'config', iface, delayReq}   {type:'rtp', group, port, rateNum, rateDen} | {type:'rtp', off:true}
const clockClients = new Set();
let ptpMon = null, ptpKey = '', rtpMon = null, clockStopTimer = null;
const clockWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 16 * 1024 });

async function ensurePtp(iface, delayReq) {
  const key = `${iface}|${delayReq}`;
  if (ptpMon && ptpKey === key) return;
  ptpMon?.stop();
  ptpKey = key;
  ptpMon = new PtpMonitor({ iface, delayReq });
  await ptpMon.start();
}

/** GM time in PTP seconds from the local clock and the PTP estimate; `ref` says which. */
function clockNow() {
  const st = ptpMon?.status();
  const utcNs = nowUtcNs();
  const utcMs = Number(utcNs / 1_000_000n);
  const tai = st?.gm?.utcOffsetValid ? st.gm.currentUtcOffset : taiMinusUtc(utcMs);
  const off = st?.state === 'receiving' && st.offsetNs !== null ? st.offsetNs : null;
  return { seconds: Number(utcNs) / 1e9 + tai - (off ?? 0) / 1e9, ref: off === null ? 'system' : 'ptp' };
}

clockWss.on('connection', (ws) => {
  clockClients.add(ws);
  if (clockStopTimer) { clearTimeout(clockStopTimer); clockStopTimer = null; }
  let cfg = { iface: '', delayReq: false };
  ensurePtp(cfg.iface, cfg.delayReq).catch(() => {});
  const tick = setInterval(() => {
    if (ws.readyState !== ws.OPEN || !ptpMon) return;
    ws.send(JSON.stringify({
      type: 'ptp', ...ptpMon.status(), ifaces: ipv4Interfaces(), serverUtcMs: Date.now(),
      rtp: rtpMon ? { ...rtpMon.status(), ref: clockNow().ref } : null,
    }));
  }, 250);
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let m;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (m.type === 'config') {
      const iface = typeof m.iface === 'string' && ipv4Interfaces().some((i) => i.address === m.iface) ? m.iface : '';
      cfg = { iface, delayReq: m.delayReq === true };
      ensurePtp(cfg.iface, cfg.delayReq).catch(() => {});
    } else if (m.type === 'rtp') {
      rtpMon?.stop(); rtpMon = null;
      const port = Number(m.port), num = Number(m.rateNum) || 25, den = Number(m.rateDen) || 1;
      if (!m.off && isMulticastV4(m.group) && port >= 1024 && port <= 65535) {
        rtpMon = new RtpMonitor({ group: m.group, port, iface: cfg.iface, rateNum: num, rateDen: den, ptpNow: () => clockNow().seconds }).start();
      }
    }
  });
  ws.on('close', () => {
    clearInterval(tick);
    clockClients.delete(ws);
    if (!clockClients.size) clockStopTimer = setTimeout(() => { ptpMon?.stop(); ptpMon = null; ptpKey = ''; rtpMon?.stop(); rtpMon = null; }, 5000);
  });
});

// ---- control API: HTTP POST /api/control and WebSocket /control (Companion, curl).
// The main window of the UI connects as /control?role=app, executes the commands and
// reports its state; the bridge only validates, forwards and relays.
/** @type {Set<import('ws').WebSocket>} */
const appClients = new Set();
/** @type {Set<import('ws').WebSocket>} */
const controlClients = new Set();
/** @type {Map<string, (reply: { ok: boolean, error?: string, result?: unknown }) => void>} */
const pending = new Map();
let appState = null, seq = 0;
const meterWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 4 * 1024 * 1024 });
const ctlWss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 256 * 1024 });

const presentedToken = (req) => {
  const auth = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
  return auth ?? new URL(req.url ?? '', 'http://x').searchParams.get('token');
};
const accessProblem = (req) => controlAccess({
  remote: req.socket.remoteAddress, token: CONTROL_TOKEN, presented: presentedToken(req),
  origin: req.headers.origin, host: req.headers.host,
});

/** Forward a validated command to the main window; resolves with its reply. */
export function sendToApp(command, timeoutMs = 4000) {
  const app = [...appClients].pop();
  if (!app) return Promise.resolve({ ok: false, status: 503, error: 'No LZ Scopes main window connected' });
  const id = `c${++seq}`;
  return new Promise((ok) => {
    const timer = setTimeout(() => { pending.delete(id); ok({ ok: false, status: 504, error: 'Main window does not answer' }); }, timeoutMs);
    pending.set(id, (reply) => { clearTimeout(timer); ok(reply); });
    app.send(JSON.stringify({ type: 'command', id, command }));
  });
}

async function runControl(raw) {
  const v = validateCommand(raw);
  if (!v.ok) return { status: 400, body: { ok: false, error: v.error } };
  const reply = await sendToApp(v.command);
  return { status: reply.ok ? 200 : reply.status ?? 422, body: { ok: reply.ok, ...(reply.error ? { error: reply.error } : {}), ...(reply.result !== undefined ? { result: reply.result } : {}), state: appState } };
}

function handleControlHttp(req, res, path) {
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const problem = accessProblem(req);
  if (problem) return send(problem.status, { ok: false, error: problem.error });
  if (path === '/api/control/commands') return send(200, COMMANDS);
  if (req.method === 'GET') return send(200, { ok: true, connected: appClients.size > 0, state: appState });
  if (req.method !== 'POST') return send(405, { ok: false, error: 'GET or POST' });
  // JSON only: a foreign web page cannot send that without a CORS preflight, which we never allow
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(415, { ok: false, error: 'Content-Type: application/json' });
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 64 * 1024) req.destroy(); });
  req.on('end', async () => {
    let raw;
    try { raw = JSON.parse(body); } catch { return send(400, { ok: false, error: 'Invalid JSON' }); }
    const r = await runControl(raw);
    send(r.status, r.body);
  });
}

ctlWss.on('connection', (ws, req) => {
  const role = new URL(req.url ?? '', 'http://x').searchParams.get('role');
  if (role === 'app') {
    appClients.add(ws);
    broadcast({ type: 'connected', connected: true });
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      let m;
      try { m = JSON.parse(String(data)); } catch { return; }
      if (m.type === 'state') { appState = m.state; broadcast({ type: 'state', state: appState }); }
      else if (m.type === 'result' && pending.has(m.id)) { const done = pending.get(m.id); pending.delete(m.id); done(m); }
    });
    ws.on('close', () => {
      appClients.delete(ws);
      if (!appClients.size) { appState = null; broadcast({ type: 'connected', connected: false }); }
    });
    return;
  }
  controlClients.add(ws);
  ws.send(JSON.stringify({ type: 'hello', name: 'lz-scopes', connected: appClients.size > 0, state: appState, commands: Object.keys(COMMANDS) }));
  ws.on('message', async (data, isBinary) => {
    if (isBinary) return;
    let raw;
    try { raw = JSON.parse(String(data)); } catch { return ws.send(JSON.stringify({ type: 'result', ok: false, error: 'Invalid JSON' })); }
    const r = await runControl(raw);
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'result', id: raw?.id ?? null, ...r.body, state: undefined }));
  });
  ws.on('close', () => controlClients.delete(ws));
});

function broadcast(msg) {
  const text = JSON.stringify(msg);
  for (const c of controlClients) if (c.readyState === c.OPEN) c.send(text);
}

server.on('upgrade', (req, socket, head) => {
  const path = new URL(req.url ?? '', 'http://x').pathname;
  if (path === '/control') {
    // the main window is always local and same-origin; it needs no token
    const isApp = new URL(req.url ?? '', 'http://x').searchParams.get('role') === 'app';
    const problem = isApp ? controlAccess({ remote: req.socket.remoteAddress, origin: req.headers.origin, host: req.headers.host }) : accessProblem(req);
    if (problem) {
      socket.end(`HTTP/1.1 ${problem.status} ${problem.status === 401 ? 'Unauthorized' : 'Forbidden'}\r\n\r\n`);
      return;
    }
    return ctlWss.handleUpgrade(req, socket, head, (ws) => ctlWss.emit('connection', ws, req));
  }
  if (path === '/meter') {
    // spotread drives measuring hardware: only the local app (same origin, loopback)
    const problem = controlAccess({ remote: req.socket.remoteAddress, origin: req.headers.origin, host: req.headers.host });
    if (problem) { socket.end(`HTTP/1.1 ${problem.status} Forbidden\r\n\r\n`); return; }
    return meterWss.handleUpgrade(req, socket, head, (ws) => handleMeterSocket(ws));
  }
  if (path === '/clock') {
    // network details (interfaces, grandmaster) only for the local UI of the same origin
    const problem = clockAccess({ remote: req.socket.remoteAddress, origin: req.headers.origin, host: req.headers.host, store: ORIGINS });
    if (problem) { socket.end(`HTTP/1.1 ${problem.status} Forbidden\r\n\r\n`); return; }
    return clockWss.handleUpgrade(req, socket, head, (ws) => clockWss.emit('connection', ws, req));
  }
  const target = path === '/stream' ? wss : path === '/out' ? outWss : null;
  if (!target) return socket.destroy();
  target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
});

/** GET /allow?origin=… shows the consent page; POST adds or removes an origin. */
function handleAllow(req, res) {
  if (!isLoopbackAddr(req.socket.remoteAddress)) { res.writeHead(403); return res.end(); }
  const q = new URL(req.url ?? '', 'http://x').searchParams;
  if (req.method === 'GET') { res.writeHead(200, CONSENT_HEADERS); return res.end(consentPage(q.get('origin'), ORIGINS, newNonce(), consentLang(req.headers['accept-language']))); }
  if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
  // the form must come from this very page: Origin = the bridge itself, plus its one-time nonce
  let own = '';
  try { own = new URL(req.headers.origin ?? '').host; } catch { /* missing */ }
  if (own !== req.headers.host) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Only through the consent page of the bridge'); }
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy(); });
  req.on('end', () => {
    const f = new URLSearchParams(body);
    if (!takeNonce(f.get('nonce') ?? '')) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); return res.end('Page expired – please reload'); }
    const origin = f.get('origin') ?? '';
    if (f.get('action') === 'add') ORIGINS.add(origin); else if (f.get('action') === 'remove') ORIGINS.remove(origin);
    res.writeHead(200, CONSENT_HEADERS);
    res.end(consentPage(f.get('action') === 'add' ? origin : null, ORIGINS, newNonce(), consentLang(req.headers['accept-language'])));
  });
}

/**
 * Start the bridge. Used by the CLI below and by the desktop app (electron/main.cjs),
 * which passes port 0 for a free port and its own dist folder.
 */
export function startBridge({ port = 4192, host = '127.0.0.1', dist, dev = false, controlToken, watchDirs, configDir, allowOrigins = [] } = {}) {
  if (dist) DIST = resolve(dist);
  ORIGINS = new OriginStore(configDir ? join(configDir, 'allowed-origins.json') : defaultOriginsFile());
  for (const o of allowOrigins) ORIGINS.allowTemporarily(o);
  if (watchDirs) WATCH_ROOTS = watchRoots(watchDirs.flatMap((d) => ['--watch-dir', d]), {});
  if (controlToken !== undefined) CONTROL_TOKEN = controlToken;
  DEV = dev;
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, host, async () => {
      const p = server.address().port;
      // the iPhone/iPad app finds a bridge that listens on the network via Bonjour (server/bonjour.mjs)
      const mdns = await announce({ port: p, host });
      ok({ port: p, bonjour: mdns?.name ?? null, close: () => { mdns?.stop(); server.close(); } });
    });
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(arg('port', process.env.PORT ?? 4192)), host = arg('host', process.env.HOST ?? '127.0.0.1');
  const allowOrigins = args.flatMap((a, i) => (a === '--allow-origin' && args[i + 1] ? [args[i + 1]] : []));
  startBridge({ port, host, dev: DEV, configDir: arg('config-dir', process.env.LZS_CONFIG_DIR), allowOrigins }).then(({ port: p, bonjour }) => {
    console.log(`lz-scopes bridge on http://${host}:${p}${DEV ? ' (dev)' : ''} · ffmpeg: ${ffmpegCandidates()[0] ?? 'not found'}${bonjour ? ` · Bonjour: ${bonjour}` : ''}`);
  });
}
