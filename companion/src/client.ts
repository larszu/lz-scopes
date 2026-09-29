// WebSocket client for the LZ Scopes control API (ws://host:port/control).
// Commands and state go over the same socket; it reconnects on its own.

import WebSocket from 'ws'
import type { ModuleConfig } from './config.js'
import type { Command } from './commands.js'

export interface CommandReply { ok: boolean; error?: string; result?: unknown }

export function controlUrl(c: ModuleConfig): string {
  const host = (c.host || '127.0.0.1').trim()
  const q = c.token ? `?token=${encodeURIComponent(c.token)}` : ''
  return `ws://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${c.port || 4192}/control${q}`
}

export class ScopesClient {
  private ws: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  private seq = 0
  private pending = new Map<string, (r: CommandReply) => void>()

  /** bridge reachable (socket open) */
  onBridge?: (up: boolean) => void
  /** LZ Scopes main window connected to the bridge */
  onApp?: (connected: boolean) => void
  onState?: (state: unknown) => void
  onError?: (message: string) => void

  constructor(private config: ModuleConfig) {}

  connect(): void {
    this.destroyed = false
    this.open()
  }

  destroy(): void {
    this.destroyed = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const done of this.pending.values()) done({ ok: false, error: 'Verbindung beendet' })
    this.pending.clear()
    if (this.ws) { this.ws.removeAllListeners(); this.ws.on('error', () => {}); this.ws.close(); this.ws = null }
  }

  send(command: Command, timeoutMs = 5000): Promise<CommandReply> {
    const ws = this.ws
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.resolve({ ok: false, error: 'Bridge nicht verbunden' })
    const id = `m${++this.seq}`
    return new Promise((resolve) => {
      const t = setTimeout(() => { this.pending.delete(id); resolve({ ok: false, error: 'Keine Antwort' }) }, timeoutMs)
      this.pending.set(id, (r) => { clearTimeout(t); resolve(r) })
      ws.send(JSON.stringify({ ...command, id }))
    })
  }

  private open(): void {
    if (this.destroyed) return
    const ws = new WebSocket(controlUrl(this.config))
    this.ws = ws
    ws.on('open', () => this.onBridge?.(true))
    ws.on('message', (data) => this.handle(String(data)))
    ws.on('unexpected-response', (_req, res) => {
      this.onError?.(res.statusCode === 401 ? 'Token fehlt oder falsch' : res.statusCode === 403 ? 'Zugriff verweigert (nur 127.0.0.1 ohne Token)' : `HTTP ${res.statusCode}`)
    })
    ws.on('error', (e) => this.onError?.(e.message))
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null
      this.onBridge?.(false)
      if (!this.destroyed) this.timer = setTimeout(() => this.open(), 2000)
    })
  }

  private handle(text: string): void {
    let m: { type?: string; id?: string; connected?: boolean; state?: unknown } & CommandReply
    try { m = JSON.parse(text) } catch { return }
    if (m.type === 'hello') { this.onApp?.(!!m.connected); this.onState?.(m.state) }
    else if (m.type === 'connected') this.onApp?.(!!m.connected)
    else if (m.type === 'state') { this.onApp?.(true); this.onState?.(m.state) }
    else if (m.type === 'result' && m.id && this.pending.has(m.id)) {
      const done = this.pending.get(m.id)!
      this.pending.delete(m.id)
      done({ ok: m.ok, error: m.error, result: m.result })
    }
  }
}
