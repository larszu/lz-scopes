#!/usr/bin/env node
// Software receiver for ST 2110-20 and ST 2022-6 (picture) with packet timing (timing.mjs).
// Library (Receiver) and capture helper for the bridge: started as
//   node server/st2110/receiver.mjs --sdp-file <file> [--iface <IPv4>]
// it speaks the helper protocol of docs/frame-protocol.md (INFO, FRAM as v210, STAT) on stdout,
// watches the SDP file (NMOS IS-05 activations rewrite it) and re-joins with the new format.
//
// Stage 1 of #228: plain UDP sockets of Node, software receive time stamps (time of the
// JavaScript callback, not of the network card). Enough for test streams and small pictures;
// 1080p50 (≈ 216 000 packets/s) is beyond one Node thread. Kernel bypass (AF_XDP, DPDK or the
// Media Transport Library) is a later, Linux-only stage (docs/research/st2110-netz.md).

import dgram from 'node:dgram';
import { readFileSync, watchFile, unwatchFile } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseRtp } from '../rtp.mjs';
import { parseSdp2110, pictureSections } from './sdp.mjs';
import { VideoAssembler } from './video.mjs';
import { SdiAssembler } from './sdi.mjs';
import { VideoTiming, FlowStats } from './timing.mjs';
import { createClock } from './clock.mjs';

const isMulticast = (a) => /^(22[4-9]|23\d)\./.test(a ?? '');

/** Merges the two legs of ST 2022-7 by RTP sequence number: the first copy wins. */
export class DupMerger {
  constructor(onPacket) { this.onPacket = onPacket; this.seen = new Set(); this.order = []; this.fromSecondary = 0; this.duplicates = 0; }
  push(leg, buf, t) {
    if (buf.length < 4) return;
    const seq = buf.readUInt16BE(2);
    if (this.seen.has(seq)) { this.duplicates++; return; }
    this.seen.add(seq); this.order.push(seq);
    if (this.order.length > 8192) this.seen.delete(this.order.shift());
    if (leg === 1) this.fromSecondary++;
    this.onPacket(buf, t, leg);
  }
}

/**
 * Opens a picture flow from an SDP text. Callbacks: onInfo(info), onFrame(v210, meta), onError(msg).
 * `socketFactory` and `clock` exist for tests.
 */
