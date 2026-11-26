import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, menuClick, until } from './app';

// Workspaces (#238): saved layouts as tabs above the dock, switching keeps the changes of the
// tab left behind; the share link opens the workspace in another browser (stands in for the
// iPad); ?widget=… shows single scopes without the app around them.

let a: App;
test.afterAll(async () => { await a?.close(); });

const panelsOf = async (x: App) => (await x.state()).panels.map((p) => `${p.panel}:${p.scope}`).sort().join(' ');
const tab = (name: string) => a.page.locator('#ws-tabs [role=tab]', { hasText: name });

test('Arbeitsplätze als Reiter, Link, Widget', async ({ browser }) => {
  a = await launchApp();
  const { page } = a;
  await expect(page.locator('#ws-tabs')).toBeHidden();

  expectOk(await a.control({ cmd: 'layout.preset', preset: '2×2' }));
  expectOk(await a.control({ cmd: 'panel.scope', panel: 2, scope: 'cie' }));
  const studio = await panelsOf(a);

  await menuClick(a, 'layouts');
  await page.locator('#laybody input[placeholder^="Name"]').fill('Studio');
  await page.locator('#laybody button', { hasText: 'Speichern' }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#ws-tabs')).toBeVisible();
  await expect(tab('Studio')).toHaveAttribute('aria-selected', 'true');

  // a second workspace from the current state, then changed
  await page.locator('#ws-tabs .ws-new').click();
  await expect(tab('Arbeitsplatz 1')).toHaveAttribute('aria-selected', 'true');
  expectOk(await a.control({ cmd: 'layout.preset', preset: 1 }));
  expect(await panelsOf(a)).toBe('1:picture');
  await expect(tab('Arbeitsplatz 1')).toHaveAttribute('aria-selected', 'true');

  // switching: each tab comes back as it was left
  await tab('Studio').click();
  await until(async () => (await panelsOf(a)) === studio, 15_000, 'Reiter Studio');
  await tab('Arbeitsplatz 1').click();
  await until(async () => (await panelsOf(a)) === '1:picture', 15_000, 'Reiter Arbeitsplatz 1 mit seiner Änderung');
  await tab('Studio').click();
  await until(async () => (await panelsOf(a)) === studio, 15_000, 'zurück zu Studio');

  // share link of the current workspace
  await page.locator('#ws-tabs .ws-share').click();
  const url = await page.locator('dialog.link-dlg textarea').first().inputValue();
  expect(url).toContain(`127.0.0.1:${a.port}/#ws=Studio~`);
  await page.keyboard.press('Escape');

  // another browser (own storage, like an iPad) opens the link: the workspace arrives as a tab
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'de-DE' });
  try {
    const other = await ctx.newPage();
    other.on('pageerror', (e) => console.log('[other pageerror]', e.message));
    await other.goto(url);
    await expect(other.locator('#ws-tabs [role=tab][aria-selected=true]')).toHaveText('Studio', { timeout: 60_000 });
    await expect(other).not.toHaveURL(/#ws=/);
    await expect(other.locator('.panel')).toHaveCount(4);
    const scopes = await other.evaluate(() => JSON.parse(localStorage.getItem('lz-scopes.layouts') ?? '{}').Studio.panels[1].scope);
    expect(scopes).toBe('cie');

    // widget: two scopes of a test pattern, no main window needed
    const w = await ctx.newPage();
    await w.goto(`${a.base}/?widget=wf-luma,vector,tiles&src=pattern:smpte75-lz`);
    await until(() => w.evaluate(() => (window as unknown as { lzsWidget?: { status: () => string } }).lzsWidget?.status() === 'live'), 30_000, 'Widget-Testbild läuft');
    await expect(w.locator('.lzs-panel')).toHaveCount(2);
    // the graticule is drawn into the overlay canvas once the panel has its size
    await until(() => w.evaluate(() => [...document.querySelectorAll<HTMLCanvasElement>('.lzs-body canvas')].every((c) => {
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
      return false;
    })), 30_000, 'Widget zeichnet');
  } finally { await ctx.close(); }
});
