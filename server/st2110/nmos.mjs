// NMOS node for the ST 2110 network inputs and the test signal generator (#240, #237):
// IS-04 Node API v1.3 (self, devices, sources, flows, senders, receivers), registration at a
// registry (heartbeat, re-registration), and IS-05 Connection API v1.1 for receivers (staged/active,
// SDP in transport_file activates the receive path) and generator senders (transportfile, enable).
//
// Sources: AMWA IS-04 v1.3.3 and IS-05 v1.1 (specs.amwa.tv, GitHub AMWA-TV/is-04, is-05; digest in
// lz-camera-bridge docs/wissen/nmos.md, read 25.11.2026): resource core id/version/label/description/
// tags; version = TAI "<s>:<ns>", rises with every change; registration order node → devices →
// sources → flows → senders → receivers; heartbeat 5 s, 404 on heartbeat = register again, 200 on the
// first node POST = stale entry, delete and register again; IS-05 staged PATCH with master_enable,
// sender_id, transport_params (one entry per leg, ST 2022-7), transport_file {data, type},
// activation {mode: activate_immediate | activate_scheduled_absolute | _relative | null}.
// Device control type for IS-05 v1.1: urn:x-nmos:control:sr-ctrl/v1.1.
//
// Not built: IS-10 authorisation and BCP-003 TLS (plain HTTP like most NMOS test set-ups), bulk
// endpoints, the deprecated IS-04 /target. Not yet run against AMWA nmos-testing.

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { hostname, networkInterfaces } from 'node:os';
import { taiMinusUtc } from '../leap.mjs';
import { parseSdp2110, pictureSections } from './sdp.mjs';

export const NODE_VER = 'v1.3';
export const CONN_VER = 'v1.1';
const TRANSPORT_RTP = 'urn:x-nmos:transport:rtp';

/** Stable UUID (RFC 4122 layout, version 5 style bits) from a seed: same host + name → same id. */
export function stableId(seed) {
  const h = createHash('sha1').update(seed).digest();
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** TAI now as "<s>:<ns>" (IS-04 version), strictly rising within this process. */
let lastVer = 0n;
export function taiVersion(nowMs = Date.now()) {
  let ns = BigInt(Math.floor(nowMs)) * 1_000_000n + BigInt(taiMinusUtc(nowMs)) * 1_000_000_000n;
  if (ns <= lastVer) ns = lastVer + 1n;
  lastVer = ns;
  return `${ns / 1_000_000_000n}:${ns % 1_000_000_000n}`;
}
const taiNowSec = (nowMs = Date.now()) => nowMs / 1000 + taiMinusUtc(nowMs);
const parseTaiTime = (s) => { const m = /^(\d{1,12}):(\d{1,9})$/.exec(String(s ?? '')); return m ? Number(m[1]) + Number(m[2]) / 1e9 : null; };
const taiText = (sec) => { const s = Math.floor(sec); return `${s}:${Math.round((sec - s) * 1e9)}`; };

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const isIpv4 = (a) => IPV4.test(a) && a.split('.').every((x) => Number(x) <= 255);

/** Local IPv4 interfaces (name, address, MAC "aa-bb-…"), non-internal. */
export function localInterfaces(ifs = networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifs)) for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address, mac: (a.mac ?? '').replace(/:/g, '-').toLowerCase() || null });
  return out;
}

/**
 * Rewrites the destination, source filter and port of an SDP from IS-05 transport parameters
 * (leg i → i-th picture section). Values "auto" or missing leave the SDP as it is.
 */
export function applyTransportParams(sdpText, legs) {
  const lines = sdpText.split(/\r?\n/);
  let sec = -1;
  const out = [];
  for (const l of lines) {
    if (l.startsWith('m=')) sec++;
    const p = sec >= 0 ? legs[sec] : null;
    if (p && l.startsWith('m=') && Number.isInteger(p.destination_port)) { const f = l.split(' '); f[1] = String(p.destination_port); out.push(f.join(' ')); continue; }
    if (p && l.startsWith('c=IN IP4 ') && isIpv4(p.multicast_ip ?? '')) { const ttl = l.split('/')[1]; out.push(`c=IN IP4 ${p.multicast_ip}${ttl ? `/${ttl}` : ''}`); continue; }
    if (p && l.startsWith('a=source-filter:') && isIpv4(p.source_ip ?? '')) { const f = l.split(' '); f[f.length - 1] = p.source_ip; if (isIpv4(p.multicast_ip ?? '')) f[f.length - 2] = p.multicast_ip; out.push(f.join(' ')); continue; }
    out.push(l);
  }
  return out.join('\r\n');
}

