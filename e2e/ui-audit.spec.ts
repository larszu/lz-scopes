import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, freePort, launchApp, until } from './app';

// UI/UX audit (docs/architecture/ui.md): every menu, submenu, popover and dialog of the main
// window at 375, 768, 1280 and 1920 px, German and English, in headless Chromium against the
// bridge (no Electron, no window on screen). Checks:
//   - overlays inside the viewport, not clipped, not covered (elementFromPoint at corners + centre)
//   - one opening/closing logic: click, Esc, click outside, trigger again; one open at a time;
//     focus back to the trigger
//   - keyboard: Tab order reaches the header, focus ring visible, arrow keys in the menu bar
//   - WCAG AA contrast of UI text in every skin (neutral, LZM, original) and scheme
//   - targets ≥ 24 px (WCAG 2.2 2.5.8), ≥ 44 px on touch viewports
//   - no horizontal scroll, no cut-off labels, no console errors
// Findings land in test-results/ui-audit/<case>.json; the test fails on any finding.
// The native menu of the desktop app is checked at the end (Electron, hidden window): structure
// only. How it looks is not checked: that needs a visible, focused window on the user's screen.
// Tool dialogs, shading bar, panel menus and light meter: see "tool dialogs" below.

const SIZES = [[375, 812], [768, 1024], [1280, 800], [1920, 1080]] as const;
const OUT = join(ROOT, 'test-results', 'ui-audit');

test.use({ actionTimeout: 15_000 });

let bridge: ChildProcess, base = '', config = '';
test.beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  config = mkdtempSync(join(tmpdir(), 'lzs-audit-'));
  const port = await freePort();
  bridge = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs'), '--port', String(port), '--config-dir', config], { cwd: ROOT, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}/`;
  await until(async () => { try { return (await fetch(base)).ok; } catch { return false; } }, 30_000, 'Bridge liefert dist aus');
});
test.afterAll(() => { bridge?.kill(); rmSync(config, { recursive: true, force: true }); });

type Finding = { check: string; where: string; detail: string };

async function openApp(page: Page, o: { lang: 'de' | 'en'; theme?: string; scheme?: string }) {
  await page.addInitScript((o) => {
    try {
      localStorage.setItem('lz-scopes.lang', o.lang);
      if (!localStorage.getItem('lz-scopes.v1')) localStorage.setItem('lz-scopes.v1', JSON.stringify({ theme: o.theme ?? 'neutral', scheme: o.scheme ?? 'dark', panels: [] }));
    } catch { /* ignore */ }
  }, o);
  await page.goto(base);
  await expect(page.locator('.panel').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
}

/** Geometry of an overlay: inside the viewport, content not clipped sideways, not covered. */
async function geometry(page: Page, sel: string, where: string, f: Finding[]) {
  const r = await page.evaluate((sel) => {
    const el = [...document.querySelectorAll<HTMLElement>(sel)].find((e) => e.getClientRects().length > 0);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const pts: [number, number][] = [[b.left + 3, b.top + 3], [b.right - 3, b.top + 3], [b.left + 3, b.bottom - 3], [b.right - 3, b.bottom - 3], [(b.left + b.right) / 2, (b.top + b.bottom) / 2]];
    const covered = pts.filter(([x, y]) => x >= 0 && y >= 0 && x < innerWidth && y < innerHeight)
      .map(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit && !el.contains(hit) ? `${hit.tagName.toLowerCase()}.${hit.className}`.slice(0, 60) : null; })
      .filter(Boolean);
    return { l: b.left, t: b.top, r: b.right, b: b.bottom, vw: innerWidth, vh: innerHeight, clipX: el.scrollWidth > el.clientWidth + 1 ? `${el.scrollWidth}>${el.clientWidth}` : '', covered };
  }, sel);
  if (!r) { f.push({ check: 'missing', where, detail: sel }); return; }
  if (r.l < -1 || r.t < -1 || r.r > r.vw + 1 || r.b > r.vh + 1) f.push({ check: 'viewport', where, detail: `${Math.round(r.l)},${Math.round(r.t)}–${Math.round(r.r)},${Math.round(r.b)} in ${r.vw}×${r.vh}` });
  if (r.clipX) f.push({ check: 'clipped', where, detail: r.clipX });
  if (r.covered.length) f.push({ check: 'covered', where, detail: [...new Set(r.covered)].join(' ') });
}

