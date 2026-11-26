// SDP for ST 2110 receive (#226, #227, #230): the fields a receiver needs from an SDP object,
// and the manual form of the st2110: source URL. Own code, sources opened (docs/research/st2110-empfang.md):
//
// - RFC 4566 / RFC 8866 (SDP): v=, o=, s=, c=<nettype> <addrtype> <addr>[/<ttl>], m=<media> <port>
//   <proto> <fmt>, a=rtpmap:<pt> <encoding>/<clock>[/<channels>], a=fmtp:<pt> <params>, a=ptime.
// - RFC 4570: a=source-filter: incl IN IP4 <dest> <source…> (source-specific multicast).
// - RFC 5888 + RFC 7104: session-level a=group:DUP <mid> <mid>, media-level a=mid:<id> – how
//   ST 2110-10:2022 §8.5 signals ST 2022-7 duplicates.
// - SMPTE ST 2110-30:2025 §6.2.2 + Table 1: channel-order=SMPTE2110.(<groups>), symbols M, DM,
//   ST, LtRt, 51, 71, 222, SGRP, U01…U64; channels not declared are Undefined.
// - SMPTE ST 2110-31:2022 §6: a=rtpmap:<pt> AM824/<rate>/<nchan>, <nchan> even; Table 2 adds
//   the symbol AES3 (2 subframe sequences).
// - RFC 8331 §3/§4 + ST 2110-40:2023 §6: video/smpte291, fmtp DID_SDID={0x..,0x..} (repeatable),
//   VPID_Code, SSN, TM (LLTM|CTM), exactframerate.
// - ST 2110-41:2026 §6/§9: application/ST2110-41, fmtp SSN, DIT=<hex,hex,…>.

/** ST 2110-30 Table 1 + ST 2110-31 Table 2: channels per grouping symbol and their names. */
export const CHANNEL_GROUPS = {
  M: ['M'], DM: ['M1', 'M2'], ST: ['L', 'R'], LtRt: ['Lt', 'Rt'],
  51: ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'], 71: ['L', 'R', 'C', 'LFE', 'Lss', 'Rss', 'Lrs', 'Rrs'],
  // 22.2: order per ST 2036-2 Table 1 (not opened) – names left as numbers
  222: Array.from({ length: 24 }, (_, i) => String(i + 1)),
  SGRP: ['1', '2', '3', '4'], AES3: ['A', 'B'],
};

/**
 * channel-order=SMPTE2110.(51,ST) → [{ symbol, channels: [names] }]. Unknown symbols and
 * everything after an error count as Undefined; channels beyond the declared ones are
 * appended as one Undefined group (ST 2110-30 §6.2.2).
 */
export function parseChannelOrder(text, channels) {
  const groups = [];
  const m = /^SMPTE2110\.\(([^)]*)\)$/.exec((text ?? '').trim());
  if (m) {
    for (const raw of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      const u = /^U(\d{2})$/.exec(raw);
      if (u && Number(u[1]) >= 1 && Number(u[1]) <= 64) groups.push({ symbol: raw, channels: Array.from({ length: Number(u[1]) }, (_, i) => `U${i + 1}`) });
      else if (CHANNEL_GROUPS[raw]) groups.push({ symbol: raw, channels: [...CHANNEL_GROUPS[raw]] });
      else break;
    }
  }
  let n = groups.reduce((s, g) => s + g.channels.length, 0);
  // more declared than present: cut; fewer: the rest is Undefined
  while (n > channels && groups.length) { const g = groups.pop(); n -= g.channels.length; }
  if (n < channels) groups.push({ symbol: `U${String(channels - n).padStart(2, '0')}`, channels: Array.from({ length: channels - n }, (_, i) => `U${i + 1}`), undeclared: true });
  return groups;
}

