import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { type App, SHIPPED_FFMPEG, freePort, launchApp, menuClick, singlePanel, startMediamtx, traceNear, until, waveProfile, which } from './app';

// SRT end to end, everything through the ffmpeg the app ships (npm run ffmpeg:fetch):
//  - receive: shipped ffmpeg publishes SMPTE HD bars (H.264/MPEG-TS) to a local SRT listener
//    (mediamtx), the bridge pulls srt://…?streamid=read:… and the app shows them
//  - push: a 10-bit output window streams HEVC Main 10 to srt://, a shipped ffmpeg in SRT
//    listener mode receives it
// The bridge must report the shipped build (origin vendor, SRT) in /api/health and the UI.

const MEDIAMTX = which('mediamtx');
test.skip(!SHIPPED_FFMPEG, 'mitgeliefertes ffmpeg fehlt (npm run ffmpeg:fetch)');

let a: App, mtx: Awaited<ReturnType<typeof startMediamtx>> | undefined, pub: ChildProcess | undefined;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); pub?.kill('SIGKILL'); mtx?.stop(); });

test('Bridge meldet das mitgelieferte ffmpeg mit SRT', async () => {
  const h = await (await fetch(`${a.base}/api/health`)).json();
  expect(h.ffmpeg).toMatchObject({ path: SHIPPED_FFMPEG, origin: 'vendor', license: 'GPL-3.0-or-later', srt: true, inputSrt: true });
  await menuClick(a, 'settings:bridge');
  await expect(a.page.locator('#ffmpeg-info')).toContainText('mitgeliefert');
  await expect(a.page.locator('#ffmpeg-info')).toContainText('SRT ja');
  await a.page.keyboard.press('Escape');
});

test('SRT-Empfang: mediamtx-Listener → Bridge (mitgeliefertes ffmpeg) → Waveform', async () => {
  test.skip(!MEDIAMTX, 'mediamtx fehlt (brew install mediamtx)');
  mtx = await startMediamtx(MEDIAMTX!, { srt: true });
  pub = spawn(SHIPPED_FFMPEG!, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'smptehdbars=size=1280x720:rate=25',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '25',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-f', 'mpegts', `srt://127.0.0.1:${mtx.srt}?streamid=publish:e2e&pkt_size=1316`], { stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1500));
  const { page } = a;
  await page.locator('#add button', { hasText: 'RTSP / Netz' }).click();
  const url = page.locator('#source-list .src').last().locator('input.url');
  await url.fill(`srt://127.0.0.1:${mtx.srt}?streamid=read:e2e`);
  await url.press('Enter');
  const st = await until(async () => {
    const s = await a.state();
    return s.sources.find((x) => x.kind === 'stream' && x.status === 'live') ? s : false;
  }, 60_000, 'SRT-Stream wird live');
  const stream = st.sources.find((x) => x.kind === 'stream')!;
  await a.control({ cmd: 'source.select', source: stream.index });
  await singlePanel(a, 'wf-luma');
  // smptehdbars (RP 219): 75 % white bar after the 40 % grey; Y′ = 0.75 (same point as rtsp.spec.ts)
  const x = (240 + 205.7 / 2) / 1920;
  await until(async () => traceNear((await waveProfile(page, 'wf-luma', [x]))[0], 0.75) > 0.5, 60_000, '75-%-Balken im Waveform');
  const card = page.locator('#source-list .src.live').last();
  await expect(card).toContainText('1280×720');
  await expect(card.locator('[data-ffmpeg-source]')).toContainText('SRT-Empfang mit ffmpeg');
});

async function openWindow(q: string): Promise<Page> {
  const before = a.app.windows().length;
  await a.page.evaluate((qs) => { window.open(`${location.pathname}?${qs}`, `e2e-${Date.now()}`); }, q);
  await until(() => a.app.windows().length > before, 30_000, 'Fenster erscheint');
  const w = a.app.windows()[a.app.windows().length - 1];
  await w.waitForFunction(() => !!document.body.dataset.pipeline, undefined, { timeout: 60_000 });
  return w;
}

test('SRT-Push: 10-bit-Stream (HEVC Main 10) → srt:// → mitgeliefertes ffmpeg als Listener', async () => {
  const port = await freePort();
  let log = '';
  const rx = spawn(SHIPPED_FFMPEG!, ['-hide_banner', '-f', 'mpegts', '-i', `srt://127.0.0.1:${port}?mode=listener`, '-frames:v', '1', '-f', 'null', '-']);
  rx.stderr.on('data', (d) => { log += d; });
  const done = new Promise((ok) => rx.on('close', ok));
  await new Promise((r) => setTimeout(r, 500));
  const w = await openWindow(`out=ramp10&w=1280&h=720&stream=e2esrt&codec=hevc10&target=${encodeURIComponent(`srt://127.0.0.1:${port}`)}`);
  // the window boots in software WebGL first (CI, busy machines: up to about a minute)
  await Promise.race([done, new Promise((r) => setTimeout(r, 120_000))]);
  rx.kill();
  expect(log).toMatch(/hevc \(Main 10\)/);
  expect(log).toMatch(/1280x720/);
  await w.close();
});
