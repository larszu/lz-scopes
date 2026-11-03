import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { type App, ROOT, launchApp } from './app';

// DeckLink… without a usable device opens the setup steps (src/decklinkSetup.ts). The helper is a
// stand-in that reports Desktop Video installed but no device, as on a Mac whose driver extension
// waits for approval. The real device path is checked by hand: scripts/decklink/probe.mjs (#116).

let a: App;
test.skip(process.platform === 'win32', 'shell stand-in for the helper');
test.beforeAll(async () => { a = await launchApp({ lang: 'de', env: { LZS_DECKLINK_HELPER: join(ROOT, 'test/fixtures/fake-decklink-nodevice.sh') } }); });
test.afterAll(async () => { await a?.close(); });

test('DeckLink… ohne Gerät: Einrichtungsschritte mit Haken, Erneut prüfen', async () => {
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.locator('#add button', { hasText: 'RTSP / Netz' }).click();
  await page.locator('#source-list .src').last().getByRole('button', { name: 'DeckLink…' }).click();
  const dlg = page.locator('dialog.dlsetup');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.modal-title')).toHaveText('Blackmagic DeckLink / UltraStudio einrichten');
  // helper and driver are there: both ticked, exactly one next step. On macOS the bridge reads the
  // real driver-extension state of this machine, so "allow the driver" may already be ticked too.
  await expect(dlg.locator('li.dlsetup-next')).toHaveCount(1);
  await expect(dlg.locator('li.dlsetup-done').nth(1)).toContainText('Desktop Video installieren');
  await expect(dlg.locator('li.dlsetup-next')).toContainText(/Treiber erlauben|Gerät anschließen/);
  await dlg.getByRole('button', { name: 'Erneut prüfen' }).click();
  await expect(dlg).toBeVisible();
  await page.screenshot({ path: join(ROOT, 'test-results/e2e/decklink-setup.png') });
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
  expect(errors).toEqual([]);
});

// With a real device (hand-run, #116): LZS_E2E_DECKLINK=1 npx playwright test -c e2e/playwright.config.ts decklink
test.describe('real DeckLink device', () => {
  test.skip(!process.env.LZS_E2E_DECKLINK, 'needs a DeckLink/UltraStudio with a signal on SDI');
  let r: App;
  test.beforeAll(async () => { r = await launchApp({ lang: 'de' }); });
  test.afterAll(async () => { await r?.close(); });
  test('DeckLink… connects the only device, SDI/HDMI choice on the card', async () => {
    const { page } = r;
    await page.locator('#add button', { hasText: 'RTSP / Netz' }).click();
    const card = page.locator('#source-list .src').last();
    await card.getByRole('button', { name: 'DeckLink…' }).click();
    await expect.poll(async () => (await r.state()).sources.at(-1)?.status, { timeout: 30_000 }).toBe('live');
    await expect(card).toContainText('1920×1080');
    const input = card.locator('select', { has: page.locator('option', { hasText: 'HDMI' }) });
    await expect(input).toBeVisible();
    await page.screenshot({ path: join(ROOT, 'test-results/e2e/decklink-live.png') });
  });
});
