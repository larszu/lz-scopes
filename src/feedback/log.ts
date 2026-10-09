// Feedback log: the last warnings and errors of this session, kept in memory only.
// Nothing is stored or sent by itself; the feedback dialog shows the lines before anything leaves.

export interface LogLine { at: number; level: 'error' | 'warn'; text: string }

const MAX = 150;
const lines: LogLine[] = [];
const started = Date.now();

/**
 * Removes what identifies people or places: credentials and hosts in URLs, IP addresses, e-mail
 * addresses, user names in home paths. The feedback report runs every free text through this.
 */
export function redact(s: string): string {
  return s
    // scheme://user:pass@host:port/path → scheme://…
    .replace(/\b([a-z][a-z0-9+.-]{1,15}):\/\/[^\s"'<>)]+/gi, '$1://…')
    .replace(/\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/g, '<e-mail>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, '<ip>')
    .replace(/([\\/](?:Users|home)[\\/])[^\\/\s"']+/gi, '$1<user>')
    .replace(/(\b[A-Z]:\\Users\\)[^\\\s"']+/gi, '$1<user>');
}

function fmt(args: unknown[]): string {
  return args.map((a) => {
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ').slice(0, 500);
}

export function logLine(level: LogLine['level'], raw: string) {
  const text = redact(raw), last = lines[lines.length - 1];
  // a message repeated every frame would push out everything else
  if (last && last.text === text && last.level === level) return;
  lines.push({ at: Date.now(), level, text });
  if (lines.length > MAX) lines.splice(0, lines.length - MAX);
}

let installed = false;
/** Hooks console.warn/error and uncaught errors (the console keeps working as before). */
export function installFeedbackLog() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  for (const level of ['warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => { logLine(level, fmt(args)); orig(...args); };
  }
  window.addEventListener('error', (e) => logLine('error', `${e.message}${e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno})` : ''}`));
  window.addEventListener('unhandledrejection', (e) => logLine('error', `unhandled: ${fmt([e.reason])}`));
}

/** Lines with their time since app start (mm:ss), oldest first. */
export function logLines(): string[] {
  return lines.map((l) => {
    const s = Math.max(0, Math.round((l.at - started) / 1000));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} ${l.level === 'error' ? 'E' : 'W'} ${l.text}`;
  });
}
