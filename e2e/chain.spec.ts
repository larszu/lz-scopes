import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CAMERA_PRESETS, CST_TARGETS, DEFAULT_CST, compileChain } from '../src/chain';
import { LOG_CURVES } from '../src/camera';
import type { Source } from '../src/sources';
import { type App, expectOk, launchApp, singlePanel, until, waveLevels } from './app';

// CST/LUT chain (src/chain.ts) in the app: a grey scale interpreted as camera log, CST to
// Rec.709 by the first camera preset, and a LUT (×0.5). Key C switches the measuring
// stage signal → nach CST → nach LUT. The waveform (GPU) must show the levels that
// compileChain (CPU reference) computes for each stage.

let a: App, dir = '';
test.beforeAll(async () => { a = await launchApp(); dir = mkdtempSync(join(tmpdir(), 'lzs-lut-')); });
test.afterAll(async () => { await a?.close(); rmSync(dir, { recursive: true, force: true }); });

const STEPS = Array.from({ length: 11 }, (_, i) => Math.round((i / 10) * 255) / 255);
const fr = STEPS.map((_, i) => (i + 0.5) / 11);

test('Messpunkt Signal → nach CST → nach LUT', async () => {
  const { page } = a;
  const preset = CAMERA_PRESETS[0], target = CST_TARGETS[0];
  expectOk(await a.control({ cmd: 'pattern.select', pattern: 'steps11' }));
  await singlePanel(a, 'wf-luma');

  // reference: the same settings the preset menu applies (src/main.ts chainControls)
  // (a plain object: src/sources.ts pulls in Vite worklet imports that Node cannot load)
  const ref = {
    transfer: preset.curve, gamut: LOG_CURVES[preset.curve].gamut, hlgLw: 1000, colorspace: '709',
    settings: { chain: { cst: { ...DEFAULT_CST, on: true, gamut: target.gamut, transfer: target.transfer, tonemap: target.tonemap } } },
  } as unknown as Source;
  const cstLevels = STEPS.map((v) => compileChain(ref, 'cst').apply([v, v, v])[1]); // grey stays grey (gamut matrix rows sum to 1)

  const card = page.locator('#source-list .src').first();
  await card.locator('details.chain > summary').click();
  await card.locator('details.chain select').first().selectOption(preset.id);
  // LUT 1: 2³ cube, output = 0.5 · input (exact under trilinear interpolation)
  const cube = join(dir, 'half.cube');
  const rows = [];
  for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) rows.push(`${r * 0.5} ${g * 0.5} ${b * 0.5}`);
  writeFileSync(cube, ['TITLE "half"', 'LUT_3D_SIZE 2', ...rows, ''].join('\n'));
  await page.locator('#source-list .src').first().locator('.lutslot input[type=file]').first().setInputFiles(cube);
  await expect(page.locator('#source-list .src').first().locator('details.chain > summary')).toContainText('LUT half.cube');

  const check = async (want: number[], what: string, tol = 0.015) => {
    await until(async () => {
      const l = await waveLevels(page, 'wf-luma', fr);
      return l.every((v, i) => Math.abs(v - want[i]) < tol);
    }, 60_000, what).catch(async (e) => {
      console.log(what, 'gemessen', (await waveLevels(page, 'wf-luma', fr)).map((v) => v.toFixed(3)).join(' '), 'erwartet', want.map((v) => v.toFixed(3)).join(' '));
      throw e;
    });
  };
  const chip = page.locator('.panel .stagechip');

  await check(STEPS, 'Signal');
  await page.locator('.brand').click();
  await page.keyboard.press('c');
  await expect(chip).toContainText('nach CST');
  await check(cstLevels, 'nach CST');
  // the CST changes the picture: otherwise this test would prove nothing
  expect(Math.max(...cstLevels.map((v, i) => Math.abs(v - STEPS[i])))).toBeGreaterThan(0.1);
  await page.keyboard.press('c');
  await expect(chip).toContainText('nach LUT');
  await check(cstLevels.map((v) => v * 0.5), 'nach LUT');
  await page.keyboard.press('c');
  await expect(chip).toHaveCount(0);
  await check(STEPS, 'zurück auf Signal');
});
