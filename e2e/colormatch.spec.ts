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

test('Kamera-Farbabgleich: Karte importieren, exportieren, entfernen; VISCA in der Desktop-App', async () => {
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const dlg = page.locator('dialog.colormatch');
  if (!(await dlg.isVisible())) await menuClick(a, 'colormatch');
  await expect(dlg).toBeVisible();

  // made-up grey ramp, no values from other software
  const chart = {
    id: 'e2e-ramp', name: 'E2E-Graukeil', aspect: 3,
    fields: [0.9, 0.3, 0.04].map((Y, i) => ({ name: `f${i}`, kind: i === 0 ? 'white' : i === 2 ? 'black' : 'gray', x: i / 3 + 0.03, y: 0.1, w: 0.27, h: 0.8, value: { Y } })),
  };
  const pick = async (body: object, name: string) => {
    const chooser = page.waitForEvent('filechooser');
    await dlg.getByRole('button', { name: 'Karte importieren …' }).click();
    await (await chooser).setFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(body)) });
  };
  await pick({ ...chart, aspect: -1 }, 'kaputt.json');
  await expect(dlg.getByText(/kaputt\.json nicht importiert: aspect/)).toBeVisible();
  await pick(chart, 'keil.json');
  await expect(dlg.getByText('Karte „E2E-Graukeil“ importiert (3 Felder)', { exact: false })).toBeVisible();
  const chartSel = dlg.getByRole('combobox', { name: 'Farbtafel' });
  await expect(chartSel).toHaveValue('user:e2e-ramp');

  await dlg.getByRole('button', { name: 'Farben holen' }).click();
  await expect(dlg.getByText('Referenz eingelesen: 3 Felder')).toBeVisible();
  await expect(dlg.locator('.cm-field')).toHaveCount(3);

  // the desktop app would open a save dialog: catch the download link instead
  await page.evaluate(() => {
    const w = window as unknown as { __dl?: Promise<{ name: string; text: string }> };
    const orig = HTMLAnchorElement.prototype.click;
    w.__dl = new Promise((ok) => {
      HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
        if (!this.download) return orig.call(this);
        HTMLAnchorElement.prototype.click = orig;
        void fetch(this.href).then((r) => r.text()).then((text) => ok({ name: this.download, text }));
      };
    });
  });
  await dlg.getByRole('button', { name: 'Karte exportieren' }).click();
  const out = await page.evaluate(() => (window as unknown as { __dl: Promise<{ name: string; text: string }> }).__dl);
  expect(out.name).toBe('e2e-ramp.json');
  expect(JSON.parse(out.text)).toMatchObject({ id: 'e2e-ramp', name: 'E2E-Graukeil', aspect: 3 });

  // VISCA over IP: offered here because the desktop app has the UDP transport
  expect(await page.evaluate(() => typeof (window as unknown as { lzsDesktop?: { visca?: unknown } }).lzsDesktop?.visca)).toBe('object');
  const target = dlg.locator('.cm-target').first();
  const srcSel = target.locator('select').first();
  const second = await srcSel.locator('option').nth(1).getAttribute('value').catch(() => null);
  if (second) {
    await srcSel.selectOption(second);
    await expect(target.locator('option[value="visca"]')).toHaveCount(1);
    await target.locator('select').nth(1).selectOption('visca');
    await expect(target.getByPlaceholder(/52381/)).toBeVisible();
  }

  await dlg.getByRole('button', { name: 'Karte entfernen' }).click();
  await expect(dlg.getByText('Karte „E2E-Graukeil“ entfernt.')).toBeVisible();
  await expect(chartSel).toHaveValue('classic24');
  expect(errors).toEqual([]);
});
