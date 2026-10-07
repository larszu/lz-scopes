// iOS/iPadOS app (docs/ios.md): bridge discovery, the Web Bluetooth shim over CoreBluetooth
// (driven with a fake BleClient through the same calls src/opple/meter.ts makes) and the
// Bonjour announcement rules of the bridge.
import { describe, expect, it } from 'vitest';
import { bridgeAddress, normaliseBridgeInput, uniqueBridges } from '../src/native/discovery';
import { createBluetooth, matchesFilters, strongest } from '../src/native/webBluetooth';
import { REQUEST_OPTIONS } from '../src/opple/meter';
import { NUS_RX, NUS_SERVICE, NUS_TX } from '../src/opple/protocol';
import { PRESETS } from '../src/dock';
import { instanceName, shouldAnnounce, srvHost } from '../server/bonjour.mjs';

describe('bridge address from Bonjour', () => {
  it('prefers IPv4, then bracketed IPv6, then the .local name', () => {
    expect(bridgeAddress({ name: 'a', host: 'Studio.local.', port: 4192, addresses: ['fd00::5', '10.0.0.7'] })).toBe('ws://10.0.0.7:4192');
    expect(bridgeAddress({ name: 'a', host: 'Studio.local.', port: 4192, addresses: ['fd00::5'] })).toBe('ws://[fd00::5]:4192');
    expect(bridgeAddress({ name: 'a', host: 'Studio.local.', port: 50123, addresses: [] })).toBe('ws://Studio.local:50123');
  });
  it('drops duplicates (one bridge seen on two interfaces) and empty entries', () => {
    const l = uniqueBridges([
      { name: 'B', host: 'b.local.', port: 4192, addresses: ['10.0.0.2'] },
      { name: 'A', host: 'a.local.', port: 4192, addresses: ['10.0.0.1'] },
      { name: 'A', host: 'a.local.', port: 4192, addresses: ['10.0.0.1'] },
      { name: 'X', host: '', port: 0, addresses: [] },
    ]);
    expect(l.map((b) => b.name)).toEqual(['A', 'B']);
  });
  it('normalises typed addresses to ws:// with the default port 4192', () => {
    expect(normaliseBridgeInput('192.168.1.20')).toBe('ws://192.168.1.20:4192');
    expect(normaliseBridgeInput('192.168.1.20:5000/')).toBe('ws://192.168.1.20:5000');
    expect(normaliseBridgeInput('studio.local')).toBe('ws://studio.local:4192');
    expect(normaliseBridgeInput('[fd00::5]:4192')).toBe('ws://[fd00::5]:4192');
    expect(normaliseBridgeInput('http://10.0.0.1:4192')).toBe('http://10.0.0.1:4192');
    expect(normaliseBridgeInput('  ')).toBe('');
  });
});

describe('Bonjour announcement of the bridge', () => {
  it('announces only when the bridge listens beyond loopback', () => {
    expect(shouldAnnounce('127.0.0.1', {})).toBe(false);
    expect(shouldAnnounce('localhost', {})).toBe(false);
    expect(shouldAnnounce('::1', {})).toBe(false);
    expect(shouldAnnounce('0.0.0.0', {})).toBe(true);
    expect(shouldAnnounce('0.0.0.0', { LZS_BONJOUR: '0' })).toBe(false);
  });
  it('names the instance after the computer and targets <name>.local', () => {
    expect(instanceName('Studio-Mac.local')).toBe('LZ Scopes (Studio-Mac)');
    expect(srvHost('Studio-Mac')).toBe('Studio-Mac.local');
    expect(instanceName('x'.repeat(80))).toBe(`LZ Scopes (${'x'.repeat(40)})`);
    expect(srvHost('studio.example.org')).toBe('studio.local');
  });
});

