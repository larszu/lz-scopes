// The bridge's own RTSP 1.0 client (RFC 2326) for low-latency reception
// (docs/research/rtp-eigenempfang.md). Video only: DESCRIBE → SDP → SETUP of the first
// H.264/HEVC track over TCP (interleaved, RFC 2326 §10.12) or UDP → PLAY, keep-alive with
// GET_PARAMETER/OPTIONS, Basic and Digest authentication (RFC 2617). Access units come out
// complete at the RTP marker bit (src: server/rtp.mjs); the bridge wraps them in Matroska
// (server/mkv.mjs) for ffmpeg. Anything unexpected throws – the bridge then falls back to
// ffmpeg's own RTSP input.

import { createHash, randomBytes } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { EventEmitter } from 'node:events';
import { connect } from 'node:net';
import { MkvWriter } from './mkv.mjs';
import { Depacketizer, ReorderBuffer, RtpClock, parseRtp } from './rtp.mjs';

const md5 = (s) => createHash('md5').update(s).digest('hex');

/** Parse `WWW-Authenticate: Digest realm="…", nonce="…", qop="auth"` into a map. */
export function parseAuthParams(h) {
  const out = {};
  for (const m of h.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) out[m[1].toLowerCase()] = m[2] ?? m[3];
  return out;
}

/** Authorization header for a challenge (RFC 2617 §3.2.2; MD5, qop auth or none). */
export function authorization(challenge, { user, pass }, method, uri, nc = 1, cnonce = randomBytes(8).toString('hex')) {
  if (/^basic/i.test(challenge)) return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  const p = parseAuthParams(challenge);
  const ha1 = md5(`${user}:${p.realm}:${pass}`), ha2 = md5(`${method}:${uri}`);
  const qop = p.qop?.split(',').map((x) => x.trim()).includes('auth') ? 'auth' : null;
  const ncs = nc.toString(16).padStart(8, '0');
  const response = qop ? md5(`${ha1}:${p.nonce}:${ncs}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${response}"`;
  if (p.opaque) h += `, opaque="${p.opaque}"`;
  if (qop) h += `, qop=${qop}, nc=${ncs}, cnonce="${cnonce}"`;
  return h;
}

/**
 * The first H.264/HEVC video track of an SDP (RFC 4566) with its control URL and
 * out-of-band parameter sets (sprop-parameter-sets, RFC 6184 §8.1; sprop-vps/sps/pps,
 * RFC 7798 §7.1). Throws for anything this client does not handle.
 */
export function parseSdp(sdp, base) {
  const lines = sdp.split(/\r?\n/);
  let sessionControl = null;
  const media = [];
  for (const l of lines) {
    if (l.startsWith('m=')) media.push({ m: l, attrs: [] });
    else if (l.startsWith('a=')) (media.length ? media[media.length - 1].attrs : (sessionControl ??= [])).push(l.slice(2));
  }
  const sessCtl = (sessionControl ?? []).find((a) => a.startsWith('control:'))?.slice(8).trim();
  const root = sessCtl && sessCtl !== '*' ? resolveUrl(sessCtl, base) : base;
  for (const md of media) {
    const [kind, , , ...pts] = md.m.slice(2).split(/\s+/);
    if (kind !== 'video') continue;
    for (const pt of pts) {
      const map = md.attrs.find((a) => a.startsWith(`rtpmap:${pt} `));
      if (!map) continue;
      const [enc, rate] = map.split(' ')[1].split('/');
      const codec = /^h264$/i.test(enc) ? 'h264' : /^h265$/i.test(enc) ? 'hevc' : null;
      if (!codec) continue;
      const fmtp = Object.fromEntries((md.attrs.find((a) => a.startsWith(`fmtp:${pt} `))?.slice(`fmtp:${pt} `.length) ?? '')
        .split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf('='); return [x.slice(0, i).toLowerCase(), x.slice(i + 1)]; }));
      if (codec === 'h264' && Number(fmtp['packetization-mode'] ?? 0) === 2) throw new Error('H.264 im Interleaved-Modus (packetization-mode=2) nicht unterstützt');
      if (codec === 'hevc' && Number(fmtp['sprop-max-don-diff'] ?? 0) > 0) throw new Error('HEVC mit DONL (sprop-max-don-diff > 0) nicht unterstützt');
      const b64 = codec === 'h264' ? (fmtp['sprop-parameter-sets'] ?? '').split(',') : ['sprop-vps', 'sprop-sps', 'sprop-pps'].flatMap((k) => (fmtp[k] ?? '').split(','));
      const params = b64.filter(Boolean).map((x) => Buffer.from(x, 'base64')).filter((b) => b.length);
      const ctl = md.attrs.find((a) => a.startsWith('control:'))?.slice(8).trim();
      return { codec, pt: Number(pt), rate: Number(rate) || 90000, params, control: ctl ? resolveUrl(ctl, root) : root, session: root };
    }
  }
  throw new Error('Kein H.264-/HEVC-Videotrack im SDP');
}

