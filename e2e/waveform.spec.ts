import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, singlePanel, traceNear, until, waveLevels, waveProfile } from './app';

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

test('Graustufen 11 → Waveform-Pegel an bekannten Positionen', async () => {
  // src/patterns.ts 'steps11': levels 0, 10 … 100 % in 11 equal columns. R′ = G′ = B′, so
  // Y′ equals the level for every luma matrix; each column has exactly one level.
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'steps11' }));
  await singlePanel(a, 'wf-luma');
  const fr = Array.from({ length: 11 }, (_, i) => (i + 0.5) / 11);
  // 8-bit steps (round(i/10·255)/255) plus one row of the panel height: < 1.5 %
  const levels = await until(async () => {
    const l = await waveLevels(a.page, 'wf-luma', fr);
    return l.every((v, i) => Math.abs(v - i / 10) < 0.015) ? l : false;
  }, 60_000, 'Waveform zeigt die Graustufen').catch(async (e) => {
    console.log('gemessen', await waveLevels(a.page, 'wf-luma', fr));
    throw e;
  });
  expect(levels).toHaveLength(11);
});

test('SMPTE-75-%-Balken: Y′ der Balken nach BT.709', async () => {
  // 75 % bars (top 67 % of the picture): Y′ = 0.75 · (Kr·R + Kg·G + Kb·B), BT.709 Kr = 0.2126, Kb = 0.0722
  const kr = 0.2126, kb = 0.0722, kg = 1 - kr - kb;
  const bars = [[1, 1, 1], [1, 1, 0], [0, 1, 1], [0, 1, 0], [1, 0, 1], [1, 0, 0], [0, 0, 1]];
  const expected = bars.map(([r, g, b]) => 0.75 * (kr * r + kg * g + kb * b));
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'smpte75' }));
  await singlePanel(a, 'wf-luma');
  const fr = bars.map((_, i) => (i + 0.5) / 7);
  // the lower rows (PLUGE, −I/+Q, 100 % white) add other levels: require a strong trace at the bar level
  await until(async () => {
    const prof = await waveProfile(a.page, 'wf-luma', fr);
    return prof.every((col, i) => traceNear(col, expected[i]) > 0.5);
  }, 60_000, 'Waveform zeigt die Balken').catch(async (e) => {
    const prof = await waveProfile(a.page, 'wf-luma', fr);
    console.log('Spur am Sollpegel', prof.map((col, i) => traceNear(col, expected[i]).toFixed(2)), 'erwartet', expected);
    throw e;
  });
  // and nothing between the bar level and 100 % in the red column (bar 6, Y′ 15.9 %)
  const [red] = await waveProfile(a.page, 'wf-luma', [5.5 / 7]);
  expect(traceNear(red, 0.5, 0.2)).toBeLessThan(0.05);
});
