import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createSocket, type Socket, type RemoteInfo } from 'node:dgram';
import { DesktopViscaTransport, ViscaIpCamera, viscaAddress, viscaPacket } from '../src/colormatch/adapters';

// VISCA over IP transport of the desktop app (electron/viscaIp.cjs) against a local UDP camera
// that follows the Sony SRG-A40/A12 command list (pp. 8, 11, 12).

const require = createRequire(import.meta.url);
const { createViscaClient } = require('../electron/viscaIp.cjs') as {
  createViscaClient: (o: { host: string; port: number; timeoutMs?: number; retries?: number }) => { send(p: Uint8Array): Promise<Uint8Array>; close(): void };
};

type Handler = (msg: Buffer, reply: (type: number, seq: number, payload: number[]) => void, r: RemoteInfo) => void;

interface FakeCam { port: number; sock: Socket; log: { type: number; seq: number; payload: number[] }[] }
const open: { close(): void }[] = [];
afterEach(() => { while (open.length) open.pop()!.close(); });

async function fakeCamera(handler: Handler): Promise<FakeCam> {
  const sock = createSocket('udp4'), log: FakeCam['log'] = [];
  sock.on('message', (msg, r) => {
    log.push({ type: msg.readUInt16BE(0), seq: msg.readUInt32BE(4), payload: [...msg.subarray(8)] });
    handler(msg, (type, seq, payload) => {
      const b = Buffer.alloc(8 + payload.length);
      b.writeUInt16BE(type, 0); b.writeUInt16BE(payload.length, 2); b.writeUInt32BE(seq, 4); Buffer.from(payload).copy(b, 8);
      sock.send(b, r.port, r.address);
    }, r);
  });
  await new Promise<void>((ok) => sock.bind(0, '127.0.0.1', ok));
  open.push({ close: () => sock.close() });
  return { port: (sock.address() as { port: number }).port, sock, log };
}

const client = (port: number, o: { timeoutMs?: number; retries?: number } = {}) => {
  const c = createViscaClient({ host: '127.0.0.1', port, timeoutMs: o.timeoutMs ?? 100, retries: o.retries ?? 2 });
  open.push(c);
  return c;
};

/** A camera with R/B gain and WB mode; answers RESET, ACK + completion, inquiries. */
function sonyLike(state = { 0x43: 0x80, 0x44: 0x80, 0x35: 0x00 } as Record<number, number>): Handler {
  return (msg, reply) => {
    const type = msg.readUInt16BE(0), seq = msg.readUInt32BE(4), p = [...msg.subarray(8)];
    if (type === 0x0200 && p[0] === 0x01) return reply(0x0201, 0, [0x01]);
    if (type === 0x0110) {
      const v = state[p[3]];
      return reply(0x0111, seq, p[3] === 0x35 ? [0x90, 0x50, v, 0xff] : [0x90, 0x50, 0, 0, v >> 4, v & 15, 0xff]);
    }
    if (type === 0x0100) {
      if (p[3] === 0x35) state[0x35] = p[4]; else state[p[3]] = (p[6] << 4) | p[7];
      reply(0x0111, seq, [0x90, 0x41, 0xff]);
      reply(0x0111, seq, [0x90, 0x51, 0xff]);
    }
  };
}

