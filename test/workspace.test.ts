// Workspaces (#238): the share link carries a layout configuration through the URL fragment and
// back unchanged; a damaged link is refused instead of loading half a layout; widget URLs only
// accept scopes a widget can show.
import { describe, expect, it } from 'vitest';
import {
  MAX_WIDGET_SCOPES, decodeWorkspace, encodeWorkspace, freeName, iframeSnippet, nextName, parseWidget, shareFromHash, shareUrl, widgetUrl,
} from '../src/workspace';

const cfg = {
  dock: { grid: { root: { type: 'branch', data: [] } }, panels: { p0: { id: 'p0' } } },
  panels: [{ scope: 'picture', sourceId: 's1' }, { scope: 'wf-luma', sourceId: '', gain: 1.5 }],
  settings: { unit: 'percent', theme: 'studio' },
  saved: '2026-11-24T10:00:00.000Z',
};

describe('share link', () => {
  for (const compress of [true, false]) {
    it(`round trip ${compress ? 'compressed' : 'plain'}`, async () => {
      const enc = await encodeWorkspace('Studio „B“ & Co', cfg, compress);
      expect(enc).toMatch(/^[^#?&=]+$/); // fragment-safe, no separators of its own
      const back = await decodeWorkspace(enc);
      expect(back).toEqual({ name: 'Studio „B“ & Co', config: cfg });
    });
  }

  it('compressed is shorter than plain for a real-sized layout', async () => {
    const big = { ...cfg, panels: Array.from({ length: 9 }, (_, i) => ({ scope: 'wf-luma', sourceId: `s${i}`, gain: 1, colorize: false, zoom: 1 })) };
    const z = await encodeWorkspace('x', big, true), j = await encodeWorkspace('x', big, false);
    expect(z.length).toBeLessThan(j.length);
  });

  it('survives a URL and its hash', async () => {
    const enc = await encodeWorkspace('Grading', cfg);
    const url = shareUrl('http://scopes.local:4192/?foo=1#old', enc);
    const u = new URL(url);
    expect(u.search).toBe('?foo=1');
    expect(shareFromHash(u.hash)).toBe(enc);
    expect((await decodeWorkspace(shareFromHash(u.hash)!))?.name).toBe('Grading');
  });

  it('refuses damaged or foreign input', async () => {
    const enc = await encodeWorkspace('A', cfg);
    expect(await decodeWorkspace(enc.slice(0, enc.length - 12))).toBeNull();
    expect(await decodeWorkspace('A~q123')).toBeNull();
    expect(await decodeWorkspace('no-separator')).toBeNull();
    expect(await decodeWorkspace(await encodeWorkspace('A', { panels: 'x', dock: {} }))).toBeNull();
    expect(await decodeWorkspace(await encodeWorkspace('A', { panels: [] }))).toBeNull();
    expect(await decodeWorkspace(await encodeWorkspace('', cfg))).toBeNull();
    expect(shareFromHash('')).toBeNull();
    expect(shareFromHash('#other=1')).toBeNull();
  });

  it('names', () => {
    expect(freeName('Studio', ['Grading'])).toBe('Studio');
    expect(freeName('Studio', ['Studio', 'Studio (2)'])).toBe('Studio (3)');
    expect(nextName('Workspace', [])).toBe('Workspace 1');
    expect(nextName('Workspace', ['Workspace 1', 'Workspace 3'])).toBe('Workspace 2');
  });
});

describe('widget URL', () => {
  it('round trip', () => {
    const url = widgetUrl('http://scopes.local:4192/index.html?x=1#y', { scopes: ['wf-luma', 'vector'], src: 'rtsp://cam/stream?a=1&b=2', unit: 'nits', lang: 'de' });
    const u = new URL(url);
    expect(u.hash).toBe('');
    const p = parseWidget(u.searchParams);
    expect(p).toMatchObject({ scopes: ['wf-luma', 'vector'], src: 'rtsp://cam/stream?a=1&b=2', unit: 'nits', lang: 'de', selectors: false, bridge: '', frames: '' });
  });

  it('drops what a widget cannot show and keeps at most four', () => {
    const q = new URLSearchParams({ widget: 'tiles,wf-luma,audio-meter,vector,hist,parade,cie', unit: 'furlong', lang: 'fr', bridge: 'http://x', frames: 'ws://h/scope/3' });
    const p = parseWidget(q);
    expect(p.scopes).toEqual(['wf-luma', 'vector', 'hist', 'parade']);
    expect(p.scopes.length).toBe(MAX_WIDGET_SCOPES);
    expect(p.unit).toBe('');
    expect(p.lang).toBe('');
    expect(p.bridge).toBe('');
    expect(p.frames).toBe('ws://h/scope/3');
    expect(parseWidget(new URLSearchParams('widget=')).scopes).toEqual(['wf-luma']);
  });

  it('iframe snippet escapes the URL', () => {
    const s = iframeSnippet('http://h/?widget=wf-luma&src="x"', 'A & B');
    expect(s).toContain('src="http://h/?widget=wf-luma&amp;src=&quot;x&quot;"');
    expect(s).toContain('title="A &amp; B"');
  });
});
