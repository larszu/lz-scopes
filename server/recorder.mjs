// Recording of one bridge stream: the runtime side of server/record.mjs. One StreamRecorder
// belongs to one /stream WebSocket. It answers the client's `record`, `mark` and `event`
// messages, hands the extra ffmpeg output to the stream code (outputs()), follows the segment
// list of the running ffmpeg (attach()) and keeps the companion file up to date.
//
// Starting or stopping a recording restarts the source's ffmpeg with or without the second
// output (ffmpeg cannot add an output to a running process); the analysis picture pauses for
// the length of a restart. Segment numbers continue across restarts (segment_start_number).

import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { bmsg, toMsg } from './messages.mjs';
import {
  LineSplitter, RECORD_CODECS, RECORD_CONTAINERS, Sidecar, ensureDir, escapePattern, estimateRate, freeBytes, minutesLeft,
  parseSegmentLine, pickHevcEncoder, recordMode, resolveTarget, safeName, segmentOutputArgs, spaceProblem, stripCredentials, tailFile,
  writeJsonAtomic,
} from './record.mjs';
import { RING_MARGIN, RING_SEGMENT, clearRing, dropOverwritten, joinSegments, ringWrap, saveWindow, selectSegments } from './ring.mjs';

/** Settings a client may store in the companion file (copied as given, size-limited). */
function cleanSettings(s) {
  if (!s || typeof s !== 'object') return null;
  const text = JSON.stringify(s);
  return text.length > 16 * 1024 ? null : JSON.parse(text);
}

export class StreamRecorder {
  /**
   * @param {{ url: string, send: (m: object) => void, allowed: boolean, roots: () => {name: string, dir: string}[],
   *   ffmpeg: string, restart: () => void, clock?: () => { seconds: number, ref: string }, platform?: string,
   *   media: () => { width: number, height: number, fps: number, codec?: string, audioMap: string | null } }} o
   */
  constructor(o) {
    this.o = o;
    this.platform = o.platform ?? process.platform;
    /** active recording session or null */
    this.rec = null;
    /** sessions whose ffmpeg is still running (finished when it exits) */
    this.closing = new Set();
    /** ring buffer (server/ring.mjs) or null; `gen` counts ffmpeg launches (file names per launch) */
    this.ring = null;
    this.gen = 0;
    /** ring folders to delete once their ffmpeg has exited */
    this.oldRings = [];
    this.timer = setInterval(() => this.check(), 5000);
  }
  get mode() { return recordMode(this.o.url); }
  get active() { return !!this.rec; }
  get ringActive() { return !!this.ring; }

  /** Client message (already parsed). Returns true when it was a recording message. */
  async handle(m) {
    if (!m || typeof m !== 'object') return false;
    if (m.type === 'record') { await (m.on ? this.start(m) : this.stop('user')); return true; }
    if (m.type === 'mark') { this.mark(m.label); return true; }
    if (m.type === 'event') { this.event(m.kind, m.data); return true; }
    if (m.type === 'ring') { await (m.on ? this.startRing(m) : this.stopRing()); return true; }
    if (m.type === 'ring.save') { await this.saveRing(m); return true; }
    return false;
  }

  ringError(e) { this.o.send({ type: 'ring', state: 'error', ...toMsg(e) }); }

  /** Codec of the ring and the recording for raw sources; HEVC resolved to a working encoder. */
  async pickCodec(mode, want) {
    let codec = RECORD_CODECS.includes(want) ? want : 'prores';
    let encoder = '', hardware = false, note = null;
    if (mode === 'encode' && codec === 'hevc') {
      const pick = await pickHevcEncoder(this.o.ffmpeg, this.platform);
      if (pick.encoder) { encoder = pick.encoder; hardware = pick.hardware; if (!hardware) note = bmsg('record.hevcSoftware', 'No hardware HEVC encoder – libx265 (software)'); }
      else { codec = 'prores'; note = bmsg('record.hevcNone', 'No HEVC encoder works here – ProRes 422 HQ instead'); }
    }
    return { codec, encoder, hardware, note };
  }

