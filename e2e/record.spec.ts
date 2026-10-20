import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type App, SHIPPED_FFMPEG, launchApp, until } from './app';

// Local recording (#140 step 5) through the app: the record button of a source card writes a
// take into the released folder (LZS_RECORD_DEFAULT stands in for Movies/LZ Scopes), the
// control API starts and stops "record all", the files are readable with ffprobe.

test.skip(!SHIPPED_FFMPEG, 'mitgeliefertes ffmpeg fehlt (npm run ffmpeg:fetch)');
const FFPROBE = SHIPPED_FFMPEG?.replace(/ffmpeg(\.exe)?$/, (m) => m.replace('ffmpeg', 'ffprobe')) ?? '';

let a: App, dir = '';
test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lzs-e2e-rec-'));
  process.env.LZS_RECORD_DEFAULT = dir;
  a = await launchApp();
});
test.afterAll(async () => { await a?.close(); delete process.env.LZS_RECORD_DEFAULT; if (dir) rmSync(dir, { recursive: true, force: true }); });

const frames = (file: string) => Number(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', file]).toString().trim());

test('Aufnahme-Knopf der Quellenkarte und „alle aufnehmen“ über die Steuer-API', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'RTSP / Netz' }).click();
  const url = page.locator('#source-list .src').last().locator('input.url');
  await url.fill('test:bars');
  await url.press('Enter');
  const st = await until(async () => (await a.state()).sources.find((x) => x.kind === 'stream' && x.status === 'live'), 60_000, 'Testbild live');
  const rec = page.locator(`button[data-rec="${st.id}"]`);
  const status = page.locator(`[data-recstat="${st.id}"]`);
  await expect(rec).toHaveText('Aufnahme');
  await rec.click();
  await expect(status).toContainText('ProRes 422 HQ', { timeout: 30_000 });
  await expect(page.locator('#rec-all')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(3000);
  await page.keyboard.press('m');
  await rec.click();
  await expect(rec).toHaveText('Aufnahme', { timeout: 30_000 });

  const takes = readdirSync(dir);
  expect(takes).toHaveLength(1);
  const take = join(dir, takes[0]);
  const base = st.name.replace(/[^\p{L}\p{N}_.-]+/gu, '_');
  await until(() => JSON.parse(readFileSync(join(take, `${base}.json`), 'utf8')).end !== null, 15_000, 'Begleitdatei abgeschlossen');
  const j = JSON.parse(readFileSync(join(take, `${base}.json`), 'utf8'));
  expect(j).toMatchObject({ source: { url: 'test:bars' }, video: { codec: 'prores' }, end: { reason: 'user' } });
  expect(j.markers).toHaveLength(1);
  const n = j.segments.reduce((sum: number, s: { file: string }) => sum + frames(join(take, s.file)), 0);
  // CI renders in software and encodes 1080p ProRes below real time: a floor only
  expect(n).toBeGreaterThan(10);

  // control API: record all on (test pattern in the page via MediaRecorder + bridge stream), state reports it, off again
  const on = await a.control({ cmd: 'record', mode: 'on' });
  expect(on.ok).toBe(true);
  await until(async () => ((await a.state()) as unknown as { recording: { active: number } }).recording.active === 2, 30_000, 'zwei Aufnahmen laufen');
  await page.waitForTimeout(3000);
  expect((await a.control({ cmd: 'record.mark', label: 'API' })).ok).toBe(true);
  expect((await a.control({ cmd: 'record', mode: 'off' })).ok).toBe(true);
  await until(async () => ((await a.state()) as unknown as { recording: { active: number } }).recording.active === 0, 30_000, 'Aufnahme beendet');
  await until(() => readdirSync(dir).length === 2, 10_000, 'zweite Aufnahme');
  const take2 = join(dir, readdirSync(dir).sort()[1]);
  expect(existsSync(join(take2, `${base}.json`))).toBe(true);
  // the browser source: WebM from MediaRecorder, uploaded into the same take
  const webm = await until(() => readdirSync(take2).find((f) => f.endsWith('.webm')), 15_000, 'WebM der Browser-Quelle');
  await until(() => readdirSync(take2).filter((f) => f.endsWith('.json')).length === 2, 15_000, 'Begleitdatei der Browser-Quelle');
  // MediaRecorder hands over its last chunk after the stop: wait until the file no longer grows
  let last = -1;
  await until(() => { const n = statSync(join(take2, webm)).size; const done = n > 1000 && n === last; last = n; return done; }, 15_000, 'WebM vollständig');
  expect(frames(join(take2, webm))).toBeGreaterThan(10);
});

test('Ringpuffer: Ring in der Quellenkarte, Sichern über die Steuer-API, Kopfleiste zeigt „Ring sichern“', async () => {
  const { page } = a;
  const st = (await a.state()).sources.find((x) => x.kind === 'stream' && x.status === 'live')!;
  await expect(page.locator('#ring-save')).toBeHidden();
  await page.locator(`button[data-ring="${st.id}"]`).click();
  await expect(page.locator(`[data-ringstat="${st.id}"]`)).toContainText('Ring 60 s', { timeout: 30_000 });
  await expect(page.locator('#ring-save')).toBeVisible();
  // a few seconds into the ring, then save: the file holds what the ring has (from its start)
  await page.waitForTimeout(7000);
  const before = new Set(readdirSync(dir));
  expect((await a.control({ cmd: 'ring.save', post: 1 })).ok).toBe(true);
  const take = await until(() => readdirSync(dir).find((d) => !before.has(d) && d.endsWith('-ring')), 30_000, 'Ring-Aufnahme');
  const mkv = await until(() => readdirSync(join(dir, take)).find((f) => f.endsWith('_ring.mkv')), 30_000, 'Ring-Datei');
  await until(() => readdirSync(join(dir, take)).some((f) => f.endsWith('_ring.json')), 15_000, 'Begleitdatei des Rings');
  expect(frames(join(dir, take, mkv))).toBeGreaterThan(20);
  expect((await a.control({ cmd: 'ring', mode: 'off' })).ok).toBe(true);
  await expect(page.locator('#ring-save')).toBeHidden({ timeout: 15_000 });
});

test('Wiedergabe: Aufnahmen als Quellen öffnen, gemeinsame Uhr, Leertaste spielt', async () => {
  const { page } = a;
  await page.locator('#add button', { hasText: 'Aufnahme …' }).click();
  const dlg = page.locator('dialog.modal[open]');
  await expect(dlg).toContainText('Aufnahme öffnen');
  // the first take of this run (newest first: the ring take and "record all" came later)
  await dlg.locator('.pb-take').last().getByRole('button', { name: 'Alle öffnen' }).click();
  await until(async () => (await a.state()).sources.some((x) => x.status === 'live' && x.name.includes(' · ')), 60_000, 'Aufnahme als Quelle live');
  const bar = page.locator('.pb-bar');
  await expect(bar).toBeVisible();
  const time = bar.locator('.pb-time');
  await expect(time).toContainText(' s / ');
  const t0 = await time.textContent();
  await bar.locator('[data-pb="play"]').click();
  await expect(bar.locator('[data-pb="play"]')).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1200);
  expect(await time.textContent()).not.toBe(t0);
  // Space (focus outside any field) pauses again
  await page.locator('body').press(' ');
  await expect(bar.locator('[data-pb="play"]')).toHaveAttribute('aria-pressed', 'false');
  // control API transport goes to the recordings when no video file is open
  expect((await a.control({ cmd: 'transport', op: 'start' })).ok).toBe(true);
});