function resolveUrl(ctl, base) {
  if (/^rtsps?:\/\//i.test(ctl)) return ctl;
  return base.endsWith('/') ? base + ctl : `${base}/${ctl}`;
}

/** Split an incoming TCP byte stream into RTSP responses and interleaved `$` frames. */
export class RtspStreamParser {
  constructor(onResponse, onFrame) { this.buf = Buffer.alloc(0); this.onResponse = onResponse; this.onFrame = onFrame; }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      if (!this.buf.length) return;
      if (this.buf[0] === 0x24) { // '$' channel length(16) data
        if (this.buf.length < 4) return;
        const n = this.buf.readUInt16BE(2);
        if (this.buf.length < 4 + n) return;
        this.onFrame(this.buf[1], this.buf.subarray(4, 4 + n));
        this.buf = this.buf.subarray(4 + n);
        continue;
      }
      const end = this.buf.indexOf('\r\n\r\n');
      if (end < 0) { if (this.buf.length > 65536) throw new Error('RTSP: Kopf zu lang'); return; }
      const head = this.buf.subarray(0, end).toString('latin1').split('\r\n');
      const headers = {};
      for (const l of head.slice(1)) { const i = l.indexOf(':'); if (i > 0) { const k = l.slice(0, i).trim().toLowerCase(), v = l.slice(i + 1).trim(); headers[k] = headers[k] ? `${headers[k]}, ${v}` : v; } }
      const len = Number(headers['content-length'] ?? 0);
      if (this.buf.length < end + 4 + len) return;
      const body = this.buf.subarray(end + 4, end + 4 + len).toString('utf8');
      this.buf = this.buf.subarray(end + 4 + len);
      const m = /^RTSP\/\d\.\d\s+(\d+)/.exec(head[0]);
      if (m) this.onResponse({ status: Number(m[1]), headers, body });
      // requests from the server (e.g. ANNOUNCE, GET_PARAMETER) are not answered
    }
  }
}

/** Two UDP sockets on an even/odd port pair (RTP/RTCP, RFC 3550 §11). */
async function udpPair() {
  for (let i = 0; i < 20; i++) {
    const port = 20000 + 2 * Math.floor(Math.random() * 20000);
    const a = createSocket('udp4'), b = createSocket('udp4');
    const ok = await new Promise((r) => {
      let n = 0, failed = false;
      const done = (e) => { if (e) failed = true; if (++n === 2) r(!failed); };
      a.once('error', done); b.once('error', done);
      a.bind(port, () => done()); b.bind(port + 1, () => done());
    });
    if (ok) return [a, b, port];
    try { a.close(); } catch { /* not bound */ }
    try { b.close(); } catch { /* not bound */ }
  }
  throw new Error('Keine freien UDP-Ports');
}

/**
 * Own RTSP session. Events: 'au' { data, key, ms } (Annex B, ms since the first frame),
 * 'error' Error, 'end'. `info` after start(): { codec, params, transport }.
 */
