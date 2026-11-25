// st2110: sources of the bridge (#226, #227, #230, #232): a service of ST 2110 flows (audio
// 2110-30/-31, ancillary 2110-40, fast metadata 2110-41, each optionally with a ST 2022-7 second
// path) on one frame-protocol socket. Audio goes out as protocol 2 sound packets (LZA1, f32, no
// resampling) into the browser's DSP chain, ANC packets as {type:'vanc'} like the DeckLink helper
// (src/vanc.ts), counters and the 2022-7 evaluation in {type:'stats', st2110}. pcap capture per
// service: messages {type:'pcap', …} on the socket and the HTTP API in server/index.mjs.
//
//   ← {type:'pcap', cmd:'snapshot', seconds?, mb?} | {type:'pcap', cmd:'ring', mode:'on'|'off', seconds?, mb?}
//     {type:'pcap', cmd:'save'}
//   → {type:'pcap', state:'capturing'|'saved'|'ring'|'error', file?, packets?, bytes?, ring?, message?}

import { join } from 'node:path';
import { AudioPacketizer } from './proto2.mjs';
import { parseSt2110Url } from './sdp.mjs';
import { FlowReceiver, udwHex } from './st2110.mjs';
import { PCAP_DIR, RingCapture, Snapshot, epochNs, ipv4Udp, pcapRecord, writeSaved } from './pcap.mjs';
import { rtpCheck } from './ptp.mjs';
import { bmsg, toMsg } from './messages.mjs';

/** Running services by id (for the HTTP API). */
export const services = new Map();
let nextId = 1;

/**
 * One service: receivers, pcap taps, the socket to the browser (optional: tests use it bare).
 * `ptpNow()` → { seconds, ref } (server/index.mjs clockNow) for the ANC time reference.
 */
