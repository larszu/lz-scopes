// Performance test (#245): Help → Performance test … measures this computer while the current
// layout runs, so a tester's report says where the time goes instead of "it feels slow":
//   display  animation frames per second, slow frames, main-thread long tasks
//   GPU      a synthetic trace: how long one 1080p waveform (2 million points) takes to draw
//   CPU      one pass over a 16-bit 1080p frame in JavaScript (the statistics path)
//   sources  pictures received and dropped per second during the test
//   bridge   what one 1080i50 picture costs ffmpeg (server/bench.mjs)
// The verdict names the bottleneck; the text report goes into the clipboard or the feedback.

import { t } from './i18n';
import { button, h, openModal } from './ui';

export interface PerfSource { name: string; fps: number; dropped: number; width: number; height: number; latency: string }
export interface PerfHost {
  sources(): PerfSource[];
  panels(): string[];
  bridgeHttp(): string;
  version: string;
}
export interface BenchCase { label: string; width: number; depth: number; msPerFrame: number }
export interface PerfResult {
  displayFps: number; frameP95: number; slowFrames: number; longTaskMs: number; seconds: number;
  gpu: string; gpuMsPer2M: number; cpuMsPerFrame: number;
  sources: { name: string; fpsIn: number; droppedPerS: number; size: string; latency: string }[];
  panels: string[];
  bridge: { generateMs: number; cases: BenchCase[] } | { error: string } | null;
  cores: number; memoryGb: number | null; dpr: number; screen: string;
}

/** Percentile of a list (0…1). */
export function percentile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

export type Finding = { level: 'ok' | 'warn' | 'bad'; key: string; params?: Record<string, string | number> };

/** What limits this computer, most important first (pure, tested in test/perfTest.test.ts). */
export function verdict(r: PerfResult): Finding[] {
  const out: Finding[] = [];
  const fps = r.displayFps;
  out.push({ level: fps >= 45 ? 'ok' : fps >= 25 ? 'warn' : 'bad', key: 'perf.v.display', params: { fps } });
  // a 1080p waveform per panel and frame: the GPU budget at 50 fps is 20 ms for everything
  const gpuLoad = r.gpuMsPer2M * Math.max(1, r.panels.length);
  if (r.gpuMsPer2M > 0) out.push({ level: gpuLoad < 10 ? 'ok' : gpuLoad < 20 ? 'warn' : 'bad', key: 'perf.v.gpu', params: { ms: round(r.gpuMsPer2M), n: r.panels.length, total: round(gpuLoad) } });
  if (/swiftshader|software|llvmpipe|basic render/i.test(r.gpu)) out.push({ level: 'bad', key: 'perf.v.software' });
  if (r.longTaskMs / Math.max(1, r.seconds) > 200) out.push({ level: 'bad', key: 'perf.v.mainThread', params: { ms: Math.round(r.longTaskMs / Math.max(1, r.seconds)) } });
  if (r.cpuMsPerFrame > 8) out.push({ level: 'warn', key: 'perf.v.cpu', params: { ms: round(r.cpuMsPerFrame) } });
  for (const s of r.sources) {
    if (s.droppedPerS > 1) out.push({ level: 'warn', key: 'perf.v.dropped', params: { name: s.name, n: round(s.droppedPerS) } });
  }
  if (r.bridge && 'cases' in r.bridge) {
    const c960 = r.bridge.cases.find((c) => c.width === 960 && c.depth === 16), full = r.bridge.cases.find((c) => c.width === 1920 && c.depth === 16);
    if (c960) out.push({ level: c960.msPerFrame < 12 ? 'ok' : c960.msPerFrame < 20 ? 'warn' : 'bad', key: 'perf.v.bridge', params: { ms: round(c960.msPerFrame) } });
    if (full && full.msPerFrame < 15) out.push({ level: 'ok', key: 'perf.v.native', params: { ms: round(full.msPerFrame) } });
  } else if (r.bridge && 'error' in r.bridge) out.push({ level: 'warn', key: 'perf.v.noBridge' });
  return out;
}
const round = (x: number) => Math.round(x * 10) / 10;

