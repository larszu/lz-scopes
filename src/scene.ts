// Overlay scenes: several scopes placed freely over the picture of an output window
// (?view=overlay). Positions are fractions of the picture area, so a scene looks the
// same in every window size and in the stream. Pure functions – no DOM.

import type { ScopeType } from './graticule';
import { OVERLAY_SCOPES } from '../server/control.mjs';

export interface OverlayElement {
  id: string;
  scope: ScopeType;
  /** left, top, width, height as fractions of the picture (0…1) */
  x: number; y: number; w: number; h: number;
  /** trace opacity 0…1 */
  opacity: number;
  /** darkening of the picture behind the scope 0…1 (only with picture background) */
  dim: number;
  /** source id; '' = the output window's source */
  src: string;
}

export interface OverlayScene { id: string; name: string; elements: OverlayElement[] }

export type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

export const MIN_SIZE = 0.04;
export const MAX_ELEMENTS = 16;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10000) / 10000;
export const newId = () => Math.random().toString(36).slice(2, 10);

export const isOverlayScope = (s: unknown): s is ScopeType => typeof s === 'string' && OVERLAY_SCOPES.includes(s);

/** Default place for a scope: waveforms in the lower third, round scopes in a corner. */
export function newElement(scope: ScopeType, taken = 0): OverlayElement {
  const isRound = scope === 'vector' || scope === 'cie';
  const off = (taken % 4) * 0.04;
  const base = isRound
    ? { x: 0.72 - off, y: 0.52 - off, w: 0.25, h: 0.44 }
    : { x: 0.03 + off, y: 0.6 - off, w: 0.62, h: 0.36 };
  return { id: newId(), scope, ...base, opacity: 1, dim: 0.55, src: '' };
}

/** The scene that replaces the fixed overlay of earlier versions. */
export function defaultScene(name = 'Waveform unten'): OverlayScene {
  return { id: newId(), name, elements: [newElement('wf-luma')] };
}

/** Clamp an element into the picture with a minimum size. */
export function clampElement(e: OverlayElement): OverlayElement {
  const w = clamp(e.w, MIN_SIZE, 1), h = clamp(e.h, MIN_SIZE, 1);
  return { ...e, w: round(w), h: round(h), x: round(clamp(e.x, 0, 1 - w)), y: round(clamp(e.y, 0, 1 - h)), opacity: round(clamp(e.opacity, 0, 1)), dim: round(clamp(e.dim, 0, 1)) };
}

const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Validate an element from storage, a file or the API; null if unusable. */
export function sanitizeElement(raw: unknown): OverlayElement | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!isOverlayScope(r.scope)) return null;
  const d = newElement(r.scope);
  return clampElement({
    id: str(r.id, 20) || d.id, scope: r.scope,
    x: num(r.x, d.x), y: num(r.y, d.y), w: num(r.w, d.w), h: num(r.h, d.h),
    opacity: num(r.opacity, 1), dim: num(r.dim, d.dim), src: str(r.src, 40),
  });
}

export function sanitizeScene(raw: unknown): OverlayScene | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, 60).trim();
  if (!name || !Array.isArray(r.elements)) return null;
  return {
    id: str(r.id, 20) || newId(), name,
    elements: r.elements.map(sanitizeElement).filter((e): e is OverlayElement => !!e).slice(0, MAX_ELEMENTS),
  };
}

/** Scenes from storage or a layout configuration; ids made unique, never empty. */
export function sanitizeScenes(raw: unknown): OverlayScene[] {
  const list = Array.isArray(raw) ? raw.map(sanitizeScene).filter((s): s is OverlayScene => !!s) : [];
  const seen = new Set<string>();
  for (const s of list) { while (seen.has(s.id)) s.id = newId(); seen.add(s.id); }
  return list.length ? list : [defaultScene()];
}

export const serializeScenes = (scenes: OverlayScene[]) => JSON.stringify(scenes);
export const parseScenes = (json: string) => { try { return sanitizeScenes(JSON.parse(json)); } catch { return sanitizeScenes(null); } };

/** Scene by id, then by name (case-insensitive), then by 1-based number. */
export function findScene(scenes: OverlayScene[], ref: string | number): OverlayScene | null {
  if (typeof ref === 'number') return scenes[ref - 1] ?? null;
  const low = ref.toLowerCase();
  return scenes.find((s) => s.id === ref) ?? scenes.find((s) => s.name.toLowerCase() === low) ?? null;
}

/**
 * Which element and handle is under a point (fractions of the picture)?
 * tol = handle size in fractions [x, y]. Topmost (last drawn) element wins.
 */
export function hitTest(elements: OverlayElement[], px: number, py: number, tol: [number, number]): { index: number; handle: Handle } | null {
  const [tx, ty] = tol;
  for (let i = elements.length - 1; i >= 0; i--) {
    const e = elements[i];
    if (px < e.x - tx || px > e.x + e.w + tx || py < e.y - ty || py > e.y + e.h + ty) continue;
    const n = Math.abs(py - e.y) <= ty, s = Math.abs(py - (e.y + e.h)) <= ty;
    const w = Math.abs(px - e.x) <= tx, ea = Math.abs(px - (e.x + e.w)) <= tx;
    const v = n ? 'n' : s ? 's' : '', hz = w ? 'w' : ea ? 'e' : '';
    if (v || hz) return { index: i, handle: (v + hz) as Handle };
    if (px >= e.x && px <= e.x + e.w && py >= e.y && py <= e.y + e.h) return { index: i, handle: 'move' };
  }
  return null;
}

/** Element after dragging a handle by (dx, dy) fractions, starting from `start`. */
export function dragElement(start: OverlayElement, handle: Handle, dx: number, dy: number): OverlayElement {
  if (handle === 'move') {
    return clampElement({ ...start, x: clamp(start.x + dx, 0, 1 - start.w), y: clamp(start.y + dy, 0, 1 - start.h) });
  }
  let { x, y, w, h } = start;
  const right = x + w, bottom = y + h;
  if (handle.includes('w')) { x = clamp(x + dx, 0, right - MIN_SIZE); w = right - x; }
  if (handle.includes('e')) w = clamp(w + dx, MIN_SIZE, 1 - x);
  if (handle.includes('n')) { y = clamp(y + dy, 0, bottom - MIN_SIZE); h = bottom - y; }
  if (handle.includes('s')) h = clamp(h + dy, MIN_SIZE, 1 - y);
  return clampElement({ ...start, x, y, w, h });
}

export const CURSORS: Record<Handle, string> = {
  move: 'move', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize',
};
