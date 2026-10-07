// Gestures on a scope panel (#89): zoom and pan with mouse, trackpad and touch, in one place
// for every scope. The transform itself is view.ts; research in docs/research/gestures.md.
//
//   mouse      wheel = zoom around the cursor · drag with the middle button or Shift+drag = pan
//              · double click = reset. (Not Space+drag as in OmniScope: Space is freeze/play here.)
//   trackpad   pinch (Chromium/Firefox: ctrl+wheel; Safari: gesturechange) = zoom around the
//              cursor · two-finger scroll = pan
//   touch      two-finger pinch = zoom around the fingers, moving them = pan · double tap = reset
//              · one finger pans a zoomed scope that has no other use for a drag
//
// Conflicts are settled here and nowhere else: while Touch Shading owns a scope (shading/ui.ts,
// capture listener registered first) pointer gestures go to the camera; a scope's own primary
// drag (picture: probe/ROI, skin/green waveform: luma lines, 3D volume: rotate) keeps the left
// button and the single finger; the skin/green wheel stays the hue tolerance. A pinch that starts
// while one finger already began such a drag cancels it ('lzs-gesture-cancel' on the body).

import type { Rect } from './renderer';
import { classifyWheel, isIdentity, panBy, pinchOf, wheelFactor, zoomAt, type View, type ViewLimits } from './view';

export interface GestureHost {
  /** zoom range of the panel's current scope; null = no zoom (audio, clock …) */
  limits(): ViewLimits | null;
  view(): View;
  /** plot area (without zoom) in body coordinates */
  frame(): Rect;
  /** set while gesturing (redraw only); commit() saves once the gesture ends */
  set(v: View): void;
  commit(): void;
  /** pointer gestures belong to someone else (Touch Shading active on this scope) */
  blocked(): boolean;
  /** the left button / single finger has another job on this scope */
  primaryTaken(): boolean;
  /** a one-pointer drag rotates (3D volume) */
  rotates?(): boolean;
  /** dx, dy in px */
  rotate?(dx: number, dy: number): void;
  /** the plain mouse wheel has another job on this scope (skin/green tolerance) */
  wheelTaken?(): boolean;
  /** mouse wheel zooms around the plot centre instead of the cursor (vectorscope) */
  wheelAtCentre?(): boolean;
}

type Mode = 'pan' | 'rotate' | 'pinch';

/** The zoom chip inside the body is a button of its own: no gesture, no probe, no shading. */
export const onChip = (e: Event) => !!(e.target as HTMLElement | null)?.closest?.('.zoomchip');

/** Double tap: two taps within 300 ms and 30 px. */
const TAP_MS = 300, TAP_PX = 30;

/**
 * Wire the gestures to a panel body. `onReset` runs on a double tap (double click is the
 * caller's, which also decides between reset and solo).
 */
