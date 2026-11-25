import { describe, expect, it } from 'vitest';
import { foundDevices } from '../src/deviceScan';

describe('device suggestions (#221)', () => {
  it('lists DeckLink, AJA and NDI inputs the bridge sees, minus existing sources', () => {
    const f = foundDevices(
      { available: true, devices: [{ index: 0, name: 'UltraStudio Recorder 3G' }, { index: 1, name: 'DeckLink Duo (2)' }] },
      { available: true, devices: [{ index: 0, name: 'KONA 5' }] },
      { available: true, sources: [{ name: 'STUDIO-PC (Cam 1)' }] },
      ['decklink:1'],
    );
    expect(f.map((x) => x.url)).toEqual(['decklink:0', 'aja:0', 'ndi:STUDIO-PC (Cam 1)']);
    expect(f[2].name).toBe('Cam 1');
  });
  it('ST 2110 network inputs with an SDP (#228)', () => {
    const net = { inputs: [{ url: 'st2110:net1', connected: true, summary: { name: 'Cam 3', format: '1920×1080p 50' } }, { url: 'st2110:net2', connected: false, summary: null }] };
    expect(foundDevices(null, null, null, [], net)).toEqual([{ url: 'st2110:net1', name: 'Cam 3', kind: 'st2110' }]);
  });
  it('nothing when the bridge is missing or a runtime is not installed', () => {
    expect(foundDevices(null, { available: false, devices: [{ index: 0, name: 'x' }] }, null, [])).toEqual([]);
  });
});
