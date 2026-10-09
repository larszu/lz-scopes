// Feedback report: plain text built from what the dialog collected, one block per section.
// Exactly this text is shown in the dialog and sent – nothing else goes along.

import { redact } from './log';

export type Section = 'system' | 'display' | 'performance' | 'log';
export const SECTIONS: Section[] = ['system', 'display', 'performance', 'log'];

export interface SourceInfo {
  kind: string; status: string; width: number; height: number; depth: number; fps: number; dropped: number;
  codec?: string; pixFmt?: string; sourceSize?: string; stats?: string; message?: string;
}

export interface FeedbackData {
  app: { version: string; platform: string; lang: string };
  system: { os: string; arch?: string; cpu?: string; cores?: number; ramGb?: number; runtime?: string };
  display: { gpu?: string; gpuFeatures?: string; screens: string[] };
  performance: { displayFps: number; panels: string[]; sources: SourceInfo[]; ffmpeg?: string; bridge: boolean };
  log: string[];
}

const kv = (k: string, v: unknown) => (v === undefined || v === null || v === '' ? null : `${k}: ${v}`);

function block(title: string, rows: (string | null)[]) {
  return [`## ${title}`, ...rows.filter((r): r is string => r !== null)].join('\n');
}

function source(s: SourceInfo, i: number) {
  const size = s.width ? `${s.width}×${s.height}` : '–';
  return [
    `- #${i + 1} ${s.kind} · ${s.status} · ${size} · ${s.depth} bit · ${s.fps ? `${Math.round(s.fps * 10) / 10} fps` : '– fps'}${s.dropped ? ` · ${s.dropped} dropped` : ''}`,
    s.sourceSize || s.codec || s.pixFmt ? `  in: ${[s.sourceSize, s.codec, s.pixFmt].filter(Boolean).join(' · ')}` : null,
    s.stats ? `  stats: ${s.stats}` : null,
    s.message ? `  message: ${redact(s.message)}` : null,
  ].filter(Boolean).join('\n');
}

export function buildReport(d: FeedbackData, o: { sections: ReadonlySet<Section>; description: string; titles: Record<Section, string> }): string {
  const out: string[] = [];
  const text = o.description.trim();
  if (text) out.push(text, '');
  out.push(`LZ Scopes ${d.app.version} · ${d.app.platform} · ${d.app.lang}`);
  const on = (s: Section) => o.sections.has(s);
  if (on('system')) {
    const s = d.system;
    out.push('', block(o.titles.system, [
      kv('OS', s.os), kv('Arch', s.arch), kv('CPU', s.cpu ? `${s.cpu}${s.cores ? ` (${s.cores} threads)` : ''}` : s.cores ? `${s.cores} threads` : ''),
      kv('RAM', s.ramGb ? `${s.ramGb} GB` : ''), kv('Runtime', s.runtime),
    ]));
  }
  if (on('display')) {
    out.push('', block(o.titles.display, [kv('GPU', d.display.gpu), kv('GPU features', d.display.gpuFeatures), ...d.display.screens.map((x, i) => `Screen ${i + 1}: ${x}`)]));
  }
  if (on('performance')) {
    const p = d.performance;
    out.push('', block(o.titles.performance, [
      `Display: ${p.displayFps} fps`, kv('Panels', p.panels.join(', ')),
      `Bridge: ${p.bridge ? 'ok' : 'not reachable'}`, kv('ffmpeg', p.ffmpeg),
      ...(p.sources.length ? ['Sources:', ...p.sources.map(source)] : []),
    ]));
  }
  if (on('log')) out.push('', block(o.titles.log, d.log.length ? d.log.map(redact) : ['–']));
  return out.join('\n');
}

/** Shortens the report for a URL (mail programs and GitHub cut long links); the full text goes to the clipboard. */
export function fitForUrl(report: string, max: number, note: string): string {
  if (encodeURIComponent(report).length <= max) return report;
  let lo = 0, hi = report.length;
  const tail = `\n\n${note}`;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encodeURIComponent(report.slice(0, mid) + tail).length <= max) lo = mid; else hi = mid - 1;
  }
  return report.slice(0, lo) + tail;
}
