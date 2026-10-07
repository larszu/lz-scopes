// Settings pages without app state: keyboard shortcuts and About / licences.

import { REPO } from './appMenu';
import { formatAccel, isMac } from './model';
import type { SettingsSection } from './settings';
import { SHORTCUTS } from './shortcuts';

declare const __APP_VERSION__: string | undefined;
const version = () => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '');

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const link = (href: string, text: string) => { const a = el('a', '', text); a.href = href; a.target = '_blank'; a.rel = 'noopener'; return a; };

export function keysTable(): HTMLElement {
  const mac = isMac();
  const t = el('table', 'keys');
  let group = '';
  for (const s of SHORTCUTS) {
    if (s.group !== group) {
      group = s.group;
      const r = t.insertRow();
      const c = r.insertCell();
      c.colSpan = 2; c.className = 'kgroup'; c.textContent = group;
    }
    const r = t.insertRow();
    const k = r.insertCell();
    s.keys.forEach((key, i) => {
      if (i) k.append(' ');
      k.append(/^[A-Z][a-z]/.test(key) && !/[+]/.test(key) && !['Space', 'Escape', 'Left', 'Right', 'Home', 'End'].includes(key) ? el('span', '', key) : el('kbd', '', formatAccel(key, mac)));
    });
    r.insertCell().textContent = s.what;
  }
  return t;
}

export const keysSection = (order: number): SettingsSection => ({
  id: 'keys', label: 'Tastatur', order,
  render: () => [
    keysTable(),
    el('p', 'hint', 'Einzeltasten wirken nur, solange kein Eingabefeld den Fokus hat. Im Browser kann der Browser selbst einzelne Kombinationen abfangen; die Desktop-App hat sie im Menü.'),
  ],
});

export const aboutSection = (order: number): SettingsSection => ({
  id: 'about', label: 'Über / Lizenzen', order,
  render: () => {
    const p = (...kids: (Node | string)[]) => { const x = el('p', 'hint'); x.append(...kids); return x; };
    return [
      el('p', 'about-name', `LZ Scopes${version() ? ` ${version()}` : ''}`),
      p(`© ${new Date().getFullYear()} Lars Zumpe Medienproduktion. Eigener Code proprietär, siehe `, link(`${REPO}/blob/main/LICENSE`, 'LICENSE'), '.'),
      p('Komponenten Dritter (dockview, MediaPipe, ws, Electron, Public Sans, ffmpeg) und portierte Formeln mit ihren Lizenzen: ', link(`${REPO}/blob/main/THIRD_PARTY.md`, 'THIRD_PARTY.md'), '. Die Lizenztexte liegen der Desktop-App im Ordner licenses/ bei.'),
      p('Die Desktop-App liefert ffmpeg (GPL-3.0-or-later) als eigenes Programm mit; Quelle und Build-Angaben in THIRD_PARTY.md.'),
      p('NDI® is a registered trademark of Vizrt NDI AB.'),
      p('Quellcode und Fehlermeldungen: ', link(REPO, 'github.com/larszu/lz-scopes'), '.'),
    ];
  },
});
