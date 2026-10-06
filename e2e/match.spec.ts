import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, until } from './app';

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** Panel element showing `scope` (visible). */
const panelBox = (scope: string) => a.page.evaluate((scope) => {
  const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
    p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === scope);
  const c = el?.querySelector<HTMLCanvasElement>('canvas.overlay');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}, scope);

test('Farbabgleich: Messpunkt auf dem 75-%-Gelbbalken erscheint als Farbfeld der Quelle', async () => {
  const errors: string[] = [];
  a.page.on('pageerror', (e) => errors.push(e.message));
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'smpte75' }));
  expectOk(await a.control({ cmd: 'layout.preset', preset: 2 }));
  expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope: 'picture' }));
  expectOk(await a.control({ cmd: 'panel.scope', panel: 2, scope: 'match' }));
  const pic = await until(() => panelBox('picture'), 60_000, 'Bild-Panel');
  // picture letterboxed into the panel (16:9): bar 2 of 7 (75 % yellow) in the upper third
  const ph = Math.min(pic.h, (pic.w * 9) / 16), pw = (ph * 16) / 9;
  await a.page.mouse.click(pic.x + (pic.w - pw) / 2 + pw * (1.5 / 7), pic.y + (pic.h - ph) / 2 + ph * 0.3);
  // source swatch: top-left of the match panel (match/panel.ts: pad 10, title rows 30 px)
  const rgb = await until(async () => {
    const v = await a.page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'match');
      const c = el?.querySelector<HTMLCanvasElement>('canvas.overlay');
      if (!c) return null;
      const dpr = c.width / c.getBoundingClientRect().width;
      const d = c.getContext('2d')!.getImageData(Math.round(30 * dpr), Math.round(60 * dpr), 1, 1).data;
      return [d[0], d[1], d[2], d[3]];
    });
    return v && v[3] > 200 ? v : null;
  }, 60_000, 'Farbfeld der Quelle');
  // 75 % yellow: R′ = G′ = 0.75, B′ = 0 → about 188/188/0 on an sRGB display (P3 differs slightly)
  expect(rgb[0]).toBeGreaterThan(150); expect(rgb[1]).toBeGreaterThan(150); expect(rgb[2]).toBeLessThan(60);
  expectOk(await a.control({ cmd: 'panel.scope', panel: 2, scope: 'wf-green' }));
  await until(() => panelBox('wf-green'), 30_000, 'Waveform Grüntöne');
  expect(errors).toEqual([]);
});
