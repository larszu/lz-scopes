import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ffmpegCandidates, ffmpegFor, ffmpegInfo, ffmpegOrigin, hostTarget, licenseOf, noFfmpegMessage, outputProtocols } from '../server/ffmpeg.mjs';
import { checkFlags, configureFlags } from '../scripts/ffmpeg-fetch.mjs';
import { shippedFfmpeg } from './shippedFfmpeg';
import { bridgeFfmpegText, ffmpegLine, pushFfmpegText, sourceFfmpegText, type FfmpegInfo } from '../src/ffmpegInfo';

const manifest = JSON.parse(readFileSync(new URL('../scripts/ffmpeg-builds.json', import.meta.url), 'utf8'));

describe('ffmpeg: manifest and licence rules', () => {
  it('every shipped download is pinned by URL and SHA-256', () => {
    for (const t of ['darwin-arm64', 'darwin-x64', 'win32-x64']) {
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
