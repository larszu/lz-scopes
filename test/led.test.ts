import { describe, expect, it } from 'vitest';
import {
  analyseWall, angleSeries, averageFrames, cameraMatrix, chromaOf, compareResults, findOutlierPixels, homography,
  invertHomography, locateOnWall, lumaOf, ocioMatrix, project, reportCsv, scanLineIndex, wallToImage, type Frame, type Pt,
} from '../src/led/analysis';
import { cabinetNumber, cabinets, parsePatchList, patchIndex, pictureSize, sanitizeSettings, sanitizeWall, PATCH_PRESETS, type WallConfig } from '../src/led/wall';
import { mul3 } from '../src/color';

const wall = (p: Partial<WallConfig> = {}): WallConfig => sanitizeWall({ name: 'T', cabW: 100, cabH: 100, cols: 4, rows: 3, ...p });

describe('wall model', () => {
  it('numbers cabinets row-wise, column-wise and as a snake', () => {
    const w = wall();
    expect(cabinetNumber(w, 0, 0)).toBe(1);
    expect(cabinetNumber(w, 3, 0)).toBe(4);
    expect(cabinetNumber(w, 0, 1)).toBe(5);
    expect(cabinetNumber({ ...w, order: 'cols' }, 1, 0)).toBe(4);
    expect(cabinetNumber({ ...w, order: 'snake' }, 0, 1)).toBe(8);
    expect(cabinetNumber({ ...w, order: 'snake', start: 0 }, 3, 1)).toBe(4);
    expect(new Set(cabinets({ ...w, order: 'snake' }).map((c) => c.id)).size).toBe(12);
  });
  it('picture size = offset + cabinets; sanitising keeps it within 16384 px', () => {
    expect(pictureSize(wall({ offX: 20, offY: 10 }))).toEqual({ w: 420, h: 310 });
    const big = sanitizeWall({ cabW: 256, cabH: 256, cols: 500, rows: 2 });
    expect(big.cols * big.cabW).toBeLessThanOrEqual(16384);
    expect(sanitizeWall({ cabW: -5 }).cabW).toBe(8);
  });
  it('parses patch lists in 0–1, 0–255 and %', () => {
    expect(parsePatchList('1 0 0\n255,128,0\n50% 50% 50%\n# comment\nfoo')).toEqual([[1, 0, 0], [1, 128 / 255, 0], [0.5, 0.5, 0.5]]);
  });
  it('Unreal verification set is 5×5×5 in 0.25 steps (Epic docs)', () => {
    const l = PATCH_PRESETS.find((p) => p.id === 'grid5')!.list();
    expect(l).toHaveLength(125);
    expect(new Set(l.flat())).toEqual(new Set([0, 0.25, 0.5, 0.75, 1]));
  });
  it('sequencer steps every n seconds in auto mode', () => {
    const p = sanitizeSettings({ patch: { list: [[0, 0, 0], [1, 1, 1], [1, 0, 0]], auto: true, seconds: 2 } as never }).patch;
    expect([0, 1.9, 2, 4.5, 6].map((t) => patchIndex(p, t))).toEqual([0, 0, 1, 2, 0]);
    expect(patchIndex({ ...p, auto: false, index: 7 }, 99)).toBe(2);
  });
});

describe('homography', () => {
  it('maps the four points exactly and inverts', () => {
    const from: Pt[] = [[0, 0], [400, 0], [400, 300], [0, 300]];
    const to: Pt[] = [[112, 80], [905, 131], [860, 690], [70, 610]];
    const H = homography(from, to);
    from.forEach((p, i) => { const q = project(H, ...p); expect(q[0]).toBeCloseTo(to[i][0], 8); expect(q[1]).toBeCloseTo(to[i][1], 8); });
    const back = project(invertHomography(H), ...project(H, 123, 77));
    expect(back[0]).toBeCloseTo(123, 8); expect(back[1]).toBeCloseTo(77, 8);
  });
  it('reproduces a known projective transform', () => {
    // H = [[1.2, 0.1, 30], [0.05, 0.9, 20], [0.0004, 0.0002, 1]]
    const Hk = [1.2, 0.1, 30, 0.05, 0.9, 20, 0.0004, 0.0002, 1];
    const src: Pt[] = [[0, 0], [500, 0], [500, 400], [0, 400]];
    const H = homography(src, src.map((p) => project(Hk, ...p)));
    H.forEach((v, i) => expect(v).toBeCloseTo(Hk[i], 9));
  });
  it('rejects collinear corners', () => {
    expect(() => homography([[0, 0], [1, 0], [2, 0], [3, 0]], [[0, 0], [1, 1], [2, 2], [3, 3]])).toThrow();
  });
});