describe('Web Bluetooth shim (CoreBluetooth via bluetooth-le)', () => {
  it('matches the Opple name prefixes of meter.ts', () => {
    expect(matchesFilters('LMaster_12AB', REQUEST_OPTIONS.filters)).toBe(true);
    expect(matchesFilters('SigMesh', REQUEST_OPTIONS.filters)).toBe(true);
    expect(matchesFilters('AirPods', REQUEST_OPTIONS.filters)).toBe(false);
    expect(matchesFilters(undefined, REQUEST_OPTIONS.filters)).toBe(false);
    expect(strongest([{ name: 'a', rssi: -80 }, { name: 'b', rssi: -40 }])?.name).toBe('b');
  });

  it('runs the meter.ts call sequence: scan, connect, NUS service, notify, write', async () => {
    const calls: string[] = [];
    let notify: ((v: DataView) => void) | null = null;
    let onGone: (() => void) | null = null;
    const ble = {
      initialize: async () => { calls.push('init'); },
      requestLEScan: async (_o: unknown, cb: (r: unknown) => void) => {
        calls.push('scan');
        cb({ device: { deviceId: 'far' }, localName: 'LMaster_far', rssi: -90 });
        cb({ device: { deviceId: 'near' }, localName: 'LightMaster', rssi: -45 });
        cb({ device: { deviceId: 'phone' }, localName: 'iPhone', rssi: -30 });
      },
      stopLEScan: async () => { calls.push('stop'); },
      connect: async (id: string, gone: () => void) => { calls.push(`connect ${id}`); onGone = gone; },
      getServices: async () => [{ uuid: NUS_SERVICE.toUpperCase(), characteristics: [
        { uuid: NUS_RX, properties: { write: true, writeWithoutResponse: true, notify: false }, descriptors: [] },
        { uuid: NUS_TX, properties: { write: false, writeWithoutResponse: false, notify: true }, descriptors: [] },
      ] }],
      startNotifications: async (_d: string, _s: string, c: string, cb: (v: DataView) => void) => { calls.push(`notify ${c === NUS_TX}`); notify = cb; },
      write: async (_d: string, _s: string, c: string, v: DataView) => { calls.push(`write ${c === NUS_RX} ${v.byteLength}`); },
      writeWithoutResponse: async () => { calls.push('wwr'); },
      disconnect: async (id: string) => { calls.push(`disconnect ${id}`); },
    };
    const bt = createBluetooth(ble as never, 0);
    const dev = await bt.requestDevice(REQUEST_OPTIONS);
    expect(dev.id).toBe('near');
    expect(dev.name).toBe('LightMaster');
    const server = await dev.gatt.connect();
    expect(dev.gatt.connected).toBe(true);
    const svc = await server.getPrimaryService(NUS_SERVICE);
    const tx = await svc.getCharacteristic(NUS_TX);
    const rx = await svc.getCharacteristic(NUS_RX);
    expect(tx.properties.notify).toBe(true);
    let seen = 0;
    tx.addEventListener('characteristicvaluechanged', (e) => { seen = ((e.target as typeof tx).value as DataView).getUint8(0); });
    await tx.startNotifications();
    notify!(new DataView(new Uint8Array([0x5a]).buffer));
    expect(seen).toBe(0x5a);
    await rx.writeValue(new Uint8Array([1, 2, 3]));
    let gone = false;
    dev.addEventListener('gattserverdisconnected', () => { gone = true; });
    onGone!();
    expect(gone).toBe(true);
    expect(dev.gatt.connected).toBe(false);
    expect(calls).toEqual(['init', 'scan', 'stop', 'connect near', 'notify true', 'write true 3']);
    await expect(svc.getCharacteristic('0000ffff-0000-1000-8000-00805f9b34fb')).rejects.toThrow(/fehlt|missing/);
  });

  it('reports NotFoundError when no meter answers the scan', async () => {
    const ble = { initialize: async () => {}, requestLEScan: async () => {}, stopLEScan: async () => {} };
    await expect(createBluetooth(ble as never, 0).requestDevice(REQUEST_OPTIONS)).rejects.toMatchObject({ name: 'NotFoundError' });
  });
});

describe('stacked layout preset for the iPhone', () => {
  it('l2v puts panel 1 below panel 0', () => {
    const adds: [number, number | undefined, string | undefined][] = [];
    PRESETS.l2v.build((i, r, d) => adds.push([i, r, d]));
    expect(adds).toEqual([[0, undefined, undefined], [1, 0, 'below']]);
  });
});
