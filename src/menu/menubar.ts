// In-page menu bar for the browser build (the desktop app uses the native menu instead).
// WAI-ARIA menubar pattern: Alt+F10 or click opens, arrow keys move, Enter runs, Esc closes.
// Below 900 px the bar collapses behind a ☰ button at the same position (top left).

import { formatAccel, forPage, isMac, type MenuItem, type TopMenu } from './model';
import { t } from '../i18n';
import { h } from '../ui';

type Run = (id: string) => void;

export class MenuBar {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private burger: HTMLButtonElement;
  private openIdx = -1;
  private menus: TopMenu[] = [];
  private mac = isMac();

  constructor(private run: Run) {
    this.burger = h('button', { type: 'button', class: 'icon mb-burger', title: t('menu.burger'), 'aria-label': t('menu.burger'), 'aria-expanded': false, onclick: () => this.toggleBurger() }, '☰');
    this.bar = h('div', { class: 'mb-items', role: 'menubar', 'aria-label': t('menu.main') });
    this.el = h('nav', { class: 'menubar', id: 'menubar' }, this.burger, this.bar);
    document.addEventListener('pointerdown', (e) => { if (!this.el.contains(e.target as Node)) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'F10') { e.preventDefault(); this.open(0, true); }
    });
    this.bar.addEventListener('keydown', (e) => this.onKey(e));
  }

  set(menus: TopMenu[]) {
    this.menus = forPage(menus);
    const wasOpen = this.openIdx;
    this.bar.replaceChildren(...this.menus.map((m, i) => h('div', { class: 'mb-top' },
      h('button', {
        type: 'button', class: 'mb-title', 'data-menu': m.id, role: 'menuitem', 'aria-haspopup': 'menu', 'aria-expanded': false, tabindex: i === 0 ? 0 : -1,
        onclick: () => (this.openIdx === i ? this.close() : this.open(i)),
        onpointerenter: () => { if (this.openIdx >= 0 && this.openIdx !== i) this.open(i); },
      }, m.label))));
    if (wasOpen >= 0 && wasOpen < this.menus.length) this.open(wasOpen);
  }

  private toggleBurger() {
    const on = !this.el.classList.contains('burger-open');
    this.el.classList.toggle('burger-open', on);
    this.burger.setAttribute('aria-expanded', String(on));
    if (!on) this.close();
  }

  close() {
    this.openIdx = -1;
    this.bar.querySelectorAll('.mb-drop').forEach((d) => d.remove());
    this.bar.querySelectorAll<HTMLElement>('.mb-title').forEach((b) => { b.classList.remove('on'); b.setAttribute('aria-expanded', 'false'); });
  }

  private open(i: number, focus = false) {
    this.close();
    const m = this.menus[i];
    const wrap = this.bar.children[i] as HTMLElement | undefined;
    if (!m || !wrap) return;
    this.openIdx = i;
    const title = wrap.querySelector<HTMLElement>('.mb-title')!;
    title.classList.add('on');
    title.setAttribute('aria-expanded', 'true');
    const drop = this.list(m.items, m.label);
    wrap.append(drop);
    if (focus) (drop.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? title).focus();
  }

  private list(items: MenuItem[], label: string): HTMLElement {
    const ul = h('div', { class: 'mb-drop', role: 'menu', 'aria-label': label });
    for (const it of items) {
      if (it.type === 'separator') { ul.append(h('div', { class: 'mb-sep', role: 'separator' })); continue; }
      const role = it.type === 'checkbox' ? 'menuitemcheckbox' : it.type === 'radio' ? 'menuitemradio' : 'menuitem';
      const b = h('button', {
        type: 'button', class: 'mb-item', tabindex: -1, role,
        'aria-checked': it.type === 'checkbox' || it.type === 'radio' ? !!it.checked : null,
        disabled: it.enabled === false, title: it.title || null, 'data-cmd': it.id || null, 'aria-haspopup': it.submenu ? 'menu' : null,
      },
      h('span', { class: 'mb-check' }, it.checked ? (it.type === 'radio' ? '•' : '✓') : ''),
      h('span', { class: 'mb-label' }, it.label ?? ''),
      h('span', { class: 'mb-key' }, it.submenu ? '›' : it.accel ? formatAccel(it.accel, this.mac) : ''));
      if (it.submenu) {
        const sub = this.list(it.submenu, it.label ?? '');
        sub.classList.add('mb-sub');
        const holder = h('div', { class: 'mb-subwrap' }, b, sub);
        b.onclick = () => holder.classList.toggle('open');
        ul.append(holder);
      } else {
        b.onclick = () => { this.close(); this.el.classList.remove('burger-open'); if (it.id) this.run(it.id); };
        ul.append(b);
      }
    }
    return ul;
  }

  private onKey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    const inDrop = !!t.closest('.mb-drop');
    const n = this.menus.length;
    const cur = this.openIdx >= 0 ? this.openIdx : [...this.bar.querySelectorAll('.mb-title')].indexOf(t);
    const items = () => [...(t.closest('.mb-drop') ?? this.bar.querySelector('.mb-drop'))?.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"], :scope > .mb-subwrap > [role^="menuitem"]') ?? []].filter((x) => !(x as HTMLButtonElement).disabled);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const i = cur; this.close(); (this.bar.querySelectorAll<HTMLElement>('.mb-title')[i] ?? this.bar).focus(); return; }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (inDrop && e.key === 'ArrowRight' && t.getAttribute('aria-haspopup')) { t.parentElement?.classList.add('open'); t.parentElement?.querySelector<HTMLElement>('.mb-sub [role^="menuitem"]')?.focus(); e.preventDefault(); return; }
      e.preventDefault();
      const i = (cur + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
      if (this.openIdx >= 0) this.open(i, true); else this.bar.querySelectorAll<HTMLElement>('.mb-title')[i]?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!inDrop) { this.open(cur, true); return; }
      const list = items(), k = list.indexOf(t);
      list[(k + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && !inDrop && t.classList.contains('mb-title')) { e.preventDefault(); this.open(cur, true); }
    // keys inside the menu must not reach the global shortcuts (Space = freeze …)
    e.stopPropagation();
  }
}
