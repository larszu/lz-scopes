// Event log of the bridge (#239; idea: Bridge Technologies VB440 "event log without thresholds").
// Unlike the QC log (src/qclog.ts) nothing here is judged good or bad: every change of a
// stream's format, its flow (start, stop, error), its sound channels, the PTP state, the PTP
// lock and a watched ST 2110 RTP stream is written down with a time stamp. Ring buffer, oldest
// entries go first. Export as CSV or JSON: GET /api/events (docs/control-api.md).

/** Kinds of entries. */
export const EVENT_KINDS = ['flow', 'format', 'audio', 'ptp', 'lock', 'rtp'];

export class EventLog {
  /** @param {{ max?: number, now?: () => number }} [o] */
  constructor({ max = 2000, now = () => Date.now() } = {}) {
    this.max = max; this.now = now;
    /** @type {{ id: number, t: number, kind: string, source: string, item: string, from: string | null, to: string }[]} */
    this.entries = [];
    /** last value per key, for `change` */
    this.last = new Map();
    this.next = 1;
  }

  /** All entries ever written (also those the ring buffer has dropped), for the Prometheus counter. */
  get total() { return this.next - 1; }

  add(kind, source, item, to, from = null) {
    const e = { id: this.next++, t: this.now(), kind, source: String(source ?? ''), item, from: from === null || from === undefined ? null : String(from), to: String(to ?? '') };
    this.entries.push(e);
    if (this.entries.length > this.max) this.entries.splice(0, this.entries.length - this.max);
    return e;
  }

  /** Write an entry only when `value` differs from the last one under `key` (null = not known). */
  change(key, kind, source, item, value) {
    if (value === null || value === undefined) return null;
    const v = String(value), before = this.last.get(key);
    if (before === v) return null;
    this.last.set(key, v);
    return this.add(kind, source, item, v, before ?? null);
  }

  /** Forget the last values under a key prefix, so the next value is written again. */
  forget(prefix) { for (const k of this.last.keys()) if (k.startsWith(prefix)) this.last.delete(k); }

  /** Entries with an id above `since`, oldest first; `limit` keeps the newest ones. */
  list({ since = 0, limit = this.max } = {}) {
    const out = this.entries.filter((e) => e.id > since);
    return out.slice(Math.max(0, out.length - limit));
  }

  clear() { this.entries = []; this.last.clear(); }
}

/**
 * Source as it may be shown and exported: no user name or password (rtsp://user:pw@…), no
 * query (tokens, passphrases of srt://…?passphrase=). Not a URL: unchanged.
 */
