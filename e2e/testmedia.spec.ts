import { expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { type App, launchApp, menuClick, until } from './app';

// Own test pictures and logo (#52): upload, kept in IndexedDB over a restart, logo patterns
// appear, favourites at the top of the pattern list. Test videos: catalogue dialog only (the
// download needs the network and several 100 MB; checked by hand, see docs/research/testvideos.md).

/** Solid-colour PNG (w×h, RGB) without any image library. */
function png(w: number, h: number, rgb: [number, number, number]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const t = Buffer.concat([Buffer.from(type), data]); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(t)); return Buffer.concat([len, t, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let a: App;
test.afterAll(async () => { await a?.close(); });

const options = (a: App) => a.page.locator('#source-list .src').first().locator('select.pattern option').allTextContents();

test('Eigene Bilder und Logo bleiben gespeichert, Logo-Testbilder, Favoriten', async () => {
  a = await launchApp();
  const { page } = a;
  await menuClick(a, 'testimages');
  const dlg = page.locator('dialog#testimages');
  await expect(dlg).toBeVisible();
  // upload one picture, then a logo
  let chooser = page.waitForEvent('filechooser');
  await dlg.locator('button', { hasText: '+ Bilder hochladen' }).click();
  await (await chooser).setFiles({ name: 'e2e-rot.png', mimeType: 'image/png', buffer: png(64, 36, [200, 20, 20]) });
  await expect(dlg.locator('.timg')).toHaveCount(1);
  chooser = page.waitForEvent('filechooser');
  await dlg.locator('button', { hasText: 'Logo hochladen' }).click();
  await (await chooser).setFiles({ name: 'e2e-logo.png', mimeType: 'image/png', buffer: png(40, 20, [240, 240, 240]) });
  await expect(dlg.locator('.timg')).toHaveCount(2);
  await expect(dlg.locator('.timg input[type=radio]:checked')).toHaveCount(1);
  // favourite the red picture
  await dlg.locator('.timg', { has: page.locator('input[value="e2e-rot.png"]') }).locator('button.fav').click();
  await expect(dlg.locator('.favlist')).toContainText('e2e-rot.png');
  await page.keyboard.press('Escape');

  const opts = await options(a);
  expect(opts).toContain('e2e-rot.png');
  expect(opts).toContain('Eigenes Logo');
  expect(opts).toContain('Testbild mit Kreis und Uhr + Logo');
  // favourites first
  const firstGroup = await a.page.locator('#source-list .src').first().locator('select.pattern optgroup').first().getAttribute('label');
  expect(firstGroup).toContain('Favoriten');

  // show the logo test card: the source runs
  await a.page.locator('#source-list .src').first().locator('select.pattern').selectOption('testcard-logo');
  await until(async () => (await a.state()).sources[0].status === 'live', 20_000, 'Logo-Testbild läuft');

  // restart with the same profile: pictures, logo and favourite are still there
  const { profile, port } = a;
  await a.close(true);
  a = await launchApp({ profile, port });
  await until(async () => (await options(a)).includes('e2e-rot.png'), 20_000, 'Bild nach Neustart');
  expect(await options(a)).toContain('Testbild mit Kreis und Uhr + Logo');
  await until(async () => (await a.state()).sources[0].status === 'live', 20_000, 'Logo-Testbild nach Neustart');
});

test('Testvideo-Katalog mit Lizenz und Namensnennung', async () => {
  await menuClick(a, 'testvideos');
  const dlg = a.page.locator('dialog#testvideos');
  await expect(dlg).toBeVisible();
  expect(await dlg.locator('tr[data-video]').count()).toBeGreaterThanOrEqual(9);
  await expect(dlg).toContainText('Big Buck Bunny');
  await expect(dlg).toContainText('Blender Foundation');
  await expect(dlg).toContainText('CC BY 4.0');
  await expect(dlg.locator('tr[data-video="bbb-180p"] button', { hasText: 'Laden' })).toBeVisible();
  await a.page.keyboard.press('Escape');
});
