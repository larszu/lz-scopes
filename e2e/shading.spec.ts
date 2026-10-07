import { expect, test } from '@playwright/test';
import { type App, WAVE_MAX, WAVE_MIN, expectOk, launchApp, menuClick, until, waveLevels } from './app';

// Touch Shading (#54) against the simulator: grab the red trace of the parade in the highlights,
// pull it up, and the red channel – only the red channel – rises in the scope. The stop button
// puts it back.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** Column of grey step `i` (0…10) of the simulator's top half, in the parade section `sec` (0 = R). */
const col = (sec: number, i: number) => (sec + (i + 0.5) / 11) / 3;

test('Parade: Rot in den Lichtern hochziehen → nur Rot steigt, Ausgangswerte stellen zurück', async () => {
  const { page } = a;
  expectOk(await a.control({ cmd: 'layout.preset', preset: 1 }));
  await menuClick(a, 'shading');
  await page.selectOption('[data-shading-target]', 'sim');
  expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope: 'parade' }));
  await page.check('[data-shading-active]');

  // grey step 8 = 80 % in R, G and B
  const at = [col(0, 8), col(1, 8)];
  await until(async () => {
    const l = await waveLevels(page, 'parade', at);
    return l.every((v) => Math.abs(v - 0.8) < 0.02) ? l : false;
  }, 60_000, 'Simulator in der Parade');

  const b = await page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'parade')!;
    const q = el.querySelector('.body')!.getBoundingClientRect();
    return { x: q.left, y: q.top, width: q.width, height: q.height };
  });
  const r = { x: 44, y: 8, w: b.width - 52, h: b.height - 16 };
  const yOf = (level: number) => b.y + r.y + r.h - ((level - WAVE_MIN) / (WAVE_MAX - WAVE_MIN)) * r.h;
  const x = b.x + r.x + col(0, 8) * r.w;
  await page.mouse.move(x, yOf(0.8));
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) await page.mouse.move(x, yOf(0.8 + (0.12 * i) / 40));
  await page.mouse.up();

  await expect(page.locator('[data-field="whiteR"]')).not.toHaveText(/\(\+0\)/);
  const after = await until(async () => {
    const [red, green] = await waveLevels(page, 'parade', at);
    return red > 0.84 && Math.abs(green - 0.8) < 0.02 ? [red, green] : false;
  }, 60_000, 'Rot gestiegen, Grün unverändert');
  console.log('R/G nach dem Ziehen', after);

  await page.click('[data-shading-stop]');
  await until(async () => {
    const [red] = await waveLevels(page, 'parade', at);
    return Math.abs(red - 0.8) < 0.02;
  }, 60_000, 'Rot zurück auf 80 %');
  await expect(page.locator('[data-shading-active]')).not.toBeChecked();
});

test('Vectorscope: drehen = Hue, radial = Sättigung (Simulator)', async () => {
  const { page } = a;
  expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope: 'vector' }));
  await page.check('[data-shading-active]');
  const b = await page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'vector')!;
    const q = el.querySelector('.body')!.getBoundingClientRect();
    return { x: q.left, y: q.top, width: q.width, height: q.height };
  });
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2, R = Math.min(b.width, b.height) * 0.3;
  // a quarter turn counter-clockwise at constant radius
  await page.mouse.move(cx + R, cy);
  await page.mouse.down();
  for (let i = 1; i <= 30; i++) { const t = (i / 30) * (Math.PI / 2); await page.mouse.move(cx + R * Math.cos(t), cy - R * Math.sin(t)); }
  if (process.env.LZS_E2E_SHOTS) await page.screenshot({ path: `${process.env.LZS_E2E_SHOTS}/shading-vector.png` });
  await page.mouse.up();
  const hue = Number((await page.locator('[data-field="hue"]').textContent())!.match(/Hue (-?\d+)/)![1]);
  expect(hue).toBeGreaterThan(20); // limited per movement and by the session span (±45°)
  expect(hue).toBeLessThanOrEqual(45);
  await expect(page.locator('[data-field="saturation"]')).toHaveText(/128 \(\+0\)/);

  // radial outwards: saturation up
  await page.mouse.move(cx, cy - R * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(cx, cy - R * (0.5 + (0.25 * i) / 20));
  await page.mouse.up();
  await expect(page.locator('[data-field="saturation"]')).not.toHaveText(/128 \(\+0\)/);

  await page.click('[data-shading-stop]');
  await expect(page.locator('[data-field="hue"]')).toHaveText(/Hue 0° \(\+0\)/);
  await expect(page.locator('[data-field="saturation"]')).toHaveText(/128 \(\+0\)/);
});
