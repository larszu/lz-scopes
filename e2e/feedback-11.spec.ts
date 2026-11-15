import { expect, test } from '@playwright/test';
import { type App, launchApp, singlePanel, until } from './app';

// Feedback from a broadcast engineer (11/2026): scope list in groups with the picture overlays as
// entries of their own, diamond on a full black field with a magnifier, fixed vectorscope centre box.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

const head = (a: App) => a.page.locator('.panel .phead select').first();

test('Scope-Liste in Gruppen, Falschfarben als eigener Eintrag unter Bild', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  await singlePanel(a, 'parade');
  const groups = await head(a).locator('optgroup').evaluateAll((g) => g.map((x) => (x as HTMLOptGroupElement).label));
  expect(groups).toEqual(expect.arrayContaining(['Bild', 'Waveform', 'Farbe & Gamut', 'Audio']));
  await head(a).selectOption('picture:false');
  await until(async () => (await a.state()).panels[0]?.scope === 'picture', 10_000, 'Panel zeigt Bild');
  await expect(head(a)).toHaveValue('picture:false');
  await page.screenshot({ path: test.info().outputPath('falschfarben.png') });
});

test('Diamond: schwarzes Feld über das ganze Panel, Lupe auf den Schwarzpunkt', async () => {
  const { page } = a;
  await singlePanel(a, 'diamond');
  await page.waitForTimeout(800);
  // corners of the panel body are black now (were app background beside the 1:2 strip)
  const corner = await page.evaluate(() => {
    const c = [...document.querySelectorAll<HTMLCanvasElement>('.panel canvas.blit')].find((x) => x.getBoundingClientRect().width > 4)!;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const d = ctx.getImageData(4, Math.round(c.height / 2), 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  expect(Math.max(...corner)).toBeLessThan(6);
  await page.screenshot({ path: test.info().outputPath('diamond.png') });
  await page.locator('.panel .pop-trigger', { hasText: '⚙' }).first().click();
  const zoom = page.locator('.psettings select').filter({ has: page.locator('option[value="black"]') });
  await zoom.selectOption('black');
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath('diamond-lupe.png') });
  await page.keyboard.press('Escape');
});

test('Vectorscope: Mittenquadrat bleibt bei ×2 gleich groß', async () => {
  const { page } = a;
  await singlePanel(a, 'vector');
  await page.waitForTimeout(800);
  await page.screenshot({ path: test.info().outputPath('vector-x1.png') });
});
