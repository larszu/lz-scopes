import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until, WAVE_MAX, WAVE_MIN } from './app';
import { TILE_HEAD, tileAspect, tileGrid } from '../src/tiles';

// Camera comparison (src/ghost.ts and friends), driven through the control API and the panel ⚙.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });
// a stray key press (space) on the visible window freezes every source: start each test live
test.beforeEach(async () => { expectOk(await a.control({ cmd: 'freeze', mode: 'off' })); });

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

/** Trace brightness at signal `level` in the middle of waveform tile `i` (layout from src/tiles.ts). */
async function tileLevel(i: number, n: number, level: number) {
  const size = await a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4)!;
    const r = el.querySelector<HTMLCanvasElement>('canvas.blit')!.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  const c = tileGrid(n, size.w, size.h, tileAspect('wf-luma'))[i];
  const body = { x: c.x, y: c.y + TILE_HEAD, w: c.w, h: c.h - TILE_HEAD };
  const plot = { x: body.x + 44, y: body.y + 8, w: body.w - 52, h: body.h - 16 };
  const y = plot.y + ((WAVE_MAX - level) / (WAVE_MAX - WAVE_MIN)) * plot.h;
  return a.page.evaluate(({ x, y }) => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4)!;
    const cv = el.querySelector<HTMLCanvasElement>('canvas.blit')!;
    const dpr = cv.width / cv.getBoundingClientRect().width;
    const d = cv.getContext('2d', { willReadFrequently: true })!.getImageData(Math.round(x * dpr), Math.round((y - 4) * dpr), 3, Math.round(8 * dpr)).data;
    let max = 0;
    for (let k = 0; k < d.length; k += 4) max = Math.max(max, d[k] + d[k + 1] + d[k + 2]);
    return max;
  }, { x: plot.x + plot.w / 2, y });
}

test('Kachelansicht: zwei Quellen, je eine Waveform-Kachel', async () => {
  expectOk(await a.control({ cmd: 'setting', key: 'refSource', value: '' }));
  if ((await a.state()).sources.length < 2) await a.page.getByRole('button', { name: 'Testbild', exact: true }).click();
  const st = await until(async () => { const s = await a.state(); return s.sources.length >= 2 ? s : false; }, 30_000, 'zweite Testbild-Quelle');
  expectOk(await a.control({ cmd: 'pattern.select', source: st.sources[0].id, pattern: 'white' }));
  expectOk(await a.control({ cmd: 'pattern.select', source: st.sources[1].id, pattern: 'black' }));
  await singlePanel(a, 'tiles');
  const n = st.sources.length;
  // tile 1 (white): trace at 100 %, nothing at 0 %; tile 2 (black): trace at 0 %, nothing at 100 %
  const read = async () => [await tileLevel(0, n, 1), await tileLevel(0, n, 0), await tileLevel(1, n, 0), await tileLevel(1, n, 1)];
  await until(async () => { const [w1, b1, b2, w2] = await read(); return w1 > 150 && b2 > 150 && b1 < 60 && w2 < 60; }, 60_000, 'Kacheln mit Weiß in 1 und Schwarz in 2')
    .catch(async (e) => { console.log('Kachelpegel', await read()); throw e; });
});

/** Share of strongly red pixels in the visible picture panel (peaking colour red). */
async function redShare() {
  return a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'picture')!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.blit')!;
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 80 && d[i + 2] < 80) n++;
    return n / (d.length / 4);
  });
}

test('Fokus-Peaking: Kanten des Schachbretts rot, Graufläche ohne', async () => {
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'checker' }));
  await singlePanel(a, 'picture');
  await a.page.locator('.panel .pop-trigger:not(.help-trigger) >> visible=true').first().click();
  await a.page.locator('.panel .popover:popover-open').getByRole('combobox', { name: 'Overlay' }).selectOption('peaking');
  await a.page.keyboard.press('Escape');
  await until(async () => (await redShare()) > 0.002, 30_000, 'rote Kanten');
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'gray50' }));
  await until(async () => (await redShare()) < 0.0005, 30_000, 'keine Kanten auf Grau');
});

test('Rauschmessung: Panel zeigt die Tabelle ohne Fehler', async () => {
  const errors: string[] = [];
  a.page.on('pageerror', (e) => errors.push(e.message));
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'gray50' }));
  await singlePanel(a, 'noise');
  // text rows on the overlay canvas: several lines of bright pixels at the top left
  const rows = () => a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4)!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const dpr = c.width / c.getBoundingClientRect().width;
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, Math.round(300 * dpr), Math.round(200 * dpr)).data;
    const w = Math.round(300 * dpr), lit = new Set<number>();
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) lit.add(Math.floor((i >> 2) / w / (15 * dpr)));
    return lit.size;
  });
  await until(async () => (await rows()) >= 8, 30_000, 'Zeilen der Rauschtabelle');
  expect(errors).toEqual([]);
});

