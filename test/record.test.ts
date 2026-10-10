// Local recording (#140 step 5): pure parts of server/record.mjs and, with the shipped ffmpeg,
// real recordings of a lavfi test source – readable with ffprobe, right frame count and
// time stamps, and a crash costs at most the segment being written.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  LineSplitter, Sidecar, escapePattern, estimateRate, hevcBitrate, parseSegmentLine, pickHevcEncoder, recordMode, recordRoots,
  resolveTarget, safeName, segmentOutputArgs, spaceProblem, stripCredentials, validTake, videoCodecArgs,
// @ts-expect-error plain JS module
} from '../server/record.mjs';
// @ts-expect-error plain JS module
import { recordAudioMap } from '../server/index.mjs';
import { validateCommand } from '../server/control.mjs';
import { shippedFfmpeg } from './shippedFfmpeg';

const ffmpeg = shippedFfmpeg ?? '';
const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/, (m) => m.replace('ffmpeg', 'ffprobe'));
const tmp: string[] = [];
const tempDir = () => { const d = mkdtempSync(join(tmpdir(), 'lzs-rec-')); tmp.push(d); return d; };
afterAll(() => { for (const d of tmp) rmSync(d, { recursive: true, force: true }); });

describe('target folders', () => {
  it('released roots: unique names, flags and environment', () => {
    const r = recordRoots(['--record-dir', '/a/Rec', '--record-dir', '/b/Rec', '--record-dir', '/a/Rec'], { LZS_RECORD_DIRS: '' });
    expect(r.map((x: { name: string }) => x.name)).toEqual(['Rec', 'Rec-2']);
  });
  it('names are sanitised and never leave the root', () => {
    const roots = [{ name: 'Rec', dir: '/data/Rec' }];
    expect(resolveTarget(roots, 'Rec', '20261010-120000', 'Kamera 1 / A')).toMatchObject({ dir: '/data/Rec/20261010-120000', base: 'Kamera_1_A' });
    expect(resolveTarget(roots, '', 'take', 'x')?.root.name).toBe('Rec');
    expect(resolveTarget(roots, 'Other', 'take', 'x')).toBeNull();
    for (const bad of ['..', '../x', 'a/b', '', '.hidden/..', 'a\\b']) expect(resolveTarget(roots, 'Rec', bad, 'x')).toBeNull();
    expect(validTake('20261010-120000')).toBe(true);
    expect(safeName('../../etc/passwd')).toBe('etc_passwd');
    expect(safeName('...')).toBe('source');
    expect(safeName('Kamera Ü')).toBe('Kamera_Ü');
    expect(escapePattern('/a/100%/b')).toBe('/a/100%%/b');
    expect(stripCredentials('rtsp://user:pw@10.0.0.5:554/s')).toBe('rtsp://10.0.0.5:554/s');
  });
});

describe('ffmpeg arguments', () => {
  it('network sources are copied, raw ones encoded, stills not recorded', () => {
    expect(recordMode('rtsp://x/1')).toBe('copy');
    expect(recordMode('srt://x:1')).toBe('copy');
    expect(recordMode('test:bars')).toBe('encode');
    expect(recordMode('decklink:0')).toBe('encode');
    expect(recordMode('folder:x')).toBeNull();
    expect(recordMode('resolve:')).toBeNull();
  });
  it('segment output: copy keeps the stream, list on a pipe, numbering pattern', () => {
    const a = segmentOutputArgs({ mode: 'copy', container: 'mov', audioMap: '0:a:0?', sourceCodec: 'hevc', segmentSeconds: 300, list: 'pipe:4', pattern: '/r/t/cam_%03d.mov' });
    expect(a.join(' ')).toContain('-map 0:v:0 -map 0:a:0? -c:v copy -tag:v hvc1 -c:a pcm_s24le');
    expect(a.slice(-7)).toEqual(['-reset_timestamps', '1', '-segment_list', 'pipe:4', '-segment_list_type', 'csv', '/r/t/cam_%03d.mov']);
    expect(segmentOutputArgs({ mode: 'copy', container: 'mkv', audioMap: '0:a:0?', list: 'x', pattern: 'p' }).join(' ')).toContain('-c:a copy');
  });
  it('codecs: ProRes 422 HQ, DNxHR HQX, FFV1 lossless, HEVC 10 bit with key frames for the ring buffer', () => {
    expect(videoCodecArgs('prores').join(' ')).toBe('-c:v prores_ks -profile:v 3 -vendor apl0 -pix_fmt yuv422p10le');
    expect(videoCodecArgs('dnxhr').join(' ')).toContain('dnxhr_hqx');
    expect(videoCodecArgs('ffv1')).not.toContain('-pix_fmt');
    const h = videoCodecArgs('hevc', { encoder: 'hevc_videotoolbox', fps: 50, gopSeconds: 2, container: 'mov' }).join(' ');
    expect(h).toContain('-profile:v main10 -pix_fmt p010le');
    expect(h).toContain('-g 100 -force_key_frames expr:gte(t,n_forced*2) -tag:v hvc1');
    expect(hevcBitrate(1920, 1080, 50)).toBe('52M');
  });
  it('sound of the recording output', () => {
    expect(recordAudioMap('test:bars', { soundInProcess: true })).toBe('1:a:0');
    expect(recordAudioMap('test:bars', { soundInProcess: false })).toBeNull();
    expect(recordAudioMap('rtsp://x/1', { soundInProcess: false })).toBe('0:a:0?');
    expect(recordAudioMap('device:avfoundation:Cam#audio=Mic', { soundInProcess: true })).toBe('0:a:0');
    expect(recordAudioMap('device:v4l2:/dev/video0#audio=hw:1,0', { soundInProcess: true })).toBe('1:a:0');
    expect(recordAudioMap('device:avfoundation:Cam', { soundInProcess: true })).toBeNull();
  });
  it('HEVC encoder: first one that works, cached, software last', async () => {
    const tried: string[] = [];
    const r = await pickHevcEncoder('/x/ffmpeg-a', 'win32', async (_f: string, e: string) => { tried.push(e); return e === 'hevc_qsv'; });
    expect(r).toMatchObject({ encoder: 'hevc_qsv', hardware: true });
    expect(tried).toEqual(['hevc_nvenc', 'hevc_qsv']);
    const none = await pickHevcEncoder('/x/ffmpeg-b', 'linux', async () => false);
    expect(none.encoder).toBeNull();
  });
});

