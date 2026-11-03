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

// Live device: by default a stand-in helper with 1080p25, 16-channel sound, timecode and real VANC
// (test/fixtures/fake-decklink-live.mjs); with LZS_E2E_DECKLINK=1 the real card (hand-run, #116):
//   LZS_E2E_DECKLINK=1 npx playwright test -c e2e/playwright.config.ts decklink
test.describe('DeckLink device live', () => {
  const real = !!process.env.LZS_E2E_DECKLINK;
  let r: App;
  test.beforeAll(async () => { r = await launchApp({ lang: 'de', env: real ? {} : { LZS_DECKLINK_HELPER: join(ROOT, 'test/fixtures/fake-decklink-live.sh') } }); });
  test.afterAll(async () => { await r?.close(); });
  test('DeckLink… connects the only device: 10 bit, sound, test pattern closed, page stays responsive', async () => {
    const { page } = r;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    expect((await r.state()).sources.some((x) => x.kind === 'pattern')).toBe(true);
    // straight from "+ Quelle", without the stream card
    await page.locator('#add button', { hasText: 'Blackmagic DeckLink' }).click();
    await expect.poll(async () => (await r.state()).sources.find((x) => x.kind === 'stream')?.status, { timeout: 30_000 }).toBe('live');
    // the test pattern closes by itself, every panel shows the device
    await expect.poll(async () => (await r.state()).sources.map((x) => x.kind), { timeout: 10_000 }).toEqual(['stream']);
    const card = page.locator('#source-list .src').first();
    await expect(card).toContainText('1920×1080');
    await expect(card).toContainText('48 kHz');
    // 10 bit by default, adjustable on the card
    await expect(card.locator('select', { has: page.locator('option', { hasText: 'DeckLink 8 bit' }) })).toHaveValue('10');
    await expect(card.locator('select', { has: page.locator('option', { hasText: 'HDMI' }) })).toBeVisible();
    // the page keeps answering while picture and 16 channels of sound arrive
    const probe = () => page.evaluate(() => {
      const w = window as unknown as { lzs: { sources: () => { id: string }[]; source: (id: string) => { audio: { channels: number } | null; settings: { depth: number } } | null } };
      const x = w.lzs.source(w.lzs.sources()[0].id);
      return { channels: x?.audio?.channels ?? 0, depth: x?.settings.depth };
    });
    for (let i = 0; i < 5; i++) {
      const t = Date.now();
      expect(await probe()).toEqual({ channels: 16, depth: 16 });
      expect(Date.now() - t).toBeLessThan(1000);
      await page.waitForTimeout(500);
    }
    await page.screenshot({ path: join(ROOT, 'test-results/e2e/decklink-live.png') });
    expect(errors).toEqual([]);
  });
});
