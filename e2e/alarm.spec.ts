import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until } from './app';

// Alarm frame per panel (#182): the panel gets a coloured frame – green while the signal is
// clean, red while a QC condition holds, amber for the hold time after it. Checked by reading
// the frame's own pixels, with the test pattern switched from 50 % grey to 100 % white.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** Colour of the panel frame: the mean of the four edge rows, as r/g/b. */
async function frameColour(): Promise<[number, number, number]> {
  return a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4)!;
    // the frame is drawn on the 2D overlay, not on the GL blit canvas
    const c = el.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const dpr = c.width / c.getBoundingClientRect().width;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const n = Math.max(1, Math.round(2 * dpr));
    const px = ctx.getImageData(0, Math.round(c.height / 2) - n, n, 2 * n).data;
    let r = 0, g = 0, b = 0, k = 0;
    for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; k++; }
    return [r / k, g / k, b / k] as [number, number, number];
  });
}

test('Alarmrahmen: grün bei sauberem Signal, rot bei Clipping, danach gelb', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'gray50' }));
  await singlePanel(a, 'picture');

  // ⚙ → Alarmrahmen einschalten
  await page.locator('.panel .pop-trigger:not(.help-trigger) >> visible=true').first().click();
  await page.locator('.panel .popover:popover-open').getByRole('checkbox', { name: 'Rahmen in der Farbe des Zustands' }).check();
  await page.keyboard.press('Escape');

  // 50 % Grau ist sauber: grüner Rahmen
  const green = await until(async () => { const c = await frameColour(); return c[1] > 60 && c[1] > c[0] * 1.5 && c[1] > c[2] * 1.5 ? c : false; }, 30_000, 'grüner Rahmen');
  expect(green[1]).toBeGreaterThan(green[0]);

  // 100 % Weiß klippt in allen Kanälen: roter Rahmen
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'white' }));
  const red = await until(async () => { const c = await frameColour(); return c[0] > 100 && c[0] > c[1] * 1.5 && c[0] > c[2] * 1.5 ? c : false; }, 30_000, 'roter Rahmen');
  expect(red[0]).toBeGreaterThan(red[1]);
  await page.screenshot({ path: test.info().outputPath('alarm-rot.png') });

  // zurück auf Grau: die Haltezeit hält den Rahmen gelb, bevor er grün wird
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'gray50' }));
  const amber = await until(async () => { const c = await frameColour(); return c[0] > 100 && c[1] > 60 && c[2] < 80 ? c : false; }, 30_000, 'gelber Rahmen in der Haltezeit');
  expect(amber[2]).toBeLessThan(amber[1]);
});
