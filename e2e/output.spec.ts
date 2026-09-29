import { expect, test } from '@playwright/test';
import { type App, expectOk, launchApp, until } from './app';

// Output window (#1) opened over the control API, streaming JPEG frames to the bridge,
// served as MJPEG at /out/<name>.mjpeg (docs/control-api.md).

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

/** First complete JPEG from a multipart MJPEG response. */
async function firstJpeg(url: string, timeoutMs = 60_000): Promise<{ type: string; jpeg: Buffer }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const type = r.headers.get('content-type') ?? '';
    const reader = r.body!.getReader();
    let buf = Buffer.alloc(0);
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('MJPEG-Stream endete ohne Bild');
      buf = Buffer.concat([buf, Buffer.from(value)]);
      const soi = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
      const eoi = soi >= 0 ? buf.indexOf(Buffer.from([0xff, 0xd9]), soi + 3) : -1;
      if (eoi > 0) { ctl.abort(); return { type, jpeg: buf.subarray(soi, eoi + 2) }; }
    }
  } finally { clearTimeout(timer); }
}

/** Width and height from the SOF0/SOF2 segment of a JPEG. */
function jpegSize(j: Buffer): { w: number; h: number } {
  let i = 2;
  while (i < j.length) {
    const marker = j[i + 1], len = j.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) return { h: j.readUInt16BE(i + 5), w: j.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('kein SOF im JPEG');
}

test('Ausgabefenster öffnet sich und liefert MJPEG', async () => {
  const before = a.app.windows().length;
  const r = expectOk(await a.control({ cmd: 'output.open', name: 'e2e', view: 'grid', stream: 'e2estream', fullscreen: false }));
  expect((r as { result?: { output: string } }).result?.output).toBe('e2e');
  await until(() => a.app.windows().length > before, 30_000, 'Ausgabefenster erscheint');
  const out = await until(async () => {
    const list = await (await fetch(`${a.base}/api/outputs`)).json() as { name: string; url: string }[];
    return list.find((o) => o.name === 'e2estream');
  }, 30_000, 'Ausgabe meldet sich an der Bridge');
  expect(out.url).toBe('/out/e2estream.mjpeg');
  const { type, jpeg } = await firstJpeg(`${a.base}${out.url}`);
  expect(type).toContain('multipart/x-mixed-replace');
  const { w, h } = jpegSize(jpeg);
  expect(w).toBeGreaterThan(100);
  expect(h).toBeGreaterThan(50);
  const st = await a.state();
  expect(st.outputs.map((o) => o.name)).toContain('e2e');
  expectOk(await a.control({ cmd: 'output.close', name: 'e2e' }));
  await until(async () => !(await a.state()).outputs.length, 15_000, 'Ausgabe geschlossen');
});
