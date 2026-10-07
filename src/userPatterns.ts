// Own test pictures and logo (#52): uploaded images stay in the browser's IndexedDB (desktop
// app: in its profile under userData), not only for the session. Output windows of the same
// origin read them from there too. Favourites are a list of pattern ids in localStorage.

import { PATTERNS, logoCard, testCardLogo, userLogo, type PatternDef } from './patterns';

export const USER_GROUP = 'Eigene Bilder';
const DB = 'lz-scopes-media', STORE = 'images';
const LOGO_KEY = 'lz-scopes.logo', FAV_KEY = 'lz-scopes.pattern-favs';
/** limit per image: larger files are refused rather than filling the quota silently */
export const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export interface UserImage { id: string; name: string; type: string; blob: Blob; added: number }

const listeners = new Set<() => void>();
/** Called after uploads, deletions and logo changes. */
export const onUserPatternsChange = (f: () => void) => { listeners.add(f); return () => listeners.delete(f); };
const changed = () => listeners.forEach((f) => f());

function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error ?? new Error('IndexedDB nicht verfügbar'));
  });
}
async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((ok, fail) => {
    const t = d.transaction(STORE, mode);
    const r = run(t.objectStore(STORE));
    t.oncomplete = () => { ok(r.result); d.close(); };
    t.onerror = t.onabort = () => { fail(t.error ?? new Error('IndexedDB-Fehler')); d.close(); };
  });
}

const urls = new Map<string, string>();
export const patternId = (imgId: string) => `img:${imgId}`;
const imgIdOf = (patId: string) => (patId.startsWith('img:') ? patId.slice(4) : '');

function register(img: UserImage): PatternDef {
  const id = patternId(img.id);
  const old = PATTERNS.find((p) => p.id === id);
  if (old) return old;
  const src = URL.createObjectURL(img.blob);
  urls.set(img.id, src);
  const def: PatternDef = { id, name: img.name, group: USER_GROUP, src };
  PATTERNS.push(def);
  return def;
}

function unregister(imgId: string) {
  const i = PATTERNS.findIndex((p) => p.id === patternId(imgId));
  if (i >= 0) PATTERNS.splice(i, 1);
  const u = urls.get(imgId);
  if (u) { URL.revokeObjectURL(u); urls.delete(imgId); }
}

export const LOGO_PATTERNS: PatternDef[] = [
  { id: 'logo', name: 'Eigenes Logo', group: USER_GROUP, draw: (c, w, h) => logoCard(c, w, h) },
  { id: 'testcard-logo', name: 'Testbild mit Kreis und Uhr + Logo', group: 'Testbild', animated: true, draw: testCardLogo },
];

/** Logo patterns exist only while a logo is chosen. */
function syncLogoPatterns() {
  for (const p of LOGO_PATTERNS) {
    const i = PATTERNS.findIndex((x) => x.id === p.id);
    if (userLogo.image && i < 0) {
      // the logo test card right after the original one
      const at = p.id === 'testcard-logo' ? PATTERNS.findIndex((x) => x.id === 'testcard') + 1 : PATTERNS.length;
      PATTERNS.splice(at > 0 ? at : PATTERNS.length, 0, p);
    } else if (!userLogo.image && i >= 0) PATTERNS.splice(i, 1);
  }
}

export function logoId(): string {
  try { return localStorage.getItem(LOGO_KEY) ?? ''; } catch { return ''; }
}

async function loadLogo(imgId: string) {
  const src = urls.get(imgId);
  if (!src) { userLogo.image = null; userLogo.name = ''; return; }
  const img = new Image();
  img.src = src;
  try { await img.decode(); userLogo.image = img; userLogo.name = PATTERNS.find((p) => p.id === patternId(imgId))?.name ?? ''; }
  catch { userLogo.image = null; userLogo.name = ''; }
}

let loaded: Promise<UserImage[]> | null = null;
/** Read the stored images once and register them as patterns (also in output windows). */
export function loadUserPatterns(): Promise<UserImage[]> {
  loaded ??= (async () => {
    let list: UserImage[] = [];
    try { list = await tx('readonly', (s) => s.getAll() as IDBRequest<UserImage[]>); } catch { /* no IndexedDB (private window): session only */ }
    list.sort((a, b) => a.added - b.added).forEach(register);
    const l = logoId();
    if (l && list.some((x) => x.id === l)) await loadLogo(l);
    syncLogoPatterns();
    changed();
    return list;
  })();
  return loaded;
}

export async function userImages(): Promise<UserImage[]> {
  try { return (await tx('readonly', (s) => s.getAll() as IDBRequest<UserImage[]>)).sort((a, b) => a.added - b.added); } catch { return []; }
}

/** Store images (IndexedDB) and register them; returns the new patterns and any refusals. */
export async function addUserImages(files: File[]): Promise<{ added: PatternDef[]; errors: string[] }> {
  const added: PatternDef[] = [], errors: string[] = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) { errors.push(`${f.name}: kein Bild`); continue; }
    if (f.size > MAX_IMAGE_BYTES) { errors.push(`${f.name}: größer als ${MAX_IMAGE_BYTES >> 20} MB`); continue; }
    const img: UserImage = { id: crypto.randomUUID(), name: f.name, type: f.type, blob: f, added: Date.now() };
    try { await tx('readwrite', (s) => s.put(img)); }
    catch (e) { errors.push(`${f.name}: nicht gespeichert (${(e as Error).message}); nur für diese Sitzung`); }
    added.push(register(img));
  }
  changed();
  return { added, errors };
}

export async function removeUserImage(imgId: string) {
  try { await tx('readwrite', (s) => s.delete(imgId)); } catch { /* not stored */ }
  if (logoId() === imgId) await setLogo('');
  unregister(imgId);
  setFavourite(patternId(imgId), false);
  changed();
}

export async function renameUserImage(imgId: string, name: string) {
  const list = await userImages();
  const img = list.find((x) => x.id === imgId);
  if (!img || !name.trim()) return;
  img.name = name.trim();
  await tx('readwrite', (s) => s.put(img));
  const p = PATTERNS.find((x) => x.id === patternId(imgId));
  if (p) p.name = img.name;
  changed();
}

/** Choose one of the stored images as the logo ('' = none). */
export async function setLogo(imgId: string) {
  try { if (imgId) localStorage.setItem(LOGO_KEY, imgId); else localStorage.removeItem(LOGO_KEY); } catch { /* ignore */ }
  await loadLogo(imgId);
  syncLogoPatterns();
  changed();
}

/** Upload a logo: stored like any image and chosen as the logo. */
export async function uploadLogo(f: File): Promise<string[]> {
  const r = await addUserImages([f]);
  const p = r.added[0];
  if (p) await setLogo(imgIdOf(p.id));
  return r.errors;
}

// ---------------------------------------------------------------- favourites

export function favourites(): string[] {
  try { const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; } catch { return []; }
}
export const isFavourite = (id: string) => favourites().includes(id);
export function setFavourite(id: string, on: boolean) {
  const f = favourites().filter((x) => x !== id);
  if (on) f.push(id);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(f)); } catch { /* ignore */ }
  changed();
}
/** Favourites that exist as patterns, in the order they were starred. */
export const favouritePatterns = () => favourites().map((id) => PATTERNS.find((p) => p.id === id)).filter((p): p is PatternDef => !!p);