describe('segment list, space, companion file', () => {
  it('parses CSV lines, also split across chunks', () => {
    expect(parseSegmentLine('cam_000.mkv,0.000000,2.000000')).toEqual({ file: 'cam_000.mkv', start: 0, end: 2 });
    expect(parseSegmentLine('"a,b_001.mkv",2.0,4.04')).toEqual({ file: 'a,b_001.mkv', start: 2, end: 4.04 });
    expect(parseSegmentLine('garbage')).toBeNull();
    const lines: string[] = [];
    const s = new LineSplitter((l: string) => lines.push(l));
    s.push('a_000.mkv,0,2\na_00'); s.push('1.mkv,2,4\r\n');
    expect(lines).toEqual(['a_000.mkv,0,2', 'a_001.mkv,2,4']);
  });
  it('space check: two segments plus 1 GB', () => {
    const rate = estimateRate('encode', 'prores', 1920, 1080, 50);
    expect(Math.round((rate * 60) / 1e8) / 10).toBe(2.7);
    expect(spaceProblem(null, rate, 300)).toBeNull();
    expect(spaceProblem(100e9, rate, 300)).toBeNull();
    expect(spaceProblem(10e9, rate, 300)?.code).toBe('record.diskFull');
  });
  it('companion file: start, markers relative to the first picture, end', () => {
    const sc = new Sidecar({ requestedUtcMs: 1000, take: 't', source: { name: 'A' } });
    sc.setStart(1500, 37.5, 'ptp');
    sc.setStart(9999);
    sc.setTimecode('10:00:00:00');
    expect(sc.mark('Gamma', 4000)).toEqual({ t: 2.5, utcMs: 4000, label: 'Gamma' });
    sc.event('paint', { black: -0.5 }, 2500);
    sc.finish('user', 6000);
    const j = sc.toJSON();
    expect(j).toMatchObject({ format: 'lz-scopes-recording', version: 1, take: 't', start: { utcMs: 1500, ptp: 37.5, clock: 'ptp', timecode: '10:00:00:00', requestedUtcMs: 1000 } });
    expect(j.events[0]).toMatchObject({ t: 1, kind: 'paint', data: { black: -0.5 } });
    expect(j.end).toMatchObject({ reason: 'user', utcMs: 6000 });
  });
  it('control API: record, record.mark, record.event', () => {
    expect(validateCommand({ cmd: 'record', mode: 'on', source: '2' })).toEqual({ ok: true, command: { cmd: 'record', mode: 'on', source: 2 } });
    expect(validateCommand({ cmd: 'record.mark', label: 'A' }).ok).toBe(true);
    expect(validateCommand({ cmd: 'record.event', kind: 'paint', data: { gain: 1 } }).ok).toBe(true);
    expect(validateCommand({ cmd: 'record.event', kind: '../x' }).ok).toBe(false);
    expect(validateCommand({ cmd: 'record', mode: 'maybe' }).ok).toBe(false);
  });
});

