// Dialogs for own test pictures, logo and favourites, and the test video catalogue (#52).

import { PATTERNS } from './patterns';
import { TEST_VIDEOS, formatBytes, type TestVideo } from './testVideoCatalog';
import {
  MAX_IMAGE_BYTES, addUserImages, favourites, isFavourite, logoId, onUserPatternsChange, patternId, removeUserImage,
  renameUserImage, setFavourite, setLogo, uploadLogo, userImages,
} from './userPatterns';
import { t } from './i18n';

type Kid = Node | string;
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Kid[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, String(v));
  }
  el.append(...kids);
  return el;
};
const link = (href: string, text: string) => h('a', { href, target: '_blank', rel: 'noopener' }, text);

export interface TestMediaHost {
  /** show a pattern in the first pattern source (adds one if needed) */
  usePattern: (id: string) => void;
  /** open a cached video as a file source */
  openVideo: (url: string, v: TestVideo) => void;
  hud: (msg: string) => void;
}

function dialog(cls: string, title: string): { dlg: HTMLDialogElement; body: HTMLElement } {
  const body = h('div', { class: 'dlg-body' });
  const close = h('button', { class: 'icon', 'aria-label': t('testmedia.close') }, '✕');
  const dlg = h('dialog', { class: `tooldlg ${cls}`, 'aria-label': title },
    h('div', { class: 'dlg-head' }, h('h2', {}, title), close), body) as HTMLDialogElement;
  close.onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  // keys typed here must not reach the global shortcuts
  dlg.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  return { dlg, body };
}

const filePicker = (accept: string, multiple: boolean, then: (f: File[]) => void) => {
  const i = h('input', { type: 'file', accept, multiple }) as HTMLInputElement;
  i.onchange = () => then([...(i.files ?? [])]);
  i.click();
};

// ---------------------------------------------------------------- own pictures, logo, favourites

export function openTestImages(host: TestMediaHost) {
  const { dlg, body } = dialog('testimg', t('testmedia.imagesTitle'));
  dlg.id = 'testimages';
  const render = async () => {
    const list = await userImages();
    const logo = logoId();
    const rows = list.map((img) => {
      const url = URL.createObjectURL(img.blob);
      const name = h('input', { value: img.name, class: 'url', 'aria-label': t('testmedia.name') }) as HTMLInputElement;
      name.onchange = () => renameUserImage(img.id, name.value);
      const pid = patternId(img.id);
      const fav = isFavourite(pid);
      return h('div', { class: 'timg', 'data-img': img.id },
        h('img', { src: url, alt: '' }),
        h('div', { class: 'timg-main' },
          name,
          h('div', { class: 'row' },
            h('label', { class: 'inline', title: t('testmedia.useAsLogo') },
              h('input', { type: 'radio', name: 'logo', checked: logo === img.id, onchange: () => setLogo(img.id) }), t('testmedia.logo')),
            h('button', { class: `mini fav${fav ? ' on' : ''}`, title: fav ? t('testmedia.unfav') : t('testmedia.fav'), 'aria-pressed': String(fav), onclick: () => setFavourite(pid, !fav) }, fav ? '★' : '☆'),
            h('button', { class: 'mini', onclick: () => { host.usePattern(pid); dlg.close(); } }, t('testmedia.show')),
            h('button', { class: 'mini', title: t('testmedia.deleteStored'), onclick: () => removeUserImage(img.id) }, t('testmedia.delete')))));
    });
    const favs = favourites().map((id) => PATTERNS.find((p) => p.id === id)).filter((p) => !!p);
    // object URLs of the thumbnails die with the next render
    body.querySelectorAll<HTMLImageElement>('.timg img').forEach((i) => URL.revokeObjectURL(i.src));
    body.replaceChildren(
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => filePicker('image/*', true, async (f) => { const r = await addUserImages(f); r.errors.forEach(host.hud); }) }, t('testmedia.uploadImages')),
        h('button', { onclick: () => filePicker('image/*', false, async (f) => { if (f[0]) (await uploadLogo(f[0])).forEach(host.hud); }) }, t('testmedia.uploadLogo')),
        logo ? h('button', { onclick: () => setLogo('') }, t('testmedia.noLogo')) : ''),
      h('p', { class: 'hint' }, t('testmedia.imagesHint', { mb: MAX_IMAGE_BYTES >> 20 })),
      ...(rows.length ? rows : [h('p', { class: 'hint' }, t('testmedia.noImages'))]),
      h('div', { class: 'mtitle' }, t('testmedia.favourites')),
      favs.length
        ? h('div', { class: 'favlist' }, ...favs.map((p) => h('span', { class: 'chip' },
          h('button', { class: 'mini', title: t('testmedia.show'), onclick: () => { host.usePattern(p!.id); dlg.close(); } }, p!.name),
          h('button', { class: 'mini', title: t('testmedia.unfav'), 'aria-label': t('testmedia.unfavName', { name: p!.name }), onclick: () => setFavourite(p!.id, false) }, '✕'))))
        : h('p', { class: 'hint' }, t('testmedia.noFavs')),
    );
  };
  const off = onUserPatternsChange(() => { if (dlg.open) render(); });
  dlg.addEventListener('close', () => { off(); body.querySelectorAll<HTMLImageElement>('.timg img').forEach((i) => URL.revokeObjectURL(i.src)); });
  render();
  dlg.showModal();
}

