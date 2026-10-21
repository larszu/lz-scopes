import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type App, launchApp, menuClick, SHIPPED_FFMPEG, which } from './app';

// A/V offset from a dropped clip (#153): a synthetic clip from ffmpeg (30 fps, white box for
// 80 ms every second, 1 kHz beep 100 ms after the flash) must read “sound late”, −3 frames,
// about −100 ms. Real phone footage is not covered.

const ffmpeg = which('ffmpeg') ?? SHIPPED_FFMPEG;
let a: App;
test.afterAll(async () => { await a?.close(); });

test('A/V-Versatz aus Clip: Ton 100 ms zu spät', async () => {
  test.skip(!ffmpeg, 'no ffmpeg');
  const file = join(mkdtempSync(join(tmpdir(), 'avclip-')), 'clip.webm');
  execFileSync(ffmpeg!, ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', "color=c=0x303030:s=320x180:r=30:d=6,drawbox=x=80:y=40:w=160:h=100:color=white:t=fill:enable='lt(mod(t\\,1)\\,0.08)'",
    '-f', 'lavfi', '-i', "aevalsrc=0.5*sin(2*PI*1000*t)*lt(mod(t-0.1\\,1)\\,0.08)*gte(t\\,0.1):s=48000:d=6",
    '-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libopus', '-shortest', file]);
  a = await launchApp();
  await menuClick(a, 'avclip');
  const dlg = a.page.locator('dialog#avclip');
  await expect(dlg).toBeVisible();
  await dlg.locator('input[type=file]').setInputFiles(file);
  await expect(dlg.locator('.avclip-card')).toBeVisible({ timeout: 90_000 });
  expect(await dlg.locator('.avclip-card').innerText()).toContain('Ton kommt zu spät');
  const ms = Number((await dlg.getByTestId('avclip-ms').textContent())!.replace('−', '-').replace(/[^\d.+-]/g, ''));
  expect(ms).toBeGreaterThan(-115);
  expect(ms).toBeLessThan(-85);
  await expect(dlg.getByTestId('avclip-frames')).toContainText('3');
});
