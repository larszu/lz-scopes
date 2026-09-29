import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { type App, expectOk, launchApp, singlePanel, startMediamtx, traceNear, until, waveProfile, which } from './app';

// RTSP end to end: ffmpeg publishes SMPTE HD bars (H.264) to a local mediamtx, the bridge
// pulls them over RTSP, the app shows them. Skipped when mediamtx or ffmpeg is missing
// (brew install mediamtx ffmpeg).

const MEDIAMTX = which('mediamtx'), FFMPEG = which('ffmpeg');
test.skip(!MEDIAMTX || !FFMPEG, 'mediamtx oder ffmpeg fehlt (brew install mediamtx ffmpeg)');

let a: App, mtx: Awaited<ReturnType<typeof startMediamtx>>, pub: ChildProcess;
test.beforeAll(async () => {
  mtx = await startMediamtx(MEDIAMTX!);
  pub = spawn(FFMPEG!, ['-hide_banner', '-loglevel', 'error', '-re', '-f', 'lavfi', '-i', 'smptehdbars=size=1280x720:rate=25',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p', '-g', '25',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-f', 'rtsp', '-rtsp_transport', 'tcp', `rtsp://127.0.0.1:${mtx.rtsp}/e2e`], { stdio: 'ignore' });
  a = await launchApp();
});
test.afterAll(async () => { await a?.close(); pub?.kill('SIGKILL'); mtx?.stop(); });

test('RTSP über mediamtx → Bridge → Waveform', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'RTSP / Netz' }).click();
  const url = page.locator('#source-list .src').last().locator('input.url');
  await url.fill(`rtsp://127.0.0.1:${mtx.rtsp}/e2e`);
  await url.press('Enter');
  const st = await until(async () => {
    const s = await a.state();
    return s.sources.find((x) => x.kind === 'stream' && x.status === 'live') ? s : false;
  }, 60_000, 'Stream wird live');
  const stream = st.sources.find((x) => x.kind === 'stream')!;
  expectOk(await a.control({ cmd: 'source.select', source: stream.index }));
  await singlePanel(a, 'wf-luma');
  // smptehdbars (RP 219): 40 % grey (1/8 of the width), then the 75 % white bar; Y′ = 0.75
  const x = (240 + 205.7 / 2) / 1920;
  await until(async () => traceNear((await waveProfile(page, 'wf-luma', [x]))[0], 0.75) > 0.5, 60_000, '75-%-Balken im Waveform');
  // the source card reports the decoded stream
  await expect(page.locator('#source-list .src.live').last()).toContainText('1280×720');
});
