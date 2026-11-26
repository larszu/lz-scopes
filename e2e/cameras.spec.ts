import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until, waveLevels } from './app';

// Cameras from a multiviewer (#217) and the A/B split as a source (#177), on the test pattern
// "ramp" (0 → 100 % from left to right): a 2×2 split makes "Cam 1" the left half (0 … 50 %)
// and "Cam 2" the right half (50 … 100 %) of the top row.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

type Cam = { index: number; id: string; name: string; tile: string };

test('Aufteilen 2×2: Kam 2 zeigt in der Waveform die rechte Hälfte der Rampe', async () => {
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'ramp' }));
  const r = await a.control({ cmd: 'source.split', source: 1, layout: '2x2', inset: 0 });
  expectOk(r);
  const cams = (r.result as { cameras: Cam[] }).cameras;
  expect(cams.map((c) => c.name)).toEqual(['Kam 1', 'Kam 2', 'Kam 3', 'Kam 4']);
  expect((await a.state()).sources.filter((s) => s.kind === 'camera')).toHaveLength(4);
  await singlePanel(a, 'wf-luma');
  expectOk(await a.control({ cmd: 'source.select', source: cams[1].id, panel: 1 }));
  const lv = await until(async () => {
    const v = await waveLevels(a.page, 'wf-luma', [0.1, 0.9]);
    return Math.abs(v[0] - 0.55) < 0.04 && Math.abs(v[1] - 0.95) < 0.04 ? v : false;
  }, 60_000, 'Kam 2 = rechte Hälfte der Rampe').catch(async (e) => { console.log('Pegel', await waveLevels(a.page, 'wf-luma', [0.1, 0.9])); throw e; });
  expect(lv[0]).toBeLessThan(lv[1]);
  // the card says where the camera comes from and what it is good for
  await expect(a.page.locator('.src.derived[data-derived="camera"] .camchip').first()).toContainText('aus Multiviewer');
});

test('Split als Quelle: Waveform folgt dem Bild-Panel und misst links A, rechts B', async () => {
  const st = await a.state();
  const [k1, k2] = st.sources.filter((s) => s.kind === 'camera');
  expectOk(await a.control({ cmd: 'layout.preset', preset: 2 }));
  expectOk(await a.control({ cmd: 'panel.scope', panel: 1, scope: 'picture' }));
  expectOk(await a.control({ cmd: 'panel.scope', panel: 2, scope: 'wf-luma' }));
  expectOk(await a.control({ cmd: 'source.select', source: k1.id, panel: 1 }));
  expectOk(await a.control({ cmd: 'source.select', source: k1.id, panel: 2 }));
  // split on with B = Kam 2, the other panels follow
  expectOk(await a.control({ cmd: 'panel.split', panel: 1, mode: 'on', source: k2.id, spread: true }));
  await until(async () => (await a.state()).panels.find((p) => p.panel === 2)?.source === 'Split Panel 1', 30_000, 'Panel 2 folgt dem Split');
  // left of the line: Kam 1 at 10 % = 5 %, right: Kam 2 at 90 % = 95 %
  await until(async () => {
    const v = await waveLevels(a.page, 'wf-luma', [0.1, 0.9]);
    return Math.abs(v[0] - 0.05) < 0.04 && Math.abs(v[1] - 0.95) < 0.04;
  }, 60_000, 'Split-Bild in der Waveform').catch(async (e) => { console.log('Pegel', await waveLevels(a.page, 'wf-luma', [0.1, 0.9])); throw e; });
  // the head button shows the split as on; off again: the follower measures A alone
  await expect(a.page.locator('.phead button.splitbtn.on').first()).toBeVisible();
  expectOk(await a.control({ cmd: 'panel.split', panel: 1, mode: 'off' }));
  await until(async () => (await a.state()).panels.find((p) => p.panel === 2)?.source === 'Kam 1', 30_000, 'Panel 2 wieder auf A');
});

test('Dialog „Aufteilen …“: 3×3 ohne Kachel 9, nach dem Neustart noch da', async () => {
  await a.page.locator('.src:not(.derived) .camsplit-open').first().click();
  const dlg = a.page.locator('dialog.camsplit');
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: '3×3', exact: true }).click();
  await dlg.locator('.camsplit-tile').nth(8).getByRole('checkbox').uncheck();
  await dlg.getByRole('button', { name: 'Kameras anlegen' }).click();
  await until(async () => (await a.state()).sources.filter((s) => s.kind === 'camera').length === 8, 30_000, 'acht Kameras');
  // the four cameras of the 2×2 split are re-used in order, so panels keep their camera
  const before = (await a.state()).sources.filter((s) => s.kind === 'camera').map((s) => s.name);
  const { profile, port } = a;
  await a.close(true);
  a = await launchApp({ profile, port });
  const after = await until(async () => { const s = (await a.state()).sources.filter((x) => x.kind === 'camera'); return s.length === 8 ? s : false; }, 60_000, 'Kameras nach dem Neustart');
  expect(after.map((s) => s.name)).toEqual(before);
});
