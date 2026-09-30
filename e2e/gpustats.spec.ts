import { expect, test } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type App, expectOk, launchApp, singlePanel, until, which } from './app';

// Statistics of a browser-decoded video file (#16): GPU reduction (src/gpuStats.ts) against
// the CPU readback path (localStorage 'lz-scopes.debug' = {"stats":"cpu"}). Same values,
// main-thread cost printed for the PR.

const FFMPEG = which('ffmpeg');
test.skip(!FFMPEG, 'ffmpeg fehlt');

let a: App, dir = '';
test.beforeAll(async () => { a = await launchApp(); dir = mkdtempSync(join(tmpdir(), 'lzs-vid-')); });
test.afterAll(async () => { await a?.close(); rmSync(dir, { recursive: true, force: true }); });

interface St { statsPerf: { path: string; ms: number } | null; clip: number | null; yMin: number | null; yMax: number | null }

test('Statistik einer Videodatei: GPU = CPU, Kosten im Hauptthread', async () => {
  const file = join(dir, 'bars.mp4');
  const r = spawnSync(FFMPEG!, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'smptehdbars=size=1920x1080:rate=25', '-t', '8',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', file]);
  expect(r.status).toBe(0);
  const { page } = a;
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#add button', { hasText: /^Datei$/ }).click();
  await (await chooser).setFiles(file);
  const st = await until(async () => { const s = await a.state(); return s.sources.find((x) => x.kind === 'file' && x.status === 'live') ? s : false; }, 60_000, 'Video läuft');
  expectOk(await a.control({ cmd: 'source.select', source: st.sources.find((x) => x.kind === 'file')!.index }));
  await singlePanel(a, 'stats');

  const sample = async (path: string) => {
    const rows: St[] = [];
    await until(async () => ((await a.control({ cmd: 'state' })).result as St).statsPerf?.path === path, 30_000, `Statistik über ${path}`);
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(250);
      const s = (await a.control({ cmd: 'state' })).result as St;
      if (s.statsPerf?.path === path) rows.push(s);
    }
    const ms = rows.map((x) => x.statsPerf!.ms).sort((p, q) => p - q);
    return { ms: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1], last: rows[rows.length - 1] };
  };
  const gpu = await sample('gpu');
  await page.evaluate(() => localStorage.setItem('lz-scopes.debug', JSON.stringify({ stats: 'cpu' })));
  const cpu = await sample('cpu');
  await page.evaluate(() => localStorage.removeItem('lz-scopes.debug'));
  console.log(`\n| Statistik (Video 1920×1080) | Median ms Hauptthread | Max ms | Y′ min / max % | Clip % |\n|---|---|---|---|---|`);
  for (const [n, x] of [['CPU (vorher, 480-px-Readback)', cpu], ['GPU (volle Auflösung)', gpu]] as const) {
    console.log(`| ${n} | ${x.ms.toFixed(2)} | ${x.max.toFixed(2)} | ${x.last.yMin} / ${x.last.yMax} | ${x.last.clip} |`);
  }
  // bars: black PLUGE (0 %) and 100 % white are in the picture on both paths
  expect(Math.abs(gpu.last.yMax! - cpu.last.yMax!)).toBeLessThan(1.5);
  expect(Math.abs(gpu.last.yMin! - cpu.last.yMin!)).toBeLessThan(1.5);
});
