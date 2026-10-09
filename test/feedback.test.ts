import { describe, expect, it } from 'vitest';
import { logLine, logLines, redact } from '../src/feedback/log';
import { buildReport, fitForUrl, SECTIONS, type FeedbackData } from '../src/feedback/report';

const titles = { system: 'System', display: 'Display', performance: 'Performance', log: 'Log' };
const data: FeedbackData = {
  app: { version: '1.6.0', platform: 'desktop', lang: 'de' },
  system: { os: 'Windows_NT 10.0.22631 (Windows 11 Pro)', arch: 'x64', cpu: 'Intel i5', cores: 8, ramGb: 16, runtime: 'Electron 38' },
  display: { gpu: 'ANGLE (NVIDIA RTX 3060, D3D11)', gpuFeatures: 'webgl2=enabled', screens: ['1920×1080 @1x · 60 Hz · primary'] },
  performance: {
    displayFps: 30, panels: ['waveform', 'vectorscope'], bridge: true, ffmpeg: '8.0 · bundled',
    sources: [{ kind: 'stream', status: 'error', width: 960, height: 540, depth: 16, fps: 2, dropped: 40, codec: 'NDI', message: 'cannot open rtsp://admin:secret@192.168.0.10:554/live' }],
  },
  log: ['00:03 E failed for C:\\Users\\Tester\\Videos\\clip.mov'],
};

describe('feedback report', () => {
  it('redacts credentials, hosts, IPs, e-mail addresses and user names', () => {
    const r = redact('rtsp://admin:pw@10.0.0.5/x mail me@example.com at 192.168.1.2, /Users/lars/a C:\\Users\\Tester\\b');
    expect(r).not.toMatch(/admin|pw@|10\.0\.0\.5|me@example|192\.168|lars|Tester/);
    expect(r).toContain('rtsp://…');
  });
  it('contains only the chosen sections, all of it redacted', () => {
    const all = buildReport(data, { sections: new Set(SECTIONS), description: 'NDI ruckelt', titles });
    expect(all).toMatch(/^NDI ruckelt\n\nLZ Scopes 1\.6\.0/);
    expect(all).toContain('Windows 11 Pro');
    expect(all).toContain('60 Hz');
    expect(all).toContain('Display: 30 fps');
    expect(all).toContain('2 fps · 40 dropped');
    expect(all).not.toMatch(/secret|192\.168|Tester/);
    const some = buildReport(data, { sections: new Set(['performance']), description: '', titles });
    expect(some).not.toContain('Windows 11');
    expect(some).not.toContain('RTX');
    expect(some).not.toContain('## Log');
    expect(some).toContain('## Performance');
  });
  it('shortens for URLs with a note, keeps short reports whole', () => {
    expect(fitForUrl('kurz', 100, 'cut')).toBe('kurz');
    const long = 'ä'.repeat(3000);
    const fit = fitForUrl(long, 1800, '[cut]');
    expect(encodeURIComponent(fit).length).toBeLessThanOrEqual(1800);
    expect(fit.endsWith('[cut]')).toBe(true);
  });
  it('log keeps redacted lines and collapses repeats', () => {
    logLine('warn', 'x from 10.1.2.3'); logLine('warn', 'x from 10.1.2.3');
    const l = logLines().filter((s) => s.includes('x from'));
    expect(l).toHaveLength(1);
    expect(l[0]).toMatch(/W x from <ip>$/);
  });
});

describe('gpu advice', async () => {
  const { gpuAdvice } = await import('../src/feedback/gpuAdvice');
  const ok = { webgl2: 'enabled', gpu_compositing: 'enabled' };
  it('Windows on Intel next to NVIDIA → integrated', () => {
    expect(gpuAdvice({ platform: 'win32', gpuFeatures: ok, gpus: [{ vendorId: 0x8086, deviceId: 1, active: true }, { vendorId: 0x10de, deviceId: 2, active: false }] }))
      .toEqual({ kind: 'integrated', active: 'Intel', other: 'NVIDIA' });
  });
  it('no advice on the dedicated GPU, on Intel alone or on macOS', () => {
    expect(gpuAdvice({ platform: 'win32', gpuFeatures: ok, gpus: [{ vendorId: 0x8086, deviceId: 1, active: false }, { vendorId: 0x10de, deviceId: 2, active: true }] })).toBeNull();
    expect(gpuAdvice({ platform: 'win32', gpuFeatures: ok, gpus: [{ vendorId: 0x8086, deviceId: 1, active: true }] })).toBeNull();
    expect(gpuAdvice({ platform: 'darwin', gpuFeatures: ok, gpus: [{ vendorId: 0x8086, deviceId: 1, active: true }, { vendorId: 0x1002, deviceId: 2, active: false }] })).toBeNull();
  });
  it('software rendering on any platform', () => {
    expect(gpuAdvice({ platform: 'linux', gpuFeatures: { webgl2: 'enabled', gpu_compositing: 'disabled_software' }, gpus: [] })).toEqual({ kind: 'software' });
    expect(gpuAdvice({ platform: 'win32', gpuFeatures: { webgl2: 'unavailable_software' }, gpus: [] })).toEqual({ kind: 'software' });
  });
});
