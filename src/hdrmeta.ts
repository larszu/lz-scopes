// HDR10 light-level metadata as measured values (issue #8): MaxCLL and MaxFALL.
// Definition as in alwan docs/api/hdr.md l. 66–96 (MIT, github.com/soufianekhiat/alwan):
// MaxCLL = max(R, G, B) over all pixels, MaxFALL = average of the per-pixel max(R, G, B),
// both in cd/m² of linear display light. Over a programme, MaxCLL is the largest pixel and
// MaxFALL the largest frame average (running maxima below).

import { gammaEotf, hlgInverseOetf, hlgOotf, isGamma, pqDecode, type Transfer } from './color';
import type { Decode } from './ycbcr';

/** Display light of one pixel in cd/m² per channel; null for scene-referred (log) signals. */
export function pixelNits(rgb: number[], transfer: Transfer, lw = 1000): number[] | null {
  if (transfer === 'pq') return rgb.map(pqDecode);
  if (transfer === 'hlg') return hlgOotf(rgb.map((v) => hlgInverseOetf(Math.max(0, v))) as [number, number, number], lw);
  // SDR: BT.1886 with Lw = 100 cd/m², black 0 (BT.1886, p4–5)
  if (isGamma(transfer)) return rgb.map((v) => 100 * Math.max(0, gammaEotf(transfer, v)));
  return null;
}

export interface LightLevels { maxCll: number; fall: number; samples: number }

/** MaxCLL and frame-average light level of one frame (subsampled by `step`). */
export function lightLevels(px: ArrayLike<number>, w: number, h: number, step: number, decode: Decode, transfer: Transfer, lw = 1000): LightLevels | null {
  if (!isGamma(transfer) && transfer !== 'pq' && transfer !== 'hlg') return null;
  let max = 0, sum = 0, n = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const nits = pixelNits(decode(px, (y * w + x) * 4), transfer, lw)!;
      const m = Math.max(nits[0], nits[1], nits[2]);
      if (m > max) max = m;
      sum += m; n++;
    }
  }
  return n ? { maxCll: max, fall: sum / n, samples: n } : null;
}
