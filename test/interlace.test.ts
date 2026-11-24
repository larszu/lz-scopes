import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { defaultFieldOrder, interlaceInfo, interlaceOptions, interlacePlan, probeFieldOrder } from '../server/interlace.mjs';
// @ts-expect-error plain JS module
import { startHelperStream } from '../server/helper-input.mjs';
// @ts-expect-error plain JS module
import { applyDecodeOverride, deviceOptions } from '../server/devices.mjs';
// @ts-expect-error plain JS module
import { decodeParams, ffmpegCandidates, outputSize } from '../server/index.mjs';
import { bridgeInputParams, DEFAULT_SETTINGS } from '../src/sources';

// #219: field order and de-interlacing per bridge source (server/interlace.mjs).
describe('field order', () => {
  it('ffprobe field_order: the display order counts (tt/bt upper first, bb/tb lower first)', () => {
    expect(probeFieldOrder('tt')).toBe('tff');
    expect(probeFieldOrder('bt')).toBe('tff');
    expect(probeFieldOrder('bb')).toBe('bff');
    expect(probeFieldOrder('tb')).toBe('bff');
    for (const f of ['progressive', 'unknown', undefined, '']) expect(probeFieldOrder(f)).toBeNull();
  });
  it('helpers without fieldOrder: 525-line SD lower first, everything else upper first', () => {
    expect(defaultFieldOrder(480)).toBe('bff');
    expect(defaultFieldOrder(486)).toBe('bff');
    expect(defaultFieldOrder(576)).toBe('tff');
    expect(defaultFieldOrder(1080)).toBe('tff');
  });
  it('query parameters: unknown values fall back to auto, deint only with 1', () => {
    expect(interlaceOptions(new URLSearchParams('field=bff&deint=1'))).toEqual({ field: 'bff', deint: true });
    expect(interlaceOptions(new URLSearchParams('field=evil&deint=yes'))).toEqual({ field: 'auto', deint: false });
    expect(interlaceOptions(new URLSearchParams(''))).toEqual({ field: 'auto', deint: false });
  });
});

describe('interlacePlan', () => {
  it('auto follows the source; woven fields are scaled field by field', () => {
    const p = interlacePlan('tff', { field: 'auto', deint: false });
    expect(p).toMatchObject({ interlaced: true, fields: 'tff', forced: false, deinterlace: false, filter: '', interl: true });
    expect(interlaceInfo(p)).toEqual({ interlaced: true, fields: 'tff', sourceFields: 'tff' });
    expect(interlacePlan(null, { field: 'auto', deint: true })).toMatchObject({ interlaced: false, deinterlace: false, filter: '', interl: false });
  });
  it('de-interlacing: bwdif with explicit parity before the scaler, no interl', () => {
    const p = interlacePlan('bff', { field: 'auto', deint: true });
    expect(p.filter).toBe('bwdif=mode=send_frame:parity=bff:deint=all');
    expect(p.interl).toBe(false);
    expect(interlaceInfo(p)).toEqual({ interlaced: true, fields: 'bff', deinterlaced: true, sourceFields: 'bff' });
  });
  it('forced order overrides the source; progressive switches interlace handling off', () => {
    const p = interlacePlan('tff', { field: 'bff', deint: true });
    expect(p.filter).toContain('parity=bff');
    expect(interlaceInfo(p)).toMatchObject({ fields: 'bff', sourceFields: 'tff', fieldsForced: true });
    const q = interlacePlan(null, { field: 'tff', deint: false });
    expect(q).toMatchObject({ interlaced: true, interl: true, forced: true });
    const r = interlacePlan('tff', { field: 'progressive', deint: true });
    expect(r).toMatchObject({ interlaced: false, deinterlace: false, filter: '', interl: false, forced: true });
    expect(interlaceInfo(r)).toEqual({ sourceFields: 'tff', fieldsForced: true });
    // forcing what the source already reports is no override
    expect(interlacePlan('tff', { field: 'tff', deint: false }).forced).toBe(false);
  });
  it('source card settings become bridge parameters', () => {
    expect(bridgeInputParams('rtsp://cam/x', { ...DEFAULT_SETTINGS, fieldOrder: 'bff', deinterlace: true })).toMatchObject({ field: 'bff', deint: '1' });
    const q = bridgeInputParams('decklink:0', { ...DEFAULT_SETTINGS, fieldOrder: 'auto', deinterlace: false });
    expect(q.field).toBeUndefined();
    expect(q.deint).toBeUndefined();
  });
});

