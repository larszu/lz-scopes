import { expect, test } from '@playwright/test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type App, launchApp, until } from './app';

// Light measurement as a source (#184): a measurement (here from a spectrum file, no meter on
// the test machine) becomes the target with ★; the light meter shows it, and the control API
// hands it to other tools as state.light.target.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

test('Lichtmessung: Punkt als Ziel, Ziel in der Steuer-Schnittstelle', async () => {
  const { page } = a;
  // equal-energy spectrum 380–780 nm: x = y ≈ 1/3
  const dir = mkdtempSync(join(tmpdir(), 'lzs-light-'));
  const file = join(dir, 'gleich.csv');
  writeFileSync(file, Array.from({ length: 81 }, (_, i) => `${380 + i * 5},1`).join('\n'));
  if (!await page.locator('#side').isVisible()) await page.locator('#toggle-side').click();
  const lm = page.locator('#opple-wrap > summary');
  await lm.scrollIntoViewIfNeeded(); await lm.click();
  await page.locator('#opple details.hint > summary').click();
  await page.locator('#opple input[type=file]').setInputFiles(file);
  const star = page.locator('#opple table button[aria-label="Als Ziel merken"]').first();
  await expect(star).toBeVisible();
  await star.click();
  await expect(page.locator('#opple .cmp b', { hasText: 'Ziel: gleich' })).toBeVisible();
  const st = await until(async () => {
    const s = (await a.state()) as unknown as { light?: { target: { schema: string; label: string; x: number; y: number } | null } };
    return s.light?.target ? s.light : false;
  }, 10_000, 'Ziel in state.light');
  expect(st.target!.schema).toBe('lz-scopes.light-target/1');
  expect(st.target!.label).toBe('gleich');
  expect(st.target!.x).toBeCloseTo(1 / 3, 2);
  expect(st.target!.y).toBeCloseTo(1 / 3, 2);
});
