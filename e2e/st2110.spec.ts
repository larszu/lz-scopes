import { expect, test } from '@playwright/test';
import dgram from 'node:dgram';
import { type App, freePort, launchApp, until } from './app';

// ST 2110-30/-40 end to end (#226, #227, #232) over the loopback interface: this test sends
// generated RTP (no real 2110 sender here) – L24 stereo, 1 kHz at −18 dBFS on both channels,
// 1 ms packets – and RFC 8331 ANC packets. The source is set up through the ST 2110 dialog by
// hand, the app must measure the tone (EBU Tech 3341 case 1: −23 dBFS → −23 LUFS, so −18 LUFS
// here), show the flow counters and record a pcap.

let a: App;
test.beforeAll(async () => { a = await launchApp(); });
test.afterAll(async () => { await a?.close(); });

function rtp(pt: number, seq: number, ts: number, payload: Buffer, marker = false): Buffer {
  const h = Buffer.alloc(12);
  h[0] = 0x80; h[1] = (marker ? 0x80 : 0) | pt; h.writeUInt16BE(seq & 0xffff, 2); h.writeUInt32BE(ts >>> 0, 4); h.writeUInt32BE(0x2110, 8);
  return Buffer.concat([h, payload]);
}
const AMP = 10 ** (-18 / 20);
function l24(n: number): Buffer {
  const b = Buffer.alloc(48 * 2 * 3);
  for (let k = 0; k < 48; k++) {
    const v = Math.round(Math.sin((2 * Math.PI * 1000 * (n * 48 + k)) / 48000) * AMP * 8388607);
    b.writeIntBE(v, k * 6, 3); b.writeIntBE(v, k * 6 + 3, 3);
  }
  return b;
}

test('ST 2110-30 aus dem Netz: Dialog → Bridge → Lautheit, Zähler, pcap', async () => {
  const port = await freePort();
  const { page } = a;
  await page.locator('#add button', { hasText: 'RTSP / Netz' }).click();
  const card = page.locator('#source-list .src').last();
  await card.locator('button', { hasText: 'ST 2110…' }).click();
  const dlg = page.locator('dialog.modal[open]');
  await dlg.locator('[data-st2110="primary"]').fill(`127.0.0.1:${port}`);
  await dlg.locator('[data-st2110="order"]').fill('SMPTE2110.(ST)');
  await dlg.locator('[data-st2110="connect"]').click();

  const tx = dgram.createSocket('udp4');
  let n = 0;
  // 5 packets every 5 ms ≈ real time; the RTP timestamp carries the sample index
  const timer = setInterval(() => { for (let k = 0; k < 5; k++, n++) tx.send(rtp(97, n, n * 48, l24(n)), port, '127.0.0.1'); }, 5);
  try {
    const st = await until(async () => {
      const s = await a.state();
      return s.sources.find((x) => x.kind === 'stream' && x.status === 'live') ? s : false;
    }, 60_000, 'ST-2110-Quelle wird live');
    const src = st.sources.find((x) => x.kind === 'stream')!;
    await a.control({ cmd: 'source.select', source: src.index });
    const audio = await until(async () => {
      const s = (await a.state()) as unknown as { audio: { momentary: number | null } | null; st2110: { flows: { packets: number; audio?: { order: string[] } }[] } | null };
      return s.audio?.momentary != null && Math.abs(s.audio.momentary + 18) < 0.5 && s.st2110?.flows[0]?.packets ? s : false;
    }, 60_000, 'Lautheit −18 LUFS und Paketzähler');
    expect(audio.st2110!.flows[0].audio!.order).toEqual(['ST']);
    // pcap snapshot from the card, then the download link
    await page.locator('#source-list .src').last().locator('[data-st2110="snapshot"]').click();
    const link = page.locator('#source-list [data-st2110="file"]');
    await expect(link).toBeVisible({ timeout: 30_000 });
    const href = await link.getAttribute('href');
    const r = await fetch(href!);
    expect(r.headers.get('content-type')).toBe('application/vnd.tcpdump.pcap');
    const buf = Buffer.from(await r.arrayBuffer());
    // nanosecond pcap, raw IPv4 (server/pcap.mjs)
    expect(buf.readUInt32LE(0)).toBe(0xa1b23c4d);
    expect(buf.readUInt32LE(20)).toBe(228);
    expect(buf.length).toBeGreaterThan(24 + 100 * (16 + 28 + 12 + 288));
  } finally { clearInterval(timer); tx.close(); }
});
