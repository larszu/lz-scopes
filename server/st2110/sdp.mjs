// SDP for ST 2110 / ST 2022-6 flows: parse what a receiver needs, write what our generator sends.
// docs/research/st2110-netz.md (German) lists the sources.
//
// - SMPTE ST 2110-20:2022 §7.2/7.3 (free, pub.smpte.org): `a=rtpmap:<pt> raw/90000`, mandatory fmtp
//   `sampling`, `depth`, `width`, `height`, `exactframerate`, `colorimetry`, `PM`, `SSN`, `TP`;
//   optional `interlace`, `segmented`, `TCS` (default SDR, §7.6), `RANGE` (default NARROW), `MAXUDP`
//   (absent = Standard UDP Size Limit).
// - SMPTE ST 2110-21:2022 §8.1/8.2: `TP=2110TPN|2110TPNL|2110TPW` (required), `TROFF` = TROFFSET as a
//   positive integer number of microseconds, `CMAX` = largest CINST at the sender output.
// - SMPTE ST 2110-10:2022 §8: `a=ts-refclk`, `a=mediaclk:direct=0`, source filter (RFC 4570),
//   ST 2022-7 duplicates as two m-lines grouped with `a=group:DUP` (RFC 7104).
// - SMPTE ST 2022-8:2019 §6: ST 2022-6 in SDP as `video/SMPTE2022-6`, RTP clock 27 MHz.
// - SMPTE ST 2110-30 / AES67: `L24/48000/<ch>`, `a=ptime`; ST 2110-40 / RFC 8331 §4: `smpte291/90000`.

