import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { AudioPacketizer, ffmpegArgs, packetHeader, parseAudioBanner, parseFfmpegBanner } from '../server/index.mjs';

describe('bridge protocol 2 (audio)', () => {
  it('one ffmpeg, video on pipe:1 and f32le on pipe:3, no resampling', () => {
    const { main, audio } = ffmpegArgs({ url: 'rtsp://cam/1', vf: 'scale=960:540', audio: 'fd3' });
    expect(audio).toBeNull();
    const a = main.join(' ');
    expect(a).toContain('-map 0:v:0');
    expect(a).toContain('-f rawvideo pipe:1');
    expect(a).toContain('-map 0:a:0 -vn -sn -dn -c:a pcm_f32le -f f32le pipe:3');
    expect(a).not.toMatch(/ -ar | -ac /);
  });
  it('split mode (Windows fallback): second process for the sound on pipe:1', () => {
    const { main, audio } = ffmpegArgs({ url: 'rtsp://cam/1', vf: 'scale', audio: 'split' });
    expect(main.join(' ')).not.toContain('pipe:3');
    expect(audio.join(' ')).toContain('-c:a pcm_f32le -f f32le pipe:1');
  });
  it('without audio=1 the old single video output stays', () => {
    const { main } = ffmpegArgs({ url: 'rtsp://cam/1', vf: 'scale', audio: 'none' });
    expect(main.join(' ')).not.toContain('pcm_f32le');
  });
  it('test patterns get a 1 kHz stereo tone as second input', () => {
    const { main } = ffmpegArgs({ url: 'test:bars', vf: 'scale', audio: 'fd3' });
    expect(main.join(' ')).toContain('-map 1:a:0');
    expect(main.join(' ')).toMatch(/sine=frequency=1000/);
  });
  it('16-byte header, 20 ms packets, continuous sample index', () => {
    const h = packetHeader('LZV1', 7, NaN);
    expect(h.length).toBe(16);
    expect(h.subarray(0, 4).toString('ascii')).toBe('LZV1');
    expect(h.readUInt32LE(4)).toBe(7);
    expect(Number.isNaN(h.readDoubleLE(8))).toBe(true);
    const sent: Buffer[] = [];
    const p = new AudioPacketizer(48000, 2, (b: Buffer) => sent.push(b));
    p.push(Buffer.alloc(960 * 8 * 2 + 100 * 8));
    p.flush();
    expect(sent.map((b) => b.readUInt32LE(4))).toEqual([960, 960, 100]);
    expect(sent.map((b) => b.readDoubleLE(8))).toEqual([0, 960, 1920]);
    expect(sent[0].length).toBe(16 + 960 * 8);
  });
  it('reads the audio stream from the ffmpeg banner', () => {
    expect(parseAudioBanner('  Stream #0:1: Audio: aac (LC), 48000 Hz, stereo, fltp')).toEqual({ codec: 'aac', sampleRate: 48000, channels: 2, layout: 'stereo' });
    expect(parseAudioBanner('  Stream #0:1: Audio: pcm_s24le, 48000 Hz, 5.1(side), s32')?.channels).toBe(6);
    const onlyAudio = parseFfmpegBanner('  Stream #0:0: Audio: mp3, 44100 Hz, mono, fltp, 128 kb/s');
    expect(onlyAudio.width).toBe(0);
    expect(onlyAudio.audio.sampleRate).toBe(44100);
  });
});
