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

describe('bridge: PTS and local audio devices (#24)', () => {
  it('parses device URLs with sound, audio-only devices and rejects option injection', async () => {
    // @ts-expect-error plain JS module
    const { parseDevice, deviceArgs, audioMap, validateInput } = await import('../server/index.mjs');
    expect(deviceArgs('device:avfoundation:MEI USB3.0#audio=MEI USB3.0', '50')).toEqual(['-f', 'avfoundation', '-framerate', '50', '-pixel_format', 'uyvy422', '-i', 'MEI USB3.0:MEI USB3.0']);
    expect(deviceArgs('device:avfoundation:MEI#audio=Dante Virtual Soundcard', '25', { audio: false }).at(-1)).toBe('MEI:none');
    expect(deviceArgs('audio:avfoundation:MacBook Pro-Mikrofon')).toEqual(['-f', 'avfoundation', '-i', ':MacBook Pro-Mikrofon']);
    expect(deviceArgs('audio:dshow:Dante Virtual Soundcard (x64)#ch=16')).toEqual(['-f', 'dshow', '-channels', '16', '-i', 'audio=Dante Virtual Soundcard (x64)']);
    expect(deviceArgs('device:dshow:Decklink#audio=Decklink Audio', '25')).toContain('video=Decklink:audio=Decklink Audio');
    expect(deviceArgs('device:v4l2:/dev/video0#audio=hw:1,0#ch=8', '25')).toEqual(['-f', 'v4l2', '-framerate', '25', '-i', '/dev/video0', '-f', 'alsa', '-channels', '8', '-i', 'hw:1,0']);
    expect(audioMap('device:v4l2:/dev/video0#audio=hw:1,0')).toBe('1:a:0');
    expect(audioMap('device:avfoundation:X#audio=Y')).toBe('0:a:0');
    expect(parseDevice('audio:alsa:hw:1,0')?.audio).toBe('hw:1,0');
    expect(validateInput('audio:avfoundation:Mic')).toBeNull();
    expect(validateInput('audio:avfoundation:Mic#ch=abc')).not.toBeNull();
    expect(validateInput('device:alsa:hw:1')).not.toBeNull();
    expect(validateInput('device:avfoundation:A:B#audio=C')).not.toBeNull(); // ':' would split the avfoundation spec
  });
  it('lists ALSA capture devices from /proc/asound/pcm', async () => {
    // @ts-expect-error plain JS module
    const { parseAlsaPcm } = await import('../server/index.mjs');
    expect(parseAlsaPcm('00-00: ALC892 Analog : ALC892 Analog : playback 1 : capture 1\n01-03: HDMI 0 : HDMI 0 : playback 1')).toEqual([
      { name: 'ALC892 Analog (hw:0,0)', url: 'audio:alsa:hw:0,0', kind: 'audio' },
    ]);
  });
  it('protocol 2 with PTS: showinfo on the picture, ashowinfo on the sound, info log level', async () => {
    // @ts-expect-error plain JS module
    const { ffmpegArgs } = await import('../server/index.mjs');
    const { main } = ffmpegArgs({ url: 'rtsp://cam/1', vf: 'scale=960:540', audio: 'fd3', pts: true });
    const a = main.join(' ');
    expect(a).toContain('-loglevel info');
    expect(a).toContain('-vf scale=960:540,showinfo=checksum=0');
    expect(a).toContain('-af ashowinfo -c:a pcm_f32le -f f32le pipe:3');
    // split mode: two sessions, timestamps not comparable → no PTS
    expect(ffmpegArgs({ url: 'rtsp://cam/1', vf: 'x', audio: 'split', pts: true }).main.join(' ')).not.toContain('showinfo');
  });
  it('reads showinfo/ashowinfo lines and anchors the sample index to the PTS', async () => {
    // @ts-expect-error plain JS module
    const { PtsTracker, parsePtsLine, lastProblem } = await import('../server/index.mjs');
    // lines as printed by ffmpeg 6.0 (ffmpeg-static) for lavfi input
    expect(parsePtsLine('[Parsed_showinfo_1 @ 0x6000002f82c0] n:   1 pts:      1 pts_time:0.04    duration:      1 duration_time:0.04')).toEqual({ audio: false, inst: 1, n: 1, pts: 0.04, samples: 0 });
    // with -loglevel level+info (time code, #28)
    expect(parsePtsLine('[Parsed_showinfo_3 @ 0x1] [info] n:   7 pts:      7 pts_time:0.28 duration: 1')?.n).toBe(7);
    expect(parsePtsLine('[Parsed_ashowinfo_0 @ 0x6000002ecb00] n:0 pts:0 pts_time:0 pos:-1 fmt:s16 channels:1 chlayout:mono rate:48000 nb_samples:1024 checksum:911BE30C')).toEqual({ audio: true, inst: 0, n: 0, pts: 0, samples: 1024 });
    const anchors: [number, number][] = [];
    const t = new PtsTracker(48000, (i: number, p: number) => anchors.push([i, p]));
    const line = (n: number, pts: number) => `[Parsed_ashowinfo_0 @ 0x1] n:${n} pts:${Math.round(pts * 48000)} pts_time:${pts} pos:-1 nb_samples:1024\n`;
    const rest = t.feed('[Parsed_showinfo_1 @ 0x2] n:   0 pts:      0 pts_time:0.5 duration: 1\n' + line(0, 1) + line(1, 1 + 1024 / 48000) + line(2, 2) + 'Error opening input\n');
    expect(rest).toEqual(['Error opening input']);
    expect(t.videoPts(0)).toBe(0.5);
    expect(anchors).toEqual([[0, 1], [2048, 2]]); // continuous frame: no anchor; jump: new anchor
    expect(lastProblem('Input #0, rtsp\n[rtsp @ 0x1] method DESCRIBE failed: 404 Not Found\nExiting')).toContain('404');
  });
});