export class Receiver {
  constructor(sdpText, { iface = '', onInfo = () => {}, onFrame = () => {}, onError = () => {}, clock = createClock(), socketFactory = () => dgram.createSocket({ type: 'udp4', reuseAddr: true }) } = {}) {
    Object.assign(this, { iface, onInfo, onFrame, onError, clock, socketFactory });
    const sdp = parseSdp2110(sdpText);
    const { primary, secondary } = pictureSections(sdp);
    if (!primary) throw new Error('SDP has no ST 2110-20 or ST 2022-6 video section');
    this.section = primary; this.secondary = secondary; this.sockets = []; this.started = 0; this.lastPacketAt = 0;
    this.merger = new DupMerger((buf, t) => this.onPacket(buf, t));
    if (primary.kind === 'video') {
      if (!primary.pgroup || primary.sampling !== 'YCbCr-4:2:2') throw new Error(`ST 2110-20 ${primary.sampling} ${primary.depth} bit: only YCbCr-4:2:2 8/10/12 bit is received so far`);
      if (!primary.rate) throw new Error('SDP without exactframerate');
      this.assembler = new VideoAssembler({ width: primary.width, height: primary.height, interlace: primary.interlace, sampling: primary.sampling, depth: primary.depth }, (b, m) => this.onFrame(b, m));
      this.timing = new VideoTiming({ rate: primary.rate, height: primary.height, interlace: primary.interlace, tp: primary.tp, troffUs: primary.troffUs, cmax: primary.cmax, maxUdp: primary.maxUdp }, { epochSec: clock.epochSec });
      this.info = {
        width: primary.width, height: primary.height, fpsNum: primary.rate.num, fpsDen: primary.rate.den, pixel: 'v210',
        matrix: primary.matrix ?? (primary.height <= 576 ? 'bt601' : 'bt709'), range: primary.fullRange ? 'pc' : 'tv', transfer: primary.transfer, primaries: primary.primaries ?? 'unknown',
        name: `ST 2110-20 ${primary.width}×${primary.height}${primary.interlace ? 'i' : 'p'} ${primary.sampling} ${primary.depth} bit${primary.tcs !== 'SDR' ? ` ${primary.tcs}` : ''}`,
        interlaced: primary.interlace, st2110: { kind: 'video', sampling: primary.sampling, depth: primary.depth, colorimetry: primary.colorimetry, tcs: primary.tcs, tp: primary.tp },
      };
    } else {
      this.timing = new FlowStats({ epochSec: clock.epochSec });
      this.assembler = new SdiAssembler({
        onFrame: (b, m) => this.onFrame(b, m),
        onFormat: (g) => {
          this.info = { width: g.width, height: g.height, fpsNum: g.rate[0], fpsDen: g.rate[1], pixel: 'v210', matrix: 'bt709', range: 'tv', transfer: 'unknown', primaries: 'unknown', name: `ST 2022-6 ${g.name}`, interlaced: !!g.interlace, st2110: { kind: 'sdi' } };
          this.onInfo(this.info);
        },
      });
      this.info = null; // known from the first payload header
    }
  }
  async start() {
    this.started = this.clock.now();
    const legs = [this.section, this.secondary].filter(Boolean);
    await Promise.all(legs.map((leg, i) => this.open(leg, i)));
    if (this.info) this.onInfo(this.info);
    return this;
  }
  open(leg, index) {
    return new Promise((ok) => {
      const s = this.socketFactory();
      s.on('error', (e) => this.onError(`UDP ${leg.port}: ${e.message}`));
      s.on('message', (buf) => this.merger.push(index, buf, this.clock.now()));
      const mc = isMulticast(leg.group);
      // binding to the group filters other groups on the same port (Linux, macOS); Windows needs 0.0.0.0
      s.bind({ port: leg.port, address: mc && process.platform !== 'win32' ? leg.group : '0.0.0.0', exclusive: false }, () => {
        try { s.setRecvBufferSize(32 * 1024 * 1024); } catch { /* the system may cap it */ }
        if (mc) {
          try {
            if (leg.source) s.addSourceSpecificMembership(leg.source, leg.group, this.iface || undefined);
            else s.addMembership(leg.group, this.iface || undefined);
          } catch (e) { this.onError(`multicast ${leg.group}: ${e.message}`); }
        }
        this.sockets.push(s);
        ok();
      });
    });
  }
  onPacket(buf, t) {
    const pkt = parseRtp(buf);
    if (!pkt) return;
    this.lastPacketAt = t;
    this.timing.packet(t, pkt, buf.length);
    this.assembler.push(pkt);
  }
  recvBuffer() { try { return this.sockets[0]?.getRecvBufferSize() ?? null; } catch { return null; } }
  stop() { for (const s of this.sockets) { try { s.close(); } catch { /* */ } } this.sockets = []; }
  status() {
    const a = this.assembler;
    return {
      kind: this.section.kind, group: this.section.group, port: this.section.port, source: this.section.source, dup: !!this.secondary,
      frames: a.frames, broken: a.broken, packets: a.packets, malformed: a.malformed ?? 0, trsErrors: a.trsErrors ?? 0,
      secondaryUsed: this.merger.fromSecondary, legDuplicates: this.merger.duplicates, recvBuffer: this.recvBuffer(),
      clock: this.clock.source, timing: this.timing.status(),
    };
  }
}

// ---- helper process

function record(tag, body) {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  const h = Buffer.alloc(8);
  h.write(tag.padEnd(4, ' '), 0, 'ascii'); h.writeUInt32LE(b.length, 4);
  process.stdout.write(Buffer.concat([h, b]));
}

async function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const file = arg('--sdp-file');
  const iface = arg('--iface') ?? '';
  if (!file) { record('ERR ', { message: 'ST 2110 receiver: --sdp-file missing', code: 'st2110.noSdp' }); process.exit(2); }
  let rx = null, last = '';
  const open = async () => {
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { /* not there yet */ }
    if (text === last) return;
    last = text;
    rx?.stop(); rx = null;
    if (!text.trim()) { record('STAT', { message: 'No SDP active for this input', code: 'st2110.noSdp' }); return; }
    try {
      rx = new Receiver(text, {
        iface,
        onInfo: (info) => record('INFO', info),
        onFrame: (b) => record('FRAM', b),
        onError: (m) => record('STAT', { message: m, code: 'st2110.socket', params: { reason: m } }),
      });
      await rx.start();
    } catch (e) {
      rx = null;
      record('STAT', { message: `SDP not usable: ${e.message}`, code: 'st2110.badSdp', params: { reason: e.message } });
    }
  };
  await open();
  watchFile(file, { interval: 250 }, () => { open(); });
  const timer = setInterval(() => {
    if (!rx) return;
    const st = rx.status();
    record('STAT', { message: 'ST 2110 counters', code: 'st2110.stats', params: st });
    if (rx.clock.now() - Math.max(rx.lastPacketAt, rx.started) > 2) record('STAT', { message: `No packets on ${st.group}:${st.port}`, code: 'st2110.noPackets', params: { group: String(st.group), port: st.port } });
  }, 1000);
  const end = () => { clearInterval(timer); unwatchFile(file); rx?.stop(); process.exit(0); };
  process.on('SIGTERM', end); process.on('SIGINT', end);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
