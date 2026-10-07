// Texts of the Electron main process (#94). The main process cannot import src/i18n (ESM,
// bundled by Vite), so its few strings live here. Language: the one the page reports with its
// menu (the user's choice in the settings), before that app.getLocale().
const { app } = require('electron');

const TEXT = {
  en: {
    about: (n) => `About ${n}`,
    settings: 'Settings …',
    services: 'Services',
    hide: (n) => `Hide ${n}`,
    hideOthers: 'Hide Others',
    showAll: 'Show All',
    quit: (n) => `Quit ${n}`,
    output: 'LZ Scopes – Output',
    watchFolder: 'Watch export folder',
    startFailed: 'Start failed:',
  },
  de: {
    about: (n) => `Über ${n}`,
    settings: 'Einstellungen …',
    services: 'Dienste',
    hide: (n) => `${n} ausblenden`,
    hideOthers: 'Andere ausblenden',
    showAll: 'Alle einblenden',
    quit: (n) => `${n} beenden`,
    output: 'LZ Scopes – Ausgabe',
    watchFolder: 'Export-Ordner überwachen',
    startFailed: 'Start fehlgeschlagen:',
  },
};

let current = '';
/** de or en: the page's language once known, else the system locale. */
const lang = () => {
  const l = current || (app.isReady() ? app.getLocale() : '') || '';
  return l.toLowerCase().startsWith('de') ? 'de' : 'en';
};
/** The page reports its UI language (with the menu model). */
const setLang = (l) => { if (l === 'de' || l === 'en') current = l; };
const text = (key, ...args) => { const v = TEXT[lang()][key]; return typeof v === 'function' ? v(...args) : v; };

module.exports = { text, setLang, lang, TEXT };
