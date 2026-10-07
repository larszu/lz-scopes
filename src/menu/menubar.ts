// In-page menu bar for the browser build (the desktop app uses the native menu instead).
// WAI-ARIA menubar pattern: Alt+F10 or click opens, arrow keys move, Enter runs, Esc closes
// one level. Below 900 px the bar collapses behind a ☰ button at the same position.
//
// Opening and closing follow the same rules as every other overlay (src/ui/popover.ts):
// native `popover="auto"` in the top layer, so the browser closes on Esc and on a click
// outside and keeps only one open at a time, also against the ⚙ popovers. `place()` anchors
// with flip and viewport clamp; long menus scroll inside.
//   wide:   every menu and submenu is a popover (submenus nested in their menu)
//   narrow: the ☰ panel is the popover; menus and submenus expand inside it (accordion),
//           because beside a 320 px panel there is no room on a phone

import { formatAccel, forPage, isMac, type MenuItem, type TopMenu } from './model';
import { h } from '../ui';
import { place } from '../ui/popover';
import { t } from '../i18n';

type Run = (id: string) => void;

const BURGER_QUERY = '(max-width: 900px)';
const popOpen = (el: Element | null | undefined) => !!el?.matches(':popover-open');

export class MenuBar {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private burger: HTMLButtonElement;
  private raw: TopMenu[] = [];
  private menus: TopMenu[] = [];
  private mac = isMac();
  private mq = typeof matchMedia === 'function' ? matchMedia(BURGER_QUERY) : null;
  private narrow = !!this.mq?.matches;

