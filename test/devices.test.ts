import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { applyDecodeOverride, deviceInputArgs, deviceOptions, formatListArgs, isDeepPixfmt, parseFormatList, pickPixfmt } from '../server/devices.mjs';
// @ts-expect-error plain JS module
import { HelperRecordParser, helperFormat, helperList, helperRecord, startHelperStream } from '../server/helper-input.mjs';
// @ts-expect-error plain JS module
import { decodeParams, defaultMode, ffmpegCandidates, outputSize, validateInput } from '../server/index.mjs';

// Captured from ffmpeg 8 (avfoundation) on a MacBook Pro FaceTime camera, 30.09.2026.
const AVF_MODES = `[in#0 @ 0x7e301c000] Selected framerate (1.000000) is not supported by the device.
[in#0 @ 0x7e301c000] Supported modes:
[in#0 @ 0x7e301c000]   1920x1080@[15.000000 30.000000]fps
[in#0 @ 0x7e301c000]   1280x720@[15.000000 30.000000]fps
[in#0 @ 0x7e301c000]   1080x1920@[15.000000 30.000000]fps
[in#0 @ 0x7e301c000]   1760x1328@[15.000000 30.000000]fps
[in#0 @ 0x7e301c000]   640x480@[15.000000 30.000000]fps
[in#0 @ 0x7e3018000] Error opening input: Input/output error`;
const AVF_PIX = `[in#0 @ 0x719400000] Selected pixel format (gray) is not supported by the input device.
[in#0 @ 0x719400000] Supported pixel formats:
[in#0 @ 0x719400000]   uyvy422
[in#0 @ 0x719400000]   yuyv422
[in#0 @ 0x719400000]   nv12
[in#0 @ 0x719400000]   0rgb
[in#0 @ 0x719400000]   bgr0
[in#0 @ 0x719400000] Overriding selected pixel format to use uyvy422 instead.`;
// Line layout from libavdevice/dshow.c ("  pixel_format=%s" + "  min s=%ldx%ld fps=%g max s=%ldx%ld fps=%g")
const DSHOW = `[dshow @ 0000] DirectShow video device options (from video devices)
[dshow @ 0000]  Pin "Capture" (alternative pin name "0")
[dshow @ 0000]   pixel_format=yuv422p10le  min s=1920x1080 fps=25 max s=1920x1080 fps=60 (tv, bt709/bt709/bt709, topleft)
[dshow @ 0000]   pixel_format=uyvy422  min s=1920x1080 fps=25 max s=1920x1080 fps=60
[dshow @ 0000]   vcodec=mjpeg  min s=1280x720 fps=5 max s=1280x720 fps=30`;
// Line layout from libavdevice/v4l2.c ("Raw       : %11s : %20s :" + sizes)
const V4L2 = `[video4linux2,v4l2 @ 0x1] Raw       :     yuyv422 :           YUYV 4:2:2 : 640x480 1280x720 1920x1080
[video4linux2,v4l2 @ 0x1] Compressed:       mjpeg :          Motion-JPEG : {32-1920, 2}x{32-1080, 2}`;