/** Transport parameters of the legs as an SDP says them (IS-05 /active after an activation). */
function paramsFromSdp(sdpText, legCount, ifaceIp) {
  const legs = [];
  try {
    const { primary, secondary } = pictureSections(parseSdp2110(sdpText));
    for (const s of [primary, secondary].slice(0, legCount)) {
      legs.push({ source_ip: s?.source ?? null, multicast_ip: s?.group && /^(22[4-9]|23\d)\./.test(s.group) ? s.group : null, interface_ip: ifaceIp ?? null, destination_port: s?.port ?? 5004, rtp_enabled: !!s });
    }
  } catch { /* not readable: defaults */ }
  while (legs.length < legCount) legs.push({ source_ip: null, multicast_ip: null, interface_ip: ifaceIp ?? null, destination_port: 5004, rtp_enabled: false });
  return legs;
}

const RECEIVER_PARAMS = ['source_ip', 'multicast_ip', 'interface_ip', 'destination_port', 'rtp_enabled'];
const SENDER_PARAMS = ['source_ip', 'destination_ip', 'source_port', 'destination_port', 'rtp_enabled'];

/**
 * The node. `inputs`: NetInputs (server/st2110/inputs.mjs); `generators`: GeneratorPool
 * (server/st2110/service.mjs) or null. `fetch` and `now` exist for tests.
 */
export class NmosNode {
  constructor({ inputs, generators = null, host = '', port = 0, label = `LZ Scopes (${hostname().split('.')[0]})`, registry = '', fetchImpl = globalThis.fetch, seed = hostname(), heartbeatMs = 5000 } = {}) {
    Object.assign(this, { inputs, generators, host, port, label, registry, fetchImpl, seed, heartbeatMs });
    this.nodeId = stableId(`${seed}|lz-scopes|node`);
    this.deviceId = stableId(`${seed}|lz-scopes|device`);
    this.versions = new Map(); // id → version text
    this.rx = new Map(); // receiver id → { inputId, staged, active, pending }
    this.reg = { state: registry ? 'idle' : 'off', url: registry, error: '', registered: new Map(), timer: null };
    this.server = null;
    this.ver(this.nodeId); this.ver(this.deviceId);
    for (const inp of inputs.list()) this.receiverState(inp.id);
  }

  ver(id, bump = false) { if (bump || !this.versions.has(id)) this.versions.set(id, taiVersion()); return this.versions.get(id); }
  ifaceIps() { return localInterfaces().map((i) => i.address); }
  baseHost() { return this.host && this.host !== '0.0.0.0' ? this.host : this.ifaceIps()[0] ?? '127.0.0.1'; }

  receiverId(inputId) { return stableId(`${this.seed}|lz-scopes|receiver|${inputId}`); }
  receiverState(inputId) {
    const id = this.receiverId(inputId);
    let r = this.rx.get(id);
    if (!r) {
      const legs = this.inputs.get(inputId)?.legs ?? 1;
      const blank = () => ({ sender_id: null, master_enable: false, activation: { mode: null, requested_time: null, activation_time: null }, transport_file: { data: null, type: null }, transport_params: paramsFromSdp('', legs, null).map((p) => ({ ...p, source_ip: 'auto', multicast_ip: null, interface_ip: 'auto', destination_port: 'auto', rtp_enabled: true })) });
      r = { inputId, staged: blank(), active: blank(), timer: null };
      r.active.transport_params = paramsFromSdp('', legs, null);
      // an SDP written before (bridge restart): active as it is on disk
      const cur = this.inputs.get(inputId);
      if (cur?.sdp) { r.active.master_enable = true; r.active.transport_file = { data: cur.sdp, type: 'application/sdp' }; r.active.transport_params = paramsFromSdp(cur.sdp, legs, null); r.active.sender_id = cur.senderId ?? null; }
      this.rx.set(id, r);
      this.ver(id);
    }
    return r;
  }

