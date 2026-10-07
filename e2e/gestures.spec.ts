import { expect, test, type Page } from '@playwright/test';
import { type App, WAVE_MAX, WAVE_MIN, expectOk, launchApp, menuClick, singlePanel, until, waveLevels } from './app';
import { waveRange, type View } from '../src/view';

// Gestures (#89) with synthetic events, as the browser delivers them: trackpad pinch = ctrl+wheel
// (Chromium), two-finger scroll = wheel with fractional pixel deltas, touch = two pointers of
// type 'touch'. Checked against what the scope shows: the trace of grey steps lands on the
// level the zoomed range promises.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

async function bodyBox(page: Page, scope: string) {
  return page.evaluate((scope) => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === scope)!;
    const q = el.querySelector('.body')!.getBoundingClientRect();
    return { x: q.left, y: q.top, w: q.width, h: q.height };
  }, scope);
}

/** Saved view of panel 1 (gestures commit to the persisted state). */
const savedView = (page: Page) => page.evaluate(() => (JSON.parse(localStorage.getItem('lz-scopes.v1') ?? '{}').panels?.[0]?.view ?? null) as View | null);
const chipZoom = (page: Page) => page.evaluate(() => {
  const c = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) => p.getBoundingClientRect().width > 4)!.querySelector<HTMLButtonElement>('.zoomchip')!;
  return c.hidden ? 1 : Number(c.dataset.zoom);
});

async function wheel(page: Page, scope: string, x: number, y: number, init: WheelEventInit, times = 1) {
  await page.evaluate(({ scope, x, y, init, times }) => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === scope)!;
    const body = el.querySelector('.body')!;
    for (let i = 0; i < times; i++) body.dispatchEvent(new WheelEvent('wheel', { clientX: x, clientY: y, bubbles: true, cancelable: true, ...init }));
  }, { scope, x, y, init, times });
}

/** Two touch pointers from (a0, b0) to (a1, b1) in `steps`, as a finger pinch. */
async function touchPinch(page: Page, scope: string, a0: number[], b0: number[], a1: number[], b1: number[], steps = 10) {
  await page.evaluate(({ scope, a0, b0, a1, b1, steps }) => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === scope)!;
    const body = el.querySelector('.body')!;
    const ev = (type: string, id: number, x: number, y: number) => body.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: id === 11, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true,
    }));
    ev('pointerdown', 11, a0[0], a0[1]);
    ev('pointerdown', 12, b0[0], b0[1]);
    for (let i = 1; i <= steps; i++) {
      const f = i / steps, lerp = (p: number[], q: number[]) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
      const [ax, ay] = lerp(a0, a1), [bx, by] = lerp(b0, b1);
      ev('pointermove', 11, ax, ay);
      ev('pointermove', 12, bx, by);
    }
    ev('pointerup', 11, a1[0], a1[1]);
    ev('pointerup', 12, b1[0], b1[1]);
  }, { scope, a0, b0, a1, b1, steps });
}

async function doubleTap(page: Page, scope: string) {
  await page.evaluate((scope) => {
    const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
      p.getBoundingClientRect().width > 4 && (p.querySelector('.phead select') as HTMLSelectElement | null)?.value === scope)!;
    const body = el.querySelector('.body')!, q = body.getBoundingClientRect();
    const x = q.left + q.width / 2, y = q.top + q.height / 2;
    let t = 0;
    for (const type of ['pointerdown', 'pointerup', 'pointerdown', 'pointerup']) {
      // timeStamp comes from the event creation time; the taps follow within a few ms
      body.dispatchEvent(new PointerEvent(type, { pointerId: 21 + (t++ >> 1), pointerType: 'touch', isPrimary: true, clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
    }
  }, scope);
}

test('Waveform: Trackpad-Pinch zoomt in die Schwärzen, Spur liegt auf dem gezoomten Pegel', async () => {
  const { page } = a;
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'steps11' }));
  await singlePanel(a, 'wf-luma');
  const fr = [0.5 / 11, 1.5 / 11, 2.5 / 11];
  await until(async () => {
    const l = await waveLevels(page, 'wf-luma', fr);
    return l.every((v, i) => Math.abs(v - i / 10) < 0.015);
  }, 60_000, 'Graustufen im Waveform');

  const b = await bodyBox(page, 'wf-luma');
  const r = { x: 44, y: 8, w: b.w - 52, h: b.h - 16 };
  const yOf = (level: number) => b.y + r.y + r.h - ((level - WAVE_MIN) / (WAVE_MAX - WAVE_MIN)) * r.h;
  // pinch out around 10 %: Chromium sends ctrl+wheel with small negative deltas
  await wheel(page, 'wf-luma', b.x + b.w / 2, yOf(0.1), { ctrlKey: true, deltaY: -12 }, 12);
  const v = await until(() => savedView(page), 10_000, 'Ansicht gespeichert');
  expect(v.z).toBeGreaterThan(3);
  expect(v.x).toBe(0); // waveforms zoom vertically only
  expect(await chipZoom(page)).toBeCloseTo(v.z, 2);
  const range = waveRange([WAVE_MIN, WAVE_MAX], v);
  // the level under the cursor stayed put
  expect(range[0] + ((r.y + r.h - (yOf(0.1) - b.y)) / r.h) * (range[1] - range[0])).toBeCloseTo(0.1, 2);
  // 0 %, 10 % and 20 % at the zoomed levels; the finer scale must hit them much more exactly
  const tol = 0.015 / v.z + 0.004;
  const lv = await until(async () => {
    const l = await waveLevels(page, 'wf-luma', fr, range);
    return l.every((x, i) => !(i / 10 >= range[0] && i / 10 <= range[1]) || Math.abs(x - i / 10) < tol) ? l : false;
  }, 60_000, 'Spur auf dem gezoomten Pegel').catch(async (e) => { console.log('Bereich', range, 'gemessen', await waveLevels(page, 'wf-luma', fr, range)); throw e; });
  console.log('Zoom', v.z.toFixed(2), 'Bereich', range.map((x) => x.toFixed(3)), 'Pegel', lv);
  if (process.env.LZS_E2E_SHOTS) await page.screenshot({ path: `${process.env.LZS_E2E_SHOTS}/gesture-waveform.png` });

  // two-finger scroll (fractional pixel deltas, no ctrl) pans like scrolling a page: deltaY > 0
  // (fingers up with natural scrolling) moves the content up and shows the lower levels
  await wheel(page, 'wf-luma', b.x + b.w / 2, b.y + b.h / 2, { deltaY: 7.5 }, 8);
  const moved = await until(async () => { const w = await savedView(page); return w && Math.abs(w.y - v.y) > 0.05 ? w : false; }, 10_000, 'geschwenkt');
  expect(moved.z).toBeCloseTo(v.z, 6);
  expect(waveRange([WAVE_MIN, WAVE_MAX], moved)[0]).toBeLessThan(range[0]);

  // double click resets (instead of solo)
  await page.mouse.dblclick(b.x + b.w / 2, b.y + b.h / 2);
  await until(async () => (await savedView(page)) === null, 10_000, 'zurückgesetzt');
  expect(await chipZoom(page)).toBe(1);
});

