// Touch Shading as an NMOS IS-12 controller (#222, lz-camera-bridge #287).
//
// Same surface as CameraBridgeLink (bridge.ts), so the shading bar, the closed loop and colour
// matching work unchanged: they keep speaking the bridge bus (0..255, centre 128) and this link
// translates to the IS-12 camera classes and back:
//   LzCameraPaint  [1,2,0,1]  percent −100..+100   ↔ bus 128 ± 127
//   LzCameraExposure [1,2,0,2] iris percent 0..100 ↔ bus 0..255; gain/shutter/ND/detail raw
//   LzTally        [1,2,0,5]
// Found through the IS-04 Node API (the URL is the node's, e.g. http://bridge:8640): the device's
// `urn:x-nmos:control:ncp` control is opened, camera blocks are the blocks holding a paint object.
// Any device that offers these classes works – not only lz-camera-bridge.

import type { Paint, PaintField } from './model';
import { T } from './text';
import type { CameraData } from './guide';
import type { BridgeCamera, CameraPaintState } from './bridge';

export const IS12_MODE = 'is12';

const CLASS = { paint: '1.2.0.1', exposure: '1.2.0.2', tally: '1.2.0.5', block: '1.1' } as const;

/** paint property index (3pN) → field */
const PAINT_INDEX: Record<number, PaintField> = {
  1: 'blackR', 2: 'blackG', 3: 'blackB', 4: 'masterBlack', 5: 'masterGamma', 6: 'whiteR', 7: 'whiteG', 8: 'whiteB', 9: 'saturation',
};
const PAINT_PROP = Object.fromEntries(Object.entries(PAINT_INDEX).map(([i, f]) => [f, Number(i)])) as Record<PaintField, number>;
/** exposure property index → CameraData field (bus scale) */
const EXPOSURE_INDEX: Record<number, 'iris' | 'masterGain' | 'shutterSpeed' | 'ndFilter'> = { 1: 'iris', 2: 'masterGain', 3: 'shutterSpeed', 4: 'ndFilter' };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const busToBipolar = (bus: number) => Math.round(clamp(((bus - 128) / 127) * 100, -100, 100) * 10) / 10;
export const bipolarToBus = (pct: number) => clamp(Math.round(128 + (pct * 127) / 100), 0, 255);
export const busToPercent = (bus: number) => Math.round(clamp(bus / 2.55, 0, 100) * 10) / 10;
export const percentToBus = (pct: number) => clamp(Math.round(pct * 2.55), 0, 255);

/** One IS-12 Set: object kind, property index (level 3), value in the device's unit. */
export interface Is12Set { kind: 'paint' | 'exposure'; index: number; value: number }

/** Bridge bus command → IS-12 Sets; null for a command this link does not carry. */
export function is12Sets(cmd: string, params: Record<string, number>): Is12Set[] | null {
  const v = params.value;
  switch (cmd) {
    case 'setMasterBlack': return [{ kind: 'paint', index: 4, value: busToBipolar(v) }];
    case 'setMasterGamma': return [{ kind: 'paint', index: 5, value: busToBipolar(v) }];
    case 'setSaturation': return [{ kind: 'paint', index: 9, value: busToBipolar(v) }];
    case 'setBlackBalance':
    case 'setWhiteBalance': {
      const base = cmd === 'setBlackBalance' ? 1 : 6;
      return (['r', 'g', 'b'] as const).flatMap((k, i) => (typeof params[k] === 'number' ? [{ kind: 'paint' as const, index: base + i, value: busToBipolar(params[k]) }] : []));
    }
    case 'setIris': return [{ kind: 'exposure', index: 1, value: busToPercent(v) }];
    case 'setMasterGain': return [{ kind: 'exposure', index: 2, value: v }];
    case 'setShutterSpeed': return [{ kind: 'exposure', index: 3, value: v }];
    case 'setNdFilter': return [{ kind: 'exposure', index: 4, value: v }];
    default: return null;
  }
}

interface Member { role: string; oid: number; classId: number[]; userLabel: string | null; owner: number }
interface Cam { n: number; block: number; paint?: number; exposure?: number; tally?: number; program?: boolean; preview?: boolean }

type Socket = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  onopen: ((e: unknown) => void) | null; onclose: ((e: unknown) => void) | null;
  onerror: ((e: unknown) => void) | null; onmessage: ((e: { data: unknown }) => void) | null;
};

export interface Is12Deps {
  fetch: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  socket: (url: string) => Socket;
}

const defaultDeps = (): Is12Deps => ({
  fetch: (u) => fetch(u),
  socket: (u) => new WebSocket(u) as unknown as Socket,
});

