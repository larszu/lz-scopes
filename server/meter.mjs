// Colour meter via ArgyllCMS `spotread`, started as a separate program (display calibration #9).
// ArgyllCMS is AGPL-3 and is neither bundled nor linked: LZ Scopes only uses a spotread the user
// installed, talks to it over stdin/stdout like DisplayCAL does, and says so when it is missing.
// Output format and prompts: docs/research/display-kalibrierung.md. Untested with real hardware.
//
//   GET  /api/meter        → { found, path, instruments: [{ port, name }] }
//   WS   /meter            ← { cmd: 'open', port?, displayType?, correction?: { name, text }, skipCal? }
//                          ← { cmd: 'read' } | { cmd: 'key', key } | { cmd: 'close' }
//                          → { type: 'status' | 'ready' | 'reading' | 'light' | 'error' | 'log' | 'closed', … }
//                            'light' (ambient only): { xyz, lux?, cct?, duv?, spectrum?, cri?, tlci?, tm30? }

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const EXE = process.platform === 'win32' ? 'spotread.exe' : 'spotread';

/** Where spotread may live: $LZS_ARGYLL_BIN, PATH, the usual install folders. */
export function spotreadCandidates(env = process.env, platform = process.platform) {
  const exe = platform === 'win32' ? 'spotread.exe' : 'spotread';
  const dirs = [];
  if (env.LZS_ARGYLL_BIN) dirs.push(env.LZS_ARGYLL_BIN);
  dirs.push(...(env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean));
  const scan = (base, prefix) => { try { for (const d of readdirSync(base)) if (d.toLowerCase().startsWith(prefix)) dirs.push(join(base, d, 'bin')); } catch { /* missing */ } };
  if (platform === 'darwin') { dirs.push('/opt/homebrew/bin', '/usr/local/bin'); scan('/Applications', 'argyll'); scan(homedir(), 'argyll'); }
  else if (platform === 'win32') { for (const b of [env.ProgramFiles, env['ProgramFiles(x86)'], 'C:\\']) if (b) scan(b, 'argyll'); }
  else { dirs.push('/usr/bin', '/usr/local/bin'); scan(homedir(), 'argyll'); }
  return [...new Set(dirs)].map((d) => join(d, exe));
}
export const findSpotread = () => spotreadCandidates().find((p) => existsSync(p)) ?? null;

/** Parse one chunk of spotread output. Returns the events it contains. */
export function parseSpotread(text) {
  const ev = [];
  const m = /Result is XYZ:\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/.exec(text);
  if (m) ev.push({ type: 'reading', xyz: [Number(m[1]), Number(m[2]), Number(m[3])] });
  if (/Spot read failed/i.test(text)) ev.push({ type: 'error', message: text.trim().split('\n').find((l) => /failed/i.test(l)) ?? 'Messung fehlgeschlagen' });
  if (/needs a calibration/i.test(text)) ev.push({ type: 'status', message: 'Messgerät braucht eine Kalibrierung – Anweisung im Protokoll folgen, dann „Taste senden“.' });
  if (/key to take a reading/i.test(text)) ev.push({ type: 'ready' });
  return ev;
}

/** Instrument list from the usage text (`-c listno … from the following list`). */
export function parseInstruments(usage) {
  const out = [];
  for (const l of usage.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s*=\s*'(.+)'\s*$/.exec(l);
    if (m) out.push({ port: Number(m[1]), name: m[2] });
  }
  return out;
}

/**
 * Validated spotread arguments (no shell, nothing free-form). `ambient` = light-meter use (#11):
 * `-a` ambient (illuminance, falls back to emissive when the instrument has no ambient mode) and
 * `-s` print the spectrum; in ambient mode spotread then also prints CCT, CRI, TLCI and TM-30
 * when the instrument measures spectrally (argyllcms.com/doc/spotread.html, -a/-s/-T).
 */
