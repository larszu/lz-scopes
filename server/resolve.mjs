// Is DaVinci Resolve running on this (bridge) machine, and can we reach it?
//
// 1. Process list (cheap): macOS/Linux `pgrep -x Resolve|resolve`, Windows `tasklist`.
// 2. Only if it runs: server/resolve_helper.py --probe asks the scripting API for product,
//    project, timeline and page. scriptapp() returns nothing when external scripting is
//    off (Resolve Studio: Preferences > System > General > External scripting using:
//    None/Local/Network – Developer/Scripting/README.md of the Resolve installation).
//
// Resolve on another computer: its scripting listens on TCP 1144 when set to "Network"
// (same README), but ExportCurrentFrameAsStill writes the still on *that* machine. So a
// remote Resolve is used by running a bridge there (Bridge field of the app), not scanned.

import { spawn } from 'node:child_process';

/** Process names per platform (macOS: …/DaVinci Resolve.app/Contents/MacOS/Resolve). */
export function resolveProcessCheck(platform = process.platform) {
  if (platform === 'win32') return { cmd: 'tasklist', args: ['/FI', 'IMAGENAME eq Resolve.exe', '/NH', '/FO', 'CSV'], match: (out) => /"Resolve\.exe"/i.test(out) };
  return { cmd: 'pgrep', args: ['-x', platform === 'darwin' ? 'Resolve' : 'resolve'], match: (out) => /^\d+/m.test(out) };
}

/** stdout of a command; null = could not start; `timedOut` = killed after timeoutMs. */
function run(cmd, args, timeoutMs, info = {}) {
  return new Promise((ok) => {
    let p;
    try { p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }); } catch { return ok(null); }
    let out = '';
    const timer = setTimeout(() => { info.timedOut = true; p.kill('SIGKILL'); }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.on('error', () => { clearTimeout(timer); ok(null); });
    p.on('close', () => { clearTimeout(timer); ok(out); });
  });
}

/**
 * Turns the probe line into what the source list shows. `busy`: the probe got no answer in
 * time – the scripting API blocks while the timeline plays (#88, server/resolveWatch.mjs), so
 * the last known project/timeline (`last`) is kept instead of claiming Python is missing.
 */
export function resolveState(running, probe, busy = false, last = null) {
  if (!running) return { running: false };
  if (busy) return { ...(last?.scripting ? last : {}), running: true, scripting: true, busy: true };
  if (!probe) return { running: true, scripting: false, reason: 'python' };
  if (!probe.scripting) return { running: true, scripting: false, reason: probe.error ? 'module' : 'off', error: probe.error };
  const { scripting, ...rest } = probe;
  return { running: true, scripting, ...rest };
}

let cache = null;
let lastGood = null;
/**
 * { running, scripting, busy?, product?, version?, page?, project?, timeline?, tc?, fps?, reason? }
 * Cached 3 s – the source list polls it.
 */
export async function resolveStatus({ helper, python }) {
  if (cache && Date.now() - cache.t < 3000) return cache.v;
  const pc = resolveProcessCheck();
  const out = await run(pc.cmd, pc.args, 3000);
  const running = out != null && pc.match(out);
  let probe = null;
  const info = {};
  if (running) {
    for (const bin of python) {
      const line = await run(bin, ['-u', helper, '--probe'], 4000, info);
      if (line == null) continue;
      try { probe = JSON.parse(line.trim().split('\n').pop() ?? ''); } catch { probe = null; }
      break;
    }
  }
  const v = resolveState(running, probe, !!info.timedOut && !probe, lastGood);
  if (v.scripting && !v.busy) lastGood = v;
  cache = { t: Date.now(), v };
  return v;
}
