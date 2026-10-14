import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until, WAVE_MAX, WAVE_MIN } from './app';

// Camera comparison (src/ghost.ts and friends), driven through the control API and the panel ⚙.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** Colour of the brightest pixel around signal `level` in the middle column of the visible wf-luma panel. */
async function traceColour(level: number) {
  return a.page.evaluate(({ level, wmin, wmax }) => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'wf-luma')!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.blit')!;
    const dpr = c.width / c.getBoundingClientRect().width;
    const cssW = c.width / dpr, cssH = c.height / dpr;
    const r = { x: 44, y: 8, w: cssW - 52, h: cssH - 16 };
    const y = r.y + ((wmax - level) / (wmax - wmin)) * r.h;
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(Math.round((r.x + r.w / 2) * dpr), Math.round((y - 4) * dpr), 3, Math.round(8 * dpr)).data;
    let best = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > best[0] + best[1] + best[2]) best = [d[i], d[i + 1], d[i + 2]];
    return best;
  }, { level, wmin: WAVE_MIN, wmax: WAVE_MAX });
}

test('Referenzkamera eingefroren: Geisterspur in Magenta am alten Pegel', async () => {
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'gray50' }));
  await singlePanel(a, 'wf-luma');
  const st = await a.state();
  // the 50 % grey becomes the frozen reference …
  expectOk(await a.control({ cmd: 'setting', key: 'refSource', value: st.sources[0].id }));
  await until(async () => (await traceColour(0.5))[1] > 60, 60_000, 'Graustufe 50 % sichtbar');
  expectOk(await a.control({ cmd: 'setting', key: 'refMode', value: 'frozen' }));
  // … the panel shows it (⚙ → Referenzspur einblenden)
  await a.page.locator('.panel .pop-trigger:not(.help-trigger) >> visible=true').first().click();
  await a.page.locator('.panel .popover:popover-open').getByRole('checkbox', { name: 'Referenzspur einblenden' }).check();
  await a.page.keyboard.press('Escape');
  // … and the live picture changes to black: live trace at 0 %, magenta ghost stays at 50 %
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'black' }));
  const ghost = await until(async () => { const c = await traceColour(0.5); return c[0] > 60 && c[2] > 60 && c[1] < c[0] * 0.7 ? c : false; }, 60_000, 'Magenta-Spur bei 50 %')
    .catch(async (e) => { console.log('Farbe bei 50 %', await traceColour(0.5)); throw e; });
  expect(ghost[0]).toBeGreaterThan(ghost[1]);
  // the live trace is in the mono tint (green by default), not magenta
  const live = await traceColour(0);
  expect(live[1]).toBeGreaterThan(live[0]);
});
