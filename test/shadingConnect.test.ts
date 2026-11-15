import { describe, expect, it } from 'vitest';
import { urlFor, nmosAvailable, choiceFromUrl, DEFAULT_CHOICE, keyOf, type FoundBridge } from '../src/shading/connect';
// @ts-expect-error plain JS server module
import { entryOf } from '../server/cameraBridges.mjs';

const found: FoundBridge[] = [{ name: 'LZ Camera Bridge (Regie)', host: '10.0.0.5', port: 9700, nmosPort: 8640, version: '1.2.0' }];

describe('bridge choice instead of a typed address (#224)', () => {
  it('derives the address from bridge and route', () => {
    const local = { port: 9700, nmosPort: 8640 };
    expect(urlFor(DEFAULT_CHOICE, found, local)).toBe('ws://localhost:9700');
    expect(urlFor({ ...DEFAULT_CHOICE, route: 'nmos' }, found, local)).toBe('http://localhost:8640');
    expect(urlFor({ ...DEFAULT_CHOICE, bridge: keyOf(found[0]), route: 'nmos' }, found, local)).toBe('http://10.0.0.5:8640');
    expect(urlFor({ ...DEFAULT_CHOICE, route: 'nmos' }, found, { port: 9700, nmosPort: null })).toBe('ws://localhost:9700');
    expect(urlFor({ bridge: 'manual', route: 'bridge', manualUrl: ' ws://x:1 ' }, found, local)).toBe('ws://x:1');
    expect(urlFor({ ...DEFAULT_CHOICE, bridge: '10.9.9.9:9700' }, found, local)).toBe('');
  });
  it('offers NMOS only where the bridge reports a node', () => {
    expect(nmosAvailable(DEFAULT_CHOICE, found, null)).toBe(false);
    expect(nmosAvailable(DEFAULT_CHOICE, found, 8640)).toBe(true);
    expect(nmosAvailable({ ...DEFAULT_CHOICE, bridge: keyOf(found[0]) }, found, null)).toBe(true);
  });
  it('keeps an old typed address as "other address"', () => {
    expect(choiceFromUrl('ws://localhost:9700')).toEqual(DEFAULT_CHOICE);
    expect(choiceFromUrl('ws://10.0.0.9:9700')).toEqual({ bridge: 'manual', route: 'bridge', manualUrl: 'ws://10.0.0.9:9700' });
  });
  it('turns a DNS-SD record into an entry', () => {
    expect(entryOf({ name: 'B', addresses: ['fe80::1', '10.0.0.7'], port: 9700, txt: { nmos: '8640', v: '1.2.0' } })).toEqual({ name: 'B', host: '10.0.0.7', port: 9700, nmosPort: 8640, version: '1.2.0' });
    expect(entryOf({ name: 'B', addresses: ['10.0.0.7'], port: 9700, txt: { nmos: '' } })?.nmosPort).toBeNull();
  });
});