describe('capture devices (ffmpeg avfoundation/dshow/v4l2)', () => {
  it('parses avfoundation modes and pixel formats', () => {
    const m = parseFormatList(AVF_MODES, 'avfoundation');
    expect(m.modes).toHaveLength(5);
    expect(m.modes[0]).toEqual({ width: 1920, height: 1080, fpsMin: 15, fpsMax: 30 });
    expect(parseFormatList(AVF_PIX, 'avfoundation').pixfmts).toEqual(['uyvy422', 'yuyv422', 'nv12', '0rgb', 'bgr0']);
    // largest 16:9 mode, not the square one avfoundation would otherwise choose
    expect(defaultMode(m.modes)).toBe('1920x1080');
  });
  it('parses dshow and v4l2 listings', () => {
    const d = parseFormatList(DSHOW, 'dshow');
    expect(d.pixfmts).toEqual(['yuv422p10le', 'uyvy422', 'mjpeg']);
    expect(d.modes[0]).toEqual({ width: 1920, height: 1080, fpsMin: 25, fpsMax: 60, pixfmt: 'yuv422p10le' });
    const v = parseFormatList(V4L2, 'v4l2');
    expect(v.pixfmts).toEqual(['yuyv422', 'mjpeg']);
    expect(v.modes.map((x: { width: number }) => x.width)).toEqual([640, 1280, 1920]);
  });
  it('prefers deep raw formats, never compressed ones', () => {
    expect(pickPixfmt(['mjpeg', 'uyvy422', 'yuv422p10le'])).toBe('yuv422p10le');
    expect(pickPixfmt(['nv12', 'uyvy422'])).toBe('uyvy422');
    expect(pickPixfmt(['mjpeg'])).toBeNull();
    expect(isDeepPixfmt('yuv422p10le')).toBe(true);
    expect(isDeepPixfmt('uyvy422')).toBe(false);
  });
  it('builds explicit input arguments per platform', () => {
    expect(deviceInputArgs('device:avfoundation:Cam', '30', { size: '1920x1080' }).join(' '))
      .toBe('-f avfoundation -framerate 30 -video_size 1920x1080 -pixel_format uyvy422 -i Cam:none');
    expect(deviceInputArgs('device:dshow:Decklink Video Capture', '50', { pixfmt: 'yuv422p10le' }).join(' '))
      .toBe('-f dshow -framerate 50 -pixel_format yuv422p10le -rtbufsize 256M -i video=Decklink Video Capture');
    expect(deviceInputArgs('device:dshow:X', '30', { pixfmt: 'mjpeg' })).toContain('-vcodec');
    expect(deviceInputArgs('device:v4l2:/dev/video0', '25', { pixfmt: 'yuyv422' }).join(' ')).toBe('-f v4l2 -framerate 25 -input_format yuyv422 -i /dev/video0');
    expect(formatListArgs('device:dshow:X')[0]).toContain('-list_options');
    expect(formatListArgs('rtsp://x')).toBeNull();
  });
  it('accepts only well-formed options', () => {
    expect(deviceOptions(new URLSearchParams('size=1920x1080&rate=59.94&pixfmt=uyvy422&matrix=bt2020&range=pc')))
      .toEqual({ size: '1920x1080', rate: '59.94', pixfmt: 'uyvy422', matrix: 'bt2020', range: 'pc' });
    expect(deviceOptions(new URLSearchParams('size=-i&rate=1;rm&pixfmt=../x&matrix=foo&range=full'))).toEqual({});
  });
  it('explicit matrix/range win over tags and the size rule', () => {
    const tagged = decodeParams({ matrix: 'unknown', range: 'unknown', height: 1080 });
    expect(tagged).toEqual({ decodeMatrix: 'bt709', decodeRange: 'limited' });
    expect(applyDecodeOverride(tagged, { matrix: 'bt2020', range: 'pc' })).toEqual({ decodeMatrix: 'bt2020', decodeRange: 'full' });
    expect(applyDecodeOverride(tagged, {})).toEqual(tagged);
  });
  it('validates DeckLink URLs', () => {
    expect(validateInput('decklink:0')).toBeNull();
    expect(validateInput('decklink:../x')).not.toBeNull();
  });
});

