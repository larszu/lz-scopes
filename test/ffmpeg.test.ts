import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { broadcastFormats, ffmpegCandidates, ffmpegFor, ffmpegInfo, ffmpegOrigin, hostTarget, licenseOf, listedNames, noFfmpegMessage, outputProtocols } from '../server/ffmpeg.mjs';
import { checkFlags, configureFlags } from '../scripts/ffmpeg-fetch.mjs';
import { shippedFfmpeg } from './shippedFfmpeg';
import { bridgeFfmpegText, ffmpegLine, formatsLine, pushFfmpegText, sourceFfmpegText, type FfmpegInfo } from '../src/ffmpegInfo';
import { setLang } from '../src/i18n';

setLang('de'); // the UI texts below are checked in German

const manifest = JSON.parse(readFileSync(new URL('../scripts/ffmpeg-builds.json', import.meta.url), 'utf8'));

describe('ffmpeg: manifest and licence rules', () => {
  it('every shipped download is pinned by URL and SHA-256', () => {
    for (const t of ['darwin-arm64', 'darwin-x64', 'win32-x64', 'linux-x64', 'linux-arm64']) {
      for (const f of manifest.targets[t].files) {
        expect(f.url).toMatch(/^https:\/\//);
        expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    }
    expect(manifest.universal['darwin-universal']).toEqual(['darwin-arm64', 'darwin-x64']);
    for (const s of manifest.sources.files) expect(s.url).toMatch(/^https:\/\//);
    expect(manifest.sources.files[0].sha256).toMatch(/^[0-9a-f]{64}$/);
  });
  it('licence from the configure line (FFmpeg LICENSE.md)', () => {
    expect(licenseOf('--enable-gpl --enable-version3 --enable-libx264')).toBe('GPL-3.0-or-later');
    expect(licenseOf('--enable-gpl --enable-libx264')).toBe('GPL-2.0-or-later');
    expect(licenseOf('--enable-version3')).toBe('LGPL-3.0-or-later');
    expect(licenseOf('')).toBe('LGPL-2.1-or-later');
    expect(licenseOf('--enable-gpl --enable-version3 --enable-nonfree')).toMatch(/not redistributable/);
  });
  it('fetch check rejects nonfree and builds without SRT/x264/x265', () => {
    expect(checkFlags(new Set(['--enable-gpl', '--enable-libsrt', '--enable-libx264', '--enable-libx265']))).toEqual([]);
    expect(checkFlags(new Set(['--enable-gpl', '--enable-libsrt', '--enable-libx264', '--enable-libx265', '--enable-nonfree'])).join()).toMatch(/nonfree/);
    expect(checkFlags(new Set(['--enable-gpl', '--enable-libx264', '--enable-libx265'])).join()).toMatch(/libsrt/);
  });
  it('output protocols from `ffmpeg -protocols`', () => {
    const text = 'Supported file protocols:\nInput:\n  file\n  srt\nOutput:\n  file\n  srt\n  tcp\n';
    expect([...outputProtocols(text)]).toEqual(['file', 'srt', 'tcp']);
  });
  it('host target: macOS always universal', () => {
    expect(hostTarget('darwin', 'arm64')).toBe('darwin-universal');
    expect(hostTarget('win32', 'x64')).toBe('win32-x64');
    expect(hostTarget('linux', 'x64')).toBe('linux-x64');
    expect(hostTarget('linux', 'arm64')).toBe('linux-arm64');
  });
  it('origin and messages', () => {
    expect(ffmpegOrigin('/x/ffmpeg', { FFMPEG: '/x/ffmpeg' })).toBe('env');
    expect(ffmpegOrigin('/usr/bin/ffmpeg', {})).toBe('system');
    expect(ffmpegOrigin(null)).toBe('none');
    expect(noFfmpegMessage('srt://h:1', ['/x/ffmpeg'])).toMatchObject({ code: 'ffmpeg.noSrt', message: expect.stringMatching(/SRT/) });
    expect(noFfmpegMessage('rtsp://h/1', [])).toMatchObject({ code: 'ffmpeg.none', message: expect.stringMatching(/not found/) });
    expect(noFfmpegMessage('rtsp://h/1', ['/x/ffmpeg']).code).toBe('ffmpeg.missing');
  });
});

describe.skipIf(!shippedFfmpeg)('ffmpeg: the shipped build of this machine', () => {
  it('is redistributable GPLv3 with SRT, read from the binary itself', async () => {
    const info = await ffmpegInfo(shippedFfmpeg!);
    expect(info).toMatchObject({ origin: 'vendor', license: 'GPL-3.0-or-later', srt: true, inputSrt: true });
    expect(info!.version).toBeTruthy();
    expect(checkFlags(configureFlags([shippedFfmpeg!]))).toEqual([]);
  });
  it('comes before any system ffmpeg, and is picked for srt://', async () => {
    const c = ffmpegCandidates({ PATH: process.env.PATH });
    expect(c[0]).toBe(shippedFfmpeg);
    expect(await ffmpegFor('srt://127.0.0.1:9000', c)).toBe(shippedFfmpeg);
    expect(await ffmpegFor('rtsp://h/1', c)).toBe(shippedFfmpeg);
  });
  it.skipIf(process.platform !== 'linux')('Linux: has the ALSA input device, so the bridge offers audio:alsa: (#121)', async () => {
    // @ts-expect-error plain JS module
    const { parseInputDevices } = await import('../server/index.mjs');
    const out = execFileSync(shippedFfmpeg!, ['-hide_banner', '-devices'], { encoding: 'utf8' });
    const d = parseInputDevices(out);
    expect(d.has('alsa')).toBe(true);
    expect(d.has('v4l2')).toBe(true);
  });
  it.skipIf(process.platform !== 'linux')('Linux: records 8 channels over ALSA with the bridge arguments (alsa-lib null device, no sound card needed)', async () => {
    // @ts-expect-error plain JS module
    const { deviceArgs } = await import('../server/index.mjs');
    const args = deviceArgs('audio:alsa:null#ch=8');
    // The alsa-lib null device has no clock: under CI load it sometimes stamps two packets alike,
    // and ffmpeg ends with 255 after "non monotonically increasing dts" (#243). That is the test
    // device, not the bridge arguments, so a run may be repeated; a real argument error fails
    // all three runs.
    const run = () => spawnSync(shippedFfmpeg!, ['-hide_banner', ...args, '-t', '0.2', '-f', 'null', '-'], { encoding: 'utf8' });
    let r = run();
    for (let i = 0; i < 2 && r.status !== 0 && /non monotonically increasing dts/.test(r.stderr); i++) r = run();
    expect(r.status, r.stderr).toBe(0);
    // 8 channels without an order: ffmpeg prints the layout as 7.1 (6144 kb/s = 48 kHz × 16 bit × 8)
    expect(r.stderr).toMatch(/Input #0, alsa[\s\S]*Audio: pcm_s16le, 48000 Hz, (8 channels|7\.1), s16, 6144 kb\/s/);
  });
});

describe('ffmpeg: what the UI says', () => {
  const shipped: FfmpegInfo = { path: '/app/Resources/ffmpeg/ffmpeg', origin: 'bundled', version: '9.0.2', license: 'GPL-3.0-or-later', srt: true, inputSrt: true };
  const noSrt: FfmpegInfo = { ...shipped, origin: 'system', version: '6.0', srt: false, inputSrt: false };
  it('bridge line names origin, version, licence and SRT', () => {
    expect(ffmpegLine(shipped)).toBe('ffmpeg 9.0.2 · mitgeliefert · GPL-3.0-or-later · SRT ja');
    expect(bridgeFfmpegText({ ok: true, ffmpeg: noSrt, ffmpegSrt: shipped })).toMatch(/SRT nein; für srt:\/\/ ffmpeg 9\.0\.2/);
    expect(bridgeFfmpegText(null)).toMatch(/nicht erreichbar/);
    expect(bridgeFfmpegText({ ok: true, ffmpeg: null })).toBe('ffmpeg: nicht gefunden');
  });
  it('push hint only for a target, and honest about SRT', () => {
    expect(pushFfmpegText('', { ok: true, ffmpeg: shipped })).toBe('');
    expect(pushFfmpegText('srt://h:9000', { ok: true, ffmpeg: shipped })).toBe('Push mit ffmpeg 9.0.2 · mitgeliefert · GPL-3.0-or-later · SRT ja');
    expect(pushFfmpegText('srt://h:9000', { ok: true, ffmpeg: noSrt })).toMatch(/kein ffmpeg mit SRT/);
    expect(pushFfmpegText('rtmp://h/a', { ok: true, ffmpeg: noSrt })).toMatch(/SRT nein/);
    expect(sourceFfmpegText('rtsp://h/1', { ok: true, ffmpeg: shipped })).toBe('');
    expect(sourceFfmpegText('srt://h:9000', { ok: true, ffmpeg: noSrt, ffmpegSrt: shipped })).toMatch(/^SRT-Empfang mit ffmpeg 9\.0\.2/);
  });
});

describe('ffmpeg: broadcast formats (#233)', () => {
  const decs = 'Decoders:\n V..... = Video\n ------\n VFS..D prores               Apple ProRes\n A....D dolby_e              Dolby E\n A....D ac3                  ATSC A/52A\n';
  const demux = 'File formats:\n D. = Demuxing supported\n --\n D   s337m           SMPTE 337M\n D   sdp             SDP\n';
  it('names from -decoders / -demuxers, without the legend', () => {
    expect([...listedNames(decs)]).toEqual(['prores', 'dolby_e', 'ac3']);
    expect([...listedNames(demux)]).toEqual(['s337m', 'sdp']);
  });
  it('decoder and demuxer both needed for Dolby E; JPEG XS absent', () => {
    const f = broadcastFormats(listedNames(decs), listedNames(demux));
    expect(f).toMatchObject({ prores: true, dolbyE: true, ac3: true, jpegxs: false, jpeg2000: false, sdp: true });
    expect(broadcastFormats(listedNames(decs), new Set()).dolbyE).toBe(false);
    const line = formatsLine({ path: 'x', origin: 'vendor', version: '9', license: null, srt: true, inputSrt: true, formats: f });
    expect(line).toMatch(/^liest ProRes, Dolby E, AC-3\/E-AC-3, SDP\/RTP · nicht JPEG XS/);
    expect(formatsLine({ path: 'x', origin: 'vendor', version: '9', license: null, srt: true, inputSrt: true })).toBe('');
  });
});
