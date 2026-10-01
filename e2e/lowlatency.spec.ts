import { expect, test } from '@playwright/test';
import { startLatencySource } from '../scripts/latency-source.mjs';
import { type App, expectOk, launchApp, startMediamtx, until, which } from './app';

// Low-latency mode (docs/research/low-latency.md): the same stamped RTSP source measured
// in several configurations, alternating A B C … A B C … so drift of a busy machine spreads
// over all of them. Prints one table row per configuration with the stage split; the
// numbers go into the PR. Assertions stay loose (CI renders WebGL in software).
//
//   LZS_LL_ROUNDS=3 LZS_LL_LAYOUT=2×2 npx playwright test -c e2e/playwright.config.ts e2e/lowlatency.spec.ts

const MEDIAMTX = which('mediamtx'), FFMPEG = which('ffmpeg');
test.skip(!MEDIAMTX || !FFMPEG, 'mediamtx oder ffmpeg fehlt (brew install mediamtx ffmpeg)');

const ROUNDS = Number(process.env.LZS_LL_ROUNDS ?? (process.env.CI ? 1 : 2));
const LAYOUT = process.env.LZS_LL_LAYOUT ?? '1';

interface S { mean: number; min: number; max: number }
interface Lat { total: S; toBridge: S | null; bridgeToApp: S | null; decode: S | null; handoff: S | null; wait: S | null; draw: S | null; frames: number }
interface Conf {
  name: string; low: boolean; codec: 'raw' | 'h264'; width: number; transport?: 'tcp' | 'udp';
  /** the source's own low-latency fields (src/lowLatency.ts); '' = global */
  ll?: { width?: string; draw?: '' | '1' | '0'; rtp?: '' | '1' | '0'; stats?: string };
  debug?: Record<string, unknown>;
}

const CONFS: Conf[] = [
  { name: 'normal, roh 960', low: false, codec: 'raw', width: 960 },
  { name: 'Low Latency 640, RTP über ffmpeg', low: true, codec: 'raw', width: 960, ll: { width: '640', draw: '1', rtp: '0' } },
  { name: 'Low Latency 640, RTP eigen (TCP)', low: true, codec: 'raw', width: 960, ll: { width: '640', draw: '1', rtp: '1' } },
  { name: 'Low Latency 640, RTP eigen (UDP)', low: true, codec: 'raw', width: 960, transport: 'udp', ll: { width: '640', draw: '1', rtp: '1' } },
  { name: 'Low Latency 640, RTP eigen, ohne Sofortzeichnen', low: true, codec: 'raw', width: 960, ll: { width: '640', draw: '0', rtp: '1' } },
  { name: 'Low Latency 640, RTP eigen, Statistik 1 s', low: true, codec: 'raw', width: 960, ll: { width: '640', draw: '1', rtp: '1', stats: '1000' } },
  { name: 'Low Latency 320, RTP eigen', low: true, codec: 'raw', width: 960, ll: { width: '320', draw: '1', rtp: '1' } },
  { name: 'normal, H.264 960', low: false, codec: 'h264', width: 960 },
  { name: 'Low Latency 640, H.264, RTP eigen', low: true, codec: 'h264', width: 960, ll: { width: '640', draw: '1', rtp: '1' } },
];

let a: App, mtx: Awaited<ReturnType<typeof startMediamtx>>, src: ReturnType<typeof startLatencySource>;
test.beforeAll(async () => {
  mtx = await startMediamtx(MEDIAMTX!);
  src = startLatencySource(`rtsp://127.0.0.1:${mtx.rtsp}/lat`, { width: 1280, height: 720, fps: 25, ffmpeg: FFMPEG! });
  a = await launchApp();
});
test.afterAll(async () => { await a?.close(); src?.stop(); mtx?.stop(); });

const lat = async () => ((await a.control({ cmd: 'state' })).result as { latency: Lat | null }).latency;
const reception = async () => {
  const r = (await a.control({ cmd: 'state' })).result as { rtp: { own: boolean; transport?: string; note?: string } | null; rtpStats: { lost: number; droppedUnits: number } | null };
  return r.rtp ? (r.rtp.own ? `RTP eigen ${r.rtp.transport?.toUpperCase()}${r.rtpStats ? `, ${r.rtpStats.lost} verloren` : ''}` : `ffmpeg (${r.rtp.note})`) : 'ffmpeg';
};

/** All 2-s summaries over `ms`, sampled every 2 s after settling. */
async function measure(ms: number): Promise<Lat[]> {
  await until(lat, 60_000, 'gestempelte Bilder kommen an');
  await a.page.waitForTimeout(3000);
  const rows: Lat[] = [];
  for (let t = 0; t < ms; t += 2000) {
    await a.page.waitForTimeout(2000);
    const l = await lat();
    if (l) rows.push(l);
  }
  return rows;
}

