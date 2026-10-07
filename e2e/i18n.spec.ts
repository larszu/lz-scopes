import { expect, test } from '@playwright/test';
import { type App, launchApp, menuClick } from './app';

// UI language (#94): started with an English locale, the app shows English; the choice in
// Settings → Interface overrides the locale and survives a restart.

let a: App;
test.beforeAll(async () => { a = await launchApp({ lang: 'en' }); });
test.afterAll(async () => { await a?.close(); });

test('English locale: English settings window', async () => {
  await expect(a.page.locator('html')).toHaveAttribute('lang', 'en');
  await menuClick(a, 'settings');
  const dlg = a.page.locator('dialog#settings');
  await expect(dlg.locator('.set-head h2')).toHaveText('Settings');
  await a.page.keyboard.press('Escape');
});
