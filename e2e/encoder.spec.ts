import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, until } from './app';

// Encoder confidence panel (src/encoderPanel.ts): two test pattern sources stand in for programme
// and return (no encoder, no stream). Checks the path from both sources to the figures; the
// figures themselves are tested against synthetic pictures in test/encoder.test.ts.

let a: App;
test.beforeAll(async () => { a = await launchApp({ lang: 'en' }); });
test.afterAll(async () => { await a?.close(); });

test('programme against return: delay, blocking and banding appear', async () => {
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // second test pattern source = the "return"
  await page.locator('#source-list').locator('..').getByRole('button', { name: 'Test pattern', exact: true }).first().click();
  await until(async () => (await a.state()).sources.length >= 2, 30_000, 'second source');
  for (const source of [1, 2]) expectOk(await a.control({ cmd: 'pattern.select', pattern: 'led-scroll', source }));
  expectOk(await a.control({ cmd: 'layout.preset', preset: 1 }));
  expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope: 'encoder' }));
  expectOk(await a.control({ cmd: 'source.select', source: 2, panel: 1 }));
  const panel = page.locator('.panel').filter({ has: page.locator('canvas.overlay') }).first();
  await panel.getByRole('button', { name: "Settings: Encoder Confidence" }).click();
  await page.locator('.popover.psettings select').first().selectOption({ index: 1 });
  await page.keyboard.press('Escape');
  const label = await until(async () => {
    const l = await panel.locator('canvas.overlay').getAttribute('aria-label');
    return l && /Delay: \d/.test(l) && /Blocking B\/A: \d/.test(l) && /Banding \(CAMBI-like\): \d/.test(l) ? l : false;
  }, 60_000, 'figures in the encoder panel');
  console.log('encoder panel', label);
  await page.screenshot({ path: 'test-results/e2e/encoder.png' });
  expect(errors).toEqual([]);
});