describe('helper protocol (DeckLink/NDI helpers)', () => {
  it('reassembles records across arbitrary chunk borders', () => {
    const got: [string, number][] = [];
    const p = new HelperRecordParser((t: string, b: Buffer) => got.push([t, b.length]));
    const all = Buffer.concat([helperRecord('INFO', { width: 1 }), helperRecord('FRAM', Buffer.alloc(1000)), helperRecord('ERR', 'x')]);
    for (let i = 0; i < all.length; i += 7) p.push(all.subarray(i, i + 7));
    expect(got).toEqual([['INFO', 11], ['FRAM', 1000], ['ERR', 1]]);
    expect(() => new HelperRecordParser(() => {}).push(Buffer.from('garbage-bytes'))).toThrow();
  });
  it('frame sizes: v210 rows are padded to 48 px = 128 bytes', () => {
    // 1280 px → 27 blocks × 128 = 3456 bytes per row (checked against ffmpeg's v210 encoder output)
    expect(helperFormat({ width: 1280, height: 720, pixel: 'v210', fpsNum: 50, fpsDen: 1 }).bytes).toBe(3456 * 720);
    expect(helperFormat({ width: 1920, height: 1080, pixel: 'v210', fpsNum: 30000, fpsDen: 1001 })).toMatchObject({ bytes: 5120 * 1080, rate: '30000/1001', fps: 29.97 });
    expect(helperFormat({ width: 1920, height: 1080, pixel: 'uyvy422' }).bytes).toBe(1920 * 1080 * 2);
    expect(helperFormat({ width: 1920, height: 1080, pixel: 'p216le' }).bytes).toBe(1920 * 1080 * 4);
    expect(helperFormat({ width: 1920, height: 1080, pixel: 'yuv410p' }).error).toBeTruthy();
  });

  const fake = fileURLToPath(new URL('./fixtures/fake-helper.mjs', import.meta.url));
  it('lists devices through --list', async () => {
    const r = await helperList(process.execPath, [], 8000).catch(() => null);
    expect(r?.ok).not.toBe(true); // node itself is no helper
    const ok = await new Promise((res) => {
      import('node:child_process').then(({ execFile }) => execFile(process.execPath, [fake, '--list'], (_e, out) => res(JSON.parse(out))));
    });
    expect(ok).toMatchObject({ ok: true, devices: [{ name: 'Fake UltraStudio' }] });
  });

  const ffmpeg = ffmpegCandidates()[0];
  it.skipIf(!ffmpeg)('v210 from a helper arrives as full-range RGBA (Y′ 940 → 100 %, 502 → 50 %)', async () => {
    const run = (y: number) => new Promise<{ info: Record<string, unknown>; frame: Uint16Array | null }>((done) => {
      const ws = Object.assign(new EventEmitter(), {
        OPEN: 1, readyState: 1, bufferedAmount: 0, info: {} as Record<string, unknown>, frame: null as Uint16Array | null,
        send(d: Buffer | string) {
          if (typeof d === 'string') { const m = JSON.parse(d); if (m.type === 'info') ws.info = m; if (m.type === 'end' || m.type === 'error') ws.info.last = m; return; }
          if (!ws.frame) ws.frame = new Uint16Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.length));
        },
        close() { ws.readyState = 3; ws.emit('close'); done({ info: ws.info, frame: ws.frame }); },
      });
      const params = new URLSearchParams('width=0&depth=16');
      startHelperStream(ws, {
        bin: process.execPath, args: [fake, '--capture', String(y), '3'], label: 'DeckLink', params,
        ctx: { ffmpeg, fail: (w: typeof ws, m: string) => { w.info.last = { type: 'error', message: m }; w.close(); }, outputSize, decodeParams, applyDecodeOverride, deviceOptions },
      });
    });
    const white = await run(940);
    expect(white.info).toMatchObject({ width: 96, height: 54, depth: 16, sourceWidth: 96, pixFmt: 'v210', decodeMatrix: 'bt709', timecode: '10:00:00:00' });
    expect(white.frame).not.toBeNull();
    // BT.709 limited range: Y′ 64…940 (10 bit) = 0…100 %; Cb = Cr = 512 is achromatic.
    // swscale's limited→full step into rgba64 has a gain of ≈ 255/256 (940 → 65283, measured
    // with ffmpeg 8 on 30.09.2026) – a property of the existing bridge path, hence 0.5 %.
    for (const v of white.frame!.slice(0, 3)) expect(Math.abs(v / 65535 - 1)).toBeLessThan(0.005);
    const grey = await run(502);
    for (const v of grey.frame!.slice(0, 3)) expect(Math.abs(v / 65535 - (502 - 64) / 876)).toBeLessThan(0.005);
  }, 20000);
});
