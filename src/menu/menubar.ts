// In-page menu bar for the browser build (the desktop app uses the native menu instead).
// WAI-ARIA menubar pattern: Alt+F10 or click opens, arrow keys move, Enter runs, Esc closes.
// Below 900 px the bar collapses behind a ☰ button at the same position (top left).

import { formatAccel, forPage, isMac, type MenuItem, type TopMenu } from './model';

type Run = (id: string) => void;

export class MenuBar {
  readonly el: HTMLElement;
  private bar: HTMLElement;
  private burger: HTMLButtonElement;
  private openIdx = -1;
  private menus: TopMenu[] = [];
  private mac = isMac();

  constructor(private run: Run) {
    this.burger = document.createElement('button');
    this.burger.className = 'icon mb-burger';
    this.burger.title = 'Menü';
    this.burger.setAttribute('aria-label', 'Menü');
    this.burger.setAttribute('aria-expanded', 'false');
    this.burger.textContent = '☰';
    this.burger.onclick = () => this.toggleBurger();
    this.bar = document.createElement('div');
    this.bar.className = 'mb-items';
    this.bar.setAttribute('role', 'menubar');
    this.bar.setAttribute('aria-label', 'Hauptmenü');
    this.el = document.createElement('nav');
    this.el.className = 'menubar';
    this.el.id = 'menubar';
    this.el.append(this.burger, this.bar);
    document.addEventListener('pointerdown', (e) => { if (!this.el.contains(e.target as Node)) this.close(); });
    document.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'F10') { e.preventDefault(); this.open(0, true); }
    });
    this.bar.addEventListener('keydown', (e) => this.onKey(e));
  }

  set(menus: TopMenu[]) {
    this.menus = forPage(menus);
    const wasOpen = this.openIdx;
    this.bar.replaceChildren(...this.menus.map((m, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'mb-top';
      const b = document.createElement('button');
      b.className = 'mb-title';
      b.textContent = m.label;
      b.dataset.menu = m.id;
      b.setAttribute('role', 'menuitem');
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.tabIndex = i === 0 ? 0 : -1;
      b.onclick = () => (this.openIdx === i ? this.close() : this.open(i));
      b.onpointerenter = () => { if (this.openIdx >= 0 && this.openIdx !== i) this.open(i); };
      wrap.append(b);
      return wrap;
    }));
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
    const ul = document.createElement('div');
    ul.className = 'mb-drop';
    ul.setAttribute('role', 'menu');
    ul.setAttribute('aria-label', label);
    for (const it of items) {
      if (it.type === 'separator') { const s = document.createElement('div'); s.className = 'mb-sep'; s.setAttribute('role', 'separator'); ul.append(s); continue; }
      const b = document.createElement('button');
      b.className = 'mb-item';
      b.tabIndex = -1;
      const role = it.type === 'checkbox' ? 'menuitemcheckbox' : it.type === 'radio' ? 'menuitemradio' : 'menuitem';
      b.setAttribute('role', role);
      if (it.type === 'checkbox' || it.type === 'radio') b.setAttribute('aria-checked', String(!!it.checked));
      if (it.enabled === false) b.disabled = true;
      if (it.title) b.title = it.title;
      if (it.id) b.dataset.cmd = it.id;
      const mark = document.createElement('span');
      mark.className = 'mb-check';
      mark.textContent = it.checked ? (it.type === 'radio' ? '•' : '✓') : '';
      const text = document.createElement('span');
      text.className = 'mb-label';
      text.textContent = it.label ?? '';
      const key = document.createElement('span');
      key.className = 'mb-key';
      key.textContent = it.submenu ? '›' : it.accel ? formatAccel(it.accel, this.mac) : '';
      b.append(mark, text, key);
      if (it.submenu) {
        b.setAttribute('aria-haspopup', 'menu');
        const sub = this.list(it.submenu, it.label ?? '');
        sub.classList.add('mb-sub');
        const holder = document.createElement('div');
        holder.className = 'mb-subwrap';
        holder.append(b, sub);
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
