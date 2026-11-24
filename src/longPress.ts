// Long press on a scope panel (#185): one finger (or pen) held still opens the panel's ⚙ settings,
// the touch counterpart of the right click. Conflicts with the other gestures (src/gestures.ts):
//   - a second finger (pinch) or moving more than LONG_PX cancels it, so pan and zoom win
//   - pointers the gestures module owns are swallowed on the body; this listens one level up
//     (capture on the panel), so it still sees them lift
//   - Touch Shading owning the scope blocks it, as it blocks the gestures
//   - the browser's own touch long press (contextmenu) counts as the same long press and does
//     not reach the body, where a right click clears probe and ROI
// The menu opens when the finger lifts: an auto popover opened while the finger is still down
// would be light-dismissed by that very pointerup (the touch pointer stays captured by the body,
// outside the popover). iOS context menus open on hold, Android on hold as well; opening on
// release is the price for one popover implementation.

/** Hold time and movement tolerance; 500 ms is the Android long-press default (ViewConfiguration). */
export const LONG_MS = 500, LONG_PX = 10;

export interface LongPress {
  down(id: number, x: number, y: number): void;
  move(id: number, x: number, y: number): void;
  /** the pointer lifted; true when it was a long press */
  up(id: number): boolean;
  /** the press became long already (timer or contextmenu) */
  readonly armed: boolean;
  /** a pointer is down */
  readonly active: boolean;
  /** mark the running press as long (browser contextmenu on touch) */
  arm(): void;
  cancel(): void;
}

/** The timing core, without DOM (tests: test/longPress.test.ts). `onArm` runs when the hold time is reached. */
export function longPress(onArm: () => void = () => {}, ms = LONG_MS, slop = LONG_PX): LongPress {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let start: { id: number; x: number; y: number } | null = null;
  let armed = false;
  const down = new Set<number>();
  const stop = () => { if (timer) clearTimeout(timer); timer = null; };
  const api: LongPress = {
    down(id, x, y) {
      down.add(id);
      if (down.size > 1) { api.cancel(); return; }
      armed = false; start = { id, x, y };
      stop();
      timer = setTimeout(() => { timer = null; api.arm(); }, ms);
    },
    move(id, x, y) {
      if (start && start.id === id && !armed && Math.hypot(x - start.x, y - start.y) > slop) api.cancel();
    },
    up(id) {
      down.delete(id);
      const was = !!start && start.id === id && armed;
      if (start?.id === id) { stop(); start = null; armed = false; }
      return was;
    },
    get armed() { return armed; },
    get active() { return down.size > 0; },
    arm() { if (!start || armed) return; stop(); armed = true; onArm(); },
    cancel() { stop(); start = null; armed = false; },
  };
  return api;
}

/**
 * Wire a long press to a panel: presses that start inside `body` (not on its chips and buttons)
 * open `open()` once the finger lifts. `blocked` = someone else owns the pointer (Touch Shading).
 */
export function attachLongPress(panel: HTMLElement, body: HTMLElement, open: () => void, blocked: () => boolean = () => false) {
  const lp = longPress(() => {
    // a drag the finger started (probe, ROI, luma lines) is undone, as with a pinch
    body.dispatchEvent(new Event('lzs-gesture-cancel'));
    try { navigator.vibrate?.(10); } catch { /* not allowed */ }
  });
  let swallowClick = false;
  const inBody = (e: Event) => {
    const t = e.target as HTMLElement | null;
    return !!t && body.contains(t) && !t.closest?.('button, select, input, .zoomchip, .ask');
  };
  const touchish = (e: PointerEvent) => e.pointerType === 'touch' || e.pointerType === 'pen';
  panel.addEventListener('pointerdown', (e) => {
    swallowClick = false;
    if (!touchish(e) || !inBody(e) || blocked()) return;
    lp.down(e.pointerId, e.clientX, e.clientY);
  }, { capture: true });
  panel.addEventListener('pointermove', (e) => { if (touchish(e)) lp.move(e.pointerId, e.clientX, e.clientY); }, { capture: true });
  panel.addEventListener('pointerup', (e) => {
    if (!touchish(e) || !lp.up(e.pointerId)) return;
    swallowClick = true;
    setTimeout(open, 0);
  }, { capture: true });
  panel.addEventListener('pointercancel', (e) => { if (touchish(e)) { lp.up(e.pointerId); lp.cancel(); } }, { capture: true });
  // the browser's touch long press: same thing, and the body's right-click handler stays out
  panel.addEventListener('contextmenu', (e) => {
    if (!lp.active) return;
    e.preventDefault(); e.stopPropagation();
    lp.arm();
  }, { capture: true });
  panel.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault(); e.stopPropagation();
  }, { capture: true });
}
