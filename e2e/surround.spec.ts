import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until } from './app';

// Surround luminance in the HLG system gamma (#201). The maths is in test/hlgsurround.test.ts;
// here it is the wiring: the setting arrives through the control API, and the nits scale says
// which room it assumes – a reading in cd/m² must not hide that assumption.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** Lit pixels in the band where the scale label sits (top right of the plot). */
async function labelPixels(): Promise<number>;
async function labelPixels(png: true): Promise<string>;
async function labelPixels(png = false): Promise<number | string> {
  return a.page.evaluate((png) => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value.split(':')[0] === 'wf-luma')!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const dpr = c.width / c.getBoundingClientRect().width;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    // plot top 8 px + label 2 px below it + 10 px font: 24 px hold the whole line
    const h = Math.round(24 * dpr), w = Math.round(Math.min(c.width, 420 * dpr));
    if (png) {
      const o = document.createElement('canvas'); o.width = w; o.height = h;
      o.getContext('2d')!.putImageData(ctx.getImageData(c.width - w, 0, w, h), 0, 0);
      return `${c.width}x${c.height} dpr ${dpr} ${o.toDataURL('image/png')}`;
    }
    const px = ctx.getImageData(c.width - w, 0, w, h).data;
    let lit = 0;
    for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 180) lit++;
    return lit;
  }, png);
}

test('Umfeldleuchtdichte: die nits-Skala sagt, welchen Raum sie annimmt', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'gray50' }));
  await singlePanel(a, 'wf-luma');
  expectOk(await a.control({ cmd: 'setting', key: 'unit', value: 'nits' }));
  // read the pattern as HLG, then the system gamma applies
  // the card can be rebuilt while the pattern starts (slow CI): choose HLG until it sticks
  await until(async () => {
    const card = page.locator('#source-list .src').first();
    const d = card.locator('details.src-colour');
    if (!(await d.evaluate((e) => (e as HTMLDetailsElement).open))) await d.locator('> summary').click();
    const sel = card.locator('select').filter({ has: page.locator('option[value="hlg"]') }).first();
    if ((await sel.inputValue()) !== 'hlg') await sel.selectOption('hlg');
    await page.waitForTimeout(300);
    return (await card.locator('select').filter({ has: page.locator('option[value="hlg"]') }).first().inputValue()) === 'hlg';
  }, 30_000, 'Quelle als HLG gelesen');
  // the renderer follows the card a few frames later (slow in CI): until then the label still
  // names the previous curve, so the reference count is taken once it holds still
  let prev = -1, same = 0;
  const plain = await until(async () => {
    const n = await labelPixels();
    same = n === prev ? same + 1 : 0; prev = n;
    await page.waitForTimeout(300);
    return n > 20 && same >= 3 ? n : false;
  }, 30_000, 'Skalenbeschriftung');

  // a bright room: the label grows by the note about the surround
  expectOk(await a.control({ cmd: 'setting', key: 'surround', value: 200 }));
  const seen: number[] = [];
  const withNote = await until(async () => { const n = await labelPixels(); seen.push(n); return n > plain * 1.3 ? n : false; }, 30_000, 'Hinweis auf das Umfeld')
    .catch(async (e) => {
      // diagnosis for CI (passes locally): what the band holds and what the card says
      const tr = await page.locator('#source-list .src').first().locator('select').filter({ has: page.locator('option[value="hlg"]') }).first().inputValue().catch(() => '?');
      console.log(`[surround] plain ${plain} seen ${seen.slice(-8).join(',')} transfer ${tr} band ${await labelPixels(true)}`);
      throw e;
    });
  expect(withNote).toBeGreaterThan(plain);
  await page.screenshot({ path: test.info().outputPath('surround.png') });

  // back to the reference environment: the note disappears again
  expectOk(await a.control({ cmd: 'setting', key: 'surround', value: 5 }));
  const back = await until(async () => { const n = await labelPixels(); return n < plain * 1.2 ? n : false; }, 30_000, 'Hinweis verschwindet');
  expect(back).toBeLessThan(withNote);
});