/** Labels cut off (ellipsis or hidden overflow) inside `scope`. */
async function truncation(page: Page, scope: string, where: string, f: Finding[]) {
  const cut = await page.evaluate((scope) => [...document.querySelectorAll<HTMLElement>(`${scope} :is(button, label, [role=tab], .mb-label, .modal-title, .popover-head, .field > span, summary, h2, h3, option)`)]
    .filter((e) => e.getClientRects().length > 0 && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible')
    .map((e) => (e.textContent ?? '').trim().slice(0, 40)), scope);
  for (const c of new Set(cut)) f.push({ check: 'truncated', where, detail: c });
}

/** Interactive targets in `scope`: ≥ 24 px everywhere, ≥ 44 px on touch viewports. */
async function targets(page: Page, scope: string, where: string, touch: boolean, f: Finding[]) {
  const small = await page.evaluate(({ scope, min }) => [...document.querySelectorAll<HTMLElement>(`${scope} :is(button, select, input:not([type=hidden]), [role=tab], [role^=menuitem], summary, a[href])`)]
    .filter((e) => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
      if (e.matches('a') && e.closest('p, li, td')) return false; // inline links in text: WCAG exception
      // a checkbox counts with its label or row (the whole line is the target)
      if (e.matches('input[type=checkbox], input[type=radio]')) { const l = (e.closest('label') ?? e.parentElement!).getBoundingClientRect(); return Math.min(l.width, l.height) < min - 0.5; }
      return Math.min(r.width, r.height) < min - 0.5;
    })
    .map((e) => { const r = e.matches('input[type=checkbox], input[type=radio]') ? (e.closest('label') ?? e.parentElement!).getBoundingClientRect() : e.getBoundingClientRect(); return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''} "${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 24)}" ${Math.round(r.width)}×${Math.round(r.height)}`; }),
  { scope, min: touch ? 44 : 24 });
  for (const s of new Set(small)) f.push({ check: touch ? 'target<44' : 'target<24', where, detail: s });
}

/** WCAG AA text contrast in `scope` (4.5:1, large text 3:1); background from the ancestors. */
async function contrast(page: Page, scope: string, where: string, f: Finding[]) {
  const low = await page.evaluate((scope) => {
    // any CSS colour (rgb, oklab, color-mix …) → rgba through a 1×1 canvas
    const cx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    const parse = (c: string) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
    const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (c: number[]) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
    const over = (top: number[], bot: number[]) => [0, 1, 2].map((i) => top[i] * top[3] + bot[i] * (1 - top[3])).concat(1);
    const bgOf = (el: Element | null): number[] => {
      const stack: number[][] = [];
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
        if (e.matches('dialog[open], :popover-open')) { /* top layer: the backdrop is not behind it */ }
      }
      let bg = [0, 0, 0, 1];
      for (const c of stack.reverse()) bg = over(c, bg);
      return bg;
    };
    const out: string[] = [];
    const seen = new Set<Element>();
    const walk = document.createTreeWalker(document.querySelector(scope) ?? document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !n.textContent?.trim()) continue;
      seen.add(el);
      if (!el.getClientRects().length || el.closest('[hidden], option, canvas, svg, .side-scrim') || (el as HTMLButtonElement).disabled || el.closest(':disabled, [aria-disabled=true]')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.5) continue;
      const fg = parse(cs.color), bg = bgOf(el);
      const fgb = over([fg[0], fg[1], fg[2], fg[3] * Number(cs.opacity)], bg);
      const L1 = lum(fgb), L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const px = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700;
      const need = px >= 24 || (bold && px >= 18.66) ? 3 : 4.5;
      if (ratio < need) out.push(`"${n.textContent.trim().slice(0, 24)}" ${ratio.toFixed(2)}<${need} (${cs.color} on rgb(${bg.slice(0, 3).map(Math.round).join(',')}))`);
    }
    return out;
  }, scope);
  for (const s of new Set(low)) f.push({ check: 'contrast', where, detail: s });
}

const isOpen = (page: Page, sel: string) => page.evaluate((sel) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0), sel);
/** Waits until the overlay is open (or closed) – closing animations (--dur-2) outlast a fixed pause on slow runners. */
const settles = async (page: Page, sel: string, open: boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await isOpen(page, sel) === open) return true; await page.waitForTimeout(50); }
  return false;
};
/** After opening: let the open animation finish before the next action (sheets ignore clicks while they slide in). */
const OPENED_MS = 300;
const focusIs = (page: Page, sel: string) => page.evaluate((sel) => !!document.activeElement?.matches(sel), sel);

/** A point outside every overlay that triggers nothing: the brand area of the header. */
/** For a dialog: a point beside it (the backdrop); a full-screen sheet has none, then Esc. */
const outsideClick = async (page: Page, overlay = '') => {
  const p = await page.evaluate((sel) => {
    const brand = document.querySelector('header .brand')!.getBoundingClientRect();
    const o = sel ? [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0)?.getBoundingClientRect() : undefined;
    const pts: [number, number][] = [[brand.left + 4, brand.top + brand.height / 2], [4, innerHeight / 2], [innerWidth - 4, innerHeight / 2], [innerWidth / 2, innerHeight - 4]];
    return pts.find(([x, y]) => !o || x < o.left || x > o.right || y < o.top || y > o.bottom) ?? null;
  }, overlay);
  if (p) await page.mouse.click(p[0], p[1]); else await page.keyboard.press('Escape');
};

/** The same opening/closing logic for an overlay: trigger toggles, Esc and outside click close, focus returns. */
async function behaviour(page: Page, trigger: string, overlay: string, where: string, f: Finding[], o: { toggle?: boolean; outside?: boolean } = {}) {
  const t = page.locator(trigger).first();
  await t.click();
  if (!await settles(page, overlay, true)) { f.push({ check: 'open', where, detail: `${trigger} öffnet ${overlay} nicht` }); return; }
  await page.waitForTimeout(OPENED_MS);
  if (o.toggle !== false) {
    await t.click({ force: true });
    if (!await settles(page, overlay, false)) { f.push({ check: 'trigger-toggle', where, detail: 'erneuter Klick auf den Auslöser schließt nicht' }); await page.keyboard.press('Escape'); }
  }
  else { await page.keyboard.press('Escape'); await settles(page, overlay, false); }
  if (o.outside !== false) {
    await t.click(); await settles(page, overlay, true); await page.waitForTimeout(OPENED_MS);
    await outsideClick(page, overlay);
    if (!await settles(page, overlay, false)) { f.push({ check: 'outside-click', where, detail: 'Klick außerhalb schließt nicht' }); await page.keyboard.press('Escape'); }
  }
  // keyboard: focus the trigger, Enter opens, Esc closes and the focus is back on the trigger
  await t.focus(); await page.keyboard.press('Enter');
  if (!await settles(page, overlay, true)) { f.push({ check: 'keyboard-open', where, detail: 'Enter auf dem Auslöser öffnet nicht' }); return; }
  await page.waitForTimeout(OPENED_MS); await page.keyboard.press('Escape');
  if (!await settles(page, overlay, false)) { f.push({ check: 'esc', where, detail: 'Esc schließt nicht' }); await outsideClick(page); }
  else if (!await t.evaluate((e) => e === document.activeElement)) f.push({ check: 'focus-return', where, detail: `Fokus nach Esc auf ${await page.evaluate(() => document.activeElement?.tagName + '.' + document.activeElement?.className)}` });
}

for (const lang of ['de', 'en'] as const) {
  for (const [w, hgt] of SIZES) {
    const touch = w < 1000;
    test(`audit ${w}×${hgt} ${lang}`, async ({ browser }) => {
      test.setTimeout(480_000);
      const ctx = await browser.newContext({ viewport: { width: w, height: hgt }, hasTouch: touch, isMobile: w < 500, colorScheme: 'dark' });
      const page = await ctx.newPage();
      const f: Finding[] = [];
      page.on('pageerror', (e) => f.push({ check: 'console', where: 'page', detail: e.message.slice(0, 160) }));
      page.on('console', (m) => { if (m.type() === 'error') f.push({ check: 'console', where: 'page', detail: m.text().slice(0, 160) }); });
      await openApp(page, { lang });
      const tag = `${w}-${lang}`;

      const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (sw > 0) f.push({ check: 'h-scroll', where: 'page', detail: `${sw} px` });
      await truncation(page, 'header', 'header', f);
      await targets(page, 'header', 'header', touch, f);

      // menu bar (browser build): ☰ below 900 px, then every top menu and every submenu
      const burger = w <= 900;
      if (burger) await behaviour(page, '#menubar .mb-burger', '#menubar .mb-items', 'menu ☰', f);
      const titles = await page.locator('#menubar .mb-title').count();
      for (let i = 0; i < titles; i++) {
        if (burger && !await isOpen(page, '#menubar .mb-items')) await page.locator('#menubar .mb-burger').click();
        const title = page.locator('#menubar .mb-title').nth(i);
        const name = `menu ${(await title.textContent())?.trim()}`;
        if (!burger) await behaviour(page, `#menubar .mb-top:nth-child(${i + 1}) .mb-title`, '#menubar .mb-drop:is(:popover-open, .open)', name, f);
        await title.click(); await page.waitForTimeout(100);
        await geometry(page, burger ? '#menubar .mb-items' : '#menubar .mb-drop:not(.mb-sub):is(:popover-open, .open)', name, f);
        await truncation(page, '#menubar', name, f);
        await targets(page, '#menubar', name, touch, f);
        const subs = await page.locator('#menubar .mb-drop:not(.mb-sub):is(:popover-open, .open) > .mb-subwrap > .mb-item').count();
        for (let k = 0; k < subs; k++) {
          const st = page.locator('#menubar .mb-drop:not(.mb-sub):is(:popover-open, .open) > .mb-subwrap > .mb-item').nth(k);
          await st.click(); await page.waitForTimeout(100);
          const subName = `${name} › ${(await st.textContent())?.trim().slice(1, -1)}`;
          // narrow: the submenu expands inside the ☰ panel, which scrolls; the panel has to fit
          await geometry(page, burger ? '#menubar .mb-items' : '#menubar .mb-sub:is(:popover-open, .open)', subName, f);
          await targets(page, '#menubar .mb-sub:is(:popover-open, .open)', subName, touch, f);
        }
        await page.keyboard.press('Escape'); await page.waitForTimeout(100);
        if (burger) { if (await isOpen(page, '#menubar .mb-items')) await page.locator('#menubar .mb-burger').click(); }
        else if (await isOpen(page, '#menubar .mb-drop')) { f.push({ check: 'esc', where: name, detail: 'Esc schließt das Menü nicht (Fokus im Menü)' }); await outsideClick(page); }
      }

      // header overflow and panel ⚙ popovers
      if (await page.locator('#bar-more .pop-trigger').isVisible()) {
        await behaviour(page, '#bar-more .pop-trigger', '#bar-more .popover', 'popover ⋯', f);
        await page.locator('#bar-more .pop-trigger').click(); await page.waitForTimeout(400);
        await geometry(page, '#bar-more .popover', 'popover ⋯', f);
        await targets(page, '#bar-more .popover', 'popover ⋯', touch, f);
        await page.keyboard.press('Escape');
      }
      // the ⚙ of the panels (the ? of the scope help has its own pass below)
      const gear = '.panel .pop-trigger:not(.help-trigger)';
      const gears = await page.locator(gear).evaluateAll((els) => els.filter((e) => e.getClientRects().length > 0).length);
      if (gears) {
        await behaviour(page, `${gear} >> visible=true`, '.panel .popover:popover-open', 'popover ⚙', f);
        await page.locator(`${gear} >> visible=true`).first().click(); await page.waitForTimeout(400);
        await geometry(page, '.panel .popover:popover-open', 'popover ⚙', f);
        await truncation(page, '.panel .popover:popover-open', 'popover ⚙', f);
        await targets(page, '.panel .popover:popover-open', 'popover ⚙', touch, f);
        await page.screenshot({ path: join(OUT, `${tag}-popover.png`) });
        await page.keyboard.press('Escape'); await settles(page, '.panel .popover:popover-open', false);
        // scope help card (src/help/scopeHelp.ts): fits the screen, nothing cut off, targets large enough
        const help = '.panel .help-trigger >> visible=true';
        if (await page.locator(help).count()) {
          await page.locator(help).first().click(); await settles(page, '.popover.scopehelp:popover-open', true);
          // placement happens in the toggle event, a moment after opening (same wait as the ⚙ pass)
          await page.waitForTimeout(400);
          await geometry(page, '.popover.scopehelp:popover-open', 'popover ?', f);
          await truncation(page, '.popover.scopehelp:popover-open', 'popover ?', f);
          await targets(page, '.popover.scopehelp:popover-open', 'popover ?', touch, f);
          await page.keyboard.press('Escape'); await settles(page, '.popover.scopehelp:popover-open', false);
        }
        await page.locator(`${gear} >> visible=true`).first().click(); await page.waitForTimeout(400);
        // one open at a time: the menu bar (or ☰) closes the popover and the other way round
        // keyboard on purpose: an open ☰ panel covers the ⚙ on a phone (a tap would land in the panel)
        await page.locator(burger ? '#menubar .mb-burger' : '#menubar .mb-title >> nth=0').press('Enter'); await page.waitForTimeout(150);
        if (await isOpen(page, '.panel .popover:popover-open')) f.push({ check: 'one-open', where: 'popover ⚙ + menu', detail: 'Popover bleibt offen, wenn das Menü aufgeht' });
        await page.locator(`${gear} >> visible=true`).first().press('Enter'); await page.waitForTimeout(150);
        if (await isOpen(page, burger ? '#menubar .mb-items' : '#menubar .mb-drop')) f.push({ check: 'one-open', where: 'menu + popover ⚙', detail: 'Menü bleibt offen, wenn das Popover aufgeht' });
        await page.keyboard.press('Escape'); await outsideClick(page);
      } else f.push({ check: 'missing', where: 'popover ⚙', detail: 'kein sichtbarer ⚙-Auslöser' });

      // dialogs: settings (every page), then the tools from the menu
      await behaviour(page, '#settings-btn', 'dialog#settings[open]', 'dialog settings', f, { toggle: false });
      await page.locator('#settings-btn').click(); await page.waitForTimeout(300);
      const tabs = await page.locator('dialog#settings [role=tab]').count();
      for (let i = 0; i < tabs; i++) {
        const tab = page.locator('dialog#settings [role=tab]').nth(i);
        const name = `settings › ${(await tab.textContent())?.trim()}`;
        await tab.click(); await page.waitForTimeout(150);
        await geometry(page, 'dialog#settings', name, f);
        await truncation(page, 'dialog#settings', name, f);
        await targets(page, 'dialog#settings', name, touch, f);
        if (i === 0) await page.screenshot({ path: join(OUT, `${tag}-settings.png`) });
      }
      // arrow keys in the tab list
      await page.locator('dialog#settings [role=tab]').first().focus();
      await page.keyboard.press(w <= 640 ? 'ArrowRight' : 'ArrowDown');
      if (!await focusIs(page, 'dialog#settings [role=tab]:nth-child(2)')) {
        await page.locator('dialog#settings [role=tab]').first().focus();
        await page.keyboard.press(w <= 640 ? 'ArrowDown' : 'ArrowRight');
        if (!await focusIs(page, 'dialog#settings [role=tab]:nth-child(2)')) f.push({ check: 'arrows', where: 'settings tabs', detail: 'Pfeiltasten wechseln die Rubrik nicht' });
      }
      await page.keyboard.press('Escape');
      for (const cmd of ['layouts', 'output', 'led', 'calibration', `manual:${lang}`]) {
        if (burger && !await isOpen(page, '#menubar .mb-items')) await page.locator('#menubar .mb-burger').click();
        const item = page.locator(`#menubar .mb-item[data-cmd="${cmd}"]`);
        const top = await page.locator('#menubar .mb-top').filter({ has: page.locator(`[data-cmd="${cmd}"]`) }).count();
        // open the top menu that holds the command
        const menus = await page.locator('#menubar .mb-title').count();
        for (let i = 0; i < menus && !await item.isVisible(); i++) { await page.locator('#menubar .mb-title').nth(i).click(); await page.waitForTimeout(60); }
        if (!await item.isVisible()) { f.push({ check: 'missing', where: `dialog ${cmd}`, detail: `Menüpunkt nicht gefunden (${top})` }); await page.keyboard.press('Escape'); continue; }
        await item.click(); await page.waitForTimeout(500);
        const dlg = 'dialog[open]';
        if (!await isOpen(page, dlg)) { f.push({ check: 'open', where: `dialog ${cmd}`, detail: 'kein Dialog' }); continue; }
        await geometry(page, dlg, `dialog ${cmd}`, f);
        await truncation(page, dlg, `dialog ${cmd}`, f);
        await targets(page, dlg, `dialog ${cmd}`, touch, f);
        await page.screenshot({ path: join(OUT, `${tag}-${cmd.replace(':', '-')}.png`) });
        await page.keyboard.press('Escape'); await page.waitForTimeout(200);
        if (await isOpen(page, dlg)) { f.push({ check: 'esc', where: `dialog ${cmd}`, detail: 'Esc schließt nicht' }); await page.locator(`${dlg} .modal-head button.icon, ${dlg} button:has-text("✕")`).first().click().catch(() => {}); }
      }

      // sources drawer on narrow windows
      if (w <= 800) {
        await page.locator('#toggle-side').click(); await page.waitForTimeout(300);
        await geometry(page, '#side', 'sources drawer', f);
        await targets(page, '#side', 'sources drawer', touch, f);
        await page.keyboard.press('Escape'); await page.waitForTimeout(200);
        if (await page.locator('#side').isVisible()) f.push({ check: 'esc', where: 'sources drawer', detail: 'Esc schließt die Schublade nicht' });
      } else await targets(page, '#side', 'sources', touch, f);

      // keyboard: Tab walks the header with a visible focus ring
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const ring: string[] = [];
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
          const e = document.activeElement as HTMLElement | null;
          if (!e || e === document.body) return null;
          const cs = getComputedStyle(e);
          const visible = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none';
          return visible ? '' : `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${e.className}`.slice(0, 50);
        });
        if (r) ring.push(r);
      }
      for (const r of new Set(ring)) f.push({ check: 'focus-ring', where: 'tab order', detail: r });

      await page.screenshot({ path: join(OUT, `${tag}-main.png`) });
      writeFileSync(join(OUT, `${tag}.json`), JSON.stringify(f, null, 1));
      await ctx.close();
      expect(f, JSON.stringify(f, null, 1)).toEqual([]);
    });
  }
}