  async startRing(m) {
    if (this.ring) return this.o.send(this.ringStatus());
    if (!this.o.allowed) return this.ringError(bmsg('record.denied', 'Recording only from the local app (same origin) or with the control token'));
    const mode = this.mode;
    if (!mode) return this.ringError(bmsg('record.unsupported', 'This source cannot be recorded in the bridge'));
    const roots = this.o.roots();
    const root = roots.find((r) => r.name === m.root) ?? (m.root ? null : roots[0]);
    if (!root) return this.ringError(roots.length ? bmsg('record.badTarget', 'Recording folder not released') : bmsg('record.noRoot', 'No recording folder released – start the bridge with --record-dir <folder>'));
    const pre = Math.min(600, Math.max(4, Math.round(Number(m.pre) || 60)));
    const post = Math.min(120, Math.max(0, Math.round(Number(m.post) || 0)));
    const { codec, encoder, hardware, note } = await this.pickCodec(mode, m.codec);
    const media = this.o.media();
    const rate = estimateRate(mode, codec, media.width, media.height, media.fps);
    const dir = join(root.dir, '.lzs-ring', `${safeName(m.name)}-${randomBytes(4).toString('hex')}`);
    try { await ensureDir(dir); } catch (e) { return this.ringError(bmsg('record.mkdir', `Folder cannot be created: ${e.message}`, { reason: e.message })); }
    const space = spaceProblem(freeBytes(dir), rate, (pre + post + RING_MARGIN) / 2);
    if (space) { await clearRing(dir); return this.ringError(space); }
    this.ring = { root, dir, pre, post, wrap: ringWrap(pre, post), mode, codec, encoder, hardware, note, rate, entries: [], marks: [], name: String(m.name ?? ''), settings: cleanSettings(m.settings), since: Date.now() };
    this.o.send(this.ringStatus());
    this.o.restart();
  }

  async stopRing() {
    const g = this.ring;
    if (!g) return this.o.send({ type: 'ring', state: 'stopped' });
    this.ring = null;
    this.oldRings.push(g.dir);
    this.o.send({ type: 'ring', state: 'stopped' });
    this.o.restart();
  }

  /** A segment of the ring is complete. */
  ringLine(g, gen, line, at) {
    const seg = parseSegmentLine(line);
    if (!seg || this.ring !== g) return;
    const file = basename(seg.file);
    g.entries = dropOverwritten(g.entries, file, g.wrap, gen);
    g.entries.push({ file, startMs: at - (seg.end - seg.start) * 1000, endMs: at, gen, start: seg.start, end: seg.end });
    // files of earlier launches age out of the window: delete them
    const keepFrom = at - (g.pre + g.post + RING_MARGIN + 4) * 1000;
    for (const e of g.entries) if (e.endMs < keepFrom && e.gen !== gen) rm(join(g.dir, e.file), { force: true }).catch(() => {});
    g.entries = g.entries.filter((e) => e.endMs >= keepFrom || e.gen === gen);
  }