/** Apply a configuration through the source card (as a user would) and wait for the reconnect. */
async function apply(c: Conf) {
  await a.page.evaluate((d) => localStorage.setItem('lz-scopes.debug', JSON.stringify(d)), c.debug ?? {});
  await a.page.evaluate((c) => {
    // every change re-renders the source cards: look the card up again each time
    const card = () => [...document.querySelectorAll<HTMLElement>('#source-list .src')].pop()!;
    const pick = (value: string, test: (s: HTMLSelectElement) => boolean) => {
      const sel = [...card().querySelectorAll<HTMLSelectElement>('select')].find(test)!;
      sel.value = value; sel.dispatchEvent(new Event('change'));
    };
    const has = (v: string) => (s: HTMLSelectElement) => [...s.options].some((o) => o.value === v && (v !== '1' || !!o.textContent?.startsWith('Low Latency')));
    pick(c.codec, has('h264'));
    pick(c.transport ?? 'tcp', has('udp'));
    pick(c.low ? '1' : '0', has('1'));
    pick(String(c.width), has('1280'));
    // low-latency fields (shown once the mode is on), found by their tool tips
    const byTitle = (start: string) => (s: HTMLSelectElement) => s.title.startsWith(start);
    if (c.low && c.ll?.width !== undefined) pick(c.ll.width, byTitle('Obergrenze'));
    if (c.low && c.ll?.draw !== undefined) pick(c.ll.draw, byTitle('Zeichnet'));
    if (c.low && c.ll?.rtp !== undefined) pick(c.ll.rtp, byTitle('rtsp://'));
    if (c.low) pick(c.ll?.stats ?? '100', byTitle('Wie oft'));
    // reconnect once more with the final settings (every change above reconnected)
    card().querySelector<HTMLInputElement>('input.url')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  }, c);
  await until(async () => (await a.state()).sources.some((x) => x.kind === 'stream' && x.status === 'live'), 60_000, 'Stream wieder live');
}

test('Low-Latency-Modus: Stufen je Konfiguration', async () => {
  test.setTimeout(ROUNDS * CONFS.length * 60_000 + 120_000);
  const { page } = a;
  await page.locator('#add button', { hasText: 'RTSP / Netz' }).click();
  const card = page.locator('#source-list .src').last();
  await card.locator('input.url').fill(`rtsp://127.0.0.1:${mtx.rtsp}/lat`);
  await card.locator('input.url').press('Enter');
  const st = await until(async () => { const s = await a.state(); return s.sources.find((x) => x.kind === 'stream' && x.status === 'live') ? s : false; }, 60_000, 'Stream live');
  expectOk(await a.control({ cmd: 'source.select', source: st.sources.find((x) => x.kind === 'stream')!.index }));
  expectOk(await a.control({ cmd: 'layout.preset', preset: /^\d$/.test(LAYOUT) ? Number(LAYOUT) : LAYOUT }));
  if (LAYOUT === '1') expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope: 'stats' }));

  const rows = new Map<string, Lat[]>(CONFS.map((c) => [c.name, []]));
  const runMeans = new Map<string, number[]>(CONFS.map((c) => [c.name, []]));
  const recv = new Map<string, string>();
  for (let r = 0; r < ROUNDS; r++) {
    for (const c of CONFS) {
      await apply(c);
      const m = await measure(8000);
      recv.set(c.name, await reception());
      rows.get(c.name)!.push(...m);
      runMeans.get(c.name)!.push(m.reduce((s, l) => s + l.total.mean, 0) / Math.max(1, m.length));
    }
  }
  await page.evaluate(() => localStorage.removeItem('lz-scopes.debug'));

  const f = (v: number) => (Number.isFinite(v) ? `${Math.round(v)}` : '–');
  const avg = (v: Lat[], k: keyof Omit<Lat, 'frames'>) => { const x = v.map((l) => l[k]?.mean).filter((y): y is number => Number.isFinite(y)); return x.length ? x.reduce((s, y) => s + y, 0) / x.length : NaN; };
  console.log(`\nLayout ${LAYOUT}, ${ROUNDS} Runden × 8 s je Konfiguration, Mittel der 2-s-Fenster (ms)\n`);
  console.log('| Konfiguration | Empfang | Stempel → gezeichnet | Streuung der Läufe | min–max | Quelle → Bridge | Bridge → App | Worker → Haupt | Warten | Zeichnen |\n|---|---|---|---|---|---|---|---|---|---|');
  for (const c of CONFS) {
    const v = rows.get(c.name)!, runs = runMeans.get(c.name)!;
    const min = Math.min(...v.map((l) => l.total.min)), max = Math.max(...v.map((l) => l.total.max));
    console.log(`| ${c.name} | ${recv.get(c.name)} | ${f(avg(v, 'total'))} | ${runs.map(f).join(' / ')} | ${f(min)}–${f(max)} | ${f(avg(v, 'toBridge'))} | ${f(avg(v, 'bridgeToApp'))} | ${f(avg(v, 'handoff'))} | ${f(avg(v, 'wait'))} | ${f(avg(v, 'draw'))} |`);
    // CI renders WebGL in software: a slow configuration may draw no stamped frame within a 2-s window
    if (!process.env.CI) expect(v.length).toBeGreaterThan(0);
    if (v.length) expect(avg(v, 'total')).toBeLessThan(5000);
  }
  expect(CONFS.filter((c) => rows.get(c.name)!.length).length).toBeGreaterThan(CONFS.length / 2);
  // the panel head shows the mode with the measured value
  await expect(page.locator('.llchip').first()).toContainText('Low Latency');
  if (process.env.LZS_LL_SHOT) await page.screenshot({ path: process.env.LZS_LL_SHOT });
});