  // ---- IS-04 resources

  self() {
    const ifs = localInterfaces();
    return {
      id: this.nodeId, version: this.ver(this.nodeId), label: this.label, description: 'LZ Scopes: ST 2110 / ST 2022-6 receiver and test signal generator', tags: {},
      href: `http://${this.baseHost()}:${this.port}/`, hostname: hostname(),
      api: { versions: [NODE_VER], endpoints: [{ host: this.baseHost(), port: this.port, protocol: 'http', authorization: false }] },
      caps: {}, services: [],
      // no PTP servo here: the clock is the system clock (linuxptp may discipline it, we cannot tell)
      clocks: [{ name: 'clk0', ref_type: 'internal' }],
      interfaces: ifs.map((i) => ({ name: i.name, chassis_id: null, port_id: i.mac && /^([0-9a-f]{2}-){5}[0-9a-f]{2}$/.test(i.mac) ? i.mac : null })),
    };
  }
  device() {
    const base = `http://${this.baseHost()}:${this.port}/x-nmos/connection/${CONN_VER}/`;
    return {
      id: this.deviceId, version: this.ver(this.deviceId), label: 'LZ Scopes', description: 'Network inputs of the scopes and test signals', tags: {},
      type: 'urn:x-nmos:device:generic', node_id: this.nodeId, senders: this.senders().map((s) => s.id), receivers: this.receivers().map((r) => r.id),
      controls: [{ type: `urn:x-nmos:control:sr-ctrl/${CONN_VER}`, href: base, authorization: false }],
    };
  }
  receivers() {
    const ifNames = localInterfaces().map((i) => i.name);
    return this.inputs.list().map((inp) => {
      const id = this.receiverId(inp.id);
      const r = this.receiverState(inp.id);
      return {
        id, version: this.ver(id), label: inp.label, description: 'ST 2110-20 or ST 2022-6 picture into the scopes', tags: {},
        device_id: this.deviceId, transport: TRANSPORT_RTP, interface_bindings: ifNames.slice(0, Math.max(1, inp.legs)),
        subscription: { sender_id: r.active.master_enable ? r.active.sender_id : null, active: !!r.active.master_enable },
        format: 'urn:x-nmos:format:video', caps: { media_types: ['video/raw', 'video/SMPTE2022-6'] },
      };
    });
  }
  /** Generator flows as source/flow/sender triples. */
  genResources() {
    const list = this.generators?.list() ?? [];
    return list.map((g) => {
      const sid = stableId(`${this.seed}|gen|${g.id}|source`), fid = stableId(`${this.seed}|gen|${g.id}|flow`), xid = stableId(`${this.seed}|gen|${g.id}|sender`);
      const core = (id, label) => ({ id, version: this.ver(id), label, description: 'LZ Scopes test signal', tags: {} });
      const f = g.flow;
      const rate = f.rate ? { numerator: f.rate.num, denominator: f.rate.den } : undefined;
      const format = f.kind === 'audio' ? 'urn:x-nmos:format:audio' : f.kind === 'anc' ? 'urn:x-nmos:format:data' : 'urn:x-nmos:format:video';
      const source = { ...core(sid, g.label), caps: {}, device_id: this.deviceId, parents: [], clock_name: 'clk0', format, ...(f.kind === 'audio' ? { channels: Array.from({ length: f.channels }, (_, i) => ({ label: `CH${i + 1}` })) } : { grain_rate: rate }) };
      let flow = { ...core(fid, g.label), source_id: sid, device_id: this.deviceId, parents: [], format };
      if (f.kind === 'video') {
        flow = {
          ...flow, grain_rate: rate, media_type: 'video/raw', frame_width: f.width, frame_height: f.height, interlace_mode: f.interlace ? 'interlaced_tff' : 'progressive', colorspace: f.colorimetry, transfer_characteristic: 'SDR',
          components: [{ name: 'Y', width: f.width, height: f.height, bit_depth: f.depth }, { name: 'Cb', width: f.width / 2, height: f.height, bit_depth: f.depth }, { name: 'Cr', width: f.width / 2, height: f.height, bit_depth: f.depth }],
        };
      } else if (f.kind === 'audio') flow = { ...flow, media_type: 'audio/L24', sample_rate: { numerator: 48000 }, bit_depth: 24 };
      else if (f.kind === 'anc') flow = { ...flow, grain_rate: rate, media_type: 'video/smpte291' };
      else flow = { ...flow, grain_rate: rate, media_type: 'video/SMPTE2022-6' };
      const sender = {
        ...core(xid, g.label), flow_id: fid, transport: TRANSPORT_RTP, device_id: this.deviceId,
        manifest_href: `http://${this.baseHost()}:${this.port}/x-nmos/connection/${CONN_VER}/single/senders/${xid}/transportfile`,
        interface_bindings: localInterfaces().map((i) => i.name).slice(0, g.legs.length), subscription: { receiver_id: null, active: g.running },
      };
      return { gen: g, source, flow, sender };
    });
  }
  senders() { return this.genResources().map((x) => x.sender); }
  collection(kind) {
    if (kind === 'self') return this.self();
    if (kind === 'devices') return [this.device()];
    if (kind === 'receivers') return this.receivers();
    const g = this.genResources();
    if (kind === 'senders') return g.map((x) => x.sender);
    if (kind === 'flows') return g.map((x) => x.flow);
    if (kind === 'sources') return g.map((x) => x.source);
    return null;
  }

