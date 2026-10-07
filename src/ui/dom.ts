// The one DOM helper of the app (docs/architecture/ui.md). Every module builds its elements
// with h(); controls, popovers and dialogs are composed from it in src/ui/*.ts.

/** Children: nodes and text; null, undefined, false and '' are skipped, arrays are flattened. */
export type Kid = Node | string | number | null | undefined | false | readonly Kid[];
/** Attributes: on* functions become listeners, class takes a string or a list, style a string or an object. */
export type Attrs = Record<string, unknown>;

function appendKids(el: Element, kids: readonly Kid[]) {
  for (const k of kids) {
    if (k === null || k === undefined || k === false || k === '') continue;
    if (Array.isArray(k)) appendKids(el, k);
    else el.append(typeof k === 'number' ? String(k) : (k as Node | string));
  }
}

/** Set attributes the way h() does (also used to update an existing element). */
export function setAttrs(el: HTMLElement, attrs: Attrs) {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(el.dataset, v);
    // ARIA and data attributes keep "true"/"false" as text; for all others a boolean switches the attribute
    else if (typeof v === 'boolean') {
      if (k.startsWith('aria-') || k.startsWith('data-')) el.setAttribute(k, String(v));
      else if (v) el.setAttribute(k, '');
    } else el.setAttribute(k, String(v));
  }
}

/** Create an element: h('button', { class: 'primary', onclick }, 'Text'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) setAttrs(el, attrs);
  appendKids(el, kids);
  return el;
}

/** querySelector with a type. */
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

/** Link that opens in a new tab/window (the desktop app hands it to the system browser). */
export const link = (href: string, text: Kid) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

/** Save a blob or text as a file. */
export function download(name: string, data: Blob | string, type = 'text/plain;charset=utf-8') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/** Hidden file input; `pick()` opens the system file dialog. Append `input` where a test or label needs it. */
export function filePicker(accept: string, then: (files: File[]) => void, multiple = false) {
  const input = h('input', { type: 'file', accept, multiple, hidden: true });
  input.onchange = () => { const f = [...(input.files ?? [])]; input.value = ''; if (f.length) then(f); };
  return { input, pick: () => input.click() };
}
