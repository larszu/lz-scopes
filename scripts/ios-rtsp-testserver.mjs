#!/usr/bin/env node
// Local RTSP test server for the iOS direct reception (#90): mediamtx on 127.0.0.1:<port>
// (TCP and UDP, Basic and Digest) with ffmpeg publishing SMPTE HD bars (RP 219):
//   rtsp://127.0.0.1:<port>/h264        H.264, readable without credentials
//   rtsp://127.0.0.1:<port>/hevc        HEVC, readable without credentials
//   rtsp://lzs:scopes@127.0.0.1:<port>/auth   H.264, credentials required (test-only account)
// Runs until killed. Used by the Swift integration tests (LZS_RTSP_TEST_PORT) and the iOS
// simulator job in .github/workflows/ios.yml. Needs mediamtx and ffmpeg (libx264, libx265).
// Usage: node scripts/ios-rtsp-testserver.mjs [port=8554] [size=1280x720]

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const port = Number(process.argv[2] ?? 8554), size = process.argv[3] ?? '1280x720';
const which = (b) => spawnSync('which', [b]).stdout.toString().trim() || null;
// ffmpeg: LZS_FFMPEG, else the build the desktop app ships (npm run ffmpeg:fetch), else the system one
const vendored = ['darwin-universal', 'darwin-arm64', 'darwin-x64', `${process.platform}-${process.arch}`]
  .map((t) => join(import.meta.dirname, '..', 'vendor', 'ffmpeg', t, 'ffmpeg')).find((f) => existsSync(f));
const MTX = process.env.LZS_MEDIAMTX || which('mediamtx'), FFMPEG = process.env.LZS_FFMPEG || vendored || which('ffmpeg');
if (!MTX || !FFMPEG) { console.error('mediamtx and ffmpeg needed (brew install mediamtx ffmpeg)'); process.exit(1); }

const dir = mkdtempSync(join(tmpdir(), 'lzs-rtsp-'));
const rtp = 30000 + 2 * Math.floor(Math.random() * 5000);
writeFileSync(join(dir, 'mediamtx.yml'), [
  'logLevel: warn', `rtspAddress: 127.0.0.1:${port}`, 'rtspTransports: [tcp, udp]', `rtpAddress: :${rtp}`, `rtcpAddress: :${rtp + 1}`,
  'rtspAuthMethods: [basic, digest]',
  'rtmp: no', 'hls: no', 'webrtc: no', 'srt: no', 'api: no', 'metrics: no', 'pprof: no', 'playback: no',
  'authInternalUsers:',
  '  - user: any', '    permissions:', '      - action: publish', '      - action: read', '        path: h264', '      - action: read', '        path: hevc',
  '  - user: lzs', '    pass: scopes', '    permissions:', '      - action: read',
  'paths:', '  all_others:',
].join('\n'));
const procs = [spawn(MTX, [join(dir, 'mediamtx.yml')], { cwd: dir, stdio: 'inherit' })];
const stop = () => { for (const p of procs) p.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);

const src = ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', `smptehdbars=size=${size}:rate=25`,
  '-vf', 'setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709', '-pix_fmt', 'yuv420p', '-g', '25', '-bf', '0'];
const enc = {
  h264: ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency'],
  hevc: ['-c:v', 'libx265', '-preset', 'ultrafast', '-tune', 'zerolatency', '-x265-params', 'log-level=error:bframes=0'],
};
setTimeout(() => {
  for (const [path, codec] of [['h264', 'h264'], ['hevc', 'hevc'], ['auth', 'h264']]) {
    // restart a publisher that dies (mediamtx not ready yet)
    const run = () => {
      const p = spawn(FFMPEG, [...src, ...enc[codec], '-f', 'rtsp', '-rtsp_transport', 'tcp', `rtsp://127.0.0.1:${port}/${path}`], { stdio: 'inherit' });
      procs.push(p);
      p.on('exit', () => setTimeout(run, 1000));
    };
    run();
  }
  console.log(`[ios-rtsp-testserver] rtsp://127.0.0.1:${port}/{h264,hevc,auth} (${size}, ${FFMPEG})`);
}, 1500);
