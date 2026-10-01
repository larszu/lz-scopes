import { execFileSync, spawnSync } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { Depacketizer, ReorderBuffer, RtpClock, parseRtp, seqDiff } from '../server/rtp.mjs';
// @ts-expect-error plain JS module
import { RtspClient, RtspStreamParser, authorization, parseSdp } from '../server/rtsp.mjs';
// @ts-expect-error plain JS module
import { MkvWriter, vint } from '../server/mkv.mjs';

// Own RTP reception (docs/research/rtp-eigenempfang.md)

interface Pkt { marker: boolean; pt: number; seq: number; ts: number; ssrc: number; payload: Buffer }

/** RTP packet (RFC 3550 §5.1) with optional CSRC, header extension and padding. */
function rtp(payload: Buffer, { seq = 1, ts = 0, marker = false, pt = 96, csrc = 0, ext = 0, pad = 0 } = {}) {
  const head = Buffer.alloc(12 + csrc * 4);
  head[0] = 0x80 | (pad ? 0x20 : 0) | (ext ? 0x10 : 0) | csrc;
  head[1] = (marker ? 0x80 : 0) | pt;
  head.writeUInt16BE(seq & 0xffff, 2); head.writeUInt32BE(ts >>> 0, 4); head.writeUInt32BE(0x1234, 8);
  const parts: Buffer[] = [head];
  if (ext) { const e = Buffer.alloc(4 + ext * 4); e.writeUInt16BE(0xbede, 0); e.writeUInt16BE(ext, 2); parts.push(e); }
  parts.push(payload);
  if (pad) { const p = Buffer.alloc(pad); p[pad - 1] = pad; parts.push(p); }
  return Buffer.concat(parts);
}

/** H.264 packetiser (RFC 6184 non-interleaved): small NAL units in one STAP-A, large ones as FU-A. */
function packetiseH264(nals: Buffer[], ts: number, seq0: number, mtu = 100): Buffer[] {
  const payloads: Buffer[] = [];
  const small = nals.filter((n) => n.length + 2 < mtu / 2), large = nals.filter((n) => n.length + 2 >= mtu / 2);
  if (small.length > 1) payloads.push(Buffer.concat([Buffer.from([(small[0][0] & 0x60) | 24]), ...small.flatMap((n) => { const l = Buffer.alloc(2); l.writeUInt16BE(n.length); return [l, n]; })]));
  else if (small.length) payloads.push(small[0]);
  for (const n of large) {
    const body = n.subarray(1);
    for (let o = 0; o < body.length; o += mtu) {
      const s = o === 0, e = o + mtu >= body.length;
      payloads.push(Buffer.concat([Buffer.from([(n[0] & 0xe0) | 28, (s ? 0x80 : 0) | (e ? 0x40 : 0) | (n[0] & 0x1f)]), body.subarray(o, o + mtu)]));
    }
  }
  return payloads.map((p, i) => rtp(p, { seq: seq0 + i, ts, marker: i === payloads.length - 1 }));
}

const nal = (type: number, n: number, fill = 0xaa) => Buffer.concat([Buffer.from([0x60 | type]), Buffer.alloc(n - 1, fill)]);
const annexB = (nals: Buffer[]) => Buffer.concat(nals.flatMap((n) => [Buffer.from([0, 0, 0, 1]), n]));

describe('RTP-Kopf (RFC 3550)', () => {
  it('liest Marker, PT, Folgenummer, Zeitstempel; überspringt CSRC, Erweiterung, Padding', () => {
    const p = parseRtp(rtp(Buffer.from([1, 2, 3]), { seq: 65535, ts: 0xfffffff0, marker: true, pt: 97, csrc: 2, ext: 1, pad: 3 }))!;
    expect(p).toMatchObject({ marker: true, pt: 97, seq: 65535, ts: 0xfffffff0 });
    expect([...p.payload]).toEqual([1, 2, 3]);
    expect(parseRtp(Buffer.alloc(8))).toBeNull();
  });
  it('Folgenummern-Abstand über den Überlauf', () => {
    expect(seqDiff(65535, 0)).toBe(1);
    expect(seqDiff(0, 65535)).toBe(-1);
    expect(seqDiff(100, 90)).toBe(-10);
  });
  it('90-kHz-Uhr in ms über den 32-bit-Überlauf', () => {
    const c = new RtpClock(90000);
    expect(c.ms(0xffff0000)).toBe(0);
    expect(c.ms(0xffff0000 + 3600)).toBe(40);
    expect(c.ms((0xffff0000 + 0x20000) >>> 0)).toBeCloseTo((0x20000 * 1000) / 90000, 6); // after the wrap
    expect(c.ms(0xffff0000 + 3600)).toBe(40); // late packet from before the wrap
  });
});

