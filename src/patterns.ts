// Test pattern generator. Every pattern draws into a 2D canvas in full-range R'G'B'
// (0 = 0 %, 255 = 100 %). Ramps and zone plates are written pixel by pixel so the
// browser cannot dither them. Values below 0 % (PLUGE sub-black) cannot exist in
// full-range RGB and are clipped to 0.

import { hlgFromNits, pqEncode } from './color';

export interface PatternDef {
  id: string;
  name: string;
  group: string;
  animated?: boolean;
  /** Suggested transfer for the scopes (HDR patterns). */
  transfer?: 'pq' | 'hlg';
  /** Image-based pattern (bundled or user file). */
  src?: string;
  draw?: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
}

type RGB = [number, number, number];
const lv = (p: number) => Math.round(Math.max(0, Math.min(1, p)) * 255);
const gray = (p: number): RGB => [lv(p), lv(p), lv(p)];
const css = ([r, g, b]: RGB) => `rgb(${r},${g},${b})`;

function fill(ctx: CanvasRenderingContext2D, c: RGB, x: number, y: number, w: number, h: number) {
  ctx.fillStyle = css(c);
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(x + w) - Math.round(x), Math.round(y + h) - Math.round(y));
}

let scratch: HTMLCanvasElement | null = null;
/** putImageData ignores clip paths; go through a scratch canvas so clipping applies (values stay exact). */
function blit(ctx: CanvasRenderingContext2D, img: ImageData, x: number, y: number) {
  scratch ??= document.createElement('canvas');
  scratch.width = img.width; scratch.height = img.height;
  scratch.getContext('2d')!.putImageData(img, 0, 0);
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, x, y);
  ctx.imageSmoothingEnabled = smooth;
}

/** Per-pixel fill (no dithering, exact code values). */
function pixels(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, fn: (x: number, y: number) => RGB) {
  x0 = Math.round(x0); y0 = Math.round(y0); w = Math.round(w); h = Math.round(h);
  if (w <= 0 || h <= 0) return;
  const img = ctx.createImageData(w, h), d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y), i = (y * w + x) * 4;
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  blit(ctx, img, x0, y0);
}

/** Horizontal ramp that only depends on x: one row computed, then copied. */
function hramp(ctx: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, fn: (f: number) => RGB) {
  x0 = Math.round(x0); y0 = Math.round(y0); w = Math.round(w); h = Math.round(h);
  if (w <= 0 || h <= 0) return;
  const img = ctx.createImageData(w, h), d = img.data;
  for (let x = 0; x < w; x++) {
    const [r, g, b] = fn(w === 1 ? 0 : x / (w - 1));
    d[x * 4] = r; d[x * 4 + 1] = g; d[x * 4 + 2] = b; d[x * 4 + 3] = 255;
  }
  for (let y = 1; y < h; y++) d.copyWithin(y * w * 4, 0, w * 4);
  blit(ctx, img, x0, y0);
}

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = '#fff', align: CanvasTextAlign = 'center') {
  ctx.font = `600 ${Math.round(size)}px system-ui, -apple-system, sans-serif`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

function hsv(h: number, s = 1, v = 1): RGB {
  h = ((h % 1) + 1) % 1;
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return [lv(r), lv(g), lv(b)];
}

const BARS = (a: number): RGB[] => [
  [a, a, a], [a, a, 0], [0, a, a], [0, a, 0], [a, 0, a], [a, 0, 0], [0, 0, a],
].map((c) => c.map(lv) as RGB);

function smpteBars(ctx: CanvasRenderingContext2D, w: number, h: number, amp: number) {
  const top = BARS(amp), bw = w / 7;
  top.forEach((c, i) => fill(ctx, c, i * bw, 0, bw, h * 0.67));
  const mid: RGB[] = [top[6], [0, 0, 0], top[4], [0, 0, 0], top[2], [0, 0, 0], top[0]];
  mid.forEach((c, i) => fill(ctx, c, i * bw, h * 0.67, bw, h * 0.08));
  const y = h * 0.75, bh = h * 0.25, qw = (bw * 5) / 4;
  // -I, 100 % white, +Q, black (commonly used full-range RGB approximations)
  fill(ctx, [0, 33, 76], 0, y, qw, bh);
  fill(ctx, [255, 255, 255], qw, y, qw, bh);
  fill(ctx, [50, 0, 106], qw * 2, y, qw, bh);
  fill(ctx, [0, 0, 0], qw * 3, y, qw, bh);
  // PLUGE: -4 % (clipped to 0), 0 %, +4 %, then black
  const pw = bw / 3;
  fill(ctx, gray(0), bw * 5, y, pw, bh);
  fill(ctx, gray(0), bw * 5 + pw, y, pw, bh);
  fill(ctx, gray(0.04), bw * 5 + pw * 2, y, pw, bh);
  fill(ctx, [0, 0, 0], bw * 6, y, bw, bh);
}

function arrows(ctx: CanvasRenderingContext2D, w: number, h: number, color = '#000') {
  const s = Math.min(w, h) * 0.035;
  ctx.fillStyle = color;
  const tri = (pts: number[]) => { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); ctx.lineTo(pts[2], pts[3]); ctx.lineTo(pts[4], pts[5]); ctx.closePath(); ctx.fill(); };
  for (const fx of [0.173, 0.827]) {
    const x = w * fx;
    tri([x - s / 2, s, x + s / 2, s, x, 0]);
    tri([x - s / 2, h - s, x + s / 2, h - s, x, h]);
  }
  for (const fy of [0.28, 0.72]) {
    const y = h * fy;
    tri([s, y - s / 2, s, y + s / 2, 0, y]);
    tri([w - s, y - s / 2, w - s, y + s / 2, w, y]);
  }
}