test('White-Shading-Karte: Grauverlauf links dunkler (blau), rechts heller (warm)', async () => {
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'ramp' }));
  await singlePanel(a, 'wshading');
  const row = () => a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4)!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const dpr = c.width / c.getBoundingClientRect().width;
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, Math.round(14 * dpr), c.width, 1).data;
    const first = [d[Math.round(12 * dpr) * 4], d[Math.round(12 * dpr) * 4 + 2]];
    let warm = false;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i] > 200 && d[i + 2] < 120) warm = true;
    return { blueFirst: first[1] > first[0] + 60, warm };
  });
  await until(async () => { const r = await row(); return r.blueFirst && r.warm; }, 30_000, 'Karte blau links, warm rechts')
    .catch(async (e) => { console.log('Karte', await row()); throw e; });
});

test('Farbtafel-Match: zwei gleiche Tafeln grün, eine andere rot', async () => {
  if ((await a.state()).sources.length < 2) await a.page.getByRole('button', { name: 'Testbild', exact: true }).click();
  const st = await until(async () => { const s = await a.state(); return s.sources.length >= 2 ? s : false; }, 30_000, 'zweite Testbild-Quelle');
  const [s1, s2] = st.sources;
  for (const s of [s1, s2]) expectOk(await a.control({ cmd: 'pattern.select', source: s.id, pattern: 'macbeth' }));
  await singlePanel(a, 'chart');
  // cells coloured by verdict (match/chartPanel.ts VERDICT at 85 % over the dark panel)
  const cells = () => a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'chart')!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
    let green = 0, red = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      if (d[i + 1] > d[i] + 60 && d[i + 1] > d[i + 2] + 40) green++;
      if (d[i] > d[i + 1] + 60 && d[i] > d[i + 2] + 60) red++;
    }
    return { green, red };
  });
  await until(async () => { const c = await cells(); return c.green > 2000 && c.red < 50; }, 30_000, 'alle Felder grün')
    .catch(async (e) => { console.log('Zellen', await cells()); throw e; });
  expectOk(await a.control({ cmd: 'pattern.select', source: s2.id, pattern: 'smpte75' }));
  await until(async () => { const c = await cells(); return c.red > 500; }, 30_000, 'Felder rot')
    .catch(async (e) => { console.log('Zellen', await cells()); throw e; });
});

test('Hautton aller Kameras: zwei Quellen als zwei farbige Wolken', async () => {
  if ((await a.state()).sources.length < 2) await a.page.getByRole('button', { name: 'Testbild', exact: true }).click();
  const st = await until(async () => { const s = await a.state(); return s.sources.length >= 2 ? s : false; }, 30_000, 'zweite Testbild-Quelle');
  for (const s of st.sources.slice(0, 2)) expectOk(await a.control({ cmd: 'pattern.select', source: s.id, pattern: 'macbeth' }));
  await singlePanel(a, 'skinall');
  // dots/crosses in the first two cloud colours (src/skinTone.ts CLOUD_COLOURS) inside the vectorscope
  const colours = () => a.page.evaluate(() => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4)!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const dpr = c.width / c.getBoundingClientRect().width, side = Math.min(c.width / dpr - 404, c.height / dpr - 16);
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(Math.round(8 * dpr), Math.round(8 * dpr), Math.round(side * dpr), Math.round(side * dpr)).data;
    let amber = 0, cyan = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      if (d[i] > 230 && d[i + 1] > 160 && d[i + 1] < 200 && d[i + 2] < 100) amber++;
      if (d[i] < 120 && d[i + 1] > 180 && d[i + 2] > 230) cyan++;
    }
    return { amber, cyan };
  });
  await until(async () => { const c = await colours(); return c.amber > 10 && c.cyan > 10; }, 30_000, 'zwei Wolken')
    .catch(async (e) => { console.log('Wolken', await colours()); throw e; });
});

test('STOP-Skala: Hauptlinie bei der Graukarte (SDR 40,9 %)', async () => {
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'steps11' }));
  await singlePanel(a, 'wf-luma');
  expectOk(await a.control({ cmd: 'setting', key: 'unit', value: 'stop' }));
  // major graticule line (src/graticule.ts GRID, solid) at stop 0 on the overlay canvas
  const line = (level: number) => a.page.evaluate(({ level, wmin, wmax }) => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === 'wf-luma')!;
    const c = el.querySelector<HTMLCanvasElement>('canvas.overlay')!;
    const dpr = c.width / c.getBoundingClientRect().width, cssW = c.width / dpr, cssH = c.height / dpr;
    const r = { x: 44, y: 8, w: cssW - 52, h: cssH - 16 };
    const y = r.y + r.h - ((level - wmin) / (wmax - wmin)) * r.h;
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(Math.round((r.x + r.w * 0.31) * dpr), Math.round((y - 2) * dpr), 1, Math.round(4 * dpr)).data;
    let alpha = 0;
    for (let i = 3; i < d.length; i += 4) alpha = Math.max(alpha, d[i]);
    return alpha;
  }, { level, wmin: WAVE_MIN, wmax: WAVE_MAX });
  const grey = 1.099 * 0.18 ** 0.45 - 0.099;
  await until(async () => (await line(grey)) > 80, 30_000, 'Linie bei Blende 0');
  // the percent scale has no line there (only every 10 %)
  expectOk(await a.control({ cmd: 'setting', key: 'unit', value: 'percent' }));
  await until(async () => (await line(grey)) < 20, 30_000, 'keine Linie bei 40,9 % in der %-Skala');
});