  // ---- IS-05

  constraints(legs) {
    const ips = this.ifaceIps();
    return Array.from({ length: legs }, () => ({
      source_ip: {}, multicast_ip: {}, interface_ip: { enum: ['auto', ...ips] }, destination_port: { minimum: 1024, maximum: 65535 }, rtp_enabled: {},
    }));
  }

  /** PATCH staged of a receiver. Returns [status, body]. */
  patchReceiver(id, body) {
    const r = this.rx.get(id);
    if (!r) return [404, err(404, 'receiver not found')];
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return [400, err(400, 'JSON object expected')];
    const legs = this.inputs.get(r.inputId)?.legs ?? 1;
    const s = structuredClone(r.staged);
    if ('sender_id' in body) { if (body.sender_id !== null && !/^[0-9a-f-]{36}$/.test(body.sender_id)) return [400, err(400, 'sender_id: UUID or null')]; s.sender_id = body.sender_id; }
    if ('master_enable' in body) { if (typeof body.master_enable !== 'boolean') return [400, err(400, 'master_enable: boolean')]; s.master_enable = body.master_enable; }
    if ('transport_file' in body) {
      const tf = body.transport_file ?? {};
      if (tf.data !== null && tf.data !== undefined && (typeof tf.data !== 'string' || (tf.type && tf.type !== 'application/sdp'))) return [400, err(400, 'transport_file: SDP text with type application/sdp')];
      if (typeof tf.data === 'string') {
        try { if (!pictureSections(parseSdp2110(tf.data)).primary) return [400, err(400, 'SDP has no ST 2110-20 or ST 2022-6 video section')]; } catch (e) { return [400, err(400, `SDP: ${e.message}`)]; }
      }
      s.transport_file = { data: tf.data ?? null, type: tf.data ? 'application/sdp' : null };
    }
    if ('transport_params' in body) {
      if (!Array.isArray(body.transport_params) || body.transport_params.length !== legs) return [400, err(400, `transport_params: ${legs} entr${legs === 1 ? 'y' : 'ies'}`)];
      for (let i = 0; i < legs; i++) {
        const p = body.transport_params[i] ?? {};
        for (const [k, v] of Object.entries(p)) {
          if (!RECEIVER_PARAMS.includes(k) && !k.startsWith('ext_')) return [400, err(400, `transport_params: unknown ${k}`)];
          if ((k === 'source_ip' || k === 'multicast_ip') && v !== null && v !== 'auto' && !isIpv4(v)) return [400, err(400, `${k}: IPv4 address`)];
          if (k === 'interface_ip' && v !== 'auto' && !this.ifaceIps().includes(v)) return [400, err(400, 'interface_ip: not an interface of this node')];
          if (k === 'destination_port' && v !== 'auto' && !(Number.isInteger(v) && v >= 1024 && v <= 65535)) return [400, err(400, 'destination_port: 1024–65535 or auto')];
          if (k === 'rtp_enabled' && typeof v !== 'boolean') return [400, err(400, 'rtp_enabled: boolean')];
        }
        s.transport_params[i] = { ...s.transport_params[i], ...p };
      }
    }
    const a = body.activation;
    if (a && typeof a === 'object') {
      const mode = a.mode ?? null;
      if (![null, 'activate_immediate', 'activate_scheduled_absolute', 'activate_scheduled_relative'].includes(mode)) return [400, err(400, 'activation.mode')];
      clearTimeout(r.timer); r.timer = null;
      if (mode === null) { s.activation = { mode: null, requested_time: null, activation_time: null }; r.staged = s; return [200, r.staged]; }
      if (mode === 'activate_immediate') {
        r.staged = s;
        const res = this.activate(id);
        if (res) return res;
        const at = taiText(taiNowSec());
        r.active.activation = { mode, requested_time: null, activation_time: at };
        return [200, { ...structuredClone(r.staged), activation: { mode, requested_time: null, activation_time: at } }];
      }
      const req = parseTaiTime(a.requested_time);
      if (req === null) return [400, err(400, 'activation.requested_time: "<s>:<ns>"')];
      const when = mode === 'activate_scheduled_absolute' ? req : taiNowSec() + req;
      s.activation = { mode, requested_time: a.requested_time, activation_time: taiText(when) };
      r.staged = s;
      r.timer = setTimeout(() => { this.activate(id); r.active.activation = structuredClone(r.staged.activation); r.staged.activation = { mode: null, requested_time: null, activation_time: null }; }, Math.max(0, (when - taiNowSec()) * 1000));
      return [202, r.staged];
    }
    r.staged = s;
    return [200, r.staged];
  }