/** Sinusoidal circular zone plate reaching Nyquist at the frame corner. */
function zonePlate(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cx = w / 2, cy = h / 2, rmax2 = cx * cx + cy * cy;
  const k = Math.PI / Math.sqrt(rmax2); // d(phase)/dr = k·r = π at the corner → 0.5 cycles/px
  pixels(ctx, 0, 0, w, h, (x, y) => {
    const dx = x - cx, dy = y - cy;
    return gray(0.5 + 0.5 * Math.cos((k * (dx * dx + dy * dy)) / 2 - t * 4));
  });
}

// X-Rite ColorChecker Classic, widely published sRGB approximations
const MACBETH: RGB[] = [
  [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
];

function testCard(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  fill(ctx, gray(0.35), 0, 0, w, h);
  const cell = h / 14;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, Math.round(h / 540));
  ctx.beginPath();
  for (let x = w / 2 % cell; x <= w; x += cell) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
  for (let y = h / 2 % cell; y <= h; y += cell) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
  ctx.stroke();
  const cx = w / 2, cy = h / 2, R = h * 0.44;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
  fill(ctx, [0, 0, 0], 0, 0, w, h);
  // bars
  const bw = (R * 2) / 8, bx = cx - R;
  [...BARS(0.75), [0, 0, 0] as RGB].forEach((c, i) => fill(ctx, c, bx + i * bw, cy - R, bw, R * 0.55));
  // grey steps
  for (let i = 0; i < 6; i++) fill(ctx, gray(i / 5), bx + (i * R * 2) / 6, cy - R * 0.45, (R * 2) / 6, R * 0.3);
  // frequency gratings
  const fy = cy - R * 0.15, fh = R * 0.3, gw = (R * 2) / 5;
  [2, 3, 4, 6, 8].forEach((period, i) => pixels(ctx, bx + i * gw, fy, gw, fh, (x) => gray(Math.floor(x / (period / 2)) % 2)));
  // hue ramp and grey ramp
  hramp(ctx, bx, cy + R * 0.15, R * 2, R * 0.2, (f) => hsv(f));
  hramp(ctx, bx, cy + R * 0.35, R * 2, R * 0.2, (f) => gray(f));
  fill(ctx, [0, 0, 0], bx, cy + R * 0.55, R * 2, R * 0.45);
  ctx.restore();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, h / 360);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - R * 0.08, cy); ctx.lineTo(cx + R * 0.08, cy); ctx.moveTo(cx, cy - R * 0.08); ctx.lineTo(cx, cy + R * 0.08); ctx.stroke();
  void t;
  text(ctx, new Date().toLocaleTimeString('de-DE'), cx, cy + R * 0.72, R * 0.16, '#fff');
  arrows(ctx, w, h, '#fff');
}

