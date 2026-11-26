// pcap capture of ST 2110 flows (#232): snapshot of all flows of a service with a length and
// size limit, and a rolling capture (ring of segment files on disk) saved on request.
//
// Format: classic pcap, nanosecond variant (pcap-savefile(5), tcpdump.org: magic 0xa1b23c4d,
// version 2.4, snaplen, link type; record header ts_sec, ts_nsec, incl_len, orig_len), link type
// 228 LINKTYPE_IPV4 (tcpdump.org/linktypes.html: "Raw IPv4; the packet begins with an IPv4 header").
//
// The bridge receives over normal UDP sockets, not a raw socket: it sees the UDP payload, the
// sender address/port and knows its own group/port. The IPv4 and UDP headers in the file are
// rebuilt from these (RFC 791 header with checksum, RFC 768 UDP header, checksum 0 = none).
// TTL, DSCP, IP ID and the Ethernet layer are NOT the ones on the wire, and the time stamps are
// software receive times of this process (no hardware time stamps, #231). Captures can contain
// facility addresses: they are written to the temp folder only, never into the repository.

import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const LINKTYPE_IPV4 = 228;
export const PCAP_DIR = () => join(process.env.LZS_PCAP_DIR || tmpdir(), 'lz-scopes-pcap');

/** 24-byte pcap file header (nanosecond time stamps, little endian). */
export function pcapHeader(snaplen = 65535, linktype = LINKTYPE_IPV4) {
  const b = Buffer.alloc(24);
  b.writeUInt32LE(0xa1b23c4d, 0); b.writeUInt16LE(2, 4); b.writeUInt16LE(4, 6);
  b.writeInt32LE(0, 8); b.writeUInt32LE(0, 12); b.writeUInt32LE(snaplen, 16); b.writeUInt32LE(linktype, 20);
  return b;
}

const ip4 = (a) => Buffer.from(String(a).split('.').map(Number));

/** RFC 1071 one's-complement checksum of a header. */
export function ipChecksum(h) {
  let s = 0;
  for (let i = 0; i < h.length; i += 2) s += h.readUInt16BE(i);
  while (s >> 16) s = (s & 0xffff) + (s >> 16);
  return ~s & 0xffff;
}

let ipId = 0;
/** IPv4 + UDP header around a payload (rebuilt, see the file head). */
export function ipv4Udp({ src, srcPort, dst, dstPort, payload, ttl = 64 }) {
  const h = Buffer.alloc(28);
  h[0] = 0x45; h[1] = 0; h.writeUInt16BE(28 + payload.length, 2); h.writeUInt16BE(ipId = (ipId + 1) & 0xffff, 4);
  h.writeUInt16BE(0x4000, 6); h[8] = ttl; h[9] = 17;
  ip4(src).copy(h, 12); ip4(dst).copy(h, 16);
  h.writeUInt16BE(ipChecksum(h.subarray(0, 20)), 10);
  h.writeUInt16BE(srcPort & 0xffff, 20); h.writeUInt16BE(dstPort & 0xffff, 22); h.writeUInt16BE(8 + payload.length, 24); h.writeUInt16BE(0, 26);
  return Buffer.concat([h, payload]);
}

/** One pcap record: 16-byte header (ns time stamp) + frame. */
export function pcapRecord(epochNs, frame, snaplen = 65535) {
  const incl = Math.min(frame.length, snaplen);
  const r = Buffer.alloc(16);
  r.writeUInt32LE(Number(epochNs / 1_000_000_000n), 0); r.writeUInt32LE(Number(epochNs % 1_000_000_000n), 4);
  r.writeUInt32LE(incl, 8); r.writeUInt32LE(frame.length, 12);
  return Buffer.concat([r, frame.subarray(0, incl)]);
}

/** Wall clock in ns (UTC) for the record headers: the monotonic clock, anchored once to Date.now(). */
const BASE_NS = BigInt(Date.now()) * 1_000_000n - BigInt(Math.round(performance.now() * 1e6));
export const epochNs = (perfMs = performance.now()) => BASE_NS + BigInt(Math.round(perfMs * 1e6));

/** Snapshot: collects records until `seconds` or `maxBytes` is reached, then resolves a pcap Buffer. */
export class Snapshot {
  constructor({ seconds = 5, maxBytes = 50 * 1024 * 1024 } = {}) {
    this.seconds = Math.min(60, Math.max(0.1, seconds)); this.maxBytes = Math.min(500 * 1024 * 1024, Math.max(1024, maxBytes));
    this.parts = [pcapHeader()]; this.bytes = 24; this.packets = 0; this.full = false;
    this.done = new Promise((res) => { this.resolve = res; });
    this.timer = setTimeout(() => this.finish('time'), this.seconds * 1000);
  }
  add(rec) {
    if (this.full) return;
    if (this.bytes + rec.length > this.maxBytes) { this.finish('size'); return; }
    this.parts.push(rec); this.bytes += rec.length; this.packets++;
  }
  finish(reason = 'stop') {
    if (this.full) return;
    this.full = true; clearTimeout(this.timer);
    this.resolve({ data: Buffer.concat(this.parts), packets: this.packets, reason });
  }
}