// Contrast of the UI text in every skin and scheme (light: neutral and LZM; the original skin is dark only).
for (const [theme, scheme] of [['neutral', 'dark'], ['neutral', 'light'], ['lzm', 'dark'], ['lzm', 'light'], ['original', 'dark']] as const) {
  test(`contrast ${theme} ${scheme}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const f: Finding[] = [];
    await openApp(page, { lang: 'en', theme, scheme });
    await contrast(page, 'header', 'header', f);
    await contrast(page, '#side', 'sources', f);
    await contrast(page, '.panel .phead', 'panel head', f);
    await page.locator('#menubar .mb-title').nth(1).click();
    await contrast(page, '#menubar .mb-drop:is(:popover-open, .open)', 'menu', f);
    await page.keyboard.press('Escape');
    await page.locator('.panel .pop-trigger >> visible=true').first().click(); await page.waitForTimeout(300);
    await contrast(page, '.panel .popover:popover-open', 'popover ⚙', f);
    await page.keyboard.press('Escape');
    await page.locator('#settings-btn').click(); await page.waitForTimeout(300);
    const tabs = await page.locator('dialog#settings [role=tab]').count();
    for (let i = 0; i < tabs; i++) { await page.locator('dialog#settings [role=tab]').nth(i).click(); await contrast(page, 'dialog#settings', `settings ${i}`, f); }
    writeFileSync(join(OUT, `contrast-${theme}-${scheme}.json`), JSON.stringify(f, null, 1));
    await ctx.close();
    expect(f, JSON.stringify(f, null, 1)).toEqual([]);
  });
}

// Native menu of the desktop app (German and English): every item labelled, submenus not empty,
// no accelerator twice. Hidden window (LZS_HIDDEN), nothing comes to the front.
for (const lang of ['de', 'en'] as const) {
  test(`native menu ${lang}`, async () => {
    const a = await launchApp({ lang, hidden: true });
    try {
      const problems = await until(() => a.app.evaluate(({ Menu }) => {
        const m = Menu.getApplicationMenu();
        if (!m || !m.items.some((i) => i.label === 'Hilfe' || i.label === 'Help')) return null;
        const out: string[] = [];
        const accels = new Map<string, string>();
        const walk = (items: Electron.MenuItem[], path: string) => {
          for (const it of items) {
            if (it.type === 'separator') continue;
            const p = `${path} › ${it.label}`;
            if (!it.label.trim() && !it.role) out.push(`${p}: ohne Beschriftung`);
            if (it.submenu) { if (!it.submenu.items.length) out.push(`${p}: leeres Untermenü`); walk(it.submenu.items, p); }
            const acc = it.accelerator ? String(it.accelerator) : '';
            if (acc && it.visible) { if (accels.has(acc) && accels.get(acc) !== it.id) out.push(`${p}: ${acc} schon bei ${accels.get(acc)}`); accels.set(acc, it.id || it.label); }
          }
        };
        walk(m.items, '');
        return out;
      }), 30_000, 'natives Menü');
      expect(problems).toEqual([]);
    } finally { await a.close(); }
  });
}

// ---------------------------------------------------------------- tool dialogs (#111 follow-up)
// Every tool dialog, the touch-shading bar, the clock/genlock/colour-match panel menus, the light
// meter and every settings page at 375 px (DE and EN): overflow, targets ≥ 44 px, focus inside
// the dialog on open, Tab stays inside (focus trap), Esc closes, focus returns to a visible
// control. Contrast of the same surfaces in all five skins at 1280 px.

/** Run a menu command like a user: open the top menus (and their submenus) until the item shows. */
async function menuCmd(page: Page, cmd: string) {
  const burger = await page.locator('#menubar .mb-burger').isVisible();
  if (burger && !await isOpen(page, '#menubar .mb-items')) await page.locator('#menubar .mb-burger').click();
  const item = page.locator(`#menubar .mb-item[data-cmd="${cmd}"]`);
  const n = await page.locator('#menubar .mb-title').count();
  for (let i = 0; i < n && !await item.isVisible(); i++) {
    const title = page.locator('#menubar .mb-title').nth(i);
    await title.hover(); await page.waitForTimeout(60); // hover opens it while another menu is open
    if (await title.getAttribute('aria-expanded') !== 'true') await title.click();
    await page.waitForTimeout(60);
    const subs = page.locator('#menubar .mb-drop:is(:popover-open, .open) > .mb-subwrap > .mb-item');
    for (let k = 0; k < await subs.count() && !await item.isVisible(); k++) { await subs.nth(k).click(); await page.waitForTimeout(60); }
  }
  if (!await item.isVisible()) { await page.keyboard.press('Escape'); return false; }
  await item.click(); await page.waitForTimeout(500);
  return true;
}

type AuditOpts = { touch: boolean; modal?: boolean; esc?: boolean; overlay?: boolean };

/** Overlay audit: geometry, overflow, targets, focus on open, focus trap, Esc, focus return. */
async function overlayAudit(page: Page, sel: string, where: string, f: Finding[], o: AuditOpts) {
  if (!await isOpen(page, sel)) { f.push({ check: 'open', where, detail: `${sel} nicht offen` }); return; }
  // in-flow sections (light meter in the sidebar) scroll with the page: no viewport check
  if (o.overlay !== false) await geometry(page, sel, where, f);
  await truncation(page, sel, where, f);
  await targets(page, sel, where, o.touch, f);
  // content wider than its scroll box (sideways scrolling inside a dialog); a tab strip may scroll,
  // but its selected tab has to be in view
  const ov = await page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(`${sel}, ${sel} *`)]
    .filter((e) => e.getClientRects().length > 0 && e.scrollWidth > e.clientWidth + 1 && ['auto', 'scroll'].includes(getComputedStyle(e).overflowX) && !e.matches('canvas, pre, table, .table-wrap, textarea'))
    .map((e) => {
      if (e.matches('[role=tablist]')) {
        const on = e.querySelector('[aria-selected=true]')?.getBoundingClientRect(), b = e.getBoundingClientRect();
        return !on || (on.left >= b.left - 1 && on.right <= b.right + 1) ? '' : `selected tab out of view ${Math.round(on.left)}–${Math.round(on.right)} in ${Math.round(b.left)}–${Math.round(b.right)}`;
      }
      return `${e.tagName.toLowerCase()}.${e.className} ${e.scrollWidth}>${e.clientWidth}`.slice(0, 70);
    }).filter(Boolean), sel);
  for (const s of new Set(ov)) f.push({ check: 'h-overflow', where, detail: s });
  if (o.modal) {
    if (!await focusIs(page, `${sel}, ${sel} *`)) f.push({ check: 'focus-open', where, detail: `Fokus beim Öffnen auf ${await page.evaluate(() => document.activeElement?.tagName)}` });
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const r = await page.evaluate((sel) => { const a = document.activeElement; return !a || a === document.body || a.closest(sel) ? '' : `${a.tagName.toLowerCase()}.${a.className}`.slice(0, 50); }, sel);
      if (r) { f.push({ check: 'focus-trap', where, detail: `Tab verlässt den Dialog: ${r}` }); break; }
    }
  }
  if (o.esc === false) return;
  await page.keyboard.press('Escape'); await page.waitForTimeout(250);
  if (await isOpen(page, sel)) { f.push({ check: 'esc', where, detail: 'Esc schließt nicht' }); return; }
  const back = await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return !a || a === document.body || !a.getClientRects().length ? `${a?.tagName}.${a?.className}`.slice(0, 50) : ''; });
  if (back) f.push({ check: 'focus-return', where, detail: `Fokus nach dem Schließen auf ${back}` });
}