export const PATTERNS: PatternDef[] = [
  // Vollfelder
  { id: 'red', name: 'Rot', group: 'Vollfeld', draw: (c, w, h) => fill(c, [255, 0, 0], 0, 0, w, h) },
  { id: 'green', name: 'Grün', group: 'Vollfeld', draw: (c, w, h) => fill(c, [0, 255, 0], 0, 0, w, h) },
  { id: 'blue', name: 'Blau', group: 'Vollfeld', draw: (c, w, h) => fill(c, [0, 0, 255], 0, 0, w, h) },
  { id: 'white', name: 'Weiß 100 %', group: 'Vollfeld', draw: (c, w, h) => fill(c, gray(1), 0, 0, w, h) },
  { id: 'gray50', name: 'Grau 50 %', group: 'Vollfeld', draw: (c, w, h) => fill(c, gray(0.5), 0, 0, w, h) },
  { id: 'gray18', name: 'Grau 18 % Reflexion (≈ 46 %)', group: 'Vollfeld', draw: (c, w, h) => fill(c, [118, 118, 118], 0, 0, w, h) },
  { id: 'black', name: 'Schwarz', group: 'Vollfeld', draw: (c, w, h) => fill(c, gray(0), 0, 0, w, h) },

  // Grau
  { id: 'ramp', name: 'Grauverlauf 0–100 %', group: 'Grau', draw: (c, w, h) => hramp(c, 0, 0, w, h, gray) },
  {
    id: 'rgbramp', name: 'Verläufe W R G B', group: 'Grau',
    draw: (c, w, h) => (['w', 'r', 'g', 'b'] as const).forEach((k, i) =>
      hramp(c, 0, (i * h) / 4, w, h / 4, (f) => (k === 'w' ? gray(f) : k === 'r' ? [lv(f), 0, 0] : k === 'g' ? [0, lv(f), 0] : [0, 0, lv(f)]))),
  },
  { id: 'steps11', name: 'Graustufen 11 (0–100 %)', group: 'Grau', draw: (c, w, h) => { for (let i = 0; i < 11; i++) fill(c, gray(i / 10), (i * w) / 11, 0, w / 11, h); } },
  {
    id: 'te165', name: 'Graukeil 11 Stufen, TE-165-Anordnung', group: 'Grau',
    draw: (c, w, h) => {
      fill(c, [118, 118, 118], 0, 0, w, h);
      const x0 = w * 0.0825, sw = (w * 0.835) / 11;
      for (let i = 0; i < 11; i++) {
        fill(c, gray(i / 10), x0 + i * sw, h * 0.153, sw, h * 0.27);
        fill(c, gray(1 - i / 10), x0 + i * sw, h * 0.577, sw, h * 0.27);
      }
      fill(c, gray(0), w * 0.359, h * 0.453, w * 0.087, h * 0.093);
      fill(c, gray(1), w * 0.446, h * 0.453, w * 0.108, h * 0.093);
      fill(c, gray(0), w * 0.554, h * 0.453, w * 0.087, h * 0.093);
      c.strokeStyle = '#000'; c.lineWidth = Math.max(1, h / 540); c.strokeRect(1, 1, w - 2, h - 2);
      arrows(c, w, h);
    },
  },
  {
    id: 'sweep', name: 'Grauverlauf wandernd', group: 'Grau', animated: true,
    draw: (c, w, h, t) => hramp(c, 0, 0, w, h, (f) => gray((f + t * 0.1) % 1)),
  },
  {
    id: 'pluge', name: 'PLUGE / Schwarzwert', group: 'Grau',
    draw: (c, w, h) => {
      fill(c, gray(0), 0, 0, w, h);
      [0.02, 0.04, 0.01, 0.03].forEach((p, i) => fill(c, gray(p), w * (0.2 + i * 0.15), h * 0.2, w * 0.1, h * 0.6));
      fill(c, gray(0.75), w * 0.44, h * 0.85, w * 0.12, h * 0.08);
      text(c, '+2 %', w * 0.25, h * 0.12, h * 0.035, '#555');
      text(c, '+4 %', w * 0.4, h * 0.12, h * 0.035, '#555');
      text(c, '+1 %', w * 0.55, h * 0.12, h * 0.035, '#555');
      text(c, '+3 %', w * 0.7, h * 0.12, h * 0.035, '#555');
    },
  },

  // Geometrie
  {
    id: 'checker', name: 'Schachbrett', group: 'Geometrie',
    draw: (c, w, h) => { const s = h / 9; for (let y = 0; y * s < h; y++) for (let x = 0; x * s < w; x++) fill(c, gray((x + y) % 2), x * s, y * s, s, s); },
  },
  {
    id: 'convergence', name: 'Konvergenzgitter', group: 'Geometrie',
    draw: (c, w, h) => {
      fill(c, gray(0), 0, 0, w, h);
      const n = 16, sx = w / n, sy = h / 9;
      c.fillStyle = '#fff';
      for (let i = 0; i <= n; i++) c.fillRect(Math.min(w - 1, Math.round(i * sx)), 0, 1, h);
      for (let j = 0; j <= 9; j++) c.fillRect(0, Math.min(h - 1, Math.round(j * sy)), w, 1);
      for (let i = 0; i < n; i++) for (let j = 0; j < 9; j++) c.fillRect(Math.round((i + 0.5) * sx), Math.round((j + 0.5) * sy), 1, 1);
    },
  },
  {
    id: 'crosshair', name: 'Fadenkreuz', group: 'Geometrie',
    draw: (c, w, h) => {
      fill(c, gray(0), 0, 0, w, h);
      c.fillStyle = '#fff';
      c.fillRect(Math.floor(w / 2), 0, 1, h); c.fillRect(0, Math.floor(h / 2), w, 1);
      c.strokeStyle = '#fff'; c.lineWidth = 1; c.strokeRect(0.5, 0.5, w - 1, h - 1);
      c.beginPath(); c.arc(w / 2, h / 2, h * 0.1, 0, Math.PI * 2); c.stroke();
    },
  },
  {
    id: 'circles', name: 'Kreisraster', group: 'Geometrie',
    draw: (c, w, h) => {
      fill(c, gray(0), 0, 0, w, h);
      const s = h / 8;
      c.strokeStyle = '#888'; c.lineWidth = 1; c.beginPath();
      for (let x = (w / 2) % s; x < w; x += s) { c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, h); }
      for (let y = (h / 2) % s; y < h; y += s) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5); }
      c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = Math.max(1, h / 540);
      c.beginPath(); c.arc(w / 2, h / 2, h / 2 - 2, 0, Math.PI * 2); c.stroke();
      for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { c.beginPath(); c.arc(fx * w + (fx ? -1 : 1) * h / 8, fy * h + (fy ? -1 : 1) * h / 8, h / 8 - 2, 0, Math.PI * 2); c.stroke(); }
    },
  },
  { id: 'zoneplate', name: 'Zonenplatte', group: 'Geometrie', draw: (c, w, h) => zonePlate(c, w, h, 0) },
  { id: 'zoneplate-anim', name: 'Zonenplatte bewegt', group: 'Geometrie', animated: true, draw: zonePlate },
  {
    id: 'safe', name: 'Sichere Bereiche (EBU R 95)', group: 'Geometrie',
    draw: (c, w, h) => {
      fill(c, gray(0.2), 0, 0, w, h);
      const box = (f: number, color: string, label: string) => {
        const bw = w * f, bh = h * f;
        c.strokeStyle = color; c.lineWidth = Math.max(1, h / 540);
        c.strokeRect((w - bw) / 2, (h - bh) / 2, bw, bh);
        text(c, label, w / 2, (h - bh) / 2 + h * 0.025, h * 0.022, color);
      };
      box(1, '#fff', '');
      box(0.93, '#ffd400', 'Action safe 93 %');
      box(0.9, '#00dcff', 'Graphics safe 90 %');
      c.strokeStyle = '#ff4d4d'; c.setLineDash([8, 6]);
      const w43 = (h * 4) / 3; c.strokeRect((w - w43) / 2, 0, w43, h); c.setLineDash([]);
      text(c, '4:3', (w - w43) / 2 + h * 0.04, h / 2, h * 0.025, '#ff4d4d');
      c.fillStyle = '#fff'; c.fillRect(Math.floor(w / 2) - h * 0.02, Math.floor(h / 2), h * 0.04, 1); c.fillRect(Math.floor(w / 2), Math.floor(h / 2) - h * 0.02, 1, h * 0.04);
    },
  },

  // Farbe
  { id: 'smpte75', name: 'SMPTE 75 % Balken + PLUGE', group: 'Farbe', draw: (c, w, h) => smpteBars(c, w, h, 0.75) },
  { id: 'smpte100', name: 'SMPTE 100 % Balken + PLUGE', group: 'Farbe', draw: (c, w, h) => smpteBars(c, w, h, 1) },
  {
    id: 'ebu75', name: 'EBU-Balken 100/0/75/0', group: 'Farbe',
    draw: (c, w, h) => [gray(1), ...BARS(0.75).slice(1), [0, 0, 0] as RGB].forEach((col, i) => fill(c, col, (i * w) / 8, 0, w / 8, h)),
  },
  {
    id: 'ebu100', name: 'EBU-Balken 100/0/100/0', group: 'Farbe',
    draw: (c, w, h) => [...BARS(1), [0, 0, 0] as RGB].forEach((col, i) => fill(c, col, (i * w) / 8, 0, w / 8, h)),
  },
  {
    id: 'gradbars', name: 'Sättigungsverläufe', group: 'Farbe',
    draw: (c, w, h) => {
      const cols: RGB[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 1, 1], [1, 0, 1], [1, 1, 0], [1, 1, 1]].map((v) => v as RGB);
      cols.forEach((col, i) => hramp(c, 0, (i * h) / 7, w, h / 7, (f) => col.map((v) => lv(v * f)) as RGB));
    },
  },
  { id: 'hue', name: 'Farbkreis-Verlauf', group: 'Farbe', draw: (c, w, h) => hramp(c, 0, 0, w, h, (f) => hsv(f)) },
  {
    id: 'macbeth', name: 'ColorChecker (Näherung)', group: 'Farbe',
    draw: (c, w, h) => {
      fill(c, gray(0.1), 0, 0, w, h);
      const pw = w / 6.6, ph = h / 4.4, g = pw * 0.1;
      MACBETH.forEach((col, i) => fill(c, col, g + (i % 6) * (pw + g * 0.6) + pw * 0.05, g + Math.floor(i / 6) * (ph + g * 0.4), pw, ph));
    },
  },

  // Animiert
  { id: 'cycle', name: 'Farbwechsel', group: 'Animiert', animated: true, draw: (c, w, h, t) => fill(c, hsv(t * 0.1), 0, 0, w, h) },
  { id: 'cyclegrad', name: 'Farbwechsel-Verlauf', group: 'Animiert', animated: true, draw: (c, w, h, t) => hramp(c, 0, 0, w, h, (f) => hsv(f + t * 0.1)) },
  {
    id: 'tribar', name: 'Farbwechsel dreigeteilt', group: 'Animiert', animated: true,
    draw: (c, w, h, t) => [0, 1, 2].forEach((i) => fill(c, hsv(t * 0.1 + i / 3), (i * w) / 3, 0, w / 3, h)),
  },
  {
    id: 'diagonal', name: 'Bewegte Diagonalen', group: 'Animiert', animated: true,
    draw: (c, w, h, t) => { const p = h / 8, o = (t * p) % (2 * p); pixels(c, 0, 0, w, h, (x, y) => gray(Math.floor((x + y + o) / p) % 2)); },
  },
  {
    id: 'rainbow', name: 'Regenbogenfluss', group: 'Animiert', animated: true,
    draw: (c, w, h, t) => pixels(c, 0, 0, w, h, (x, y) => hsv((x + y) / (w + h) * 2 - t * 0.2)),
  },
  {
    id: 'chromacrawl', name: 'Chroma-Crawl', group: 'Animiert', animated: true,
    draw: (c, w, h, t) => { const ph = Math.floor(t * 25) % 2; pixels(c, 0, 0, w, h, (x, y) => ((x + y + ph) % 2 ? [255, 0, 255] : [0, 255, 0])); },
  },

  // Testbild
  { id: 'testcard', name: 'Testbild mit Kreis und Uhr', group: 'Testbild', animated: true, draw: testCard },

  // HDR
  {
    id: 'pq-steps', name: 'PQ-Graukeil 0–10 000 cd/m²', group: 'HDR', transfer: 'pq',
    draw: (c, w, h) => {
      const nits = [0, 0.1, 1, 10, 50, 100, 203, 400, 1000, 2000, 4000, 10000];
      nits.forEach((n, i) => {
        const x = (i * w) / nits.length, bw = w / nits.length;
        fill(c, gray(pqEncode(n)), x, 0, bw, h * 0.85);
        text(c, n >= 1000 ? `${n / 1000}k` : String(n), x + bw / 2, h * 0.92, h * 0.035, '#bbb');
      });
    },
  },
  {
    id: 'hlg-steps', name: 'HLG-Graukeil (1000-cd/m²-Display)', group: 'HDR', transfer: 'hlg',
    draw: (c, w, h) => {
      const nits = [0, 1, 10, 50, 100, 203, 400, 600, 1000];
      nits.forEach((n, i) => {
        const x = (i * w) / nits.length, bw = w / nits.length;
        fill(c, gray(hlgFromNits(n)), x, 0, bw, h * 0.85);
        text(c, String(n), x + bw / 2, h * 0.92, h * 0.035, '#bbb');
      });
    },
  },
  {
    id: 'pq-ramp', name: 'PQ-Verlauf mit Referenzweiß 203', group: 'HDR', transfer: 'pq',
    draw: (c, w, h) => {
      hramp(c, 0, 0, w, h * 0.7, gray);
      fill(c, gray(pqEncode(203)), 0, h * 0.7, w, h * 0.3);
      text(c, '203 cd/m² (BT.2408 Referenzweiß)', w / 2, h * 0.85, h * 0.04, '#222');
    },
  },
];

