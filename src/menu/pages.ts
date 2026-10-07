// Settings pages without app state: keyboard shortcuts and About / licences.

import { REPO } from './appMenu';
import { formatAccel, isMac } from './model';
import type { SettingsSection } from './settings';
import { SHORTCUTS } from './shortcuts';
import { t } from '../i18n';
import { h, hint, link } from '../ui';

declare const __APP_VERSION__: string | undefined;
const version = () => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '');

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = '') => h(tag, cls ? { class: cls } : null, text);

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
  id: 'keys', label: t('settings.keys'), order,
  render: () => [
    keysTable(),
    hint(t('settings.keys.hint')),
  ],
});

export const aboutSection = (order: number): SettingsSection => ({
  id: 'about', label: t('settings.about'), order,
  render: () => {
    const p = hint;
    return [
      el('p', 'about-name', `LZ Scopes${version() ? ` ${version()}` : ''}`),
      p(`© ${new Date().getFullYear()} Lars Zumpe Medienproduktion. ${t('settings.about.own')}`, link(`${REPO}/blob/main/LICENSE`, 'LICENSE'), '.'),
      p(t('settings.about.third'), link(`${REPO}/blob/main/THIRD_PARTY.md`, 'THIRD_PARTY.md'), t('settings.about.licenses')),
      p(t('settings.about.ffmpeg')),
      p('NDI® is a registered trademark of Vizrt NDI AB.'),
      p(t('settings.about.source'), link(REPO, 'github.com/larszu/lz-scopes'), '.'),
    ];
  },
});