export class St2110Service {
  constructor(cfg, { send = () => {}, sendBin = () => {}, ptpNow = null, allowCapture = true } = {}) {
    this.id = `s${nextId++}`; this.cfg = cfg; this.send = send; this.sendBin = sendBin; this.ptpNow = ptpNow; this.allowCapture = allowCapture;
    this.snapshot = null; this.ring = null; this.receivers = [];
    const audio = cfg.flows.find((f) => f.essence.startsWith('audio'));
    this.audioFlow = audio ?? null;
    this.packetizer = audio ? new AudioPacketizer(audio.clock, audio.channels, (b) => this.sendBin(b)) : null;
    this.audioGaps = 0;
    this.lastVanc = 0; this.lastVancKey = '';
    for (const f of cfg.flows) {
      const r = new FlowReceiver(f, {
        iface: cfg.iface, iface2: cfg.iface2,
        onRaw: (i, b, rinfo) => this.tap(f, i, b, rinfo),
        onAudio: f === audio ? (pcm, index) => this.audio(pcm, index) : undefined,
        onAnc: f.essence === 'anc40' ? (a) => this.anc(f, a) : undefined,
        onError: (m) => this.send({ type: 'stats', message: m.message, code: m.code, params: m.params }),
      });
      this.receivers.push(r);
    }
    services.set(this.id, this);
  }
  start() { for (const r of this.receivers) r.start(); return this; }
  stop() {
    for (const r of this.receivers) r.stop();
    this.snapshot?.finish('stop'); this.ring?.stop(); this.ring = null;
    this.packetizer?.flush();
    services.delete(this.id);
  }
  /** info message of the frame protocol: sound only (width 0), proto 2 */
  info() {
    const a = this.audioFlow, r = this.receivers.find((x) => x.flow === a);
    return {
      type: 'info', proto: 2, width: 0, height: 0, sourceWidth: 0, sourceHeight: 0, depth: 8, fps: 0, codec: 'st2110',
      audio: a ? {
        sampleRate: a.clock, channels: a.channels, format: 'f32le', layout: r?.layout ?? '', codec: a.encoding, sourceSampleRate: a.clock, sourceChannels: a.channels,
        channelOrder: r?.order.map((g) => ({ symbol: g.symbol, channels: g.channels, undeclared: !!g.undeclared })) ?? [],
      } : null,
      st2110: { id: this.id, flows: this.cfg.flows.map((f) => ({ essence: f.essence, encoding: f.encoding, clock: f.clock, channels: f.channels, paths: f.paths.length, name: f.name })), capture: this.allowCapture },
    };
  }
  audio(pcm, index) {
    const p = this.packetizer;
    const expected = p.index + p.bytes / p.frameBytes;
    if (index !== expected) {
      // a gap after the 2022-7 merge (lost on every path): the sample index jumps (docs/frame-protocol.md)
      p.flush(); p.index = index; this.audioGaps++;
    }
    p.push(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  }
  anc(flow, { packets, ts, field }) {
    const list = packets.slice(0, 64).map((x) => ({ did: x.did, sdid: x.sdid, line: x.line, stream: x.s ? x.stream : 0, data: udwHex(x.udw), ...(x.checksumOk ? {} : { checksum: false }) }));
    const key = list.map((x) => `${x.did}/${x.sdid}/${x.line}`).join(',');
    const now = Date.now();
    // like the DeckLink helper: when the set changes, else at most 4 times a second
    if (key === this.lastVancKey && now - this.lastVanc < 250) return;
    this.lastVanc = now; this.lastVancKey = key;
    // time reference: RTP timestamp against PTP time (ST 2110-10 §7.3), frame rate from exactframerate
    const rate = /^(\d+)(?:\/(\d+))?$/.exec(flow.fmtp?.exactframerate ?? '');
    let rtp = { ts, field };
    const t = this.ptpNow?.();
    if (t && rate) {
      const c = rtpCheck(ts, t.seconds, Number(rate[1]), Number(rate[2] ?? 1), flow.clock);
      rtp = { ...rtp, lagMs: c.lagSeconds * 1000, gridTicks: c.gridTicks, ref: t.ref };
    }
    this.send({ type: 'vanc', packets: list, rtp });
  }
  tap(flow, i, b, rinfo) {
    if (!this.snapshot && !this.ring) return;
    const p = flow.paths[i];
    const rec = pcapRecord(epochNs(), ipv4Udp({ src: rinfo?.address ?? '0.0.0.0', srcPort: rinfo?.port ?? 0, dst: p.dest, dstPort: p.port, payload: b }));
    this.snapshot?.add(rec);
    this.ring?.add(rec);
  }
  stats() {
    return {
      flows: this.receivers.map((r) => r.status()),
      audioGaps: this.audioGaps, audioSent: this.packetizer?.packets ?? 0,
      capture: { snapshot: !!this.snapshot, ring: this.ring ? this.ring.status() : null },
    };
  }
  fileName(kind) { return `lz-scopes-${this.id}-${kind}-${new Date().toISOString().replace(/[:]/g, '-').replace(/\..*$/, '')}.pcap`; }
  /** pcap snapshot of all flows (resolves with the saved file name) */
  async takeSnapshot({ seconds = 5, mb = 50 } = {}) {
    if (this.snapshot) throw Object.assign(new Error('A snapshot is already running'), { code: 'st2110.busy' });
    this.snapshot = new Snapshot({ seconds, maxBytes: mb * 1024 * 1024 });
    const r = await this.snapshot.done;
    this.snapshot = null;
    const name = this.fileName('snapshot');
    writeSaved(name, r.data);
    return { name, data: r.data, packets: r.packets, reason: r.reason };
  }
  setRing(on, { seconds = 60, mb = 200 } = {}) {
    if (!on) { this.ring?.stop(); this.ring = null; return null; }
    if (!this.ring) this.ring = new RingCapture({ dir: join(PCAP_DIR(), `ring-${process.pid}-${this.id}`), seconds, maxBytes: mb * 1024 * 1024 });
    return this.ring.status();
  }
  saveRing() {
    if (!this.ring) throw Object.assign(new Error('Rolling capture is off'), { code: 'st2110.ringOff' });
    const data = this.ring.save();
    const name = this.fileName('ring');
    writeSaved(name, data);
    return { name, data, bytes: data.length };
  }
  /** pcap commands from the browser (on the stream socket) */
  async handle(m) {
    if (m?.type !== 'pcap') return;
    if (!this.allowCapture) { this.send({ type: 'pcap', state: 'error', ...bmsg('st2110.captureDenied', 'Capture only from this computer or with the control token') }); return; }
    try {
      if (m.cmd === 'snapshot') {
        this.send({ type: 'pcap', state: 'capturing', seconds: Number(m.seconds) || 5 });
        const r = await this.takeSnapshot({ seconds: Number(m.seconds) || 5, mb: Number(m.mb) || 50 });
        this.send({ type: 'pcap', state: 'saved', file: r.name, packets: r.packets, bytes: r.data.length, reason: r.reason });
      } else if (m.cmd === 'ring') {
        const st = this.setRing(m.mode === 'on', { seconds: Number(m.seconds) || 60, mb: Number(m.mb) || 200 });
        this.send({ type: 'pcap', state: 'ring', ring: st });
      } else if (m.cmd === 'save') {
        const r = this.saveRing();
        this.send({ type: 'pcap', state: 'saved', file: r.name, bytes: r.bytes });
      }
    } catch (e) { this.send({ type: 'pcap', state: 'error', ...toMsg(e) }); }
  }
}

/** Frame-protocol socket for an st2110: URL. */
export function startSt2110(ws, url, { ptpNow, allowCapture, fail }) {
  const cfg = parseSt2110Url(url);
  if (!cfg) return fail(ws, bmsg('st2110.badUrl', 'Invalid st2110: source (SDP or audio=/anc= with address:port)'));
  const open = () => ws.readyState === ws.OPEN;
  const svc = new St2110Service(cfg, {
    ptpNow, allowCapture,
    send: (m) => { if (open()) ws.send(JSON.stringify(m)); },
    // sound is never dropped (docs/frame-protocol.md)
    sendBin: (b) => { if (open()) ws.send(b); },
  });
  ws.send(JSON.stringify(svc.info()));
  svc.start();
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    let m;
    try { m = JSON.parse(String(data)); } catch { return; }
    void svc.handle(m);
  });
  const stats = setInterval(() => {
    if (!open()) return;
    ws.send(JSON.stringify({ type: 'stats', sent: 0, dropped: 0, audioSent: svc.packetizer?.packets ?? 0, audioDropped: 0, audioGaps: svc.audioGaps, st2110: svc.stats() }));
  }, 1000);
  ws.on('close', () => { clearInterval(stats); svc.stop(); });
  return svc;
}

