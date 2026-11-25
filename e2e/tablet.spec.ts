import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, freePort, until } from './app';

// Tablet layout (#185) in headless Chromium with touch, portrait and landscape: the layout
// preset 1+3, the panel ⚙ settings as a sheet over their panel, a long press (real touch events
// through CDP, so the popover's light dismiss runs as on a device) opens them, a short tap does
// not, 44 px panel-head targets. Screenshots in test-results/tablet/. No Electron.

const SIZES = [[768, 1024], [1024, 768]] as const;
const SHOTS = join(ROOT, 'test-results', 'tablet');

let bridge: ChildProcess, base = '', config = '';
test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  config = mkdtempSync(join(tmpdir(), 'lzs-tab-'));
  const port = await freePort();
  bridge = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs'), '--port', String(port), '--config-dir', config], { cwd: ROOT, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}/`;
  await until(async () => { try { return (await fetch(base)).ok; } catch { return false; } }, 30_000, 'Bridge liefert dist aus');
});
test.afterAll(() => { bridge?.kill(); rmSync(config, { recursive: true, force: true }); });

/** Centre of the body of the panel showing `scope`. */
const bodyCentre = (page: Page, scope: string) => page.evaluate((scope) => {
  const el = [...document.querySelectorAll<HTMLElement>('.panel')].find((p) =>
    p.getBoundingClientRect().width > 4 && ((document.querySelector(`.phead[data-panel="${p.dataset.panel}"] select`) ?? p.querySelector('.phead select')) as HTMLSelectElement | null)?.value.split(':')[0] === scope)!;
  const b = el.querySelector('.body')!.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
}, scope);

for (const [w, hgt] of SIZES) {
  test(`${w}×${hgt} touch`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, hasTouch: true, colorScheme: 'dark', locale: 'en-GB' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => { try { if (!localStorage.getItem('lz-scopes.v1')) localStorage.setItem('lz-scopes.v1', JSON.stringify({ panels: [] })); } catch { /* ignore */ } });
    await page.goto(base);
    await expect(page.locator('.panel').first()).toBeVisible({ timeout: 60_000 });
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'Touch-Zeiger').toBe(true);

    // touch up to 1400 px: the presets sit in the overflow menu, the header stays one row
    await expect(page.locator('#layouts')).toBeHidden();
    expect((await page.locator('header, .bar').first().boundingBox())!.height, 'Kopfleiste einzeilig').toBeLessThan(80);
    await page.locator('#bar-more .pop-trigger').click();
    await page.locator('#bar-more .popover .seg button', { hasText: '1+3' }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    const boxes = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.panel')]
      .filter((p) => p.getBoundingClientRect().width > 4)
      .map((p) => { const r = p.getBoundingClientRect(); return { scope: (p.querySelector('.phead select') as HTMLSelectElement).value.split(':')[0], x: r.left, y: r.top, w: r.width, h: r.height }; }));
    expect(boxes.length, 'vier Panels').toBe(4);
    const big = boxes.find((b) => b.scope === 'wf-luma')!;
    for (const b of boxes.filter((b) => b !== big)) {
      expect(b.y, `${b.scope} unter dem Waveform`).toBeGreaterThan(big.y + big.h - 2);
      expect(b.w * b.h, `${b.scope} kleiner`).toBeLessThan(big.w * big.h);
    }
    await page.screenshot({ path: join(SHOTS, `${w}x${hgt}-1plus3.png`) });

    // panel heads: 44 px targets
    for (const b of await page.locator('.panel .phead button.icon').all()) {
      if (!(await b.isVisible())) continue;
      const r = (await b.boundingBox())!;
      expect(r.height, 'Kopf-Taste Höhe').toBeGreaterThanOrEqual(44);
      expect(r.width, 'Kopf-Taste Breite').toBeGreaterThanOrEqual(44);
    }

    // ⚙ as a sheet over its panel
    const wave = page.locator('.panel', { has: page.locator('.phead select option:checked[value^="wf-luma"]') }).first();
    await wave.locator('.pop-trigger:not(.help-trigger)').first().click();
    const pop = page.locator('.panel .popover.psettings:popover-open');
    await expect(pop).toBeVisible();
    await expect(pop).toHaveClass(/\bover\b/);
    await page.waitForTimeout(400);
    const pr = (await pop.boundingBox())!, wr = (await wave.boundingBox())!;
    expect(pr.x).toBeGreaterThanOrEqual(wr.x - 1);
    expect(pr.x + pr.width).toBeLessThanOrEqual(wr.x + wr.width + 1);
    expect(pr.y + pr.height).toBeLessThanOrEqual(Math.min(wr.y + wr.height, hgt) + 1);
    expect(pr.y).toBeGreaterThanOrEqual(-1);
    await page.screenshot({ path: join(SHOTS, `${w}x${hgt}-sheet.png`) });
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();

    // long press with real touch events opens it, a short tap does not
    const cdp = await ctx.newCDPSession(page);
    const touch = async (scope: string, ms: number) => {
      const c = await bodyCentre(page, scope);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: c.x, y: c.y }] });
      await page.waitForTimeout(ms);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(300);
    };
    await touch('vector', 120);
    await expect(page.locator('.panel .popover.psettings:popover-open')).toHaveCount(0);
    await touch('vector', 800);
    const open = page.locator('.panel .popover.psettings:popover-open');
    // (a short panel gets the anchored popover instead of a sheet: placeOver() in src/ui/popover.ts)
    await expect(open).toBeVisible();
    expect(await open.locator('.popover-head').textContent()).toMatch(/vector/i);
    await page.screenshot({ path: join(SHOTS, `${w}x${hgt}-longpress.png`) });
    await page.keyboard.press('Escape');

    expect(errors).toEqual([]);
    await ctx.close();
  });
}