  /**
   * Save the ring: last `pre` s before `at` plus `post` s after it, shifted by this source's
   * latency, into <root>/<take>/<name>_ring.mkv with a companion file.
   */
  async saveRing(m) {
    const g = this.ring;
    if (!g) return this.ringError(bmsg('ring.off', 'Ring buffer not running for this source'));
    const now = Date.now();
    const at = Number.isFinite(Number(m.at)) && Math.abs(Number(m.at) - now) < 5000 ? Number(m.at) : now;
    const pre = Math.min(g.pre, Math.max(1, Number(m.pre) || g.pre));
    const post = Math.min(g.post, Math.max(0, Number(m.post ?? g.post) || 0));
    const latencyMs = Number.isFinite(Number(m.latencyMs)) ? Number(m.latencyMs) : 0;
    const { from, to } = saveWindow(at, pre, post, latencyMs);
    this.o.send({ type: 'ring', state: 'saving', take: m.take, post });
    // post-roll: wait until the segment covering the end is complete
    const deadline = to + (RING_SEGMENT + 8) * 1000;
    while (!g.entries.some((e) => e.endMs >= to) && Date.now() < deadline && this.ring === g) await new Promise((r) => setTimeout(r, 100));
    const sel = selectSegments(g.entries.filter((e) => existsSync(join(g.dir, e.file))), from, to);
    if (!sel) return this.ringError(bmsg('ring.empty', 'Ring buffer has no pictures yet'));
    const target = resolveTarget(this.o.roots(), g.root.name, m.take, m.name ?? g.name);
    if (!target) return this.ringError(bmsg('record.badTarget', 'Recording folder not released'));
    try { await ensureDir(target.dir); } catch (e) { return this.ringError(bmsg('record.mkdir', `Folder cannot be created: ${e.message}`, { reason: e.message })); }
    let base = `${target.base}_ring`, k = 2;
    while (existsSync(join(target.dir, `${base}.mkv`))) base = `${target.base}_ring-${k++}`;
    const out = join(target.dir, `${base}.mkv`);
    const r = await joinSegments({ ffmpeg: this.o.ffmpeg, ffprobe: this.o.ffprobe ?? '', dir: g.dir, sel, out });
    if (!r.ok) return this.ringError(bmsg('ring.joinFailed', `Ring buffer could not be saved: ${r.error}`, { reason: r.error }));
    const first = sel.items[0];
    const startUtc = Math.round(first.startMs + r.startOffset * 1000);
    const media = this.o.media();
    const sc = new Sidecar({
      requestedUtcMs: at, take: m.take, kind: 'ring',
      source: { name: String(m.name ?? g.name).slice(0, 120), url: stripCredentials(this.o.url) },
      settings: cleanSettings(m.settings) ?? g.settings, latencyMs,
      window: { atUtcMs: at, preSeconds: pre, postSeconds: post, fromUtcMs: Math.round(from), toUtcMs: Math.round(to), complete: sel.complete },
      video: { mode: g.mode, codec: g.mode === 'copy' ? `copy (${media.codec ?? '?'})` : g.codec, encoder: g.encoder || null, hardware: g.hardware, container: 'mkv', width: media.width, height: media.height, fps: media.fps, audio: !!media.audioMap },
    });
    const c = this.o.clock?.();
    sc.setStart(startUtc, c ? c.seconds - (Date.now() - startUtc) / 1000 : null, c?.ref ?? null);
    sc.addSegment({ file: `${base}.mkv`, start: 0, end: (Math.min(to, sel.items[sel.items.length - 1].endMs) - startUtc) / 1000, utcMs: startUtc });
    for (const mk of g.marks) if (mk.utcMs >= startUtc && mk.utcMs <= to) sc.data.markers.push({ ...mk, t: (mk.utcMs - startUtc) / 1000 });
    sc.finish('ring', Math.round(to));
    await writeJsonAtomic(join(target.dir, `${base}.json`), sc.toJSON()).catch(() => {});
    this.o.send({ type: 'ring', state: 'saved', take: m.take, file: `${base}.mkv`, startUtcMs: startUtc, seconds: Math.round((to - startUtc) / 100) / 10, complete: sel.complete });
  }

  ringStatus() {
    const g = this.ring;
    if (!g) return { type: 'ring', state: 'stopped' };
    const have = g.entries.length ? (Math.max(...g.entries.map((e) => e.endMs)) - Math.min(...g.entries.map((e) => e.startMs))) / 1000 : 0;
    return {
      type: 'ring', state: 'running', pre: g.pre, post: g.post, buffered: Math.round(Math.min(have, g.pre + g.post + RING_MARGIN)), mode: g.mode, codec: g.codec, encoder: g.encoder || null,
      ...(g.note ? { note: g.note.message, noteCode: g.note.code, noteParams: g.note.params } : {}),
    };
  }

  error(e) { this.o.send({ type: 'record', state: 'error', ...toMsg(e) }); }

