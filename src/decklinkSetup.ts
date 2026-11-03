// Setup dialog for Blackmagic DeckLink/UltraStudio: the exact steps from "nothing installed" to
// "device found", with the state the bridge reports ticked off (GET /api/decklink). Opens when
// DeckLink… finds no usable device, and from the "Setup" button on a DeckLink source.
// The steps are the ones that made an UltraStudio Recorder 3G work on macOS 26 with Desktop
// Video 16.5 (docs/manual/inputs.md, "Setting up Blackmagic Desktop Video").

import { t } from './i18n';
import { bridgeText } from './i18n/bridgeMessage';
import { button, h, link, openModal, type Kid } from './ui';

export interface DeckLinkStatus {
  available: boolean;
  helper: boolean;
  platform?: string;
  /** macOS: state of the BlackmagicIO driver extension (server/index.mjs parseDriverExtension) */
  driverExtension?: 'enabled' | 'waiting' | 'missing' | 'unknown';
  devices: { index: number; name: string; formatDetection?: boolean; inputs?: string[]; input?: string }[];
  error?: string;
  code?: string;
}

export const DESKTOP_VIDEO_URL = 'https://www.blackmagicdesign.com/support/family/capture-and-playback';

type StepState = 'done' | 'next' | 'open';
/** body is built on demand: the step list itself needs no DOM (tests run in Node) */
interface Step { done: boolean; title: string; body: () => Kid[] }

/** Steps for the bridge's platform with their done flags (pure, tested). */
export function deckLinkSteps(st: DeckLinkStatus): Step[] {
  const mac = (st.platform ?? 'darwin') === 'darwin', win = st.platform === 'win32';
  const driver = st.helper && st.available;
  const found = st.devices.length > 0;
  const ext = found || st.driverExtension === 'enabled';
  const steps: Step[] = [
    { done: st.helper, title: t('dlsetup.helper'), body: () => [t('dlsetup.helperBody')] },
    {
      done: driver, title: t('dlsetup.install'),
      body: () => [t(mac ? 'dlsetup.installMac' : win ? 'dlsetup.installWin' : 'dlsetup.installLinux'), ' ', link(DESKTOP_VIDEO_URL, 'blackmagicdesign.com/support')],
    },
  ];
  if (mac) {
    steps.push({
      done: ext, title: t('dlsetup.approve'),
      body: () => [
        t('dlsetup.approveBody'),
        st.driverExtension === 'missing' && driver ? h('p', { class: 'hint' }, t('dlsetup.approveMissing')) : '',
        st.driverExtension === 'waiting' ? h('p', { class: 'hint' }, t('dlsetup.approveWaiting')) : '',
      ],
    });
  }
  steps.push({ done: found, title: t('dlsetup.connect'), body: () => [t(mac ? 'dlsetup.connectMac' : 'dlsetup.connectOther')] });
  return steps;
}

/** Done / the next one to do / later. */
export function stepStates(steps: { done: boolean }[]): StepState[] {
  const next = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => (s.done ? 'done' : i === next ? 'next' : 'open'));
}

/** Opens the setup dialog; `check` asks the bridge again, `onReady` gets the status once a device is found. */
export function openDeckLinkSetup(st: DeckLinkStatus, check: () => Promise<DeckLinkStatus | null>, onReady?: (st: DeckLinkStatus) => void) {
  const render = (s: DeckLinkStatus): Kid[] => {
    const steps = deckLinkSteps(s);
    const states = stepStates(steps);
    const n = states.filter((x) => x === 'done').length;
    const why = s.available ? '' : bridgeText(s, 'error');
    return [
      h('p', {}, s.devices.length ? t('dlsetup.ready', { name: s.devices.map((d) => d.name).join(', ') }) : t('dlsetup.intro')),
      h('progress', { class: 'dlsetup-progress', max: steps.length, value: n, 'aria-label': t('dlsetup.progress', { n, of: steps.length }) }),
      h('ol', { class: 'dlsetup-steps' }, steps.map((step, i) => h('li', { class: `dlsetup-${states[i]}` },
        h('span', { class: 'dlsetup-mark', 'aria-hidden': 'true' }, states[i] === 'done' ? '✓' : String(i + 1)),
        h('div', {}, h('strong', {}, step.title), states[i] === 'done' ? '' : h('div', { class: 'dlsetup-body' }, step.body()))))),
      why ? h('p', { class: 'hint' }, why) : '',
    ];
  };
  const recheck = button(t('dlsetup.recheck'), async () => {
    recheck.disabled = true;
    const s = await check();
    recheck.disabled = false;
    if (!s) return;
    m.setBody(...render(s));
    if (s.devices.length && onReady) { m.close(); onReady(s); }
  }, { variant: 'primary' });
  const m = openModal({ title: t('dlsetup.title'), size: 'md', cls: 'dlsetup', body: render(st), actions: [recheck] });
  return m;
}
