import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until } from './app';

// Surround luminance in the HLG system gamma (#201). The maths is in test/hlgsurround.test.ts;
// here it is the wiring: the setting arrives through the control API, and the nits scale says
// which room it assumes – a reading in cd/m² must not hide that assumption.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** Lit pixels in the band where the scale label sits (top right of the plot). */
async function labelPixels() {
  return a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'wf-luma')!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const dpr = c.width / c.getBoundingClientRect().width;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const h = Math.round(16 * dpr), w = Math.round(Math.min(c.width, 420 * dpr));
    const px = ctx.getImageData(c.width - w, 0, w, h).data;
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 180) lit++;
    return lit;
  });
}

test('Umfeldleuchtdichte: die nits-Skala sagt, welchen Raum sie annimmt', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'gray50' }));
  await singlePanel(a, 'wf-luma');
  expectOk(await a.control({ cmd: 'setting', key: 'unit', value: 'nits' }));
  // read the pattern as HLG, then the system gamma applies
  await page.locator('#source-list .src').first().locator('select').filter({ hasText: 'auto: SDR' }).selectOption('hlg');
  const plain = await until(async () => { const n = await labelPixels(); return n > 20 ? n : false; }, 30_000, 'Skalenbeschriftung');

  // a bright room: the label grows by the note about the surround
  expectOk(await a.control({ cmd: 'setting', key: 'surround', value: 200 }));
  const withNote = await until(async () => { const n = await labelPixels(); return n > plain * 1.3 ? n : false; }, 30_000, 'Hinweis auf das Umfeld');
  expect(withNote).toBeGreaterThan(plain);
  await page.screenshot({ path: test.info().outputPath('surround.png') });

  // back to the reference environment: the note disappears again
  expectOk(await a.control({ cmd: 'setting', key: 'surround', value: 5 }));
  const back = await until(async () => { const n = await labelPixels(); return n < plain * 1.2 ? n : false; }, 30_000, 'Hinweis verschwindet');
  expect(back).toBeLessThan(withNote);
});