  async start(m) {
    if (this.rec) return this.o.send(this.status());
    if (!this.o.allowed) return this.error(bmsg('record.denied', 'Recording only from the local app (same origin) or with the control token'));
    const mode = this.mode;
    if (!mode) return this.error(bmsg('record.unsupported', 'This source cannot be recorded in the bridge'));
    const target = resolveTarget(this.o.roots(), typeof m.root === 'string' ? m.root : '', m.take, m.name);
    if (!target) return this.error(this.o.roots().length ? bmsg('record.badTarget', 'Recording folder not released') : bmsg('record.noRoot', 'No recording folder released – start the bridge with --record-dir <folder>'));
    const container = RECORD_CONTAINERS.includes(m.container) ? m.container : 'mkv';
    let codec = RECORD_CODECS.includes(m.codec) ? m.codec : 'prores';
    const segmentSeconds = Math.min(3600, Math.max(2, Math.round(Number(m.segment) || 300)));
    const media = this.o.media();
    let encoder = '', hardware = false, note = null;
    if (mode === 'encode' && codec === 'hevc') {
      const pick = await pickHevcEncoder(this.o.ffmpeg, this.platform);
      if (pick.encoder) { encoder = pick.encoder; hardware = pick.hardware; if (!hardware) note = bmsg('record.hevcSoftware', 'No hardware HEVC encoder – libx265 (software)'); }
      else { codec = 'prores'; note = bmsg('record.hevcNone', 'No HEVC encoder works here – ProRes 422 HQ instead'); }
    }
    // FFV1 is not a QuickTime codec
    const cont = codec === 'ffv1' && mode === 'encode' ? 'mkv' : container;
    const rate = estimateRate(mode, codec, media.width, media.height, media.fps);
    try { await ensureDir(target.dir); } catch (e) { return this.error(bmsg('record.mkdir', `Folder cannot be created: ${e.message}`, { reason: e.message })); }
    const space = spaceProblem(freeBytes(target.dir), rate, segmentSeconds);
    if (space) return this.error(space);
    const now = Date.now();
    const sidecar = new Sidecar({
      requestedUtcMs: now, take: m.take,
      source: { name: String(m.name ?? '').slice(0, 120), url: stripCredentials(this.o.url) },
      settings: cleanSettings(m.settings),
      latencyMs: Number.isFinite(Number(m.latencyMs)) ? Number(m.latencyMs) : null,
      video: { mode, codec: mode === 'copy' ? `copy (${media.codec ?? '?'})` : codec, encoder: encoder || null, hardware, container: cont,
        width: media.width, height: media.height, fps: media.fps, audio: !!media.audioMap, segmentSeconds },
    });
    this.rec = {
      target, mode, codec, encoder, hardware, container: cont, segmentSeconds, rate, sidecar, note, segments: 0,
      file: join(target.dir, `${target.base}.json`), started: now, bytes: 0, free: null, lastTcAt: 0,
    };
    await this.save(this.rec);
    this.o.send(this.status());
    this.o.restart();
  }

  async stop(reason) {
    const r = this.rec;
    if (!r) return this.o.send({ type: 'record', state: 'stopped' });
    this.rec = null;
    r.reason = reason;
    r.stopAt = Date.now();
    this.closing.add(r);
    // finished when the ffmpeg that writes it exits (last segment line, then the file is final)
    this.o.restart();
  }

  mark(label) {
    if (this.ring) this.ring.marks.push({ utcMs: Date.now(), label: String(label ?? '').slice(0, 200) });
    const r = this.rec;
    if (!r) return;
    const mk = r.sidecar.mark(label, Date.now());
    this.save(r);
    this.o.send({ type: 'record', state: 'mark', mark: mk });
  }
  event(kind, data) {
    const r = this.rec;
    if (!r || typeof kind !== 'string' || !/^[\w.-]{1,40}$/.test(kind)) return;
    const text = JSON.stringify(data ?? null);
    if (text.length > 16 * 1024) return;
    r.sidecar.event(kind, JSON.parse(text), Date.now());
    this.save(r);
  }
  /** Time code of the source (showinfo); the first one after the start goes into the file. */
  onTc(tc) {
    const r = this.rec;
    if (r && tc && !r.sidecar.data.start.timecode) { r.sidecar.setTimecode(tc); this.save(r); }
  }

  /**
   * Extra output arguments for the next ffmpeg launch plus how its segment list arrives.
   * `fd` = first free stdio index (pipe:fd) on POSIX; Windows uses a list file.
   */
  outputs(fd = 4) {
    const rec = this.recOutput(fd);
    const ring = this.ringOutput(fd + rec.pipes);
    return { args: [...rec.args, ...ring.args], pipes: rec.pipes + ring.pipes, sessions: [...rec.sessions, ...ring.sessions] };
  }

  ringOutput(fd) {
    const g = this.ring;
    if (!g) return { args: [], pipes: 0, sessions: [] };
    const gen = ++this.gen;
    const media = this.o.media();
    const listFile = this.platform === 'win32' ? join(g.dir, `ring${gen}.csv`) : null;
    const args = segmentOutputArgs({
      mode: g.mode, codec: g.codec, encoder: g.encoder, container: 'mkv', audioMap: media.audioMap, sourceCodec: media.codec,
      width: media.width, height: media.height, fps: media.fps, segmentSeconds: RING_SEGMENT, wrap: g.wrap, gopSeconds: RING_SEGMENT,
      list: listFile ?? `pipe:${fd}`, pattern: join(escapePattern(g.dir), `ring${gen}_%03d.mkv`),
    });
    return { args, pipes: listFile ? 0 : 1, sessions: [{ ring: g, gen, fd: listFile ? null : fd, listFile }] };
  }