export function redactSource(url) {
  const s = String(url ?? '');
  const m = /^([a-z][\w+.-]*:\/\/)([^/?#]*)([^?#]*)/i.exec(s);
  if (!m) return s.slice(0, 200);
  const host = m[2].includes('@') ? m[2].slice(m[2].lastIndexOf('@') + 1) : m[2];
  return `${m[1]}${host}${m[3]}`.slice(0, 200);
}

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const fps = (v) => (n(v) === null ? '?' : String(Math.round(v * 1000) / 1000));

/** Picture format of an info message, as one comparable text; null when there is no picture. */
export function formatOf(info) {
  const w = n(info?.sourceWidth) ?? n(info?.width), h = n(info?.sourceHeight) ?? n(info?.height);
  if (!w || !h) return null;
  const parts = [`${w}x${h}${info.interlaced ? 'i' : 'p'}${fps(n(info.sourceFps) ?? n(info.fps))}`];
  if (info.codec) parts.push(String(info.codec));
  const colour = [info.transfer, info.primaries, info.matrix].filter(Boolean).join('/');
  if (colour) parts.push(colour);
  if (info.range) parts.push(String(info.range));
  if (info.bits) parts.push(`${info.bits} bit`);
  return parts.join(' ');
}

/** Sound channels of an info message (proto 2), 'none' without sound; null when not stated. */
export function audioOf(info) {
  if (!info || !('audio' in info)) return null;
  const a = info.audio;
  if (!a) return 'none';
  return `${a.channels} ch${a.layout ? ` ${a.layout}` : ''} ${a.sampleRate} Hz`;
}

/**
 * PTP monitor status (server/ptp.mjs) → entries: state, domain, grandmaster, clock class,
 * UTC offset, and the lock state the grandmaster reports in the SMPTE ST 2059-2 SM TLV
 * (gmLockingStatus). `null` = monitor stopped.
 */
export function observePtp(log, st) {
  const src = 'ptp';
  if (!st) {
    // a monitor that never ran is not an event
    if (log.last.has('ptp:state')) log.change('ptp:state', 'ptp', src, 'state', 'off');
    log.forget('ptp:gm'); log.forget('ptp:lock');
    return;
  }
  log.change('ptp:state', 'ptp', src, 'state', st.state);
  if (st.domain !== undefined) log.change('ptp:domain', 'ptp', src, 'domain', st.domain);
  if (st.gm) {
    log.change('ptp:gm', 'ptp', src, 'grandmaster', st.gm.identity);
    log.change('ptp:gmclass', 'ptp', src, 'clockClass', st.gm.clockClass);
    if (st.gm.utcOffsetValid) log.change('ptp:gmutc', 'ptp', src, 'utcOffset', st.gm.currentUtcOffset);
  }
  if (st.sm) log.change('ptp:lock', 'lock', src, 'gmLocking', st.sm.lockingText);
}

/** ST 2110 RTP check status (server/ptp.mjs RtpMonitor) → entries; `null` = not watched. */
export function observeRtp(log, st) {
  if (!st) { log.forget('rtp:'); return; }
  const src = `${st.group}:${st.port}`;
  log.change(`rtp:${src}:rx`, 'rtp', src, 'receiving', st.frames > 0 ? 'yes' : 'no');
  if (st.payloadType !== null && st.payloadType !== undefined) log.change(`rtp:${src}:pt`, 'rtp', src, 'payloadType', st.payloadType);
}

/** CSV, semicolon separated like the QC log export; times in ISO 8601 UTC. */
export function eventsCsv(entries) {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  return ['id;time;kind;source;item;from;to', ...entries.map((e) => [e.id, new Date(e.t).toISOString(), e.kind, q(e.source), e.item, q(e.from ?? ''), q(e.to)].join(';'))].join('\n') + '\n';
}

/** user:password@ inside a text (ffmpeg errors repeat the input URL) */
const scrub = (s) => String(s ?? '').replace(/\/\/[^/@\s]*@/g, '//').slice(0, 300);

/**
 * Watch one stream socket: flow start/stop/error, format and sound channels from its info
 * messages, counters from its stats messages (for /metrics). Works for every input path,
 * because it only reads what is sent to the client. `streams` holds the open ones.
 */
export function tapStream(ws, { log, url, streams, id }) {
  const source = redactSource(url);
  const rec = { id, source, sent: 0, dropped: 0, bytes: 0, width: undefined, height: undefined, fps: undefined, since: log.now() };
  streams.set(id, rec);
  log.add('flow', source, 'start', 'open');
  let ended = false;
  const send = ws.send.bind(ws);
  ws.send = (data, ...rest) => {
    if (typeof data === 'string') {
      // only the messages that matter are parsed (time code and audio PTS come many times a second)
      const head = data.slice(0, 16);
      if (head.startsWith('{"type":"info"')) {
        try {
          const m = JSON.parse(data);
          rec.width = m.sourceWidth ?? m.width; rec.height = m.sourceHeight ?? m.height; rec.fps = m.sourceFps ?? m.fps;
          log.change(`fmt:${source}`, 'format', source, 'format', formatOf(m));
          log.change(`aud:${source}`, 'audio', source, 'channels', audioOf(m));
        } catch { /* not ours */ }
      } else if (head.startsWith('{"type":"stats"')) {
        try { const m = JSON.parse(data); if (typeof m.sent === 'number') rec.sent = m.sent; if (typeof m.dropped === 'number') rec.dropped = m.dropped; } catch { /* */ }
      } else if (head.startsWith('{"type":"error"') || head.startsWith('{"type":"end"')) {
        try {
          const m = JSON.parse(data);
          ended = true;
          log.add('flow', source, m.type, scrub(m.code ? `${m.code}: ${m.message ?? ''}` : m.message));
        } catch { /* */ }
      }
    } else if (data) rec.bytes += data.byteLength ?? data.length ?? 0;
    return send(data, ...rest);
  };
  ws.on('close', () => { streams.delete(id); if (!ended) log.add('flow', source, 'stop', 'closed'); });
  return rec;
}
