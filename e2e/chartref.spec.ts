import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until } from './app';

// Colour chart against the reference values (#200): the maths is in test/chartref.test.ts –
// here the panel itself, with the ColorChecker test pattern as the source.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** Lit pixels of the panel: the match matrix draws coloured cells, an empty panel does not. */
async function cells() {
  return a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'chart')!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const px = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 300) lit++;
    return lit;
  });
}

test('Farbtafel gegen Sollwerte: Panel rechnet ohne Fehler und zeigt die Matrix', async () => {
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'macbeth' }));
  await singlePanel(a, 'chart');
  const camera = await until(async () => { const n = await cells(); return n > 500 ? n : false; }, 30_000, 'Match-Matrix gezeichnet');

  // ⚙ → Referenz: Sollwerte der Tafel
  await page.locator('.panel .pop-trigger:not(.help-trigger) >> visible=true').first().click();
  await page.locator('.panel .popover:popover-open').getByLabel('Referenz').selectOption('values');
  await page.keyboard.press('Escape');

  // the panel keeps drawing – now against the reference values, with the hint about the chart
  const values = await until(async () => { const n = await cells(); return n > 500 ? n : false; }, 30_000, 'Matrix gegen Sollwerte');
  expect(values).toBeGreaterThan(500);
  expect(camera).toBeGreaterThan(500);
  await page.screenshot({ path: test.info().outputPath('chartref.png') });
  expect(errors).toEqual([]);
});