describe('H.264-Depacketizer (RFC 6184)', () => {
  const run = (pkts: Buffer[], gaps: number[] = []) => {
    const out: { data: Buffer; key: boolean; ts: number }[] = [];
    const d = new Depacketizer('h264', (au: { data: Buffer; key: boolean; ts: number }) => out.push(au));
    pkts.forEach((b, i) => d.push(parseRtp(b) as Pkt, gaps.includes(i)));
    return { out, d };
  };
  it('setzt STAP-A und FU-A zu Access Units zusammen, Ende beim Markerbit', () => {
    const au1 = [nal(7, 10), nal(8, 4), nal(5, 450)], au2 = [nal(1, 300)];
    const { out } = run([...packetiseH264(au1, 0, 1), ...packetiseH264(au2, 3600, 20)]);
    expect(out).toHaveLength(2);
    expect(out[0].data.equals(annexB(au1))).toBe(true);
    expect(out[0].key).toBe(true);
    expect(out[1].data.equals(annexB(au2))).toBe(true);
    expect(out[1].key).toBe(false);
  });
  it('schließt eine Access Unit auch ohne Markerbit, wenn der Zeitstempel wechselt', () => {
    const p = [rtp(nal(5, 20), { seq: 1, ts: 0 }), rtp(nal(1, 20), { seq: 2, ts: 3600, marker: true })];
    expect(run(p).out.map((a) => a.ts)).toEqual([0, 3600]);
  });
  it('verwirft Bilder mit Lücke und alles bis zum nächsten Keyframe', () => {
    const pk = [...packetiseH264([nal(5, 300)], 0, 1), ...packetiseH264([nal(1, 300)], 3600, 10), ...packetiseH264([nal(1, 300)], 7200, 20), ...packetiseH264([nal(5, 300)], 10800, 30)];
    // lose the second FU of the delta frame at 3600
    const lostAt = 4;
    const kept = pk.filter((_, i) => i !== lostAt);
    const { out, d } = run(kept, [lostAt]);
    expect(out.map((a) => a.ts)).toEqual([0, 10800]);
    expect(d.dropped).toBe(2);
  });
  it('beginnt erst mit einem Keyframe', () => {
    const { out } = run([...packetiseH264([nal(1, 50)], 0, 1), ...packetiseH264([nal(5, 50)], 3600, 2)]);
    expect(out.map((a) => a.key)).toEqual([true]);
  });
});

describe('HEVC-Depacketizer (RFC 7798)', () => {
  it('baut den NAL-Kopf aus FU-Kopf und Payload-Header zusammen', () => {
    // IDR_W_RADL = 19: NAL header 0x26 0x01 (F=0, type 19, layer 0, TID 1)
    const n = Buffer.concat([Buffer.from([19 << 1, 0x01]), Buffer.alloc(200, 0x55)]);
    const fu = (s: boolean, e: boolean, part: Buffer) => Buffer.concat([Buffer.from([49 << 1, 0x01, (s ? 0x80 : 0) | (e ? 0x40 : 0) | 19]), part]);
    const body = n.subarray(2);
    const pk = [rtp(fu(true, false, body.subarray(0, 100)), { seq: 1 }), rtp(fu(false, true, body.subarray(100)), { seq: 2, marker: true })];
    const out: { data: Buffer; key: boolean }[] = [];
    const d = new Depacketizer('hevc', (au: { data: Buffer; key: boolean }) => out.push(au));
    pk.forEach((b) => d.push(parseRtp(b)));
    expect(out).toHaveLength(1);
    expect(out[0].key).toBe(true);
    expect(out[0].data.equals(annexB([n]))).toBe(true);
  });
  it('Aggregation Packet (Typ 48) ohne DONL', () => {
    const vps = Buffer.from([32 << 1, 1, 9]), sps = Buffer.from([33 << 1, 1, 8, 8]), idr = Buffer.from([19 << 1, 1, 7, 7, 7]);
    const ap = Buffer.concat([Buffer.from([48 << 1, 1]), ...[vps, sps].flatMap((x) => { const l = Buffer.alloc(2); l.writeUInt16BE(x.length); return [l, x]; })]);
    const out: { data: Buffer }[] = [];
    const d = new Depacketizer('hevc', (au: { data: Buffer }) => out.push(au));
    d.push(parseRtp(rtp(ap, { seq: 1 }))); d.push(parseRtp(rtp(idr, { seq: 2, marker: true })));
    expect(out[0].data.equals(annexB([vps, sps, idr]))).toBe(true);
  });
});