export class Is12Link {
  cameras: BridgeCamera[] = [];
  configs = new Map<number, Record<string, unknown>>();
  cameraErrors = new Map<number, string>();
  states = new Map<number, CameraPaintState>();
  data = new Map<number, CameraData>();
  status: 'off' | 'connecting' | 'open' | 'closed' = 'off';
  lastError = '';
  /** IS-12 endpoint found through IS-04 (shown in the camera dialog) */
  endpoint = '';
  private listeners = new Set<() => void>();
  private ws: Socket | null = null;
  private wanted = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private delay = 2000;
  private handle = 0;
  private pending = new Map<number, (r: { status: number; value?: unknown; errorMessage?: string }) => void>();
  private cams: Cam[] = [];
  private byOid = new Map<number, { cam: Cam; kind: 'paint' | 'exposure' | 'tally' }>();

  constructor(private url: () => string, private changed: () => void, private deps: Is12Deps = defaultDeps()) {}

  private onChange() { this.changed(); for (const f of this.listeners) f(); }
  subscribe(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f); }; }

  /** Bridge setup commands do not exist over IS-12. */
  request(_msg: Record<string, unknown>): boolean { return false; }

  async connect() {
    this.wanted = true;
    if (this.ws) return;
    this.status = 'connecting';
    this.onChange();
    try {
      const node = this.url().replace(/\/+$/, '');
      const r = await this.deps.fetch(`${node}/x-nmos/node/v1.3/devices`);
      if (!r.ok) throw new Error(T.unreachable);
      const devices = (await r.json()) as { controls?: { type: string; href: string }[] }[];
      const href = devices.flatMap((d) => d.controls ?? []).find((c) => c.type.startsWith('urn:x-nmos:control:ncp'))?.href;
      if (!href) throw new Error('no IS-12 control on this node');
      this.endpoint = href;
      this.open(href);
    } catch (e) {
      this.lastError = (e as Error).message;
      this.status = 'closed';
      this.onChange();
      this.later();
    }
  }

  private open(href: string) {
    const ws = this.deps.socket(href);
    this.ws = ws;
    ws.onopen = () => { this.delay = 2000; this.status = 'open'; this.lastError = ''; void this.discover(); };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null; this.status = 'closed';
      for (const p of this.pending.values()) p({ status: 503, errorMessage: 'closed' });
      this.pending.clear();
      this.onChange(); this.later();
    };
    ws.onerror = () => { this.lastError = T.unreachable; };
    ws.onmessage = (e) => { try { this.receive(JSON.parse(String(e.data))); } catch { /* not JSON */ } };
  }

  disconnect() {
    this.wanted = false;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.ws?.close();
    this.ws = null;
    this.status = 'off';
  }

  private later() {
    if (!this.wanted || this.retry) return;
    this.retry = setTimeout(() => { this.retry = null; if (this.wanted) void this.connect(); }, this.delay);
    this.delay = Math.min(30000, this.delay * 2);
  }

  private call(oid: number, level: number, index: number, args: Record<string, unknown>): Promise<{ status: number; value?: unknown; errorMessage?: string }> {
    if (this.ws?.readyState !== 1) return Promise.resolve({ status: 503, errorMessage: T.notConnected });
    this.handle = (this.handle % 65535) + 1;
    const handle = this.handle;
    this.ws.send(JSON.stringify({ messageType: 0, commands: [{ handle, oid, methodId: { level, index }, arguments: args }] }));
    return new Promise((r) => this.pending.set(handle, r));
  }

  /** IS-12 message from the device (public for tests). */
  receive(m: Record<string, any>) {
    if (m.messageType === 1) {
      for (const r of m.responses ?? []) { this.pending.get(r.handle)?.(r.result); this.pending.delete(r.handle); }
    } else if (m.messageType === 2) {
      for (const n of m.notifications ?? []) this.applyProperty(n.oid, n.eventData?.propertyId, n.eventData?.value, 'confirmed');
      this.onChange();
    } else if (m.messageType === 5) {
      this.lastError = String(m.errorMessage ?? T.error);
      this.onChange();
    }
  }

  /** Walk the model: blocks that hold a paint object are cameras. */
  private async discover() {
    const r = await this.call(1, 2, 1, { recurse: true });
    if (r.status !== 200 || !Array.isArray(r.value)) { this.lastError = r.errorMessage ?? T.error; this.onChange(); return; }
    const members = r.value as Member[];
    const key = (c: number[]) => c.join('.');
    const blocks = new Map<number, Member>(members.filter((m) => key(m.classId) === CLASS.block).map((m) => [m.oid, m]));
    const cams = new Map<number, Cam>();
    let next = 1;
    for (const m of members) {
      const kind = key(m.classId) === CLASS.paint ? 'paint' : key(m.classId) === CLASS.exposure ? 'exposure' : key(m.classId) === CLASS.tally ? 'tally' : null;
      if (!kind || !blocks.has(m.owner)) continue;
      let cam = cams.get(m.owner);
      if (!cam) {
        const role = blocks.get(m.owner)!.role;
        const n = Number(role.match(/^cam(\d+)$/)?.[1] ?? 0) || 1000 + next++;
        cam = { n, block: m.owner };
        cams.set(m.owner, cam);
      }
      cam[kind] = m.oid;
    }
    this.cams = [...cams.values()].filter((c) => c.paint).sort((a, b) => a.n - b.n);
    this.byOid.clear();
    for (const c of this.cams) for (const k of ['paint', 'exposure', 'tally'] as const) if (c[k]) this.byOid.set(c[k]!, { cam: c, kind: k });
    this.cameras = this.cams.map((c) => {
      const b = blocks.get(c.block)!;
      return { cameraNumber: c.n, label: b.userLabel ?? b.role, mode: IS12_MODE, connected: true };
    });
    this.configs = new Map(this.cams.map((c) => [c.n, { connectionMode: IS12_MODE, label: blocks.get(c.block)!.userLabel ?? blocks.get(c.block)!.role }]));
    // current values, then subscriptions
    const reads: Promise<void>[] = [];
    for (const c of this.cams) {
      for (const i of Object.keys(PAINT_INDEX)) reads.push(this.read(c.paint!, Number(i)));
      if (c.exposure) for (const i of Object.keys(EXPOSURE_INDEX)) reads.push(this.read(c.exposure, Number(i)));
      if (c.tally) { reads.push(this.read(c.tally, 1)); reads.push(this.read(c.tally, 2)); }
    }
    await Promise.all(reads);
    this.ws?.send(JSON.stringify({ messageType: 3, subscriptions: [...this.byOid.keys()] }));
    this.onChange();
  }

  private async read(oid: number, index: number) {
    const r = await this.call(oid, 1, 1, { id: { level: 3, index } });
    if (r.status === 200) this.applyProperty(oid, { level: 3, index }, r.value, 'confirmed');
  }

  private applyProperty(oid: number, id: { level: number; index: number } | undefined, value: unknown, origin: string) {
    const hit = this.byOid.get(oid);
    if (!hit || !id || id.level !== 3) return;
    const n = hit.cam.n;
    if (hit.kind === 'paint') {
      const f = PAINT_INDEX[id.index];
      if (!f || typeof value !== 'number') return;
      const prev = this.states.get(n) ?? { paint: {}, origins: {} };
      const paint: Paint = { ...prev.paint, [f]: bipolarToBus(value) };
      this.states.set(n, { paint, origins: { ...prev.origins, [f]: origin } });
    } else if (hit.kind === 'exposure') {
      const f = EXPOSURE_INDEX[id.index];
      if (!f || typeof value !== 'number') return;
      this.data.set(n, { ...this.data.get(n), [f]: f === 'iris' ? percentToBus(value) : value });
    } else if (hit.kind === 'tally' && typeof value === 'boolean') {
      if (id.index === 1) hit.cam.program = value;
      if (id.index === 2) hit.cam.preview = value;
      this.data.set(n, { ...this.data.get(n), tally: hit.cam.program ? 'program' : hit.cam.preview ? 'preview' : 'off' });
    }
  }

  /** A bridge bus command, sent as IS-12 Sets. false: not connected or not carried by IS-12. */
  send(cameraNumber: number, cmd: string, params: Record<string, number>): boolean {
    const cam = this.cams.find((c) => c.n === cameraNumber);
    const sets = is12Sets(cmd, params);
    if (!cam || !sets || this.ws?.readyState !== 1) return false;
    for (const s of sets) {
      const oid = s.kind === 'paint' ? cam.paint : cam.exposure;
      if (!oid) return false;
      void this.call(oid, 1, 2, { id: { level: 3, index: s.index }, value: s.value }).then((r) => {
        if (r.status >= 300) { this.lastError = r.errorMessage ?? T.error; this.cameraErrors.set(cameraNumber, this.lastError); this.onChange(); }
      });
      if (s.kind === 'paint') {
        const f = PAINT_INDEX[s.index];
        const prev = this.states.get(cameraNumber) ?? { paint: {}, origins: {} };
        this.states.set(cameraNumber, { paint: { ...prev.paint, [f]: bipolarToBus(s.value) }, origins: { ...prev.origins, [f]: 'commanded' } });
      }
    }
    return true;
  }
}

export { PAINT_PROP };
