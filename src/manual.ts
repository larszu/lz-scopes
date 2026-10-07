// In-app manual: renders docs/manual/*.md (one source for GitHub and the app). Only the
// Markdown the manual uses: headings, paragraphs, lists, tables, images, links, **bold**,
// `code`. Text is escaped; images come from docs/manual/img through Vite.

import inputsDe from '../docs/manual/inputs.de.md?raw';
import inputs from '../docs/manual/inputs.md?raw';
import { t } from './i18n';
import { button, h, openModal, type Modal } from './ui';

const IMAGES = import.meta.glob('../docs/manual/img/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const img = (name: string) => IMAGES[`../docs/manual/${name}`] ?? '';

export const MANUALS = { de: inputsDe, en: inputs };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Inline Markdown → HTML (escaped first). */
export function inline(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
}

/** Block Markdown → HTML. `resolveImg` maps a relative image path to a URL. */
export function renderMarkdown(md: string, resolveImg: (p: string) => string = img): string {
  const out: string[] = [];
  const lines = md.replace(/\r/g, '').split('\n');
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const h = /^(#{1,3}) (.*)$/.exec(l);
    if (h) { out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); i++; continue; }
    const im = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(l);
    if (im) {
      const src = resolveImg(im[2]);
      out.push(src ? `<figure><img src="${esc(src)}" alt="${esc(im[1])}"><figcaption>${inline(im[1])}</figcaption></figure>` : '');
      i++; continue;
    }
    if (/^\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const li = /^(\s*)(-|\d+\.) (.*)$/;
    if (li.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items: string[] = [];
      while (i < lines.length && li.test(lines[i])) { items.push(`<li>${inline(li.exec(lines[i])![3])}</li>`); i++; }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||!\[|\s*(-|\d+\.) )/.test(lines[i])) { para.push(lines[i].trim()); i++; }
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}

/** Opens the manual as a dialog over the app. */
let open: Modal | null = null;
export function openManual(lang: 'de' | 'en' = 'de') {
  open?.close();
  const article = h('article');
  article.innerHTML = renderMarkdown(MANUALS[lang]);
  const sw = button(lang === 'de' ? 'English' : 'Deutsch', () => openManual(lang === 'de' ? 'en' : 'de'), { small: true }); // lang-ok: name of the other language, in that language
  open = openModal({ title: t('menu.manual'), cls: 'manual', size: 'lg', headExtra: [sw], body: [article], onClose: () => { open = null; } });
}
