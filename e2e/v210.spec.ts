import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type App, ROOT, expectOk, launchApp, menuClick, singlePanel, until, waveLevels, waveProfile } from './app';

// v210 from DeckLink/AJA (#258): the bridge passes the card's packed words through, the shader
// unpacks them (src/v210.ts V210_FETCH_GLSL) and the CPU readers decode them in place. Stand-in
// helper with a Y′/chroma ramp (test/fixtures/fake-decklink-live.mjs, LZS_FAKE_V210=ramp).
// The same picture unpacked in the frame worker (debug switch {"v210":"worker"}, the path before)
// must give the same traces. With LZS_E2E_PERF=1 the built-in performance test runs on both paths
// and the reports land in test-results/e2e/v210-perf.txt (measurement for the PR, not in CI).
test.skip(process.platform === 'win32', 'shell stand-in for the helper');

let a: App;
test.beforeAll(async () => {
  a = await launchApp({ lang: 'de', env: { LZS_DECKLINK_HELPER: join(ROOT, 'test/fixtures/fake-decklink-live.sh'), LZS_FAKE_V210: 'ramp' } });
});
test.afterAll(async () => { await a?.close(); });

interface Probe { pack: string | null; words: boolean; len: number; w: number; px: number[] | null; yAvg: number | null }

const probe = () => a.page.evaluate(() => {
  type S = { pack: string | null; data: ArrayLike<number> | null; width: number; readPixel: (x: number, y: number) => number[] | null; stats: { yAvg: number } | null };
  const w = window as unknown as { lzs: { sources: () => { id: string }[]; source: (id: string) => S | null } };
  const s = w.lzs.source(w.lzs.sources()[0].id)!;
  return { pack: s.pack, words: s.data instanceof Uint32Array, len: s.data?.length ?? 0, w: s.width, px: s.readPixel(480, 540), yAvg: s.stats?.yAvg ?? null } as Probe;
});

/** 16-bit Y′CbCr at native width (the card's own format), reconnected with the given debug switch. */
async function connect(v210: 'gpu' | 'worker') {
  await a.page.evaluate((v210) => {
    localStorage.setItem('lz-scopes.debug', JSON.stringify(v210 === 'worker' ? { v210 } : {}));
    type S = { url: string; settings: Record<string, unknown>; connectStream: (u: string, b: string) => void };
    const w = window as unknown as { lzs: { sources: () => { id: string }[]; source: (id: string) => S | null; bridgeUrl: () => string } };
    const s = w.lzs.source(w.lzs.sources()[0].id)!;
    Object.assign(s.settings, { yuv: true, depth: 16, width: 0 });
    s.connectStream(s.url, w.lzs.bridgeUrl());
  }, v210);
  return until(async () => { const p = await probe(); return p.w === 1920 && p.len > 0 && p.words === (v210 === 'gpu') ? p : false; }, 30_000, `v210 ${v210}`);
}

/** Help → Leistungstest: run it and return the text report. */
async function perfReport(): Promise<string> {
  await menuClick(a, 'perfTest');
  await a.page.getByRole('button', { name: 'Test starten' }).click();
  const pre = a.page.locator('pre.perf-report');
  await expect(pre).toHaveCount(1, { timeout: 60_000 });
  const text = (await pre.textContent()) ?? '';
  await a.page.keyboard.press('Escape');
  return text;
}

test('v210: packed words on the GPU and CPU, same traces as unpacked in the worker', async () => {
  test.setTimeout(240_000);
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('#add button', { hasText: 'Blackmagic DeckLink' }).click();
  await expect.poll(async () => (await a.state()).sources.find((x) => x.kind === 'stream')?.status, { timeout: 30_000 }).toBe('live');
  await expect.poll(async () => (await a.state()).sources.map((x) => x.kind), { timeout: 10_000 }).toEqual(['stream']);

  const gpu = await connect('gpu');
  expect(gpu.pack).toBe('v210');
  // 1920 px = 40 blocks of 48 px, 32 words each, per row: a third of the 8 B/px unpacked
  expect(gpu.len).toBe(40 * 32 * 1080);
  // CPU reader (probe): x = 480 → Y′ code 64 + round(876 · 480 / 1919) = 283, BT.709 narrow range
  const y480 = (Math.round((876 * 480) / 1919)) / 876;
  const rgb = gpu.px!;
  expect(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]).toBeCloseTo(y480, 4);
  // statistics on the packed words: mean of the ramp ≈ 0.5
  await expect.poll(async () => (await probe()).yAvg ?? -1, { timeout: 10_000 }).toBeGreaterThan(0.45);
  expect((await probe()).yAvg).toBeLessThan(0.55);

  // shader: luma waveform follows the ramp
  await singlePanel(a, 'wf-luma');
  const fr = [0.1, 0.3, 0.5, 0.7, 0.9];
  const want = fr.map((f) => Math.round((876 * Math.floor(f * 1920)) / 1919) / 876);
  await until(async () => { const l = await waveLevels(page, 'wf-luma', fr); return l.every((v, i) => Math.abs(v - want[i]) < 0.02) ? l : false; }, 20_000, 'Luma-Wellenform der Rampe');

  // RGB parade carries the chroma: GPU path and worker path must draw the same
  expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope: 'wf-rgb' }));
  const pf = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
  await page.waitForTimeout(1000);
  const onGpu = await waveLevels(page, 'wf-rgb', pf);
  const profGpu = await waveProfile(page, 'wf-rgb', pf);
  let gpuPerf = '';
  if (process.env.LZS_E2E_PERF) {
    expectOk(await a.control({ cmd: 'layout.preset', preset: '2x2' }));
    gpuPerf = await perfReport();
  }

  await connect('worker');
  expect((await probe()).pack).toBeNull();
  expect((await probe()).px![0]).toBeCloseTo(rgb[0], 6);
  let workerPerf = '';
  if (process.env.LZS_E2E_PERF) {
    workerPerf = await perfReport();
    await singlePanel(a, 'wf-rgb');
  }
  await page.waitForTimeout(1000);
  const onWorker = await waveLevels(page, 'wf-rgb', pf);
  expect(onWorker.every((v) => Number.isFinite(v))).toBe(true);
  onWorker.forEach((v, i) => expect(Math.abs(v - onGpu[i])).toBeLessThan(0.005));
  const profWorker = await waveProfile(page, 'wf-rgb', pf);
  // trace shape per column: brightest rows at the same levels
  for (let c = 0; c < pf.length; c++) {
    const top = (p: { level: number; v: number }[]) => p.filter((q) => q.v > 0.5).map((q) => q.level.toFixed(2)).join(',');
    expect(top(profWorker[c])).toBe(top(profGpu[c]));
  }
  if (process.env.LZS_E2E_PERF) {
    // the shader path once more, so the order of the runs does not decide the comparison
    expectOk(await a.control({ cmd: 'layout.preset', preset: '2x2' }));
    await connect('gpu');
    const gpuAgain = await perfReport();
    mkdirSync(join(ROOT, 'test-results/e2e'), { recursive: true });
    writeFileSync(join(ROOT, 'test-results/e2e/v210-perf.txt'), `== v210 im Shader (neu)\n${gpuPerf}\n\n== v210 im Worker entpackt (vorher)\n${workerPerf}\n\n== v210 im Shader, zweiter Lauf\n${gpuAgain}\n`);
  }
  expect(errors).toEqual([]);
});