/** Plain-text report (clipboard, feedback). */
export function perfReport(r: PerfResult, version: string): string {
  const lines = [
    `LZ Scopes ${version} · ${t('perf.title')}`,
    `${t('perf.r.display')}: ${r.displayFps} fps · p95 ${round(r.frameP95)} ms · ${r.slowFrames} > 50 ms · long tasks ${Math.round(r.longTaskMs)} ms / ${r.seconds} s`,
    `GPU: ${r.gpu} · ${round(r.gpuMsPer2M)} ms / 2 M points`,
    `CPU: ${r.cores} threads${r.memoryGb ? ` · ${r.memoryGb} GB` : ''} · ${round(r.cpuMsPerFrame)} ms / 16-bit 1080p pass`,
    `${t('perf.r.screen')}: ${r.screen} · DPR ${r.dpr}`,
    `Panels: ${r.panels.join(', ') || '–'}`,
    ...r.sources.map((s) => `${t('perf.r.source')} ${s.name}: ${s.size} · ${round(s.fpsIn)} fps in · ${round(s.droppedPerS)} dropped/s · ${s.latency}`),
  ];
  if (r.bridge && 'cases' in r.bridge) lines.push(`ffmpeg 1080i50 10-bit 4:2:2 → ${r.bridge.cases.map((c) => `${c.label} ${round(c.msPerFrame)} ms`).join(' · ')} (test signal ${round(r.bridge.generateMs)} ms incl.)`);
  else if (r.bridge) lines.push(`ffmpeg: ${r.bridge.error}`);
  lines.push('', ...verdict(r).map((f) => `[${f.level}] ${t(f.key as never, f.params as never)}`));
  return lines.join('\n');
}

