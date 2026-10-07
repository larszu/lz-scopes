import { describe, expect, it, vi } from 'vitest';
import { frameUrl, hostKey, installRtspDirect, isDirectUrl, splitCredentials, type RtspNative } from '../src/native/rtspDirect';
import { streamRoute } from '../src/streamRoute';
import type { SourceSettings } from '../src/sources';

// iOS RTSP direct (#90): routing, credentials out of the URL, frame-server URL.

describe('RTSP direkt (iOS)', () => {
  it('nur rtsp:// geht direkt, rtsps und andere über die Bridge', () => {
    expect(isDirectUrl('rtsp://10.0.0.5/stream1')).toBe(true);
    expect(isDirectUrl(' RTSP://cam:8554/a ')).toBe(true);
    expect(isDirectUrl('rtsps://cam/a')).toBe(false);
    expect(isDirectUrl('srt://cam:9000')).toBe(false);
    expect(isDirectUrl('test:bars')).toBe(false);
  });

  it('trennt Zugangsdaten aus der Adresse (Prozent-kodiert)', () => {
    expect(splitCredentials('rtsp://us%40er:p%3Ass@10.0.0.5:554/s1')).toEqual({ url: 'rtsp://10.0.0.5:554/s1', user: 'us@er', pass: 'p:ss' });
    expect(splitCredentials('rtsp://admin@cam/s')).toEqual({ url: 'rtsp://cam/s', user: 'admin', pass: '' });
    expect(splitCredentials('rtsp://cam/s')).toEqual({ url: 'rtsp://cam/s', user: null, pass: '' });
    // an @ in the path is not a credential separator
    expect(splitCredentials('rtsp://cam/s@1').user).toBeNull();
  });

  it('Schlüsselbund-Schlüssel host:port, Standardport 554', () => {
    expect(hostKey('rtsp://Cam.local/s')).toBe('cam.local:554');
    expect(hostKey('rtsp://10.0.0.5:8554/s')).toBe('10.0.0.5:8554');
    expect(hostKey('rtsp://[fe80::1]:554/s')).toBe('[fe80::1]:554');
  });

  it('Bildserver-Adresse mit Token, Transport, Breite und WebCodecs-Liste', () => {
    const u = new URL(frameUrl({ port: 50123, token: 'abc' }, 'rtsp://cam/s', { transport: 'udp', width: 960 }, ['h264', 'hevc']));
    expect(u.host).toBe('127.0.0.1:50123');
    expect(u.pathname).toBe('/rtsp');
    expect(Object.fromEntries(u.searchParams)).toEqual({ token: 'abc', url: 'rtsp://cam/s', transport: 'udp', width: '960', wc: 'h264,hevc' });
  });

  it('Normaliser legt Zugangsdaten in den Schlüsselbund, die Verbindung wartet darauf', async () => {
    let release!: () => void;
    const saved = new Promise<void>((r) => { release = r; });
    const native: RtspNative = {
      rtspServer: vi.fn(async () => ({ port: 4000, token: 't' })),
      rtspSaveCredentials: vi.fn(async () => { await saved; return { saved: true }; }),
      rtspCredentials: vi.fn(async () => ({ entries: [] })),
      rtspForget: vi.fn(async () => ({ removed: true })),
    };
    installRtspDirect(native, streamRoute, () => {});
    expect(streamRoute.normalise('rtsp://lzs:geheim@cam:8554/s')).toBe('rtsp://cam:8554/s');
    expect(native.rtspSaveCredentials).toHaveBeenCalledWith({ url: 'rtsp://cam:8554/s', user: 'lzs', pass: 'geheim' });
    expect(streamRoute.normalise('srt://x:1')).toBe('srt://x:1');
    expect(streamRoute.resolve('srt://x:1', { transport: 'tcp' } as SourceSettings)).toBeNull();
    const p = streamRoute.resolve('rtsp://cam:8554/s', { transport: 'tcp', width: 0 } as SourceSettings)!;
    let done = false;
    void p.then(() => { done = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(done).toBe(false); // still waiting for the Keychain
    release();
    const ws = await p;
    expect(ws).toMatch(/^ws:\/\/127\.0\.0\.1:4000\/rtsp\?token=t&url=rtsp%3A%2F%2Fcam%3A8554%2Fs&transport=tcp/);
    expect(ws).not.toContain('geheim');
    streamRoute.set(null); streamRoute.setNormaliser((u) => u);
  });
});
