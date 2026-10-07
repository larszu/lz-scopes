// Native application menu, built from the model the page sends (src/menu/appMenu.ts).
// macOS: the app menu (About, Settings …, Services, Hide, Quit) comes first, as the HIG
// prescribes; items flagged `appMenu` move there. Windows/Linux: the menu bar sits in the
// window, Settings stays in File and About in Help.
// Clicks are sent back to the page as `lzs:menu` with the command id.
const { Menu, app } = require('electron');
const { text } = require('./i18n.cjs');

const mac = process.platform === 'darwin';
const ROLES = new Set(['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll', 'minimize', 'zoom', 'front', 'quit', 'close', 'togglefullscreen']);
const modifier = (a) => /(Cmd|Ctrl|CmdOrCtrl|CommandOrControl|Alt|Option|Super)\+/i.test(a);

/** Page model → Electron template (validated: strings only, known roles). */
function toTemplate(items, send, pickApp) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || typeof it !== 'object') continue;
    if (mac && it.appMenu) { pickApp.push(it); continue; }
    if (it.type === 'separator') { if (out.length && out[out.length - 1].type !== 'separator') out.push({ type: 'separator' }); continue; }
    const label = typeof it.label === 'string' ? it.label.slice(0, 80) : '';
    if (it.role) {
      if (ROLES.has(it.role)) out.push({ role: it.role, label: label || undefined });
      continue;
    }
    if (it.submenu) { out.push({ label, submenu: toTemplate(it.submenu, send, pickApp) }); continue; }
    const id = typeof it.id === 'string' ? it.id.slice(0, 80) : '';
    if (!id) continue;
    const t = { id, label, click: () => send(id), enabled: it.enabled !== false };
    if (it.type === 'checkbox' || it.type === 'radio') { t.type = it.type; t.checked = !!it.checked; }
    if (typeof it.accel === 'string' && it.accel) {
      t.accelerator = it.accel;
      // single keys are only shown: registered they would swallow typing in input fields
      if (!modifier(it.accel)) t.registerAccelerator = false;
    }
    out.push(t);
  }
  while (out.length && out[out.length - 1].type === 'separator') out.pop();
  return out;
}

/** Build and set the application menu from the page's model. */
function setAppMenu(model, send) {
  const pickApp = [];
  const tops = (Array.isArray(model) ? model : []).map((m) => {
    const t = { label: String(m.label ?? '').slice(0, 40), submenu: toTemplate(m.items, send, pickApp) };
    if (m.id === 'window' && mac) t.role = 'windowMenu';
    if (m.id === 'help') t.role = 'help';
    return t;
  }).filter((t) => t.submenu.length);
  if (mac) {
    const name = app.name || 'LZ Scopes';
    const pick = (id) => pickApp.find((x) => x.id === id);
    const about = pick('settings:about');
    const settings = pick('settings');
    tops.unshift({
      label: name,
      submenu: [
        about ? { label: text('about', name), click: () => send('settings:about') } : { role: 'about', label: text('about', name) },
        { type: 'separator' },
        ...(settings ? [{ id: 'settings', label: text('settings'), accelerator: 'Cmd+,', click: () => send('settings') }, { type: 'separator' }] : []),
        { role: 'services', label: text('services') },
        { type: 'separator' },
        { role: 'hide', label: text('hide', name) },
        { role: 'hideOthers', label: text('hideOthers') },
        { role: 'unhide', label: text('showAll') },
        { type: 'separator' },
        { role: 'quit', label: text('quit', name) },
      ],
    });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(tops));
}

module.exports = { setAppMenu, toTemplate };