describe('VISCA over IP transport (electron/viscaIp.cjs)', () => {
  it('resets the sequence number first, then counts up from 0 (p. 11)', async () => {
    const cam = await fakeCamera(sonyLike());
    const c = client(cam.port);
    await c.send(viscaPacket('inquiry', 99, [0x81, 0x09, 0x04, 0x43, 0xff]));
    await c.send(viscaPacket('inquiry', 99, [0x81, 0x09, 0x04, 0x44, 0xff]));
    expect(cam.log.map((m) => [m.type, m.seq])).toEqual([[0x0200, 0], [0x0110, 0], [0x0110, 1]]);
    expect(cam.log[0].payload).toEqual([0x01]);
  });

  it('waits past the ACK for the completion of a command (p. 8)', async () => {
    const cam = await fakeCamera(sonyLike());
    const r = await client(cam.port).send(viscaPacket('command', 0, [0x81, 0x01, 0x04, 0x43, 0, 0, 8, 7, 0xff]));
    expect([...r.subarray(8)]).toEqual([0x90, 0x51, 0xff]);
  });

  it('retransmits with the same sequence number after a time-out (p. 12)', async () => {
    let drop = 2;
    const inner = sonyLike();
    const cam = await fakeCamera((m, reply, ri) => { if (m.readUInt16BE(0) === 0x0110 && drop-- > 0) return; inner(m, reply, ri); });
    const r = await client(cam.port, { timeoutMs: 60, retries: 3 }).send(viscaPacket('inquiry', 0, [0x81, 0x09, 0x04, 0x43, 0xff]));
    expect(r[9]).toBe(0x50);
    const inq = cam.log.filter((m) => m.type === 0x0110);
    expect(inq.length).toBe(3);
    expect(new Set(inq.map((m) => m.seq)).size).toBe(1);
  });

  it('gives up after the retries with a time-out error', async () => {
    const cam = await fakeCamera(() => {});
    await expect(client(cam.port, { timeoutMs: 30, retries: 1 }).send(viscaPacket('inquiry', 0, [0x81, 0x09, 0x04, 0x43, 0xff]))).rejects.toThrow(/no answer.*2 tries/);
    expect(cam.log.length).toBe(2); // RESET sent twice, never answered
  });

  it('reports a VISCA error reply (p. 8)', async () => {
    const cam = await fakeCamera((m, reply) => {
      if (m.readUInt16BE(0) === 0x0200) return reply(0x0201, 0, [0x01]);
      reply(0x0111, m.readUInt32BE(4), [0x90, 0x61, 0x41, 0xff]);
    });
    await expect(client(cam.port).send(viscaPacket('command', 0, [0x81, 0x01, 0x04, 0x35, 0x05, 0xff]))).rejects.toThrow('command not executable');
  });

  it('resets and repeats once on a sequence-number error (control ERROR 0F 01, p. 11)', async () => {
    let failed = false;
    const inner = sonyLike();
    const cam = await fakeCamera((m, reply, ri) => {
      if (m.readUInt16BE(0) === 0x0110 && !failed) { failed = true; return reply(0x0201, m.readUInt32BE(4), [0x0f, 0x01]); }
      inner(m, reply, ri);
    });
    const r = await client(cam.port).send(viscaPacket('inquiry', 0, [0x81, 0x09, 0x04, 0x44, 0xff]));
    expect(r[9]).toBe(0x50);
    expect(cam.log.filter((m) => m.type === 0x0200).length).toBe(2);
  });

  it('drives ViscaIpCamera end to end through the desktop IPC shape', async () => {
    const state = { 0x43: 0x80, 0x44: 0x70, 0x35: 0x00 } as Record<number, number>;
    const cam = await fakeCamera(sonyLike(state));
    const c = client(cam.port);
    const api = { async send(_h: string, _p: number, bytes: number[]) { return { ok: true as const, reply: [...(await c.send(Uint8Array.from(bytes)))] }; } };
    const visca = new ViscaIpCamera(new DesktopViscaTransport(`127.0.0.1:${cam.port}`, api));
    expect(await visca.read()).toEqual({ 'visca.rgain': 0, 'visca.bgain': -16 });
    await visca.write({ 'visca.bgain': 5 });
    expect(state[0x35]).toBe(0x05);
    expect(state[0x44]).toBe(0x85);
  });

  it('parses camera addresses', () => {
    expect(viscaAddress('192.0.2.10')).toEqual({ host: '192.0.2.10', port: 52381 });
    expect(viscaAddress('udp://cam.local:1234/')).toEqual({ host: 'cam.local', port: 1234 });
  });
});
