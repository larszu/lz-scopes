// Help → Send Feedback …: description, per-section consent, the exact report as preview,
// then e-mail (private) or GitHub issue (public). Nothing leaves the app before a send button.

import { button, checkbox, download, field, h, hint, kicker, openModal } from '../ui';
import { lang, t } from '../i18n';
import { logLines } from './log';
import { gpuAdvice, type GpuDevice } from './gpuAdvice';
import { SECTIONS, buildReport, fitForUrl, type FeedbackData, type Section, type SourceInfo } from './report';

export const FEEDBACK_MAIL = 'scopes@zumpelars.de';
const ISSUES = 'https://github.com/larszu/lz-scopes/issues/new';

export interface FeedbackHost {
  version: string;
  displayFps: () => number;
  panels: () => string[];
  sources: () => SourceInfo[];
  /** ffmpeg line of the bridge (version, origin), '' when unknown; false = bridge not reachable */
  bridge: () => Promise<string | false>;
}

interface SysInfo {
  os: string; arch: string; cpu: string; cores: number; ramGb: number; runtime: string;
  platform: string;
  gpu: { vendorId: number; deviceId: number; driver: string | null } | null;
  gpus: GpuDevice[];
  gpuFeatures: Record<string, string>;
  screens: { width: number; height: number; scale: number; hz: number; primary: boolean }[];
}
const desktop = () => (window as unknown as { lzsDesktop?: { sysinfo?: () => Promise<SysInfo> } }).lzsDesktop;

function webglRenderer(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
    if (!gl) return 'no WebGL';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const r = ext ? `${gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)} · ${gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)}` : String(gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return r;
  } catch { return ''; }
}

/** The desktop app's system snapshot (main process); null in the browser. */
export const desktopSysInfo = (): Promise<SysInfo | null> => desktop()?.sysinfo?.().catch(() => null) ?? Promise.resolve(null);

function adviceText(sys: SysInfo | null): string {
  const a = sys && gpuAdvice({ platform: sys.platform, gpus: sys.gpus ?? [], gpuFeatures: sys.gpuFeatures ?? {} });
  return !a ? '' : a.kind === 'software' ? 'software rendering' : `runs on ${a.active}, ${a.other} present`;
}

/** Header chip when the GPU slows the scopes down (Windows iGPU, software rendering). */
export async function checkGpu(show: (title: string, body: string[]) => void) {
  const sys = await desktopSysInfo();
  const a = sys && gpuAdvice({ platform: sys.platform, gpus: sys.gpus ?? [], gpuFeatures: sys.gpuFeatures ?? {} });
  if (!a) return;
  show(t('feedback.gpu.title'), a.kind === 'software'
    ? [t('feedback.gpu.software'), t('feedback.gpu.softwareFix')]
    : [t('feedback.gpu.integrated', { active: a.active, other: a.other }), t('feedback.gpu.integratedFix')]);
}

async function collect(host: FeedbackHost): Promise<FeedbackData> {
  const d = desktop();
  const sys = await desktopSysInfo();
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { getHighEntropyValues: (k: string[]) => Promise<Record<string, string>> } };
  let os = sys?.os ?? '';
  if (!os) {
    const ua = await nav.userAgentData?.getHighEntropyValues(['platform', 'platformVersion', 'architecture', 'fullVersionList']).catch(() => null);
    os = ua?.platform ? `${ua.platform} ${ua.platformVersion ?? ''}`.trim() : '';
  }
  const ios = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();
  const feats = sys?.gpuFeatures ? Object.entries(sys.gpuFeatures).filter(([k]) => /webgl|gpu_compositing|video_decode|rasterization|canvas/.test(k)).map(([k, v]) => `${k}=${v}`).join(', ') : '';
  const gpuIds = sys?.gpu ? ` (0x${sys.gpu.vendorId.toString(16)}:0x${sys.gpu.deviceId.toString(16)}${sys.gpu.driver ? `, driver ${sys.gpu.driver}` : ''})` : '';
  const screens = sys?.screens.map((s) => `${s.width}×${s.height} @${s.scale}x${s.hz ? ` · ${Math.round(s.hz)} Hz` : ''}${s.primary ? ' · primary' : ''}`)
    ?? [`${screen.width}×${screen.height} @${devicePixelRatio}x`];
  const bridge = await host.bridge();
  return {
    app: { version: host.version, platform: d ? 'desktop' : ios ? 'iOS app' : 'browser', lang: lang() },
    system: {
      os: os || navigator.userAgent, arch: sys?.arch, cpu: sys?.cpu, cores: sys?.cores ?? navigator.hardwareConcurrency,
      ramGb: sys?.ramGb ?? nav.deviceMemory, runtime: sys?.runtime ?? (os ? navigator.userAgent : ''),
    },
    display: { gpu: webglRenderer() + gpuIds, gpuFeatures: feats, advice: adviceText(sys), screens },
    performance: { displayFps: host.displayFps(), panels: host.panels(), sources: host.sources(), ffmpeg: bridge || '', bridge: bridge !== false },
    log: logLines(),
  };
}