// LZ display test set (Lars Zumpe Medienproduktion, bundled 1920×1080)
const LZ = [
  ['01', 'schwarzwert-pluge', 'Schwarzwert & PLUGE'], ['02', 'weissclipping', 'Weißclipping'], ['03', 'gamma', 'Gamma'],
  ['04', 'ansi-kontrast', 'ANSI-Kontrast'], ['05', 'ausleuchtung', 'Ausleuchtung'], ['06', 'schwarzbild', 'Schwarzbild'],
  ['07', 'geometrie', 'Geometrie'], ['08', 'overscan', 'Overscan'], ['09', 'schaerfe-1zu1', 'Schärfe & 1:1'],
  ['10', 'konvergenz', 'Konvergenz'], ['11', 'farbbalken', 'Farbbalken'], ['12', 'verlaeufe', 'Verläufe'],
  ['13', 'messfelder', 'Messfelder'], ['14', 'text-schaerfung', 'Text & Schärfung'], ['15', 'vollfeld-weiss', 'Vollfeld Weiß'],
  ['16', 'vollfeld-grau50', 'Vollfeld Grau 50'], ['17', 'vollfeld-grau25', 'Vollfeld Grau 25'], ['18', 'vollfeld-rot', 'Vollfeld Rot'],
  ['19', 'vollfeld-gruen', 'Vollfeld Grün'], ['20', 'vollfeld-blau', 'Vollfeld Blau'],
] as const;
for (const [n, slug, name] of LZ) {
  PATTERNS.push({ id: `lz-${n}`, name: `${n} ${name}`, group: 'LZ Displaytest', src: `patterns/lz-display/lz_${n}_${slug}_1920x1080.png` });
}

