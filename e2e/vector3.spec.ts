import { expect, test } from '@playwright/test';
import { type App, launchApp, singlePanel, until } from './app';

// Vectorscope by tonal range (#180): three circles, each fed only with the pixels of its luma
// range. Checked against the SMPTE bars: the saturated colours sit in the shadows and the mids,
// while the highlights hold white and grey – that is, the centre.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** Lit pixels per circle: how many, and how far from the centre the furthest sits (0…1). */
async function circles(a: App) {
  return a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'vector3');
    if (!el) throw new Error('kein sichtbares Panel vector3');
    const c = el.querySelector<HTMLCanvasElement>('canvas.blit')!;
    const dpr = c.width / c.getBoundingClientRect().width;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const cssW = c.width / dpr, cssH = c.height / dpr;
    // same geometry as graticule.ts plotRect('vector3') + vectorBandRects
    const r = { x: 6, y: 6, w: Math.max(30, cssW - 12), h: Math.max(30, cssH - 12) };
    const w = r.w / 3;
    return [0, 1, 2].map((i) => {
      const s = Math.max(10, Math.min(w - 8, r.h - 18));
      const box = { x: r.x + i * w + (w - s) / 2, y: r.y + (r.h - 18 - s) / 2 + 12, w: s, h: s };
      const px = ctx.getImageData(Math.round(box.x * dpr), Math.round(box.y * dpr), Math.round(s * dpr), Math.round(s * dpr)).data;
      const n = Math.round(s * dpr);
      let lit = 0, maxR = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const k = (y * n + x) * 4;
          // the graticule is drawn in warm yellow-grey; a trace dot is clearly brighter
          const v = px[k] + px[k + 1] + px[k + 2];
          if (v < 220) continue;
          const dx = (x + 0.5) / n * 2 - 1, dy = (y + 0.5) / n * 2 - 1;
          const rad = Math.hypot(dx, dy) / 0.9; // the graticule circle sits at 0.9 of the half width
          if (rad > 1.2) continue; // outside: labels and frame
          lit++;
          maxR = Math.max(maxR, rad);
        }
      }
      return { lit, maxR };
    });
  });
}

test('Vectorscope nach Tonwert: gesättigte Balken unten und in der Mitte, Lichter neutral', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  await singlePanel(a, 'vector3');
  // The scopes need a moment after the layout switch: wait until the picture is settled, then
  // check it twice over – a reading caught mid-switch must not decide this test.
  const settled = async () => {
    const q = await circles(a);
    // the bars give few, small dots: a handful of lit pixels per circle is the whole trace
    if (!(q[0].lit >= 3 && q[1].lit >= 3 && q[2].lit >= 1)) return false;
    // shadows and mids carry the saturated bars: dots far out towards the primaries
    if (!(q[0].maxR > 0.35 && q[1].maxR > 0.35)) return false;
    // The highlights of these bars are white and grey, so their circle stays near the centre.
    // Not an absolute bound: the yellow bar sits at Y′ 69.6 %, right on the 70 % boundary, and
    // may fall on either side – but it never reaches as far out as cyan and green in the mids.
    return q[2].maxR < q[1].maxR - 0.1 ? q : false;
  };
  const c = await until(settled, 30_000, 'Spur in allen drei Kreisen, Lichter neutral');
  expect(c[0].maxR).toBeGreaterThan(0.35);
  expect(c[2].maxR).toBeLessThan(c[1].maxR - 0.1);
  // and it stays that way, it was not a frame caught in between
  expect(await settled()).not.toBe(false);
  await page.screenshot({ path: test.info().outputPath('vector3.png') });
});