export function attachGestures(body: HTMLElement, h: GestureHost, onDoubleTap: () => void) {
  body.style.touchAction = 'none';
  const pts = new Map<number, { x: number; y: number; type: string }>();
  /** pointers whose events this module owns until they are lifted */
  const owned = new Set<number>();
  let mode: Mode | null = null;
  let last: { x: number; y: number } | null = null;
  let pinch: { cx: number; cy: number; d: number } | null = null;
  let tap: { t: number; x: number; y: number; moved: boolean } | null = null;
  let lastTap: { t: number; x: number; y: number } | null = null;

  const local = (e: { clientX: number; clientY: number }) => {
    const b = body.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  const swallow = (e: Event) => { e.stopImmediatePropagation(); e.preventDefault(); };
  const capture = (id: number) => { try { body.setPointerCapture(id); } catch { /* synthetic events */ } };
  const touches = () => [...pts.values()].filter((p) => p.type === 'touch');

  body.addEventListener('pointerdown', (e) => {
    const lim = h.limits();
    if (!lim || h.blocked() || onChip(e)) return;
    const at = local(e);
    pts.set(e.pointerId, { ...at, type: e.pointerType });
    if (e.pointerType === 'touch') {
      tap = pts.size === 1 ? { t: e.timeStamp, ...at, moved: false } : null;
      const ts = touches();
      if (ts.length === 2) {
        // second finger: pinch; whatever the first finger started is cancelled
        body.dispatchEvent(new Event('lzs-gesture-cancel'));
        mode = 'pinch'; pinch = pinchOf(ts[0], ts[1]); last = null;
        for (const id of pts.keys()) { owned.add(id); capture(id); }
        swallow(e);
        return;
      }
      if (ts.length > 2) { owned.add(e.pointerId); swallow(e); return; }
    }
    if (mode) { owned.add(e.pointerId); swallow(e); return; }
    const panKey = e.button === 1 || (e.button === 0 && e.shiftKey);
    const single = e.button === 0 && !panKey;
    if (panKey) mode = 'pan';
    else if (single && h.rotate && h.rotates?.()) mode = 'rotate';
    else if (single && !h.primaryTaken() && !isIdentity(h.view())) mode = 'pan';
    else return; // left to the scope's own handlers (probe, ROI, skin lines …)
    last = at;
    owned.add(e.pointerId);
    capture(e.pointerId);
    swallow(e);
  }, { capture: true });

  body.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const at = local(e);
    p.x = at.x; p.y = at.y;
    if (tap && Math.hypot(at.x - tap.x, at.y - tap.y) > 10) tap.moved = true;
    if (!owned.has(e.pointerId)) return;
    e.stopImmediatePropagation();
    const lim = h.limits();
    if (!lim) return;
    if (mode === 'pinch') {
      const ts = touches();
      if (ts.length < 2 || !pinch) return;
      const now = pinchOf(ts[0], ts[1]);
      let v = zoomAt(h.view(), h.frame(), pinch.cx, pinch.cy, pinch.d > 0 ? now.d / pinch.d : 1, lim);
      v = panBy(v, h.frame(), now.cx - pinch.cx, now.cy - pinch.cy, lim);
      pinch = now;
      h.set(v);
    } else if (last && (mode === 'pan' || mode === 'rotate')) {
      const dx = at.x - last.x, dy = at.y - last.y;
      last = at;
      if (mode === 'rotate') h.rotate!(dx, dy);
      else h.set(panBy(h.view(), h.frame(), dx, dy, lim));
    }
  }, { capture: true });

  const end = (e: PointerEvent) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    pts.delete(e.pointerId);
    // double tap (touch only; the mouse has dblclick)
    if (e.type === 'pointerup' && e.pointerType === 'touch' && tap && !tap.moved && pts.size === 0 && e.timeStamp - tap.t < TAP_MS) {
      if (lastTap && e.timeStamp - lastTap.t < TAP_MS + 150 && Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) < TAP_PX) {
        lastTap = null;
        onDoubleTap();
      } else lastTap = { t: e.timeStamp, x: tap.x, y: tap.y };
    }
    if (!owned.has(e.pointerId)) { if (!pts.size) tap = null; return; }
    owned.delete(e.pointerId);
    e.stopImmediatePropagation();
    if (!owned.size) {
      const was = mode;
      mode = null; last = null; pinch = null;
      if (was) h.commit();
    }
    if (!pts.size) tap = null;
  };
  body.addEventListener('pointerup', end, { capture: true });
  body.addEventListener('pointercancel', end, { capture: true });

  body.addEventListener('wheel', (e) => {
    const lim = h.limits();
    if (!lim) return;
    const kind = classifyWheel(e as WheelEvent & { wheelDeltaY?: number });
    if (kind === 'wheel' && h.wheelTaken?.()) return;
    e.preventDefault(); // also keeps Chromium from zooming the whole page on a pinch
    const f = h.frame(), at = local(e);
    if (kind === 'pan') {
      h.set(panBy(h.view(), f, -e.deltaX, -e.deltaY, lim));
    } else {
      const c = kind === 'wheel' && h.wheelAtCentre?.() ? { x: f.x + f.w / 2, y: f.y + f.h / 2 } : at;
      h.set(zoomAt(h.view(), f, c.x, c.y, wheelFactor(e.deltaY, e.deltaMode, kind === 'pinch'), lim));
    }
    clearTimeout(wheelCommit);
    wheelCommit = window.setTimeout(() => h.commit(), 250);
  }, { passive: false });
  let wheelCommit = 0;

  // Safari (macOS trackpad): pinch arrives as gesturestart/-change with a running scale.
  // On iOS the same events accompany the touch pointers, which already handle the pinch.
  let gs = 1;
  type GestureEv = Event & { scale: number; clientX: number; clientY: number };
  body.addEventListener('gesturestart', (e) => { if (!h.limits() || touches().length) return; e.preventDefault(); gs = 1; });
  body.addEventListener('gesturechange', (e) => {
    const lim = h.limits();
    if (!lim || touches().length) return;
    e.preventDefault();
    const g = e as GestureEv, at = local(g);
    const f = g.scale / gs; gs = g.scale;
    if (Number.isFinite(f) && f > 0) h.set(zoomAt(h.view(), h.frame(), at.x, at.y, f, lim));
  });
  body.addEventListener('gestureend', (e) => { if (!h.limits() || touches().length) return; e.preventDefault(); h.commit(); });
}