const fmtpOf = (attrs, pt) => {
  const raw = attrs.find((a) => a.startsWith(`fmtp:${pt} `))?.slice(`fmtp:${pt} `.length) ?? '';
  const out = {};
  for (const part of raw.split(';').map((x) => x.trim()).filter(Boolean)) {
    const i = part.indexOf('=');
    // flags without value (interlace, segmented) → true
    if (i < 0) out[part] = true; else out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
};

/** "60000/1001" or "25" → { num, den } (null when invalid). */
export function parseRate(s) {
  const m = /^(\d{1,7})(?:\/(\d{1,5}))?$/.exec(String(s ?? '').trim());
  if (!m) return null;
  const num = Number(m[1]), den = Number(m[2] ?? 1);
  return num > 0 && den > 0 ? { num, den } : null;
}

/** ST 2110-20 Table 1/2: pgroup octets and pixels for the sampling/depth pairs this receiver handles. */
export const PGROUPS = {
  'YCbCr-4:2:2/8': { bytes: 4, pixels: 2 },
  'YCbCr-4:2:2/10': { bytes: 5, pixels: 2 },
  'YCbCr-4:2:2/12': { bytes: 6, pixels: 2 },
  'RGB/8': { bytes: 3, pixels: 1 },
  'RGB/10': { bytes: 15, pixels: 4 },
  'YCbCr-4:4:4/10': { bytes: 15, pixels: 4 },
};

/** colorimetry → matrix/primaries in ffprobe names (what the frame protocol carries). */
const COLORIMETRY = {
  BT601: { matrix: 'bt601', primaries: 'bt470bg' },
  BT709: { matrix: 'bt709', primaries: 'bt709' },
  BT2020: { matrix: 'bt2020', primaries: 'bt2020' },
  BT2100: { matrix: 'bt2020', primaries: 'bt2020' },
};
/** ST 2110-20 §7.6 TCS → transfer (ffprobe names). HDR follows from it, as on a VB440. */
const TCS = { SDR: 'bt709', PQ: 'smpte2084', HLG: 'arib-std-b67', LINEAR: 'linear', BT2100LINPQ: 'linear', BT2100LINHLG: 'linear', ST2065_1: 'linear', ST428_1: 'smpte428', DENSITY: 'unknown', ST2115LOGS3: 'unknown', UNSPECIFIED: 'unknown' };

/**
 * Parse an SDP into the media sections we understand. Returns
 * { name, media: [{ kind: 'video'|'sdi'|'audio'|'anc', group, port, source, pt, ... }], dup: bool }.
 * Unknown sections come back with kind 'other' so the caller can say what it got.
 */
export function parseSdp2110(text) {
  if (typeof text !== 'string' || text.length > 65536) throw new Error('SDP missing or too long');
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let name = '', sessionC = null;
  const sessionAttrs = [];
  const sections = [];
  for (const l of lines) {
    if (l.startsWith('m=')) sections.push({ m: l.slice(2), attrs: [], c: null });
    else if (l.startsWith('c=')) (sections.length ? (sections[sections.length - 1].c = l.slice(2)) : (sessionC = l.slice(2)));
    else if (l.startsWith('a=')) (sections.length ? sections[sections.length - 1].attrs : sessionAttrs).push(l.slice(2));
    else if (l.startsWith('s=')) name = l.slice(2);
  }
  const media = sections.map((s) => section(s, sessionC, sessionAttrs));
  const dup = sessionAttrs.some((a) => /^group:DUP\b/.test(a));
  return { name, media, dup };
}

function section(s, sessionC, sessionAttrs) {
  const [kind, portStr, proto, ...pts] = s.m.split(/\s+/);
  const port = Number(portStr);
  // c=IN IP4 239.1.2.3/64 (TTL after the slash for multicast)
  const c = (s.c ?? sessionC ?? '').split(/\s+/);
  const group = (c[2] ?? '').split('/')[0] || null;
  // RFC 4570: a=source-filter: incl IN IP4 <dest> <src>
  const sf = [...s.attrs, ...sessionAttrs].find((a) => a.startsWith('source-filter:'));
  const source = sf ? sf.split(/\s+/).pop() : null;
  const pt = Number(pts[0]);
  const map = s.attrs.find((a) => a.startsWith(`rtpmap:${pt} `))?.split(' ')[1] ?? '';
  const [enc, rateStr, chStr] = map.split('/');
  const fmtp = fmtpOf(s.attrs, pt);
  const mid = s.attrs.find((a) => a.startsWith('mid:'))?.slice(4) ?? null;
  const refclk = [...s.attrs, ...sessionAttrs].find((a) => a.startsWith('ts-refclk:'))?.slice(10) ?? null;
  const mediaclk = [...s.attrs, ...sessionAttrs].find((a) => a.startsWith('mediaclk:'))?.slice(9) ?? null;
  const base = { group, port, source, pt, proto, mid, refclk, mediaclk, clock: Number(rateStr) || 0 };
  if (kind === 'video' && /^raw$/i.test(enc)) {
    const rate = parseRate(fmtp.exactframerate);
    const sampling = String(fmtp.sampling ?? ''), depth = String(fmtp.depth ?? '');
    const tcs = String(fmtp.TCS ?? 'SDR');
    const col = COLORIMETRY[String(fmtp.colorimetry ?? '')] ?? null;
    return {
      kind: 'video', ...base,
      sampling, depth: Number(depth) || 0, width: Number(fmtp.width) || 0, height: Number(fmtp.height) || 0,
      rate, interlace: fmtp.interlace === true || fmtp.interlace === '1', segmented: fmtp.segmented === true,
      colorimetry: String(fmtp.colorimetry ?? ''), tcs, range: String(fmtp.RANGE ?? 'NARROW'),
      pm: String(fmtp.PM ?? ''), tp: String(fmtp.TP ?? ''), troffUs: fmtp.TROFF !== undefined ? Number(fmtp.TROFF) : null,
      cmax: fmtp.CMAX !== undefined ? Number(fmtp.CMAX) : null, maxUdp: Number(fmtp.MAXUDP) || 1460,
      pgroup: PGROUPS[`${sampling}/${depth}`] ?? null,
      matrix: col?.matrix ?? null, primaries: col?.primaries ?? null, transfer: TCS[tcs] ?? 'unknown',
      fullRange: /^FULL/.test(String(fmtp.RANGE ?? '')),
    };
  }
  if (kind === 'video' && /^SMPTE2022-6$/i.test(enc)) return { kind: 'sdi', ...base };
  if (kind === 'audio' && /^L(16|24)$/i.test(enc)) {
    const ptime = Number(s.attrs.find((a) => a.startsWith('ptime:'))?.slice(6)) || 1;
    return { kind: 'audio', ...base, bits: Number(enc.slice(1)), channels: Number(chStr) || 1, ptime, channelOrder: fmtp['channel-order'] ?? null };
  }
  if (kind === 'video' && /^smpte291$/i.test(enc)) return { kind: 'anc', ...base, rate: parseRate(fmtp.exactframerate), didSdid: fmtp.DID_SDID ?? null };
  return { kind: 'other', ...base, media: kind, encoding: enc };
}

/** The first section a picture receiver can open (2110-20 or 2022-6), its 2022-7 twin when grouped as DUP. */
export function pictureSections(sdp) {
  const list = sdp.media.filter((m) => m.kind === 'video' || m.kind === 'sdi');
  return { primary: list[0] ?? null, secondary: sdp.dup ? list[1] ?? null : null };
}

// ---- writing (generator, NMOS manifest)

const rateText = (r) => (r.den === 1 ? String(r.num) : `${r.num}/${r.den}`);

/**
 * SDP for one flow (or two legs for ST 2022-7). `legs`: [{ group, port, source, ttl? }].
 * `flow`: { kind: 'video'|'audio'|'anc'|'sdi', ... } as produced by the generator.
 */
export function writeSdp({ name = 'LZ Scopes test signal', origin = '0.0.0.0', sessionId = 1, legs, flow, ptpDomain = 127, gmid = null }) {
  const out = ['v=0', `o=- ${sessionId} ${sessionId} IN IP4 ${origin}`, `s=${name}`, 't=0 0'];
  if (legs.length > 1) out.push(`a=group:DUP ${legs.map((_, i) => `${flow.kind}${i + 1}`).join(' ')}`);
  // ST 2110-10 §8.1: reference clock. Without a known grandmaster identity: the local clock.
  const refclk = gmid ? `ptp=IEEE1588-2008:${gmid}:${ptpDomain}` : 'localmac=00-00-00-00-00-00';
  legs.forEach((leg, i) => {
    const multicast = /^(22[4-9]|23\d)\./.test(leg.group);
    if (flow.kind === 'video') {
      out.push(`m=video ${leg.port} RTP/AVP ${flow.pt}`);
      out.push(`c=IN IP4 ${leg.group}${multicast ? `/${leg.ttl ?? 64}` : ''}`);
      out.push(`a=rtpmap:${flow.pt} raw/90000`);
      const f = [`sampling=${flow.sampling}`, `width=${flow.width}`, `height=${flow.height}`, `exactframerate=${rateText(flow.rate)}`, `depth=${flow.depth}`,
        `TCS=${flow.tcs ?? 'SDR'}`, `colorimetry=${flow.colorimetry ?? 'BT709'}`, 'PM=2110GPM', 'SSN=ST2110-20:2017', `TP=${flow.tp ?? '2110TPN'}`];
      if (flow.interlace) f.push('interlace');
      out.push(`a=fmtp:${flow.pt} ${f.join('; ')}; `);
    } else if (flow.kind === 'audio') {
      out.push(`m=audio ${leg.port} RTP/AVP ${flow.pt}`);
      out.push(`c=IN IP4 ${leg.group}${multicast ? `/${leg.ttl ?? 64}` : ''}`);
      out.push(`a=rtpmap:${flow.pt} L24/48000/${flow.channels}`);
      out.push(`a=fmtp:${flow.pt} channel-order=SMPTE2110.(${flow.channels === 2 ? 'ST' : flow.channels === 1 ? 'M' : `U${String(flow.channels).padStart(2, '0')}`})`);
      out.push(`a=ptime:${flow.ptimeMs}`);
    } else if (flow.kind === 'anc') {
      out.push(`m=video ${leg.port} RTP/AVP ${flow.pt}`);
      out.push(`c=IN IP4 ${leg.group}${multicast ? `/${leg.ttl ?? 64}` : ''}`);
      out.push(`a=rtpmap:${flow.pt} smpte291/90000`);
      out.push(`a=fmtp:${flow.pt} DID_SDID={0x60,0x60}; exactframerate=${rateText(flow.rate)}; SSN=ST2110-40:2018`);
    } else if (flow.kind === 'sdi') {
      out.push(`m=video ${leg.port} RTP/AVP ${flow.pt}`);
      out.push(`c=IN IP4 ${leg.group}${multicast ? `/${leg.ttl ?? 64}` : ''}`);
      out.push(`a=rtpmap:${flow.pt} SMPTE2022-6/27000000`);
    }
    if (leg.source) out.push(`a=source-filter: incl IN IP4 ${leg.group} ${leg.source}`);
    out.push(`a=ts-refclk:${refclk}`, 'a=mediaclk:direct=0');
    if (legs.length > 1) out.push(`a=mid:${flow.kind}${i + 1}`);
  });
  return `${out.join('\r\n')}\r\n`;
}
