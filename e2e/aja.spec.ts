import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { type App, ROOT, launchApp } from './app';

// AJA cards through the AJA helper (helpers/aja). Both paths with stand-ins for the helper: no card
// (setup steps) and one card with a live signal. Not checked with a real card yet.
test.skip(process.platform === 'win32', 'shell stand-in for the helper');

test.describe('AJA without a card', () => {
  let a: App;
  test.beforeAll(async () => { a = await launchApp({ lang: 'de', env: { LZS_AJA_HELPER: join(ROOT, 'test/fixtures/fake-aja-nodevice.sh') } }); });
  test.afterAll(async () => { await a?.close(); });
  test('AJA… ohne Karte: Einrichtungsschritte, Treiber als nächster Schritt', async () => {
    const { page } = a;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('#add button', { hasText: 'RTSP / Netz' }).click();
    await page.locator('#source-list .src').last().getByRole('button', { name: 'AJA…' }).click();
    const dlg = page.locator('dialog.dlsetup');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('.modal-title')).toHaveText('AJA-Karte einrichten');
    await expect(dlg.locator('li.dlsetup-done')).toHaveCount(1);
    // the driver step depends on the bridge's OS: AJA Desktop Software (macOS/Windows), kernel module (Linux)
    await expect(dlg.locator('li.dlsetup-next')).toContainText(process.platform === 'linux' ? 'AJA-Kerneltreiber bauen und laden' : 'AJA Desktop Software installieren');
    await dlg.getByRole('button', { name: 'Erneut prüfen' }).click();
    await expect(dlg).toBeVisible();
    await page.screenshot({ path: join(ROOT, 'test-results/e2e/aja-setup.png') });
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('AJA card live', () => {
  let r: App;
  test.beforeAll(async () => { r = await launchApp({ lang: 'de', env: { LZS_AJA_HELPER: join(ROOT, 'test/fixtures/fake-aja-live.sh') } }); });
  test.afterAll(async () => { await r?.close(); });
  test('+ Quelle → AJA verbindet die einzige Karte: 10 bit, Ton, Eingangswahl mit erkanntem Format', async () => {
    const { page } = r;
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.locator('#add button', { hasText: /^AJA$/ }).click();
    await expect.poll(async () => (await r.state()).sources.find((x) => x.kind === 'stream')?.status, { timeout: 30_000 }).toBe('live');
    const current = () => page.evaluate(() => {
      const w = window as unknown as { lzs: { sources: () => { id: string; name: string }[]; source: (id: string) => { url: string; settings: { depth: number; ajaInput?: string } } | null } };
      const x = w.lzs.source(w.lzs.sources().find((s) => s.name === 'Fake KONA 5')?.id ?? '');
      return { url: x?.url, depth: x?.settings.depth, input: x?.settings.ajaInput ?? null };
    });
    expect(await current()).toEqual({ url: 'aja:0', depth: 16, input: null });
    // the test pattern closes by itself, every panel shows the card
    await expect.poll(async () => (await r.state()).sources.map((x) => x.kind), { timeout: 10_000 }).toEqual(['stream']);
    const card = page.locator('#source-list .src').first();
    await expect(card).toContainText('1920×1080');
    await expect(card).toContainText('48 kHz');
    await expect(card.locator('select', { has: page.locator('option', { hasText: 'AJA 8 bit' }) })).toHaveValue('10');
    const input = card.locator('select', { has: page.locator('option', { hasText: 'SDI 2' }) });
    await expect(input).toBeVisible();
    await expect(input.locator('option', { hasText: 'SDI 1 · 1080p25' })).toHaveCount(2); // "Erster Eingang (SDI 1 · 1080p25)" and "SDI 1 · 1080p25"
    // choosing an input reconnects with input=sdi2
    await input.selectOption('sdi2');
    expect((await current()).input).toBe('sdi2');
    await expect.poll(async () => (await r.state()).sources.find((x) => x.kind === 'stream')?.status, { timeout: 30_000 }).toBe('live');
    expect(errors).toEqual([]);
  });
});
