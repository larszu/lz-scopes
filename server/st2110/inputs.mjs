// Network inputs `st2110:<id>` (#228, #240): each input is an SDP file that the receiver helper
// (receiver.mjs) watches. NMOS IS-05 activations, the HTTP API (/api/st2110) and the UI write it;
// an empty file means "not connected". The files live in the bridge's state folder, so a
// connection survives a restart of the bridge.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSdp2110, pictureSections } from './sdp.mjs';

export const INPUT_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

export class NetInputs {
  /** `count` inputs net1 … netN; `legs` 2 = each input takes ST 2022-7 (two network legs). */
  constructor({ dir = join(tmpdir(), 'lz-scopes-st2110'), count = 2, legs = 2, onChange = () => {} } = {}) {
    this.dir = dir; this.onChange = onChange;
    mkdirSync(dir, { recursive: true });
    this.inputs = new Map();
    for (let i = 1; i <= Math.max(1, Math.min(16, count)); i++) {
      const id = `net${i}`;
      let sdp = '';
      try { sdp = readFileSync(this.file(id), 'utf8'); } catch { /* new */ }
      this.inputs.set(id, { id, label: `Network input ${i}`, legs, sdp: sdp.trim() ? sdp : null, senderId: null, iface: '', since: null, stats: null, summary: summary(sdp) });
    }
  }
  file(id) { return join(this.dir, `${id}.sdp`); }
  get(id) { return this.inputs.get(id) ?? null; }
  list() { return [...this.inputs.values()]; }
  /** Activate an SDP (null = disconnect). Throws on an SDP without a picture section. */
  activate(id, sdp, { senderId = null } = {}) {
    const inp = this.get(id);
    if (!inp) throw new Error(`no input ${id}`);
    if (sdp !== null) {
      if (typeof sdp !== 'string' || sdp.length > 65536) throw new Error('SDP missing or too long');
      if (!pictureSections(parseSdp2110(sdp)).primary) throw new Error('SDP has no ST 2110-20 or ST 2022-6 video section');
    }
    // write next to it and rename: the watching receiver never reads half a file
    const tmp = `${this.file(id)}.tmp`;
    writeFileSync(tmp, sdp ?? '');
    renameSync(tmp, this.file(id));
    Object.assign(inp, { sdp, senderId, since: sdp ? Date.now() : null, stats: null, summary: summary(sdp ?? '') });
    this.onChange(inp);
    return inp;
  }
  setIface(id, iface) { const inp = this.get(id); if (inp) inp.iface = iface; }
  setStats(id, stats) { const inp = this.get(id); if (inp) inp.stats = { ...stats, at: Date.now() }; }
  /** Public view (API, UI). */
  view() {
    return this.list().map((i) => ({ id: i.id, url: `st2110:${i.id}`, label: i.label, legs: i.legs, connected: !!i.sdp, senderId: i.senderId, since: i.since, summary: i.summary, stats: i.stats }));
  }
}

/** Short description of an SDP for lists: format, group:port, 2022-7. */
export function summary(sdp) {
  if (!sdp || !sdp.trim()) return null;
  try {
    const s = parseSdp2110(sdp);
    const { primary: p, secondary } = pictureSections(s);
    if (!p) return null;
    const fmt = p.kind === 'video' ? `${p.width}×${p.height}${p.interlace ? 'i' : 'p'} ${p.rate ? (p.rate.num / p.rate.den).toFixed(2).replace(/\.00$/, '') : '?'} ${p.sampling} ${p.depth} bit${p.tcs && p.tcs !== 'SDR' ? ` ${p.tcs}` : ''}` : 'ST 2022-6';
    return { name: s.name, kind: p.kind, format: fmt, address: `${p.group}:${p.port}`, source: p.source, dup: !!secondary };
  } catch { return null; }
}
