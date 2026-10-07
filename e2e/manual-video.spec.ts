import { expect, test } from '@playwright/test';
import { launchApp, menuClick, until } from './app';

// MANUAL ONLY (network, 65 MB): LZS_MANUAL=1 npx playwright test -c e2e/playwright.config.ts e2e/manual-video.spec.ts
test.skip(!process.env.LZS_MANUAL, 'nur von Hand');
test.setTimeout(600_000);

test('Testvideo laden, prüfen, öffnen', async () => {
  const a = await launchApp();
  const { page } = a;
  await menuClick(a, 'testvideos');
  const row = page.locator('tr[data-video="bbb-180p"]');
  await row.locator('button', { hasText: 'Laden' }).click();
  await expect(row.locator('button', { hasText: 'Öffnen' })).toBeVisible({ timeout: 500_000 });
  await page.screenshot({ path: process.env.SHOT_DIR + '/tv-dialog.png' });
  await row.locator('button', { hasText: 'Öffnen' }).click();
  const st = await until(async () => { const s = await a.state(); return s.sources.find((x) => x.kind === 'file' && x.status === 'live') ? s : false; }, 60_000, 'Video live');
  console.log(JSON.stringify(st.sources));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: process.env.SHOT_DIR + '/tv-playing.png' });
  await a.close();
});