export class RtspClient extends EventEmitter {
  constructor(url, { transport = 'tcp', timeoutMs = 8000, reorderMs = 30 } = {}) {
    super();
    const u = new URL(url);
    if (u.protocol !== 'rtsp:') throw new Error('Eigenempfang nur für rtsp:// (rtsps über ffmpeg)');
    this.cred = u.username ? { user: decodeURIComponent(u.username), pass: decodeURIComponent(u.password) } : null;
    u.username = ''; u.password = '';
    this.url = u.toString();
    this.host = u.hostname; this.port = Number(u.port) || 554;
    this.transport = transport; this.timeoutMs = timeoutMs; this.reorderMs = reorderMs;
    this.cseq = 0; this.pending = null; this.session = null; this.challenge = null; this.nc = 0;
    this.closed = false; this.timers = [];
    this.stats = { packets: 0, bytes: 0 };
  }

  request(method, uri, headers = {}) {
    return new Promise((resolve, reject) => {
      const send = (auth) => {
        const h = { CSeq: String(++this.cseq), 'User-Agent': 'lz-scopes', ...headers };
        if (this.session) h.Session = this.session;
        if (auth) h.Authorization = auth;
        const text = `${method} ${uri} RTSP/1.0\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`;
        const timer = setTimeout(() => { this.pending = null; reject(new Error(`RTSP ${method}: keine Antwort`)); }, this.timeoutMs);
        this.pending = (res) => {
          clearTimeout(timer); this.pending = null;
          if (res.status === 401 && this.cred && !auth) {
            this.challenge = pickChallenge(res.headers['www-authenticate'] ?? '');
            if (!this.challenge) return reject(new Error('RTSP: Anmeldung verlangt, Verfahren unbekannt'));
            return send(authorization(this.challenge, this.cred, method, uri, ++this.nc));
          }
          if (res.status !== 200) return reject(new Error(`RTSP ${method}: ${res.status}${res.status === 401 ? ' (Zugangsdaten?)' : ''}`));
          resolve(res);
        };
        this.sock.write(text);
      };
      send(this.challenge && this.cred ? authorization(this.challenge, this.cred, method, uri, ++this.nc) : null);
    });
  }

  async start() {
    this.sock = connect({ host: this.host, port: this.port });
    this.sock.setNoDelay(true);
    await new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error('RTSP: Verbindung zeitüberschritten')), this.timeoutMs);
      this.sock.once('connect', () => { clearTimeout(t); ok(); });
      this.sock.once('error', (e) => { clearTimeout(t); fail(e); });
    });
    const parser = new RtspStreamParser((res) => this.pending?.(res), (ch, data) => { if (ch === 0) this.onRtp(data); });
    this.sock.on('data', (c) => { try { parser.push(c); } catch (e) { this.fail(e); } });
    this.sock.on('error', (e) => this.fail(e));
    this.sock.on('close', () => { if (!this.closed) { this.closed = true; this.emit('end'); } });

    const opts = await this.request('OPTIONS', this.url);
    const methods = (opts.headers.public ?? '').toUpperCase();
    const desc = await this.request('DESCRIBE', this.url, { Accept: 'application/sdp' });
    const base = (desc.headers['content-base'] ?? desc.headers['content-location'] ?? this.url).replace(/\/$/, '');
    const track = parseSdp(desc.body, base);
    this.info = { codec: track.codec, params: track.params, transport: this.transport };

    let udp = null;
    if (this.transport === 'udp') udp = await udpPair();
    const transport = udp ? `RTP/AVP;unicast;client_port=${udp[2]}-${udp[2] + 1}` : 'RTP/AVP/TCP;unicast;interleaved=0-1';
    const setup = await this.request('SETUP', track.control, { Transport: transport });
    this.session = (setup.headers.session ?? '').split(';')[0] || null;
    const timeout = Number(/timeout=(\d+)/.exec(setup.headers.session ?? '')?.[1] ?? 60);

    const clock = new RtpClock(track.rate);
    this.depack = new Depacketizer(track.codec, (au) => this.emit('au', { data: au.data, key: au.key, ms: clock.ms(au.ts) }));
    this.reorder = new ReorderBuffer((pkt, gap) => this.depack.push(pkt, gap), { window: udp ? 64 : 0, maxWaitMs: this.reorderMs });
    this.pt = track.pt;
    if (udp) {
      const [rtp, rtcp] = udp;
      this.udp = udp;
      rtp.on('message', (m) => this.onRtp(m));
      rtcp.on('message', () => {});
      const serverRtcp = Number(/server_port=\d+-(\d+)/.exec(setup.headers.transport ?? '')?.[1] ?? 0);
      // empty RTCP receiver report (RFC 3550 §6.4.2, RC = 0) as a sign of life through NAT
      const ssrc = randomBytes(4);
      const rr = Buffer.concat([Buffer.from([0x80, 201, 0, 1]), ssrc]);
      if (serverRtcp) this.timers.push(setInterval(() => rtcp.send(rr, serverRtcp, this.host), 5000));
      // missing packets are given up after reorderMs even if nothing else arrives
      this.timers.push(setInterval(() => this.reorder.drain(), Math.max(5, this.reorderMs / 2)));
    }
    await this.request('PLAY', track.session, { Range: 'npt=0.000-' });
    const keep = methods.includes('GET_PARAMETER') ? 'GET_PARAMETER' : 'OPTIONS';
    this.timers.push(setInterval(() => { if (!this.pending) this.request(keep, this.url).catch(() => {}); }, Math.max(5, timeout / 2) * 1000));
    return this.info;
  }

  onRtp(buf) {
    const pkt = parseRtp(buf);
    if (!pkt || pkt.pt !== this.pt) return;
    this.stats.packets++; this.stats.bytes += buf.length;
    this.reorder?.push(pkt);
  }

  /** Counters for the bridge's stats message. */
  report() {
    return {
      transport: this.transport, packets: this.stats.packets, lost: this.reorder?.lost ?? 0, reordered: this.reorder?.reordered ?? 0,
      accessUnits: this.depack?.aus ?? 0, droppedUnits: this.depack?.dropped ?? 0,
    };
  }

  fail(e) { if (!this.closed) { this.emit('error', e); this.stop(); } }

  stop() {
    if (this.closed && !this.sock) return;
    this.closed = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    try { if (this.session && this.sock?.writable) this.sock.write(`TEARDOWN ${this.url} RTSP/1.0\r\nCSeq: ${++this.cseq}\r\nSession: ${this.session}\r\n\r\n`); } catch { /* closing anyway */ }
    this.sock?.end(); this.sock?.destroy(); this.sock = null;
    if (this.udp) { for (const s of this.udp.slice(0, 2)) { try { s.close(); } catch { /* closed */ } } this.udp = null; }
  }
}