/** frames and duration of the video stream of a file (ffprobe) */
function probeVideo(file: string) {
  const out = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,nb_read_frames,pix_fmt:format=duration', '-of', 'json', file]).toString();
  const j = JSON.parse(out);
  return { codec: j.streams[0].codec_name as string, frames: Number(j.streams[0].nb_read_frames), pixFmt: j.streams[0].pix_fmt as string, duration: Number(j.format.duration) };
}

describe.skipIf(!shippedFfmpeg || !existsSync(ffprobe))('recording with the shipped ffmpeg (lavfi)', () => {
  it('a crash costs at most the segment being written', async () => {
    const dir = tempDir();
    const lines: string[] = [];
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=20',
      ...segmentOutputArgs({ mode: 'encode', codec: 'prores', container: 'mov', width: 320, height: 180, fps: 25, segmentSeconds: 1, list: 'pipe:3', pattern: join(dir, 'cam_%03d.mov') })],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] });
    try {
      const split = new LineSplitter((l: string) => lines.push(l));
      p.stdio[3]!.on('data', (d) => split.push(String(d)));
      // kill hard in the middle of the fourth segment (MOV: its index is never written)
      await until(() => lines.length >= 3, 15_000);
      await new Promise((r) => setTimeout(r, 500));
      p.kill('SIGKILL');
      await new Promise((ok) => p.once('close', ok));
    } finally { if (p.exitCode === null && p.signalCode === null) p.kill('SIGKILL'); }
    const done = lines.map((l) => parseSegmentLine(l) as { file: string; start: number; end: number });
    expect(done.length).toBeGreaterThanOrEqual(3);
    for (const s of done) {
      const v = probeVideo(join(dir, s!.file));
      expect(v.codec).toBe('prores');
      expect(v.frames).toBe(Math.round((s!.end - s!.start) * 25));
    }
    // the one being written when the process died may be unreadable – nothing else
    expect(readdirSync(dir).filter((f) => f.endsWith('.mov')).length).toBeLessThanOrEqual(done.length + 1);
  }, 30_000);

  it('bridge: test pattern recorded as ProRes with sound, segments contiguous, companion file complete', async () => {
    const dir = tempDir();
    // @ts-expect-error plain JS module
    const { startBridge } = await import('../server/index.mjs');
    const { default: WebSocket } = await import('ws');
    const bridge = await startBridge({ port: 0, recordDirs: [dir] });
    const ws = new WebSocket(`ws://127.0.0.1:${bridge.port}/stream?url=test:bars&width=160&audio=1`);
    const msgs: Record<string, unknown>[] = [];
    try {
      ws.on('message', (d: Buffer, bin: boolean) => { if (!bin) msgs.push(JSON.parse(String(d))); });
      await new Promise((ok) => ws.once('open', ok));
      await until(() => msgs.some((m) => m.type === 'info'));
      ws.send(JSON.stringify({ type: 'record', on: true, take: 'take1', name: 'Bars', codec: 'prores', container: 'mkv', segment: 2, latencyMs: 40, settings: { transfer: 'auto' } }));
      await until(() => msgs.some((m) => m.type === 'record' && m.state === 'recording'));
      await new Promise((r) => setTimeout(r, 2500));
      ws.send(JSON.stringify({ type: 'mark', label: 'A' }));
      await new Promise((r) => setTimeout(r, 2500));
      ws.send(JSON.stringify({ type: 'record', on: false }));
      await until(() => msgs.some((m) => m.type === 'record' && m.state === 'stopped'), 15_000);
    } finally { ws.close(); bridge.close(); }
    const take = join(dir, 'take1');
    const j = JSON.parse(readFileSync(join(take, 'Bars.json'), 'utf8'));
    expect(j).toMatchObject({ format: 'lz-scopes-recording', take: 'take1', latencyMs: 40, video: { mode: 'encode', codec: 'prores', audio: true }, end: { reason: 'user' } });
    expect(j.start.utcMs).toBeGreaterThan(0);
    expect(j.markers).toHaveLength(1);
    expect(j.segments.length).toBeGreaterThanOrEqual(2);
    let total = 0;
    for (let i = 0; i < j.segments.length; i++) {
      const s = j.segments[i];
      if (i) expect(s.start).toBeCloseTo(j.segments[i - 1].end, 3);
      const v = probeVideo(join(take, s.file));
      expect(v).toMatchObject({ codec: 'prores', pixFmt: 'yuv422p10le' });
      expect(v.frames).toBe(Math.round((s.end - s.start) * 25));
      total += v.frames;
    }
    // about five seconds at 25 fps; a slow CI runner encodes 1080p ProRes below real time, so only a floor
    expect(total).toBeGreaterThan(40);
    expect(total).toBeLessThan(150);
    const audio = execFileSync(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'csv=p=0', join(take, j.segments[0].file)]).toString().trim();
    expect(audio).toBe('pcm_s24le');
  }, 60_000);
});

async function until(f: () => boolean, ms = 10_000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 50));
  }
}