describe('Umsortierpuffer (UDP)', () => {
  it('liefert in Folge, zählt umsortierte und verlorene Pakete', () => {
    const got: [number, boolean][] = [];
    const r = new ReorderBuffer((p: Pkt, gap: boolean) => got.push([p.seq, gap]), { window: 8, maxWaitMs: 30 });
    const pk = (seq: number) => ({ seq, ts: 0, marker: false, pt: 96, ssrc: 1, payload: Buffer.alloc(0) });
    r.push(pk(65534), 0); r.push(pk(0), 1); r.push(pk(65535), 2); // 0 before 65535: reordered across the wrap
    r.push(pk(2), 3); // 1 missing
    expect(got).toEqual([[65534, false], [65535, false], [0, false]]);
    r.drain(40); // waited long enough: 1 counts as lost
    expect(got.at(-1)).toEqual([2, true]);
    expect(r.lost).toBe(1);
    expect(r.reordered).toBeGreaterThanOrEqual(1);
    r.push(pk(1), 50); // too late
    expect(r.duplicates).toBe(1);
  });
});

describe('RTSP-Bausteine', () => {
  it('Digest nach RFC 2617 §3.5 (Beispielwerte der RFC)', () => {
    const ch = 'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"';
    const h = authorization(ch, { user: 'Mufasa', pass: 'Circle Of Life' }, 'GET', '/dir/index.html', 1, '0a4f113b');
    expect(h).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(h).toContain('qop=auth, nc=00000001, cnonce="0a4f113b"');
    expect(authorization('Basic realm="x"', { user: 'a', pass: 'b' }, 'DESCRIBE', '/')).toBe('Basic YTpi');
  });
  it('SDP: erster H.264-Track, Parametersätze, Steuer-URL', () => {
    const sdp = ['v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=x', 'a=control:*', 'm=audio 0 RTP/AVP 97', 'a=rtpmap:97 MPEG4-GENERIC/48000/2', 'a=control:trackID=0',
      'm=video 0 RTP/AVP 96', 'a=rtpmap:96 H264/90000', 'a=fmtp:96 packetization-mode=1; sprop-parameter-sets=Z0IAH5WoFAFuQA==,aM48gA==; profile-level-id=42001F', 'a=control:trackID=1'].join('\r\n');
    const t = parseSdp(sdp, 'rtsp://cam/live');
    expect(t).toMatchObject({ codec: 'h264', pt: 96, rate: 90000, control: 'rtsp://cam/live/trackID=1', session: 'rtsp://cam/live' });
    expect(t.params.map((b: Buffer) => b[0] & 0x1f)).toEqual([7, 8]);
    expect(() => parseSdp(sdp.replace('packetization-mode=1', 'packetization-mode=2'), 'rtsp://cam/live')).toThrow(/Interleaved/);
    expect(() => parseSdp('v=0\r\nm=video 0 RTP/AVP 26\r\na=rtpmap:26 JPEG/90000', 'rtsp://x')).toThrow(/Kein H.264/);
  });
  it('SDP: HEVC mit sprop-vps/sps/pps, DONL abgelehnt', () => {
    const sdp = 'v=0\r\nm=video 0 RTP/AVP 98\r\na=rtpmap:98 H265/90000\r\na=fmtp:98 sprop-vps=QAE=; sprop-sps=QgE=; sprop-pps=RAE=\r\na=control:rtsp://cam/v\r\n';
    const t = parseSdp(sdp, 'rtsp://cam/');
    expect(t.codec).toBe('hevc');
    expect(t.control).toBe('rtsp://cam/v');
    expect(t.params).toHaveLength(3);
    expect(() => parseSdp(sdp.replace('sprop-vps', 'sprop-max-don-diff=2; sprop-vps'), 'rtsp://cam/')).toThrow(/DONL/);
  });
  it('trennt Antworten und $-Rahmen, auch zerstückelt', () => {
    const res: number[] = [], frames: [number, number][] = [];
    const p = new RtspStreamParser((r: { status: number }) => res.push(r.status), (ch: number, d: Buffer) => frames.push([ch, d.length]));
    const bytes = Buffer.concat([Buffer.from('RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: 3\r\n\r\nabc'), Buffer.from([0x24, 0, 0, 5, 1, 2, 3, 4, 5]), Buffer.from('RTSP/1.0 401 Unauthorized\r\nCSeq: 2\r\n\r\n')]);
    for (let i = 0; i < bytes.length; i += 3) p.push(bytes.subarray(i, i + 3));
    expect(res).toEqual([200, 401]);
    expect(frames).toEqual([[0, 5]]);
  });
});

