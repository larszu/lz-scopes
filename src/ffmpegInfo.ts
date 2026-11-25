// Which ffmpeg the bridge runs (server/ffmpeg.mjs → /api/health): origin, version, licence,
// SRT. Everything is read from the binary by the bridge; the UI only shows it.
import { t, type Key } from './i18n';

export interface FfmpegInfo {
  path: string;
  origin: 'env' | 'bundled' | 'vendor' | 'system' | 'none';
  version: string | null;
  license: string | null;
  srt: boolean;
  inputSrt: boolean;
  /** broadcast formats this ffmpeg can read (#233; server/ffmpeg.mjs BROADCAST_FORMATS); missing on old bridges */
  formats?: Partial<Record<BroadcastFormat, boolean>>;
}
export type BroadcastFormat = 'prores' | 'jpegxs' | 'jpeg2000' | 'dnxhd' | 'dolbyE' | 'ac3' | 's302m' | 'sdp';
const FORMAT_NAMES: [BroadcastFormat, string][] = [
  ['prores', 'ProRes'], ['jpegxs', 'JPEG XS'], ['jpeg2000', 'JPEG 2000'], ['dnxhd', 'DNxHD/HR'], ['dolbyE', 'Dolby E'], ['ac3', 'AC-3/E-AC-3'], ['s302m', 'SMPTE 302M'], ['sdp', 'SDP/RTP'],
];

/** „Liest: ProRes, JPEG 2000 … · nicht: JPEG XS“ – '' when the bridge does not report it. */
export function formatsLine(i: FfmpegInfo | null | undefined): string {
  const f = i?.formats;
  if (!f) return '';
  const yes = FORMAT_NAMES.filter(([k]) => f[k]).map(([, n]) => n), no = FORMAT_NAMES.filter(([k]) => f[k] === false).map(([, n]) => n);
  return t('source.ffmpeg.formats', { yes: yes.join(', ') || '–', no: no.join(', ') || '–' });
}
export interface BridgeHealth { ok: boolean; ffmpeg?: FfmpegInfo | null; ffmpegSrt?: FfmpegInfo | null }

const ORIGIN: Record<FfmpegInfo['origin'], Key> = {
  bundled: 'source.ffmpeg.bundled',
  vendor: 'source.ffmpeg.vendor',
  env: 'source.ffmpeg.env',
  system: 'source.ffmpeg.system',
  none: 'source.ffmpeg.none',
};

/** One line: „ffmpeg 9.0.2 · mitgeliefert · GPL-3.0-or-later · SRT ja“. */
export function ffmpegLine(i: FfmpegInfo | null | undefined): string {
  if (!i) return t('source.ffmpeg.notFoundLine');
  const srt = i.srt && i.inputSrt ? t('source.ffmpeg.srtYes') : t('source.ffmpeg.srtNo');
  const license = i.license?.startsWith('nonfree') ? t('bridge.license.nonfree') : i.license;
  return `ffmpeg ${i.version ?? '?'} · ${ORIGIN[i.origin] ? t(ORIGIN[i.origin]) : i.origin} · ${license ?? t('source.ffmpeg.licenceUnknown')} · ${srt}`;
}

/** Text for the bridge section: the main ffmpeg, plus the one used for srt:// when it differs. */
export function bridgeFfmpegText(h: BridgeHealth | null): string {
  if (!h) return t('source.ffmpeg.bridgeUnknown');
  const main = ffmpegLine(h.ffmpeg);
  return h.ffmpegSrt ? `${main}; ${t('source.ffmpeg.forSrt', { line: ffmpegLine(h.ffmpegSrt) })}` : main;
}

/** Hint under a push target: which ffmpeg pushes, and for srt:// whether it can. */
export function pushFfmpegText(target: string, h: BridgeHealth | null): string {
  if (!target) return '';
  if (!h) return t('source.ffmpeg.pushUnknown');
  const srt = /^srt:/i.test(target);
  const used = srt ? (h.ffmpegSrt ?? (h.ffmpeg?.srt && h.ffmpeg.inputSrt ? h.ffmpeg : null)) : h.ffmpeg;
  if (!used) return srt ? t('source.ffmpeg.noSrtPush') : t('source.ffmpeg.notFound');
  return t('source.ffmpeg.pushWith', { line: ffmpegLine(used) });
}

/** Hint in a source card for srt:// inputs: which ffmpeg receives, or that none can. '' otherwise. */
export function sourceFfmpegText(url: string, h: BridgeHealth | null): string {
  if (!/^srt:/i.test(url)) return '';
  if (!h) return t('source.ffmpeg.srtUnknown');
  const used = h.ffmpegSrt ?? (h.ffmpeg?.srt && h.ffmpeg.inputSrt ? h.ffmpeg : null);
  return used ? t('source.ffmpeg.srtReceiveWith', { line: ffmpegLine(used) }) : t('source.ffmpeg.noSrtInput');
}

/** /api/health of the bridge; null if it does not answer (20 s: the first ffmpeg -version can be slow on a cold disk). */
export async function fetchBridgeHealth(httpBase: string): Promise<BridgeHealth | null> {
  try {
    const r = await fetch(`${httpBase}/api/health`, { signal: AbortSignal.timeout(20_000) });
    return r.ok ? await r.json() as BridgeHealth : null;
  } catch { return null; }
}
