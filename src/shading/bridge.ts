// Connection to lz-camera-bridge (larszu/lz-camera-bridge, packages/bridge/src/BridgeServer.ts):
// the WebSocket the web RCP and Companion use. LZ Scopes sends the bridge's own commands and
// reads its camera list and state – it does not talk to any camera itself.

import { capsKey, type Paint, type PaintField } from './model';
import { T } from './text';

export interface BridgeCamera {
  cameraNumber: number;
  label: string;
  /** bridge mode, with the firmware family where the capabilities depend on it (model.ts capsKey) */
  mode: string;
  connected: boolean;
}

export interface CameraPaintState {
  paint: Paint;
  /** per field: 'confirmed' (read from the camera) or 'commanded' (echo of a command) */
  origins: Partial<Record<PaintField, string>>;
}

const FIELDS_OF_STATE: PaintField[] = ['blackR', 'blackG', 'blackB', 'masterBlack', 'masterGamma', 'whiteR', 'whiteG', 'whiteB', 'saturation'];

export class CameraBridgeLink {
  cameras: BridgeCamera[] = [];
  states = new Map<number, CameraPaintState>();
  status: 'off' | 'connecting' | 'open' | 'closed' = 'off';
  lastError = '';
  private ws: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private wanted = false;
  private delay = 2000;

  constructor(private url: () => string, private onChange: () => void) {}

  connect() {
    this.wanted = true;
    if (this.ws) return;
    this.status = 'connecting';
    let ws: WebSocket;
    try { ws = new WebSocket(this.url()); } catch (e) { this.lastError = (e as Error).message; this.status = 'closed'; this.later(); return; }
    this.ws = ws;
    ws.onopen = () => { this.delay = 2000; this.status = 'open'; this.lastError = ''; ws.send(JSON.stringify({ type: 'listCameras' })); this.onChange(); };
    ws.onclose = () => { if (this.ws !== ws) return; this.ws = null; this.status = 'closed'; this.onChange(); this.later(); };
    ws.onerror = () => { this.lastError = T.unreachable; };
    ws.onmessage = (e) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(e.data)); } catch { return; }
      this.receive(m);
    };
    this.onChange();
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
    this.retry = setTimeout(() => { this.retry = null; if (this.wanted) this.connect(); }, this.delay);
    this.delay = Math.min(30000, this.delay * 2);
  }

  /** Message from the bridge (exported for tests through `receive`). */
  receive(m: Record<string, unknown>) {
    if (m.type === 'cameras' && Array.isArray(m.cameras)) {
      this.cameras = (m.cameras as Record<string, unknown>[]).map((c) => {
        const cfg = (c.config ?? {}) as Record<string, unknown>;
        const n = Number(c.cameraNumber);
        // the label only, never host or credentials
        return { cameraNumber: n, label: String(cfg.label ?? cfg.name ?? T.camN(n)), mode: capsKey(String(cfg.connectionMode ?? ''), cfg.cgiFamily ? String(cfg.cgiFamily) : undefined), connected: !!c.connected };
      });
    } else if (m.type === 'state') {
      const n = Number(m.cameraNumber), st = (m.state ?? {}) as Record<string, unknown>;
      const prev = this.states.get(n) ?? { paint: {}, origins: {} };
      const paint: Paint = { ...prev.paint };
      for (const f of FIELDS_OF_STATE) if (typeof st[f] === 'number') paint[f] = st[f] as number;
      this.states.set(n, { paint, origins: { ...prev.origins, ...((m.origins ?? {}) as CameraPaintState['origins']) } });
    } else if (m.type === 'error') {
      this.lastError = String(m.message ?? T.error);
    } else return;
    this.onChange();
  }

  send(cameraNumber: number, cmd: string, params: Record<string, number>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ type: 'command', cameraNumber, cmd, params }));
    return true;
  }
}