test('Vectorscope: Zwei-Finger-Pinch zoomt, Doppeltipp setzt zurück', async () => {
  const { page } = a;
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'smpte75' }));
  await singlePanel(a, 'vector');
  const b = await bodyBox(page, 'vector');
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  // fingers 100 px apart → 300 px apart: × 3
  await touchPinch(page, 'vector', [cx - 50, cy], [cx + 50, cy], [cx - 150, cy], [cx + 150, cy]);
  const v = await until(() => savedView(page), 10_000, 'Ansicht gespeichert');
  expect(v.z).toBeCloseTo(3, 1);
  // pinched around the centre: the centre stays (pan ≈ 0)
  expect(Math.abs(v.x)).toBeLessThan(0.02);
  expect(Math.abs(v.y)).toBeLessThan(0.02);
  if (process.env.LZS_E2E_SHOTS) await page.screenshot({ path: `${process.env.LZS_E2E_SHOTS}/gesture-vector.png` });
  // moving both fingers to the right pans (content follows the fingers)
  await touchPinch(page, 'vector', [cx - 100, cy], [cx + 100, cy], [cx - 60, cy], [cx + 140, cy]);
  const p = await until(async () => { const w = await savedView(page); return w && w.x > 0.05 ? w : false; }, 10_000, 'geschwenkt');
  expect(p.z).toBeCloseTo(3, 1);
  await doubleTap(page, 'vector');
  await until(async () => (await savedView(page)) === null, 10_000, 'Doppeltipp setzt zurück');
});

test('Bild: Pinch statt Messpunkt, Schwenken mit mittlerer Taste', async () => {
  const { page } = a;
  await singlePanel(a, 'picture');
  const b = await bodyBox(page, 'picture');
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  // the first finger would start a ROI drag; the second turns it into a pinch – no ROI remains
  await touchPinch(page, 'picture', [cx - 40, cy - 40], [cx + 40, cy + 40], [cx - 120, cy - 120], [cx + 120, cy + 120]);
  const v = await until(() => savedView(page), 10_000, 'Ansicht gespeichert');
  expect(v.z).toBeCloseTo(3, 1);
  const roi = await a.page.evaluate(() => document.querySelector('.roichip')?.textContent ?? '');
  expect(roi).toBe('');
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 60, cy + 30, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  const p = await until(async () => { const w = await savedView(page); return w && Math.abs(w.x - v.x) > 0.02 ? w : false; }, 10_000, 'geschwenkt');
  expect(p.x).toBeGreaterThan(v.x);
  expect(p.y).toBeLessThan(v.y); // screen down = clip down
  if (process.env.LZS_E2E_SHOTS) await page.screenshot({ path: `${process.env.LZS_E2E_SHOTS}/gesture-picture.png` });
  await page.locator('.zoomchip:visible').click();
  await until(async () => (await savedView(page)) === null, 10_000, 'Chip setzt zurück');
});

test('Touch Shading aktiv: Finger gehören der Kamera, Rad/Pinch zoomt weiter', async () => {
  const { page } = a;
  expectOk(await a.control({ cmd: 'layout.preset', preset: 1 }));
  await menuClick(a, 'shading');
  await page.selectOption('[data-shading-target]', 'sim');
  expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope: 'parade' }));
  await page.check('[data-shading-active]');
  const b = await bodyBox(page, 'parade');
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  await touchPinch(page, 'parade', [cx - 30, cy - 40], [cx + 30, cy + 40], [cx - 30, cy - 120], [cx + 30, cy + 120]);
  await page.waitForTimeout(400);
  expect(await savedView(page)).toBeNull();
  await wheel(page, 'parade', cx, cy, { ctrlKey: true, deltaY: -12 }, 6);
  const v = await until(() => savedView(page), 10_000, 'Pinch am Trackpad zoomt');
  expect(v.z).toBeGreaterThan(1.5);
  await page.uncheck('[data-shading-active]');
});