export function spotreadArgs({ port, displayType, correctionFile, skipCal, ambient } = {}) {
  const a = ambient ? ['-a', '-s'] : ['-e'];
  if (port !== undefined && port !== null && port !== '') {
    const p = Number(port);
    if (!Number.isInteger(p) || p < 1 || p > 99) throw new Error('ungültiger Port');
    a.push('-c', String(p));
  }
  if (displayType) {
    if (!/^[A-Za-z0-9_]{1,3}$/.test(displayType)) throw new Error('ungültiger Displaytyp');
    a.push('-y', displayType);
  }
  if (correctionFile) a.push('-X', correctionFile);
  if (skipCal) a.push('-N');
  return a;
}

/** Write an uploaded .ccmx/.ccss to a temp file after a minimal format check (CGATS header). */
export function writeCorrection(c) {
  if (!c) return null;
  const ext = /\.(ccmx|ccss)$/i.exec(String(c.name ?? ''))?.[1]?.toLowerCase();
  const text = String(c.text ?? '');
  if (!ext || text.length > 2_000_000) throw new Error('Korrektur muss eine .ccmx- oder .ccss-Datei sein');
  if (!text.trimStart().toUpperCase().startsWith(ext.toUpperCase())) throw new Error(`Datei beginnt nicht mit ${ext.toUpperCase()} (CGATS-Kopf)`);
  const dir = mkdtempSync(join(tmpdir(), 'lzs-meter-'));
  const file = join(dir, `korrektur.${ext}`);
  writeFileSync(file, text);
  return { file, dir };
}

/**
 * Collects the lines spotread prints for one ambient/spectral reading and returns a 'light' event
 * when the next prompt appears. Line formats as printed by spotread.c of ArgyllCMS 3.5.0 (read as
 * facts, no code taken): "Spectrum from A to B nm in N steps", then one line "v, v, …";
 * " Result is XYZ: X Y Z, …"; " Ambient = L Lux, CCT = TK (Duv d)"; " Color Rendering Index (Ra) =
 * r [ R9 = r9 ]" and "  R1  = …" lines; " Television Lighting Consistency Index 2012 (Qa) = q";
 * " IES TM-30-15 Rf = f Rg = g CCT = T Duv = d". "(Caution)" marks values ArgyllCMS doubts.
 */
export class LightAccumulator {
  constructor() { this.cur = null; this.wantSpectrum = null; }
  /** @returns {object[]} events */
  feed(line) {
    const out = [];
    let m;
    if ((m = /Spectrum from\s+([\d.]+)\s+to\s+([\d.]+)\s+nm in\s+(\d+)\s+steps/.exec(line))) {
      this.wantSpectrum = { start: Number(m[1]), end: Number(m[2]), n: Number(m[3]) };
      return out;
    }
    if (this.wantSpectrum && /^\s*-?\d/.test(line) && line.includes(',')) {
      const values = line.split(',').map((v) => Number(v.trim()));
      if (values.length === this.wantSpectrum.n && values.every(Number.isFinite)) {
        this.cur = { ...(this.cur ?? {}), spectrum: { start: this.wantSpectrum.start, end: this.wantSpectrum.end, values } };
      }
      this.wantSpectrum = null;
      return out;
    }
    if ((m = /Result is XYZ:\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(line))) this.cur = { ...(this.cur ?? {}), xyz: [Number(m[1]), Number(m[2]), Number(m[3])] };
    else if ((m = /Ambient = ([\d.]+) Lux(?:, CCT = (\d+)K \(Duv (-?[\d.]+)\))?/.exec(line))) this.cur = { ...(this.cur ?? {}), lux: Number(m[1]), ...(m[2] ? { cct: Number(m[2]), duv: Number(m[3]) } : {}) };
    else if ((m = /Color Rendering Index \(Ra\) = (-?[\d.]+) \[ R9 = (-?[\d.]+) \](.*)/.exec(line))) this.cur = { ...(this.cur ?? {}), cri: { ra: Number(m[1]), r9: Number(m[2]), r: [], caution: /Caution/.test(m[3]) } };
    else if (this.cur?.cri && /^\s*R\d+\s*=/.test(line)) { for (const r of line.matchAll(/R(\d+)\s*=\s*(-?[\d.]+)/g)) this.cur.cri.r[Number(r[1]) - 1] = Number(r[2]); }
    else if ((m = /Consistency Index 2012 \(Qa\) = (-?[\d.]+)(.*)/.exec(line))) this.cur = { ...(this.cur ?? {}), tlci: { qa: Number(m[1]), caution: /Caution/.test(m[2]) } };
    else if ((m = /TM-30-15 Rf = (-?[\d.]+) Rg = (-?[\d.]+)(.*)/.exec(line))) this.cur = { ...(this.cur ?? {}), tm30: { rf: Number(m[1]), rg: Number(m[2]), caution: /Caution/.test(m[3]) } };
    else if (/key to take a reading/i.test(line) && this.cur?.xyz) { out.push({ type: 'light', ...this.cur }); this.cur = null; }
    return out;
  }
}

