import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { validateCommand } from '../server/control.mjs';
import { handleOut10, out10Args, out10Format, parseFrame10 } from '../server/out10.mjs';
import { OUT10_HEADER, frame10Buffer } from '../src/deep';

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static') as string;

function testFrame(w: number, h: number) {
  const f = frame10Buffer({ w, h, full: false, colorspace: '709', transfer: 'sdr' });
  // every code 4…1019 appears in Y′; chroma walks through its range as well
  for (let i = 0; i < f.y.length; i++) f.y[i] = 4 + (i % 1016);
  for (let i = 0; i < f.cb.length; i++) { f.cb[i] = 4 + ((i * 7) % 1016); f.cr[i] = 1019 - ((i * 3) % 1016); }
  return f;
}

const freePort = () => new Promise<number>((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); }); });

/** Listening ffmpeg: first frame of the stream as raw yuv422p10le, plus its log. */
function receive(port: number, fmt: string, extra: string[] = []) {
  return new Promise<{ raw: Buffer; log: string }>((ok, fail) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-f', fmt, '-i', `tcp://127.0.0.1:${port}?listen=1`, '-frames:v', '1', ...extra, '-f', 'rawvideo', '-pix_fmt', 'yuv422p10le', 'pipe:1']);
    const out: Buffer[] = []; let log = '';
    p.stdout.on('data', (d) => out.push(d)); p.stderr.on('data', (d) => { log += d; });
    p.on('error', fail);
    p.on('close', (code, sig) => ok({ raw: Buffer.concat(out), log: log || `(kein Log, Ende ${code ?? sig})` }));
  });
}

/** Fake WebSocket for handleOut10. */
class FakeWs extends EventEmitter {
  OPEN = 1; readyState = 1; sent: string[] = [];
  send(m: string) { this.sent.push(m); }
  close() { this.readyState = 3; this.emit('close'); }
}
const fakeWs = () => new FakeWs();

describe('10-bit output: formats and arguments', () => {
  it('parses its own header and rejects wrong sizes', () => {
    const f = frame10Buffer({ w: 6, h: 2, full: true, colorspace: '2020', transfer: 'pq' });
    expect(parseFrame10(Buffer.from(f.buf))).toEqual({ w: 6, h: 2, full: true, matrix: '2020', transfer: 'pq' });
    expect(parseFrame10(Buffer.from(f.buf).subarray(0, 20))).toBeNull();
  });
  it('containers per target and codec', () => {
    expect(out10Format('udp://239.1.1.1:5000', 'hevc10')).toEqual({ format: 'mpegts' });
    expect(out10Format('rtp://239.1.1.1:5000', 'hevc10')).toEqual({ format: 'rtp_mpegts' });
    expect(out10Format('rtsp://h/x', 'hevc422')).toEqual({ format: 'rtsp' });
    expect(out10Format('tcp://h:1', 'v210')).toEqual({ format: 'nut' });
    expect(out10Format('rtp://h:1', 'v210').error).toBeTruthy();
    expect(out10Format('rtmp://h/app', 'hevc10').error).toMatch(/RTMP/);
    expect(out10Format('udp://h:1', 'h264').error).toMatch(/Codec/);
  });
  it('control API: codec needs a target and must be known', () => {
    expect(validateCommand({ cmd: 'stream.start', stream: 's', target: 'udp://239.0.0.1:5000', codec: 'hevc10' }).ok).toBe(true);
    expect(validateCommand({ cmd: 'stream.start', stream: 's', codec: 'hevc10' }).ok).toBe(false);
    expect(validateCommand({ cmd: 'output.open', stream: 's', target: 'tcp://h:1', codec: 'h264' }).ok).toBe(false);
  });
  it('tags range, matrix and transfer', () => {
    const a = out10Args({ w: 1920, h: 1080, fps: 25, codec: 'hevc10', target: 'udp://h:1', full: false, matrix: '2020', transfer: 'hlg' });
    expect(a.join(' ')).toContain('-pix_fmt yuv422p10le -video_size 1920x1080');
    expect(a.join(' ')).toContain('-pix_fmt yuv420p10le');
    expect(a.join(' ')).toContain('-color_range tv -colorspace bt2020nc -color_primaries bt2020 -color_trc arib-std-b67');
  });
});

describe('10-bit output through ffmpeg-static', () => {
  it('v210: every code arrives unchanged (bit-exact)', async () => {
    const w = 192, h = 108, f = testFrame(w, h), port = await freePort();
    const rx = receive(port, 'nut');
    await new Promise((r) => setTimeout(r, 400));
    const ws = fakeWs();
    handleOut10(ws, new URLSearchParams({ target: `tcp://127.0.0.1:${port}`, codec: 'v210', fps: '25' }), [ffmpeg]);
    ws.emit('message', Buffer.from(f.buf), true);
    const { raw, log } = await rx;
    ws.close();
    expect(log).toMatch(/v210/);
    expect(raw.length).toBe(w * h * 4);
    const got = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
    const sent = new Uint16Array(f.buf, OUT10_HEADER);
    expect(Buffer.from(got.buffer, got.byteOffset, got.byteLength).equals(Buffer.from(sent.buffer, sent.byteOffset, sent.byteLength))).toBe(true);
    expect(ws.sent.some((m) => m.includes('live'))).toBe(true);
  }, 30_000);

  it('hevc10: HEVC Main 10 with BT.709 tags', async () => {
    const w = 192, h = 108, port = await freePort();
    const rx = receive(port, 'mpegts');
    await new Promise((r) => setTimeout(r, 400));
    const ws = fakeWs();
    handleOut10(ws, new URLSearchParams({ target: `tcp://127.0.0.1:${port}`, codec: 'hevc10', fps: '25' }), [ffmpeg]);
    ws.emit('message', Buffer.from(testFrame(w, h).buf), true);
    const { log } = await rx;
    ws.close();
    expect(log, `Empfänger: ${log}\nBridge: ${ws.sent.join(' | ')}`).toMatch(/hevc \(Main 10\)/);
    expect(log).toMatch(/yuv420p10le\(tv, bt709/);
  }, 30_000);
});
