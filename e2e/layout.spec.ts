import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, menuClick, until } from './app';

// Dock layout: save a configuration in the layouts dialog (Datei → Layouts …), change everything, load it
// back (menu and control API), and the dock survives a restart (localStorage).

let a: App;
test.afterAll(async () => { await a?.close(); });

const panelsOf = async (x: App) => (await x.state()).panels.map((p) => `${p.panel}:${p.scope}`).sort().join(" ");
// (sorted: after fromJSON dockview lists the panels in its own order)

test('Layout speichern, ändern, laden, Neustart', async () => {
  a = await launchApp();
  const { page } = a;
  expectOk(await a.control({ cmd: 'layout.preset', preset: '2×2' }));
  expectOk(await a.control({ cmd: 'panel.scope', panel: 2, scope: 'cie' }));
  expectOk(await a.control({ cmd: 'panel.scope', panel: 4, scope: 'stats' }));
  const saved = await panelsOf(a);
  expect(saved).toBe('1:picture 2:cie 3:vector 4:stats');

  await menuClick(a, 'layouts');
  await page.locator('#laybody input[placeholder^="Name"]').fill('E2E Studio');
  await page.locator('#laybody button', { hasText: 'Speichern' }).click();
  await expect(page.locator('#laybody button.lname', { hasText: 'E2E Studio' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#laymenu')).not.toBeVisible();

  // change layout and scopes
  expectOk(await a.control({ cmd: 'layout.preset', preset: 'Colorist' }));
  expectOk(await a.control({ cmd: 'panel.scope', panel: 2, scope: 'hist' }));
  expect(await panelsOf(a)).not.toBe(saved);

  // load in the menu
  await menuClick(a, 'layouts');
  await page.locator('#laybody button.lname', { hasText: 'E2E Studio' }).click();
  await expect(page.locator('#laymenu')).not.toBeVisible();
  await until(async () => (await panelsOf(a)) === saved, 15_000, 'Layout aus dem Menü geladen').catch(async (e) => { console.log('ist', await panelsOf(a)); throw e; });
  expect((await a.state()).layoutName).toBe('E2E Studio');

  // load over the control API after another change
  expectOk(await a.control({ cmd: 'layout.preset', preset: 1 }));
  expect(await panelsOf(a)).toBe('1:picture');
  expectOk(await a.control({ cmd: 'layout.load', name: 'e2e studio' }));
  expect(await panelsOf(a)).toBe(saved);

  // the dock is saved 300 ms after a change; restart with the same profile
  await page.waitForTimeout(1000);
  const { profile, port } = a;
  await a.close(true);
  a = await launchApp({ profile, port });
  expect(await panelsOf(a)).toBe(saved);
  expect((await a.state()).layouts).toContain('E2E Studio');
});
