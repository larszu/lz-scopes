// Browser side of the colour meter: talks to the bridge (server/meter.mjs), which runs ArgyllCMS
// spotread as a separate process. Without bridge or ArgyllCMS the UI falls back to manual input.

import type { XYZ } from './colorimetry';
import { t } from '../i18n';

export interface MeterInfo { found: boolean; path: string | null; instruments: { port: number; name: string }[]; version?: string | null }
export interface MeterOptions { port?: number; displayType?: string; correction?: { name: string; text: string }; skipCal?: boolean }

export async function meterInfo(httpBase: string): Promise<MeterInfo | null> {
  try {
    const r = await fetch(`${httpBase}/api/meter`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export class Meter {
  private ws: WebSocket | null = null;
  private pending: { ok: (x: XYZ) => void; fail: (e: Error) => void } | null = null;
  ready = false;
  onLog: (text: string) => void = () => {};
  onStatus: (text: string, kind: 'info' | 'ok' | 'error') => void = () => {};

  constructor(private wsBase: string) {}
  get connected() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  open(opts: MeterOptions): Promise<void> {
    this.close();
    return new Promise((ok, fail) => {
      const ws = new WebSocket(`${this.wsBase}/meter`);
      this.ws = ws;
      ws.onopen = () => { ws.send(JSON.stringify({ cmd: 'open', ...opts })); ok(); };
      ws.onerror = () => fail(new Error(t('calib.meter.noBridgeReach')));
      ws.onclose = () => { this.ready = false; this.reject(new Error(t('calib.meter.closed'))); };
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data));
        if (m.type === 'log') this.onLog(m.text);
        else if (m.type === 'status') this.onStatus(m.message, 'info');
        else if (m.type === 'ready') { this.ready = true; this.onStatus(t('calib.meter.ready'), 'ok'); }
        else if (m.type === 'reading') { const p = this.pending; this.pending = null; p?.ok(m.xyz); }
        else if (m.type === 'error') { this.onStatus(m.message, 'error'); this.reject(new Error(m.message)); }
        else if (m.type === 'closed') { this.ready = false; this.onStatus(t('calib.meter.endedCode', { code: m.code ?? '?' }), 'info'); this.reject(new Error(t('calib.meter.ended'))); }
      };
    });
  }

  private reject(e: Error) { const p = this.pending; this.pending = null; p?.fail(e); }

  /** One reading (absolute XYZ in cd/m²). */
  read(signal?: AbortSignal): Promise<XYZ> {
    if (!this.connected) return Promise.reject(new Error(t('calib.meter.notConnected')));
    this.reject(new Error(t('calib.meter.superseded')));
    return new Promise((ok, fail) => {
      this.pending = { ok, fail };
      signal?.addEventListener('abort', () => this.reject(new DOMException('aborted', 'AbortError') as unknown as Error), { once: true });
      this.ws!.send(JSON.stringify({ cmd: 'read' }));
    });
  }
  key(k: string) { this.ws?.send(JSON.stringify({ cmd: 'key', key: k })); }
  close() {
    if (this.ws) { try { this.ws.send(JSON.stringify({ cmd: 'close' })); } catch { /* closed */ } this.ws.close(); }
    this.ws = null; this.ready = false;
  }
}
