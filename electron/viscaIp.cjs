// VISCA over IP transport for the colour match (src/colormatch/adapters.ts, ViscaIpCamera).
// A web page cannot send UDP, so the socket lives here in the main process and the renderer
// reaches it through preload (lzsDesktop.visca).
//
// Source: Sony, "VISCA Command List / CGI Command List, Software Version 1.0, SRG-A40/A12"
// (5-053-155-11 (1), 2023), docs/research/farbabgleich-werkzeug.md:
//   p. 8   replies: ACK y0 4z FF, completion y0 5z FF, errors y0 6z ee FF (02 syntax, 03 buffer
//          full, 04 cancelled, 05 no socket, 41 not executable); inquiries get no ACK
//   p. 11  header: payload type (01 00 command, 01 10 inquiry, 01 11 reply, 02 00 control,
//          02 01 control reply), length 2 bytes, sequence number 4 bytes; control RESET = 01
//          (sequence number to 0, reply ACK 01), control ERROR = 0F 01 (sequence number) /
//          0F 02 (message type)
//   p. 12  UDP does not guarantee delivery: on time-out retransmit with the same sequence number;
//          one message at a time, the next after the reply to the last one.
//
// The transport owns the sequence numbers: it overwrites bytes 4–7 of every packet it sends.

const dgram = require('node:dgram');

const PORT = 52381;

class ViscaError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

const ERRORS = { 0x02: 'syntax error', 0x03: 'command buffer full', 0x04: 'command cancelled', 0x05: 'no socket', 0x41: 'command not executable' };

function header(type, seq, payload) {
  const b = Buffer.alloc(8 + payload.length);
  b.writeUInt16BE(type, 0);
  b.writeUInt16BE(payload.length, 2);
  b.writeUInt32BE(seq >>> 0, 4);
  Buffer.from(payload).copy(b, 8);
  return b;
}

/**
 * One camera. `send(packet)` → the final reply packet (completion or inquiry reply, with header);
 * rejects with ViscaError on an error reply, after `retries` retransmissions without answer, or
 * when closed.
 */
function createViscaClient({ host, port = PORT, timeoutMs = 500, retries = 2, socket } = {}) {
  const sock = socket || dgram.createSocket('udp4');
  let seq = 0, needReset = true, closed = false, chain = Promise.resolve(), waiter = null;

  sock.on('message', (msg) => {
    if (msg.length < 8 || !waiter) return;
    waiter(msg);
  });
  sock.on('error', () => {});
  const bound = socket ? Promise.resolve() : new Promise((ok) => sock.bind(0, ok));

  /** Send `buf` and feed replies with its sequence number to `onReply` until it returns a value. */
  function exchange(buf, onReply) {
    const mySeq = buf.readUInt32BE(4);
    return new Promise((resolve, reject) => {
      let tries = 0, timer = null;
      const done = (fn, v) => { clearTimeout(timer); waiter = null; fn(v); };
      const fire = () => {
        if (closed) return done(reject, new ViscaError('closed', 'closed'));
        if (tries++ > retries) return done(reject, new ViscaError(`no answer from ${host}:${port} after ${retries + 1} tries`, 'timeout'));
        sock.send(buf, port, host, (e) => { if (e) done(reject, new ViscaError(e.message, 'socket')); });
        timer = setTimeout(fire, timeoutMs);
      };
      waiter = (msg) => {
        const type = msg.readUInt16BE(0);
        // control ERROR (p. 11): our sequence number is not what the camera expects
        if (type === 0x0201 && msg.length >= 10 && msg[8] === 0x0f) return done(reject, new ViscaError(msg[9] === 0x01 ? 'sequence number' : 'message type', msg[9] === 0x01 ? 'sequence' : 'type'));
        if (msg.readUInt32BE(4) !== mySeq) return;
        let r;
        try { r = onReply(msg); } catch (e) { return done(reject, e); }
        if (r !== undefined) done(resolve, r);
        else { clearTimeout(timer); timer = setTimeout(fire, timeoutMs); } // ACK: wait for completion, fresh time-out
      };
      fire();
    });
  }

  async function reset() {
    await bound;
    await exchange(header(0x0200, 0, [0x01]), (m) => (m.readUInt16BE(0) === 0x0201 && m[8] === 0x01 ? true : undefined));
    seq = 0; needReset = false;
  }

  async function sendOnce(packet) {
    if (needReset) await reset();
    const p = Buffer.from(packet);
    if (p.length < 9) throw new ViscaError('packet too short', 'type');
    const type = p.readUInt16BE(0), inquiry = type === 0x0110;
    const buf = header(type, seq, p.subarray(8));
    seq = (seq + 1) >>> 0;
    return exchange(buf, (m) => {
      if (m.readUInt16BE(0) !== 0x0111) return undefined;
      const v = m[9] & 0xf0;
      if (v === 0x60) throw new ViscaError(`VISCA ${ERRORS[m[10]] || 'error'} (${[...m.subarray(8)].map((x) => x.toString(16).padStart(2, '0')).join(' ')})`, 'visca');
      if (v === 0x40 && !inquiry) return undefined; // ACK – completion follows
      if (v === 0x50) return m;
      return undefined;
    });
  }

  /** Serialised: one message in flight (p. 12). A sequence error resets once and repeats. */
  function send(packet) {
    const run = async () => {
      try { return await sendOnce(packet); } catch (e) {
        if (e.code !== 'sequence') throw e;
        needReset = true;
        return sendOnce(packet);
      }
    };
    const r = chain.then(run, run);
    chain = r.catch(() => {});
    return r;
  }

  return {
    send, reset,
    close() { closed = true; if (waiter) waiter = null; try { sock.close(); } catch { /* already closed */ } },
  };
}

/** IPC: lzs:visca-send(host, port, bytes[]) → { ok, reply: number[] } | { ok: false, error, code }. */
function setupVisca(ipcMain) {
  const clients = new Map();
  ipcMain.handle('lzs:visca-send', async (_e, host, port, bytes) => {
    const h = String(host || '').trim(), p = Number(port) || PORT;
    if (!h || !Array.isArray(bytes)) return { ok: false, error: 'bad request', code: 'type' };
    const key = `${h}:${p}`;
    let c = clients.get(key);
    if (!c) { c = createViscaClient({ host: h, port: p }); clients.set(key, c); }
    try { return { ok: true, reply: [...(await c.send(Uint8Array.from(bytes)))] }; } catch (e) {
      if (e.code === 'timeout') { c.close(); clients.delete(key); }
      return { ok: false, error: e.message, code: e.code || 'socket' };
    }
  });
}

module.exports = { createViscaClient, setupVisca, ViscaError, VISCA_PORT: PORT };