describe('RTSP-Sitzung gegen einen Prüfserver (TCP interleaved, Digest)', () => {
  it('meldet sich an, richtet ein, empfängt Access Units', async () => {
    const au = [nal(7, 8), nal(8, 4), nal(5, 400)];
    const sdp = 'v=0\r\ns=t\r\nm=video 0 RTP/AVP 96\r\na=rtpmap:96 H264/90000\r\na=fmtp:96 packetization-mode=1\r\na=control:track1\r\n';
    const seen: string[] = [];
    const srv = createServer((sock: Socket) => {
      let buf = '';
      sock.on('error', () => {});
      sock.on('data', (d) => {
        buf += d.toString('latin1');
        for (let i; (i = buf.indexOf('\r\n\r\n')) >= 0;) {
          const req = buf.slice(0, i); buf = buf.slice(i + 4);
          const [line, ...hs] = req.split('\r\n');
          const method = line.split(' ')[0], cseq = /CSeq: (\d+)/i.exec(req)![1];
          seen.push(method);
          const ok = (extra = '', body = '') => sock.write(`RTSP/1.0 200 OK\r\nCSeq: ${cseq}\r\n${extra}Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
          if (method === 'DESCRIBE' && !hs.some((x) => x.startsWith('Authorization: Digest'))) {
            sock.write(`RTSP/1.0 401 Unauthorized\r\nCSeq: ${cseq}\r\nWWW-Authenticate: Digest realm="cam", nonce="abc"\r\n\r\n`);
          } else if (method === 'OPTIONS') ok('Public: OPTIONS, DESCRIBE, SETUP, PLAY, GET_PARAMETER, TEARDOWN\r\n');
          else if (method === 'DESCRIBE') ok('Content-Base: rtsp://127.0.0.1/live/\r\nContent-Type: application/sdp\r\n', sdp);
          else if (method === 'SETUP') { expect(line).toContain('rtsp://127.0.0.1/live/track1'); ok('Transport: RTP/AVP/TCP;unicast;interleaved=0-1\r\nSession: 12345678;timeout=60\r\n'); }
          else if (method === 'PLAY') {
            ok('Session: 12345678\r\n');
            for (const pkt of packetiseH264(au, 9000, 7)) sock.write(Buffer.concat([Buffer.from([0x24, 0, pkt.length >> 8, pkt.length & 255]), pkt]));
          } else ok();
        }
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as { port: number }).port;
    const c = new RtspClient(`rtsp://user:pw@127.0.0.1:${port}/live`, { transport: 'tcp' });
    const got = new Promise<{ data: Buffer; key: boolean; ms: number }>((r) => c.on('au', r));
    const info = await c.start();
    expect(info.codec).toBe('h264');
    const a = await got;
    expect(a.data.equals(annexB(au))).toBe(true);
    expect(a.key).toBe(true);
    expect(a.ms).toBe(0);
    c.stop();
    srv.close();
    expect(seen.slice(0, 5)).toEqual(['OPTIONS', 'DESCRIBE', 'DESCRIBE', 'SETUP', 'PLAY']);
  });
});

describe('Matroska für ffmpeg', () => {
  it('EBML-Größen', () => {
    expect([...vint(0)]).toEqual([0x80]);
    expect([...vint(126)]).toEqual([0xfe]);
    expect([...vint(127)]).toEqual([0x40, 0x7f]);
    expect([...vint(1000)]).toEqual([0x43, 0xe8]);
  });
  const ffmpeg = spawnSync('ffmpeg', ['-version']).status === 0 ? 'ffmpeg' : null;
  it.skipIf(!ffmpeg)('ffmpeg dekodiert die geschriebenen Access Units (Annex B, 10 Bilder)', () => {
    const es = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=25', '-frames:v', '10', '-c:v', 'libx264', '-bf', '0', '-g', '5', '-x264-params', 'aud=1', '-f', 'h264', '-']);
    // split at the access unit delimiters (00 00 00 01 09)
    const starts: number[] = [];
    for (let i = 0; i + 4 < es.length; i++) if (es[i] === 0 && es[i + 1] === 0 && es[i + 2] === 0 && es[i + 3] === 1 && (es[i + 4] & 0x1f) === 9) starts.push(i);
    const aus = starts.map((s, i) => es.subarray(s, starts[i + 1] ?? es.length));
    const w = new MkvWriter({ codec: 'h264', config: Buffer.alloc(0), width: 160, height: 90 });
    const keyOf = (au: Buffer) => { for (let i = 0; i + 4 < au.length; i++) if (au[i] === 0 && au[i + 1] === 0 && au[i + 2] === 1 && (au[i + 3] & 0x1f) === 5) return true; return false; };
    const mkv = Buffer.concat([w.header(), ...aus.map((au, i) => w.block(au, i * 40, keyOf(au)))]);
    const out = execFileSync('ffmpeg', ['-v', 'error', '-f', 'matroska', '-i', '-', '-f', 'framemd5', '-'], { input: mkv }).toString();
    expect(out.split('\n').filter((l) => /^0,/.test(l))).toHaveLength(10);
  });
});
