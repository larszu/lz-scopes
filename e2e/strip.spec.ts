import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until } from './app';

// Bildhistorie (#196): sechs Standbilder im Abstand von 1 s, darunter die Wellenform. Testbild
// erst Weiß, dann Schwarz: kurz nach dem Wechsel sind die linken (älteren) Kacheln noch weiß,
// die rechte (jetzt) schwarz. Der Wechsel des Testbilds startet die Quelle neu – die Standbilder
// bleiben dabei stehen (Beleg für das, was vor einem Neustart ankam). Gelesen aus den Pixeln der 2D-Ebene des Panels.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** Mittlere Helligkeit der Standbildreihe in sechs gleich breiten Streifen (0 … 255). */
async function tileLevels(): Promise<number[]> {
  return a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4)!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const dpr = c.width / c.getBoundingClientRect().width;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    // erste Kachelreihe: 6 px Rand oben, Kachelhöhe ≈ (Breite / 6) · 9/16 → Zeile bei 20 px
    const y = Math.round(20 * dpr), px = ctx.getImageData(0, y, c.width, 1).data;
    return Array.from({ length: 6 }, (_, i) => {
      const x0 = Math.round(((i + 0.3) / 6) * c.width), x1 = Math.round(((i + 0.7) / 6) * c.width);
      let s = 0, k = 0;
      for (let x = x0; x < x1; x++) { s += (px[x * 4] + px[x * 4 + 1] + px[x * 4 + 2]) / 3; k++; }
      return s / k;
    });
  });
}

test('Bildhistorie: Wechsel wandert von rechts nach links durch die Standbilder', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'white' }));
  await singlePanel(a, 'strip');
  // sechs Sekunden Weiß füllen den ganzen Streifen
  await until(async () => { const l = await tileLevels(); return l.every((v) => v > 200) ? l : false; }, 30_000, 'alle Kacheln weiß');
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'black' }));
  const mixed = await until(async () => { const l = await tileLevels(); return l[5] < 40 && l[0] > 200 ? l : false; }, 20_000, 'rechts schwarz, links noch weiß');
  expect(mixed[0]).toBeGreaterThan(mixed[5]);
  // nach sechs Sekunden ist auch das älteste Standbild schwarz
  await until(async () => { const l = await tileLevels(); return l.every((v) => v < 40) ? l : false; }, 30_000, 'alle Kacheln schwarz');
  // Einstellungen einmal bedienen: drei Standbilder füllen die Breite mit größeren Kacheln
  await page.locator('.phead .pop-trigger:not(.help-trigger) >> visible=true').first().click();
  const pop = page.locator('.popover:popover-open');
  await expect(pop.getByText('Standbilder', { exact: true })).toBeVisible();
  await pop.locator('select').filter({ has: page.locator('option[value="10"]') }).first().selectOption('3');
  await page.keyboard.press('Escape');
  await page.screenshot({ path: test.info().outputPath('strip-3.png') });
});
