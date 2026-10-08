// Texts of the Electron main process (#94). The main process cannot import src/i18n (ESM,
// bundled by Vite), so its few strings live here. Language: the one the page reports with its
// menu (the user's choice in the settings), before that app.getLocale().
// outside Electron (unit tests) require('electron') is the binary path, there is no app
const electron = require('electron');
const app = typeof electron === 'object' ? electron.app : null;

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
    tvSize: (got, want) => `Size ${got} instead of ${want} bytes – file changed on the server?`,
    tvSha: 'SHA-256 does not match – file changed on the server? Not used.',
    tvInvalid: 'Invalid entry or source not allowed',
    tvRunning: 'already running',
    zipNone: 'not a ZIP file',
    zipEncrypted: 'encrypted ZIP',
    zipTrailing: 'ZIP with trailing sizes is not supported',
    zipMethod: (m) => `ZIP method ${m} is not supported`,
    zipSize: (n, want) => `unpacked ${n} instead of ${want} bytes`,
    zipCrc: 'CRC-32 does not match',
    updateReady: (v) => `LZ Scopes ${v} downloaded`,
    updateReadyBody: 'The update is installed when you quit the app.',
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
    tvSize: (got, want) => `Größe ${got} statt ${want} Bytes – Datei auf dem Server geändert?`,
    tvSha: 'SHA-256 stimmt nicht – Datei auf dem Server geändert? Nicht verwendet.',
    tvInvalid: 'Eintrag ungültig oder Quelle nicht erlaubt',
    tvRunning: 'läuft schon',
    zipNone: 'kein ZIP',
    zipEncrypted: 'verschlüsseltes ZIP',
    zipTrailing: 'ZIP mit nachgestellten Größen nicht unterstützt',
    zipMethod: (m) => `ZIP-Methode ${m} nicht unterstützt`,
    zipSize: (n, want) => `entpackt ${n} statt ${want} Bytes`,
    zipCrc: 'CRC-32 stimmt nicht',
    updateReady: (v) => `LZ Scopes ${v} geladen`,
    updateReadyBody: 'Das Update wird beim Beenden der App installiert.',
  },
};

let current = '';
/** de or en: the page's language once known, else the system locale. */
const lang = () => {
  const l = current || (app?.isReady() ? app.getLocale() : '') || (typeof navigator === 'object' ? navigator.language : '') || '';
  return l.toLowerCase().startsWith('de') ? 'de' : 'en';
};
/** The page reports its UI language (with the menu model). */
const setLang = (l) => { if (l === 'de' || l === 'en') current = l; };
const text = (key, ...args) => { const v = TEXT[lang()][key]; return typeof v === 'function' ? v(...args) : v; };

module.exports = { text, setLang, lang, TEXT };
