import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { type App, expectOk, launchApp, own, singlePanel, startMediamtx, traceNear, until, waveProfile, which } from './app';

// Interlaced per source (#219): an interlaced H.264 stream (1080i25, x264 PAFF/MBAFF with
// upper field first) over a local mediamtx. The source card offers the field order and, once
// interlaced, the de-interlacing; both reconnect and the picture stays measurable.

const MEDIAMTX = which('mediamtx'), FFMPEG = which('ffmpeg');
test.skip(!MEDIAMTX || !FFMPEG, 'mediamtx oder ffmpeg fehlt (brew install mediamtx ffmpeg)');

let a: App, mtx: Awaited<ReturnType<typeof startMediamtx>>, pub: ChildProcess;
test.beforeAll(async () => {
  mtx = await startMediamtx(MEDIAMTX!);
  pub = own(spawn(FFMPEG!, ['-hide_banner', '-loglevel', 'error', '-re', '-t', '900', '-f', 'lavfi', '-i', 'smptehdbars=size=1920x1080:rate=25',
    '-vf', 'setfield=tff', '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-flags', '+ildct+ilme', '-x264-params', 'tff=1', '-pix_fmt', 'yuv420p', '-g', '25',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-f', 'rtsp', '-rtsp_transport', 'tcp', `rtsp://127.0.0.1:${mtx.rtsp}/i`], { stdio: 'ignore' }));
  a = await launchApp();
});
test.afterAll(async () => { await a?.close(); pub?.kill('SIGKILL'); mtx?.stop(); });

test('Halbbilder und Deinterlacing an der Quellkarte', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'RTSP / Netz' }).click();
  const card = page.locator('#source-list .src').last();
  const url = card.locator('input.url');
  await url.fill(`rtsp://127.0.0.1:${mtx.rtsp}/i`);
  await url.press('Enter');
  const live = async () => until(async () => {
    const s = await a.state();
    return s.sources.find((x) => x.kind === 'stream' && x.status === 'live') ?? false;
  }, 60_000, 'Stream wird live');
  await live();
  const fields = card.locator('select', { has: page.locator('option[value="bff"]') });
  await expect(fields).toHaveValue('auto');
  // what the bridge detected stands next to "auto"
  await until(async () => /Halbbilder auto \(/.test((await fields.locator('option[value="auto"]').textContent()) ?? ''), 30_000, 'gemeldete Halbbild-Reihenfolge');
  // fixed upper field first: the de-interlacing choice appears
  await fields.selectOption('tff');
  await live();
  const deint = card.locator('select', { has: page.locator('option', { hasText: 'Deinterlacing ein' }) });
  await expect(deint).toHaveCount(1);
  await deint.selectOption('1');
  await expect(card.locator('select', { has: page.locator('option[value="bff"]') })).toHaveValue('tff');
  await expect(deint).toHaveValue('1');
  const stream = await live();
  expectOk(await a.control({ cmd: 'source.select', source: stream.index }));
  await singlePanel(a, 'wf-luma');
  // bwdif keeps still areas: the 75 % bar stays at its level
  await until(async () => traceNear((await waveProfile(page, 'wf-luma', [(240 + 205.7 / 2) / 1920]))[0], 0.75) > 0.5, 60_000, '75-%-Balken im Waveform');
});
