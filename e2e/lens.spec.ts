import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until } from './app';

// Lens fingerprint panel (src/lensPanel.ts): a flat test pattern stands in for the white field
// (no camera, no lens). Store a fingerprint, the panel compares the live field with it.

let a: App;
test.beforeAll(async () => { a = await launchApp({ lang: 'en' }); });
test.afterAll(async () => { await a?.close(); });

test('store a fingerprint and compare the live field with it', async () => {
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'led-flat' }));
  await singlePanel(a, 'lens');
  const panel = page.locator('.panel').first();
  await expect.poll(async () => (await panel.locator('canvas.overlay').getAttribute('aria-label')) ?? '', { timeout: 60_000 }).toContain('No fingerprint stored');
  await panel.getByRole('button', { name: 'Settings: Lens Fingerprint' }).click();
  const pop = page.locator('.popover.psettings');
  await pop.getByPlaceholder(/Fujinon/).fill('Test lens');
  await pop.getByPlaceholder(/Fujinon/).press('Enter');
  await pop.locator('input[type=number]').first().fill('10');
  await pop.locator('input[type=number]').first().dispatchEvent('change');
  await pop.getByRole('button', { name: 'Store fingerprint' }).click();
  await page.keyboard.press('Escape');
  const label = await until(async () => {
    const l = await panel.locator('canvas.overlay').getAttribute('aria-label');
    return l && l.includes('Test lens @ 10') && /ΔR [+−-]?0\.0/.test(l) ? l : false;
  }, 60_000, 'comparison with the stored fingerprint');
  console.log('lens panel', label);
  await page.screenshot({ path: 'test-results/e2e/lens.png' });
  expect(errors).toEqual([]);
});
