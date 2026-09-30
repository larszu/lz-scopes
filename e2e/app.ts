// Shared helpers for the E2E tests: start the desktop app with its own profile and port,
// drive it over the control API (docs/control-api.md), read panel pixels.

import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** Same constants as src/renderer.ts (WAVE_MIN/WAVE_MAX) and src/graticule.ts (plotRect of waveforms). */
export const WAVE_MIN = -0.07, WAVE_MAX = 1.1;

export function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once('error', fail);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => ok(port)); });
  });
}

export interface App {
  app: ElectronApplication; page: Page; port: number; base: string;
  control: (cmd: Record<string, unknown>) => Promise<{ ok: boolean; error?: string; result?: unknown; state?: AppState }>;
  state: () => Promise<AppState>;
  profile: string;
  /** quit the app; the profile (localStorage) is deleted unless keepProfile */
  close: (keepProfile?: boolean) => Promise<void>;
}
export interface AppState {
  sources: { index: number; id: string; name: string; kind: string; status: string }[];
  panels: { panel: number; scope: string; source: string }[];
  outputs: { name: string; view: string; stream: string }[];
  layoutName: string; preset: string; layouts: string[];
  clip: number | null; yMin: number | null; yMax: number | null;
}

/** Launch the desktop app from this checkout (dist must be built: npm run test:e2e does that). */
/** `profile` and `port` to restart with the same localStorage (it belongs to the origin, port included). */
export async function launchApp(opts: { profile?: string; port?: number } = {}): Promise<App> {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('dist fehlt – npm run test:e2e baut es');
  const port = opts.port ?? await freePort();
  const profile = opts.profile ?? mkdtempSync(join(tmpdir(), 'lzs-e2e-'));
  const app = await electron.launch({
    // Linux CI (xvfb, no GPU): no SUID sandbox helper, WebGL through SwiftShader
    args: [ROOT, ...(process.platform === 'linux' ? ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : [])],
    cwd: ROOT,
    env: { ...process.env, LZS_PORT: String(port), LZS_USER_DATA: profile, ELECTRON_ENABLE_LOGGING: '0' },
    timeout: 120_000,
  });
  const page = await app.firstWindow({ timeout: 120_000 });
  // app errors in the test log (otherwise a hanging main window leaves no trace in CI)
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[app ${m.type()}]`, m.text().slice(0, 500)); });
  const base = `http://127.0.0.1:${port}`;
  const post = async (cmd: Record<string, unknown>) => {
    const r = await fetch(`${base}/api/control`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
    return { status: r.status, body: await r.json() };
  };
  // The bridge gives the window 4 s per command. In CI (software WebGL) the window can be
  // busy longer, above all while it boots: retry timeouts (504) instead of failing.
  const control = async (cmd: Record<string, unknown>) => {
    for (let i = 0; ; i++) {
      const r = await post(cmd);
      if (r.status !== 504 || i >= 5) return r.body;
    }
  };
  // the main window connects to /control?role=app once it has booted, then answers commands
  await until(async () => (await (await fetch(`${base}/api/control`)).json()).connected === true, 60_000, 'Hauptfenster verbindet sich nicht mit der Bridge');
  await until(async () => (await post({ cmd: 'state' })).body.ok === true, 90_000, 'Hauptfenster beantwortet keine Steuerbefehle');
  const state = async () => {
    const r = await control({ cmd: 'state' });
    if (!r.ok) throw new Error(r.error);
    return r.result as AppState;
  };
  return {
    app, page, port, base, control, state, profile,
    close: async (keepProfile = false) => { await app.close().catch(() => {}); if (!keepProfile) rmSync(profile, { recursive: true, force: true }); },
  };
}

export async function until<T>(fn: () => Promise<T | false | null | undefined> | T | false | null | undefined, timeoutMs = 60_000, what = 'Bedingung'): Promise<T> {
  const t0 = Date.now();
  let last: unknown;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    if (Date.now() - t0 > timeoutMs) throw new Error(`${what} nach ${timeoutMs} ms nicht erfüllt${last ? `: ${(last as Error).message}` : ''}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Trace intensity (0 … 1 of the column maximum) by signal level, for column positions
 * `fractions` (0 … 1 of the picture width) in the visible panel showing `scope`. Reads the
 * blit canvas: trace only, the graticule is on a separate overlay canvas.
 */
export async function waveProfile(page: Page, scope: string, fractions: number[]): Promise<{ level: number; v: number }[][]> {
  return page.evaluate(({ scope, fr, wmin, wmax }) => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === scope);
    if (!el) throw new Error(`kein sichtbares Panel ${scope}`);
    const c = el.querySelector<HTMLCanvasElement>('canvas.blit')!;
    const dpr = c.width / c.getBoundingClientRect().width;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const cssW = c.width / dpr, cssH = c.height / dpr;
    const r = { x: 44, y: 8, w: Math.max(10, cssW - 52), h: Math.max(10, cssH - 16) };
    return fr.map((f) => {
      const x = Math.round((r.x + f * r.w) * dpr);
      const y0 = Math.round(r.y * dpr), y1 = Math.round((r.y + r.h) * dpr);
      const col = ctx.getImageData(x - 2, y0, 5, y1 - y0).data;
      const rows: { level: number; v: number }[] = [];
      let max = 0;
      for (let y = 0; y < y1 - y0; y++) {
        let s = 0;
        for (let k = 0; k < 5; k++) { const i = (y * 5 + k) * 4; s += col[i] + col[i + 1] + col[i + 2]; }
        rows.push({ level: wmax - ((y + 0.5) / (y1 - y0)) * (wmax - wmin), v: s });
        max = Math.max(max, s);
      }
      return rows.map((q) => ({ level: q.level, v: max ? q.v / max : 0 }));
    });
  }, { scope, fr: fractions, wmin: WAVE_MIN, wmax: WAVE_MAX });
}

/** Level of the brightest trace row per column (NaN = empty column). */
export async function waveLevels(page: Page, scope: string, fractions: number[]): Promise<number[]> {
  return (await waveProfile(page, scope, fractions)).map((col) => {
    let best = col[0];
    for (const q of col) if (q.v > best.v) best = q;
    return best && best.v > 0 ? best.level : NaN;
  });
}

/** Strongest trace within ±tol around `level` (0 … 1 of the column maximum). */
export const traceNear = (profile: { level: number; v: number }[], level: number, tol = 0.012) =>
  Math.max(0, ...profile.filter((q) => Math.abs(q.level - level) <= tol).map((q) => q.v));


/** Set up: one large panel with the given scope, showing source 1. */
export async function singlePanel(a: App, scope: string) {
  expectOk(await a.control({ cmd: 'layout.preset', preset: 1 }));
  expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope }));
}

export function expectOk(r: { ok: boolean; error?: string }) {
  if (!r.ok) throw new Error(`Steuerbefehl fehlgeschlagen: ${r.error}`);
  return r;
}

export function which(bin: string): string | null {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split('\n')[0];
  for (const d of ['/opt/homebrew/bin', '/usr/local/bin']) if (existsSync(join(d, bin))) return join(d, bin);
  return null;
}

/** mediamtx on free ports with RTSP only (no RTMP/HLS/WebRTC/SRT listeners). */
export async function startMediamtx(bin: string): Promise<{ rtsp: number; stop: () => void; proc: ChildProcess }> {
  const rtsp = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'lzs-mtx-'));
  const cfg = join(dir, 'mediamtx.yml');
  writeFileSync(cfg, [
    'logLevel: warn',
    `rtspAddress: 127.0.0.1:${rtsp}`,
    'rtspTransports: [tcp]',
    'rtmp: no', 'hls: no', 'webrtc: no', 'srt: no', 'api: no', 'metrics: no', 'pprof: no', 'playback: no',
    'paths:', '  all_others:',
  ].join('\n'));
  // cwd = temp dir: mediamtx writes auto.crt/auto.key into its working directory
  const proc = spawn(bin, [cfg], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  proc.stderr?.on('data', (d) => { err += d; });
  await until(() => new Promise<boolean>((ok) => {
    const s = createServer();
    s.once('error', () => ok(true)); // port taken = mediamtx listens
    s.listen(rtsp, '127.0.0.1', () => s.close(() => ok(false)));
  }), 15_000, `mediamtx startet nicht ${err}`);
  return { rtsp, proc, stop: () => { proc.kill('SIGKILL'); rmSync(dir, { recursive: true, force: true }); } };
}
