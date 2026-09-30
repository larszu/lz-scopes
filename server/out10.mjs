// 10-bit output stream (docs/research/10bit-ausgabe.md): an output window sends exact
// yuv422p10le frames (src/deep.ts, frame10Buffer) over the /out WebSocket with depth=10;
// ffmpeg encodes them and pushes them to the target.
//
//   hevc10   libx265 Main 10 (4:2:0), MPEG-TS/RTSP     – most receivers decode it
//   hevc422  libx265 Main 4:2:2 10, MPEG-TS/RTSP       – keeps the 4:2:2 chroma
//   v210     uncompressed 4:2:2 10 bit in NUT           – bit-exact, ~1.1 Gbit/s at 1080p25
//   prores   prores_ks 422 HQ in NUT                    – 10 bit, visually lossless
//
// ffmpeg-static 5.3.0 (the ffmpeg the desktop app ships) has all four encoders, but no SRT:
// srt:// needs an ffmpeg with libsrt ($FFMPEG or Homebrew), picked here when there is one.
// The bridge repeats the newest frame at the stream's frame rate, so ffmpeg gets an even
// input clock even when the window draws slower.

import { spawn } from 'node:child_process';

export const CODECS10 = {
  hevc10: { args: (fps) => ['-c:v', 'libx265', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p10le', '-x265-params', `repeat-headers=1:keyint=${fps * 2}:log-level=error`], mux: 'ts' },
  hevc422: { args: (fps) => ['-c:v', 'libx265', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv422p10le', '-x265-params', `repeat-headers=1:keyint=${fps * 2}:log-level=error`], mux: 'ts' },
  v210: { args: () => ['-c:v', 'v210'], mux: 'nut' },
  prores: { args: () => ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'], mux: 'nut' },
};

export const HEADER10 = 12;

/** Parses the 12-byte header of a 10-bit frame; null if it is not one or the size is off. */
export function parseFrame10(buf) {
  if (buf.length < HEADER10 || buf.toString('latin1', 0, 4) !== 'LZ10') return null;
  const w = buf.readUInt16LE(4), h = buf.readUInt16LE(6);
  if (!w || !h || w % 2 || buf.length !== HEADER10 + w * h * 4) return null;
  const tf = buf[10];
  return { w, h, full: (buf[8] & 1) === 1, matrix: buf[9] === 1 ? '2020' : '709', transfer: tf === 1 ? 'pq' : tf === 2 ? 'hlg' : 'sdr' };
}

/** Container for target + codec, or an error text. */
export function out10Format(target, codec) {
  const c = CODECS10[codec];
  if (!c) return { error: `Codec: ${Object.keys(CODECS10).join(', ')}` };
  if (typeof target !== 'string' || target.length > 2048) return { error: 'Push-Ziel fehlt' };
  if (/^rtmps?:\/\//i.test(target)) return { error: 'RTMP/FLV trägt kein 10-bit-HEVC (ffmpeg 6.0) – udp://, tcp://, srt://, rtp:// oder rtsp:// verwenden' };
  if (c.mux === 'nut') {
    if (!/^(tcp|srt|udp):\/\//i.test(target)) return { error: `${codec} geht nur über tcp://, srt:// oder udp:// (NUT-Container)` };
    return { format: 'nut' };
  }
  if (/^rtsp:\/\//i.test(target)) return { format: 'rtsp' };
  if (/^rtp:\/\//i.test(target)) return { format: 'rtp_mpegts' };
  if (/^(udp|tcp|srt):\/\//i.test(target)) return { format: 'mpegts' };
  return { error: 'Push-Ziel nur udp://, tcp://, srt://, rtp:// oder rtsp://' };
}

/** ffmpeg arguments: raw yuv422p10le on stdin → codec → target. */
export function out10Args({ w, h, fps, codec, target, full, matrix, transfer }) {
  const f = out10Format(target, codec);
  if (f.error) throw new Error(f.error);
  const trc = transfer === 'pq' ? 'smpte2084' : transfer === 'hlg' ? 'arib-std-b67' : 'bt709';
  const prim = matrix === '2020' ? 'bt2020' : 'bt709', space = matrix === '2020' ? 'bt2020nc' : 'bt709';
  return [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'yuv422p10le', '-video_size', `${w}x${h}`, '-framerate', String(fps), '-i', 'pipe:0',
    ...CODECS10[codec].args(fps),
    '-color_range', full ? 'pc' : 'tv', '-colorspace', space, '-color_primaries', prim, '-color_trc', trc,
    '-f', f.format, target,
  ];
}

const srtCache = new Map();
/** Does this ffmpeg list srt among its output protocols? */
function hasSrt(ffmpeg) {
  if (!srtCache.has(ffmpeg)) {
    srtCache.set(ffmpeg, new Promise((ok) => {
      let out = '';
      const p = spawn(ffmpeg, ['-hide_banner', '-protocols'], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
      p.stdout.on('data', (d) => { out += d; });
      p.on('error', () => ok(false));
      p.on('close', () => ok(/^\s*srt\s*$/m.test(out.split(/Output:/)[1] ?? '')));
    }));
  }
  return srtCache.get(ffmpeg);
}

/**
 * One 10-bit output connection. `ffmpegs` = candidates in order (server/index.mjs).
 * Messages to the window: {type:'live'|'error', message}.
 */
export function handleOut10(ws, q, ffmpegs) {
  const target = q.get('target') ?? '', codec = q.get('codec') ?? '';
  const fps = Math.min(60, Math.max(1, Number(q.get('fps')) || 25));
  const msg = (type, message) => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ type, message }));
  const f = out10Format(target, codec);
  if (f.error) { msg('error', f.error); ws.close(); return; }
  let ff = null, key = '', last = null, closed = false, err = '';
  const pick = async () => {
    if (!/^srt:/i.test(target)) return ffmpegs[0];
    for (const c of ffmpegs) if (await hasSrt(c)) return c;
    return null;
  };
  const start = async (meta) => {
    const ffmpeg = await pick();
    if (closed) return;
    if (!ffmpeg) { msg('error', ffmpegs.length ? 'kein ffmpeg mit SRT gefunden (ffmpeg-static hat keins) – FFMPEG setzen oder Homebrew-ffmpeg installieren' : 'ffmpeg nicht gefunden'); return; }
    const args = out10Args({ ...meta, fps, codec, target });
    const p = spawn(ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    ff = p;
    p.stderr.on('data', (d) => { err = (err + d).slice(-1000); });
    p.stdin.on('error', () => {});
    p.on('error', (e) => msg('error', `ffmpeg nicht startbar: ${e.message}`));
    p.on('close', (code) => { if (ff === p) ff = null; if (code && !closed) msg('error', `Push beendet: ${err.trim().split('\n').pop() || code}`); });
    msg('live', `10 bit ${codec} ${meta.w}×${meta.h} → ${target}`);
  };
  const timer = setInterval(() => {
    if (!ff?.stdin.writable || !last) return;
    if (ff.stdin.writableLength > last.length * 2) return; // encoder behind: drop
    ff.stdin.write(last);
  }, 1000 / fps);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) return;
    const buf = Buffer.from(data);
    const meta = parseFrame10(buf);
    if (!meta) { msg('error', 'kein gültiges 10-bit-Bild (Kopf LZ10, gerade Breite, Größe)'); return; }
    const k = JSON.stringify(meta);
    if (k !== key) { key = k; ff?.stdin.end(); ff?.kill('SIGTERM'); ff = null; start(meta); }
    last = buf.subarray(HEADER10);
  });
  ws.on('close', () => { closed = true; clearInterval(timer); ff?.stdin.end(); ff?.kill('SIGTERM'); ff = null; });
}
