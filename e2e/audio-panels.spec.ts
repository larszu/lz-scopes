import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until } from './app';

// Audio panels of #183, #186 and #187 in the app, fed by the tone generator's loop-back
// (no sound card, no microphone): surround star, stereo field, sound level and RTA with a
// snapshot taken in the panel settings.

let a: App;
/** Screenshot as an artefact only: under load the font wait can time out, that is no finding. */
const shot = (name: string) => a.page.screenshot({ path: `test-results/e2e/${name}.png`, timeout: 15_000 }).catch((e: Error) => console.log('screenshot', name, e.message.split('\n')[0]));
test.beforeAll(async () => { a = await launchApp({ lang: 'en' }); });
test.afterAll(async () => { await a?.close(); });

test('surround, stereo field, sound level and RTA draw from the generator', async () => {
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  expectOk(await a.control({ cmd: 'generator', mode: 'on', signal: 'sine', freq: 1000, level: -18 }));
  // "→ as measuring source" in the generator section
  await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>('#gen button')].find((b) => b.textContent?.includes('measuring source'))?.click());
  await until(async () => (await a.state()).sources.some((s) => s.name === 'Generator' && s.status === 'live'), 60_000, 'generator source live');
  await singlePanel(a, 'audio-spl');
  expectOk(await a.control({ cmd: 'source.select', source: 'Generator', panel: 1 }));
  const panel = page.locator('.panel').first();
  const label = () => panel.locator('canvas.overlay').getAttribute('aria-label').then((l) => l ?? '');
  // 1 kHz sine at −18 dBFS peak: LAF −18.0 dB re full scale, LCpeak 3 dB higher
  await expect.poll(label, { timeout: 60_000 }).toMatch(/LAF −18\.0 dBFS\(A\)/);
  // after the onset transient of the C filter has left the 1 s window
  await expect.poll(label, { timeout: 15_000 }).toMatch(/LCpeak 1 s −15\.0 dBFS\(C\)/);
  await shot('audio-spl');

  expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope: 'audio-rta' }));
  await expect.poll(label, { timeout: 30_000 }).toContain('RTA 1/3 octave');
  await page.getByRole('button', { name: 'Settings: Audio RTA' }).first().click();
  const pop = page.locator('.popover.psettings');
  await pop.getByPlaceholder('Snapshot 1').fill('Reference');
  await pop.getByRole('button', { name: 'Take' }).click();
  await expect(pop.getByText('Reference')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect.poll(label, { timeout: 30_000 }).toContain('Reference');
  await shot('audio-rta');

  expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope: 'audio-field' }));
  // the generator sends the same sine on L and R: mono, correlation +1
  await expect.poll(label, { timeout: 30_000 }).toMatch(/Mono [−-]?0\.0 dB; Correlation \+1\.00/);
  await shot('audio-field');

  expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope: 'audio-surround' }));
  await expect.poll(label, { timeout: 30_000 }).toMatch(/L −18\.0 dBFS; R −18\.0 dBFS; L\/R \+1\.00/);
  await shot('audio-surround');
  expect(errors).toEqual([]);
});
