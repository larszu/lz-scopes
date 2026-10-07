import { expect, test } from '@playwright/test';
import { type App, launchApp, menuClick, until } from './app';

// UI language (#94): started with an English locale, the app shows English (header, native menu,
// settings); the choice in Settings → Interface overrides the locale and reloads the window.

let a: App;
test.beforeAll(async () => { a = await launchApp({ lang: 'en' }); });
test.afterAll(async () => { await a?.close(); });

const menuLabels = () => a.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? []);

test('English locale: header, menu and settings in English', async () => {
  const { page } = a;
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  // header
  await expect(page.locator('#freeze')).toHaveText(/Freeze/);
  await expect(page.locator('#settings-btn')).toHaveAttribute('aria-label', 'Settings');
  await expect(page.locator('#side h2')).toHaveText('Sources');
  // native menu
  const labels = await until(async () => { const l = await menuLabels(); return l.includes('Help') ? l : false; }, 30_000, 'menu set');
  expect(labels.filter((l) => ['File', 'Edit', 'View', 'Sources', 'Scopes', 'Output', 'Window', 'Help'].includes(l)))
    .toEqual(['File', 'Edit', 'View', 'Sources', 'Scopes', 'Output', 'Window', 'Help']);
  // settings window
  await menuClick(a, 'settings');
  const dlg = page.locator('dialog#settings');
  await expect(dlg.locator('.set-head h2')).toHaveText('Settings');
  const tabs = await dlg.locator('.set-tab').allTextContents();
  for (const t of ['Interface', 'Display', 'Scopes', 'Latency', 'Keyboard']) expect(tabs).toContain(t);
});

test('Language setting overrides the locale and reloads', async () => {
  const { page } = a;
  const dlg = page.locator('dialog#settings');
  if (!(await dlg.isVisible())) await menuClick(a, 'settings');
  await dlg.locator('.set-tab', { hasText: 'Interface' }).click();
  await dlg.locator('.set-body select').first().selectOption('de');
  // the window reloads in German and reopens the settings on the same page
  await expect(page.locator('html')).toHaveAttribute('lang', 'de', { timeout: 60_000 });
  await expect(page.locator('#side h2')).toHaveText('Quellen', { timeout: 60_000 });
  await expect(page.locator('dialog#settings .set-head h2')).toHaveText('Einstellungen', { timeout: 30_000 });
  await until(async () => (await menuLabels()).includes('Hilfe'), 30_000, 'Menü deutsch');
  // back to automatic (English locale)
  await page.locator('dialog#settings .set-body select').first().selectOption('auto');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en', { timeout: 60_000 });
  await expect(page.locator('#side h2')).toHaveText('Sources', { timeout: 60_000 });
});
