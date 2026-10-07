// Dialogs for own test pictures, logo and favourites, and the test video catalogue (#52).

import { PATTERNS } from './patterns';
import { TEST_VIDEOS, formatBytes, type TestVideo } from './testVideoCatalog';
import {
  MAX_IMAGE_BYTES, addUserImages, favourites, isFavourite, logoId, onUserPatternsChange, patternId, removeUserImage,
  renameUserImage, setFavourite, setLogo, uploadLogo, userImages,
} from './userPatterns';
import { t } from './i18n';
import { button, filePicker, h, hint, iconButton, kicker, link, modal, row, textInput } from './ui';

export interface TestMediaHost {
  /** show a pattern in the first pattern source (adds one if needed) */
  usePattern: (id: string) => void;
  /** open a cached video as a file source */
  openVideo: (url: string, v: TestVideo) => void;
  hud: (msg: string) => void;
}

/** One-shot tool dialog (removed when closed). */
function dialog(id: string, cls: string, title: string) {
  const m = modal({ id, cls, title, size: cls === 'testvid' ? 'xl' : 'md', removeOnClose: true });
  return { dlg: m.dlg, body: m.body, open: m.open };
}
const pick = (accept: string, multiple: boolean, then: (f: File[]) => void) => filePicker(accept, then, multiple).pick();

// ---------------------------------------------------------------- own pictures, logo, favourites

export function openTestImages(host: TestMediaHost) {
  const { dlg, body, open } = dialog('testimages', 'testimg', t('testmedia.imagesTitle'));
  const render = async () => {
    const list = await userImages();
    const logo = logoId();
    const rows = list.map((img) => {
      const url = URL.createObjectURL(img.blob);
      const name = textInput(img.name, (v) => renameUserImage(img.id, v), { attrs: { class: 'url', 'aria-label': t('testmedia.name') } });
      const pid = patternId(img.id);
      const fav = isFavourite(pid);
      return h('div', { class: 'timg', 'data-img': img.id },
        h('img', { src: url, alt: '' }),
        h('div', { class: 'timg-main' },
          name,
          row(
            h('label', { class: 'check', title: t('testmedia.useAsLogo') },
              h('input', { type: 'radio', name: 'logo', checked: logo === img.id, onchange: () => setLogo(img.id) }), t('testmedia.logo')),
            button(fav ? '★' : '☆', () => setFavourite(pid, !fav), { small: true, pressed: fav, title: fav ? t('testmedia.unfav') : t('testmedia.fav'), attrs: { class: `btn mini fav${fav ? ' on' : ''}` } }),
            button(t('testmedia.show'), () => { host.usePattern(pid); dlg.close(); }, { small: true }),
            button(t('testmedia.delete'), () => removeUserImage(img.id), { small: true, title: t('testmedia.deleteStored') }))));
    });
    const favs = favourites().map((id) => PATTERNS.find((p) => p.id === id)).filter((p) => !!p);
    // object URLs of the thumbnails die with the next render
    body.querySelectorAll<HTMLImageElement>('.timg img').forEach((i) => URL.revokeObjectURL(i.src));
    body.replaceChildren(
      row(
        button(t('testmedia.uploadImages'), () => pick('image/*', true, async (f) => { const r = await addUserImages(f); r.errors.forEach(host.hud); }), { variant: 'primary' }),
        button(t('testmedia.uploadLogo'), () => pick('image/*', false, async (f) => { if (f[0]) (await uploadLogo(f[0])).forEach(host.hud); })),
        logo && button(t('testmedia.noLogo'), () => setLogo(''))),
      hint(t('testmedia.imagesHint', { mb: MAX_IMAGE_BYTES >> 20 })),
      ...(rows.length ? rows : [hint(t('testmedia.noImages'))]),
      kicker(t('testmedia.favourites')),
      favs.length
        ? h('div', { class: 'favlist' }, ...favs.map((p) => h('span', { class: 'fav-chip' },
          button(p!.name, () => { host.usePattern(p!.id); dlg.close(); }, { small: true, title: t('testmedia.show') }),
          iconButton('✕', t('testmedia.unfavName', { name: p!.name }), () => setFavourite(p!.id, false), { small: true, title: t('testmedia.unfav') }))))
        : hint(t('testmedia.noFavs')),
    );
  };
  const off = onUserPatternsChange(() => { if (dlg.open) render(); });
  dlg.addEventListener('close', () => { off(); body.querySelectorAll<HTMLImageElement>('.timg img').forEach((i) => URL.revokeObjectURL(i.src)); });
  render();
  open();
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
  const { dlg, body, open } = dialog('testvideos', 'testvid', t('testmedia.videosTitle'));
  const api = tvApi();
  const status: Record<string, TvStatus> = {};
  const cells = new Map<string, HTMLElement>();
  const action = (v: TestVideo): Node => {
    const st = status[v.id] ?? { state: 'none' };
    if (!api) return link(v.url, t('testmedia.fileFromServer'));
    if (st.state === 'loading' || st.state === 'verifying') {
      const pct = st.total ? Math.floor((100 * (st.got ?? 0)) / st.total) : 0;
      return h('span', { class: 'row' }, h('progress', { max: 100, value: pct }), st.state === 'verifying' ? t('testmedia.verifying') : `${pct} %`,
        button(t('testmedia.cancel'), () => api.cancel(v.id), { small: true }));
    }
    if (st.state === 'done' && st.file) {
      return h('span', { class: 'row' },
        button(t('testmedia.open'), () => { host.openVideo(`lzs-media://video/${encodeURIComponent(st.file!)}`, v); dlg.close(); }, { small: true, variant: 'primary' }),
        button(t('testmedia.delete'), async () => { await api.remove(plain(v)); status[v.id] = { state: 'none' }; paint(v); }, { small: true, title: t('testmedia.deleteLocal') }));
    }
    return h('span', { class: 'row' },
      button(t('testmedia.download', { size: formatBytes(v.bytes) }), async () => {
        status[v.id] = { state: 'loading', got: 0, total: v.bytes }; paint(v);
        const r = await api.download(plain(v));
        status[v.id] = r.ok ? { state: 'done', file: r.file } : { state: 'error', error: r.error }; paint(v);
      }, { small: true }),
      st.state === 'error' && h('span', { class: 'hint bad', role: 'alert' }, st.error ?? t('testmedia.error')));
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
    hint(t('testmedia.intro'), api ? t('testmedia.introDesktop') : t('testmedia.introBrowser')),
    h('div', { class: 'table-wrap' }, h('table', { class: 'tvtable table' }, h('tbody', {}, ...rows))),
    hint(t('testmedia.attribution'), link('https://peach.blender.org/about/', 'peach.blender.org'),
      ' · Netflix Open Content ', link('https://opencontent.netflix.com/', 'opencontent.netflix.com'),
      t('testmedia.hdrNote')),
  );
  TEST_VIDEOS.forEach(paint);
  if (api) {
    const off = api.onProgress((m) => { status[m.id] = m; const v = TEST_VIDEOS.find((x) => x.id === m.id); if (v) paint(v); });
    dlg.addEventListener('close', off);
    api.status(TEST_VIDEOS.map(plain)).then((s) => { Object.assign(status, s); TEST_VIDEOS.forEach(paint); }).catch(() => {});
  }
  open();
}
