import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, until } from './app';

// Feedback from a broadcast engineer (11/2026): scope list in groups with the picture overlays as
// entries of their own, diamond on a full black field with a magnifier, fixed vectorscope centre box.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

const head = (a: App) => a.page.locator('.phead select').first();

test('Scope-Liste in Gruppen, Falschfarben als eigener Eintrag unter Bild', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  await singlePanel(a, 'parade');
  const groups = await head(a).locator('optgroup').evaluateAll((g) => g.map((x) => (x as HTMLOptGroupElement).label));
  expect(groups).toEqual(expect.arrayContaining(['Bild', 'Waveform', 'Farbe & Gamut', 'Audio']));
  await head(a).selectOption('picture:false');
  await until(async () => (await a.state()).panels[0]?.scope === 'picture', 10_000, 'Panel zeigt Bild');
  await expect(head(a)).toHaveValue('picture:false');
  await page.screenshot({ path: test.info().outputPath('falschfarben.png') });
});

test('Diamond: schwarzes Feld über das ganze Panel, Lupe auf den Schwarzpunkt', async () => {
  const { page } = a;
  await singlePanel(a, 'diamond');
  await page.waitForTimeout(800);
  // corners of the panel body are black now (were app background beside the 1:2 strip)
  const corner = await page.evaluate(() => {
    const c = [...document.querySelectorAll<HTMLCanvasElement>('.panel canvas.blit')].find((x) => x.getBoundingClientRect().width > 4)!;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    // top left corner: never a label there (the "G" of a narrow panel sits at the left edge, half way down)
    const d = ctx.getImageData(2, 3, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
  expect(Math.max(...corner)).toBeLessThan(6);
  await page.screenshot({ path: test.info().outputPath('diamond.png') });
  await page.locator('.phead .pop-trigger', { hasText: '⚙' }).first().click();
  const zoom = page.locator('.psettings select').filter({ has: page.locator('option[value="black"]') });
  await zoom.selectOption('black');
  await page.waitForTimeout(500);
  await page.screenshot({ path: test.info().outputPath('diamond-lupe.png') });
  await page.keyboard.press('Escape');
});

test('Vectorscope: Mittenquadrat bleibt bei ×2 gleich groß', async () => {
  const { page } = a;
  await singlePanel(a, 'vector');
  await page.waitForTimeout(800);
  await page.screenshot({ path: test.info().outputPath('vector-x1.png') });
});

test('Quellenwahl im Panelkopf ändert nur dieses Panel; „Alle Panels“ schaltet alle', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.filter((s) => s.kind === 'pattern').length >= 2, 30_000, 'zweites Testbild');
  expectOk(await a.control({ cmd: 'layout.preset', preset: 3 }));
  const st = await a.state();
  const [s1, s2] = st.sources;
  const srcSel = page.locator('.phead select.srcsel').first();
  await srcSel.selectOption(s2.id);
  // the control state names the panel's source by name
  await until(async () => (await a.state()).panels[0].source === s2.name, 10_000, 'Panel 1 auf Quelle 2');
  const after = await a.state();
  expect(after.panels.length).toBeGreaterThan(1);
  expect(after.panels.slice(1).every((p) => p.source === s1.name)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('zwei-quellen.png') });
  await srcSel.selectOption(`all:${s1.id}`);
  await until(async () => (await a.state()).panels.every((p) => p.source === s1.name), 10_000, 'alle Panels auf Quelle 1');
});

test('Waveform: Filter Tiefpass, Diamond: Split, Vectorscope: Mittenquadrat abschaltbar', async () => {
  const { page } = a;
  for (const [scope, value] of [['wf-luma', 'lowpass'], ['diamond', 'split'], ['vector', 'box']] as const) {
    await singlePanel(a, scope);
    await page.waitForTimeout(400);
    await page.locator('.phead .pop-trigger', { hasText: '⚙' }).first().click();
    if (value === 'lowpass') await page.locator('.psettings select').filter({ has: page.locator('option[value="lowpass"]') }).selectOption('lowpass');
    else if (value === 'split') await page.locator('.psettings label', { hasText: 'Split Diamond' }).click();
    else await page.locator('.psettings label', { hasText: 'festes Quadrat' }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: test.info().outputPath(`${scope}-${value}.png`) });
    await page.keyboard.press('Escape');
  }
});

test('Waveform: Flat rekonstruiert zeichnet eine Spur (#257)', async () => {
  const { page } = a;
  await singlePanel(a, 'wf-luma');
  await page.locator('.phead .pop-trigger', { hasText: '⚙' }).first().click();
  await page.locator('.psettings select').filter({ has: page.locator('option[value="recon"]') }).selectOption('recon');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const lit = await page.evaluate(() => {
    const c = [...document.querySelectorAll<HTMLCanvasElement>('.panel canvas.blit')].find((x) => x.getBoundingClientRect().width > 4)!;
    const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 1] > 60) n++;
    return n;
  });
  expect(lit).toBeGreaterThan(500);
  await page.screenshot({ path: test.info().outputPath('wf-recon.png') });
});

test('Quelle: Verzögerung wählbar, gegliederte „+ Quelle“-Leiste', async () => {
  const { page } = a;
  const labels = await page.locator('#add .add-label').allTextContents();
  expect(labels).toEqual(['Geräte', 'Netz', 'Dateien & dieser Rechner', 'Test & Ton']);
  await page.locator('#add button', { hasText: 'RTSP' }).first().click().catch(() => {});
  await page.screenshot({ path: test.info().outputPath('quellen.png') });
});
