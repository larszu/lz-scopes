import { expect, test } from '@playwright/test';
import { type App, launchApp, menuClick } from './app';

// Camera colour match (src/colormatch): the dialog end to end with the simulated target camera
// against the chart's reference values. The loop itself is tested in test/colormatch-tool.test.ts.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

test('Kamera-Farbabgleich: Referenz einlesen, Simulator abgleichen, Vorher/Nachher', async () => {
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await menuClick(a, 'colormatch');
  const dlg = page.locator('dialog.colormatch');
  await expect(dlg).toBeVisible();

  await dlg.getByRole('button', { name: 'Abgleichen' }).click();
  await expect(dlg.getByText('Erst die Referenz einlesen.')).toBeVisible();

  await dlg.getByRole('button', { name: 'Farben holen' }).click();
  await expect(dlg.getByText('Referenz eingelesen: 24 Felder')).toBeVisible();

  await dlg.getByRole('button', { name: 'Abgleichen' }).click();
  await expect(dlg.getByText(/Fertig: ΔE00 Mittel/)).toBeVisible({ timeout: 120_000 });
  const text = (await dlg.getByText(/Fertig: ΔE00 Mittel/).textContent())!;
  const [from, to] = text.match(/Mittel ([\d,]+) → ([\d,]+)/)!.slice(1).map((v) => Number(v.replace(',', '.')));
  expect(to).toBeLessThan(from);
  expect(to).toBeLessThan(1);
  await expect(dlg.locator('.cm-field')).toHaveCount(24);
  await dlg.getByRole('button', { name: 'Vorher' }).click();
  await expect(dlg.getByRole('button', { name: 'Vorher' })).toHaveAttribute('aria-pressed', 'true');
  if (process.env.CM_SHOT) await dlg.screenshot({ path: process.env.CM_SHOT });
  expect(errors).toEqual([]);
});
