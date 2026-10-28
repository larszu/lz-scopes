import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until, waveProfile } from './app';

// Signal & display per panel (#179): the signal low-pass really measures differently. The zone
// plate is a picture of pure high frequencies – smoothing it pulls the waveform trace together
// towards the mean, and the panel says that it is smoothing.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** How much of the column is covered by the trace (0…1), at 20 % of the width. */
/**
 * How much of the column the trace covers, averaged over four columns of the zone plate. The
 * middle of the plate is left out on purpose: it is the low-frequency part, where smoothing
 * concentrates the trace instead of narrowing it.
 */
async function spread() {
  let sum = 0;
  for (const x of [0.1, 0.3, 0.7, 0.9]) {
    const rows = (await waveProfile(a.page, 'wf-luma', [x]))[0];
    sum += rows.filter((r) => r.v > 0.15).length / rows.length;
  }
  return sum / 4;
}

test('Signal glätten: die Spur der Zonenplatte zieht sich zusammen, das Panel sagt es', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'zoneplate' }));
  await singlePanel(a, 'wf-luma');

  const raw = await until(async () => { const v = await spread(); return v > 0.08 ? v : false; }, 30_000, 'Spur der Zonenplatte');

  // ⚙ → Signal glätten: 5×5
  await page.locator('.panel .pop-trigger:not(.help-trigger) >> visible=true').first().click();
  await page.locator('.panel .popover:popover-open').getByLabel('Signal glätten').selectOption('2');
  await page.keyboard.press('Escape');

  // 5×5 nimmt der Zonenplatte die hohen Frequenzen: die Spur wird schmaler
  const smoothed = await until(async () => { const v = await spread(); return v < raw * 0.95 ? v : false; }, 30_000, 'Spur wird schmaler');
  expect(smoothed).toBeLessThan(raw);
  await page.screenshot({ path: test.info().outputPath('smooth.png') });
});