export const RESOLUTIONS: [number, number][] = [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160], [1920, 1200], [1024, 768]];

export function patternById(id: string) {
  return PATTERNS.find((p) => p.id === id) ?? PATTERNS.find((p) => p.id === 'smpte75')!;
}

/** Register user images for this session as extra patterns. */
export function addImagePatterns(files: File[]): PatternDef[] {
  const added = files.filter((f) => f.type.startsWith('image/')).map((f, i) => ({
    id: `user-${Date.now()}-${i}`, name: f.name, group: 'Eigene Bilder', src: URL.createObjectURL(f),
  }));
  PATTERNS.push(...added);
  return added;
}

const imageCache = new Map<string, Promise<HTMLImageElement>>();
function loadImage(src: string) {
  let p = imageCache.get(src);
  if (!p) {
    p = new Promise((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = () => fail(new Error(`Bild nicht ladbar: ${src}`)); img.src = src; });
    imageCache.set(src, p);
  }
  return p;
}

/** Render a pattern at w×h. Image patterns are fitted (1:1 when sizes match). */
export async function renderPattern(ctx: CanvasRenderingContext2D, def: PatternDef, w: number, h: number, t: number, label = '') {
  ctx.imageSmoothingEnabled = true;
  if (def.src) {
    const img = await loadImage(def.src);
    fill(ctx, [0, 0, 0], 0, 0, w, h);
    const s = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
    ctx.imageSmoothingEnabled = s !== 1;
    ctx.drawImage(img, Math.round((w - dw) / 2), Math.round((h - dh) / 2), Math.round(dw), Math.round(dh));
  } else {
    def.draw?.(ctx, w, h, t);
  }
  if (label) {
    const size = h * 0.045;
    ctx.font = `600 ${Math.round(size)}px system-ui, sans-serif`;
    const tw = ctx.measureText(label).width + size;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect((w - tw) / 2, h * 0.88 - size * 0.8, tw, size * 1.6);
    text(ctx, label, w / 2, h * 0.88, size, '#fff');
  }
}
