import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, menuClick } from './app';

// LED wall finders in the LED dialog: they run on the live source (an animated test pattern here –
// no camera, no wall) and show their result. The analysis itself is tested against synthetic
// signals in test/flicker.test.ts; this only checks the path from the source to the dialog.

let a: App;

/** Phone width: the finder fits the dialog without a horizontal scroll bar. */
async function phoneFits(el: import('@playwright/test').Locator) {
  const size = await a.app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; const s = w.getSize(); w.setSize(390, 844); return s; });
  await el.scrollIntoViewIfNeeded();
  await a.page.waitForTimeout(300);
  await a.page.screenshot({ path: 'test-results/e2e/ledfinder-phone.png' });
  const over = await el.evaluate((x) => x.scrollWidth - x.clientWidth);
  const dlgOver = await a.page.locator('dialog.ledtool').evaluate((x) => x.scrollWidth - x.clientWidth);
  await a.app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0].setSize(s[0], s[1]), size);
  expect(over, 'finder wider than its box').toBeLessThanOrEqual(1);
  expect(dlgOver, 'dialog scrolls sideways').toBeLessThanOrEqual(1);
}
test.beforeAll(async () => { a = await launchApp({ lang: 'en' }); });
test.afterAll(async () => { await a?.close(); });

test('shutter finder records consecutive frames and shows exposures of whole cycles', async () => {
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'led-scroll' }));
  await menuClick(a, 'led');
  const dlg = page.locator('dialog.ledtool');
  await dlg.locator('summary', { hasText: 'Camera check' }).click();
  const finder = dlg.locator('.flicker');
  await finder.locator('select').first().selectOption('32');
  await finder.locator('input[type=number]').nth(1).fill('100');
  await finder.locator('input[type=number]').nth(1).dispatchEvent('change');
  await finder.getByRole('button', { name: 'Record and analyse' }).click();
  await expect(finder).toContainText('Frame rate used', { timeout: 60_000 });
  await expect(finder.locator('table')).toContainText('1/100 s');
  await expect(finder.locator('.pop-trigger')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/e2e/ledfinder-flicker.png' });
  await phoneFits(finder);
  expect(errors).toEqual([]);
});

test('moiré meter: grid frequency from the placed corners and the spectrum of the grabbed picture', async () => {
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'led-moire' }));
  const dlg = page.locator('dialog.ledtool');
  if (!(await dlg.isVisible())) await menuClick(a, 'led');
  const cam = dlg.locator('details', { has: page.locator('summary', { hasText: 'Camera check' }) });
  if ((await cam.getAttribute('open')) === null) await cam.locator('summary').click();
  await cam.getByRole('button', { name: 'Grab picture' }).click();
  await expect(cam).toContainText('Click the wall corners', { timeout: 30_000 });
  const canvas = cam.locator('canvas.cam');
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  for (const [fx, fy] of [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]) await page.mouse.click(b.x + fx * b.width, b.y + fy * b.height);
  const meter = cam.locator('.moire');
  await meter.getByRole('button', { name: 'Measure moiré' }).click();
  await expect(meter).toContainText('Strongest periodic pattern');
  await expect(meter.locator('.chip')).toHaveCount(1);
  await expect(meter.locator('canvas.spectrum')).toBeVisible();
  await page.screenshot({ path: 'test-results/e2e/ledfinder-moire.png' });
  await phoneFits(meter);
  expect(errors).toEqual([]);
});
