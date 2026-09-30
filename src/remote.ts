// Main window side of the control API: connects to the bridge (/control?role=app),
// executes forwarded commands and reports its state whenever it changes.

import { validateCommand, type Command } from '../server/control.mjs';

export type Executor = (c: Command) => unknown | Promise<unknown>;

export function connectRemote(bridgeUrl: () => string, execute: Executor, state: () => unknown) {
  let ws: WebSocket | null = null, retry = 1000, last = '';
  const open = () => {
    try { ws = new WebSocket(`${bridgeUrl()}/control?role=app`); } catch { return later(); }
    ws.onopen = () => { retry = 1000; last = ''; publish(); };
    ws.onclose = () => { ws = null; later(); };
    ws.onerror = () => { /* onclose follows */ };
    ws.onmessage = async (e) => {
      let m: { type?: string; id?: string; command?: unknown };
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type !== 'command') return;
      const dbgT = performance.now(); // DEBUG
      const v = validateCommand(m.command);
      let reply: { ok: boolean; error?: string; result?: unknown };
      if (!v.ok) reply = { ok: false, error: v.error };
      else {
        try { reply = { ok: true, result: await execute(v.command) }; } catch (err) { reply = { ok: false, error: (err as Error).message }; }
      }
      if (v.ok) console.warn(`DEBUG cmd ${JSON.stringify(v.command)} ${Math.round(performance.now() - dbgT)} ms`);
      publish(); // state first: the bridge answers the HTTP request with the new state
      ws?.send(JSON.stringify({ type: 'result', id: m.id, ...reply }));
    };
  };
  const later = () => { setTimeout(open, retry); retry = Math.min(15000, retry * 2); };
  const publish = () => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    const s = JSON.stringify(state());
    if (s === last) return;
    last = s;
    ws.send(`{"type":"state","state":${s}}`);
  };
  open();
  setInterval(publish, 250);
  return { publish };
}