type Surface = { sel: string; where: string; modal: boolean; esc: boolean; overlay?: boolean };

/** Open each tool surface in turn and hand it to `check` (which may close it). */
async function eachTool(page: Page, lang: 'de' | 'en', check: (s: Surface) => Promise<void>, f: Finding[]) {
  const closeDialog = async () => { if (await isOpen(page, 'dialog[open]')) await page.locator('dialog[open] .modal-head button.icon').last().click().catch(() => {}); };
  for (const cmd of ['led', 'calibration', 'output', `manual:${lang}`, 'testvideos', 'testimages', 'layouts']) {
    if (!await menuCmd(page, cmd)) { f.push({ check: 'missing', where: `dialog ${cmd}`, detail: 'Menüpunkt nicht gefunden' }); continue; }
    await check({ sel: 'dialog[open]', where: `dialog ${cmd}`, modal: true, esc: true });
    await closeDialog();
  }
  // settings: every page (Esc once at the end)
  await page.locator('#settings-btn').click(); await page.waitForTimeout(300);
  const tabs = await page.locator('dialog#settings [role=tab]').count();
  for (let i = 0; i < tabs; i++) {
    const tab = page.locator('dialog#settings [role=tab]').nth(i);
    await tab.click(); await page.waitForTimeout(150);
    await check({ sel: 'dialog#settings', where: `settings › ${(await tab.textContent())?.trim()}`, modal: true, esc: i === tabs - 1 });
  }
  await closeDialog();
  // touch shading: a bar over the scopes (non-modal)
  if (await menuCmd(page, 'shading')) {
    await page.locator('.shading-bar:not(.hidden) :is(select, button)').first().focus();
    await check({ sel: '.shading-bar:not(.hidden)', where: 'shading bar', modal: false, esc: true });
    if (await isOpen(page, '.shading-bar:not(.hidden)')) await page.locator('.shading-bar button.icon').last().click();
  } else f.push({ check: 'missing', where: 'shading', detail: 'Menüpunkt nicht gefunden' });
  // panels with their own menus: genlock, clock, colour match (+ logo dialog)
  for (const scope of ['genlock', 'clock', 'match']) {
    if (!await menuCmd(page, `scope:${scope}`)) { f.push({ check: 'missing', where: `panel ${scope}`, detail: 'Menüpunkt nicht gefunden' }); continue; }
    const gear = page.locator('.panel .pop-trigger >> visible=true').last();
    await gear.scrollIntoViewIfNeeded(); await gear.click(); await page.waitForTimeout(300);
    await check({ sel: '.panel .popover:popover-open', where: `popover ${scope}`, modal: false, esc: true });
    if (scope === 'match') {
      if (!await isOpen(page, '.panel .popover:popover-open')) { await gear.click(); await page.waitForTimeout(300); }
      await page.locator('.panel .popover:popover-open button', { hasText: 'Logo' }).first().click(); await page.waitForTimeout(300);
      await check({ sel: 'dialog[open]', where: 'dialog match logo', modal: true, esc: true });
      await closeDialog();
    }
    if (await isOpen(page, '.panel .popover:popover-open')) await page.keyboard.press('Escape');
  }
  // light meter: a section of the sources sidebar
  if (!await page.locator('#side').isVisible()) { await page.locator('#toggle-side').click(); await page.waitForTimeout(300); }
  const lm = page.locator('#opple-wrap > summary');
  await lm.scrollIntoViewIfNeeded(); await lm.click(); await page.waitForTimeout(300);
  await check({ sel: '#opple-wrap', where: 'light meter', modal: false, esc: false, overlay: false });
}

