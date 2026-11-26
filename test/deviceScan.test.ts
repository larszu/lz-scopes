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
    expect(foundDevices(null, null, null, [], null, net)).toEqual([{ url: 'st2110:net1', name: 'Cam 3', kind: 'st2110' }]);
  });
  it('nothing when the bridge is missing or a runtime is not installed', () => {
    expect(foundDevices(null, { available: false, devices: [{ index: 0, name: 'x' }] }, null, [])).toEqual([]);
  });
});

describe('capture devices as suggestions (#221)', () => {
  const capture = [
    { name: 'Cam Link 4K', url: 'device:avfoundation:Cam Link 4K', kind: 'video' },
    { name: 'Cam Link 4K', url: 'audio:avfoundation:Cam Link 4K', kind: 'audio' },
    { name: 'USB Video', url: 'device:dshow:USB Video', kind: 'video' },
    { name: 'Digital Audio Interface (USB Digital Audio)', url: 'audio:dshow:Digital Audio Interface (USB Digital Audio)', kind: 'audio' },
  ];
  it('video devices from /api/devices, sound only from the device of the same name', () => {
    const f = foundDevices(null, null, null, [], capture);
    expect(f.map((x) => [x.kind, x.url])).toEqual([
      ['device', 'device:avfoundation:Cam Link 4K#audio=Cam Link 4K'],
      ['device', 'device:dshow:USB Video'],
    ]);
  });
  it('a source of the same device with another sound choice counts as existing', () => {
    expect(foundDevices(null, null, null, ['device:avfoundation:Cam Link 4K'], capture).map((x) => x.url)).toEqual(['device:dshow:USB Video']);
  });
  it('Blackmagic WDM Device: a hint to DeckLink instead of an add button, once', () => {
    const wdm = [
      { name: 'Blackmagic WDM Device', url: 'device:dshow:Blackmagic WDM Device', kind: 'video' },
      { name: 'Blackmagic WDM Device (2)', url: 'device:dshow:Blackmagic WDM Device (2)', kind: 'video' },
    ];
    const f = foundDevices({ available: false, devices: [] }, null, null, ['device:dshow:Blackmagic WDM Device'], wdm);
    expect(f).toEqual([{ url: 'device:dshow:Blackmagic WDM Device', name: 'Blackmagic WDM Device', kind: 'device', blackmagicCamera: true }]);
  });
  it('no camera entry when the DeckLink helper already sees the card', () => {
    const f = foundDevices({ available: true, devices: [{ index: 0, name: 'UltraStudio Recorder 3G' }] }, null, null, [],
      [{ name: 'UltraStudio Recorder 3G', url: 'device:avfoundation:UltraStudio Recorder 3G', kind: 'video' }]);
    expect(f.map((x) => x.url)).toEqual(['decklink:0']);
  });
});
