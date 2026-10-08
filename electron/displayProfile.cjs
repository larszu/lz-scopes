// System display profile and monitor mode (#17), desktop app only. docs/research/systemprofil.md
//
// macOS:   ColorSync device API through the small Swift helper helpers/bin/lzs-colorsync
//          (built by scripts/build-helpers.mjs). Checked on the test Mac with set + reset.
// Windows: mscms ColorProfile*DisplayDefault* via PowerShell + inline C# – UNTESTED.
// Linux:   colord through its command-line client colormgr – UNTESTED. Takes effect only where the
//          desktop applies colord's default profile (GNOME/mutter; X11 desktops with xiccd), not
//          on KDE Plasma 6 (own colour management). docs/research/linux.md
// DDC/CI:  VCP 0x14 (colour preset) / 0x10 (brightness): Windows dxva2 (untested), Linux ddcutil,
//          macOS m1ddc (brightness only), each only when present.
//
// Safety: before a display is switched the first time, its previous state is written to
// userData/display-profile-backup.json; restore() runs on quit, on request and on the next start.
const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROFILE_DIRS = {
  darwin: ['/System/Library/ColorSync/Profiles', '/Library/ColorSync/Profiles', path.join(os.homedir(), 'Library/ColorSync/Profiles')],
  win32: [path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'spool', 'drivers', 'color')],
  // XDG locations colord reads (/usr/share/color/icc, ~/.local/share/icc) and its own store
  linux: ['/usr/share/color/icc', '/usr/local/share/color/icc', path.join(os.homedir(), '.local/share/icc'), '/var/lib/colord/icc'],
};

function helperPath(env = process.env) {
  const own = path.join(__dirname, '..', 'helpers', 'bin', 'lzs-colorsync').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
  return [env.LZS_COLORSYNC_HELPER, own].filter(Boolean).find((p) => fs.existsSync(p)) || null;
}

