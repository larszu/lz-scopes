import { expect, test } from '@playwright/test';
import { type App, launchApp, singlePanel, until } from './app';

// CIE diagram (#181): the share of the picture outside the target gamut. The same bars are read
// twice – tagged Rec.709 nothing is outside, tagged Rec.2020 the saturated bars are.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

const outside = async () => ((await a.state()) as unknown as { outside: { gamut: string; share: number; far: number } | null }).outside;

test('Anteil außerhalb Rec.709: Balken als 709 nichts, als 2020 deutlich', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  await singlePanel(a, 'cie');

  // the test pattern is Rec.709: nothing of it can lie outside Rec.709
  const inside = await until(async () => { const o = await outside(); return o && o.gamut === '709' ? o : false; }, 30_000, 'Anteil wird gemeldet');
  expect(inside.share).toBe(0);

  // the same code values read as Rec.2020: the saturated bars no longer fit into Rec.709
  await page.locator('#source-list .src').first().locator('select').filter({ hasText: 'Gamut auto' }).selectOption('2020');
  const wide = await until(async () => { const o = await outside(); return o && o.share > 0 ? o : false; }, 30_000, 'Anteil außerhalb steigt');
  // six of the eight bars are saturated, and they fill the upper two thirds of the picture
  expect(wide.share).toBeGreaterThan(20);
  expect(wide.share).toBeLessThan(95);
  // the green bar is far outside, the red one only just
  expect(wide.far).toBeGreaterThan(0);
  expect(wide.far).toBeLessThan(wide.share);
  await page.screenshot({ path: test.info().outputPath('cie.png') });
});
