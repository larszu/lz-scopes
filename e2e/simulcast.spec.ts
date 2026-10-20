import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until } from './app';

// Simulcast deviation panel (src/simulcastPanel.ts): PQ ramp, CST to Rec.709 SDR clipped at the
// target peak. Below the reference white (203 cd/m²) the SDR version is the same light → grey;
// the clipped highlights on the right deviate → coloured / white. Reads the panel's overlay canvas.

let a: App;
test.beforeAll(async () => { a = await launchApp({ lang: 'en' }); });
test.afterAll(async () => { await a?.close(); });

/** RGB of the overlay canvas of the simulcast panel at fractions of its picture area (ramp = top 70 %). */
async function pick(fx: number[], fy: number) {
  return a.page.evaluate(({ fx, fy }) => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'simulcast')!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const dpr = c.width / c.getBoundingClientRect().width, w = c.width / dpr, h = c.height / dpr;
    let pw = w, ph = w / (16 / 9);
    if (ph > h - 18) { ph = h - 18; pw = ph * (16 / 9); }
    const px = (w - pw) / 2, py = Math.max(0, (h - 18 - ph) / 2);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    return fx.map((f) => [...ctx.getImageData(Math.round((px + f * pw) * dpr), Math.round((py + fy * ph) * dpr), 1, 1).data.slice(0, 3)]);
  }, { fx, fy });
}

test('PQ ramp → SDR clip: grey below reference white, deviating highlights', async () => {
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'pq-ramp' }));
  await singlePanel(a, 'simulcast');
  const panel = page.locator('.panel').filter({ has: page.locator('.phead select', { hasText: 'Simulcast' }) }).first();
  const card = page.locator('#source-list .src').first();
  await card.locator('details.chain > summary').click();
  await card.locator('details.chain .row').first().locator('select').nth(1).selectOption('709');
  await card.locator('details.chain .row').nth(2).locator('select').first().selectOption('clip');
  // defaults: reference = signal, compared = after LUT (= after CST without a LUT)
  await expect(panel).toBeVisible();
  const px = await until(async () => {
    const [low, mid, high] = await pick([0.2, 0.45, 0.92], 0.5);
    const grey = (c: number[]) => Math.max(...c) - Math.min(...c) < 10 && c[0] < 140;
    return grey(low) && grey(mid) && high[0] > 200 ? { low, mid, high } : false;
  }, 60_000, 'grey below 203 cd/m², deviation in the highlights');
  console.log('simulcast pixels', JSON.stringify(px));
  await page.screenshot({ path: 'test-results/e2e/simulcast.png' });
  expect(errors).toEqual([]);
});
