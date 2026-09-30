// Stamped test source for latency measurements (#16): renders frames with the current
// wall-clock time and a frame counter (server/stamp.mjs), encodes them with ffmpeg/x264
// (zero latency, no B-frames) and publishes them, e.g. to mediamtx:
//
//   brew install mediamtx ffmpeg && mediamtx &
//   node scripts/latency-source.mjs rtsp://127.0.0.1:8554/latency [--size 1280x720] [--fps 25]
//
// In LZ Scopes add "RTSP / Netz" with that URL and open "Messwerte": the latency lines
// appear as soon as stamped frames arrive. The time is taken when the frame is handed to
// ffmpeg, so encoding, publishing, mediamtx, the bridge's decoding and the transfer are
// all included; the monitor's own delay is not.

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drawStamp } from '../server/stamp.mjs';
import { ffmpegCandidates } from '../server/index.mjs';

export function startLatencySource(target, { width = 1280, height = 720, fps = 25, ffmpeg = ffmpegCandidates()[0] } = {}) {
  if (!ffmpeg) throw new Error('ffmpeg nicht gefunden');
  const fmt = /^rtsp/i.test(target) ? ['-f', 'rtsp', '-rtsp_transport', 'tcp'] : /^rtmp/i.test(target) ? ['-f', 'flv'] : /^srt|^udp/i.test(target) ? ['-f', 'mpegts'] : [];
  const ff = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${width}x${height}`, '-r', String(fps), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-bf', '0', '-g', String(fps), '-pix_fmt', 'yuv420p',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', ...fmt, target], { stdio: ['pipe', 'ignore', 'inherit'] });
  ff.stdin.on('error', () => {});
  const frame = new Uint8Array(width * height * 4);
  // background: grey ramp 10 … 90 % with a moving bar, so the scopes show motion
  let n = 0;
  const t0 = Date.now();
  const tick = () => {
    const bar = Math.floor(((n * 8) % width));
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = Math.abs(x - bar) < 16 ? 235 : Math.round(25 + (x / width) * 205);
        frame[i] = frame[i + 1] = frame[i + 2] = v; frame[i + 3] = 255;
      }
    }
    drawStamp(frame, width, height, Date.now(), n);
    if (ff.stdin.writable && ff.stdin.writableLength < frame.length * 2) ff.stdin.write(Buffer.from(frame));
    n++;
  };
  // schedule against the start time so the rate does not drift
  let timer = null;
  const loop = () => { tick(); timer = setTimeout(loop, Math.max(0, t0 + (n * 1000) / fps - Date.now())); };
  loop();
  return { stop: () => { clearTimeout(timer); ff.stdin.end(); ff.kill('SIGTERM'); }, process: ff };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const target = args.find((a) => /^\w+:\/\//.test(a));
  if (!target) { console.error('Ziel angeben, z. B. rtsp://127.0.0.1:8554/latency'); process.exit(1); }
  const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
  const [width, height] = (opt('size') ?? '1280x720').split('x').map(Number);
  const src = startLatencySource(target, { width, height, fps: Number(opt('fps') ?? 25) });
  console.log(`Latenz-Testbild ${width}×${height} → ${target} (Strg+C beendet)`);
  process.on('SIGINT', () => { src.stop(); process.exit(0); });
}