  /** staged → active: write the SDP of the input (or clear it). Returns an error pair or null. */
  activate(id) {
    const r = this.rx.get(id);
    const s = r.staged;
    const legs = this.inputs.get(r.inputId)?.legs ?? 1;
    let sdp = null;
    if (s.master_enable) {
      const base = s.transport_file.data ?? r.active.transport_file.data ?? this.inputs.get(r.inputId)?.sdp ?? null;
      if (!base) return [400, err(400, 'no SDP: send transport_file with the activation')];
      const enabled = s.transport_params.map((p) => p.rtp_enabled !== false);
      if (!enabled.some(Boolean)) sdp = null;
      else sdp = applyTransportParams(base, s.transport_params.map((p) => ({ multicast_ip: p.multicast_ip === 'auto' ? null : p.multicast_ip, source_ip: p.source_ip === 'auto' ? null : p.source_ip, destination_port: p.destination_port === 'auto' ? null : p.destination_port })));
    }
    try { this.inputs.activate(r.inputId, sdp, { senderId: s.sender_id }); } catch (e) { return [400, err(400, e.message)]; }
    const iface = s.transport_params[0]?.interface_ip;
    r.active = {
      ...structuredClone(s),
      transport_file: sdp ? { data: sdp, type: 'application/sdp' } : { data: null, type: null },
      transport_params: paramsFromSdp(sdp ?? '', legs, iface && iface !== 'auto' ? iface : this.ifaceIps()[0] ?? null).map((p, i) => ({ ...p, rtp_enabled: !!sdp && s.transport_params[i]?.rtp_enabled !== false })),
    };
    if (iface && iface !== 'auto') this.inputs.setIface?.(r.inputId, iface);
    this.ver(id, true); this.ver(this.deviceId, false);
    this.pushResource('receiver', this.receivers().find((x) => x.id === id));
    return null;
  }

  // ---- HTTP

