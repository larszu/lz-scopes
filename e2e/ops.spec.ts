import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import { type App, launchApp, menuClick, until } from './app';

// Event log, explanation cards and /metrics (#239): a bridge stream of the test pattern shows up
// in the event log and in /metrics; the cards of the test pattern carry the measured numbers.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

test('Ereignisprotokoll, /metrics und Messwert-Karten', async () => {
  const { page } = a;
  // a stream straight from the bridge (no camera needed): ffmpeg's SMPTE bars
  const ws = new WebSocket(`${a.base.replace(/^http/, 'ws')}/stream?url=test:bars&width=320&fps=5`);
  await new Promise<void>((ok, fail) => { ws.once('message', () => ok()); ws.once('error', fail); });
  const metrics = await until(async () => {
    const text = await (await fetch(`${a.base}/metrics`)).text();
    return /lzscopes_stream_frames_sent_total\{stream="\d+",source="test:bars"\} [1-9]/.test(text) ? text : false;
  }, 30_000, 'Stream in /metrics');
  expect(metrics).toContain('lzscopes_streams 1');
  ws.close();

  await menuClick(a, 'eventlog');
  const dlg = page.locator('dialog.ops[open]');
  await expect(dlg.locator('td', { hasText: 'test:bars' }).first()).toBeVisible();
  await expect(dlg.locator('td', { hasText: '1920x1080p25' }).first()).toBeVisible();
  await page.keyboard.press('Escape');

  await page.locator('#add button', { hasText: 'Testbild' }).click();
  await until(async () => (await a.state()).sources.some((s) => s.kind === 'pattern' && s.status === 'live'), 30_000, 'Testbild läuft');
  await menuClick(a, 'valuecards');
  const card = page.locator('dialog.ops[open] details.ops-card[data-id="ymax"]');
  await expect(card).toBeVisible();
  await card.locator('summary').click();
  await expect(card.locator('.ops-formula')).toContainText('Y′ = 0,2126 · R′');
});