/** Render a wall with per-cabinet levels into a camera frame through a perspective. */
function renderWall(w: WallConfig, corners: Pt[], level: (c: number, r: number, wx: number, wy: number) => number, width = 640, height = 480): Frame {
  const inv = invertHomography(wallToImage(w, corners));
  const rgb = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const [wx, wy] = project(inv, x + 0.5, y + 0.5);
    const c = Math.floor(wx / w.cabW), r = Math.floor(wy / w.cabH);
    const v = c >= 0 && r >= 0 && c < w.cols && r < w.rows ? level(c, r, wx, wy) : 0;
    rgb.fill(v, (y * width + x) * 3, (y * width + x) * 3 + 3);
  }
  return { width, height, rgb };
}

describe('wall analysis', () => {
  const w = wall();
  const corners: Pt[] = [[60, 50], [590, 70], [600, 430], [40, 410]];
  it('finds the brighter cabinet through the perspective (+10 %)', () => {
    const f = renderWall(w, corners, (c, r) => (c === 2 && r === 1 ? 0.55 : 0.5));
    const res = analyseWall(f, w, corners, { samples: 16 });
    const hot = res.cabinets.find((c) => c.label === 'C3-R2')!;
    expect(hot.dev).toBeCloseTo(10, 1);
    expect(res.cabinets.filter((c) => c !== hot).every((c) => Math.abs(c.dev) < 0.01)).toBe(true);
    expect(res.uniformity).toBeCloseTo((0.5 / 0.55) * 100, 1);
  });
  it('flags a bright seam and ignores seams without a line', () => {
    const big = corners.map(([x, y]) => [x * 2, y * 2] as Pt);
    const f = renderWall(w, big, (_c, _r, wx) => (Math.abs(wx - 200) < 3 ? 0.8 : 0.5), 1280, 960);
    const res = analyseWall(f, w, big);
    const seams = [...res.seams].sort((a, b) => b.contrast - a.contrast);
    expect(seams[0].dir).toBe('v');
    expect(seams[0].a).toMatch(/^C2-/);
    expect(seams[0].contrast).toBeGreaterThan(10);
    expect(res.seams.filter((s) => s.dir === 'h').every((s) => Math.abs(s.contrast) < 0.5)).toBe(true);
    expect(seams[0].profile[10]).toBeGreaterThan(seams[0].profile[0]);
  });
  it('linearises with the inverse BT.709 OETF (BT.709-6: V = 1.099 L^0.45 − 0.099)', () => {
    expect(lumaOf([0.5, 0.5, 0.5], 'code')).toBeCloseTo(0.5, 12);
    expect(lumaOf([0.409, 0.409, 0.409], 'bt709')).toBeCloseTo(0.18, 3); // 18 % grey ↔ 40.9 % (BT.709-6 p5)
    const [cb, cr] = chromaOf([1, 0, 0]);
    expect(cr).toBeCloseTo(0.5, 12); // BT.709 red: Cr = +0.5
    expect(cb).toBeCloseTo(-0.2126 / 1.8556, 12);
  });
  it('compares before and after, builds an angle series and a CSV', () => {
    const f1 = renderWall(w, corners, (c) => (c === 0 ? 0.45 : 0.5));
    const f2 = renderWall(w, corners, () => 0.5);
    const before = analyseWall(f1, w, corners), after = analyseWall(f2, w, corners);
    const d = compareResults(before, after).find((x) => x.label === 'C1-R1')!;
    expect(d.before).toBeCloseTo(-10, 1);
    expect(d.delta).toBeCloseTo(10, 1);
    const f3 = renderWall(w, corners, () => 0.4);
    const s = angleSeries([{ angle: 40, result: analyseWall(f3, w, corners) }, { angle: 0, result: after }]);
    expect(s.map((p) => p.angle)).toEqual([0, 40]);
    expect(s[1].relative).toBeCloseTo(80, 1);
    const csv = reportCsv(after, { Kamera: 'FX6, 1/50' }, compareResults(before, after));
    expect(csv).toContain('C1-R1');
    expect(csv).toContain('# Kamera,"FX6, 1/50"');
    expect(csv.split('\n').filter((l) => /^\d+,C\d-R\d,/.test(l))).toHaveLength(12);
  });
  it('averages frames', () => {
    const a: Frame = { width: 1, height: 1, rgb: Float32Array.from([0, 0.5, 1]) };
    const b: Frame = { width: 1, height: 1, rgb: Float32Array.from([1, 0.5, 0]) };
    expect([...averageFrames([a, b]).rgb]).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('scan lines and dead pixels', () => {
  const frame = (fn: (x: number, y: number) => number, w = 200, h = 200): Frame => {
    const rgb = new Float32Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.fill(fn(x, y), (y * w + x) * 3, (y * w + x) * 3 + 3);
    return { width: w, height: h, rgb };
  };
  it('scan-line index: 0 for an even field, amplitude/√2 for a sine banding', () => {
    expect(scanLineIndex(frame(() => 0.5)).index).toBeCloseTo(0, 6);
    // slow vertical gradient is removed by the moving average
    expect(scanLineIndex(frame((_x, y) => 0.3 + y / 1000)).index).toBeLessThan(0.05);
    // banding with a 4-line period, ±5 % of the mean
    const idx = scanLineIndex(frame((_x, y) => 0.5 * (1 + 0.05 * Math.sin((2 * Math.PI * y) / 4 + 0.3))), null, 21).index;
    expect(idx).toBeCloseTo(5 / Math.SQRT2, 0);
  });
  it('finds a stuck and a dead pixel and places them on the wall', () => {
    const f = frame((x, y) => (x === 50 && y === 60 ? 1 : x === 120 && y === 30 ? 0 : 0.5));
    const hits = findOutlierPixels(f, null, 0.2);
    expect(hits.map((h) => [h.x, h.y, h.kind])).toEqual([[120, 30, 'dunkel'], [50, 60, 'hell']]);
    const w = wall({ cabW: 50, cabH: 50, cols: 4, rows: 4 });
    const loc = locateOnWall(w, [[0, 0], [200, 0], [200, 200], [0, 200]], 50, 60)!;
    expect(loc.label).toBe('C2-R2');
    expect([loc.px, loc.py]).toEqual([50, 60]);
  });
});

describe('camera matrix (Epic, Camera Color Calibration for ICVFX)', () => {
  it('undoes a camera crosstalk matrix and maps white to equal channels', () => {
    // camera sees wall RGB through M (columns = camera response to R, G, B)
    const M = [0.8, 0.15, 0.05, 0.1, 0.85, 0.1, 0.02, 0.1, 0.7];
    const r = mul3(M, [1, 0, 0]), g = mul3(M, [0, 1, 0]), b = mul3(M, [0, 0, 1]), w = mul3(M, [1, 1, 1]);
    const C = cameraMatrix(r, g, b, w);
    const out = mul3(C, w);
    expect(out[0]).toBeCloseTo(out[1], 9); expect(out[1]).toBeCloseTo(out[2], 9);
    // a pure wall primary comes out as a pure channel
    const red = mul3(C, r);
    expect(Math.abs(red[1])).toBeLessThan(1e-9); expect(Math.abs(red[2])).toBeLessThan(1e-9);
    expect(ocioMatrix(C)).toMatch(/^!<MatrixTransform> \{matrix: \[/);
  });
});