  /** Handles /x-nmos/…; returns false for other paths. */
  handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://x');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (!path.startsWith('/x-nmos')) return false;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT, POST, PATCH, HEAD, OPTIONS, DELETE', 'access-control-allow-headers': 'Content-Type, Accept', 'access-control-max-age': '3600' };
    const send = (code, body, extra = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...cors, ...extra }); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.writeHead(200, cors); res.end(); return true; }
    const seg = path.split('/').filter(Boolean); // x-nmos, api, ver, …
    if (seg.length === 1) return send(200, ['node/', 'connection/']), true;
    if (seg[1] === 'node') {
      if (seg.length === 2) return send(200, [`${NODE_VER}/`]), true;
      if (seg[2] !== NODE_VER) return send(404, err(404, 'API version not served')), true;
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, err(405, 'read only')), true;
      if (seg.length === 3) return send(200, ['self/', 'sources/', 'flows/', 'devices/', 'senders/', 'receivers/']), true;
      const c = this.collection(seg[3]);
      if (c === null) return send(404, err(404, 'not found')), true;
      if (seg.length === 4) return send(200, c), true;
      const item = Array.isArray(c) && seg.length === 5 ? c.find((x) => x.id === seg[4]) : null;
      return (item ? send(200, item) : send(404, err(404, 'not found'))), true;
    }
    if (seg[1] === 'connection') {
      if (seg.length === 2) return send(200, [`${CONN_VER}/`]), true;
      if (seg[2] !== CONN_VER) return send(404, err(404, 'API version not served')), true;
      if (seg.length === 3) return send(200, ['bulk/', 'single/']), true;
      if (seg[3] === 'bulk') return send(seg.length === 4 ? 200 : 501, seg.length === 4 ? ['senders/', 'receivers/'] : err(501, 'bulk activation not built')), true;
      if (seg[3] !== 'single') return send(404, err(404, 'not found')), true;
      if (seg.length === 4) return send(200, ['senders/', 'receivers/']), true;
      if (seg[4] === 'receivers') return this.connReceivers(req, seg.slice(5), send), true;
      if (seg[4] === 'senders') return this.connSenders(req, seg.slice(5), send, res, cors), true;
      return send(404, err(404, 'not found')), true;
    }
    send(404, err(404, 'not found'));
    return true;
  }

  connReceivers(req, rest, send) {
    if (!rest.length) return send(200, this.receivers().map((r) => `${r.id}/`));
    const r = this.rx.get(rest[0]);
    if (!r || !this.inputs.get(r.inputId)) return send(404, err(404, 'receiver not found'));
    const legs = this.inputs.get(r.inputId).legs;
    if (rest.length === 1) return send(200, ['constraints/', 'staged/', 'active/', 'transporttype/']);
    const what = rest[1];
    if (what === 'constraints') return send(200, this.constraints(legs));
    if (what === 'transporttype') return send(200, TRANSPORT_RTP);
    if (what === 'active') return send(200, r.active);
    if (what !== 'staged') return send(404, err(404, 'not found'));
    if (req.method === 'GET' || req.method === 'HEAD') return send(200, r.staged);
    if (req.method !== 'PATCH') return send(405, err(405, 'GET or PATCH'));
    return readJson(req, (body) => { const [code, out] = body === undefined ? [400, err(400, 'invalid JSON')] : this.patchReceiver(rest[0], body); send(code, out); });
  }

  connSenders(req, rest, send, res, cors) {
    const list = this.genResources();
    if (!rest.length) return send(200, list.map((x) => `${x.sender.id}/`));
    const g = list.find((x) => x.sender.id === rest[0]);
    if (!g) return send(404, err(404, 'sender not found'));
    if (rest.length === 1) return send(200, ['constraints/', 'staged/', 'active/', 'transportfile/', 'transporttype/']);
    const what = rest[1];
    const params = g.gen.legs.map((l) => ({ source_ip: this.ifaceIps()[0] ?? null, destination_ip: l.host, source_port: 'auto', destination_port: l.port, rtp_enabled: true }));
    const state = { receiver_id: null, master_enable: g.gen.running, activation: { mode: null, requested_time: null, activation_time: null }, transport_params: params };
    if (what === 'transporttype') return send(200, TRANSPORT_RTP);
    if (what === 'constraints') return send(200, params.map(() => ({ source_ip: {}, destination_ip: {}, source_port: {}, destination_port: { minimum: 1024, maximum: 65535 }, rtp_enabled: {} })));
    if (what === 'transportfile') { res.writeHead(200, { 'content-type': 'application/sdp', 'cache-control': 'no-cache', ...cors }); res.end(g.gen.sdp); return; }
    if (what === 'active') return send(200, state);
    if (what !== 'staged') return send(404, err(404, 'not found'));
    if (req.method === 'GET' || req.method === 'HEAD') return send(200, state);
    if (req.method !== 'PATCH') return send(405, err(405, 'GET or PATCH'));
    return readJson(req, async (body) => {
      if (!body || typeof body !== 'object') return send(400, err(400, 'JSON object expected'));
      for (const p of body.transport_params ?? []) for (const k of Object.keys(p ?? {})) if (!SENDER_PARAMS.includes(k) && !k.startsWith('ext_')) return send(400, err(400, `transport_params: unknown ${k}`));
      // only enable/disable and new destinations; activation is always immediate here
      if (body.activation && body.activation.mode && body.activation.mode !== 'activate_immediate') return send(400, err(400, 'only activate_immediate is built for senders'));
      try {
        const legs = (body.transport_params ?? []).map((p, i) => ({ host: isIpv4(p?.destination_ip ?? '') ? p.destination_ip : g.gen.legs[i]?.host, port: Number.isInteger(p?.destination_port) ? p.destination_port : g.gen.legs[i]?.port }));
        await this.generators.update(g.gen.id, { running: typeof body.master_enable === 'boolean' ? body.master_enable : undefined, legs: legs.length ? legs : undefined });
      } catch (e) { return send(400, err(400, e.message)); }
      this.ver(g.sender.id, true);
      const fresh = this.genResources().find((x) => x.sender.id === g.sender.id);
      this.pushResource('sender', fresh?.sender);
      send(200, { ...state, master_enable: fresh?.gen.running ?? false, activation: { mode: body.activation?.mode ?? null, requested_time: null, activation_time: body.activation?.mode ? taiText(taiNowSec()) : null } });
    });
  }

  /** An input changed outside IS-05 (HTTP API, UI): /active and the IS-04 subscription follow. */
  inputChanged(inp) {
    const id = this.receiverId(inp.id);
    const r = this.receiverState(inp.id);
    if ((r.active.transport_file.data ?? null) === (inp.sdp ?? null)) return;
    r.active = { ...r.active, master_enable: !!inp.sdp, sender_id: inp.senderId ?? null, transport_file: inp.sdp ? { data: inp.sdp, type: 'application/sdp' } : { data: null, type: null }, transport_params: paramsFromSdp(inp.sdp ?? '', inp.legs, null).map((p) => ({ ...p, rtp_enabled: !!inp.sdp && p.rtp_enabled })) };
    this.ver(id, true);
    this.pushResource('receiver', this.receivers().find((x) => x.id === id));
  }

  /** Resource set changed (generator added/removed, input list): bump and re-register. */
  changed() { this.ver(this.nodeId, true); this.ver(this.deviceId, true); if (this.reg.state === 'registered') this.registerAll().catch(() => {}); }

  // ---- registration (IS-04 behaviour: registration)

  async post(type, data) {
    const r = await this.fetchImpl(`${this.reg.url.replace(/\/+$/, '')}/x-nmos/registration/${NODE_VER}/resource`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type, data }), signal: AbortSignal.timeout(this.heartbeatMs) });
    return r.status;
  }
  async registerAll() {
    const order = [['node', [this.self()]], ['device', [this.device()]], ['source', this.collection('sources')], ['flow', this.collection('flows')], ['sender', this.collection('senders')], ['receiver', this.collection('receivers')]];
    for (const [type, items] of order) {
      for (const it of items) {
        let st = await this.post(type, it);
        if (type === 'node' && st === 200 && !this.reg.registered.has(it.id)) {
          // a stale entry of an earlier run: delete it, then register afresh
          await this.fetchImpl(`${this.reg.url.replace(/\/+$/, '')}/x-nmos/registration/${NODE_VER}/resource/nodes/${it.id}`, { method: 'DELETE', signal: AbortSignal.timeout(this.heartbeatMs) }).catch(() => {});
          st = await this.post(type, it);
        }
        if (st !== 200 && st !== 201) throw new Error(`registry answered ${st} for ${type}`);
        this.reg.registered.set(it.id, type);
      }
    }
  }
  pushResource(type, data) {
    if (this.reg.state !== 'registered' || !data) return;
    this.post(type, data).catch(() => {});
  }
  async heartbeat() {
    if (!this.reg.url) return;
    try {
      if (this.reg.state !== 'registered') {
        this.reg.registered.clear();
        await this.registerAll();
        this.reg.state = 'registered'; this.reg.error = ''; this.reg.since = Date.now();
        return;
      }
      const r = await this.fetchImpl(`${this.reg.url.replace(/\/+$/, '')}/x-nmos/registration/${NODE_VER}/health/nodes/${this.nodeId}`, { method: 'POST', signal: AbortSignal.timeout(this.heartbeatMs) });
      if (r.status === 404) { this.reg.state = 'idle'; return this.heartbeat(); }
      if (r.status >= 400) throw new Error(`heartbeat ${r.status}`);
    } catch (e) {
      this.reg.state = 'error'; this.reg.error = String(e.message ?? e);
    }
  }
  startRegistration(url) {
    if (url !== undefined) this.reg.url = url;
    clearInterval(this.reg.timer);
    if (!this.reg.url) { this.reg.state = 'off'; return; }
    this.reg.state = 'idle';
    this.heartbeat();
    this.reg.timer = setInterval(() => this.heartbeat(), this.heartbeatMs);
    this.reg.timer.unref?.();
  }
  async stop() {
    clearInterval(this.reg.timer);
    if (this.reg.state === 'registered') await this.fetchImpl(`${this.reg.url.replace(/\/+$/, '')}/x-nmos/registration/${NODE_VER}/resource/nodes/${this.nodeId}`, { method: 'DELETE', signal: AbortSignal.timeout(2000) }).catch(() => {});
    for (const r of this.rx.values()) clearTimeout(r.timer);
    this.mdns?.stop?.();
    await new Promise((ok) => (this.server ? this.server.close(() => ok()) : ok()));
  }
  status() {
    return { nodeId: this.nodeId, port: this.port, host: this.baseHost(), registry: this.reg.url || null, registration: this.reg.state, ...(this.reg.error ? { error: this.reg.error } : {}), receivers: this.receivers().length, senders: this.senders().length };
  }

  /** Own HTTP server for the NMOS APIs (they must be reachable from the network, the bridge often is not). */
  listen(port, host = '0.0.0.0') {
    return new Promise((ok, fail) => {
      this.server = createServer((req, res) => { if (!this.handle(req, res)) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify(err(404, 'not found'))); } });
      this.server.once('error', fail);
      this.server.listen(port, host, () => { this.port = this.server.address().port; this.host = host; ok(this); });
    });
  }

  /** DNS-SD: announce _nmos-node._tcp, browse _nmos-register._tcp when no registry is set. Never fatal. */
  async discover({ browse = true } = {}) {
    try {
      const { Bonjour } = await import('bonjour-service');
      const b = new Bonjour({}, () => {});
      b.publish({ name: this.label, type: 'nmos-node', protocol: 'tcp', port: this.port, txt: { api_proto: 'http', api_ver: NODE_VER, api_auth: 'false' } });
      let found = null;
      if (browse && !this.reg.url) {
        const pick = [];
        b.find({ type: 'nmos-register' }, (s) => {
          const txt = s.txt ?? {};
          if (txt.api_proto && txt.api_proto !== 'http') return;
          if (txt.api_auth === 'true') return;
          if (txt.api_ver && !String(txt.api_ver).split(',').includes(NODE_VER)) return;
          const host = (s.addresses ?? []).find((a) => isIpv4(a)) ?? s.host;
          pick.push({ pri: Number(txt.pri ?? 100), url: `http://${host}:${s.port}` });
          pick.sort((x, y) => x.pri - y.pri);
          if (!found || pick[0].url !== found) { found = pick[0].url; this.startRegistration(found); }
        });
      }
      this.mdns = { stop: () => new Promise((ok) => b.unpublishAll(() => b.destroy(() => ok()))) };
    } catch { /* no mDNS here: a registry URL can still be given */ }
  }
}

function err(code, error, debug = null) { return { code, error, debug }; }

function readJson(req, done) {
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 256 * 1024) req.destroy(); });
  req.on('end', () => { let v; try { v = JSON.parse(body); } catch { v = undefined; } done(v); });
}