/** Synthetic trace like the scatter shader: `points` additive points into a 960×540 target. */
function gpuBench(points = 2_000_000): { gpu: string; ms: number } {
  const c = document.createElement('canvas');
  c.width = 960; c.height = 540;
  const gl = c.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false });
  if (!gl) return { gpu: 'WebGL2 unavailable', ms: 0 };
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, `#version 300 es
    void main() { uint i = uint(gl_VertexID); uint x = i % 1920u, y = i / 1920u;
      float v = fract(sin(float(i) * 12.9898) * 43758.5453);
      gl_Position = vec4(float(x) / 960.0 - 1.0, v * 2.0 - 1.0, 0.0, 1.0); gl_PointSize = 1.0; }`));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float; out vec4 o; void main() { o = vec4(0.002); }`));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
  const px = new Uint8Array(4);
  const once = () => { gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.POINTS, 0, points); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  once(); // warm-up (shader compile, driver)
  const runs: number[] = [];
  for (let i = 0; i < 8; i++) { const t0 = performance.now(); once(); runs.push(performance.now() - t0); }
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { gpu, ms: percentile(runs, 0.5) };
}

/** One JavaScript pass over a 16-bit RGBA 1080p frame (sum of luma), median of five. */
function cpuBench(): number {
  const n = 1920 * 1080, px = new Uint16Array(n * 4);
  for (let i = 0; i < px.length; i += 97) px[i] = i & 0xffff;
  const runs: number[] = [];
  let sink = 0;
  for (let k = 0; k < 5; k++) {
    const t0 = performance.now();
    let s = 0;
    for (let i = 0; i < n; i++) { const j = i * 4; s += px[j] * 0.2126 + px[j + 1] * 0.7152 + px[j + 2] * 0.0722; }
    sink += s;
    runs.push(performance.now() - t0);
  }
  if (sink === -1) console.log(sink);
  return percentile(runs, 0.5);
}

/** Measures for `seconds` while the app keeps running, then the synthetic parts. */
export async function runPerfTest(host: PerfHost, seconds = 8, progress: (f: number) => void = () => {}): Promise<PerfResult> {
  const before = new Map(host.sources().map((s) => [s.name, s]));
  const frames: number[] = [];
  let longTaskMs = 0;
  let obs: PerformanceObserver | null = null;
  try { obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) longTaskMs += e.duration; }); obs.observe({ type: 'longtask', buffered: false }); } catch { obs = null; }
  const t0 = performance.now();
  await new Promise<void>((done) => {
    let last = t0;
    const tick = (now: number) => {
      frames.push(now - last); last = now;
      progress(Math.min(0.8, ((now - t0) / (seconds * 1000)) * 0.8));
      if (now - t0 < seconds * 1000) requestAnimationFrame(tick); else done();
    };
    requestAnimationFrame(tick);
  });
  obs?.disconnect();
  const span = (performance.now() - t0) / 1000;
  const after = host.sources();
  const sources = after.map((s) => {
    const b = before.get(s.name);
    return { name: s.name, fpsIn: s.fps, droppedPerS: b ? Math.max(0, s.dropped - b.dropped) / span : 0, size: s.width ? `${s.width}×${s.height}` : '–', latency: s.latency };
  });
  progress(0.85);
  const g = gpuBench();
  const cpu = cpuBench();
  progress(0.9);
  let bridge: PerfResult['bridge'] = null;
  try {
    const r = await fetch(`${host.bridgeHttp()}/api/bench`);
    bridge = r.ok ? await r.json() : { error: `HTTP ${r.status}` };
  } catch (e) { bridge = { error: (e as Error).message }; }
  progress(1);
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    displayFps: Math.round(frames.length / span), frameP95: percentile(frames.slice(1), 0.95), slowFrames: frames.filter((f) => f > 50).length,
    longTaskMs, seconds: Math.round(span), gpu: g.gpu, gpuMsPer2M: g.ms, cpuMsPerFrame: cpu, sources, panels: host.panels(), bridge,
    cores: navigator.hardwareConcurrency ?? 0, memoryGb: nav.deviceMemory ?? null, dpr: devicePixelRatio, screen: `${screen.width}×${screen.height}`,
  };
}

/** Help → Performance test …: start, progress, verdict, copy. */
export function openPerfTest(host: PerfHost, sendFeedback?: (text: string) => void) {
  const bar = h('progress', { max: 1, value: 0, class: 'perf-progress' }) as HTMLProgressElement;
  const out = h('div', { class: 'perf-out' });
  let report = '';
  const copy = button(t('perf.copy'), () => { void navigator.clipboard?.writeText(report); }, { disabled: true });
  const send = sendFeedback ? button(t('perf.send'), () => { m.close(); sendFeedback(report); }, { disabled: true }) : null;
  const start = button(t('perf.start'), () => void go(), { variant: 'primary' });
  const m = openModal({
    title: t('perf.title'), size: 'lg', sticky: true,
    body: [h('p', { class: 'hint' }, t('perf.intro')), bar, out],
    actions: [start, copy, send].filter(Boolean) as HTMLElement[],
  });
  async function go() {
    (start as HTMLButtonElement).disabled = true;
    out.replaceChildren(h('p', {}, t('perf.running')));
    const r = await runPerfTest(host, 8, (f) => (bar.value = f));
    report = perfReport(r, host.version);
    out.replaceChildren(
      h('ul', { class: 'perf-verdict' }, ...verdict(r).map((f) => h('li', { class: `perf-${f.level}` }, t(f.key as never, f.params as never)))),
      h('details', {}, h('summary', {}, t('perf.details')), h('pre', { class: 'perf-report' }, report)),
    );
    (start as HTMLButtonElement).disabled = false;
    (copy as HTMLButtonElement).disabled = false;
    if (send) (send as HTMLButtonElement).disabled = false;
  }
}
