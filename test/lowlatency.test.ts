import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { ageStats, ffmpegArgs } from '../server/index.mjs';
import { LatencyMeter, latencyLines, rtpLines } from '../src/latency';
import { DEFAULT_LOW_LATENCY, effectiveWidth, mergeLowLatency } from '../src/lowLatency';

// Low-latency mode (docs/research/low-latency.md)

describe('Latenzstufen', () => {
  afterEach(() => { LatencyMeter.drawHook = false; });

  it('teilt Stempel → gezeichnet in Übergaben auf', () => {
    LatencyMeter.drawHook = true;
    const m = new LatencyMeter();
    // stamp 1000, left ffmpeg 1040 (H.264 header), worker 1050, main thread 1052, drawn 1060–1065
    m.onFrame({ stamp: 1000, bridge: 1040, arrive: 1050, decodeMs: 6, replaced: 0 }, 1052);
    expect(m.waiting).toBe(true);
    m.drawn(1060, 1065);
    expect(m.waiting).toBe(false);
    const s = m.summary(1065)!;
    expect(s.total.mean).toBe(65);
    expect(s.toBridge!.mean).toBe(40);
    expect(s.bridgeToApp!.mean).toBe(10);
    expect(s.decode!.mean).toBe(6);
    expect(s.handoff!.mean).toBe(2);
    expect(s.wait!.mean).toBe(8);
    expect(s.draw!.mean).toBe(5);
  });

  it('zählt ein Bild nur einmal und nimmt auf dem Rohweg die Bridge-Messung aus der Statistik', () => {
    LatencyMeter.drawHook = true;
    const m = new LatencyMeter();
    m.onFrame({ stamp: 2000, bridge: NaN, arrive: 2090, replaced: 0 }, 2091);
    m.drawn(2095, 2100);
    m.onFrame({ stamp: 2000, bridge: NaN, arrive: 2130, replaced: 0 }, 2131); // same stamp again
    m.drawn(2135, 2140);
    m.onBridgeStats({ mean: 88, min: 80, max: 97 }, 2100);
    const s = m.summary(2140)!;
    expect(s.frames).toBe(1);
    expect(s.toBridge).toEqual({ mean: 88, min: 80, max: 97 });
    expect(s.bridgeToApp).toBeNull();
    // bridge figure older than the 2-s window: dropped
    expect(m.summary(4200)).toBeNull();
  });

  it('Messwerte-Zeilen sagen, wenn Low Latency an ist, aber nichts gemessen wird', () => {
    expect(latencyLines(null)).toEqual([]);
    expect(latencyLines(null, true).join(' ')).toContain('nicht gemessen');
    const s = { total: { mean: 60, min: 50, max: 70 }, toBridge: null, bridgeToApp: null, decode: null, handoff: null, wait: null, draw: null, frames: 10 };
    expect(latencyLines(s, true)[1]).toContain('Low Latency · Stempel → gezeichnet 60 ms (50–70)');
  });

  it('Mittel/min/max der Stempelalter für die Bridge-Statistik', () => {
    expect(ageStats([80, 90, 100])).toEqual({ mean: 90, min: 80, max: 100 });
  });
});

describe('Messwerte: RTP-Eigenempfang', () => {
  it('Verlustquote, Wechsel auf TCP, Rückfall-Grund', () => {
    const l = rtpLines({ own: true, codec: 'h264', transport: 'udp' }, { transport: 'tcp', packets: 653, lost: 139, reordered: 0, late: 0, accessUnits: 3, droppedUnits: 36, switched: 'UDP verlor 18 % der Pakete → TCP' });
    expect(l[0]).toContain('RTP eigen · H.264 · TCP');
    expect(l[1]).toContain('→ TCP');
    expect(l[2]).toContain('139 verloren (17.6 %)');
    expect(rtpLines({ own: false, note: 'RTP-Eigenempfang nur für rtsp://' }, null)).toEqual(['Empfang    RTP-Eigenempfang nur für rtsp://']);
    expect(rtpLines(null, null)).toEqual([]);
  });
});

describe('Low-Latency-Einstellungen', () => {
  it('Analysebreite: Obergrenze nur im Modus, kleinere Wahl bleibt, 0 = keine Grenze', () => {
    expect(effectiveWidth(960, true, 640)).toBe(640);
    expect(effectiveWidth(0, true, 640)).toBe(640); // nativ
    expect(effectiveWidth(480, true, 640)).toBe(480);
    expect(effectiveWidth(1920, false, 640)).toBe(1920);
    expect(effectiveWidth(1920, true, 0)).toBe(1920);
    expect(effectiveWidth(960, true, 320)).toBe(320);
  });
  it('eigene Werte der Quelle vor globalen, sonst Vorgaben', () => {
    expect(mergeLowLatency(undefined, undefined)).toEqual(DEFAULT_LOW_LATENCY);
    expect(mergeLowLatency({ width: 480, statsMs: 500 }, { statsMs: 250, ownRtp: false })).toEqual({ width: 480, drawOnArrive: true, ownRtp: false, statsMs: 250 });
  });
});

describe('ffmpeg: Rohbilder ohne Encoder-Threads', () => {
  // The rawvideo encoder is frame-threaded (AV_CODEC_CAP_FRAME_THREADS, libavcodec/rawenc.c);
  // ff_thread_video_encode_frame then returns frame N only once frame N+1 is submitted.
  // Measured: 42 ms → 2 ms from the end of the filter chain to the pipe at 25 fps.
  it('setzt -threads 1 als Ausgabeoption vor -f rawvideo', () => {
    const { main } = ffmpegArgs({ url: 'rtsp://127.0.0.1/x', vf: 'scale=960:540' });
    const i = main.indexOf('-i'), f = main.lastIndexOf('-f');
    const t = main.lastIndexOf('-threads');
    expect(t).toBeGreaterThan(i);
    expect(main.slice(t, t + 4)).toEqual(['-threads', '1', '-f', 'rawvideo']);
    expect(f).toBe(t + 2);
  });
  it('H.264-Übertragung bleibt unverändert (x264 zerolatency nutzt Slice-Threads)', () => {
    const { main } = ffmpegArgs({ url: 'rtsp://127.0.0.1/x', vf: 'scale=960:540,format=yuv420p', codec: 'h264' });
    expect(main).not.toContain('-threads');
  });
});
