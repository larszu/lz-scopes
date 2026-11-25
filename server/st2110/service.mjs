// ST 2110 in the bridge: network inputs, test signal generators, NMOS node, and the HTTP API
//   GET    /api/st2110                        inputs, generators, NMOS state
//   PUT    /api/st2110/inputs/<id>            SDP as body (application/sdp or JSON {sdp}) → connect
//   DELETE /api/st2110/inputs/<id>            disconnect
//   POST   /api/st2110/generators             JSON {kind, format?, depth?, channels?, freq?, levelDb?, host, port, host2?, port2?, ttl?, iface?}
//   PATCH  /api/st2110/generators/<id>        JSON {running?}
//   DELETE /api/st2110/generators/<id>
//   GET    /api/st2110/generators/<id>.sdp    SDP of a generator
// Reading is open (CORS *); writes need control access (same rule as /api/control: this computer or
// the control token).

import { NetInputs, INPUT_ID } from './inputs.mjs';
import { NmosNode } from './nmos.mjs';
import { Sender, videoFlow, audioFlow, ancFlow, sdiFlow, VIDEO_FORMATS } from './generator.mjs';

const IPV4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const okHost = (h) => typeof h === 'string' && IPV4.test(h) && h.split('.').every((x) => Number(x) <= 255);
const okPort = (p) => Number.isInteger(p) && p >= 1024 && p <= 65535;

/** Builds the flow of a generator request (validated). */
export function flowOf(spec) {
  const kind = spec.kind ?? 'video';
  if (kind === 'video') {
    if (spec.format && !(spec.format in VIDEO_FORMATS)) throw new Error(`format: one of ${Object.keys(VIDEO_FORMATS).join(', ')}`);
    return videoFlow({ format: spec.format ?? '1080p25', depth: spec.depth === 8 ? 8 : 10, matrix: spec.matrix === 'bt2020' ? 'bt2020' : 'bt709' });
  }
  if (kind === 'audio') return audioFlow({ channels: Number(spec.channels) || 2, freq: Number(spec.freq) || 1000, levelDb: Number.isFinite(spec.levelDb) ? Math.min(0, spec.levelDb) : -18 });
  if (kind === 'anc') return ancFlow({ rate: { num: Number(spec.fps) || 25, den: 1 } });
  if (kind === 'sdi') return sdiFlow({ frame: spec.format === '720p' ? 0x30 : 0x21, frate: { 50: 0x12, 25: 0x18, 60: 0x10 }[Number(spec.fps) || 25] ?? 0x18 });
  throw new Error('kind: video, audio, anc or sdi');
}

export class GeneratorPool {
  constructor({ onChange = () => {}, max = 8 } = {}) { this.items = new Map(); this.n = 0; this.onChange = onChange; this.max = max; }
  async add(spec) {
    if (this.items.size >= this.max) throw new Error(`at most ${this.max} generators`);
    const legs = [{ host: spec.host, port: spec.port }];
    if (spec.host2 !== undefined) legs.push({ host: spec.host2, port: spec.port2 ?? spec.port });
    for (const l of legs) if (!okHost(l.host) || !okPort(l.port)) throw new Error('host: IPv4 address, port: 1024–65535');
    const flow = flowOf(spec);
    const id = `gen${++this.n}`;
    const g = { id, spec, flow, legs, label: `${flow.kind === 'video' ? `ST 2110-20 ${flow.format}` : flow.kind === 'audio' ? `ST 2110-30 ${flow.channels} ch` : flow.kind === 'anc' ? 'ST 2110-40 ATC' : 'ST 2022-6'} test signal`, sender: null, running: false };
    this.items.set(id, g);
    await this.update(id, { running: spec.running !== false });
    this.onChange();
    return this.view(g);
  }
  async update(id, { running, legs } = {}) {
    const g = this.items.get(id);
    if (!g) throw new Error(`no generator ${id}`);
    if (legs) { for (const l of legs) if (!okHost(l.host) || !okPort(l.port)) throw new Error('host: IPv4 address, port: 1024–65535'); g.legs = legs; if (g.running) { g.sender.stop(); g.running = false; running = running ?? true; } }
    if (running === true && !g.running) {
      g.sender = new Sender(g.flow, { legs: g.legs.map((l) => ({ ...l, iface: g.spec.iface })), ttl: Number(g.spec.ttl) || 32 });
      await g.sender.start();
      g.running = true;
    } else if (running === false && g.running) { g.sender.stop(); g.running = false; }
    g.sdp = (g.sender ?? new Sender(g.flow, { legs: g.legs, socket: { close() {} } })).sdp(g.spec.origin ?? '0.0.0.0');
    return this.view(g);
  }
  remove(id) { const g = this.items.get(id); if (!g) return false; g.sender?.stop(); this.items.delete(id); this.onChange(); return true; }
  list() { return [...this.items.values()]; }
  view(g) { return { id: g.id, label: g.label, kind: g.flow.kind, running: g.running, legs: g.legs, status: g.sender?.status() ?? null, sdp: g.sdp }; }
  stopAll() { for (const g of this.items.values()) g.sender?.stop(); }
}

