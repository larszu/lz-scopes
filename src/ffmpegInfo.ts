// Which ffmpeg the bridge runs (server/ffmpeg.mjs → /api/health): origin, version, licence,
// SRT. Everything is read from the binary by the bridge; the UI only shows it.

export interface FfmpegInfo {
  path: string;
  origin: 'env' | 'bundled' | 'vendor' | 'system' | 'none';
  version: string | null;
  license: string | null;
  srt: boolean;
  inputSrt: boolean;
}
export interface BridgeHealth { ok: boolean; ffmpeg?: FfmpegInfo | null; ffmpegSrt?: FfmpegInfo | null }

const ORIGIN: Record<FfmpegInfo['origin'], string> = {
  bundled: 'mitgeliefert',
  vendor: 'mitgeliefert (npm run ffmpeg:fetch)',
  env: 'aus $FFMPEG',
  system: 'System (PATH)',
  none: '–',
};

/** One line: „ffmpeg 9.0.2 · mitgeliefert · GPL-3.0-or-later · SRT ja“. */
export function ffmpegLine(i: FfmpegInfo | null | undefined): string {
  if (!i) return 'ffmpeg: nicht gefunden';
  const srt = i.srt && i.inputSrt ? 'SRT ja' : 'SRT nein';
  return `ffmpeg ${i.version ?? '?'} · ${ORIGIN[i.origin] ?? i.origin} · ${i.license ?? 'Lizenz unbekannt'} · ${srt}`;
}

/** Text for the bridge section: the main ffmpeg, plus the one used for srt:// when it differs. */
export function bridgeFfmpegText(h: BridgeHealth | null): string {
  if (!h) return 'Bridge nicht erreichbar – ffmpeg unbekannt';
  const main = ffmpegLine(h.ffmpeg);
  return h.ffmpegSrt ? `${main}; für srt:// ${ffmpegLine(h.ffmpegSrt)}` : main;
}

/** Hint under a push target: which ffmpeg pushes, and for srt:// whether it can. */
export function pushFfmpegText(target: string, h: BridgeHealth | null): string {
  if (!target) return '';
  if (!h) return 'Bridge nicht erreichbar – ob gepusht werden kann, ist unbekannt';
  const srt = /^srt:/i.test(target);
  const used = srt ? (h.ffmpegSrt ?? (h.ffmpeg?.srt && h.ffmpeg.inputSrt ? h.ffmpeg : null)) : h.ffmpeg;
  if (!used) return srt ? 'kein ffmpeg mit SRT gefunden – Push nach srt:// geht nicht' : 'ffmpeg nicht gefunden';
  return `Push mit ${ffmpegLine(used)}`;
}

/** Hint in a source card for srt:// inputs: which ffmpeg receives, or that none can. '' otherwise. */
export function sourceFfmpegText(url: string, h: BridgeHealth | null): string {
  if (!/^srt:/i.test(url)) return '';
  if (!h) return 'Bridge nicht erreichbar – SRT-Empfang unbekannt';
  const used = h.ffmpegSrt ?? (h.ffmpeg?.srt && h.ffmpeg.inputSrt ? h.ffmpeg : null);
  return used ? `SRT-Empfang mit ${ffmpegLine(used)}` : 'kein ffmpeg mit SRT gefunden – srt:// geht nicht';
}

/** /api/health of the bridge; null if it does not answer. */
export async function fetchBridgeHealth(httpBase: string): Promise<BridgeHealth | null> {
  try {
    const r = await fetch(`${httpBase}/api/health`, { signal: AbortSignal.timeout(5000) });
    return r.ok ? await r.json() as BridgeHealth : null;
  } catch { return null; }
}