  recOutput(fd) {
    const r = this.rec;
    if (!r) return { args: [], pipes: 0, sessions: [] };
    const media = this.o.media();
    const listFile = this.platform === 'win32' ? join(r.target.dir, `${r.target.base}.segments.csv`) : null;
    const pattern = join(r.target.dir, `${escapePattern(r.target.base)}_%03d.${r.container}`);
    const args = [...segmentOutputArgs({
      mode: r.mode, codec: r.codec, encoder: r.encoder, container: r.container, audioMap: media.audioMap, sourceCodec: media.codec,
      width: media.width, height: media.height, fps: media.fps, segmentSeconds: r.segmentSeconds,
      list: listFile ?? `pipe:${fd}`, pattern,
      metadata: { creation_time: new Date().toISOString(), comment: `lz-scopes take ${r.sidecar.data.take}`, title: r.sidecar.data.source.name },
    })];
    // continue the numbering after a restart
    const i = args.indexOf('-segment_list');
    args.splice(i, 0, '-segment_start_number', String(r.segments));
    return { args, pipes: listFile ? 0 : 1, sessions: [{ r, fd: listFile ? null : fd, listFile }] };
  }

  /** The launched ffmpeg: read the segment lists of its outputs. */
  attach(proc, out) {
    const tails = [];
    for (const s of out.sessions) {
      if (s.r) s.r.attached = true;
      const split = new LineSplitter((line) => (s.ring ? this.ringLine(s.ring, s.gen, line, Date.now()) : this.segmentLine(s.r, line, Date.now())));
      if (s.fd !== null) proc.stdio[s.fd]?.on('data', (d) => split.push(String(d)));
      else tails.push(tailFile(s.listFile, (t) => split.push(t)));
    }
    proc.once('close', async () => {
      await Promise.all(tails.map((t) => t.stop()));
      for (const s of out.sessions) if (s.r && this.closing.has(s.r) && this.rec !== s.r) await this.finish(s.r);
      // ring folders of a stopped ring: the ffmpeg that wrote them is gone now
      for (const s of out.sessions) if (s.ring && this.ring !== s.ring && this.oldRings.includes(s.ring.dir)) { this.oldRings = this.oldRings.filter((d) => d !== s.ring.dir); await clearRing(s.ring.dir); }
    });
  }

  segmentLine(r, line, at) {
    const seg = parseSegmentLine(line);
    if (!seg) return;
    // the line comes when ffmpeg starts the next segment, i.e. when the picture at `end` arrived
    const wallStart = at - (seg.end - seg.start) * 1000;
    if (r.sidecar.data.start.utcMs === null) {
      const c = this.o.clock?.();
      r.sidecar.setStart(Math.round(wallStart), c ? c.seconds - (at - wallStart) / 1000 : null, c?.ref ?? null);
    }
    // the list names the file without its folder
    const file = basename(seg.file);
    let bytes = null;
    try { bytes = statSync(join(r.target.dir, file)).size; } catch { /* gone */ }
    r.sidecar.addSegment({ file, start: seg.start, end: seg.end, utcMs: Math.round(wallStart), bytes });
    r.segments++;
    if (bytes) r.bytes += bytes;
    this.save(r);
  }

  async finish(r) {
    this.closing.delete(r);
    r.sidecar.finish(r.reason ?? 'end', r.stopAt ?? Date.now());
    await this.save(r);
    this.o.send({ type: 'record', state: 'stopped', take: r.sidecar.data.take, file: r.target.base, segments: r.segments, ...(r.reason === 'diskFull' ? { code: 'record.stoppedDiskFull', message: 'Recording stopped: disk full' } : {}) });
  }

  /** The stream ended (source gone, client closed): end the recording with it. */
  async ended(reason = 'end') {
    clearInterval(this.timer);
    if (this.ring) { this.oldRings.push(this.ring.dir); if (!this.gen) await clearRing(this.ring.dir); this.ring = null; }
    const r = this.rec;
    if (r) { this.rec = null; r.reason = reason; r.stopAt = Date.now(); this.closing.add(r); }
    // the ffmpeg 'close' handler of attach() finishes it; nothing ran → finish now
    if (r && r.segments === 0 && !r.attached) await this.finish(r);
  }

