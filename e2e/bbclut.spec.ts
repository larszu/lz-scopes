import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp } from './app';

// LUT-Sammlung → BBC-HDR-LUT in LUT 1 (#210). Der Download von GitHub wird abgefangen und mit
// einem 2³-Identitätswürfel beantwortet: geprüft wird der Weg in der App, nicht das Netz.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

test('BBC-LUT 7a landet in LUT 1, LUT-Ausgang auf PQ', async () => {
  const { page } = a;
  let asked = '';
  await page.route('https://raw.githubusercontent.com/bbc/**', async (r) => {
    asked = r.request().url();
    const rows = [];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let rr = 0; rr < 2; rr++) rows.push(`${rr} ${g} ${b}`);
    await r.fulfill({ status: 200, contentType: 'text/plain', body: ['LUT_3D_SIZE 2', ...rows, ''].join('\n') });
  });
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'steps11' }));
  const card = page.locator('#source-list .src').first();
  await card.locator('details.src-colour > summary').click();
  await card.locator('details.chain > summary').click();
  await card.locator('details.chain button', { hasText: 'LUT-Sammlung' }).click();
  const dlg = page.locator('dialog.lutlib');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('table').first().locator('tr')).toHaveCount(6);
  await dlg.locator('tr', { hasText: '7a' }).locator('button').click();
  await expect(dlg).toHaveCount(0);
  expect(asked).toContain('7a_HLG_PQ1000_Type1');
  const chain = page.locator('#source-list .src').first().locator('details.chain');
  await expect(chain.locator('> summary')).toContainText('LUT BBC 7a_HLG_PQ1000');
  // LUT-Ausgang: Transfer-Auswahl steht auf PQ
  await expect(chain.locator('select').filter({ has: page.locator('option[value="pq"]:checked') })).toHaveCount(1);
});
