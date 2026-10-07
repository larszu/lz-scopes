import { expect, test } from '@playwright/test';
import { type App, launchApp, menuClick, until } from './app';

// Application menu (#53): the desktop app shows the native menu built from the page's model;
// the in-page menu bar is hidden there. Menu items run their commands, checkmarks follow the
// state, and the global settings live in one settings window.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

const menuLabels = () => a.app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.map((i) => i.label) ?? []);
const checked = (id: string) => a.app.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.checked ?? null, id);

test('Native Menüleiste in der Standard-Reihenfolge', async () => {
  const labels = await until(async () => { const l = await menuLabels(); return l.includes('Hilfe') ? l : false; }, 30_000, 'Menü gesetzt');
  const ours = labels.filter((l) => ['Datei', 'Bearbeiten', 'Ansicht', 'Quellen', 'Scopes', 'Ausgabe', 'Fenster', 'Hilfe'].includes(l));
  expect(ours).toEqual(['Datei', 'Bearbeiten', 'Ansicht', 'Quellen', 'Scopes', 'Ausgabe', 'Fenster', 'Hilfe']);
  if (process.platform === 'darwin') expect(labels[0]).not.toBe('Datei'); // app menu first
  await expect(a.page.locator('#menubar')).toBeHidden();
  // header: no stray tool buttons any more, settings reachable
  await expect(a.page.locator('#settings-btn')).toBeVisible();
  await expect(a.page.locator('header #led, header #snap, header #laymenu, header #outmenu')).toHaveCount(0);
});

test('Einstellungen-Fenster mit allen Rubriken', async () => {
  await menuClick(a, 'settings');
  const dlg = a.page.locator('dialog#settings');
  await expect(dlg).toBeVisible();
  const tabs = await dlg.locator('[role=tab]').allTextContents();
  for (const t of ['Oberfläche', 'Display', 'Scopes', 'Messpunkt / CST', 'Latenz', 'Uhr / Timecode', 'Bridge / ffmpeg', 'Audio', 'Tastatur', 'Über / Lizenzen']) expect(tabs).toContain(t);
  await dlg.locator('[role=tab]', { hasText: 'Tastatur' }).click();
  await expect(dlg.locator('table.keys')).toContainText('Layout-Vorlage');
  // Escape closes; keys typed inside do not reach the global shortcuts
  await a.page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  // Help → Tastenkürzel opens the same window on that page
  await menuClick(a, 'settings:keys');
  await expect(dlg.locator('.set-body')).toHaveAttribute('data-page', 'keys');
  await a.page.keyboard.press('Escape');
});

test('Menübefehle und Häkchen folgen dem Zustand', async () => {
  const { page } = a;
  await menuClick(a, 'theme:lzm');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'lzm');
  await until(async () => (await checked('theme:lzm')) === true, 10_000, 'Häkchen Oberfläche');

  expect(await checked('sidebar')).toBe(true);
  await menuClick(a, 'sidebar');
  await expect(page.locator('#side')).toBeHidden();
  await until(async () => (await checked('sidebar')) === false, 10_000, 'Häkchen Seitenleiste');
  // (header button; a key press depends on window focus after the native menu, flaky on CI)
  await page.locator('#toggle-side').click();
  await expect(page.locator('#side')).toBeVisible();

  await menuClick(a, 'freeze');
  await expect(page.locator('#freeze')).toHaveClass(/on/);
  await until(async () => (await checked('freeze')) === true, 10_000, 'Häkchen Einfrieren');
  await menuClick(a, 'freeze');

  const before = (await a.state()).panels.length;
  await menuClick(a, 'scope:hist');
  await until(async () => (await a.state()).panels.length === before + 1, 10_000, 'Panel über das Scopes-Menü');

  await menuClick(a, 'output');
  await expect(page.locator('dialog#outmenu')).toBeVisible();
  await expect(page.locator('#outbody')).toContainText('Ausgabe öffnen');
  await page.keyboard.press('Escape');
});