/** Bridge-wide ST 2110 service; NMOS only when a port is given (it opens a port on the network). */
export class St2110Service {
  constructor({ dir, inputs = 2 } = {}) {
    this.inputs = new NetInputs({ dir, count: inputs, onChange: (inp) => this.nmos?.inputChanged(inp) });
    this.generators = new GeneratorPool({ onChange: () => this.nmos?.changed() });
    this.nmos = null;
  }
  async startNmos({ port, host = '0.0.0.0', registry = '', mdns = true }) {
    this.nmos = new NmosNode({ inputs: this.inputs, generators: this.generators, registry });
    await this.nmos.listen(port, host);
    if (mdns) await this.nmos.discover({ browse: !registry });
    if (registry) this.nmos.startRegistration(registry);
    return this.nmos;
  }
  status() { return { inputs: this.inputs.view(), generators: this.generators.list().map((g) => this.generators.view(g)), nmos: this.nmos?.status() ?? null, formats: Object.keys(VIDEO_FORMATS) }; }
  async stop() { this.generators.stopAll(); await this.nmos?.stop(); }

  /** /api/st2110…; `access(req)` → null or { status, error }. */
  handle(req, res, path, access) {
    // reading is open like the other input lists (/api/ndi, /api/decklink); every change needs control access
    const read = req.method === 'GET' || req.method === 'HEAD';
    const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type, ...(read ? { 'access-control-allow-origin': '*' } : {}) }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
    const problem = read ? null : access(req);
    if (problem) return send(problem.status, { ok: false, error: problem.error });
    const seg = path.split('/').filter(Boolean).slice(2); // after api/st2110
    if (!seg.length) return req.method === 'GET' ? send(200, { ok: true, ...this.status() }) : send(405, { ok: false, error: 'GET' });
    const body = () => new Promise((ok) => { let b = ''; req.on('data', (d) => { b += d; if (b.length > 128 * 1024) req.destroy(); }); req.on('end', () => ok(b)); });
    const json = async () => { const t = await body(); try { return JSON.parse(t); } catch { return undefined; } };
    // JSON or SDP only: a foreign page cannot send these without a preflight, which is never allowed
    const typeOk = /^(application\/json|application\/sdp)\b/i.test(req.headers['content-type'] ?? '');
    if (seg[0] === 'inputs' && seg[1] && INPUT_ID.test(seg[1])) {
      if (!this.inputs.get(seg[1])) return send(404, { ok: false, error: 'no such input' });
      if (req.method === 'GET') return send(200, { ok: true, input: this.inputs.view().find((i) => i.id === seg[1]), sdp: this.inputs.get(seg[1]).sdp });
      if (req.method === 'DELETE') { this.inputs.activate(seg[1], null); return send(200, { ok: true }); }
      if (req.method !== 'PUT') return send(405, { ok: false, error: 'GET, PUT or DELETE' });
      if (!typeOk) return send(415, { ok: false, error: 'Content-Type: application/sdp or application/json' });
      return body().then((t) => {
        let sdp = t;
        if (/json/i.test(req.headers['content-type'])) { try { sdp = JSON.parse(t).sdp; } catch { return send(400, { ok: false, error: 'Invalid JSON' }); } }
        try { const inp = this.inputs.activate(seg[1], sdp); send(200, { ok: true, summary: inp.summary }); } catch (e) { send(400, { ok: false, error: e.message }); }
      });
    }
    if (seg[0] === 'generators') {
      if (!seg[1]) {
        if (req.method === 'GET') return send(200, { ok: true, generators: this.generators.list().map((g) => this.generators.view(g)) });
        if (req.method !== 'POST') return send(405, { ok: false, error: 'GET or POST' });
        if (!typeOk) return send(415, { ok: false, error: 'Content-Type: application/json' });
        return json().then(async (spec) => {
          if (!spec || typeof spec !== 'object') return send(400, { ok: false, error: 'Invalid JSON' });
          try { send(200, { ok: true, generator: await this.generators.add(spec) }); } catch (e) { send(400, { ok: false, error: e.message }); }
        });
      }
      const m = /^(gen\d{1,4})(\.sdp)?$/.exec(seg[1]);
      const g = m ? this.generators.items.get(m[1]) : null;
      if (!g) return send(404, { ok: false, error: 'no such generator' });
      if (m[2]) return send(200, g.sdp, 'application/sdp');
      if (req.method === 'GET') return send(200, { ok: true, generator: this.generators.view(g) });
      if (req.method === 'DELETE') { this.generators.remove(g.id); return send(200, { ok: true }); }
      if (req.method !== 'PATCH') return send(405, { ok: false, error: 'GET, PATCH or DELETE' });
      if (!typeOk) return send(415, { ok: false, error: 'Content-Type: application/json' });
      return json().then(async (p) => {
        try { send(200, { ok: true, generator: await this.generators.update(g.id, { running: typeof p?.running === 'boolean' ? p.running : undefined }) }); } catch (e) { send(400, { ok: false, error: e.message }); }
      });
    }
    return send(404, { ok: false, error: 'not found' });
  }
}
