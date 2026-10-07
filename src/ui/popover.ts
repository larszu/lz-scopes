// Popover (docs/architecture/ui.md): one implementation for the panel ⚙ menus, the header
// overflow menu and other small option panels. Native `popover="auto"` puts the panel in the
// top layer (no clipping by the dock), closes it on Esc and outside clicks and keeps only one
// open. Here: positioning next to the trigger, clamped to the viewport, and a bottom sheet on
// narrow screens (CSS: .popover.sheet).

import { h, type Kid } from './dom';

/** Narrow screens and phones get bottom sheets instead of anchored popovers. */
export const SHEET_QUERY = '(max-width: 640px), (pointer: coarse) and (max-height: 500px)';
export const isSheet = () => typeof matchMedia === 'function' && matchMedia(SHEET_QUERY).matches;

export interface PopoverOpts {
  /** trigger content (glyph or text) */
  label: Kid;
  /** accessible name and tooltip of the trigger */
  title: string;
  /** heading inside the panel */
  heading?: Kid;
  /** rows, built each time the popover opens */
  content: () => Kid[];
  align?: 'start' | 'end';
  cls?: string;
  /** trigger class (default: icon button) */
  triggerCls?: string;
}

export interface PopoverEl extends HTMLElement {
  open(): void;
  close(): void;
  /** rebuild the rows of an open popover (state changed, rows appear or disappear) */
  refresh(): void;
  readonly isOpen: boolean;
  readonly panel: HTMLElement;
}

let seq = 0;

/** Place `panel` next to `anchor`, inside the viewport (8 px margin). */
export function placePopover(panel: HTMLElement, anchor: DOMRect, align: 'start' | 'end' = 'start') {
  if (isSheet()) { panel.classList.add('sheet'); panel.style.cssText = ''; return; }
  panel.classList.remove('sheet');
  const vw = innerWidth, vh = innerHeight, m = 8;
  const below = vh - anchor.bottom - m, above = anchor.top - m;
  const up = below < 220 && above > below;
  const s = panel.style;
  s.position = 'fixed'; s.margin = '0';
  s.maxHeight = `${Math.max(120, (up ? above : below) - 4)}px`;
  s.maxWidth = `${vw - 2 * m}px`;
  if (up) { s.top = 'auto'; s.bottom = `${vh - anchor.top + 4}px`; } else { s.bottom = 'auto'; s.top = `${anchor.bottom + 4}px`; }
  // horizontal: after layout we know the width; keep it inside the viewport
  const w = Math.min(panel.offsetWidth || 320, vw - 2 * m);
  const left = align === 'end' ? anchor.right - w : anchor.left;
  s.left = `${Math.round(Math.max(m, Math.min(vw - m - w, left)))}px`;
  s.right = 'auto';
}

/** Trigger button + popover panel. */
export function popover(o: PopoverOpts): PopoverEl {
  const id = `pop-${++seq}`;
  const panel = h('div', { class: ['popover', o.cls], id, popover: 'auto', role: 'dialog', 'aria-label': o.title });
  const trigger = h('button', { type: 'button', class: o.triggerCls ?? 'icon pop-trigger', title: o.title, 'aria-label': o.title, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', popovertarget: id }, o.label);
  const render = () => panel.replaceChildren(...(o.heading ? [h('div', { class: 'popover-head' }, o.heading)] : []), h('div', { class: 'popover-body' }, ...o.content().flat()));
  panel.addEventListener('beforetoggle', (e) => {
    if ((e as ToggleEvent).newState === 'open') { render(); trigger.setAttribute('aria-expanded', 'true'); } else trigger.setAttribute('aria-expanded', 'false');
  });
  panel.addEventListener('toggle', (e) => { if ((e as ToggleEvent).newState === 'open') placePopover(panel, trigger.getBoundingClientRect(), o.align); });
  // typing in the panel must not reach the global shortcuts (S, F, 1–6, Esc …)
  panel.addEventListener('keydown', (e) => e.stopPropagation());
  const wrap = h('span', { class: 'pop' }, trigger, panel) as unknown as PopoverEl;
  Object.defineProperties(wrap, {
    open: { value: () => { if (!panel.matches(':popover-open')) panel.showPopover(); } },
    close: { value: () => { if (panel.matches(':popover-open')) panel.hidePopover(); } },
    refresh: { value: () => { if (panel.matches(':popover-open')) { render(); placePopover(panel, trigger.getBoundingClientRect(), o.align); } } },
    isOpen: { get: () => panel.matches(':popover-open') },
    panel: { value: panel },
  });
  return wrap;
}