const TITLES = (): Record<Section, string> => ({
  system: t('feedback.section.system'), display: t('feedback.section.display'),
  performance: t('feedback.section.performance'), log: t('feedback.section.log'),
});

export function openFeedback(host: FeedbackHost) {
  const on = new Set<Section>(SECTIONS);
  let data: FeedbackData | null = null;
  const desc = h('textarea', { rows: 3, placeholder: t('feedback.placeholder'), class: 'feedback-text', oninput: () => render() }) as HTMLTextAreaElement;
  const pre = h('pre', { class: 'feedback-report mono', tabindex: 0, 'aria-live': 'polite' }, t('feedback.collecting'));
  const status = hint('');
  const report = () => (data ? buildReport(data, { sections: on, description: desc.value, titles: TITLES() }) : '');
  const render = () => { if (data) pre.textContent = report(); };
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } };
  const subject = () => `${t('feedback.subject')} ${host.version}${desc.value.trim() ? ` – ${desc.value.trim().split('\n')[0].slice(0, 60)}` : ''}`;
  const send = async (url: (full: string) => string) => {
    const full = report(); if (!full) return;
    const copied = await copy(full);
    const u = url(full);
    // mailto as navigation: no empty tab in the browser; the desktop app hands it to the OS (will-navigate)
    if (u.startsWith('mailto:')) location.href = u; else window.open(u, '_blank', 'noopener');
    status.textContent = copied ? t('feedback.sentHint') : '';
  };

  const sections = SECTIONS.map((s) => h('div', { class: 'feedback-section' },
    checkbox(true, t(`feedback.section.${s}`), (v) => { if (v) on.add(s); else on.delete(s); render(); }),
    h('span', { class: 'hint' }, t(`feedback.section.${s}Hint`))));

  openModal({
    title: t('feedback.title'), id: 'feedback', cls: 'feedback', size: 'lg', sticky: true,
    body: [
      hint(t('feedback.intro')),
      field(t('feedback.description'), desc),
      kicker(t('feedback.include')),
      ...sections,
      hint(t('feedback.never')),
      kicker(t('feedback.preview')),
      pre,
      hint(t('feedback.githubWarn')),
      status,
    ],
    actions: [
      button(t('feedback.copy'), async () => { if (await copy(report())) status.textContent = t('feedback.copied'); }, { variant: 'ghost' }),
      button(t('feedback.save'), () => download(`lz-scopes-feedback-${new Date().toISOString().slice(0, 10)}.txt`, report()), { variant: 'ghost' }),
      button(t('feedback.github'), () => send((full) => `${ISSUES}?${new URLSearchParams({ title: subject(), body: fitForUrl(full, 7000, t('feedback.cut')) })}`), { title: t('feedback.githubTitle') }),
      // mail programs on Windows cut mailto links at about 2000 characters
      button(t('feedback.mail'), () => send((full) => `mailto:${FEEDBACK_MAIL}?subject=${encodeURIComponent(subject())}&body=${encodeURIComponent(fitForUrl(full, 1800, t('feedback.cut')))}`), { variant: 'primary', title: t('feedback.mailTitle', { to: FEEDBACK_MAIL }) }),
    ],
  });
  desc.focus();
  collect(host).then((d) => { data = d; render(); }).catch((e) => { pre.textContent = String(e); });
}
