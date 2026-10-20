import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel } from './app';

// SDI signal info panel (src/sdiPanel.ts, #160). No DeckLink here: a VANC record in the shape the
// bridge forwards is put on the panel's source, as if it had arrived over the frame socket.

let a: App;
test.beforeAll(async () => { a = await launchApp({ lang: 'en' }); });
test.afterAll(async () => { await a?.close(); });

test('ST 352 flags PQ, the scopes read SDR: warning, then the switch', async () => {
  const { page } = a;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'steps11' }));
  await singlePanel(a, 'sdi');
  const panel = page.locator('.panel').first();
  const label = () => panel.locator('canvas.overlay').getAttribute('aria-label').then((l) => l ?? '');
  await expect.poll(label, { timeout: 60_000 }).toContain('No SDI ancillary data');
  const inject = () => page.evaluate(() => {
    const w = window as unknown as { lzs: { panels: unknown[]; panelSource: (p: unknown) => { vanc: unknown } | null } };
    const src = w.lzs.panelSource(w.lzs.panels[0]);
    if (src) src.vanc = { at: performance.now(), packets: [{ did: 0x41, sdid: 0x01, line: 10, stream: 0, data: '89e92001' }, { did: 0x61, sdid: 0x01, line: 9, stream: 0, data: '9669' }] };
  });
  // a real input refreshes VANC several times a second; slow CI machines need the same
  const fresh = async () => { await inject(); return label(); };
  await expect.poll(fresh, { timeout: 30_000 }).toContain('Signal flags PQ');
  expect(await label()).toContain('1080-line 3G Level A');
  expect(await label()).toContain('CEA-708 yes');
  await inject();
  await panel.getByRole('button', { name: 'Settings: SDI Signal Info' }).click();
  await page.locator('.popover.psettings').getByRole('button', { name: 'Use what the signal says' }).click();
  await page.keyboard.press('Escape');
  await expect.poll(fresh, { timeout: 30_000 }).not.toContain('Signal flags');
  await page.screenshot({ path: 'test-results/e2e/sdi.png' });
  expect(errors).toEqual([]);
});
