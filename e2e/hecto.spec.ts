import { expect, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { type App, expectOk, launchApp, singlePanel, until } from './app';

// Hectorscope (#178): the picture as a surface. With the 11-step grey scale and the height
// colour ramp, the dark steps are blue and the bright ones red; both must be drawn, so the
// shader variant compiled and kept its WebGL context (CI runs SwiftShader).

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** Count clearly blue and clearly red pixels in the visible surface panel. */
async function colours(a: App) {
  return a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'surface');
    if (!el) throw new Error('kein sichtbares Panel surface');
    const c = el.querySelector<HTMLCanvasElement>('canvas.blit')!;
    const px = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
    let blue = 0, red = 0;
    for (let k = 0; k < px.length; k += 4) {
      const r = px[k], g = px[k + 1], b = px[k + 2];
      if (b > 90 && r < 40 && g < 40) blue++;
      if (r > 90 && g < 40 && b < 40) red++;
    }
    return { blue, red };
  });
}

test('Hectorscope: Graustufen als Treppe, dunkel blau, hell rot', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'steps11' }));
  await singlePanel(a, 'surface');
  const c = await until(async () => { const q = await colours(a); return q.blue > 50 && q.red > 50 ? q : false; }, 30_000, 'blaue und rote Stufen');
  expect(c.blue).toBeGreaterThan(50);
  expect(c.red).toBeGreaterThan(50);
  // the panel itself as the record (a page screenshot waits for fonts and times out under load)
  const png = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4)!.querySelector<HTMLCanvasElement>('canvas.blit')!.toDataURL('image/png'));
  writeFileSync(test.info().outputPath('hecto.png'), Buffer.from(png.split(',')[1], 'base64'));
});
