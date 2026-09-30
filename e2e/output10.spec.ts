import { expect, test, type Page } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { type App, expectOk, freePort, launchApp, until } from './app';

// 10-bit output windows (src/deep.ts): the pattern window draws on a float16 canvas, the
// scope windows ask for a RGBA16F WebGL buffer, and a 10-bit stream reaches ffmpeg with
// exact codes. Where the Chromium of the test machine offers no float16 canvas / RGBA16F
// (e.g. an old SwiftShader), the tests skip instead of failing.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

const ffmpeg = createRequire(import.meta.url)('ffmpeg-static') as string;

async function openWindow(q: string): Promise<Page> {
  const before = a.app.windows().length;
  await a.page.evaluate((qs) => { window.open(`${location.pathname}?${qs}`, `e2e-${Date.now()}`); }, q);
  await until(() => a.app.windows().length > before, 30_000, 'Fenster erscheint');
  const w = a.app.windows()[a.app.windows().length - 1];
  await w.waitForFunction(() => !!document.body.dataset.pipeline, undefined, { timeout: 60_000 });
  return w;
}

test('Testbild-Fenster: float16-Canvas trägt alle 1024 Codes der 10-bit-Rampe', async () => {
  const w = await openWindow('out=ramp10&w=1920&h=1080');
  const kind = await w.evaluate(() => document.body.dataset.pipeline);
  test.skip(kind !== 'float16', `Canvas meldet ${kind} – kein float16 in diesem Chromium`);
  const codes = await w.evaluate(() => {
    const px = (window as unknown as { lzsOut10: { pixels: () => ArrayLike<number> } }).lzsOut10.pixels();
    const row = 10, out: number[] = [];
    for (let x = 0; x < 1920; x++) out.push(Math.round(px[(row * 1920 + x) * 4] * 1023));
    return out;
  });
  expect(new Set(codes).size).toBe(1024);
  expect(codes.every((c, x) => c === Math.min(1023, Math.floor((x * 1024) / 1920)))).toBe(true);
  await expect(w.locator('body')).toContainText('Monitor-Bittiefe unbekannt');
  await w.close();
});

test('10-bit-Stream (v210): exakte Codes kommen bei ffmpeg an', async () => {
  const port = await freePort();
  const out: Buffer[] = [];
  const rx = spawn(ffmpeg, ['-hide_banner', '-f', 'nut', '-i', `tcp://127.0.0.1:${port}?listen=1`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv422p10le', 'pipe:1']);
  rx.stdout.on('data', (d) => out.push(d));
  const done = new Promise((ok) => rx.on('close', ok));
  await new Promise((r) => setTimeout(r, 500));
  const w = await openWindow(`out=ramp10&w=1920&h=1080&stream=e2e10&codec=v210&target=${encodeURIComponent(`tcp://127.0.0.1:${port}`)}`);
  await Promise.race([done, new Promise((r) => setTimeout(r, 60_000))]);
  rx.kill();
  const raw = Buffer.concat(out);
  expect(raw.length).toBe(1920 * 1080 * 4);
  const y = new Uint16Array(raw.buffer, raw.byteOffset, 1920 * 1080);
  // ramp band, full-range grey: Y′ = code (BT.2100-3 Tab. 9, full range); ffmpeg's v210
  // encoder limits to 4…1019 (0–3 and 1020–1023 are SDI timing codes) – measured, see research doc
  for (let x = 0; x < 1920; x++) expect(y[10 * 1920 + x]).toBe(Math.max(4, Math.min(1019, Math.floor((x * 1024) / 1920))));
  await w.close();
});

test('Scope-Ausgabefenster fordert RGBA16F an und nennt die Pipeline', async () => {
  const before = a.app.windows().length;
  expectOk(await a.control({ cmd: 'output.open', name: 'e2e10', view: 'grid', fullscreen: false }));
  await until(() => a.app.windows().length > before, 30_000, 'Ausgabefenster erscheint');
  const w = a.app.windows()[a.app.windows().length - 1];
  await w.mouse.move(50, 50);
  await w.waitForFunction(() => !!document.body.dataset.pipeline, undefined, { timeout: 60_000 });
  const fmt = await w.evaluate(() => document.body.dataset.pipeline);
  test.skip(fmt !== 'RGBA16F', `WebGL meldet ${fmt}`);
  await expect(w.locator('body')).toContainText('WebGL RGBA16F');
  expectOk(await a.control({ cmd: 'output.close', name: 'e2e10' }));
});