  constructor(private run: Run) {
    this.burger = h('button', { type: 'button', class: 'icon mb-burger', title: t('menu.burger'), 'aria-label': t('menu.burger'), 'aria-expanded': false }, '☰');
    this.bar = h('div', { class: 'mb-items', role: 'menubar', 'aria-label': t('menu.main') });
    this.el = h('nav', { class: 'menubar', id: 'menubar' }, this.burger, this.bar);
    this.bar.addEventListener('beforetoggle', (e) => {
      if (e.target !== this.bar) return;
      const on = (e as ToggleEvent).newState === 'open';
      this.burger.setAttribute('aria-expanded', String(on));
      if (!on) this.bar.querySelectorAll('.mb-drop.open').forEach((d) => this.hide(d as HTMLElement));
    });
    this.bar.addEventListener('toggle', (e) => { if (e.target === this.bar && popOpen(this.bar)) place(this.bar, this.burger.getBoundingClientRect(), { sheet: false }); });
    this.mode();
    this.mq?.addEventListener('change', () => { this.narrow = !!this.mq?.matches; this.mode(); this.set(this.raw); });
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'F10') { e.preventDefault(); this.open(0, true); }
    });
    this.bar.addEventListener('keydown', (e) => this.onKey(e));
  }

  /** narrow windows: the bar itself is the ☰ popover */
  private mode() {
    if (popOpen(this.bar)) this.bar.hidePopover();
    if (this.narrow) { this.bar.popover = 'auto'; this.burger.popoverTargetElement = this.bar; } else { this.bar.removeAttribute('popover'); this.burger.popoverTargetElement = null; }
  }

  set(menus: TopMenu[]) {
    this.raw = menus;
    this.menus = forPage(menus);
    const wasOpen = this.openIdx();
    const focused = this.el.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.cmd : undefined;
    const barOpen = popOpen(this.bar);
    this.close();
    this.bar.replaceChildren(...this.menus.map((m, i) => {
      const b = h('button', { type: 'button', class: 'mb-title', 'data-menu': m.id, role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': false, tabindex: i === 0 ? 0 : -1 }, m.label);
      const drop = this.list(m.items, m.label, b, 'below');
      // the title toggles its menu (native invoker: a click on it is no "click outside")
      if (this.narrow) b.onclick = () => (this.isOpen(drop) ? this.hide(drop) : this.show(drop, b));
      else b.popoverTargetElement = drop;
      b.onpointerenter = () => { if (!this.narrow && this.openIdx() >= 0 && this.openIdx() !== i) this.open(i); };
      return h('div', { class: 'mb-top' }, b, drop);
    }));
    if (barOpen) this.bar.showPopover();
    if (wasOpen >= 0 && wasOpen < this.menus.length) {
      this.open(wasOpen);
      if (focused) this.bar.querySelector<HTMLElement>(`[data-cmd="${CSS.escape(focused)}"]`)?.focus();
    }
  }

  private isOpen(el: Element | null | undefined) { return this.narrow ? !!el?.classList.contains('open') : popOpen(el); }

  /** open a menu or submenu at its anchor; one per level */
  private show(el: HTMLElement, anchor: HTMLElement) {
    if (this.isOpen(el)) return;
    if (!this.narrow) { (el.showPopover as (o?: { source?: HTMLElement }) => void)({ source: anchor }); return; }
    // accordion: close the siblings on this level
    el.parentElement?.parentElement?.querySelectorAll<HTMLElement>(':scope > * > .mb-drop.open').forEach((d) => this.hide(d));
    el.classList.add('open');
    anchor.setAttribute('aria-expanded', 'true');
    anchor.classList.add('on');
  }

  private hide(el: HTMLElement | null | undefined) {
    if (!el || !this.isOpen(el)) return;
    if (!this.narrow) { el.hidePopover(); return; }
    el.querySelectorAll<HTMLElement>('.mb-drop.open').forEach((d) => this.hide(d));
    el.classList.remove('open');
    const anchor = el.previousElementSibling;
    anchor?.setAttribute('aria-expanded', 'false');
    anchor?.classList.remove('on');
  }

  /** index of the open top menu, -1 if none */
  private openIdx() { return [...this.bar.querySelectorAll(':scope > .mb-top > .mb-drop')].findIndex((d) => this.isOpen(d)); }
  private titles() { return [...this.bar.querySelectorAll<HTMLElement>(':scope > .mb-top > .mb-title')]; }

  close() {
    this.bar.querySelectorAll<HTMLElement>(':scope > .mb-top > .mb-drop').forEach((d) => this.hide(d));
    if (popOpen(this.bar)) this.bar.hidePopover();
  }

  private open(i: number, focus = false) {
    const title = this.titles()[i];
    const drop = title?.nextElementSibling as HTMLElement | null;
    if (!title || !drop) return;
    if (this.narrow && !popOpen(this.bar)) this.bar.showPopover();
    this.show(drop, title);
    if (focus) (drop.querySelector<HTMLElement>(':scope > [role^="menuitem"]:not([disabled]), :scope > .mb-subwrap > [role^="menuitem"]') ?? title).focus();
  }

  /** a menu (or submenu); a popover anchored at `anchor` in wide windows */
  private list(items: MenuItem[], label: string, anchor: HTMLElement, side: 'below' | 'right'): HTMLElement {
    const ul = h('div', { class: ['mb-drop', side === 'right' && 'mb-sub'], role: 'menu', 'aria-label': label });
    if (!this.narrow) {
      ul.popover = 'auto';
      ul.addEventListener('beforetoggle', (e) => {
        if (e.target !== ul) return;
        const on = (e as ToggleEvent).newState === 'open';
        anchor.setAttribute('aria-expanded', String(on));
        anchor.classList.toggle('on', on);
      });
      ul.addEventListener('toggle', (e) => { if (e.target === ul && popOpen(ul)) place(ul, anchor.getBoundingClientRect(), { side, sheet: false }); });
    }
    for (const it of items) {
      if (it.type === 'separator') { ul.append(h('div', { class: 'mb-sep', role: 'separator' })); continue; }
      const check = it.type === 'checkbox' || it.type === 'radio';
      const b = h('button', {
        type: 'button', class: 'mb-item', tabindex: -1, role: it.type === 'checkbox' ? 'menuitemcheckbox' : it.type === 'radio' ? 'menuitemradio' : 'menuitem',
        'aria-checked': check ? !!it.checked : null, disabled: it.enabled === false, title: it.title || null, 'data-cmd': it.id ?? null,
      },
      h('span', { class: 'mb-check' }, it.checked ? (it.type === 'radio' ? '•' : '✓') : ''),
      h('span', { class: 'mb-label' }, it.label ?? ''),
      h('span', { class: 'mb-key' }, it.submenu ? (this.narrow ? '⌄' : '›') : it.accel ? formatAccel(it.accel, this.mac) : ''));
      if (it.submenu) {
        b.setAttribute('aria-haspopup', 'menu');
        b.setAttribute('aria-expanded', 'false');
        const sub = this.list(it.submenu, it.label ?? '', b, 'right');
        // click opens (accordion: toggles); hover opens with a mouse only
        b.onclick = () => (this.narrow && this.isOpen(sub) ? this.hide(sub) : this.show(sub, b));
        b.onpointerenter = (e) => { if (!this.narrow && e.pointerType === 'mouse') this.show(sub, b); };
        ul.append(h('div', { class: 'mb-subwrap' }, b, sub));
      } else {
        b.onpointerenter = (e) => { if (!this.narrow && e.pointerType === 'mouse') ul.querySelectorAll<HTMLElement>(':scope > .mb-subwrap > .mb-sub').forEach((s) => this.hide(s)); };
        b.onclick = () => { this.close(); if (it.id) this.run(it.id); };
        ul.append(b);
      }
    }
    return ul;
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    const drop = t.closest<HTMLElement>('.mb-drop');
    const n = this.menus.length;
    const titles = this.titles();
    const cur = this.openIdx() >= 0 ? this.openIdx() : titles.indexOf(t);
    const items = () => [...(drop?.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"], :scope > .mb-subwrap > [role^="menuitem"]') ?? [])].filter((x) => !(x as HTMLButtonElement).disabled);
    const back = () => { const owner = drop!.previousElementSibling as HTMLElement; this.hide(drop); owner.focus(); };
    if (e.key === 'Escape') {
      // one level per Esc: submenu → its item, menu → its title; on a title the browser closes the ☰ panel
      if (!drop) { if (this.narrow) return; e.stopPropagation(); return; }
      e.preventDefault(); e.stopPropagation();
      back();
      return;
    }
    if (e.key === 'ArrowLeft' && drop?.classList.contains('mb-sub')) { e.preventDefault(); back(); return; }
    if (e.key === 'ArrowRight' && drop && t.getAttribute('aria-haspopup')) {
      e.preventDefault();
      const sub = t.nextElementSibling as HTMLElement;
      this.show(sub, t);
      sub.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus();
      return;
    }
    if (!this.narrow && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const i = (cur + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
      if (this.openIdx() >= 0) this.open(i, true); else titles[i]?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const down = e.key === 'ArrowDown';
      if (!drop) {
        // wide: open the menu; narrow: the titles are a vertical list
        if (!this.narrow) { this.open(cur, true); return; }
        const i = titles.indexOf(t);
        titles[(i + (down ? 1 : -1) + n) % n]?.focus();
        return;
      }
      const list = items(), k = list.indexOf(t);
      list[(k + (down ? 1 : -1) + list.length) % list.length]?.focus();
      return;
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (drop) { const list = items(); list[e.key === 'Home' ? 0 : list.length - 1]?.focus(); } else titles[e.key === 'Home' ? 0 : n - 1]?.focus();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !drop && t.classList.contains('mb-title')) { e.preventDefault(); this.open(titles.indexOf(t), true); return; }
    // keys inside the menu must not reach the global shortcuts (Space = freeze …)
    e.stopPropagation();
  }
}