// ---------------------------------------------------------------- test videos

interface TvStatus { state: 'none' | 'loading' | 'verifying' | 'done' | 'error'; got?: number; total?: number; file?: string; error?: string }
interface TvApi {
  status: (list: TestVideo[]) => Promise<Record<string, TvStatus>>;
  download: (v: TestVideo) => Promise<{ ok: boolean; file?: string; error?: string }>;
  cancel: (id: string) => Promise<boolean>;
  remove: (v: TestVideo) => Promise<boolean>;
  folder: () => Promise<string>;
  onProgress: (cb: (m: TvStatus & { id: string }) => void) => () => void;
}
const tvApi = (): TvApi | undefined => (window as unknown as { lzsDesktop?: { testVideos?: TvApi } }).lzsDesktop?.testVideos;
const plain = (v: TestVideo) => JSON.parse(JSON.stringify(v)) as TestVideo;

export function openTestVideos(host: TestMediaHost) {
  const { dlg, body } = dialog('testvid', t('testmedia.videosTitle'));
  dlg.id = 'testvideos';
  const api = tvApi();
  const status: Record<string, TvStatus> = {};
  const cells = new Map<string, HTMLElement>();
  const action = (v: TestVideo): Node => {
    const st = status[v.id] ?? { state: 'none' };
    if (!api) return link(v.url, t('testmedia.fileFromServer'));
    if (st.state === 'loading' || st.state === 'verifying') {
      const pct = st.total ? Math.floor((100 * (st.got ?? 0)) / st.total) : 0;
      return h('span', { class: 'row' }, h('progress', { max: 100, value: pct }), st.state === 'verifying' ? t('testmedia.verifying') : `${pct} %`,
        h('button', { class: 'mini', onclick: () => api.cancel(v.id) }, t('testmedia.cancel')));
    }
    if (st.state === 'done' && st.file) {
      return h('span', { class: 'row' },
        h('button', { class: 'mini primary', onclick: () => { host.openVideo(`lzs-media://video/${encodeURIComponent(st.file!)}`, v); dlg.close(); } }, t('testmedia.open')),
        h('button', { class: 'mini', title: t('testmedia.deleteLocal'), onclick: async () => { await api.remove(plain(v)); status[v.id] = { state: 'none' }; paint(v); } }, t('testmedia.delete')));
    }
    return h('span', { class: 'row' },
      h('button', { class: 'mini', onclick: async () => {
        status[v.id] = { state: 'loading', got: 0, total: v.bytes }; paint(v);
        const r = await api.download(plain(v));
        status[v.id] = r.ok ? { state: 'done', file: r.file } : { state: 'error', error: r.error }; paint(v);
      } }, t('testmedia.download', { size: formatBytes(v.bytes) })),
      st.state === 'error' ? h('span', { class: 'hint bad' }, st.error ?? t('testmedia.error')) : '');
  };
  const paint = (v: TestVideo) => { const c = cells.get(v.id); if (c) c.replaceChildren(action(v)); };
  const rows = TEST_VIDEOS.map((v) => {
    const cell = h('td', { class: 'tv-act' });
    cells.set(v.id, cell);
    return h('tr', { 'data-video': v.id },
      h('td', {}, h('strong', {}, v.title), h('br'), h('span', { class: 'hint' }, v.version)),
      h('td', {}, `${v.width}×${v.height}`, h('br'), h('span', { class: 'hint' }, `${v.fps} fps${v.hdr ? ' · HDR' : ''}`)),
      h('td', { class: 'hint' }, v.codec, ...(v.note ? [h('br'), v.note] : [])),
      h('td', { class: 'hint' }, link(v.licenceUrl, v.licence), h('br'), v.attribution),
      cell);
  });
  body.replaceChildren(
    h('p', { class: 'hint' }, t('testmedia.intro'),
      api ? t('testmedia.introDesktop')
        : t('testmedia.introBrowser')),
    h('table', { class: 'tvtable' }, h('tbody', {}, ...rows)),
    h('p', { class: 'hint' }, t('testmedia.attribution'), link('https://peach.blender.org/about/', 'peach.blender.org'),
      ' · Netflix Open Content ', link('https://opencontent.netflix.com/', 'opencontent.netflix.com'),
      t('testmedia.hdrNote')),
  );
  TEST_VIDEOS.forEach(paint);
  if (api) {
    const off = api.onProgress((m) => { status[m.id] = m; const v = TEST_VIDEOS.find((x) => x.id === m.id); if (v) paint(v); });
    dlg.addEventListener('close', off);
    api.status(TEST_VIDEOS.map(plain)).then((s) => { Object.assign(status, s); TEST_VIDEOS.forEach(paint); }).catch(() => {});
  }
  dlg.showModal();
}
