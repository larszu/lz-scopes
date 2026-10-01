import { expect, test } from '@playwright/test';
import { startLatencySource } from '../scripts/latency-source.mjs';
import { type App, expectOk, launchApp, singlePanel, startMediamtx, until, which } from './app';

// Latency (#16): stamped test source (scripts/latency-source.mjs) → x264 → mediamtx (RTSP)
// → bridge → app. Measures three reception paths one after another and prints a table:
//   raw, main thread   – the path before #16 (plain WebSocket on the main thread)
//   raw, worker        – WebSocket in a worker, latest-frame hand-over
//   H.264, worker      – bridge re-encodes, WebCodecs decodes in the worker (8 bit)
// Assertions stay loose (machines differ); the numbers go into the PR.

const MEDIAMTX = which('mediamtx'), FFMPEG = which('ffmpeg');
test.skip(!MEDIAMTX || !FFMPEG, 'mediamtx oder ffmpeg fehlt (brew install mediamtx ffmpeg)');

interface Lat { total: { mean: number; min: number; max: number }; toBridge: { mean: number } | null; bridgeToApp: { mean: number } | null; decode: { mean: number } | null; frames: number }

let a: App, mtx: Awaited<ReturnType<typeof startMediamtx>>, src: ReturnType<typeof startLatencySource>;
test.beforeAll(async () => {
  mtx = await startMediamtx(MEDIAMTX!);
  src = startLatencySource(`rtsp://127.0.0.1:${mtx.rtsp}/lat`, { width: 1280, height: 720, fps: 25, ffmpeg: FFMPEG! });
  a = await launchApp();
});
test.afterAll(async () => { await a?.close(); src?.stop(); mtx?.stop(); });

/** Mean of the app's 2-s summaries over `ms`, sampled every 2 s. */
async function measure(ms = 8000): Promise<Lat> {
  const got = await until(async () => (await a.control({ cmd: 'state' })).result as { latency: Lat | null }, 30_000);
  void got;
  await until(async () => ((await a.control({ cmd: 'state' })).result as { latency: Lat | null }).latency, 60_000, 'gestempelte Bilder kommen an');
  await a.page.waitForTimeout(3000); // settle after connect
  const rows: Lat[] = [];
  for (let t = 0; t < ms; t += 2000) {
    await a.page.waitForTimeout(2000);
    const l = ((await a.control({ cmd: 'state' })).result as { latency: Lat | null }).latency;
    if (l) rows.push(l);
  }
  const avg = (f: (l: Lat) => number | undefined) => { const v = rows.map(f).filter((x): x is number => Number.isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
  return {
    total: { mean: avg((l) => l.total.mean), min: Math.min(...rows.map((l) => l.total.min)), max: Math.max(...rows.map((l) => l.total.max)) },
    toBridge: { mean: avg((l) => l.toBridge?.mean) }, bridgeToApp: { mean: avg((l) => l.bridgeToApp?.mean) }, decode: { mean: avg((l) => l.decode?.mean) },
    frames: avg((l) => l.frames),
  };
}

/** The worker switch is read on every connect: set it, then reconnect the stream (Enter in the URL field). */
async function reconnectWith(flags: object) {
  await a.page.evaluate((f) => localStorage.setItem('lz-scopes.debug', JSON.stringify(f)), flags);
  // (dispatched in the page: Playwright's actionability checks wait for animation frames)
  await a.page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('#source-list .src input.url')].pop()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
  await until(async () => (await a.state()).sources.some((x) => x.kind === 'stream' && x.status === 'live'), 60_000, 'Stream wieder live');
}

test('Latenz roh (Hauptthread), roh (Worker), H.264 (Worker)', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'RTSP / Netz' }).click();
  const card = page.locator('#source-list .src').last();
  await card.locator('input.url').fill(`rtsp://127.0.0.1:${mtx.rtsp}/lat`);
  await card.locator('input.url').press('Enter');
  const st = await until(async () => { const s = await a.state(); return s.sources.find((x) => x.kind === 'stream' && x.status === 'live') ? s : false; }, 60_000, 'Stream live');
  const idx = st.sources.find((x) => x.kind === 'stream')!.index;
  expectOk(await a.control({ cmd: 'source.select', source: idx }));
  await singlePanel(a, 'stats');

  const results: [string, Lat][] = [];
  await reconnectWith({ worker: false });
  results.push(['roh, Hauptthread (vorher)', await measure()]);
  await reconnectWith({});
  results.push(['roh, Worker', await measure()]);
  await page.evaluate(() => {
    const sel = [...document.querySelectorAll<HTMLSelectElement>('#source-list select')].find((x) => [...x.options].some((o) => o.value === 'h264'))!;
    sel.value = 'h264'; sel.dispatchEvent(new Event('change'));
  });
  await until(async () => (await a.state()).sources[idx - 1].status === 'live', 60_000, 'H.264-Stream live');
  results.push(['H.264, Worker', await measure()]);
  await expect(page.locator('.panel canvas.overlay').first()).toBeVisible();

  const f = (v: number | undefined) => (Number.isFinite(v) ? `${Math.round(v!)}` : '–');
  console.log('\n| Weg | Stempel → Anzeige ms (min–max) | Quelle → Bridge | Bridge → App | H.264-Dekodierung | Bilder/2 s |\n|---|---|---|---|---|---|');
  for (const [name, l] of results) console.log(`| ${name} | ${f(l.total.mean)} (${f(l.total.min)}–${f(l.total.max)}) | ${f(l.toBridge?.mean)} | ${f(l.bridgeToApp?.mean)} | ${f(l.decode?.mean)} | ${f(l.frames)} |`);
  for (const [, l] of results) {
    expect(l.total.mean).toBeGreaterThan(0);
    // loose: CI renders WebGL in software on two cores; the raw path then falls seconds behind
    expect(l.total.mean).toBeLessThan(process.env.CI ? 20_000 : 5000);
  }
});