/** Prefer Digest over Basic when the server offers both (several WWW-Authenticate lines are joined by ", "). */
function pickChallenge(h) {
  if (!h) return null;
  const digest = /Digest\s[^]*?(?=,\s*Basic\b|$)/i.exec(h);
  if (digest) return digest[0];
  return /^\s*Basic/i.test(h) ? 'Basic' : null;
}

/**
 * Own reception as ffmpeg input: starts the RTSP session and returns the ffmpeg input
 * arguments (Matroska on stdin) plus `attach(stdin)`, which writes the header and then one
 * SimpleBlock per access unit. Throws when the session cannot be set up (→ ffmpeg fallback).
 */
export async function startOwnRtp(url, { transport = 'tcp', width = 0, height = 0 } = {}) {
  const client = new RtspClient(url, { transport });
  let info;
  try { info = await client.start(); } catch (e) { client.stop(); throw e; }
  const config = Buffer.concat(info.params.flatMap((p) => [Buffer.from([0, 0, 0, 1]), p]));
  let detach = () => {};
  return {
    client, info,
    // the header carries the parameter sets: no probing needed
    inputArgs: ['-fflags', 'nobuffer', '-flags', 'low_delay', '-probesize', '32', '-analyzeduration', '0', '-f', 'matroska', '-i', 'pipe:0'],
    /** Feed one ffmpeg (again after a restart: new header, from the next key frame on). */
    attach(stdin) {
      detach();
      const mkv = new MkvWriter({ codec: info.codec, config, width, height });
      let started = false;
      stdin.on('error', () => {});
      stdin.write(mkv.header());
      const onAu = (au) => {
        if (!started && !au.key) return;
        started = true;
        if (stdin.writable) stdin.write(mkv.block(au.data, au.ms, au.key));
      };
      const onEnd = () => stdin.end();
      client.on('au', onAu); client.on('end', onEnd);
      detach = () => { client.off('au', onAu); client.off('end', onEnd); };
    },
  };
}
