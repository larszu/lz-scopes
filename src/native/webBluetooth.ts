// navigator.bluetooth for the iOS/iPadOS app (docs/ios.md). WebKit has no Web Bluetooth (WebKit
// standards position "oppose", docs/research/ios-app.md), so the app maps the small part that
// src/opple/meter.ts uses onto CoreBluetooth through @capacitor-community/bluetooth-le (MIT):
// requestDevice → LE scan filtered by name prefix, gatt.connect, getPrimaryService,
// getCharacteristic, startNotifications ('characteristicvaluechanged'), writeValue*,
// 'gattserverdisconnected'. meter.ts stays unchanged.
//
// Device choice: CoreBluetooth gives no system chooser, so requestDevice scans `scanMs` and takes
// the meter with the strongest signal (the one lying next to the iPad). Ungeprüft mit echtem
// Light Master am iPhone/iPad: the Simulator has no Bluetooth.

import type { BleClientInterface, BleService } from '@capacitor-community/bluetooth-le';
import { t } from '../i18n';

interface Filter { namePrefix?: string; name?: string }
interface RequestOptions { filters?: Filter[]; optionalServices?: string[]; acceptAllDevices?: boolean }

/** Does an advertised name match one of the Web Bluetooth filters? */
export function matchesFilters(name: string | undefined, filters: Filter[] | undefined): boolean {
  if (!filters?.length) return true;
  if (!name) return false;
  return filters.some((f) => (f.name !== undefined ? name === f.name : true) && (f.namePrefix !== undefined ? name.startsWith(f.namePrefix) : true));
}

/** Pick the best scan hit: strongest RSSI, ties by name. */
export function strongest<T extends { rssi?: number; name?: string }>(hits: T[]): T | null {
  return [...hits].sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999) || (a.name ?? '').localeCompare(b.name ?? ''))[0] ?? null;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const view = (v: BufferSource): DataView =>
  v instanceof DataView ? v : ArrayBuffer.isView(v) ? new DataView(v.buffer, v.byteOffset, v.byteLength) : new DataView(v as ArrayBuffer);

class ShimCharacteristic extends EventTarget {
  value: DataView | null = null;
  constructor(private ble: BleClientInterface, private deviceId: string, private service: string, readonly uuid: string,
    readonly properties: { write: boolean; writeWithoutResponse: boolean; notify: boolean }) { super(); }
  async startNotifications() {
    await this.ble.startNotifications(this.deviceId, this.service, this.uuid, (v) => {
      this.value = v;
      this.dispatchEvent(new Event('characteristicvaluechanged'));
    });
    return this;
  }
  writeValueWithoutResponse(v: BufferSource) { return this.ble.writeWithoutResponse(this.deviceId, this.service, this.uuid, view(v)); }
  writeValueWithResponse(v: BufferSource) { return this.ble.write(this.deviceId, this.service, this.uuid, view(v)); }
  writeValue(v: BufferSource) { return this.properties.write ? this.writeValueWithResponse(v) : this.writeValueWithoutResponse(v); }
}

class ShimService {
  constructor(private ble: BleClientInterface, private deviceId: string, private svc: BleService) {}
  async getCharacteristic(uuid: string) {
    const c = this.svc.characteristics.find((x) => same(x.uuid, uuid));
    if (!c) throw Object.assign(new Error(t('native.ble.noChar', { uuid })), { name: 'NotFoundError' });
    return new ShimCharacteristic(this.ble, this.deviceId, this.svc.uuid, c.uuid,
      { write: c.properties.write, writeWithoutResponse: c.properties.writeWithoutResponse, notify: c.properties.notify });
  }
}

class ShimDevice extends EventTarget {
  private server: { connected: boolean; getPrimaryService(uuid: string): Promise<ShimService>; disconnect(): void } | null = null;
  readonly gatt: { connected: boolean; connect(): Promise<NonNullable<ShimDevice['server']>>; disconnect(): void };
  constructor(private ble: BleClientInterface, readonly id: string, readonly name?: string) {
    super();
    const dev = this;
    this.gatt = {
      get connected() { return !!dev.server?.connected; },
      connect: () => this.connect(),
      disconnect: () => this.server?.disconnect(),
    };
  }
  private async connect() {
    await this.ble.connect(this.id, () => {
      if (this.server) this.server.connected = false;
      this.dispatchEvent(new Event('gattserverdisconnected'));
    });
    const services = await this.ble.getServices(this.id);
    const ble = this.ble, id = this.id;
    const server = {
      connected: true,
      async getPrimaryService(uuid: string) {
        const s = services.find((x) => same(x.uuid, uuid));
        if (!s) throw Object.assign(new Error(t('native.ble.noService', { uuid })), { name: 'NotFoundError' });
        return new ShimService(ble, id, s);
      },
      disconnect() { server.connected = false; ble.disconnect(id).catch(() => {}); },
    };
    this.server = server;
    return server;
  }
}

/** navigator.bluetooth subset on top of BleClient. */
export function createBluetooth(ble: BleClientInterface, scanMs = 5000) {
  let ready: Promise<void> | null = null;
  const init = () => (ready ??= ble.initialize({ androidNeverForLocation: true }).catch((e) => { ready = null; throw e; }));
  return {
    async requestDevice(o: RequestOptions) {
      await init();
      const hits = new Map<string, { id: string; name?: string; rssi?: number }>();
      await ble.requestLEScan({ allowDuplicates: false }, (r) => {
        const name = r.localName ?? r.device.name;
        if (!o.acceptAllDevices && !matchesFilters(name, o.filters)) return;
        const prev = hits.get(r.device.deviceId);
        hits.set(r.device.deviceId, { id: r.device.deviceId, name, rssi: Math.max(r.rssi ?? -999, prev?.rssi ?? -999) });
      });
      await new Promise((ok) => setTimeout(ok, scanMs));
      await ble.stopLEScan().catch(() => {});
      const best = strongest([...hits.values()]);
      if (!best) throw Object.assign(new Error(t('native.ble.noDevice')), { name: 'NotFoundError' });
      return new ShimDevice(ble, best.id, best.name);
    },
    async getDevices() { return []; },
  };
}