for (const lang of ['de', 'en'] as const) {
  test(`tools 375 ${lang}`, async ({ browser }) => {
    test.setTimeout(480_000);
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const f: Finding[] = [];
    page.on('pageerror', (e) => f.push({ check: 'console', where: 'page', detail: e.message.slice(0, 160) }));
    await openApp(page, { lang });
    const sw = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await eachTool(page, lang, async (s) => {
      await overlayAudit(page, s.sel, s.where, f, { touch: true, modal: s.modal, esc: s.esc, overlay: s.overlay });
      if (await sw() > 0) f.push({ check: 'h-scroll', where: s.where, detail: `${await sw()} px` });
    }, f);
    writeFileSync(join(OUT, `tools-375-${lang}.json`), JSON.stringify(f, null, 1));
    await page.screenshot({ path: join(OUT, `tools-375-${lang}.png`) });
    await ctx.close();
    expect(f, JSON.stringify(f, null, 1)).toEqual([]);
  });
}

for (const [theme, scheme] of [['neutral', 'dark'], ['neutral', 'light'], ['lzm', 'dark'], ['lzm', 'light'], ['original', 'dark']] as const) {
  test(`tools contrast ${theme} ${scheme}`, async ({ browser }) => {
    test.setTimeout(300_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const f: Finding[] = [];
    await openApp(page, { lang: 'en', theme, scheme });
    await eachTool(page, 'en', async (s) => {
      await contrast(page, s.sel, s.where, f);
      if (s.where.startsWith('popover')) await page.keyboard.press('Escape');
    }, f);
    writeFileSync(join(OUT, `tools-contrast-${theme}-${scheme}.json`), JSON.stringify(f, null, 1));
    await ctx.close();
    expect(f, JSON.stringify(f, null, 1)).toEqual([]);
  });
}