/** ffmpeg layout name for the channel-order when it is a single known group (src/audio/dsp/layouts.ts). */
export function layoutOf(groups) {
  if (groups.length !== 1) return '';
  return { M: 'mono', ST: 'stereo', LtRt: 'stereo', 51: '5.1', 71: '7.1(wide-side)' }[groups[0].symbol] ?? '';
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export const isIpv4 = (a) => IPV4.test(a ?? '') && a.split('.').every((x) => Number(x) <= 255);

/** a=fmtp parameters: `k=v; k=v` (DID_SDID may repeat → array). */
export function parseFmtp(text) {
  const out = {};
  for (const part of (text ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    const k = i < 0 ? part : part.slice(0, i).trim(), v = i < 0 ? '' : part.slice(i + 1).trim();
    if (k === 'DID_SDID') (out.DID_SDID ??= []).push(v);
    else out[k] = v;
  }
  return out;
}

/** DID_SDID={0x61,0x02} → { did: 0x61, sdid: 0x02 } (RFC 8331 §4 ABNF). */
export function parseDidSdid(v) {
  const m = /^\{\s*0x([0-9a-fA-F]{1,2})\s*,\s*0x([0-9a-fA-F]{1,2})\s*\}$/.exec(v ?? '');
  return m ? { did: parseInt(m[1], 16), sdid: parseInt(m[2], 16) } : null;
}

/** Essence of a media description: audio30 (L16/L24), audio31 (AM824), anc40, fmx41, or null. */
export function essenceOf(media, encoding) {
  const e = (encoding ?? '').toUpperCase();
  if (media === 'audio' && (e === 'L16' || e === 'L24')) return 'audio30';
  if (media === 'audio' && e === 'AM824') return 'audio31';
  if (media === 'video' && e === 'SMPTE291') return 'anc40';
  if ((media === 'application' || media === 'video') && e === 'ST2110-41') return 'fmx41';
  return null;
}

/**
 * Parse an SDP object. Returns { name, groups: [{ semantics, mids }], media: [...] } where each
 * media entry is { media, port, proto, pt, encoding, clock, channels, ptime, fmtp, dest, ttl,
 * source, mid, essence }. Lines it does not need are ignored; throws on a missing v=0 line.
 */
export function parseSdp(text) {
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== 'v=0') throw new Error('SDP must start with v=0');
  const session = { name: '', groups: [], dest: '', ttl: null, filters: [], media: [] };
  let cur = null;
  for (const l of lines) {
    const type = l[0], val = l.slice(2);
    if (l[1] !== '=') continue;
    const tgt = cur ?? session;
    if (type === 's' && !cur) session.name = val;
    else if (type === 'c') {
      const m = /^IN IP4 ([\d.]+)(?:\/(\d+))?/.exec(val);
      if (m) { tgt.dest = m[1]; tgt.ttl = m[2] ? Number(m[2]) : null; }
    } else if (type === 'm') {
      const [media, port, proto, ...fmts] = val.split(/\s+/);
      cur = { media, port: Number(String(port).split('/')[0]), proto, pt: Number(fmts[0]), encoding: '', clock: 0, channels: 1, ptime: null, fmtp: {}, dest: '', ttl: null, filters: [], source: '', mid: '' };
      session.media.push(cur);
    } else if (type === 'a') {
      const i = val.indexOf(':');
      const k = i < 0 ? val : val.slice(0, i), v = i < 0 ? '' : val.slice(i + 1).trim();
      if (k === 'group' && !cur) { const [sem, ...mids] = v.split(/\s+/); session.groups.push({ semantics: sem, mids }); }
      else if (k === 'source-filter') {
        const m = /^incl\s+IN\s+IP4\s+(\S+)\s+(.+)$/.exec(v);
        if (m) tgt.filters.push({ dest: m[1], sources: m[2].split(/\s+/) });
      } else if (cur && k === 'rtpmap') {
        const m = /^(\d+)\s+([^/\s]+)\/(\d+)(?:\/(\d+))?/.exec(v);
        if (m && Number(m[1]) === cur.pt) { cur.encoding = m[2]; cur.clock = Number(m[3]); cur.channels = m[4] ? Number(m[4]) : 1; }
      } else if (cur && k === 'fmtp') {
        const m = /^(\d+)\s+(.*)$/.exec(v);
        if (m && Number(m[1]) === cur.pt) cur.fmtp = parseFmtp(m[2]);
      } else if (cur && k === 'ptime') cur.ptime = Number(v);
      else if (cur && k === 'mid') cur.mid = v;
      else if (cur && k === 'mediaclk') cur.mediaclk = v;
      else if (cur && k === 'ts-refclk') cur.tsRefclk = v;
    }
  }
  for (const m of session.media) {
    if (!m.dest) { m.dest = session.dest; m.ttl = session.ttl; }
    const f = [...m.filters, ...session.filters].find((x) => x.dest === m.dest || x.dest === '*');
    m.source = f && isIpv4(f.sources[0]) ? f.sources[0] : '';
    delete m.filters;
    m.essence = essenceOf(m.media, m.encoding);
  }
  delete session.filters; delete session.dest; delete session.ttl;
  return session;
}

/**
 * Flows of one or more SDP objects: media lines in an a=group:DUP become one flow with two
 * paths (ST 2110-10 §8.5, RFC 7104). Only essences this receiver handles are returned.
 */
export function flowsFromSdp(texts) {
  const flows = [];
  for (const text of texts) {
    const s = parseSdp(text);
    const used = new Set();
    const flow = (m) => ({
      essence: m.essence, encoding: m.encoding.toUpperCase(), clock: m.clock, channels: m.channels, ptime: m.ptime, pt: m.pt,
      fmtp: m.fmtp, name: s.name, mediaclk: m.mediaclk ?? '', tsRefclk: m.tsRefclk ?? '', paths: [],
    });
    const path = (m) => ({ dest: m.dest, port: m.port, source: m.source, mid: m.mid });
    for (const g of s.groups.filter((x) => x.semantics === 'DUP')) {
      const ms = g.mids.map((id) => s.media.find((m) => m.mid === id)).filter(Boolean);
      if (!ms.length || !ms[0].essence) continue;
      const f = flow(ms[0]);
      for (const m of ms) { f.paths.push(path(m)); used.add(m); }
      flows.push(f);
    }
    for (const m of s.media) {
      if (used.has(m) || !m.essence) continue;
      const f = flow(m); f.paths.push(path(m)); flows.push(f);
    }
  }
  return flows;
}

/** "239.1.2.3:5004" or "239.1.2.3:5004@192.0.2.7" (source-specific) → path, or null. */
export function parsePath(text) {
  const m = /^([\d.]+):(\d{1,5})(?:@([\d.]+))?$/.exec((text ?? '').trim());
  if (!m || !isIpv4(m[1]) || (m[3] && !isIpv4(m[3]))) return null;
  return { dest: m[1], port: Number(m[2]), source: m[3] ?? '', mid: '' };
}

/**
 * Flows of an st2110: URL (`st2110:?<query>`):
 *   sdp=<SDP text>            (repeatable; one SDP object per flow as ST 2110-10 asks)
 *   audio=<dest:port>[,<dest:port>] fmt=L24|L16|AM824 rate=48000 ch=2 order=SMPTE2110.(ST)
 *   anc=<dest:port>[,<dest:port>]   rate=90000 by default (RFC 8331 §3.1)
 *   iface=<local IPv4>, iface2=<local IPv4 for the second path>
 * The second address of a pair is the ST 2022-7 redundancy path.
 */
export function parseSt2110Url(url) {
  if (typeof url !== 'string' || !url.startsWith('st2110:')) return null;
  const q = new URLSearchParams(url.slice('st2110:'.length).replace(/^\?/, ''));
  let flows = [];
  try { flows = flowsFromSdp(q.getAll('sdp')); } catch { return null; }
  const paths = (v) => (v ?? '').split(',').filter(Boolean).map(parsePath);
  const a = q.get('audio');
  if (a) {
    const ps = paths(a);
    const fmt = (q.get('fmt') ?? 'L24').toUpperCase();
    if (!['L16', 'L24', 'AM824'].includes(fmt)) return null;
    flows.push({
      essence: fmt === 'AM824' ? 'audio31' : 'audio30', encoding: fmt, clock: Number(q.get('rate') ?? 48000), channels: Number(q.get('ch') ?? 2), ptime: null, pt: null,
      fmtp: q.get('order') ? { 'channel-order': q.get('order') } : {}, name: '', mediaclk: '', tsRefclk: '', paths: ps,
    });
  }
  const anc = q.get('anc');
  if (anc) flows.push({ essence: 'anc40', encoding: 'SMPTE291', clock: Number(q.get('ancRate') ?? 90000), channels: 1, ptime: null, pt: null, fmtp: {}, name: '', mediaclk: '', tsRefclk: '', paths: paths(anc) });
  const iface = q.get('iface') ?? '', iface2 = q.get('iface2') ?? '';
  if ((iface && !isIpv4(iface)) || (iface2 && !isIpv4(iface2))) return null;
  for (const f of flows) {
    if (!f.paths.length || f.paths.length > 2 || f.paths.some((p) => !p || p.port < 1024 || p.port > 65535)) return null;
    if (f.essence.startsWith('audio')) {
      if (![44100, 48000, 96000].includes(f.clock) || !(f.channels >= 1 && f.channels <= 64)) return null;
      if (f.essence === 'audio31' && f.channels % 2) return null; // ST 2110-31 §6.1: <nchan> is even
    } else if (!(f.clock > 0 && f.clock <= 1e9)) return null;
  }
  if (!flows.length) return null;
  return { flows, iface, iface2 };
}