let usageCache = null;
export async function meterInfo() {
  const path = findSpotread();
  if (!path) return { found: false, path: null, instruments: [] };
  if (!usageCache || usageCache.path !== path) {
    const text = await new Promise((ok) => {
      let s = '';
      let p;
      try { p = spawn(path, ['-?'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch { return ok(''); }
      const t = setTimeout(() => p.kill(), 8000);
      p.stdout.on('data', (d) => (s += d)); p.stderr.on('data', (d) => (s += d));
      p.on('error', () => { clearTimeout(t); ok(''); });
      p.on('close', () => { clearTimeout(t); ok(s); });
    });
    usageCache = { path, instruments: parseInstruments(text), version: /Version\s+([\w.]+)/i.exec(text)?.[1] ?? null };
  }
  return { found: true, path, instruments: usageCache.instruments, version: usageCache.version };
}

/** One WebSocket client = at most one spotread process. */
export function handleMeterSocket(ws) {
  /** @type {import('node:child_process').ChildProcess | null} */
  let proc = null, corr = null, buf = '', acc = null;
  const send = (o) => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(o)); };
  const cleanup = () => {
    if (proc) { try { proc.stdin?.write('q'); } catch { /* closed */ } const p = proc; setTimeout(() => p.kill(), 1500); proc = null; }
    if (corr) { try { rmSync(corr.dir, { recursive: true, force: true }); } catch { /* ignore */ } corr = null; }
  };
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    try {
      if (msg.cmd === 'open') {
        cleanup();
        const path = findSpotread();
        if (!path) return send({ type: 'error', message: 'ArgyllCMS nicht gefunden (spotread). Installieren oder LZS_ARGYLL_BIN setzen – oder Werte manuell eingeben.' });
        corr = writeCorrection(msg.correction);
        const args = spotreadArgs({ port: msg.port, displayType: msg.displayType, correctionFile: corr?.file, skipCal: !!msg.skipCal, ambient: !!msg.ambient });
        acc = msg.ambient ? new LightAccumulator() : null;
        send({ type: 'status', message: `Starte ${path} ${args.join(' ')}` });
        proc = spawn(path, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
        const onData = (d) => {
          const t = String(d);
          send({ type: 'log', text: t });
          // complete lines only (a number may be cut between chunks); the prompt has no newline
          const lines = (buf + t).split(/\r?\n/);
          buf = lines.pop().slice(-4000);
          for (const l of lines) { for (const e of parseSpotread(l)) send(e); if (acc) for (const e of acc.feed(l)) send(e); }
          if (/key to take a reading/i.test(buf)) { for (const e of parseSpotread(buf)) send(e); if (acc) for (const e of acc.feed(buf)) send(e); buf = ''; }
        };
        proc.stdout.on('data', onData); proc.stderr.on('data', onData);
        proc.on('error', (e) => send({ type: 'error', message: `spotread: ${e.message}` }));
        proc.on('close', (code) => { send({ type: 'closed', code }); proc = null; });
      } else if (msg.cmd === 'read') {
        if (!proc) return send({ type: 'error', message: 'Messgerät nicht verbunden' });
        proc.stdin.write(' ');
      } else if (msg.cmd === 'key') {
        // only single printable keys spotread documents (space, letters) – nothing else reaches stdin
        if (proc && /^[ A-Za-z]$/.test(String(msg.key))) proc.stdin.write(String(msg.key));
      } else if (msg.cmd === 'close') cleanup();
    } catch (e) { send({ type: 'error', message: e.message }); }
  });
  ws.on('close', cleanup);
}