function which(cmd) {
  for (const d of (process.env.PATH || '').split(path.delimiter).concat(['/opt/homebrew/bin', '/usr/local/bin'])) {
    const p = path.join(d, cmd);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const run = (cmd, args, opts = {}) => new Promise((ok, fail) => {
  execFile(cmd, args, { timeout: 20000, windowsHide: true, maxBuffer: 4 << 20, ...opts }, (e, out, err) => (e ? fail(new Error(String(err || e.message).trim())) : ok(String(out))));
});

// ---------------------------------------------------------------- Windows (untested)

// lang-ok: C# source of the Windows helper (identifiers), not UI text
const WIN_CS = String.raw`
using System; using System.Runtime.InteropServices; using System.Collections.Generic; using System.Text;
public static class LzsDisp {
  [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] public struct SRC { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint statusFlags; }
  [StructLayout(LayoutKind.Sequential)] public struct TGT { public LUID adapterId; public uint id; public uint modeInfoIdx; public int tech; public int rot; public int scal; public uint rn; public uint rd; public int scan; public int avail; public uint statusFlags; }
  [StructLayout(LayoutKind.Sequential)] public struct PATH { public SRC src; public TGT tgt; public uint flags; }
  [StructLayout(LayoutKind.Sequential, Size = 64)] public struct MODE { public int infoType; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct SRCNAME { public int type; public int size; public LUID adapterId; public uint id; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string gdi; }
  [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint f, out uint np, out uint nm);
  [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint f, ref uint np, [Out] PATH[] p, ref uint nm, [Out] MODE[] m, IntPtr t);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref SRCNAME r);
  [DllImport("mscms.dll", CharSet = CharSet.Unicode)] static extern int ColorProfileGetDisplayDefault(int scope, LUID a, uint s, int type, int sub, out IntPtr name);
  [DllImport("mscms.dll", CharSet = CharSet.Unicode)] static extern int ColorProfileSetDisplayDefaultAssociation(int scope, string name, int type, int sub, LUID a, uint s);
  [DllImport("mscms.dll", CharSet = CharSet.Unicode)] static extern int ColorProfileAddDisplayAssociation(int scope, string name, LUID a, uint s, bool setDefault, bool advanced);
  [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr p);
  // CPT_ICC = 0, CPST_NONE = 4, WCS_PROFILE_MANAGEMENT_SCOPE_CURRENT_USER = 1
  static PATH[] Paths() {
    uint np, nm; GetDisplayConfigBufferSizes(2, out np, out nm);
    var p = new PATH[np]; var m = new MODE[nm];
    int r = QueryDisplayConfig(2, ref np, p, ref nm, m, IntPtr.Zero); if (r != 0) throw new Exception("QueryDisplayConfig " + r);
    Array.Resize(ref p, (int)np); return p;
  }
  static string Gdi(PATH p) { var n = new SRCNAME { type = 1, size = Marshal.SizeOf(typeof(SRCNAME)), adapterId = p.src.adapterId, id = p.src.id }; DisplayConfigGetDeviceInfo(ref n); return n.gdi; }
  static string Esc(string s) { return s == null ? "null" : "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }
  public static string List() {
    var sb = new StringBuilder("[");
    foreach (var p in Paths()) {
      IntPtr n; string cur = null;
      if (ColorProfileGetDisplayDefault(1, p.src.adapterId, p.src.id, 0, 4, out n) == 0 && n != IntPtr.Zero) { cur = Marshal.PtrToStringUni(n); LocalFree(n); }
      if (sb.Length > 1) sb.Append(",");
      string id = p.src.adapterId.High + ":" + p.src.adapterId.Low + ":" + p.src.id;
      sb.Append("{\"id\":" + Esc(id) + ",\"name\":" + Esc(Gdi(p)) + ",\"current\":" + Esc(cur) + ",\"custom\":" + Esc(cur) + "}");
    }
    return sb.Append("]").ToString();
  }
  static PATH Find(string id) { foreach (var p in Paths()) if (p.src.adapterId.High + ":" + p.src.adapterId.Low + ":" + p.src.id == id) return p; throw new Exception("Display nicht gefunden"); }
  public static string Set(string id, string profile) {
    var p = Find(id);
    int r = ColorProfileAddDisplayAssociation(1, profile, p.src.adapterId, p.src.id, true, false);
    if (r != 0) r = ColorProfileSetDisplayDefaultAssociation(1, profile, 0, 4, p.src.adapterId, p.src.id);
    if (r != 0) throw new Exception("HRESULT 0x" + r.ToString("X8"));
    return "{\"ok\":true}";
  }
  // DDC/CI through dxva2
  [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonEnum cb, IntPtr d);
  delegate bool MonEnum(IntPtr h, IntPtr dc, IntPtr r, IntPtr d);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct MONINFOEX { public int cbSize; public int l, t, r, b, wl, wt, wr, wb; public uint flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dev; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr h, ref MONINFOEX i);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct PHYS { public IntPtr h; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string desc; }
  [DllImport("dxva2.dll")] static extern bool GetNumberOfPhysicalMonitorsFromHMONITOR(IntPtr h, out uint n);
  [DllImport("dxva2.dll")] static extern bool GetPhysicalMonitorsFromHMONITOR(IntPtr h, uint n, [Out] PHYS[] a);
  [DllImport("dxva2.dll")] static extern bool SetVCPFeature(IntPtr h, byte code, uint value);
  [DllImport("dxva2.dll")] static extern bool DestroyPhysicalMonitors(uint n, PHYS[] a);
  public static string Vcp(string id, byte code, uint value) {
    string gdi = Gdi(Find(id)); bool done = false; string err = "Monitor nicht gefunden";
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (h, dc, r, d) => {
      var mi = new MONINFOEX { cbSize = Marshal.SizeOf(typeof(MONINFOEX)) };
      if (!GetMonitorInfo(h, ref mi) || mi.dev != gdi) return true;
      uint n; if (!GetNumberOfPhysicalMonitorsFromHMONITOR(h, out n) || n == 0) { err = "kein DDC/CI"; return false; }
      var a = new PHYS[n]; GetPhysicalMonitorsFromHMONITOR(h, n, a);
      done = SetVCPFeature(a[0].h, code, value); if (!done) err = "SetVCPFeature fehlgeschlagen";
      DestroyPhysicalMonitors(n, a); return false;
    }, IntPtr.Zero);
    if (!done) throw new Exception(err);
    return "{\"ok\":true}";
  }
}`;

function winPs(expr) {
  const ps = `$ErrorActionPreference='Stop'; Add-Type -TypeDefinition @'\n${WIN_CS}\n'@; [Console]::Out.Write(${expr})`;
  const enc = Buffer.from(ps, 'utf16le').toString('base64');
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', enc], { timeout: 60000 });
}
const psStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

// ---------------------------------------------------------------- Linux: colord (untested)

// colormgr prints `Label:   value` lines (labels translated, so LANG=C), one block per object,
// blocks separated by a blank line; a profile line `Profile n: <id>` is followed by an unlabelled
// line with its file name (colord client/cd-util.c, cd_util_show_device). Profile 1 is the default.
/** Displays from `colormgr get-devices-by-kind display`. */
function parseColordDevices(out) {
  const list = [];
  for (const block of String(out).split(/\n\s*\n/)) {
    const d = { id: null, model: '', vendor: '', output: '', profiles: [] };
    let lastProfile = null;
    for (const line of block.split('\n')) {
      const m = /^([A-Za-z][A-Za-z ]*?\d*):\s+(.*)$/.exec(line);
      if (!m) { if (lastProfile && line.trim()) { lastProfile.file = line.trim(); lastProfile = null; } continue; }
      const [, key, val] = m;
      if (key === 'Device ID') d.id = val.trim();
      else if (key === 'Model') d.model = val.trim();
      else if (key === 'Vendor') d.vendor = val.trim();
      else if (key === 'Metadata' && val.startsWith('XRANDR_name=')) d.output = val.slice(12).trim();
      else if (/^Profile \d+$/.test(key)) { lastProfile = { id: val.trim(), file: null }; d.profiles.push(lastProfile); }
    }
    if (!d.id) continue;
    const name = [d.output, [d.vendor, d.model].filter(Boolean).join(' ')].filter(Boolean).join(' – ') || d.id;
    const def = d.profiles[0] ?? null;
    list.push({ id: d.id, name, current: def?.file ?? null, custom: def?.file ?? null, profileId: def?.id ?? null });
  }
  return list;
}
/** `Object Path:` of a colormgr profile block. */
const parseObjectPath = (out) => (/^Object Path:\s+(\S+)/m.exec(String(out)) || [])[1] || null;

const CM_ENV = () => ({ ...process.env, LANG: 'C', LC_ALL: 'C' });
const cm = (args) => run(which('colormgr') || 'colormgr', args, { env: CM_ENV() });
const cmSync = (args) => String(execFileSync(which('colormgr') || 'colormgr', args, { env: CM_ENV(), timeout: 10000 }));

/** colord profile object for an ICC file: already known (find-profile-by-filename) or imported. */
async function colordProfile(file) {
  const found = await cm(['find-profile-by-filename', file]).catch(() => '');
  return parseObjectPath(found) || parseObjectPath(await cm(['import-profile', file]));
}
async function colordSet(id, file) {
  const prof = await colordProfile(file);
  if (!prof) throw coded('profileNotFound', 'profile not found');
  await cm(['device-add-profile', String(id), prof]).catch(() => {}); // fails when already attached
  await cm(['device-make-profile-default', String(id), prof]);
}
/** No previous profile: detach the default one we made (colord then applies none). */
async function colordReset(id) {
  const d = parseColordDevices(await cm(['get-devices-by-kind', 'display'])).find((x) => x.id === String(id));
  if (d?.profileId) await cm(['device-remove-profile', String(id), d.profileId]);
}
function colordRestoreSync(id, prev) {
  if (prev) {
    const prof = parseObjectPath(cmSync(['find-profile-by-filename', prev]));
    if (prof) { cmSync(['device-make-profile-default', String(id), prof]); return true; }
    return false;
  }
  const d = parseColordDevices(cmSync(['get-devices-by-kind', 'display'])).find((x) => x.id === String(id));
  if (d?.profileId) cmSync(['device-remove-profile', String(id), d.profileId]);
  return true;
}

// ---------------------------------------------------------------- platform layer

// Errors that reach the UI carry a code; the renderer (src/sysprofile.ts) shows them in the UI
// language (sysprofile.err.<code>), the English message is the fallback (#94).
const coded = (code, message) => Object.assign(new Error(message), { code });

const platform = {
  async list() {
    if (process.platform === 'darwin') { const h = helperPath(); if (!h) throw coded('helperMissing', 'helper lzs-colorsync missing'); return JSON.parse(await run(h, ['list'])); }
    if (process.platform === 'win32') return JSON.parse(await winPs('[LzsDisp]::List()'));
    if (process.platform === 'linux' && which('colormgr')) return parseColordDevices(await cm(['get-devices-by-kind', 'display']));
    throw coded('unsupported', 'not supported');
  },
  async set(id, profile) {
    if (process.platform === 'darwin') return run(helperPath(), ['set', String(id), profile]);
    if (process.platform === 'win32') return winPs(`[LzsDisp]::Set(${psStr(id)}, ${psStr(path.basename(profile))})`);
    if (process.platform === 'linux' && which('colormgr')) return colordSet(id, profile);
    throw coded('unsupported', 'not supported');
  },
  async reset(id) {
    if (process.platform === 'darwin') return run(helperPath(), ['reset', String(id)]);
    if (process.platform === 'linux' && which('colormgr')) return colordReset(id);
    throw coded('unsupported', 'not supported');
  },
  restoreSync(id, prev) {
    // true = restored now. Windows: synchronous PowerShell on quit is too slow; the backup
    // stays and is restored on the next start.
    if (process.platform === 'linux') return which('colormgr') ? colordRestoreSync(id, prev) : false;
    if (process.platform !== 'darwin') return false;
    const h = helperPath();
    if (!h) return false;
    execFileSync(h, prev ? ['set', String(id), prev] : ['reset', String(id)], { timeout: 10000 });
    return true;
  },
};

/** What this computer can do (shown in the settings). */
function support() {
  const ddc = process.platform === 'win32' ? { tool: 'dxva2', preset: true, brightness: true, tested: false }
    : process.platform === 'linux' && which('ddcutil') ? { tool: 'ddcutil', preset: true, brightness: true, tested: false }
      : process.platform === 'darwin' && which('m1ddc') ? { tool: 'm1ddc', preset: false, brightness: true, tested: false }
        : { tool: null, preset: false, brightness: false, tested: false };
  if (process.platform === 'darwin') {
    const h = helperPath();
    return { platform: 'darwin', profiles: !!h, tested: true, reason: h ? '' : 'helper lzs-colorsync missing (npm run build:helpers)', reasonCode: h ? '' : 'helperBuild', ddc };
  }
  if (process.platform === 'win32') return { platform: 'win32', profiles: true, tested: false, reason: 'unverified; needs Windows 10 build 20348 or later', reasonCode: 'windows', ddc };
  if (process.platform === 'linux') {
    return which('colormgr')
      ? { platform: 'linux', profiles: true, tested: false, reason: 'unverified; colord, takes effect only where the desktop applies colord profiles (GNOME; X11 with xiccd), not on KDE Plasma 6', reasonCode: 'linux', ddc }
      : { platform: 'linux', profiles: false, tested: false, reason: 'colord (colormgr) not installed', reasonCode: 'linuxNoColord', ddc };
  }
  return { platform: process.platform, profiles: false, tested: false, reason: 'profile switching only on macOS, Windows and Linux (colord)', reasonCode: 'platform', ddc };
}

function listProfiles() {
  const out = [];
  for (const d of PROFILE_DIRS[process.platform] || []) {
    const walk = (dir, depth) => {
      let items = [];
      try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of items) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && depth < 2) walk(p, depth + 1);
        else if (/\.ic[cm]$/i.test(e.name)) out.push({ name: e.name.replace(/\.ic[cm]$/i, ''), path: p });
      }
    };
    walk(d, 0);
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** DDC/CI: code 0x14 (colour preset) or 0x10 (brightness). Untested on all platforms. */
async function ddcSet(id, code, value) {
  if (![0x10, 0x14].includes(code) || !Number.isInteger(value) || value < 0 || value > 0xffff) throw coded('vcpInvalid', 'invalid VCP value');
  const s = support().ddc;
  if (s.tool === 'dxva2') return winPs(`[LzsDisp]::Vcp(${psStr(id)}, ${code}, ${value})`);
  if (s.tool === 'ddcutil') return run(which('ddcutil'), ['setvcp', code.toString(16), String(value), '--display', String(Number(id) || 1)]);
  if (s.tool === 'm1ddc' && code === 0x10) return run(which('m1ddc'), ['set', 'luminance', String(value)]);
  throw code === 0x14 ? coded('noPreset', 'colour preset (VCP 0x14) not available on this system') : coded('noDdcTool', 'no DDC/CI tool found');
}

class ProfileSwitcher {
  constructor(userData, plat = platform) {
    this.p = plat;
    this.file = path.join(userData, 'display-profile-backup.json');
    this.backup = {};
    try { this.backup = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { /* none */ }
  }
  save() {
    if (Object.keys(this.backup).length) fs.writeFileSync(this.file, JSON.stringify(this.backup, null, 2));
    else fs.rmSync(this.file, { force: true });
  }
  /** Leftovers from a crash: restore them. */
  async restoreLeftovers() { if (Object.keys(this.backup).length) await this.restore().catch(() => {}); }
  async list() { return (await this.p.list()).map((d) => ({ ...d, switched: String(d.id) in this.backup })); }
  async set(id, profile) {
    if (typeof profile !== 'string' || !/\.ic[cm]$/i.test(profile) || !fs.existsSync(profile)) throw coded('profileNotFound', 'profile not found');
    const key = String(id);
    if (!(key in this.backup)) {
      const d = (await this.p.list()).find((x) => String(x.id) === key);
      if (!d) throw coded('displayNotFound', 'display not found');
      // previous custom profile (null = factory) is stored BEFORE anything changes
      this.backup[key] = { previous: d.custom ?? null, name: d.name, at: new Date().toISOString() };
      this.save();
    }
    await this.p.set(id, profile);
    return this.list();
  }
  async restore(id) {
    for (const key of Object.keys(this.backup)) {
      if (id !== undefined && String(id) !== key) continue;
      const prev = this.backup[key].previous;
      const id2 = Number.isNaN(Number(key)) ? key : Number(key);
      if (prev) await this.p.set(id2, prev);
      else await this.p.reset(id2);
      delete this.backup[key];
      this.save();
    }
    return this.list();
  }
  restoreSync() {
    for (const key of Object.keys(this.backup)) {
      try { if (this.p.restoreSync(Number.isNaN(Number(key)) ? key : Number(key), this.backup[key].previous)) delete this.backup[key]; } catch { /* stays for the next start */ }
    }
    try { this.save(); } catch { /* ignore */ }
  }
}

/** Wire IPC: lzs:profile-* handlers. Returns the switcher (main.cjs restores it on quit). */
function setupDisplayProfiles(ipcMain, app) {
  const sw = new ProfileSwitcher(app.getPath('userData'));
  sw.restoreLeftovers();
  const wrap = (fn) => async (_e, ...a) => { try { return { ok: true, value: await fn(...a) } } catch (e) { return { ok: false, error: e.message, code: e.code } } };
  ipcMain.handle('lzs:profile-support', wrap(async () => support()));
  ipcMain.handle('lzs:profile-list', wrap(async () => ({ displays: await sw.list(), profiles: listProfiles() })));
  ipcMain.handle('lzs:profile-set', wrap((id, profile) => sw.set(id, profile)));
  ipcMain.handle('lzs:profile-restore', wrap((id) => sw.restore(id)));
  ipcMain.handle('lzs:ddc-set', wrap((id, code, value) => ddcSet(id, code, value)));
  app.on('will-quit', () => sw.restoreSync());
  return sw;
}

module.exports = { setupDisplayProfiles, ProfileSwitcher, listProfiles, support, helperPath, platform, parseColordDevices, parseObjectPath };