describe('interlace in ffmpeg', () => {
  const ff = spawnSync('ffmpeg', ['-version']).status === 0;
  // a vertical edge moving right by 4 px per field; the upper (even) lines are the earlier field
  // (tff). Woven, the edge combs: neighbouring lines differ at the edge.
  const W = 64;
  const comb = (vf: string) => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `nullsrc=s=${W}x${W}:r=25,format=gray,geq=lum='if(lt(X,8+4*(2*N+mod(Y,2))),235,16)'`,
      '-frames:v', '5', '-vf', vf, '-pix_fmt', 'gray', '-f', 'rawvideo', 'pipe:1']);
    const frames = r.stdout.length / (W * W);
    const f = r.stdout.subarray(3 * W * W, 4 * W * W);
    let c = 0;
    for (let y = 10; y < 50; y += 2) for (let x = 0; x < W; x++) c += Math.abs(f[y * W + x] - f[(y + 1) * W + x]);
    // where the edge stands on an odd and an even line (count of white samples)
    const edge = (y: number) => [...f.subarray(y * W, (y + 1) * W)].filter((v) => v > 128).length;
    return { frames, c, edges: [edge(20), edge(21)] };
  };
  it.skipIf(!ff)('bwdif removes the comb, keeps one picture per frame and follows the field order', () => {
    const woven = comb('null');
    const tff = comb(interlacePlan('tff', { field: 'auto', deint: true }).filter);
    const bff = comb(interlacePlan('bff', { field: 'auto', deint: true }).filter);
    expect(woven.edges).toEqual([32, 36]);
    expect(tff.frames).toBe(5);
    expect(tff.c).toBeLessThan(woven.c / 4);
    // the picture shows the instant of the field named first: upper first keeps the even lines
    // (edge at 32 on both), lower first the odd ones (36) – a wrong setting shifts it by a field
    expect(tff.edges).toEqual([32, 32]);
    expect(bff.edges).toEqual([36, 36]);
  });
});

describe('interlace in the helper path (DeckLink INFO with fieldOrder)', () => {
  const fake = fileURLToPath(new URL('./fixtures/fake-helper.mjs', import.meta.url));
  const runHelper = (query: string, ffmpeg: string) => new Promise<{ msgs: Record<string, unknown>[]; frames: number }>((done) => {
    const msgs: Record<string, unknown>[] = [];
    let frames = 0;
    const ws = Object.assign(new EventEmitter(), {
      OPEN: 1, readyState: 1, bufferedAmount: 0,
      send(d: Buffer | string) { if (typeof d === 'string') msgs.push(JSON.parse(d)); else frames++; },
      close() { ws.readyState = 3; ws.emit('close'); done({ msgs, frames }); },
    });
    startHelperStream(ws, {
      bin: process.execPath, args: [fake, '--interlaced', '940', '6'], label: 'DeckLink', params: new URLSearchParams(query),
      ctx: { ffmpeg, fail: (_w: unknown, e: unknown) => { msgs.push({ type: 'fail', e }); ws.close(); }, outputSize, decodeParams, applyDecodeOverride, deviceOptions },
    });
  });
  it('fields kept apart: the v210 passthrough stays and reports the helper\'s field order', async () => {
    const { msgs } = await runHelper('depth=16&format=yuv&pack=v210&width=0', 'no-such-ffmpeg');
    expect(msgs.find((m) => m.type === 'info')).toMatchObject({ pack: 'v210', interlaced: true, fields: 'bff', sourceFields: 'bff' });
  });
  const ff0 = ffmpegCandidates()[0];
  it.skipIf(!ff0)('de-interlacing needs ffmpeg: no passthrough, info says deinterlaced, pictures arrive', async () => {
    const { msgs, frames } = await runHelper('depth=16&format=yuv&pack=v210&width=0&deint=1&latency=fixed', ff0);
    expect(msgs.find((m) => m.type === 'fail')).toBeUndefined();
    const info = msgs.find((m) => m.type === 'info');
    expect(info?.pack).toBeUndefined();
    expect(info).toMatchObject({ interlaced: true, deinterlaced: true, fields: 'bff' });
    expect(frames).toBeGreaterThanOrEqual(4);
  });
});
