import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type App, ROOT, launchApp, until, which } from './app';

// Transport of a file through the bridge (#191, server/clip.mjs): the app releases the clip at
// start (LZS_MEDIA_FILE), the source card plays it, holds one picture on Pause and goes exactly
// one frame further on a step – read off the card's own time code, as a user would.

const shipped = ['darwin-arm64', 'darwin-x64', 'darwin-universal', 'linux-x64', 'linux-arm64', 'win32-x64']
  .map((x) => join(ROOT, 'vendor', 'ffmpeg', x, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')).find((f) => existsSync(f));
const FFMPEG = shipped ?? which('ffmpeg');
test.skip(!FFMPEG, 'ffmpeg fehlt (npm run ffmpeg:fetch)');

const dir = mkdtempSync(join(tmpdir(), 'lzs-clip-'));
const clip = join(dir, 'takt.mov');
let a: App;
test.beforeAll(async () => {
  // 4 s, 25 fps, ProRes 422 HQ 10 bit: all-intra, so a seek lands on exactly one frame
  execFileSync(FFMPEG!, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25', '-t', '4',
    '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', clip]);
  a = await launchApp({ env: { LZS_MEDIA_FILE: clip } });
});
test.afterAll(async () => { await a?.close(); rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); });

/** frame number of a time code hh:mm:ss:ff at 25 fps */
const frameOf = (tc: string) => {
  const m = /(\d+):(\d+):(\d+):(\d+)/.exec(tc);
  if (!m) throw new Error(`kein Timecode: ${tc}`);
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 25 + Number(m[4]);
};

test('Datei über die Bridge: Pause hält ein Bild, Einzelbild geht genau eines weiter', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'RTSP / Netz' }).click();
  const url = page.locator('#source-list .src').last().locator('input.url');
  await url.fill('file:takt.mov');
  await url.press('Enter');
  await until(async () => (await a.state()).sources.some((x) => x.status === 'live'), 60_000, 'Datei wird live');
  const card = page.locator('#source-list .src').last();
  await expect(card).toContainText('640×360');
  const tc = card.locator('.tc');
  const transport = card.locator('.transport');
  await expect(transport).toBeVisible();

  // it plays by itself, like the browser path
  const first = frameOf(await tc.textContent() ?? '');
  await until(async () => frameOf(await tc.textContent() ?? '') > first, 20_000, 'Abspielkopf läuft');

  // Pause: the time code must stand still
  await transport.getByRole('button', { name: 'Start/Stopp (Leertaste, K)' }).click();
  await page.waitForTimeout(1500);
  const held = frameOf(await tc.textContent() ?? '');
  await page.waitForTimeout(1000);
  expect(frameOf(await tc.textContent() ?? '')).toBe(held);

  // one frame further, then back again
  await transport.getByRole('button', { name: 'Frame vor (→)' }).click();
  await until(async () => frameOf(await tc.textContent() ?? '') === held + 1, 10_000, 'ein Bild weiter');
  await transport.getByRole('button', { name: 'Frame zurück (←)' }).click();
  await until(async () => frameOf(await tc.textContent() ?? '') === held, 10_000, 'ein Bild zurück');
  await page.screenshot({ path: test.info().outputPath('clip-paused.png') });

  // and on from there
  await transport.getByRole('button', { name: 'Start/Stopp (Leertaste, K)' }).click();
  await until(async () => frameOf(await tc.textContent() ?? '') > held + 5, 20_000, 'spielt weiter');
});