  save(r) { return writeJsonAtomic(r.file, r.sidecar.toJSON()).catch(() => {}); }

  /** Every 5 s: free space; stop before the disk runs full. */
  check() {
    const r = this.rec;
    if (!r) return;
    r.free = freeBytes(r.target.dir);
    if (r.free !== null && r.free < 1e9) { this.stop('diskFull'); return; }
  }

  status() {
    const r = this.rec;
    if (!r) return { type: 'record', state: 'stopped' };
    const left = minutesLeft(r.free ?? freeBytes(r.target.dir), r.segments ? r.bytes / Math.max(1, (Date.now() - r.started) / 1000) : r.rate);
    return {
      type: 'record', state: 'recording', take: r.sidecar.data.take, root: r.target.root.name, file: r.target.base,
      mode: r.mode, codec: r.codec, encoder: r.encoder || null, hardware: r.hardware, container: r.container,
      seconds: Math.round((Date.now() - r.started) / 1000), segments: r.segments, bytes: r.bytes, minutesLeft: left,
      ...(r.note ? { note: r.note.message, noteCode: r.note.code, noteParams: r.note.params } : {}),
      ...(left !== null && left < 10 ? { warn: 'record.diskLow', warnParams: { min: left } } : {}),
    };
  }
}

/**
 * Browser sources (camera, screen capture, video file, test pattern in the page): the page
 * records with MediaRecorder and streams the chunks here, so the file lands in a released
 * folder like every other recording.
 *   ws://…/record-upload?root=<name>&take=<take>&name=<source>&ext=webm|mp4&part=<n>
 *   binary = next chunk of the file <name>_<part>.<ext>;  text {type:'sidecar', data} = companion file
 */
export async function handleUploadSocket(ws, q, { roots, allowed }) {
  // chunks that arrive while the folder is being prepared are kept, in order
  const early = [];
  const keep = (data, isBinary) => early.push([data, isBinary]);
  ws.on('message', keep);
  const fail = (m) => { if (ws.readyState === ws.OPEN) { ws.send(JSON.stringify({ type: 'error', ...toMsg(m) })); ws.close(); } };
  if (!allowed) return fail(bmsg('record.denied', 'Recording only from the local app (same origin) or with the control token'));
  const target = resolveTarget(roots, q.get('root') ?? '', q.get('take'), q.get('name'));
  if (!target) return fail(roots.length ? bmsg('record.badTarget', 'Recording folder not released') : bmsg('record.noRoot', 'No recording folder released – start the bridge with --record-dir <folder>'));
  const ext = q.get('ext') === 'mp4' ? 'mp4' : 'webm';
  const part = Math.max(0, Math.min(999, Math.floor(Number(q.get('part')) || 0)));
  try { await ensureDir(target.dir); } catch (e) { return fail(bmsg('record.mkdir', `Folder cannot be created: ${e.message}`, { reason: e.message })); }
  const space = spaceProblem(freeBytes(target.dir), 2e6, 300);
  if (space) return fail(space);
  const file = `${target.base}_${String(part).padStart(3, '0')}.${ext}`;
  const out = createWriteStream(join(target.dir, file), { flags: 'a' });
  let bytes = 0;
  out.on('error', (e) => fail(bmsg('record.write', `Cannot write: ${e.message}`, { reason: e.message })));
  ws.send(JSON.stringify({ type: 'record', state: 'recording', file, take: q.get('take'), root: target.root.name }));
  const onMessage = (data, isBinary) => {
    if (isBinary) { bytes += data.length; out.write(Buffer.from(data)); return; }
    let m;
    try { m = JSON.parse(String(data)); } catch { return; }
    if (m.type === 'sidecar' && m.data && typeof m.data === 'object') {
      const text = JSON.stringify({ format: 'lz-scopes-recording', version: 1, ...m.data });
      if (text.length < 256 * 1024) writeJsonAtomic(join(target.dir, `${target.base}.json`), JSON.parse(text)).catch(() => {});
    }
  };
  ws.off('message', keep);
  for (const [d, b] of early) onMessage(d, b);
  ws.on('message', onMessage);
  const check = setInterval(() => {
    const free = freeBytes(target.dir);
    if (free !== null && free < 1e9) fail(bmsg('record.stoppedDiskFull', 'Recording stopped: disk full'));
    else if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'record', state: 'recording', file, bytes }));
  }, 5000);
  ws.on('close', () => { clearInterval(check); out.end(); });
}
