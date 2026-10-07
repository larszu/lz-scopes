#!/usr/bin/env node
// Records the fixtures for the Swift unit tests of the iOS RTSP reception (ios/LzRtsp, #90):
// ffmpeg publishes SMPTE HD bars (RP 219) as H.264 and HEVC to a local mediamtx, this script
// pulls each over RTSP/TCP (interleaved) and stores
//   <name>.sdp            the DESCRIBE body
//   <name>.tcp            the raw bytes the socket received from PLAY on (response + `$` frames)
//   <name>.expected.json  the access units server/rtp.mjs makes of them (key, ts, size, sha256)
// so the Swift port is checked against the JavaScript implementation byte for byte.
// Needs mediamtx and ffmpeg with libx264/libx265 (brew install mediamtx ffmpeg).
// Usage: node scripts/ios-rtsp-fixtures.mjs [outDir]

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Depacketizer, parseRtp } from '../server/rtp.mjs';
import { RtspStreamParser, parseSdp } from '../server/rtsp.mjs';

const OUT = resolve(process.argv[2] ?? 'ios/LzRtsp/Tests/LzRtspTests/Fixtures');
const which = (b) => spawnSync('which', [b]).stdout.toString().trim() || null;
const MTX = which('mediamtx'), FFMPEG = which('ffmpeg');
if (!MTX || !FFMPEG) { console.error('mediamtx and ffmpeg needed'); process.exit(1); }

const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = await freePort();
const dir = mkdtempSync(join(tmpdir(), 'lzs-fix-'));
writeFileSync(join(dir, 'mediamtx.yml'), [
  'logLevel: warn', `rtspAddress: 127.0.0.1:${port}`, 'rtspTransports: [tcp]',
  'rtmp: no', 'hls: no', 'webrtc: no', 'srt: no', 'api: no', 'metrics: no', 'pprof: no', 'playback: no',
  'paths:', '  all_others:',
].join('\n'));
const mtx = spawn(MTX, [join(dir, 'mediamtx.yml')], { cwd: dir, stdio: 'ignore' });
await sleep(1500);

const COMMON = ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'smptehdbars=size=640x360:rate=25',
  '-vf', 'setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709', '-pix_fmt', 'yuv420p', '-g', '10', '-bf', '0'];
const STREAMS = {
  h264: ['-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '16'],
  hevc: ['-c:v', 'libx265', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '18', '-x265-params', 'log-level=error:bframes=0:keyint=10'],
};

/** Raw RTSP over TCP: OPTIONS, DESCRIBE, SETUP (interleaved), PLAY; record from PLAY on. */
async function record(name) {
  const url = `rtsp://127.0.0.1:${port}/${name}`;
  const sock = connect(port, '127.0.0.1');
  await new Promise((ok, fail) => { sock.once('connect', ok); sock.once('error', fail); });
  let cseq = 0, session = '', waiting = null, recording = null;
  const parser = new RtspStreamParser((res) => waiting?.(res), () => {});
  sock.on('data', (c) => { if (recording) recording.push(c); else parser.push(c); });
  const req = (method, uri, headers = {}) => new Promise((ok) => {
    waiting = (r) => { waiting = null; ok(r); };
    const h = { CSeq: ++cseq, ...(session ? { Session: session } : {}), ...headers };
    sock.write(`${method} ${uri} RTSP/1.0\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`);
  });
  await req('OPTIONS', url);
  const desc = await req('DESCRIBE', url, { Accept: 'application/sdp' });
  if (desc.status !== 200) throw new Error(`${name}: DESCRIBE ${desc.status}`);
  const track = parseSdp(desc.body, (desc.headers['content-base'] ?? url).replace(/\/$/, ''));
  const setup = await req('SETUP', track.control, { Transport: 'RTP/AVP/TCP;unicast;interleaved=0-1' });
  session = setup.headers.session.split(';')[0];
  recording = [];
  sock.write(`PLAY ${track.session} RTSP/1.0\r\nCSeq: ${++cseq}\r\nSession: ${session}\r\nRange: npt=0.000-\r\n\r\n`);
  await sleep(1600);
  sock.destroy();
  const raw = Buffer.concat(recording);

  // the same bytes through the JavaScript implementation
  const aus = [];
  const depack = new Depacketizer(track.codec, (au) => aus.push(au));
  const p2 = new RtspStreamParser(() => {}, (ch, data) => {
    if (ch !== 0) return;
    const pkt = parseRtp(data);
    if (pkt && pkt.pt === track.pt) depack.push(pkt, false);
  });
  p2.push(raw);
  const expected = {
    codec: track.codec, pt: track.pt, params: track.params.length,
    accessUnits: aus.map((a) => ({ key: a.key, ts: a.ts, size: a.data.length, sha256: createHash('sha256').update(a.data).digest('hex') })),
    dropped: depack.dropped,
  };
  writeFileSync(join(OUT, `${name}.sdp`), desc.body);
  writeFileSync(join(OUT, `${name}.tcp`), raw);
  writeFileSync(join(OUT, `${name}.expected.json`), `${JSON.stringify(expected, null, 1)}\n`);
  console.log(`${name}: ${raw.length} bytes, ${aus.length} access units (${aus.filter((a) => a.key).length} key), dropped ${depack.dropped}`);
}

mkdirSync(OUT, { recursive: true });
const pubs = [];
try {
  for (const [name, args] of Object.entries(STREAMS)) {
    pubs.push(spawn(FFMPEG, [...COMMON, ...args, '-f', 'rtsp', '-rtsp_transport', 'tcp', `rtsp://127.0.0.1:${port}/${name}`], { stdio: 'inherit' }));
  }
  await sleep(2500);
  for (const name of Object.keys(STREAMS)) await record(name);
} finally {
  for (const p of pubs) p.kill('SIGKILL');
  mtx.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
}