/**
 * Rolling capture: segment files of `segmentSeconds` in a folder, at most `seconds` / `maxBytes`
 * kept (oldest segment deleted first). `save()` joins the segments into one pcap.
 */
export class RingCapture {
  constructor({ dir, seconds = 60, maxBytes = 200 * 1024 * 1024, segmentSeconds = 5, now = () => Date.now() } = {}) {
    this.seconds = Math.min(3600, Math.max(5, seconds)); this.maxBytes = Math.min(4 * 1024 ** 3, Math.max(1024 * 1024, maxBytes));
    this.segmentSeconds = segmentSeconds; this.now = now; this.dir = dir;
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    this.segments = []; this.cur = null; this.pending = []; this.pendingBytes = 0; this.packets = 0; this.n = 0;
    this.timer = setInterval(() => this.flush(), 250);
  }
  add(rec) {
    const t = this.now();
    if (!this.cur || t - this.cur.start >= this.segmentSeconds * 1000) this.roll(t);
    this.pending.push(rec); this.pendingBytes += rec.length; this.packets++;
    if (this.pendingBytes > 1024 * 1024) this.flush();
  }
  roll(t) {
    this.flush();
    const file = join(this.dir, `seg-${String(this.n++).padStart(6, '0')}.pcap`);
    appendFileSync(file, pcapHeader());
    this.cur = { file, start: t, bytes: 24 };
    this.segments.push(this.cur);
    this.trim(t);
  }
  flush() {
    if (!this.cur || !this.pending.length) return;
    const data = Buffer.concat(this.pending);
    appendFileSync(this.cur.file, data);
    this.cur.bytes += data.length; this.pending = []; this.pendingBytes = 0;
    this.trim(this.now());
  }
  trim(t) {
    const total = () => this.segments.reduce((s, x) => s + x.bytes, 0);
    while (this.segments.length > 1 && (t - this.segments[1].start > this.seconds * 1000 || total() > this.maxBytes)) {
      rmSync(this.segments.shift().file, { force: true });
    }
  }
  get bytes() { return this.segments.reduce((s, x) => s + x.bytes, 0) + this.pendingBytes; }
  status() { return { seconds: this.seconds, maxBytes: this.maxBytes, bytes: this.bytes, packets: this.packets, spanS: this.segments.length ? (this.now() - this.segments[0].start) / 1000 : 0 }; }
  /** One pcap of everything in the ring (the segments without their own file headers). */
  save() {
    this.flush();
    const parts = [pcapHeader()];
    for (const s of this.segments) { if (existsSync(s.file)) parts.push(readFileSync(s.file).subarray(24)); }
    return Buffer.concat(parts);
  }
  stop() { clearInterval(this.timer); this.flush(); rmSync(this.dir, { recursive: true, force: true }); }
}

/** Saved captures for download: name → path, only files this module wrote (`lz-scopes-*.pcap`). */
export const SAVED = /^lz-scopes-[\w.-]{1,80}\.pcap$/;
export function writeSaved(name, data) {
  const dir = join(PCAP_DIR(), 'saved');
  mkdirSync(dir, { recursive: true });
  // keep the folder bounded: at most 20 files
  const files = readdirSync(dir).filter((f) => SAVED.test(f)).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => a.t - b.t);
  while (files.length >= 20) rmSync(join(dir, files.shift().f), { force: true });
  const fd = openSync(join(dir, name), 'w');
  try { writeSync(fd, data); } finally { closeSync(fd); }
  return join(dir, name);
}
export function savedPath(name) {
  if (!SAVED.test(name ?? '')) return null;
  const p = join(PCAP_DIR(), 'saved', name);
  return existsSync(p) ? p : null;
}

/** Reads a pcap written here back into records (tests, and a check of the format). */
export function readPcap(buf) {
  if (buf.readUInt32LE(0) !== 0xa1b23c4d) throw new Error('not a nanosecond pcap');
  const out = { linktype: buf.readUInt32LE(20), records: [] };
  for (let o = 24; o + 16 <= buf.length;) {
    const incl = buf.readUInt32LE(o + 8);
    out.records.push({ sec: buf.readUInt32LE(o), nsec: buf.readUInt32LE(o + 4), orig: buf.readUInt32LE(o + 12), data: buf.subarray(o + 16, o + 16 + incl) });
    o += 16 + incl;
  }
  return out;
}
