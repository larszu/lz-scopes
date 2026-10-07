import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, freePort, until } from './app';

// Responsive layout (docs/architecture/ui.md): the main window in headless Chromium at phone,
// tablet, laptop and desktop size, dark and light. No horizontal page scroll, the key controls
// in reach, settings and the panel ⚙ popover usable and inside the viewport, 44 px targets on
// touch. Screenshots land in test-results/responsive/ (also looked at by hand).
// This spec needs no Electron: the bridge serves the built dist, Chromium runs headless.

const SIZES = [[375, 812], [768, 1024], [1280, 800], [1920, 1080]] as const;
const SHOTS = join(ROOT, 'test-results', 'responsive');

let bridge: ChildProcess, base = '', config = '';
test.beforeAll(async () => {
  mkdirSync(SHOTS, { recursive: true });
  config = mkdtempSync(join(tmpdir(), 'lzs-resp-'));
  const port = await freePort();
  bridge = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs'), '--port', String(port), '--config-dir', config], { cwd: ROOT, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}/`;
  await until(async () => { try { return (await fetch(base)).ok; } catch { return false; } }, 30_000, 'Bridge liefert dist aus');
});
test.afterAll(() => { bridge?.kill(); rmSync(config, { recursive: true, force: true }); });

const inViewport = async (page: Page, sel: string) => {
  const r = await page.locator(sel).first().boundingBox();
  const vp = page.viewportSize()!;
  expect(r, sel).not.toBeNull();
  expect(r!.x, `${sel} links`).toBeGreaterThanOrEqual(-1);
  expect(r!.y, `${sel} oben`).toBeGreaterThanOrEqual(-1);
  expect(r!.x + r!.width, `${sel} rechts`).toBeLessThanOrEqual(vp.width + 1);
  expect(r!.y + r!.height, `${sel} unten`).toBeLessThanOrEqual(vp.height + 1);
};
const noHorizontalScroll = async (page: Page) => {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, 'keine waagerechte Scrollleiste').toBeLessThanOrEqual(cw);
};

for (const scheme of ['dark', 'light'] as const) {
  for (const [w, hgt] of SIZES) {
    const touch = w < 1000;
    test(`${w}×${hgt} ${scheme}`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, colorScheme: scheme, hasTouch: touch, isMobile: w < 500, locale: 'en-GB' });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      // appearance "like the system": headless Chromium reports dark unless the context says light
      await page.addInitScript(() => { try { if (!localStorage.getItem('lz-scopes.v1')) localStorage.setItem('lz-scopes.v1', JSON.stringify({ scheme: 'system', panels: [] })); } catch { /* ignore */ } });
      await page.goto(base);
      await expect(page.locator('.panel').first()).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('html')).toHaveAttribute('data-scheme', scheme);
      const tag = `${w}x${hgt}-${scheme}`;
      await page.waitForTimeout(1500);
      await page.screenshot({ path: join(SHOTS, `${tag}-main.png`) });
      await noHorizontalScroll(page);

      // header: settings, freeze, sources toggle always; layout presets directly or in the overflow menu
      for (const sel of ['#settings-btn', '#freeze', '#toggle-side']) { await expect(page.locator(sel)).toBeVisible(); await inViewport(page, sel); }
      if (w <= 1000) {
        await expect(page.locator('#layouts')).toBeHidden();
        await page.locator('#bar-more .pop-trigger').click();
        await expect(page.locator('#bar-more .popover .seg')).toBeVisible();
        await page.waitForTimeout(400); // opening transition (4 px slide)
        await inViewport(page, '#bar-more .popover');
        await page.keyboard.press('Escape');
      } else await expect(page.locator('#layouts .seg')).toBeVisible();
      // phones and narrow windows: the panels as tabs of one group
      if (w <= 640) expect(await page.locator('#dock.compact').count()).toBe(1);
      else expect(await page.locator('#dock.compact').count()).toBe(0);

      // touch: 44 px targets in the header
      if (touch) {
        for (const sel of ['#settings-btn', '#freeze', '#toggle-side']) {
          const b = (await page.locator(sel).boundingBox())!;
          expect(b.height, `${sel} Höhe`).toBeGreaterThanOrEqual(44);
        }
      }

      // panel ⚙ popover: inside the viewport; a bottom sheet on phones
      await page.locator('.panel .pop-trigger').first().click();
      const pop = page.locator('.panel .popover:popover-open');
      await expect(pop).toBeVisible();
      await page.waitForTimeout(400);
      await inViewport(page, '.panel .popover:popover-open');
      if (w <= 640) await expect(pop).toHaveClass(/sheet/);
      await page.screenshot({ path: join(SHOTS, `${tag}-popover.png`) });
      await page.keyboard.press('Escape');
      await expect(pop).toBeHidden();

      // settings window: open, inside the viewport, pages switch, a select is usable
      await page.locator('#settings-btn').click();
      const dlg = page.locator('dialog#settings');
      await expect(dlg).toBeVisible();
      await inViewport(page, 'dialog#settings');
      await dlg.locator('[role=tab]', { hasText: 'Scopes' }).click();
      await expect(dlg.locator('.set-body')).toHaveAttribute('data-page', 'scopes');
      await expect(dlg.locator('.set-body select').first()).toBeVisible();
      await inViewport(page, 'dialog#settings .set-body select');
      await page.screenshot({ path: join(SHOTS, `${tag}-settings.png`) });
      await page.keyboard.press('Escape');
      await expect(dlg).toBeHidden();

      // sources: a drawer over the scopes on narrow windows
      if (w <= 800) {
        await expect(page.locator('#side')).toBeHidden();
        await page.locator('#toggle-side').click();
        await expect(page.locator('#side')).toBeVisible();
        await inViewport(page, '#side');
        await page.screenshot({ path: join(SHOTS, `${tag}-sources.png`) });
      } else await expect(page.locator('#side')).toBeVisible();
      await noHorizontalScroll(page);
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }
}
