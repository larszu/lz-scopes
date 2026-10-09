import './vendor/dockview.css';
import {
  $, button, checkbox, chip, field, filePicker, groupedSelect, h, hint, iconButton, download, modal, numberInput, openModal, popover, row,
  link, segmented, select, settingControl, settingRow, settingsForm, slider, statusDot, table, textInput, applySetting, describeSettings, kicker, type Kid, type Option, type PopoverEl, type Setting,
} from './ui';
import './style.css';
import { DEFAULT_SCHEME, DEFAULT_THEME, SCHEMES, THEMES, applyScheme, applyTheme, currentSignet, isScheme, isTheme, type SchemePref, type UiTheme } from './theme';
import { DISPLAY_LABELS, FALSE_COLOR_PRESETS, falseColorName, GAMUTS, HDR_PREVIEW_LABELS, HLG_PEAKS, LUMA, detectDisplay, transferLabel, type DisplaySpace, type GamutId, type HdrPreview } from './color';
import { CAMERA_GAMUTS, LOG_CURVES } from './camera';
import {
  CAMERA_PRESETS, CST_TARGETS, DEFAULT_CST, STAGES, STAGE_LABELS, TONEMAP_LABELS, autoPeaks, stageNote,
  type ChainSettings, type CstSettings, type Stage, type ToneMap,
} from './chain';
import { LUT_EXTENSIONS, LUTS, addLutFile, ensureLut, lutListeners, recentLuts } from './lut';
import { LUT_SOURCES } from './lutLibrary';
import { CHANNEL_PAIRS, SCOPE_LABELS, isAudio, isWaveform, plotRect, type ScopeType, type Unit, type VectorTarget, WAVE_ZOOM_LABELS, channelsOf, waveLevel, type WaveZoom } from './graticule';
import { DEFAULT_SKIN, ROI_CLOSE, contentRect, defaultPanel as panel, drawPanel, panelSignature, panelView, roiCloseBox, setPanelView, viewLimits, waveRangeOf, type DrawOptions, type PanelState, type Tint } from './panel';
import { attachGestures } from './gestures';
import { IDENTITY, classifyWheel, isIdentity, zoomLabel } from './view';
import type { OutputHost, OutputWindowApi } from './outputView';
import { defaultScene, findScene, newId, sanitizeScenes, type OverlayScene } from './scene';
import { connectRemote } from './remote';
import { DEFAULT_QC, QC_LABELS, QC_TYPES, evaluate as evaluateQc, frameFingerprint, qcLog, toCsv, type QcSettings } from './qclog';
import { GRIDS } from './history';
import { CUBE_SPACE_LABELS, DEFAULT_CUBE, type CubeSettings, type CubeSpace } from './cube';
import { DEFAULT_CRT, PERSIST_CHOICES, PHOSPHORS, type CrtSettings, type Phosphor } from './crt';
import type { Command } from '../server/control.mjs';
import type { GenConfig } from './audio/dsp/signals';
import { audioPanelSettings, audioRow, audioSourceControls, mountGenerator } from './audio/ui';
import { setClockHooks } from './clock/panel';
import { genlockPanelSettings, setGenlockBridge } from './genlock';
import { clockPanelSettings } from './clock/ui';
import { generator } from './audio/io';
import { PATTERNS, RESOLUTIONS, patternById } from './patterns';
import { addUserImages, favouritePatterns, isFavourite, loadUserPatterns, onUserPatternsChange, setFavourite } from './userPatterns';
import { openTestImages, openTestVideos, type TestMediaHost } from './testMedia';
import { PRESETS, createDock, panelId, panelIdx } from './dock';
import { applySysProfile, sysProfileAvailable, sysProfileSection } from './sysprofile';
import { openLedTool } from './led/ui';
import { mountOpple } from './opple/ui';
import { isLight, LIGHT_SCOPES, lightPanelSettings } from './opple/panelSettings';
import { ledSettings, pictureSize } from './led/wall';
import { Renderer, type PictureMode, type SkinRange } from './renderer';
import { GREEN_DEFAULT } from './match/core';
import { greenSettings, matchPanelSettings, targetEditor, type MatchUi } from './match/ui';
import { bindBridgeField, normaliseBridge } from './bridgeField';
import { streamRoute } from './streamRoute';
import { deckLinkButton, deckLinkRow, decodeRow, deviceButton, deviceRow as bridgeDeviceRow, ndiButton, ndiRow, folderButton, STILL_WORKFLOW, type BridgeUi } from './bridgeInputs';
import { LatencyMeter } from './latency';
import { debugFlags } from './frameLink';
import { DEFAULT_LOW_LATENCY, LL_STATS, LL_WIDTHS, describeLowLatency, effectiveWidth, type LowLatencyConfig } from './lowLatency';
import { mountResolveLive } from './resolveLive';
import { attachResolvePlayback, isLocalHost, routeText } from './resolvePlayback';
import { openManual } from './manual';
import { Source, type AudioInput, type SourceKind, type SourceSettings } from './sources';
import { bridgeFfmpegText, fetchBridgeHealth, pushFfmpegText, sourceFfmpegText, type BridgeHealth } from './ffmpegInfo';
import { SOURCE_ITEMS, mountMenu, refreshMenu, registerMenuCommand, type MenuActions, type MenuState } from './menu/appMenu';
import { openSettings, refreshSettings, registerSettingsSection } from './menu/settings';
import { aboutSection, keysSection } from './menu/pages';
import { LANG_NAMES, LANGS, lang, langPref, num, setLangPref, systemLang, t, type LangPref } from './i18n';
import { ShadingControl, SIM_URL } from './shading/ui';
import { T as SHADING_T } from './shading/text';
import { installFeedbackLog } from './feedback/log';
import { checkGpu, openFeedback } from './feedback/dialog';
import { hasHelp, helpCard, helpOn, setHelpOn } from './help/scopeHelp';

installFeedbackLog();
declare const __APP_VERSION__: string | undefined;

// ---------------------------------------------------------------- state

type PatternState = Source['pattern'];
interface Persisted {
  layout: string; panels: PanelState[]; unit: Unit; tint: Tint; falsePreset: string;
  zebra: number; zebraLow: number; maxSamples: number; bridge: string; sidebar: boolean;
  skin: SkinRange; display: 'auto' | DisplaySpace;
  /** green/grass qualifier (#55, match/core.ts GREEN_DEFAULT) */
  green?: SkinRange;
  /** picture view: HDR/log → SDR down-mapping */
  hdrPreview?: HdrPreview;
  /** UI skin (Oberfläche); chrome only, never the measurement colours */
  theme: UiTheme;
  /** light or dark chrome (src/theme.ts); the scopes stay dark */
  scheme?: SchemePref;
  targets: VectorTarget[];
  /** default measuring stage in the CST/LUT chain (panels can override) */
  stage?: Stage;
  /** dockview layout (toJSON) */
  dock?: unknown;
  /** overlay scenes of the output windows (#1) and the one new overlay outputs use */
  scenes: OverlayScene[]; activeScene: string;
  /** name of the last loaded layout configuration ('' after a preset) */
  layoutName: string;
  sources: { kind: SourceKind; name: string; url: string; settings: SourceSettings; pattern?: PatternState; audioIn?: AudioInput }[];
  /** tone generator settings (never saved as running) and output device */
  gen?: Partial<GenConfig>;
  genSink?: string;
  /** QC log thresholds (qclog.ts) */
  qc?: Partial<QcSettings>;
  /** ΔE reference at the probe point (panel.ts deLines) */
  deRef?: string;
  /** low-latency mode for all bridge streams without their own setting (docs/research/low-latency.md) */
  lowLatency?: boolean;
  /** global low-latency settings (src/lowLatency.ts) */
  ll?: Partial<LowLatencyConfig>;
}

const DEFAULT_SCOPES: ScopeType[] = ['picture', 'wf-luma', 'vector', 'parade', 'hist', 'cie', 'stats', 'yrgb', 'ycbcr'];
const STORE_KEY = 'lz-scopes.v1';

function load(): Persisted {
  const base: Persisted = {
    layout: 'lc', panels: DEFAULT_SCOPES.map(panel), unit: 'percent', tint: 'green', falsePreset: 'ARRI', zebra: 0.95, zebraLow: 0,
    maxSamples: 1_000_000, bridge: '', sidebar: true, skin: { ...DEFAULT_SKIN }, display: 'auto', theme: DEFAULT_THEME, targets: [], scenes: [defaultScene()], activeScene: '', layoutName: '',
    sources: [{ kind: 'pattern', name: t('main.pattern.title'), url: '', settings: { transfer: 'auto', colorspace: 'auto', width: 960, fps: 0, depth: 8, transport: 'tcp' }, pattern: { id: 'smpte75-lz', width: 1920, height: 1080, label: '' } }],
  };
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    if (s && Array.isArray(s.panels)) return { ...base, ...s, scenes: sanitizeScenes(s.scenes), layout: s.layout in PRESETS ? s.layout : base.layout, panels: [...DEFAULT_SCOPES, ...Array(Math.max(0, s.panels.length - DEFAULT_SCOPES.length)).fill('wf-luma')].map((d, i) => ({ ...panel(d as ScopeType), ...s.panels[i] })) };
  } catch { /* storage unavailable */ }
  return base;
}

const state = load();
Source.globalLowLatency = !!state.lowLatency;
Source.globalLowLatencyConfig = state.ll ?? {};
// the render loop reports its draws to the latency meters (stamp → drawn, src/latency.ts)
LatencyMeter.drawHook = true;
if (!isTheme(state.theme)) state.theme = DEFAULT_THEME;
if (!isScheme(state.scheme)) state.scheme = DEFAULT_SCHEME;
applyTheme(state.theme);
applyScheme(state.scheme);
const detected = detectDisplay();
const sources: Source[] = [];
let frozen = false;
let fpsFrames = 0, displayFps = 0, fpsT = performance.now();

function save() {
  const p: Persisted = {
    ...state,
    sources: sources.filter((s) => s.kind === 'stream' || s.kind === 'pattern' || s.kind === 'audio')
      .map((s) => ({ kind: s.kind, name: s.name, url: s.url, settings: s.settings, pattern: s.pattern, ...(s.kind === 'audio' ? { audioIn: s.audioIn } : {}) })),
  };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

const bridgeUrl = () => {
  const b = state.bridge.trim();
  if (b) return b.replace(/^http/, 'ws').replace(/\/$/, '');
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
};
setClockHooks(() => sources, bridgeUrl);
setGenlockBridge(bridgeUrl);

// ---------------------------------------------------------------- DOM

const app = $('#app');
// shown when the GPU slows the scopes down (Windows: integrated GPU next to a dedicated one; software rendering)
const gpuWarn = button(t('feedback.gpu.chip'), () => {}, { small: true, attrs: { id: 'gpu-warn', class: 'btn mini warn', hidden: true } });
checkGpu((title, body) => {
  gpuWarn.title = body[0];
  gpuWarn.onclick = () => openModal({ title, size: 'sm', body: body.map((p) => h('p', {}, p)) });
  gpuWarn.hidden = false;
}).catch(() => {});
const freezeBtn = button(t('main.freeze'), () => toggleFreeze(), { title: t('main.freezeTitle'), pressed: false, attrs: { id: 'freeze' } });
const sideToggle = iconButton('◧', t('main.side.aria'), () => toggleSidebar(), { title: t('main.side.toggle'), attrs: { id: 'toggle-side' } });
/** Header overflow (narrow windows): the same layout presets and scale as the header groups. */
const moreMenu = popover({ label: '⋯', title: t('ui.more'), heading: t('ui.moreTitle'), cls: 'more-body', content: () => [field(t('ui.layouts'), layoutControl()), settingRow(SET.unit)] });
moreMenu.id = 'bar-more';
const side = h('aside', { class: 'side', id: 'side' },
  h('h2', {}, t('main.sources')),
  h('div', { id: 'source-list' }),
  h('div', { class: 'resolve-live', id: 'resolve-live', hidden: true }),
  h('div', { class: 'add', id: 'add' }),
  h('details', { class: 'gen', id: 'gen-wrap' }, h('summary', {}, t('main.toneGen')), h('div', { id: 'gen' })),
  h('details', { class: 'gen', id: 'opple-wrap' }, h('summary', {}, t('main.lightMeter')), h('div', { id: 'opple' })));
app.replaceChildren(
  h('header', { class: 'bar' },
    h('div', { class: 'brand', title: 'LZ Scopes · Lars Zumpe Medienproduktion' },
      h('img', { class: 'signet', src: currentSignet(), alt: 'Lars Zumpe Medienproduktion', width: 33, height: 20 }), h('span', { class: 'product' }, 'Scopes')),
    h('div', { id: 'menubar' }),
    h('div', { class: 'tools' },
      sideToggle,
      h('div', { class: 'group', id: 'layouts' }),
      h('div', { class: 'group', id: 'globals' }),
      moreMenu),
    h('div', { class: 'spacer' }),
    h('span', { class: 'fps', id: 'fps', title: t('main.fpsTitle') }),
    gpuWarn,
    freezeBtn,
    iconButton('⚙', t('common.settings'), () => openSettings(), { title: t('main.settingsTitle'), attrs: { id: 'settings-btn' } }),
    iconButton('⛶', t('main.full'), () => toggleFullscreen(), { title: t('main.fullTitle'), attrs: { id: 'full' } })),
  h('div', { class: 'main' },
    side,
    // narrow windows: tapping next to the sources drawer closes it
    h('div', { class: 'side-scrim', title: t('ui.closeSidebar'), onclick: () => toggleSidebar(false) }),
    h('section', { class: 'dockwrap', id: 'grid' }, h('canvas', { id: 'gl' }), h('div', { id: 'dock' }))));

const grid = $('#grid');
const glCanvas = $<HTMLCanvasElement>('#gl');
let renderer: Renderer;
try {
  // every panel is copied into its own canvas right after drawing (drawAll): no kept buffer needed.
  // Debug switch {"preserveBuffer":true} for comparisons on Windows.
  renderer = new Renderer(glCanvas, { preserve: debugFlags().preserveBuffer === true });
} catch (e) {
  grid.replaceChildren(h('div', { class: 'fatal' }, (e as Error).message));
  throw e;
}

// ---------------------------------------------------------------- global settings (one description, three views)
// Each global setting is described once (src/ui/schema.ts) and rendered from that description
// in the settings window, in the panel ⚙ popovers that show it, and offered to the control API
// (command "setting", docs/control-api.md).

const UNIT_OPTIONS = (): Option[] => [['percent', '%'], ['bit8', '8 bit'], ['bit10', '10 bit'], ['nits', t('settings.scopes.nitsScene')]];
const TINT_OPTIONS = (): Option[] => [['green', t('settings.scopes.green')], ['white', t('settings.scopes.white')], ['amber', t('settings.scopes.amber')]];
const SET = {
  lang: { key: 'lang', kind: 'select', label: () => t('lang.label'), title: () => t('lang.title'), hint: () => t('lang.hint'),
    options: () => [['auto', t('lang.auto', { lang: LANG_NAMES[systemLang()] })], ...LANGS.map((l) => [l, LANG_NAMES[l]] as Option)],
    get: () => langPref(), set: (v) => { try { sessionStorage.setItem(REOPEN_SETTINGS, 'ui'); } catch { /* ignore */ } setLangPref(v as LangPref); } },
  theme: { key: 'theme', kind: 'select', label: () => t('settings.ui.skin'), title: () => t('settings.ui.skinTitle'), hint: () => t('settings.ui.skinHint'),
    options: () => THEMES, get: () => state.theme, set: (v) => { if (isTheme(v)) setTheme(v); } },
  scheme: { key: 'scheme', kind: 'select', label: () => t('ui.scheme'), title: () => t('ui.scheme.title'), hint: () => t('ui.scheme.hint'),
    options: SCHEMES, get: () => state.scheme ?? DEFAULT_SCHEME, set: (v) => { if (isScheme(v)) { state.scheme = v; applyScheme(v); save(); } } },
  sidebar: { key: 'sidebar', kind: 'toggle', label: () => t('settings.ui.sidebar'), text: () => t('settings.ui.sidebarShow'),
    get: () => state.sidebar, set: (v) => { state.sidebar = v; applySidebar(); save(); } },
  display: { key: 'display', kind: 'select', label: () => t('settings.display'), title: () => t('settings.display.spaceTitle'), hint: () => t('settings.display.spaceHint'),
    options: () => [['auto', `auto: ${DISPLAY_LABELS[detected.space]}${detected.hdr ? t('settings.display.hdrCapable') : ''}`], ...(Object.entries(DISPLAY_LABELS) as Option[])],
    get: () => state.display, set: (v) => setDisplaySpace(v as Persisted['display']) },
  hdrPreview: { key: 'hdrPreview', kind: 'select', label: () => t('settings.display.hdrPreview'), title: () => t('settings.display.hdrTitle'), hint: () => t('settings.display.hdrHint'),
    options: () => Object.entries(HDR_PREVIEW_LABELS) as Option[], get: () => state.hdrPreview ?? 'bt2408', set: (v) => { state.hdrPreview = v as HdrPreview; save(); renderHeader(); } },
  unit: { key: 'unit', kind: 'select', label: () => t('settings.scopes.scale'), title: () => t('main.unitTitle'),
    options: UNIT_OPTIONS, get: () => state.unit, set: (v) => { state.unit = v as Unit; save(); renderHeader(); } },
  tint: { key: 'tint', kind: 'select', label: () => t('settings.scopes.tint'), options: TINT_OPTIONS, get: () => state.tint, set: (v) => { state.tint = v as Tint; save(); } },
  precision: { key: 'precision', kind: 'select', label: () => t('settings.scopes.precision'), title: () => t('settings.scopes.samplesTitle'),
    options: () => [['250000', t('settings.scopes.fast')], ['1000000', t('settings.scopes.standard')], ['4000000', t('settings.scopes.full')]],
    get: () => String(state.maxSamples), set: (v) => { state.maxSamples = Number(v); save(); } },
  falseColour: { key: 'falseColour', kind: 'select', label: () => t('settings.scopes.falseColour'),
    options: () => Object.keys(FALSE_COLOR_PRESETS).map((k) => [k, falseColorName(k)] as Option), get: () => state.falsePreset, set: (v) => { state.falsePreset = v; save(); } },
  skinLuma: { key: 'skinLuma', kind: 'range', label: () => t('settings.scopes.skinLuma'), min: 0, max: 100, unit: '%',
    get: () => [Math.round(state.skin.lo * 100), Math.round(state.skin.hi * 100)], set: ([lo, hi]) => { state.skin.lo = lo / 100; state.skin.hi = hi / 100; save(); } },
  skinHue: { key: 'skinHue', kind: 'number', label: () => t('settings.scopes.skinHue'), min: 2, max: 45, unit: '°',
    get: () => state.skin.tol, set: (v) => { state.skin.tol = v; save(); } },
  zebra: { key: 'zebra', kind: 'number', label: () => t('settings.scopes.zebra'), min: 50, max: 109, unit: '%',
    get: () => Math.round(state.zebra * 100), set: (v) => { state.zebra = v / 100; save(); } },
  stage: { key: 'stage', kind: 'select', label: () => t('settings.stage.point'), title: () => t('settings.stage.defaultTitle'), hint: () => t('settings.stage.hint'),
    options: () => STAGES.map((st) => [st, STAGE_LABELS[st]] as Option), get: () => state.stage ?? 'signal', set: (v) => setStage(v as Stage) },
  deRef: { key: 'deRef', kind: 'select', label: () => t('settings.stage.deAt'), title: () => t('settings.stage.deTitle'), hint: () => t('settings.stage.deHint'),
    options: () => [['off', t('common.off')], ['bars', t('settings.stage.deBars')], ['targets', t('settings.stage.deTargets')], ...state.targets.map((tg) => [`target:${tg.name}`, t('settings.stage.deTarget', { name: tg.name })] as Option)],
    get: () => state.deRef ?? 'off', set: (v) => { state.deRef = v; save(); } },
  lowLatency: { key: 'lowLatency', kind: 'select', label: () => 'Low Latency', title: () => LOW_LATENCY_HINT,
    options: () => [['0', t('common.off')], ['1', t('settings.latency.onAll')]], get: () => (state.lowLatency ? '1' : '0'), set: (v) => setGlobalLowLatency(v === '1') },
} satisfies Record<string, Setting>;
/** Settings the control API may read and set (all of them except the language, which reloads the window). */
const REMOTE_SETTINGS: Setting[] = Object.values(SET).filter((s) => s.key !== 'lang');

// ---------------------------------------------------------------- header

/** Layout presets as one segmented control, plus "add panel". */
function layoutControl() {
  return h('span', { class: 'toolbar' },
    segmented(state.layout, Object.entries(PRESETS).map(([k, l], i) => [k, l.label, t('main.layoutTitle', { name: l.label, n: i + 1 })] as const), (k) => setLayout(k), t('ui.layouts')),
    button(t('main.addPanelBtn'), () => addScopePanel(), { title: t('main.addPanel') }));
}

function renderHeader() {
  $('#layouts').replaceChildren(layoutControl());
  $('#globals').replaceChildren(...settingControl(SET.unit));
  moreMenu.refresh();
  refreshMenu();
  refreshSettings();
}

// ---------------------------------------------------------------- settings window (#53)
// Global settings live in one window (Einstellungen …, Cmd/Ctrl+,); panel options stay in ⚙.

registerSettingsSection({ id: 'ui', label: t('settings.ui'), order: 10, render: () => settingsForm([SET.lang, SET.theme, SET.scheme, SET.sidebar]) });

registerSettingsSection({ id: 'display', label: t('settings.display'), order: 20, render: () => [
  ...settingsForm([SET.display, SET.hdrPreview]),
  field('', button(t('settings.display.calib'), openCalibrationDialog, { title: t('settings.display.calibTitle') })),
  ...(sysProfileAvailable() ? [sysProfileSection(() => (state.display === 'auto' ? null : state.display))] : []),
] });

registerSettingsSection({ id: 'scopes', label: t('settings.scopes'), order: 30, render: () => [
  ...settingsForm([SET.unit, SET.tint, SET.precision, SET.falseColour, SET.skinLuma, SET.skinHue, SET.zebra]),
  hint(t('settings.scopes.panelHint')),
] });

registerSettingsSection({ id: 'stage', label: t('settings.stage'), order: 40, render: () => [
  ...settingsForm([SET.stage, SET.deRef]),
  field('', button(t('main.lut.vendor'), () => showLutLibrary())),
] });

registerSettingsSection({ id: 'latency', label: t('settings.latency'), order: 50, render: () => [
  ...settingsForm([SET.lowLatency], false),
  ...lowLatencyFields(Source.globalLowLatencyConfig, false, (patch) => setGlobalLowLatencyConfig(patch)).map(([label, el]) => field(label, el)),
  hint(LOW_LATENCY_HINT),
  hint(t('settings.latency.hint')),
] });

registerSettingsSection({ id: 'clock', label: t('settings.clock'), order: 60, render: () => [
  hint(t('settings.clock.hint')),
  field('', button(t('settings.clock.add'), () => { addScopePanel('clock'); })),
] });

registerSettingsSection({ id: 'bridge', label: t('settings.bridge'), order: 70, render: () => [
  field(t('settings.bridge.address'), bridgeInput),
  hint(t('settings.bridge.hint')),
  ffmpegInfoEl,
  field('', button(t('settings.bridge.requery'), () => refreshFfmpegInfo())),
] });

registerSettingsSection({ id: 'audio', label: t('settings.audio'), order: 80, render: () => [
  hint(t('settings.audio.hint')),
  field('', button(t('settings.audio.showGen'), () => { toggleSidebar(true); const g = $<HTMLDetailsElement>('#gen-wrap'); g.open = true; g.scrollIntoView({ block: 'nearest' }); })),
] });

registerSettingsSection(keysSection(90));
registerSettingsSection(aboutSection(100));
// after a language switch the window reloads; bring the settings back where the user was
const REOPEN_SETTINGS = 'lz-scopes.reopen-settings';
try {
  const page = sessionStorage.getItem(REOPEN_SETTINGS);
  if (page) { sessionStorage.removeItem(REOPEN_SETTINGS); setTimeout(() => openSettings(page), 0); }
} catch { /* storage unavailable */ }

/** Display colour space changed: re-render and, if switched on, switch the system profile (#17). */
function setDisplaySpace(v: Persisted['display']) {
  state.display = v; save(); renderHeader();
  applySysProfile(v === 'auto' ? null : v).catch(() => {});
}
// The previous session restored the profile on quit; switch it again if the user left it on.
if (state.display !== 'auto') applySysProfile(state.display).catch(() => {});

function openCalibrationDialog() {
  document.querySelector<HTMLDialogElement>('dialog.settings[open]')?.close();
  const ws = bridgeUrl();
  import('./calib/ui').then((m) => m.openCalibration({
    bridgeWs: () => ws, bridgeHttp: () => ws.replace(/^ws/, 'http'),
    openPatchWindow: () => window.open(`${location.pathname}?${new URLSearchParams({ out: 'black', w: String(Math.round(screen.width * devicePixelRatio)), h: String(Math.round(screen.height * devicePixelRatio)) })}`, 'lz-scopes-pattern', 'popup,width=1280,height=720'),
  }));
}

function setTheme(t: UiTheme) {
  state.theme = t; applyTheme(t); applyScheme(state.scheme ?? DEFAULT_SCHEME); save(); refreshMenu();
}

function setLayout(k: string) {
  state.layout = k; state.layoutName = ''; save(); renderHeader(); dock.applyPreset(k);
}

// Layouts and Ausgabe: tool dialogs opened from the menu (Datei → Layouts …, Ausgabe → Ausgabe öffnen …)
const layoutDialog = modal({ id: 'laymenu', title: 'Layouts', size: 'md' });
layoutDialog.body.id = 'laybody';
const outputDialog = modal({ id: 'outmenu', title: t('main.output'), size: 'md' });
outputDialog.body.id = 'outbody';
document.body.append(layoutDialog.dlg, outputDialog.dlg);
function openToolDialog(id: 'laymenu' | 'outmenu') {
  if (id === 'laymenu') { renderLayoutMenu(); layoutDialog.open(); } else { renderOutputMenu(); outputDialog.open(); }
}

/** Narrow windows (drawer): the sidebar starts closed and is not saved as closed. */
const narrowQuery = matchMedia('(max-width: 800px)');
let drawerOpen = false;
function toggleSidebar(on?: boolean) {
  if (narrowQuery.matches) drawerOpen = on ?? !drawerOpen;
  else { state.sidebar = on ?? !state.sidebar; save(); }
  applySidebar();
}
function applySidebar() {
  side.classList.toggle('hidden', narrowQuery.matches ? !drawerOpen : !state.sidebar);
  refreshMenu();
}
narrowQuery.addEventListener('change', () => { drawerOpen = false; applySidebar(); });
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen();
}
const openLed = () => openLedTool({
  sources: () => sources,
  showPattern: (id, w, hh) => {
    const s = sources.find((x) => x.kind === 'pattern') ?? addSource('pattern', t('main.src.ledWall'));
    Object.assign(s.pattern, { id, width: w, height: hh });
    save(); s.startPattern(); renderSources(); openOutput(s.pattern);
  },
  patternsChanged: () => sources.filter((s) => s.kind === 'pattern' && s.pattern.id.startsWith('led-')).forEach((s) => s.startPattern()),
});
const bridgeInput = textInput(state.bridge, (v) => setBridge(v), { placeholder: t('settings.bridge.placeholder'), attrs: { id: 'bridge' } });
function setBridge(v: string) {
  state.bridge = bridgeInput.value = normaliseBridge(v);
  save(); refreshFfmpegInfo();
}
bindBridgeField({ get: () => state.bridge, set: setBridge, setPlaceholder: (p) => { bridgeInput.placeholder = p; } });
const ffmpegInfoEl = h('p', { class: 'hint', id: 'ffmpeg-info' }, t('settings.bridge.querying'));
// which ffmpeg the bridge runs (origin, version, licence, SRT) – read by the bridge from the binary
let bridgeHealth: BridgeHealth | null = null;
async function refreshFfmpegInfo() {
  bridgeHealth = await fetchBridgeHealth(bridgeUrl().replace(/^ws/, 'http'));
  const el = ffmpegInfoEl;
  el.textContent = bridgeFfmpegText(bridgeHealth);
  el.title = bridgeHealth?.ffmpeg?.path ?? '';
  if (sources.some((x) => x.kind === 'stream' && /^srt:/i.test(x.url))) renderSources();
  // no answer (bridge still starting, first ffmpeg run slow): ask again, never show a stale guess
  clearTimeout(ffmpegRetry);
  if (!bridgeHealth) ffmpegRetry = setTimeout(refreshFfmpegInfo, 10_000);
}
let ffmpegRetry: ReturnType<typeof setTimeout> | undefined;
refreshFfmpegInfo();

function toggleFreeze() {
  frozen = !frozen;
  sources.forEach((s) => (s.frozen = frozen));
  freezeBtn.classList.toggle('on', frozen);
  freezeBtn.setAttribute('aria-pressed', String(frozen));
  freezeBtn.textContent = frozen ? t('main.resume') : t('main.freeze');
  refreshMenu();
}

// ---------------------------------------------------------------- sources

function addSource(kind: SourceKind, name?: string, url = '', settings?: Partial<SourceSettings>) {
  const s = new Source(kind, name, settings);
  s.url = url;
  s.onChange = () => { renderSources(); };
  sources.push(s);
  renderSources(); renderPanels(); save(); refreshMenu();
  return s;
}

// platform shells open stream sources through this hook (src/streamRoute.ts; iOS auto streams)
streamRoute.bindAdder((url, name) => { const s = addSource('stream', name, url); s.connectStream(url, bridgeUrl()); });

function removeSource(s: Source) {
  s.stop();
  renderer.dropSource(s.id);
  sources.splice(sources.indexOf(s), 1);
  renderSources(); renderPanels(); save(); refreshMenu();
}

/** A control row with a layout class: 'opts' = grid of short selects, 'stack' = one long select per line. */
function classRow(cls: 'opts' | 'stack', ...kids: Parameters<typeof row>) { const r = row(...kids); r.classList.add(cls); return r; }

function renderSources() {
  $('#source-list').replaceChildren(...sources.map((s, i) => {
    const set = s.settings;
    const upd = (patch: Partial<SourceSettings>, reconnect = false) => {
      Object.assign(s.settings, patch); save();
      if (reconnect && s.kind === 'stream' && s.status !== 'idle') s.connectStream(s.url, bridgeUrl());
      renderSources();
    };
    const running = s.status === 'live' || s.status === 'connecting';
    const card = h('div', { class: `src ${s.status}` },
      h('div', { class: 'src-head' },
        statusDot(s.status),
        h('span', { class: 'idx' }, String(i + 1)),
        h('input', { class: 'name', value: s.name, 'aria-label': t('main.sources'), onchange: (e: Event) => { s.name = (e.target as HTMLInputElement).value; save(); renderPanels(); } }),
        iconButton('✕', t('main.src.remove'), () => removeSource(s))),
    );
    if (s.kind === 'stream') {
      const urlIn = textInput(s.url, () => {}, { placeholder: 'rtsp://user:pass@host:554/stream', mono: true, onEnter: () => connect(), attrs: { class: 'url' } });
      const connect = () => { s.url = streamRoute.normalise(urlIn.value.trim()); urlIn.value = s.url; save(); s.connectStream(s.url, bridgeUrl()); };
      const bridgeUi: BridgeUi = {
        http: () => bridgeUrl().replace(/^ws/, 'http'), hud: alertHud, upd,
        connect: (url, name) => { urlIn.value = url; if (name) s.name = name; if (url !== s.url) { s.settings.device = {}; if (/^(decklink|ndi|folder):/.test(url)) s.settings.depth = 16; } connect(); renderSources(); },
      };
      card.append(
        row(urlIn),
        classRow('opts',
          select(String(set.width), [['640', '640 px'], ['960', '960 px'], ['1280', '1280 px'], ['1920', '1920 px'], ['0', t('main.native')]], (v) => upd({ width: Number(v) }, true), s.lowLatency && effectiveWidth(set.width, true, s.llConfig.width) !== set.width ? t('main.src.widthLimited', { px: s.llConfig.width }) : t('main.src.widthTitle')),
          select(String(set.fps), [['0', t('main.src.fpsAll')], ['10', '10 fps'], ['25', '25 fps'], ['30', '30 fps']], (v) => upd({ fps: Number(v) }, true), t('main.src.fpsTitle')),
          select(set.yuv ? 'yuv' : String(set.depth), [['8', '8 bit'], ['16', '16 bit'], ['yuv', '16 bit Y′CbCr']], (v) => upd(v === 'yuv' ? { depth: 16, yuv: true } : { depth: Number(v) as 8 | 16, yuv: false }, true), t('main.src.depthTitle')),
          select(set.transport, [['tcp', 'TCP'], ['udp', 'UDP']], (v) => upd({ transport: v as 'tcp' | 'udp' }, true), t('main.src.transportTitle')),
          select(set.audio === false ? '0' : '1', [['1', t('main.src.audio')], ['0', t('main.src.noAudio')]], (v) => upd({ audio: v === '1' }, true), t('main.src.audioTitle')),
          select(set.codec ?? 'raw', [['raw', t('main.src.raw')], ['h264', 'H.264 · 8 bit']], (v) => upd({ codec: v as 'raw' | 'h264' }, true), t('main.src.codecTitle'))),
        row(
          select(set.lowLatency === undefined ? '' : set.lowLatency ? '1' : '0', [['', t('main.src.llGlobal', { mode: state.lowLatency ? 'Low Latency' : t('main.normal') })], ['1', 'Low Latency'], ['0', t('main.src.llNormal')]],
            (v) => { upd({ lowLatency: v === '' ? undefined : v === '1' }, true); refreshHeads(); }, LOW_LATENCY_HINT),
          h('span', { class: 'llmeasure', 'data-llsrc': s.id, title: t('main.src.llMeasureTitle') }, latencyMeasureText(s))),
        ...(s.lowLatency ? [h('details', { class: 'llsettings' },
          h('summary', { title: describeLowLatency(s.llConfig) }, `Low Latency: ${describeLowLatency(s.llConfig)}`),
          ...lowLatencyFields(set.ll ?? {}, true, (patch) => {
            const ll: Partial<LowLatencyConfig> = { ...set.ll, ...patch };
            for (const k of Object.keys(ll) as (keyof LowLatencyConfig)[]) if (ll[k] === undefined) delete ll[k];
            upd({ ll }, true); refreshHeads();
          }).map(([label, el]) => field(label, el)))] : []),
        row(
          running ? button(t('main.src.disconnect'), () => s.stop()) : button(t('main.src.connect'), connect, { variant: 'primary' }),
          h('div', { class: 'presets' }, ...['bars', 'ramp', 'testsrc', 'colors'].map((p) =>
            button(p, () => { urlIn.value = `test:${p}`; connect(); }, { small: true, title: t('main.src.testN', { name: p }) })),
            deviceButton(bridgeUi), deckLinkButton(bridgeUi), ndiButton(bridgeUi), folderButton(bridgeUi, (window as unknown as { lzsDesktop?: DesktopApi }).lzsDesktop?.watchFolder))),
        ...[bridgeDeviceRow(s, bridgeUi, renderSources), deckLinkRow(s, bridgeUi), ndiRow(s), decodeRow(s, bridgeUi)].filter((x): x is Node => !!x),
        ...(sourceFfmpegText(s.url, bridgeHealth) ? [h('p', { class: 'hint', 'data-ffmpeg-source': '' }, sourceFfmpegText(s.url, bridgeHealth))] : []),
      );
    } else if (s.url === SIM_URL) {
      card.append(hint(SHADING_T.simCard));
    } else if (s.kind === 'pattern') {
      card.append(...patternControls(s));
    } else if (s.kind === 'audio') {
      card.append(...audioSourceControls(s, save, renderSources, bridgeUrl));
    } else {
      if (s.isVideoFile) card.append(...transportControls(s));
      if (s.kind === 'webcam') card.append(deviceRow(s));
      if ((s.kind === 'screen' || s.kind === 'webcam' || s.isVideoFile) && running) {
        card.append(row(
          button(t('main.src.crop'), () => { if (!s.cropToRoi()) alertHud(t('main.src.dragFirst')); renderSources(); }, { small: true, title: t('main.src.cropTitle') }),
          s.crop && button(t('main.src.cropOff'), () => { s.clearCrop(); renderSources(); }, { small: true })));
      }
      card.append(row(
        running ? button(t('main.src.stop'), () => s.stop())
          : button(s.kind === 'file' ? t('main.src.chooseFile') : s.kind === 'folder' ? t('main.src.chooseFolder') : t('main.src.start'), () => startLocal(s), { variant: 'primary' })));
      if (s.kind === 'folder') card.append(h('details', { class: 'hint' }, h('summary', {}, 'Lightroom, Capture One, Resolve'), STILL_WORKFLOW()));
    }
    const ar = audioRow(s, renderSources);
    if (ar) card.append(ar);
    if (s.kind !== 'audio') card.append(classRow('stack',
      groupedSelect(set.transfer, transferGroups(`auto: ${transferLabel(s.transfer)} (${s.transferOrigin})`),
        (v) => upd({ transfer: v as SourceSettings['transfer'] }), t('main.src.transferTitle')),
      select(set.colorspace, [['auto', `Matrix auto: ${s.colorspace} (${s.colorspaceOrigin})`], ['709', 'Rec.709'], ['2020', 'Rec.2020'], ['601', 'Rec.601 525 (SMPTE-C)'], ['601-625', 'Rec.601 625 (EBU)']], (v) => upd({ colorspace: v as SourceSettings['colorspace'] }), t('main.src.matrixTitle'))),
      row(
        groupedSelect(set.gamut ?? 'auto', [
          ['', [['auto', `Gamut auto (${GAMUTS[s.gamut].name})`]]],
          ['Video', (['709', 'p3', '2020', '601', '601-625'] as GamutId[]).map((k) => [k, GAMUTS[k].name])],
          [t('main.src.camAces'), (Object.keys(CAMERA_GAMUTS) as GamutId[]).map((k) => [k, GAMUTS[k].name])],
        ], (v) => upd({ gamut: v as SourceSettings['gamut'] }), t('main.src.gamutTitle')),
        s.transfer === 'hlg' ? select(String(s.hlgLw), HLG_PEAKS.map((n) => [String(n), t('main.src.hlgDisplay', { n })]), (v) => upd({ hlgLw: Number(v) }), t('main.src.hlgTitle')) : ''));
    if (s.kind !== 'audio') card.append(chainControls(s, upd));
    if (s.url === 'resolve:' && s.status === 'live') card.append(resolveRouteRow(s));
    if (s.message) card.append(h('div', { class: 'msg', role: s.status === 'error' ? 'alert' : null }, s.message));
    if (s.kind === 'webcam' && s.status === 'live') card.append(row(chip('', { attrs: { 'data-srcfps': s.id } })));
    // LUT files dropped on a source card: LUT 1, with Shift LUT 2
    card.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); card.classList.add('drop'); } });
    card.addEventListener('dragleave', () => card.classList.remove('drop'));
    card.addEventListener('drop', (e) => { card.classList.remove('drop'); const f = [...(e.dataTransfer?.files ?? [])]; if (f.length && isLutFile(f[0])) { e.preventDefault(); loadLutInto(s, f[0], e.shiftKey ? 'lut2' : 'lut1'); } });
    return card;
  }));
}

const isLutFile = (f: File) => LUT_EXTENSIONS.some((x) => f.name.toLowerCase().endsWith(x));

async function loadLutInto(s: Source, f: File, slot: 'lut1' | 'lut2') {
  try {
    await addLutFile(f);
    s.settings.chain = { ...s.settings.chain, [slot]: f.name };
    save(); await refreshRecent(); renderSources(); refreshHeads(); needClear = true;
    alertHud(t('main.lut.loaded', { file: f.name, slot: slot === 'lut1' ? 'LUT 1' : 'LUT 2', source: s.name }));
  } catch (e) { alertHud(t('main.lut.unreadable', { error: (e as Error).message })); }
}

let recentLutNames: string[] = [];
async function refreshRecent() { recentLutNames = await recentLuts(); }

function transferGroups(autoLabel: string, withAuto = true): [string, [string, string][]][] {
  return [
    ['', withAuto ? [['auto', autoLabel]] : []],
    ['Display (SDR)', [['sdr', `SDR BT.1886 (γ ${num(2.4, 1)})`], ['g22', `Gamma ${num(2.2, 1)}`], ['g26', `Gamma ${num(2.6, 1)}`], ['g28', `Gamma ${num(2.8, 1)}`], ['srgb', 'sRGB'], ['linear', 'Linear']]],
    ['HDR', [['pq', 'PQ ST 2084'], ['hlg', 'HLG']]],
    [t('main.tr.camLog'), Object.entries(LOG_CURVES).map(([k, c]) => [k, c.name] as [string, string])],
  ];
}
const gamutGroups = (): [string, [string, string][]][] => [
  ['Video', (['709', 'p3', '2020', '601', '601-625'] as GamutId[]).map((k) => [k, GAMUTS[k].name])],
  [t('main.src.camAces'), (Object.keys(CAMERA_GAMUTS) as GamutId[]).map((k) => [k, GAMUTS[k].name])],
];

/** CST / LUT block of a source card (chain.ts). */
function chainControls(s: Source, upd: (p: Partial<SourceSettings>) => void): Node {
  const ch: ChainSettings = s.settings.chain ?? {};
  const cst: CstSettings = { ...DEFAULT_CST, ...ch.cst };
  const setChain = (patch: Partial<ChainSettings>) => { upd({ chain: { ...ch, ...patch } }); refreshHeads(); needClear = true; };
  const setCst = (patch: Partial<CstSettings>) => setChain({ cst: { ...cst, ...patch } });
  const peaks = autoPeaks({ transfer: s.transfer, gamut: s.gamut, lw: s.hlgLw }, { transfer: cst.transfer, gamut: cst.gamut, lw: cst.lw ?? 1000 });
  const num = (v: number | undefined, auto: number, title: string, set: (n: number) => void) =>
    numberInput(v || '', (n) => set(n || 0), { min: 0, title, placeholder: `auto ${Math.round(auto)}`, size: 'l' });
  const lutSel = (slot: 'lut1' | 'lut2') => {
    const cur = ch[slot] ?? '';
    const file = filePicker(LUT_EXTENSIONS.join(','), ([f]) => loadLutInto(s, f, slot));
    const names = [...new Set([...recentLutNames, ...LUTS.keys()])];
    const opts: [string, string][] = [['', slot === 'lut1' ? t('main.lut.none1') : t('main.lut.none2')],
      ...names.map((n) => [n, `${slot === 'lut1' ? 'LUT 1' : 'LUT 2'}: ${n}`] as [string, string]), ['__load', t('main.lut.load')]];
    if (cur && !names.includes(cur)) opts.splice(1, 0, [cur, t('main.lut.notLoaded', { name: cur })]);
    const sel = select(cur, opts, async (v) => {
      if (v === '__load') { file.pick(); return; }
      if (v && !(await ensureLut(v))) { alertHud(t('main.lut.notStored', { name: v })); return; }
      setChain({ [slot]: v || undefined });
    }, t('main.lut.fileTitle'));
    return h('span', { class: 'lutslot' }, sel, file.input);
  };
  const out = ch.lutOut ?? {};
  const summary = [cst.on ? `CST → ${GAMUTS[cst.gamut].name} ${transferLabel(cst.transfer)}` : '', ch.lut1 ? `LUT ${ch.lut1}` : '', ch.lut2 ? `LUT ${ch.lut2}` : ''].filter(Boolean).join(' · ');
  return h('details', { class: 'chain', open: !!summary },
    h('summary', { title: t('main.chain.summaryTitle') }, `CST / LUT${summary ? `: ${summary}` : ''}`),
    row(
      select('', [['', t('main.chain.camPreset')], ...CAMERA_PRESETS.map((p) => [p.id, `${p.name} → Rec.709`] as [string, string])], (v) => {
        const p = CAMERA_PRESETS.find((x) => x.id === v);
        if (!p) return;
        const t = CST_TARGETS[0];
        upd({ transfer: p.curve, gamut: 'auto', chain: { ...ch, cst: { ...cst, on: true, gamut: t.gamut, transfer: t.transfer, tonemap: t.tonemap } } });
        refreshHeads(); needClear = true;
      }, t('main.chain.camPresetTitle')),
      select('', [['', t('main.chain.target')], ...CST_TARGETS.map((t) => [t.id, t.name] as [string, string])], (v) => {
        const t = CST_TARGETS.find((x) => x.id === v);
        if (t) setCst({ on: true, gamut: t.gamut, transfer: t.transfer, tonemap: t.tonemap, lw: 1000 });
      })),
    row(
      checkbox(cst.on, 'CST', (v) => setCst({ on: v }), t('main.chain.cstTitle')),
      groupedSelect(cst.gamut, gamutGroups(), (v) => setCst({ gamut: v as GamutId }), t('main.chain.tgtGamut')),
      groupedSelect(cst.transfer, transferGroups('', false), (v) => setCst({ transfer: v as CstSettings['transfer'] }), t('main.chain.tgtTransfer'))),
    row(
      select(cst.tonemap ?? 'bt2390', Object.entries(TONEMAP_LABELS) as [string, string][], (v) => setCst({ tonemap: v as ToneMap }), t('main.chain.tonemapTitle')),
      num(cst.srcPeak, peaks.src, t('main.chain.srcPeak'), (n) => setCst({ srcPeak: n })),
      num(cst.tgtPeak, peaks.tgt, t('main.chain.tgtPeak'), (n) => setCst({ tgtPeak: n })),
      cst.transfer === 'hlg' ? select(String(cst.lw ?? 1000), HLG_PEAKS.map((n) => [String(n), t('main.chain.tgtHlg', { n })]), (v) => setCst({ lw: Number(v) })) : ''),
    row(lutSel('lut1'), lutSel('lut2')),
    (ch.lut1 || ch.lut2) && row(
      groupedSelect(out.transfer ?? 'auto', transferGroups(t('main.chain.lutOutTransfer')), (v) => setChain({ lutOut: { ...out, transfer: v === 'auto' ? undefined : v as CstSettings['transfer'] } }), t('main.chain.lutOutTitle')),
      groupedSelect(out.gamut ?? 'auto', [['', [['auto', t('main.chain.lutOutGamut')]]], ...gamutGroups()], (v) => setChain({ lutOut: { ...out, gamut: v === 'auto' ? undefined : v as GamutId } }))),
    row(button(t('main.lut.vendor'), () => showLutLibrary(), { small: true, title: t('main.lut.vendorTitle') })),
    hint(t('main.chain.dropHint')));
}

function showLutLibrary() {
  openModal({ title: t('main.lut.vendorHead'), cls: 'lutlib', size: 'lg', body: [
    hint(t('main.lut.vendorHint')),
    h('div', { class: 'table-wrap' }, table(LUT_SOURCES.map((l) => [l.vendor, l.looks, l.url ? link(l.url, t('main.lut.download')) : '–', h('span', { class: 'hint' }, l.note)]))),
  ] });
}

function patternSelect(value: string, onchange: (id: string) => void) {
  const groups = [...new Set(PATTERNS.map((p) => p.group))];
  const favs = favouritePatterns();
  return h('select', { class: 'pattern', title: t('main.pattern.title'), onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
    // favourites first (#52); the same pattern also stays in its own group
    ...(favs.length ? [h('optgroup', { label: t('main.pattern.favs') }, ...favs.map((p) => h('option', { value: p.id, selected: p.id === value }, p.name)))] : []),
    ...groups.map((g) => h('optgroup', { label: g },
      ...PATTERNS.filter((p) => p.group === g).map((p) => h('option', { value: p.id, selected: p.id === value && !favs.includes(p) }, p.name)))));
}

function patternControls(s: Source): Node[] {
  const pt = s.pattern;
  const apply = (patch: Partial<PatternState>) => { Object.assign(pt, patch); save(); s.startPattern(); };
  const step = (d: number) => {
    const i = PATTERNS.findIndex((p) => p.id === pt.id);
    apply({ id: PATTERNS[(i + d + PATTERNS.length) % PATTERNS.length].id });
  };
  const label = textInput(pt.label, (v) => apply({ label: v }), { placeholder: t('main.pattern.label'), attrs: { class: 'url' } });
  const imgs = filePicker('image/*', async (files) => {
    const r = await addUserImages(files);
    r.errors.forEach(alertHud);
    if (r.added.length) { apply({ id: r.added[0].id }); renderSources(); }
  }, true);
  const fav = isFavourite(pt.id);
  return [
    row(
      iconButton('◀', t('main.pattern.prev'), () => step(-1), { small: true }),
      patternSelect(pt.id, (id) => { apply({ id }); renderSources(); }),
      iconButton('▶', t('main.pattern.next'), () => step(1), { small: true }),
      button(fav ? '★' : '☆', () => setFavourite(pt.id, !fav), { small: true, pressed: fav, title: fav ? t('main.pattern.unfav') : t('main.pattern.fav'), attrs: { class: `btn mini fav${fav ? ' on' : ''}` } })),
    row(
      resolutionControls(pt, apply),
      label),
    ...(patternById(pt.id).note ? [hint(patternById(pt.id).note!)] : []),
    row(
      button(t('main.pattern.out'), () => openOutput(pt), { variant: 'primary', title: t('main.pattern.outTitle') }),
      button(t('main.pattern.images'), () => imgs.pick(), { title: t('main.pattern.imagesTitle') }), imgs.input,
      button(t('main.pattern.manage'), () => openTestImages(testMediaHost), { title: t('main.pattern.manageTitle') }),
      button(t('main.pattern.videos'), () => openTestVideos(testMediaHost), { title: t('main.pattern.videosTitle') })),
  ];
}

/** Preset resolutions, the LED wall's picture size, or any size (free, e.g. an LED wall). */
function resolutionControls(pt: PatternState, applyPt: (p: Partial<PatternState>) => void): Node {
  const apply = (p: Partial<PatternState>) => { applyPt(p); renderSources(); };
  const cur = `${pt.width}x${pt.height}`, wall = pictureSize(ledSettings().wall), wallKey = `${wall.w}x${wall.h}`;
  const opts: [string, string][] = RESOLUTIONS.map(([w, hh]) => [`${w}x${hh}`, `${w}×${hh}`]);
  if (!opts.some(([k]) => k === wallKey)) opts.push([wallKey, t('main.res.ledWall', { w: wall.w, h: wall.h })]);
  if (!opts.some(([k]) => k === cur)) opts.push([cur, `${pt.width}×${pt.height}`]);
  const size = (v: number) => Math.max(16, Math.min(16384, Math.round(v) || 16));
  const both = () => apply({ width: size(Number(w.value)), height: size(Number(hh.value)) });
  const w = numberInput(pt.width, both, { min: 16, max: 16384, title: t('main.res.wTitle'), size: 'l' });
  const hh = numberInput(pt.height, both, { min: 16, max: 16384, title: t('main.res.hTitle'), size: 'l' });
  return h('span', { class: 'row' },
    select(cur, opts, (v) => { const [a, b] = v.split('x').map(Number); apply({ width: a, height: b }); }, t('main.res.title')), w, '×', hh);
}

function openOutput(pt: PatternState) {
  const q = new URLSearchParams({ out: pt.id, w: String(pt.width), h: String(pt.height), label: pt.label });
  window.open(`${location.pathname}?${q}`, 'lz-scopes-pattern', 'popup,width=1280,height=720');
}

// own pictures, logo, favourites and test videos (#52)
const testMediaHost: TestMediaHost = {
  usePattern: (id) => {
    const s = sources.find((x) => x.kind === 'pattern') ?? addSource('pattern', t('main.pattern.title'));
    s.pattern.id = id; save(); s.startPattern(); renderSources();
  },
  openVideo: (url, v) => {
    const s = addSource('file', `${v.title} ${v.version}`.slice(0, 40));
    // the HDR encodes carry no colour tags: set what the publisher states
    if (v.transfer) s.settings.transfer = v.transfer;
    if (v.gamut) s.settings.gamut = v.gamut;
    s.openVideoUrl(url, `${v.title} ${v.version}`.slice(0, 40)).then(() => { renderSources(); renderPanels(); });
  },
  hud: (m) => alertHud(m),
};
onUserPatternsChange(() => {
  // the logo patterns follow the chosen logo
  sources.filter((x) => x.kind === 'pattern' && (x.pattern.id === 'logo' || x.pattern.id === 'testcard-logo' || x.pattern.id.startsWith('img:'))).forEach((x) => x.startPattern());
  renderSources();
});
registerMenuCommand('sources', { id: 'testimages', label: t('menu.testImages') }, () => openTestImages(testMediaHost));
registerMenuCommand('sources', { id: 'testvideos', label: t('menu.testVideos'), title: t('menu.testVideosTitle') }, () => openTestVideos(testMediaHost));

async function startLocal(s: Source) {
  if (s.kind === 'pattern') return s.startPattern();
  if (s.kind === 'folder') return s.startFolder();
  if (s.kind === 'screen' && desktop?.captureSources) return pickWindow(s);
  if (s.kind === 'webcam' || s.kind === 'screen') return s.startCapture(s.kind).then(() => refreshDevices().then(renderSources));
  filePicker('video/*,image/*', ([f]) => { s.openFile(f).then(renderPanels); }).pick();
}

/** Camera / USB capture device selection (labels are only known after the first permission). */
let videoDevices: MediaDeviceInfo[] = [];
async function refreshDevices() {
  try { videoDevices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch { videoDevices = []; }
}
navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshDevices().then(renderSources));
function deviceRow(s: Source): Node {
  if (!videoDevices.length) refreshDevices().then(() => { if (videoDevices.length) renderSources(); });
  const opts: [string, string][] = videoDevices.map((d, i) => [d.deviceId, d.label || t('main.dev.n', { n: i + 1 })]);
  return row(select(s.deviceId, opts.length ? opts : [['', t('main.dev.default')]], (id) => {
    s.name = videoDevices.find((d) => d.deviceId === id)?.label.replace(/\s*\([0-9a-f:]+\)$/i, '').slice(0, 40) || s.name;
    s.startCapture('webcam', id).then(() => { refreshDevices().then(renderSources); });
  }, t('main.dev.title')));
}

/** Desktop app: choose a window or screen (thumbnails), e.g. DaVinci Resolve's viewer. */
async function pickWindow(s: Source) {
  const list = await desktop!.captureSources!();
  const m = openModal({ title: t('main.pick.title'), size: 'xl', body: [
    hint(t('main.pick.hint')),
    h('div', { class: 'thumbs' }, ...list.map((c) => h('button', { class: 'thumb', title: c.name, onclick: () => { m.close(); s.name = c.name.slice(0, 40); s.startCapture('screen', undefined, c.id); } },
      h('img', { src: c.thumb, alt: '' }), h('span', {}, c.name)))),
  ], actions: [button(t('common.cancel'), () => m.close())] });
}

/** Resolve source card (#88): which route the picture takes now, why, and how colour-accurate it is. */
function resolveRouteRow(s: Source) {
  const r = s.resolveRoute ?? { route: 'still' as const, playing: false };
  const { label, detail } = routeText(r);
  const pick = !desktop?.captureSources && r.playing && r.why === 'browser'
    ? button(t('source.resolve.pickWindow'), () => { void resolvePlayback.pickWindow(s); }, { small: true, title: t('source.resolve.pickWindowTitle') }) : '';
  return h('div', { class: 'resolve-route', 'data-route': r.route },
    row(h('span', { class: `route-chip route-${r.route}` }, label), pick),
    hint(detail));
}

function addResolve() {
  const s = addSource('stream', 'DaVinci Resolve', 'resolve:', { depth: 16, fps: 10, width: 1920 });
  s.connectStream('resolve:', bridgeUrl());
}

/** Add a source of a kind (sidebar buttons and Quellen menu). */
function addSourceOfKind(kind: string) {
  switch (kind) {
    case 'pattern': return void startLocal(addSource('pattern', t('main.src.patternN', { n: sources.length + 1 })));
    case 'stream': { state.sidebar = true; applySidebar(); save(); return void addSource('stream', `Stream ${sources.length + 1}`); }
    case 'resolve': return addResolve();
    case 'webcam': case 'screen': case 'file': case 'folder': return void startLocal(addSource(kind));
    case 'audio': return addAudioSource('device');
    case 'generator': return addAudioSource('generator');
  }
}
$('#add').replaceChildren(
  h('span', {}, t('main.add.source')),
  ...([
    ['pattern', t('main.pattern.title'), ''], ['stream', t('main.add.stream'), ''], ['resolve', 'DaVinci Resolve', t('main.add.resolveTitle')],
    ['webcam', t('main.add.webcam'), t('main.add.webcamTitle')], ['screen', t('main.add.screen'), t('main.add.screenTitle')], ['file', t('main.add.file'), ''],
    ['folder', t('main.add.folder'), t('main.add.folderTitle')], ['audio', 'Audio', t('main.add.audioTitle')],
  ] as const).map(([kind, label, title]) => button(label, () => addSourceOfKind(kind), { title })),
);

/** Add an audio source and, if no audio panel is open, a pinned level/loudness panel for it. */
function addAudioSource(mode: AudioInput['mode']) {
  const s = addSource('audio', mode === 'generator' ? 'Generator' : `Audio ${sources.length + 1}`);
  s.audioIn.mode = mode;
  save();
  if (!openViews().some((v) => isAudio(state.panels[v.idx].scope))) {
    const idx = state.panels.length;
    state.panels.push({ ...panel('audio-meter'), sourceId: s.id, pin: true });
    save();
    dock.addPanel(idx);
  }
  s.startAudio().then(renderSources);
  renderSources();
}

// ---------------------------------------------------------------- panels

interface PanelView {
  idx: number; el: HTMLElement; head: HTMLElement; body: HTMLElement; blit: HTMLCanvasElement; overlay: HTMLCanvasElement; zoom: HTMLButtonElement;
  /** the ⚙ popover; kept across head refreshes so an open popover stays open */
  pop?: PopoverEl; popScope?: ScopeType;
  /** the ? help card (src/help/scopeHelp.ts), when the scope help is switched on */
  help?: PopoverEl; helpScope?: ScopeType;
}
const views = new Map<number, PanelView>();
/** Views of the panels currently in the dock. */
const openViews = () => dock.openIdx().map((i) => views.get(i)).filter((v): v is PanelView => !!v);

function panelSource(p: PanelState) {
  return sources.find((s) => s.id === p.sourceId) ?? sources[0] ?? null;
}

const panelTitle = (idx: number) => `${idx + 1} · ${SCOPE_LABELS[state.panels[idx]?.scope ?? 'picture']}`;

/** The element dockview shows for a panel; built once, its header re-filled on changes. */
function panelElement(idx: number): HTMLElement {
  let v = views.get(idx);
  if (!v) {
    state.panels[idx] ??= panel('wf-luma');
    const p = () => state.panels[idx];
    const blit = h('canvas', { class: 'blit' });
    const overlay = h('canvas', { class: 'overlay' });
    // zoom level (#89): shown while zoomed, click resets
    const zoom = h('button', { class: 'zoomchip', hidden: true, 'data-zoom': '1', title: t('gesture.chipTitle'), onclick: () => resetView(idx), onpointerdown: (e: Event) => e.stopPropagation() });
    const body = h('div', { class: 'body' }, blit, overlay, zoom);
    const head = h('div', { class: 'phead', ondblclick: () => toggleSolo(idx) });
    const el = h('div', { class: 'panel' }, head, body);
    // double click: reset a zoomed view, otherwise solo
    body.addEventListener('dblclick', (e) => { if ((e.target as HTMLElement).closest('.zoomchip')) return; if (!resetView(idx)) toggleSolo(idx); });
    shading.attach(body, idx, p);
    attachPanelGestures(idx, p, body);
    attachPointer(p(), body);
    attachSkinDrag(p(), body);
    body.addEventListener('contextmenu', (e) => { e.preventDefault(); const s = panelSource(p()); if (s) { s.probe = null; s.roi = null; s.faceMode = 'off'; refreshHeads(); } });
    v = { idx, el, head, body, blit, overlay, zoom };
    views.set(idx, v);
    fillHead(v);
  }
  return v.el;
}

/**
 * Panel head: scope, source, stage chip, pin | chips, ⚙ popover | solo. The parts are refilled
 * on changes; the ⚙ popover is kept (an open one stays open) unless the scope changes.
 */
function fillHead(v: PanelView) {
  const idx = v.idx, p = state.panels[idx];
  if (!v.head.firstChild) {
    v.head.append(h('span', { class: 'plead' }), h('div', { class: 'opts' }, h('span', { class: 'pchips' })),
      iconButton('⤢', t('panel.solo'), () => toggleSolo(idx)));
  }
  const [lead, opts] = [v.head.children[0] as HTMLElement, v.head.children[1] as HTMLElement];
  const multi = sources.length > 1 && !isLight(p.scope);
  lead.replaceChildren(...[
    select(p.scope, Object.entries(SCOPE_LABELS) as Option[], (val) => {
      p.scope = val as ScopeType; p.view = undefined; if (val === 'vector' || val === 'hls' || val === 'cie') p.colorize = true; save(); fillHead(v); dock.setTitle(idx);
    }, '', { 'aria-label': t('ui.scope') }),
    multi && select(panelSource(p)?.id ?? '', sources.map((s, i) => [s.id, `${i + 1} ${s.name}`]), (val) => switchSource(p, val), t('panel.sourceTitle')),
    stageChip(p),
    multi && iconButton('📌', p.pin ? t('panel.pinned') : t('panel.pin'), () => { p.pin = !p.pin; save(); fillHead(v); }, { pressed: !!p.pin, attrs: { class: `icon pin${p.pin ? ' on' : ''}` } }),
  ].filter((x): x is HTMLElement => !!x));
  (opts.firstChild as HTMLElement).replaceChildren(...[latencyChip(p), roiChip(p)].filter((x): x is HTMLElement => !!x));
  if (!v.pop || v.popScope !== p.scope) {
    v.pop?.remove();
    v.pop = popover({ label: '⚙', title: t('panel.settingsOf', { scope: SCOPE_LABELS[p.scope] }), heading: SCOPE_LABELS[p.scope], align: 'end', cls: 'psettings', content: () => panelSettings(state.panels[idx]) });
    v.popScope = p.scope;
    opts.append(v.pop);
  }
  const wantHelp = helpOn() && hasHelp(p.scope);
  if (v.help && (!wantHelp || v.helpScope !== p.scope)) { v.help.remove(); v.help = undefined; }
  if (wantHelp && !v.help) {
    v.help = popover({ label: '?', title: t('help.open', { scope: SCOPE_LABELS[p.scope] }), heading: SCOPE_LABELS[p.scope], align: 'end', cls: 'scopehelp', triggerCls: 'icon pop-trigger help-trigger', content: () => helpCard(state.panels[idx].scope, Object.keys(SCOPE_LABELS)) });
    v.helpScope = p.scope;
    opts.insertBefore(v.help, v.pop ?? null);
  }
}

/** Measuring stage in the panel head, honest about stages that have nothing to apply. */
function stageChip(p: PanelState): HTMLElement | null {
  if (isAudio(p.scope) || p.scope === 'clock' || p.scope === 'genlock' || isLight(p.scope)) return null;
  const n = stageNote(panelSource(p), p.stage ?? state.stage ?? 'signal');
  return n.text ? chip(n.text, { tone: n.warn ? 'warn' : undefined, cls: 'stagechip', title: t('panel.stageChipTitle') }) : null;
}

/** Re-fill all panel headers (sources or settings changed). */
function renderPanels() {
  views.forEach(fillHead);
  needClear = true;
}

function addScopePanel(scope: ScopeType = 'wf-luma') {
  const idx = state.panels.length;
  state.panels.push(panel(scope));
  save();
  dock.addPanel(idx);
}

/** Settings of one measuring tool, shown in its ⚙ menu. */
/** Rebuild the rows of a panel's open ⚙ popover (rows appear or disappear). */
function refreshPanelSettings(p: PanelState) {
  const v = [...views.values()].find((x) => state.panels[x.idx] === p);
  if (v) { fillHead(v); v.pop?.refresh(); }
}

function panelSettings(p: PanelState): Node[] {
  if (isAudio(p.scope)) return audioPanelSettings(p, save);
  if (isLight(p.scope)) return lightPanelSettings(p, save);
  if (p.scope === 'genlock') return genlockPanelSettings(p, save);
  if (p.scope === 'clock') return clockPanelSettings(p, save, sources, () => refreshPanelSettings(p));
  const rows: Node[] = [];
  const row = (label: string, ...kids: Kid[]) => rows.push(field(label, ...kids));
  /** a global setting, rendered from its one description (label can differ in the panel) */
  const global = (s: Setting, label?: string) => rows.push(field(label ?? s.label(), ...settingControl(s)));
  row(t('settings.stage.point'), select(p.stage ?? 'auto', [['auto', t('panel.stageDefault', { stage: STAGE_LABELS[state.stage ?? 'signal'] })], ...STAGES.map((st) => [st, STAGE_LABELS[st]] as [string, string])],
    (v) => { p.stage = v === 'auto' ? undefined : v as Stage; save(); refreshHeads(); }, t('panel.stageTitle')));
  const check = (key: 'colorize' | 'log' | 'r103' | 'marks' | 'cieUv' | 'skinBand' | 'greenBand' | 'greenWedge', label: string, dflt = false) =>
    checkbox(p[key] ?? dflt, label, (v) => { p[key] = v; save(); refreshHeads(); });
  const scatter = isWaveform(p.scope) || p.scope === 'vector' || p.scope === 'hls' || p.scope === 'cie' || p.scope === 'diamond' || p.scope === 'cube' || p.scope === 'satlum' || p.scope === 'chplot';
  if (scatter) {
    row(t('panel.brightness'), slider(Math.log2(p.gain), (v) => { p.gain = 2 ** v; save(); }, { min: -3, max: 3, step: 0.1, reset: 0, title: t('panel.gainTitle') }));
  }
  if (p.scope === 'parade' || p.scope === 'yrgb' || p.scope === 'wf-rgb') {
    row(t('panel.colour'), select(p.paradeColor ?? (p.scope === 'wf-rgb' || p.colorize ? 'channel' : 'mono'),
      [['mono', 'Mono'], ['channel', t('panel.channelColours')], ['source', t('panel.sourceColours')]], (v) => { p.paradeColor = v as PanelState['paradeColor']; save(); }));
  } else if (scatter && p.scope !== 'wf-skin' && p.scope !== 'wf-green' && p.scope !== 'wf-color') {
    row(t('panel.colour'), check('colorize', t('panel.traceInColour')));
  }
  if (isWaveform(p.scope)) {
    global(SET.unit);
    row(t('panel.marks'), check('marks', t('panel.marksText'), true));
    row('EBU R 103', check('r103', t('panel.r103Text')));
    row(t('panel.zoom'), select(p.waveZoom ?? 'full', Object.entries(WAVE_ZOOM_LABELS) as [string, string][], (v) => { p.waveZoom = v as WaveZoom; p.view = undefined; save(); }, t('panel.zoomTitle')));
    const chans = channelsOf(p.scope);
    if (chans.length) {
      row(t('panel.channels'), ...chans.map((c) => checkbox(p.channels?.[c.key] !== false, c.name, (v) => { p.channels = { ...p.channels, [c.key]: v }; save(); })));
    }
    row(t('panel.labels'), checkbox(p.names !== false, t('panel.labelsText'), (v) => { p.names = v; save(); }));
  }
  if (p.scope === 'wf-skin') row(t('panel.skinRange'), check('skinBand', t('panel.skinBand'), true));
  if (p.scope === 'wf-green') row(t('panel.greenRange'), check('greenBand', t('panel.greenBand'), true));
  if (p.scope === 'match') return [...rows, ...matchPanelSettings(p, panelSource(p), matchUi(p))];
  if (p.scope === 'cube') {
    const c = { ...DEFAULT_CUBE, ...p.cube };
    const setCube = (patch: Partial<CubeSettings>) => { p.cube = { ...c, ...patch }; Object.assign(c, patch); save(); };
    row(t('panel.cube.space'), select(c.space, (Object.keys(CUBE_SPACE_LABELS) as CubeSpace[]).map((k) => [k, CUBE_SPACE_LABELS[k]] as [string, string]), (v) => setCube({ space: v as CubeSpace }),
      t('panel.cube.spaceTitle')));
    row(t('panel.cube.wire'), select(c.gamut, [['709', 'Rec.709'], ['p3', 'P3-D65'], ['2020', 'Rec.2020']], (v) => setCube({ gamut: v as CubeSettings['gamut'] }), t('panel.cube.wireTitle')));
    row(t('panel.colour'), check('colorize', t('panel.dotsInColour')));
    row(t('panel.cube.lutVolume'), select(c.lut ?? '', [['', t('common.off')], ...[...LUTS.keys()].map((n) => [n, n] as [string, string])], (v) => setCube({ lut: v || undefined }),
      t('panel.cube.lutTitle')));
    if (c.lut) {
      row(t('panel.cube.grid'), select(String(c.lutGrid ?? 17), [['9', '9³'], ['17', '17³'], ['33', '33³']], (v) => setCube({ lutGrid: Number(v) })));
      row('', checkbox(!!c.lutInput, t('panel.cube.inputGrid'), (v) => setCube({ lutInput: v })), checkbox(!!c.lutOnly, t('panel.cube.lutOnly'), (v) => setCube({ lutOnly: v })));
    }
    rows.push(hint(t('panel.cube.hint')));
  }
  if (p.scope === 'chplot') {
    row(t('panel.channels'), select(String(p.pair ?? 0), CHANNEL_PAIRS.map((n, i) => [String(i), n] as [string, string]), (v) => { p.pair = Number(v); save(); }));
    row(t('panel.colour'), check('colorize', t('panel.dotsInColour')));
  }
  if (p.scope === 'minmax') {
    row(t('panel.minmax.limits'), select(p.minmax?.limits ?? 'r103', [['r103', 'EBU R 103 −5/105 %'], ['legal', t('panel.legal')]], (v) => { p.minmax = { ...p.minmax, limits: v as 'r103' }; save(); }));
    row(t('panel.minmax.targetLines'), textInput((p.minmax?.targets ?? []).join(', '), (val) => { p.minmax = { ...p.minmax, targets: val.split(/[,; ]+/).map(Number).filter((v) => Number.isFinite(v)).slice(0, 4) }; save(); }, { placeholder: t('panel.minmax.targets') }));
  }
  if (p.scope === 'satlum') row(t('panel.colour'), check('colorize', t('panel.dotsInColour')));
  if (p.scope === 'qclog') {
    const q = { ...DEFAULT_QC, ...state.qc };
    const setQc = (patch: Partial<QcSettings>) => { state.qc = { ...q, ...patch }; Object.assign(q, patch); save(); };
    row(t('panel.qc.check'), checkbox(q.on, t('panel.qc.all'), (v) => setQc({ on: v })));
    const shown = new Set(p.qcTypes ?? QC_TYPES);
    rows.push(field('', ...QC_TYPES.map((qt) => checkbox(shown.has(qt), QC_LABELS[qt], (v) => { if (v) shown.add(qt); else shown.delete(qt); p.qcTypes = QC_TYPES.filter((x) => shown.has(x)); save(); }))));
    const qcNum = (value: number, min: number, max: number, set: (v: number) => void) => numberInput(value, set, { min, max, size: 's' });
    row(t('panel.qc.clip'), qcNum(q.clip * 100, 0.1, 10, (v) => setQc({ clip: v / 100 })), t('panel.qc.ofPixels'));
    row(t('panel.qc.black'), qcNum(q.black * 100, 0.5, 10, (v) => setQc({ black: v / 100 })), '% Y′');
    row(t('panel.qc.silence'), qcNum(-q.silenceDb, 30, 90, (v) => setQc({ silenceDb: -v })), '−dBFS');
    row(t('panel.qc.freeze'), qcNum(q.freezeMs / 1000, 0.5, 30, (v) => setQc({ freezeMs: v * 1000 })), 's');
    row('', button(t('panel.qc.csv'), () => download(`lz-scopes-qc-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, toCsv(qcLog.events, p.qcTypes ?? QC_TYPES), 'text/csv;charset=utf-8'), { small: true }),
      button(t('panel.qc.clear'), () => qcLog.clear(), { small: true }));
  }
  if (p.scope === 'timeline') {
    row(t('panel.tl.span'), select(String(p.span ?? 10), [['10', '10 s'], ['60', '1 min'], ['300', '5 min']], (v) => { p.span = Number(v) as PanelState['span']; save(); }));
    row(t('panel.tl.sampling'), checkbox(!!p.everyFrame, t('panel.tl.everyFrame'), (v) => { p.everyFrame = v; save(); }, t('panel.tl.samplingTitle')));
    row(t('panel.tl.grid'), select(String(p.grid ?? 96), GRIDS.map((g) => [String(g), `${g}×${Math.round((g * 9) / 16)}`] as [string, string]), (v) => { p.grid = Number(v); save(); }, t('panel.tl.gridTitle')));
    row('', button(t('panel.tl.clear'), () => panelSource(p)?.history.clear(), { small: true }));
    rows.push(hint(t('panel.tl.hint')));
  }
  if ((p.scope === 'vector' || p.scope === 'hls' || p.scope === 'cie' || p.scope === 'diamond' || p.scope === 'cube' || p.scope === 'satlum' || p.scope === 'chplot') && !p.crt?.on) {
    row(t('panel.persist'), select(String(p.persist ?? 0), [['0', t('common.off')], ['300', `${num(0.3, 1)} s`], ['1000', '1 s'], ['3000', '3 s'], ['10000', '10 s'], ['-1', t('panel.infinite')]], (v) => { p.persist = Number(v); save(); },
      t('panel.persistTitle')));
  }
  if (p.scope === 'cie') row(t('panel.cie.diagram'), check('cieUv', t('panel.cie.uv')));
  if (scatter) {
    const c = { ...DEFAULT_CRT, ...p.crt };
    const setCrt = (patch: Partial<CrtSettings>, rebuild = false) => { p.crt = { ...c, ...patch }; Object.assign(c, patch); save(); if (rebuild) refreshPanelSettings(p); };
    row(t('panel.display'), select(c.on ? 'crt' : 'digital', [['digital', 'digital'], ['crt', t('panel.crt')]], (v) => setCrt({ on: v === 'crt' }, true),
      t('panel.crtTitle')));
    if (c.on) {
      row('Phosphor', select(c.phosphor, (Object.keys(PHOSPHORS) as Phosphor[]).map((k) => [k, PHOSPHORS[k].name] as [string, string]),
        (v) => setCrt({ phosphor: v as Phosphor, persist: PHOSPHORS[v as Phosphor].tau }, true), t('panel.phosphorTitle', { note: PHOSPHORS[c.phosphor].note })));
      const persist = PERSIST_CHOICES.some(([ms]) => ms === c.persist) ? PERSIST_CHOICES : [...PERSIST_CHOICES, [c.persist, `${c.persist} ms`] as [number, string]];
      row(t('panel.persist'), select(String(c.persist), persist.map(([ms, l]) => [String(ms), l] as [string, string]), (v) => setCrt({ persist: Number(v) }), t('panel.crtPersistTitle')));
      row('Glow', slider(c.glow, (v) => setCrt({ glow: v }), { min: 0, max: 1, step: 0.05, title: t('panel.glowTitle') }));
      row(t('panel.beam'), select(String(c.beam), [['1', '1 px'], ['1.5', `${num(1.5, 1)} px`], ['2', '2 px'], ['3', '3 px'], ['4', '4 px']], (v) => setCrt({ beam: Number(v) }), t('panel.beamTitle')));
    } else global(SET.tint, t('panel.monoTint'));
  }
  if (p.scope === 'vector') {
    row(t('panel.vzoom'), select(String(p.zoom), [['1', '×1'], ['2', '×2'], ['5', '×5']], (v) => { p.zoom = Number(v); p.view = undefined; save(); }));
    const gbox = (g: '709' | 'p3' | '2020', label: string) =>
      checkbox((p.gamuts ?? []).includes(g), label, (on) => { const set = new Set(p.gamuts ?? []); if (on) set.add(g); else set.delete(g); p.gamuts = [...set]; save(); });
    row(t('panel.gamutLimits'), gbox('709', '709'), gbox('p3', 'P3'), gbox('2020', '2020'));
    row(t('panel.greenWedge'), check('greenWedge', t('panel.greenWedgeText')));
    rows.push(...targetEditor(panelSource(p), matchUi(p)));
  }
  if (p.scope === 'wf-green' || (p.scope === 'vector' && p.greenWedge) || (p.scope === 'picture' && p.picture === 'green')) rows.push(...greenSettings(greenState(), panelSource(p), matchUi(p), p.scope === 'wf-green'));
  if (p.scope === 'wf-skin' || p.scope === 'vector' || (p.scope === 'picture' && p.picture === 'skin')) {
    global(SET.skinLuma);
    global(SET.skinHue);
    if (p.scope === 'wf-skin') {
      row('', button(t('panel.skin.fromRoi'), () => skinFromRoi(p), { title: t('panel.skin.fromRoiTitle') }));
      rows.push(hint(t('panel.skin.hint')));
    }
  }
  if (p.scope === 'picture' || p.scope === 'wf-skin' || isWaveform(p.scope) || p.scope === 'vector' || p.scope === 'hist') {
    const s = panelSource(p);
    if (s) {
      row(t('panel.faces'), select(s.faceMode, [['off', t('panel.offCap')], ['detect', t('panel.facesDetect')], ['all', t('panel.facesAll')]], (v) => {
        s.faceMode = v as Source['faceMode'];
        if (s.faceMode === 'off') { s.faces = []; s.faceSel.clear(); }
        refreshHeads();      }, t('panel.facesTitle')));
    }
  }
  if (p.scope === 'stats') {
    row(t('panel.hdr10'), button(t('panel.hdr10Reset'), () => { panelSource(p)?.resetLightLevel(); }, { small: true, title: t('panel.hdr10Title') }));
  }
  if (p.scope === 'picture') {
    row('Overlay', select(p.picture, [['normal', t('panel.ov.normal')], ['false', t('settings.scopes.falseColour')], ['zebra', 'Zebra'], ['clip', 'Clipping'], ['skin', t('panel.ov.skin')], ['green', t('panel.ov.green')], ['luma', 'Luma'], ['gamut', t('panel.ov.gamut')], ['r103', 'EBU R 103'], ['neutral', t('panel.ov.neutral')]], (v) => { p.picture = v as PictureMode; save(); refreshHeads(); }));
    const ab = p.ab ?? { mode: 'off' as const, b: 'stage:cst', pos: 0.5, gain: 4 };
    const setAb = (patch: Partial<NonNullable<PanelState['ab']>>, rebuild = false) => {
      p.ab = { ...ab, ...patch }; Object.assign(ab, patch); save(); refreshHeads();
      if (rebuild) refreshPanelSettings(p);
    };
    row(t('panel.ab'), select(ab.mode, [['off', t('common.off')], ['split', 'Split 50 %'], ['wipe', 'Wipe'], ['diff', t('panel.abDiff')]], (v) => setAb({ mode: v as 'off' }, true),
      t('panel.abTitle')));
    if (ab.mode !== 'off') {
      const own = panelSource(p);
      row('B', select(ab.b, [
        ...STAGES.map((st) => [`stage:${st}`, `${own?.name ?? t('panel.source')} · ${STAGE_LABELS[st]}`] as [string, string]),
        ['rgc', p.rgc ? t('panel.abRgcOff') : t('panel.abRgcOn')],
        ...sources.filter((s) => s !== own && s.kind !== 'audio').map((s) => [`src:${s.id}`, s.name] as [string, string]),
      ], (v) => setAb({ b: v })));
      if (ab.mode === 'wipe') {
        row(t('panel.wipePos'), slider(ab.pos ?? 0.5, (v) => setAb({ pos: v }), { min: 0, max: 1, step: 0.01, reset: 0.5 }));
      }
      if (ab.mode === 'diff') row(t('panel.gainAb'), select(String(ab.gain ?? 4), [['1', '×1'], ['4', '×4'], ['16', '×16'], ['64', '×64']], (v) => setAb({ gain: Number(v) }), t('panel.gainAbTitle')));
    }
    row(t('panel.rgc'), checkbox(!!p.rgc, t('panel.rgcPreview'), (v) => { p.rgc = v; save(); refreshHeads(); }, t('panel.rgcTitle')));
    if (p.picture === 'neutral') {
      row(t('panel.threshold'), select(String(p.neutral?.threshold ?? 5), [['2', '2 %'], ['5', '5 %'], ['10', '10 %']], (v) => { p.neutral = { ...p.neutral, threshold: Number(v) }; save(); }, t('panel.neutralTitle')));
      row(t('panel.range'), select(p.neutral?.range ?? 'all', [['all', t('panel.rangeAll')], ['shadows', t('panel.shadows')], ['mids', t('panel.mids')], ['highlights', t('panel.highlights')]], (v) => { p.neutral = { ...p.neutral, range: v as 'all' }; save(); }));
    }
    if (p.picture === 'gamut') row(t('panel.tgtGamut'), select(p.gamutTarget ?? '709', [['709', 'Rec.709'], ['p3', 'P3-D65'], ['2020', 'Rec.2020']], (v) => { p.gamutTarget = v as PanelState['gamutTarget']; save(); }, t('panel.tgtGamutTitle')));
    if (p.picture === 'false') global(SET.falseColour);
    if (p.picture === 'zebra') global(SET.zebra, t('panel.zebraFrom'));
    row(t('panel.clock'), checkbox(!!p.clockOverlay, t('panel.clockText'), (v) => { p.clockOverlay = v; save(); }, t('panel.clockTitle')));
    global(SET.display);
    global(SET.hdrPreview);
    row(t('main.src.audio'), checkbox(p.audioBar !== false, t('panel.audioBar'), (v) => { p.audioBar = v; save(); refreshHeads(); }, t('panel.audioBarTitle')));
    rows.push(hint(t('panel.pictureHint')));
  }
  if (p.scope === 'hist') {
    row(t('panel.display'), select(p.hist, [['rgb', 'RGB'], ['luma', 'Luma'], ['split', t('panel.histSplit')]], (v) => { p.hist = v as PanelState['hist']; save(); }));
    row(t('settings.scopes.scale'), check('log', t('panel.log')));
  }
  if (scatter) global(SET.precision);
  return rows;
}

function refreshHeads() { views.forEach(fillHead); }

/** Header chip while a ROI is active: shows it and switches it off with one click. */
function roiChip(p: PanelState): Node | string {
  const s = panelSource(p);
  if (!s || isLight(p.scope)) return '';
  const n = s.activeRois().length;
  const label = s.faceTrack ? `☺ ${s.faceMode === 'all' ? t('panel.facesAllChip') : n ? t('panel.facesN', { n }) : t('panel.faceClick')} ✕` : t('panel.frameChip');
  if (!s.faceTrack && !s.roi) return '';
  return button(label, () => { s.roi = null; s.faceMode = 'off'; s.faces = []; s.faceSel.clear(); refreshHeads(); }, { small: true, title: t('panel.roiOffTitle'), attrs: { class: 'btn mini roichip' } });
}

// face tracking (MediaPipe is only loaded once someone switches it on)
setInterval(() => {
  if (!sources.some((s) => s.faceTrack)) return;
  import('./face').then((m) => m.trackFaces(sources, refreshHeads));
}, 100);

function toggleSolo(idx: number) {
  dock.toggleMaximize(idx);
}

/** Switching the source in one panel switches every panel that is not pinned. */
function switchSource(from: PanelState, id: string) {
  from.sourceId = id;
  for (const q of state.panels) if (!q.pin) q.sourceId = id;
  save(); renderPanels();
}

function skinFromRoi(p: PanelState) {
  const s = panelSource(p);
  if (!s) return;
  const { kr, kb } = LUMA[s.colorspace];
  const r = s.skinLumaRange(kr, kb, state.skin.tol);
  if (!r) { alertHud(t('panel.skin.none')); return; }
  state.skin.lo = Math.round(r.lo * 100) / 100; state.skin.hi = Math.round(r.hi * 100) / 100;
  save(); renderHeader();
  alertHud(t('panel.skin.set', { lo: Math.round(r.lo * 100), hi: Math.round(r.hi * 100), n: r.n }));
}

function alertHud(msg: string) {
  const el = $('#fps');
  el.textContent = msg;
}

/** A hand-drawn rectangle around a face: ask once whether that face should be tracked. */
async function offerFaceTracking(s: Source, body: HTMLElement) {
  const rect = s.roi;
  if (!rect) return;
  let face: [number, number, number, number] | null = null;
  try { face = await (await import('./face')).faceInRect(s, rect); } catch { return; }
  if (!face || s.roi !== rect) return;
  body.querySelector('.ask')?.remove();
  const ask = h('div', { class: 'ask', role: 'status' }, h('span', {}, t('panel.face.ask')),
    button(t('panel.face.track'), () => {
      ask.remove();
      s.faces = [{ id: -1, box: face! }]; s.faceSel = new Set([-1]); s.faceMode = 'detect'; s.roi = null; refreshHeads();
    }, { variant: 'primary' }),
    button(t('panel.face.frameOnly'), () => ask.remove()));
  body.append(ask);
  setTimeout(() => ask.remove(), 8000);
}

function hitRoiClose(e: PointerEvent, s: Source, body: HTMLElement, p: PanelState) {
  const b = body.getBoundingClientRect();
  const r = contentRect(p, b.width, b.height, s.width / s.height);
  const [x0, y0, x1] = s.roi!;
  const [bx, by] = roiCloseBox(r.x + (x0 / s.width) * r.w, r.y + (y0 / s.height) * r.h, ((x1 - x0) / s.width) * r.w);
  const px = e.clientX - b.left, py = e.clientY - b.top;
  return px >= bx - 4 && px <= bx + ROI_CLOSE + 4 && py >= by - 4 && py <= by + ROI_CLOSE + 4;
}

/**
 * Zoom and pan for every scope (#89, gestures.ts); the 3D volume also rotates (drag: horizontal =
 * yaw, vertical = pitch).
 */
function attachPanelGestures(idx: number, p: () => PanelState, body: HTMLElement) {
  const frame = () => {
    const b = body.getBoundingClientRect(), s = panelSource(p());
    return plotRect(p().scope, b.width, b.height, s?.width ? s.width / s.height : 16 / 9);
  };
  attachGestures(body, {
    limits: () => viewLimits(p().scope),
    view: () => panelView(p()),
    frame,
    set: (v) => { setPanelView(p(), v); syncZoomChip(idx); },
    commit: () => save(),
    blocked: () => shading.owns(p().scope),
    primaryTaken: () => ['picture', 'wf-skin', 'wf-green'].includes(p().scope),
    rotates: () => p().scope === 'cube',
    rotate: (dx, dy) => {
      const c = { ...DEFAULT_CUBE, ...p().cube };
      p().cube = { ...c, yaw: ((c.yaw + dx * 0.5 + 540) % 360) - 180, pitch: Math.max(-90, Math.min(90, c.pitch + dy * 0.5)) };
    },
    wheelTaken: () => p().scope === 'wf-skin' || p().scope === 'wf-green',
    wheelAtCentre: () => p().scope === 'vector' || p().scope === 'hls',
  }, () => { if (!resetView(idx)) toggleSolo(idx); });
}

/** Back to the unzoomed view (3D volume: also the default rotation). False if nothing to reset. */
function resetView(idx: number): boolean {
  const p = state.panels[idx];
  if (!p) return false;
  if (p.scope === 'cube') {
    const c = { ...DEFAULT_CUBE, ...p.cube };
    if (isIdentity(panelView(p)) && c.yaw === DEFAULT_CUBE.yaw && c.pitch === DEFAULT_CUBE.pitch) return false;
    p.cube = { ...c, yaw: DEFAULT_CUBE.yaw, pitch: DEFAULT_CUBE.pitch };
  } else if (isIdentity(panelView(p))) return false;
  setPanelView(p, IDENTITY);
  save(); syncZoomChip(idx);
  return true;
}

/** Zoom chip of a panel: ×2.5 while zoomed. */
function syncZoomChip(idx: number) {
  const v = views.get(idx), p = state.panels[idx];
  if (!v || !p) return;
  const z = viewLimits(p.scope) ? panelView(p).z : 1;
  const on = viewLimits(p.scope) !== null && !isIdentity(panelView(p));
  v.zoom.hidden = !on;
  v.zoom.textContent = on ? `${zoomLabel(z)} ⟲` : '';
  v.zoom.dataset.zoom = String(Math.round(z * 1000) / 1000);
}

/** Skin and green waveforms: drag the lo/hi lines, mouse wheel = hue tolerance. */
function attachSkinDrag(p: PanelState, body: HTMLElement) {
  const range = () => (p.scope === 'wf-skin' ? state.skin : p.scope === 'wf-green' ? greenState() : null);
  const levelAt = (e: PointerEvent | WheelEvent) => {
    const b = body.getBoundingClientRect();
    const r = plotRect(p.scope, b.width, b.height);
    return waveLevel(r, e.clientY - b.top, waveRangeOf(p));
  };
  let which: 'lo' | 'hi' | null = null;
  body.addEventListener('pointerdown', (e) => {
    const q = range();
    if (!q || e.button !== 0) return;
    const v = levelAt(e);
    which = Math.abs(v - q.lo) < Math.abs(v - q.hi) ? 'lo' : 'hi';
    try { body.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    q[which] = Math.min(1.05, Math.max(0, v));
  });
  body.addEventListener('pointermove', (e) => {
    const q = range();
    if (!which || !q) return;
    const v = Math.min(1.05, Math.max(0, levelAt(e)));
    q[which] = v;
    if (q.lo > q.hi) { const t = q.lo; q.lo = q.hi; q.hi = t; which = which === 'lo' ? 'hi' : 'lo'; }
  });
  body.addEventListener('pointerup', () => { if (which) { which = null; save(); renderHeader(); } });
  body.addEventListener('lzs-gesture-cancel', () => { if (which) { which = null; save(); } });
  body.addEventListener('wheel', (e) => {
    const q = range();
    // trackpad pinch and scroll zoom/pan (gestures.ts); the mouse wheel sets the tolerance
    if (!q || classifyWheel(e as WheelEvent & { wheelDeltaY?: number }) !== 'wheel') return;
    e.preventDefault();
    q.tol = Math.min(p.scope === 'wf-green' ? 60 : 45, Math.max(2, q.tol + (e.deltaY < 0 ? 1 : -1)));
    save();
  }, { passive: false });
}

/** Picture panel: click = probe, drag = region of interest (highlighted in all scopes). */
function attachPointer(p: PanelState, body: HTMLElement) {
  const toSrc = (e: PointerEvent, s: Source, clamp: boolean) => {
    const b = body.getBoundingClientRect();
    const r = contentRect(p, b.width, b.height, s.width / s.height);
    let fx = (e.clientX - b.left - r.x) / r.w, fy = (e.clientY - b.top - r.y) / r.h;
    if (!clamp && (fx < 0 || fy < 0 || fx > 1 || fy > 1)) return null;
    fx = Math.min(1, Math.max(0, fx)); fy = Math.min(1, Math.max(0, fy));
    return { x: Math.min(s.width - 1, Math.floor(fx * s.width)), y: Math.min(s.height - 1, Math.floor(fy * s.height)) };
  };
  let start: { x: number; y: number; cx: number; cy: number; roi: Source['roi'] } | null = null;
  // a pinch began after the first finger: put the ROI back as it was, no probe
  body.addEventListener('lzs-gesture-cancel', () => { const s = panelSource(p); if (start && s) s.roi = start.roi; start = null; });
  body.addEventListener('pointerdown', (e) => {
    const s = panelSource(p);
    if (p.scope !== 'picture' || !s?.width || e.button !== 0) return;
    if (s.roi && !s.faceTrack && hitRoiClose(e, s, body, p)) { s.roi = null; refreshHeads(); return; }
    const pt = toSrc(e, s, false);
    if (pt && s.faceTrack) {
      const hit = s.faces.find(({ box: f }) => pt.x >= f[0] && pt.x < f[2] && pt.y >= f[1] && pt.y < f[3]);
      if (hit) {
        if (s.faceMode === 'all') { s.faceMode = 'detect'; s.faceSel = new Set([hit.id]); }
        else if (s.faceSel.has(hit.id)) s.faceSel.delete(hit.id); else s.faceSel.add(hit.id);
        refreshHeads(); return;
      }
    }
    if (!pt) return;
    start = { ...pt, cx: e.clientX, cy: e.clientY, roi: s.roi };
    try { body.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
  });
  body.addEventListener('pointermove', (e) => {
    const s = panelSource(p);
    if (!start || !s) return;
    if (Math.hypot(e.clientX - start.cx, e.clientY - start.cy) < 5) return;
    const pt = toSrc(e, s, true)!;
    if (s.faceTrack) { s.faceMode = 'off'; s.faces = []; s.faceSel.clear(); }
    s.roi = [Math.min(start.x, pt.x), Math.min(start.y, pt.y), Math.max(start.x, pt.x) + 1, Math.max(start.y, pt.y) + 1];
  });
  body.addEventListener('pointerup', (e) => {
    const s = panelSource(p);
    if (start && s && Math.hypot(e.clientX - start.cx, e.clientY - start.cy) < 5) s.probe = { x: start.x, y: start.y };
    else if (start && s?.roi) { s.faceMode = 'off'; s.faces = []; s.faceSel.clear(); refreshHeads(); offerFaceTracking(s, body); }
    start = null;
  });
}

// ---------------------------------------------------------------- transport (video files)

/** The video file shown in the most panels (fallback: any video file). */
function activeVideo(): Source | null {
  const shown = openViews().map((v) => panelSource(state.panels[v.idx])).filter((s): s is Source => !!s && s.isVideoFile);
  return shown[0] ?? sources.find((s) => s.isVideoFile) ?? null;
}

function transportControls(s: Source): Node[] {
  const range = slider(0, (val) => { const v = s.video; if (v && v.duration) { v.pause(); s.seek((val / 1000) * v.duration); } }, { min: 0, max: 1000, step: 1, title: 'Playhead', attrs: { class: 'playhead', 'data-src': s.id } });
  const btn = (label: string, title: string, fn: () => void) => iconButton(label, title, fn, { small: true });
  return [
    row(range),
    h('div', { class: 'row transport', role: 'toolbar', 'aria-label': 'Transport' },
      btn('⏮', t('main.tp.start'), () => s.seek(0)),
      btn('◀◀', t('main.tp.rev'), () => s.shuttle(-1)),
      btn('◀|', t('main.tp.back'), () => s.step(-1)),
      btn(s.video?.paused === false ? '❚❚' : '▶', t('main.tp.play'), () => s.togglePlay()),
      btn('|▶', t('main.tp.fwdFrame'), () => s.step(1)),
      btn('▶▶', t('main.tp.fwd'), () => s.shuttle(1)),
      h('span', { class: 'tc', 'data-tc': s.id }, s.timecode())),
  ];
}

/** Move playheads and timecodes without re-rendering the source list. */
function updateTransport() {
  for (const s of sources) {
    const v = s.video;
    if (!v || !s.isVideoFile) continue;
    const r = document.querySelector<HTMLInputElement>(`input.playhead[data-src="${s.id}"]`);
    if (r && document.activeElement !== r && v.duration) r.value = String(Math.round((v.currentTime / v.duration) * 1000));
    const tc = document.querySelector<HTMLElement>(`[data-tc="${s.id}"]`);
    if (tc) tc.textContent = `${s.timecode()} / ${s.timecode(v.duration || 0)}${v.playbackRate !== 1 ? ` ×${v.playbackRate}` : ''}${s.reverseSpeed ? ` ◀×${s.reverseSpeed}` : ''}`;
  }
}

// ---------------------------------------------------------------- render loop

let lastStats = 0, lastQc = 0;
/** freeze detection per source: last fingerprint and since when it is unchanged */
const qcFreeze = new Map<string, { fp: string; since: number }>();
/** QC log (qclog.ts): four checks per second on every live source */
function runQc(now: number) {
  const s0 = { ...DEFAULT_QC, ...state.qc };
  if (!s0.on) return;
  for (const s of sources) {
    if (s.status !== 'live' || !s.ready) { qcLog.closeSource(s.id); continue; }
    const { kr, kb } = LUMA[s.colorspace]; s.updateStats(kr, kb);
    const live = s.kind === 'stream' || s.kind === 'webcam' || s.kind === 'screen' || (s.kind === 'file' && !!s.video && !s.video.paused);
    // freeze check only where pictures are expected to change
    const f = live ? s.cpuFrame() : null, fp = f ? frameFingerprint(f.px, f.w, f.h, f.decode) : '';
    const fz = qcFreeze.get(s.id);
    if (!fz || fz.fp !== fp) qcFreeze.set(s.id, { fp, since: now });
    const a = s.audio && !s.audio.stale ? s.audio : null;
    let peak: number | null = null;
    if (a) { let tp = 0; for (let c = 0; c < a.channels; c++) tp = Math.max(tp, a.level.truePeakOver(c, s0.silenceMs)); peak = tp > 0 ? 20 * Math.log10(tp) : -Infinity; }
    // R 103 only means something on the unclipped Y′CbCr path (R′G′B′ sources are clipped to 0–100 %)
    const cond = evaluateQc({ stats: s.stats, r103: s.yuv ? s.r103Stats() : null, peakDb: peak, unchangedMs: now - (qcFreeze.get(s.id)?.since ?? now), freezeApplies: live && !s.frozen }, s0);
    qcLog.update(s.id, s.name, cond, s.tc?.tc ?? null);
  }
}
let needClear = true;
const panelSigs = new Map<number, string>();

function frame(now: number) {
  requestAnimationFrame(frame);
  drawAll(now);
  fpsFrames++;
  if (now - fpsT >= 1000) {
    displayFps = Math.round((fpsFrames * 1000) / (now - fpsT)); fpsFrames = 0; fpsT = now;
    $('#fps').textContent = `${displayFps} fps`;
    updateLatencyChips();
    updateSourceFps();
  }
}

/**
 * Pictures per second a camera or capture really delivers (requestVideoFrameCallback). Cameras
 * lengthen the exposure in low light and then send fewer pictures than promised.
 */
function updateSourceFps() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-srcfps]')) {
    const s = sources.find((x) => x.id === el.dataset.srcfps);
    if (!s || s.status !== 'live') continue;
    const slow = s.nominalFps > 0 && s.fps < s.nominalFps * 0.8;
    el.textContent = t('main.src.deliveredFps', { fps: s.fps, nominal: s.nominalFps || '?' });
    el.classList.toggle('warn', slow);
    el.title = slow ? t('main.src.deliveredSlow', { nominal: s.nominalFps }) : t('main.src.deliveredTitle');
  }
}

/**
 * Low-latency mode: draw a bridge frame when it arrives instead of at the next animation
 * frame (measured in docs/research/low-latency.md). The next animation frame then finds
 * the panels unchanged and skips them. Debug switch: {"drawOnArrive":false}.
 */
Source.onArrive = (s) => {
  if (!s.lowLatency || !s.llConfig.drawOnArrive || debugFlags().drawOnArrive === false || document.hidden) return;
  drawAll(performance.now());
};

function drawAll(now: number) {
  const g = grid.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const displaySpace = state.display === 'auto' ? detected.space : state.display;
  renderer.setOutputSpace(displaySpace === 'p3' ? 'display-p3' : 'srgb');
  if (renderer.resize(g.width, g.height, dpr)) needClear = true;
  renderer.beginFrame(needClear);
  if (needClear) { panelSigs.clear(); needClear = false; }
  updateTransport();

  // CPU statistics every 100 ms; low-latency sources at their own rate (fewer main-thread stalls)
  if (now - lastQc > 250) { lastQc = now; runQc(now); }
  if (now - lastStats > 100) {
    lastStats = now;
    const used = new Set(openViews().map((v) => panelSource(state.panels[v.idx])).filter(Boolean) as Source[]);
    used.forEach((s) => {
      const every = s.kind === 'stream' && s.lowLatency ? s.llConfig.statsMs : 100;
      if (now - (statsAt.get(s) ?? -Infinity) < every - 1) return;
      statsAt.set(s, now);
      const { kr, kb } = LUMA[s.colorspace]; s.updateStats(kr, kb);
    });
  }
  // timeline panels: 10 samples per second of their sources (history.ts)
  for (const v of openViews()) { const p = state.panels[v.idx]; if (p.scope === 'timeline') panelSource(p)?.sampleHistory(now, { everyFrame: !!p.everyFrame, grid: p.grid }); }

  // CRT persistence still fading: redraw those panels although nothing else changed
  for (const k of renderer.settling) panelSigs.delete(Number(k.slice(1)));
  for (const v of openViews()) {
    const p = state.panels[v.idx];
    const src = panelSource(p);
    const b = v.body.getBoundingClientRect();
    if (b.width < 4 || b.height < 4) continue; // hidden tab
    const bodyRect = { x: b.left - g.left, y: b.top - g.top, w: b.width, h: b.height };
    const opts = drawOptions();
    // Skip panels whose inputs did not change: no GPU work, no overlay redraw.
    const sig = panelSignature(p, src, bodyRect, opts) + dpr + shading.sig();
    if (panelSigs.get(v.idx) === sig) continue;
    panelSigs.set(v.idx, sig);
    syncZoomChip(v.idx);
    if (src?.latency.waiting && !drawnSources.has(src)) drawnSources.set(src, Date.now());
    const W = Math.round(b.width * dpr), H = Math.round(b.height * dpr);
    for (const c of [v.overlay, v.blit]) if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = v.overlay.getContext('2d', { colorSpace: displaySpace === 'p3' ? 'display-p3' : 'srgb' })!; // colour space fixed at first use (light-swatch reads it)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, b.width, b.height);
    renderer.clearRect(bodyRect, [0.043, 0.047, 0.055]);
    drawPanel(renderer, ctx, `p${v.idx}`, p, src, bodyRect, opts);
    shading.drawOverlay(ctx, v.idx, p, b.width, b.height);
    // The WebGL canvas is off-screen; copy this panel's region into its own canvas.
    v.blit.getContext('2d')!.drawImage(glCanvas, Math.round(bodyRect.x * dpr), Math.round(bodyRect.y * dpr), W, H, 0, 0, W, H);
  }
  // latency: a stamped frame counts as drawn once all its panels were issued (src/latency.ts)
  if (drawnSources.size) {
    const end = Date.now();
    drawnSources.forEach((start, s) => s.latency.drawn(start, end));
    drawnSources.clear();
  }
}
const drawnSources = new Map<Source, number>();
const statsAt = new WeakMap<Source, number>();

/** Panel-head chip "Low Latency · 104 ms": mode plus the measured latency (stamped test pictures only). */
function latencyChip(p: PanelState): Node | string {
  const s = panelSource(p);
  if (!s || s.kind !== 'stream' || !s.lowLatency) return '';
  return chip(latencyChipText(s), { cls: 'llchip', title: LOW_LATENCY_HINT, attrs: { 'data-src': s.id } });
}
function latencyChipText(s: Source) {
  const l = s.latency.summary();
  return l ? `Low Latency · ${Math.round(l.total.mean)} ms` : 'Low Latency';
}
function updateLatencyChips() {
  document.querySelectorAll<HTMLElement>('.llchip').forEach((el) => {
    const s = sources.find((x) => x.id === el.dataset.src);
    if (s) el.textContent = latencyChipText(s);
  });
  document.querySelectorAll<HTMLElement>('.llmeasure').forEach((el) => {
    const s = sources.find((x) => x.id === el.dataset.llsrc);
    if (s) el.textContent = latencyMeasureText(s);
  });
}
/** Measured latency next to the mode switch in the source card. */
function latencyMeasureText(s: Source) {
  const l = s.latency.summary();
  return l ? t('main.ll.measured', { mean: Math.round(l.total.mean), min: Math.round(l.total.min), max: Math.round(l.total.max) }) : t('main.ll.notMeasured');
}

/**
 * The four low-latency settings as [label, select]. `inherit` adds a "global" choice per
 * field (source card); without it the values are the global ones (Settings menu).
 */
function lowLatencyFields(cfg: Partial<LowLatencyConfig>, inherit: boolean, set: (patch: Partial<LowLatencyConfig>) => void): [string, HTMLElement][] {
  const g = { ...DEFAULT_LOW_LATENCY, ...Source.globalLowLatencyConfig };
  const opt = <K extends keyof LowLatencyConfig>(k: K, options: [string, string][], parse: (v: string) => LowLatencyConfig[K], label: (v: LowLatencyConfig[K]) => string) => {
    const cur = cfg[k];
    const list: [string, string][] = inherit ? [['', `global (${label(g[k])})`], ...options] : options;
    return select(cur === undefined ? (inherit ? '' : String(g[k])) : String(cur), list, (v) => set({ [k]: v === '' ? undefined : parse(v) } as Partial<LowLatencyConfig>));
  };
  const onOff: [string, string][] = [['1', t('common.on')], ['0', t('common.off')]];
  const yes = (v: boolean) => (v ? t('common.on') : t('common.off'));
  const field = (label: string, hint: string, el: HTMLElement): [string, HTMLElement] => { el.title = hint; return [label, el]; };
  return [
    field(t('main.ll.width'), t('main.ll.widthHint'), opt('width', LL_WIDTHS, Number, (v) => (v ? `${v} px` : t('main.native')))),
    field(t('main.ll.draw'), t('main.ll.drawHint'), opt('drawOnArrive', onOff, (v) => v === '1', yes)),
    field(t('main.ll.rtp'), t('main.ll.rtpHint'), opt('ownRtp', onOff, (v) => v === '1', yes)),
    field(t('main.ll.stats'), t('main.ll.statsHint'), opt('statsMs', LL_STATS, Number, (v) => `${v} ms`)),
  ];
}

function setGlobalLowLatencyConfig(patch: Partial<LowLatencyConfig>) {
  state.ll = { ...state.ll, ...patch };
  Source.globalLowLatencyConfig = state.ll; save();
  for (const s of sources) if (s.kind === 'stream' && s.lowLatency && s.status !== 'idle') s.connectStream(s.url, bridgeUrl());
  renderHeader(); renderSources(); refreshHeads();
}

const LOW_LATENCY_HINT = t('main.ll.hint');

function setGlobalLowLatency(on: boolean) {
  state.lowLatency = on; Source.globalLowLatency = on; save();
  for (const s of sources) if (s.kind === 'stream' && s.settings.lowLatency === undefined && s.status !== 'idle') s.connectStream(s.url, bridgeUrl());
  renderSources(); refreshHeads();
}

/** Green qualifier state (created with defaults on first use). */
function greenState(): SkinRange { return (state.green ??= { ...GREEN_DEFAULT }); }

/** Hooks of the colour-target UI (match/ui.ts) for one panel's menu. */
function matchUi(p: PanelState): MatchUi {
  return {
    targets: state.targets, sources, save: () => { save(); refreshHeads(); }, alert: alertHud,
    refresh: () => refreshPanelSettings(p),
  };
}

function drawOptions(): DrawOptions {
  const displaySpace = state.display === 'auto' ? detected.space : state.display;
  return {
    unit: state.unit, tint: state.tint, maxSamples: state.maxSamples, falsePreset: state.falsePreset,
    zebra: state.zebra, zebraLow: state.zebraLow, frozen, displayFps, skin: state.skin, green: greenState(), display: displaySpace, hdrPreview: state.hdrPreview, targets: state.targets,
    stage: state.stage ?? 'signal',
    sourceById: (id) => sources.find((s) => s.id === id) ?? null,
    deRef: state.deRef ?? 'off',
  };
}

function setStage(st: Stage) {
  state.stage = st; save(); renderHeader(); refreshHeads(); needClear = true;
  alertHud(t('main.stageSet', { stage: STAGE_LABELS[st] }));
}

// ---------------------------------------------------------------- saved layout configurations

const LAYOUTS_KEY = 'lz-scopes.layouts';
interface LayoutConfig {
  dock: unknown; panels: PanelState[];
  /** overlay scenes (#1); older files have none */
  scenes?: OverlayScene[]; activeScene?: string;
  settings: Pick<Persisted, 'unit' | 'tint' | 'skin' | 'green' | 'falsePreset' | 'zebra' | 'zebraLow' | 'display' | 'hdrPreview' | 'maxSamples' | 'targets' | 'stage'> & { theme?: UiTheme };
  /** CST/LUT chain per source, by source name (LUT files themselves stay in the browser's LUT store) */
  chains?: Record<string, ChainSettings>;
  saved: string;
}
function loadLayouts(): Record<string, LayoutConfig> {
  try { return JSON.parse(localStorage.getItem(LAYOUTS_KEY) ?? '{}'); } catch { return {}; }
}
function storeLayouts(l: Record<string, LayoutConfig>) {
  try { localStorage.setItem(LAYOUTS_KEY, JSON.stringify(l)); } catch { /* ignore */ }
}
function currentLayout(): LayoutConfig {
  const { unit, tint, skin, green, falsePreset, zebra, zebraLow, display, hdrPreview, maxSamples, targets, stage, theme } = state;
  const chains = Object.fromEntries(sources.filter((s) => s.settings.chain).map((s) => [s.name, structuredClone(s.settings.chain!)]));
  return { dock: dock.layoutJSON(), panels: structuredClone(state.panels), scenes: structuredClone(state.scenes), activeScene: state.activeScene, settings: structuredClone({ unit, tint, skin, green, falsePreset, zebra, zebraLow, display, hdrPreview, maxSamples, targets, stage, theme }), chains, saved: new Date().toISOString() };
}
function applyLayout(c: LayoutConfig) {
  // mutate in place: panel views hold references to their state objects
  c.panels.forEach((p, i) => { if (state.panels[i]) { delete state.panels[i].stage; Object.assign(state.panels[i], p); } else state.panels.push(p); });
  Object.assign(state, structuredClone(c.settings));
  // older configurations have no skin: keep the current one
  if (!isTheme(state.theme)) state.theme = DEFAULT_THEME;
  applyTheme(state.theme);
  for (const [name, chain] of Object.entries(c.chains ?? {})) {
    const s = sources.find((x) => x.name === name);
    if (!s) continue;
    s.settings.chain = structuredClone(chain);
    [chain.lut1, chain.lut2].forEach((n) => { if (n) ensureLut(n).then(() => { refreshHeads(); needClear = true; }); });
  }
  renderSources();
  if (c.scenes) {
    // merge by id, in place: open output windows hold the scene objects
    for (const sc of sanitizeScenes(c.scenes)) {
      const have = state.scenes.find((x) => x.id === sc.id);
      if (have) Object.assign(have, sc); else state.scenes.push(sc);
    }
    if (c.activeScene && state.scenes.some((x) => x.id === c.activeScene)) state.activeScene = c.activeScene;
  }
  if (!dock.restore(c.dock)) dock.applyPreset(state.layout);
  state.dock = dock.layoutJSON();
  save(); renderHeader(); refreshHeads(); needClear = true;
}

const downloadJson = (obj: unknown, fname: string) => download(fname, JSON.stringify(obj, null, 2), 'application/json');
/** Choose a layout file and add its configurations; then `done`. */
function importLayouts(done: () => void = () => {}) {
  filePicker('application/json,.json', async ([f]) => {
    try {
      const data = JSON.parse(await f.text());
      const entries: Record<string, LayoutConfig> = data.panels ? { [f.name.replace(/\.json$/i, '')]: data } : data;
      storeLayouts({ ...loadLayouts(), ...entries }); done();
      alertHud(t('main.lay.imported', { n: Object.keys(entries).length }));
    } catch (e) { alertHud(t('main.lay.importFailed', { error: (e as Error).message })); }
  }).pick();
}

function renderLayoutMenu() {
  const all = loadLayouts();
  const saveAs = () => {
    const n = name.value.trim();
    if (!n) return;
    all[n] = currentLayout(); storeLayouts(all); state.layoutName = n; save(); renderLayoutMenu();
  };
  const name = textInput('', () => {}, { placeholder: t('main.lay.namePh'), onEnter: saveAs });
  const names = Object.keys(all).sort((a, b) => a.localeCompare(b));
  layoutDialog.setBody(
    hint(t('main.lay.hint')),
    ...(names.length ? names.map((n) => h('div', { class: 'field lay' },
      button(n, () => { applyLayout(all[n]); state.layoutName = n; save(); layoutDialog.close(); },
        { title: t('main.lay.load', { date: new Date(all[n].saved).toLocaleString(lang() === 'de' ? 'de-DE' : 'en-GB') }), pressed: n === state.layoutName, attrs: { class: `lname${n === state.layoutName ? ' on' : ''}` } }),
      iconButton('↻', t('main.lay.overwrite'), () => { all[n] = currentLayout(); storeLayouts(all); renderLayoutMenu(); }, { small: true }),
      iconButton('⤓', t('main.lay.export'), () => downloadJson(all[n], `lz-scopes-layout-${n}.json`), { small: true }),
      iconButton('✕', t('main.lay.delete'), () => { delete all[n]; storeLayouts(all); renderLayoutMenu(); }, { small: true })))
      : [hint(t('main.lay.none'))]),
    row(name, button(t('main.lay.save'), saveAs, { variant: 'primary' })),
    row(
      button(t('main.lay.exportAll'), () => downloadJson(all, 'lz-scopes-layouts.json')),
      button(t('main.lay.import'), () => importLayouts(renderLayoutMenu))),
  );
}

// ---------------------------------------------------------------- outputs

// The output windows read live sources and settings from here (same origin).
(window as unknown as { lzs: OutputHost }).lzs = {
  panels: state.panels,
  panelRects: () => {
    const g = grid.getBoundingClientRect();
    return openViews().map((v) => {
      const b = v.body.getBoundingClientRect();
      return { idx: v.idx, x: (b.left - g.left) / g.width, y: (b.top - g.top) / g.height, w: b.width / g.width, h: b.height / g.height };
    }).filter((r) => r.w > 0.001);
  },
  panelSource,
  source: (id) => sources.find((s) => s.id === id) ?? null,
  sources: () => sources.map((s) => ({ id: s.id, name: s.name })),
  drawOptions,
  bridgeUrl,
  sceneFor: (name, fallbackId) => {
    const id = outWins.get(name)?.scene || fallbackId || state.activeScene;
    return state.scenes.find((s) => s.id === id) ?? state.scenes[0] ?? null;
  },
  sceneChanged: () => { clearTimeout(sceneSave); sceneSave = window.setTimeout(save, 300); },
};
let sceneSave = 0;

interface DesktopApi {
  displays: () => Promise<{ id: number; label: string; bounds: { width: number; height: number }; primary: boolean }[]>;
  captureSources?: () => Promise<{ id: string; name: string; thumb: string }[]>;
  watchFolder?: () => Promise<{ name: string; url: string } | null>;
}
const desktop = (window as unknown as { lzsDesktop?: DesktopApi }).lzsDesktop;
/** DaVinci Resolve during playback (#88), see src/resolvePlayback.ts */
const resolvePlayback = attachResolvePlayback({
  captureSources: desktop?.captureSources,
  localBridge: () => isLocalHost(bridgeUrl()),
  changed: () => renderSources(),
});

interface OutputOptions { name: string; view: string; idx: string; src: string; scene: string; bg: string; display: string; fs: boolean; stream: string; target: string; codec?: string }
/** Open output windows by name (control API: output.close, scene.select, stream.*). */
const outWins = new Map<string, { win: Window; view: string; scene: string }>();
const liveOutputs = () => { for (const [n, o] of outWins) if (o.win.closed) outWins.delete(n); return outWins; };
const outApi = (w: Window) => { try { return (w as unknown as { lzsOut?: OutputWindowApi }).lzsOut ?? null; } catch { return null; } };
const activeSceneObj = () => state.scenes.find((s) => s.id === state.activeScene) ?? state.scenes[0];

async function renderOutputMenu() {
  const out: OutputOptions = { name: '', view: 'grid', idx: String(dock.openIdx()[0] ?? 0), src: sources[0]?.id ?? '', scene: activeSceneObj()?.id ?? '', bg: 'picture', display: '', fs: true, stream: '', target: '' };
  const screens: [string, string][] = [['', t('main.out.newWindow')]];
  if (desktop) {
    for (const d of await desktop.displays()) screens.push([String(d.id), `${d.label || t('main.out.screen')} ${d.bounds.width}×${d.bounds.height}${d.primary ? t('main.out.main') : ''}`]);
  }
  const txt = (key: 'stream' | 'target' | 'name', ph: string) => textInput('', (v) => (out[key] = v.trim()), { placeholder: ph, live: true });
  const sceneName = textInput('', () => {}, { placeholder: t('main.out.sceneName') });
  const newScene = (copy: boolean) => {
    const base = copy ? state.scenes.find((s) => s.id === out.scene) : null;
    const sc: OverlayScene = base ? { ...structuredClone(base), id: newId(), name: sceneName.value.trim() || t('main.out.copyOf', { name: base.name }) } : defaultScene(sceneName.value.trim() || t('main.out.sceneN', { n: state.scenes.length + 1 }));
    state.scenes.push(sc); state.activeScene = sc.id; save(); renderOutputMenu();
  };
  const delScene = () => {
    if (state.scenes.length < 2) return;
    state.scenes.splice(state.scenes.findIndex((s) => s.id === out.scene), 1);
    if (!state.scenes.some((s) => s.id === state.activeScene)) state.activeScene = state.scenes[0].id;
    save(); renderOutputMenu();
  };
  // which ffmpeg pushes, and for srt:// whether it can (bridge /api/health)
  const pushHint = h('span', { class: 'hint', 'data-ffmpeg-push': '' }, '');
  const targetIn = txt('target', 'optional: rtmp:// srt:// rtsp:// udp://');
  const showPush = () => { pushHint.textContent = pushFfmpegText(out.target, bridgeHealth); pushHint.title = bridgeHealth?.ffmpegSrt?.path ?? bridgeHealth?.ffmpeg?.path ?? ''; };
  targetIn.addEventListener('input', showPush);
  refreshFfmpegInfo().then(showPush);
  const open = [...liveOutputs().entries()];
  const row = field;
  outputDialog.setBody(
    row(t('main.out.content'), select(out.view, [['grid', t('main.out.grid')], ['panel', t('main.out.panel')], ['clean', t('main.out.clean')], ['overlay', t('main.out.overlay')]], (v) => (out.view = v))),
    row(t('main.out.panelRow'), select(out.idx, dock.openIdx().map((i) => [String(i), panelTitle(i)]), (v) => (out.idx = v))),
    row(t('panel.source'), select(out.src, sources.map((s, i) => [s.id, `${i + 1} ${s.name}`]), (v) => (out.src = v))),
    row(t('main.out.scene'), select(out.scene, state.scenes.map((s) => [s.id, `${s.name} (${s.elements.length})`]), (v) => { out.scene = v; state.activeScene = v; save(); }, t('main.out.sceneTitle')),
      iconButton('✕', t('main.out.sceneDel'), delScene, { small: true })),
    row('', sceneName, button(t('main.out.sceneNew'), () => newScene(false), { small: true, title: t('main.out.sceneNewTitle') }), button(t('main.out.sceneCopy'), () => newScene(true), { small: true, title: t('main.out.sceneCopyTitle') })),
    row(t('main.out.bg'), select(out.bg, [['picture', t('main.out.bgPicture')], ['black', t('main.out.bgBlack')]], (v) => (out.bg = v))),
    row(t('main.out.target'), select('', screens, (v) => (out.display = v)), checkbox(true, t('main.full'), (v) => (out.fs = v))),
    row(t('main.out.nameRow'), txt('name', t('main.out.name'))),
    row(t('main.out.streamName'), txt('stream', t('main.out.streamPh'))),
    row(t('main.out.push'), targetIn),
    row('', pushHint),
    row('', button(t('main.out.open'), () => openOutputView(out), { variant: 'primary' })),
    ...(open.length ? [kicker(t('main.out.openList')), ...open.map(([n, o]) => row(n,
      h('span', { class: 'hint' }, `${o.view}${o.view === 'overlay' ? ` · ${state.scenes.find((s) => s.id === o.scene)?.name ?? ''}` : ''}${outApi(o.win)?.stream() ? ` · Stream ${outApi(o.win)!.stream()}` : ''}`),
      iconButton('✕', t('common.close'), () => { o.win.close(); outWins.delete(n); renderOutputMenu(); }, { small: true })))] : []),
    hint(`${desktop ? t('main.out.hintDesktop') : t('main.out.hintBrowser')} ${t('main.out.hintOverlay')}`),
  );
}

function openOutputView(o: OutputOptions): string {
  let name = o.name.replace(/[^\w-]/g, '').slice(0, 40);
  if (!name) { let n = 1; while (liveOutputs().has(`out${n}`)) n++; name = `out${n}`; }
  outWins.get(name)?.win.close();
  const q = new URLSearchParams({ view: o.view, name });
  if (o.view === 'panel') q.set('idx', o.idx);
  if (o.view === 'clean' || o.view === 'overlay') q.set('src', o.src);
  if (o.view === 'overlay') { q.set('scene', o.scene); q.set('bg', o.bg); }
  if (o.stream) { q.set('stream', o.stream.replace(/[^\w-]/g, '')); if (o.target) q.set('target', o.target); if (o.codec) q.set('codec', o.codec); }
  if (o.display) q.set('display', o.display);
  if (o.fs) q.set('fs', '1');
  const win = window.open(`${location.pathname}?${q}`, `lzs-out-${name}`, 'popup,width=1280,height=720');
  if (!win) throw new Error(t('main.out.blocked'));
  outWins.set(name, { win, view: o.view, scene: o.view === 'overlay' ? o.scene : '' });
  return name;
}

function snapshot() {
  const g = grid.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const c = document.createElement('canvas');
  c.width = Math.round(g.width * dpr); c.height = Math.round(g.height * dpr);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, c.width, c.height);
  for (const v of openViews()) {
    const b = v.body.getBoundingClientRect();
    if (b.width < 4) continue;
    ctx.drawImage(v.blit, (b.left - g.left) * dpr, (b.top - g.top) * dpr);
    ctx.drawImage(v.overlay, (b.left - g.left) * dpr, (b.top - g.top) * dpr);
  }
  c.toBlob((b) => { if (b) download(`lz-scopes-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`, b); }, 'image/png');
}

// ---------------------------------------------------------------- remote control (Companion, docs/control-api.md)

/** Source by 1-based number, id or name. */
function findSource(ref: unknown): Source | null {
  if (typeof ref === 'number') return sources[ref - 1] ?? null;
  const low = String(ref).toLowerCase();
  return sources.find((s) => s.id === ref) ?? sources.find((s) => s.name.toLowerCase() === low) ?? null;
}
function panelIndex(ref: unknown): number {
  const i = typeof ref === 'number' ? ref - 1 : Number(String(ref).replace(/^p/i, '')) - 1;
  if (!Number.isInteger(i) || i < 0 || i >= state.panels.length) throw new Error(`Panel ${ref} does not exist (1–${state.panels.length})`);
  return i;
}
/** Source shown by the most open panels. */
function activeSource(): Source | null {
  const count = new Map<Source, number>();
  for (const v of openViews()) { const s = panelSource(state.panels[v.idx]); if (s) count.set(s, (count.get(s) ?? 0) + 1); }
  return [...count.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? sources[0] ?? null;
}
const maximizedPanel = () => { const p = dock.api.panels.find((x) => x.api.isMaximized()); return p ? panelIdx(p.id) + 1 : null; };

// Control API (docs/control-api.md): errors are API answers for Companion and scripts, in English.
function execute(c: Command): unknown {
  const need = <T,>(v: T | null | undefined, msg: string): T => { if (v === null || v === undefined) throw new Error(msg); return v; };
  const mode = (cur: boolean) => (c.mode === 'toggle' ? !cur : c.mode === 'on');
  switch (c.cmd) {
    case 'state': return controlState();
    case 'source.select': {
      const s = need(findSource(c.source), `Source ${c.source} not found`);
      if (c.panel !== undefined) state.panels[panelIndex(c.panel)].sourceId = s.id;
      else state.panels.forEach((p) => (p.sourceId = s.id));
      save(); renderPanels();
      return { source: s.name };
    }
    case 'layout.preset': {
      const keys = Object.keys(PRESETS), r = c.preset;
      const low = String(r).toLowerCase().replace('x', '×');
      const key = typeof r === 'number' ? keys[r - 1] : keys.find((k) => k === r || PRESETS[k].label.toLowerCase() === low);
      setLayout(need(key, `Layout preset ${r} does not exist (1–${keys.length} or ${keys.map((k) => PRESETS[k].label).join(', ')})`));
      return { preset: state.layout };
    }
    case 'layout.load': {
      const all = loadLayouts(), low = String(c.name).toLowerCase();
      const n = need(Object.keys(all).find((k) => k.toLowerCase() === low), `Layout configuration ${c.name} is not saved`);
      applyLayout(all[n]); state.layoutName = n; save();
      return { layout: n };
    }
    case 'panel.scope': {
      const i = panelIndex(c.panel), p = state.panels[i];
      p.scope = c.scope as ScopeType;
      p.view = undefined;
      if (p.scope === 'vector' || p.scope === 'hls' || p.scope === 'cie') p.colorize = true;
      save(); const v = views.get(i); if (v) fillHead(v); dock.setTitle(i); needClear = true;
      return { panel: i + 1, scope: p.scope };
    }
    case 'panel.maximize': {
      if (c.panel === undefined) { dock.exitMaximized(); return { maximized: null }; }
      const i = panelIndex(c.panel);
      const dp = need(dock.api.getPanel(panelId(i)), `Panel ${i + 1} is not in the layout`);
      if (mode(dp.api.isMaximized()) !== dp.api.isMaximized()) dock.toggleMaximize(i);
      return { maximized: maximizedPanel() };
    }
    case 'freeze':
      if (mode(frozen) !== frozen) toggleFreeze();
      return { frozen };
    case 'qc.clear':
      qcLog.clear();
      return { qc: 0 };
    case 'roi.clear':
      for (const s of c.source !== undefined ? [need(findSource(c.source), `Source ${c.source} not found`)] : sources) { s.probe = null; s.roi = null; s.faceMode = 'off'; }
      refreshHeads();
      return {};
    case 'pattern.select': case 'pattern.next': case 'pattern.prev': {
      const s = need(c.source !== undefined ? findSource(c.source) : sources.find((x) => x.kind === 'pattern'), 'No test pattern source');
      if (s.kind !== 'pattern') throw new Error(`${s.name} is not a test pattern source`);
      let i = PATTERNS.findIndex((p) => p.id === s.pattern.id);
      if (c.cmd === 'pattern.select') {
        const low = String(c.pattern).toLowerCase();
        i = typeof c.pattern === 'number' ? c.pattern - 1 : PATTERNS.findIndex((p) => p.id === c.pattern || p.name.toLowerCase() === low);
        if (!PATTERNS[i]) throw new Error(`Test pattern ${c.pattern} does not exist`);
      } else i = (i + (c.cmd === 'pattern.next' ? 1 : -1) + PATTERNS.length) % PATTERNS.length;
      s.pattern.id = PATTERNS[i].id; save(); s.startPattern(); renderSources();
      return { pattern: PATTERNS[i].id, name: PATTERNS[i].name };
    }
    case 'output.open': {
      const src = c.source !== undefined ? need(findSource(c.source), `Source ${c.source} not found`) : activeSource();
      const sc = c.scene !== undefined ? need(findScene(state.scenes, c.scene as string | number), `Scene ${c.scene} does not exist`) : activeSceneObj();
      const name = openOutputView({
        name: String(c.name ?? ''), view: String(c.view), idx: String(c.panel !== undefined ? panelIndex(c.panel) : dock.openIdx()[0] ?? 0),
        src: src?.id ?? '', scene: sc?.id ?? '', bg: String(c.bg), display: String(c.display ?? ''), fs: c.fullscreen !== false,
        stream: String(c.stream ?? ''), target: String(c.target ?? ''), codec: String(c.codec ?? ''),
      });
      return { output: name };
    }
    case 'output.close': {
      const list = [...liveOutputs().entries()].filter(([n]) => c.name === undefined || n === c.name);
      if (c.name !== undefined && !list.length) throw new Error(`Output ${c.name} is not open`);
      for (const [n, o] of list) { o.win.close(); outWins.delete(n); }
      return { closed: list.map(([n]) => n) };
    }
    case 'scene.select': {
      const sc = need(findScene(state.scenes, c.scene as string | number), `Scene ${c.scene} does not exist`);
      if (c.output !== undefined) need(liveOutputs().get(String(c.output)), `Output ${c.output} is not open`).scene = sc.id;
      else {
        state.activeScene = sc.id;
        for (const o of liveOutputs().values()) if (o.view === 'overlay') o.scene = sc.id;
        save();
      }
      return { scene: sc.name };
    }
    case 'stream.start': {
      const outs = liveOutputs();
      let name = c.output !== undefined ? String(c.output) : [...outs.keys()][0];
      if (c.output !== undefined && !outs.has(name)) throw new Error(`Output ${name} is not open`);
      if (!name) {
        // nothing open yet: open the overlay output with the stream running
        name = openOutputView({ name: '', view: 'overlay', idx: '0', src: activeSource()?.id ?? '', scene: activeSceneObj()?.id ?? '', bg: 'picture', display: '', fs: false, stream: String(c.stream), target: String(c.target ?? ''), codec: String(c.codec ?? '') });
        return { output: name, stream: c.stream };
      }
      need(outApi(outs.get(name)!.win), `Output ${name} is still loading`).startStream(String(c.stream), String(c.target ?? ''), String(c.codec ?? ''));
      return { output: name, stream: c.stream };
    }
    case 'stream.stop': {
      const stopped: string[] = [];
      for (const [n, o] of liveOutputs()) {
        const api = outApi(o.win);
        if (!api?.stream() || (c.output !== undefined && n !== c.output) || (c.stream !== undefined && api.stream() !== c.stream)) continue;
        stopped.push(api.stream()); api.stopStream();
      }
      return { stopped };
    }
    case 'transport': {
      const s = need(c.source !== undefined ? findSource(c.source) : activeVideo(), 'No video file open');
      const v = need(s.isVideoFile ? s.video : null, `${s.name} is not a video file`);
      const playing = !v.paused || !!s.reverseSpeed;
      switch (c.op) {
        case 'play': if (!playing) s.togglePlay(); break;
        case 'pause': case 'stop': s.shuttle(0); if (c.op === 'stop') s.seek(0); break;
        case 'toggle': s.togglePlay(); break;
        case 'next': s.step(1); break;
        case 'prev': s.step(-1); break;
        case 'forward': s.shuttle(1); break;
        case 'rewind': s.shuttle(-1); break;
        case 'start': s.seek(0); break;
        case 'end': s.seek(v.duration || 0); break;
      }
      return { source: s.name };
    }
    case 'audio.reset': case 'audio.pause': {
      const list = c.source !== undefined ? [need(findSource(c.source), `Source ${c.source} not found`)] : sources.filter((x) => x.audio);
      const withAudio = list.filter((x) => x.audio);
      if (!withAudio.length) throw new Error(c.source !== undefined ? `${list[0].name} has no audio` : 'No source with audio');
      for (const x of withAudio) {
        if (c.cmd === 'audio.reset') x.audio!.reset(); else x.audio!.paused = mode(x.audio!.paused);
      }
      renderSources();
      return { sources: withAudio.map((x) => ({ name: x.name, paused: x.audio!.paused })) };
    }
    case 'setting': {
      const s = need(REMOTE_SETTINGS.find((x) => x.key === c.key), `Setting ${c.key} does not exist`);
      applySetting(s, c.value);
      refreshSettings(); refreshHeads(); needClear = true;
      return { key: s.key, value: s.get() };
    }
    case 'generator': {
      const patch: Partial<GenConfig> = {};
      if (c.signal !== undefined) patch.signal = c.signal as GenConfig['signal'];
      if (c.freq !== undefined) patch.freq = Number(c.freq);
      if (c.level !== undefined) patch.level = Number(c.level);
      patch.running = mode(generator.cfg.running);
      generator.update(patch).catch(() => {});
      state.gen = { ...generator.cfg, running: false }; save();
      return { running: patch.running, signal: generator.cfg.signal, level: generator.cfg.level, freq: generator.cfg.freq };
    }
  }
  throw new Error(`Command ${c.cmd} is not implemented`);
}

/** Loudness of the active source with sound (else the first one); values rounded to 0.1, null = unknown. */
function audioState() {
  const act = activeSource();
  const s = act?.audio ? act : sources.find((x) => x.audio);
  const a = s?.audio;
  if (!s || !a) return null;
  const r1 = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);
  const tp = 20 * Math.log10(Math.max(...a.level.maxTP));
  const av = a.av.result();
  const id = a.identReport();
  return {
    source: s.name, momentary: r1(a.loud.momentary), shortTerm: r1(a.loud.shortTerm), integrated: r1(a.loud.integrated),
    lra: r1(a.loud.lra), maxTP: r1(tp), paused: a.paused, seconds: Math.round(a.loud.measuredSeconds),
    avOffsetMs: r1(av.medianMs), ident: id.kind && id.kind !== 'tone' ? id.label : '',
    identProblems: id.findings.filter((f) => f.level === 'bad').map((f) => f.text),
  };
}

/** State for the control API: Companion feedbacks and variables. Percent values rounded to 0.1. */
function controlState() {
  const act = activeSource(), st = act?.stats ?? null;
  const pct = (v: number) => Math.round(v * 1000) / 10;
  const vid = activeVideo();
  const pat = sources.find((s) => s.kind === 'pattern');
  const sc = activeSceneObj();
  return {
    source: act ? { index: sources.indexOf(act) + 1, id: act.id, name: act.name, status: act.status } : null,
    sources: sources.map((s, i) => ({ index: i + 1, id: s.id, name: s.name, kind: s.kind, status: s.status })),
    frozen,
    clip: st ? pct(Math.max(...st.clipHigh, ...st.clipLow)) : null,
    clipHigh: st ? pct(Math.max(...st.clipHigh)) : null,
    clipLow: st ? pct(Math.max(...st.clipLow)) : null,
    yMin: st ? pct(st.yMin) : null,
    yMax: st ? pct(st.yMax) : null,
    layoutName: state.layoutName || PRESETS[state.layout]?.label || '',
    preset: state.layout,
    layouts: Object.keys(loadLayouts()).sort((a, b) => a.localeCompare(b)),
    presets: Object.entries(PRESETS).map(([key, l], i) => ({ index: i + 1, key, label: l.label })),
    panels: dock.openIdx().map((i) => ({ panel: i + 1, scope: state.panels[i].scope, source: panelSource(state.panels[i])?.name ?? '' })),
    maximized: maximizedPanel(),
    scene: sc ? { id: sc.id, name: sc.name } : null,
    scenes: state.scenes.map((s) => ({ id: s.id, name: s.name, elements: s.elements.length })),
    outputs: [...liveOutputs().entries()].map(([name, o]) => ({ name, view: o.view, scene: state.scenes.find((s) => s.id === o.scene)?.name ?? '', stream: outApi(o.win)?.stream() ?? '' })),
    pattern: pat ? { id: pat.pattern.id, name: patternById(pat.pattern.id).name } : null,
    patterns: PATTERNS.map((p) => ({ id: p.id, name: p.name })),
    playing: vid?.video ? !vid.video.paused || !!vid.reverseSpeed : null,
    // QC log (qclog.ts): active events, total, latest event text
    qc: (() => {
      const ev = qcLog.events, last = ev[ev.length - 1];
      return { active: ev.filter((e) => e.end === null).length, total: ev.length, last: last ? `${last.source}: ${QC_LABELS[last.type]}` : '' };
    })(),
    /** latency of stamped test pictures (scripts/latency-source.mjs), ms, last 2 s; null = no stamps */
    latency: act?.latency.summary() ?? null,
    /** how the bridge receives the stream (own RTP reception or ffmpeg, low-latency mode) */
    rtp: act?.rtpInfo ?? null, rtpStats: act?.rtpStats ?? null,
    /** where the statistics come from and their main-thread cost in ms */
    statsPerf: act ? { ...act.statsPerf } : null,
    audio: audioState(),
    generator: { running: generator.running, signal: generator.cfg.signal, level: generator.cfg.level, freq: generator.cfg.freq, channels: generator.cfg.channels ?? 2 },
    /** global settings (command "setting"): key, kind, value, choices or range */
    settings: describeSettings(REMOTE_SETTINGS),
  };
}

// ---------------------------------------------------------------- keys & boot

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input, select, textarea')) return;
  const keys = Object.keys(PRESETS);
  if (/^[1-6]$/.test(e.key)) setLayout(keys[Number(e.key) - 1]);
  else if (e.key === ' ') { e.preventDefault(); const v = activeVideo(); if (v) v.togglePlay(); else toggleFreeze(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    const v = activeVideo(); if (!v) return;
    e.preventDefault();
    const d = e.key === 'ArrowRight' ? 1 : -1;
    if (e.shiftKey) v.seek((v.video?.currentTime ?? 0) + d); else v.step(d);
  }
  else if (e.key === 'j' || e.key === 'J') activeVideo()?.shuttle(-1);
  else if (e.key === 'k' || e.key === 'K') activeVideo()?.shuttle(0);
  else if (e.key === 'l' || e.key === 'L') activeVideo()?.shuttle(1);
  else if (e.key === 'Home') activeVideo()?.seek(0);
  else if (e.key === 'End') { const v = activeVideo(); v?.seek(v.video?.duration ?? 0); }
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === 's' || e.key === 'S') snapshot();
  else if (e.key === 'b' || e.key === 'B') toggleSidebar();
  else if (e.key === 'c' || e.key === 'C') setStage(STAGES[(STAGES.indexOf(state.stage ?? 'signal') + 1) % STAGES.length]);
  else if (e.key === 'Escape') { if (narrowQuery.matches && drawerOpen) { toggleSidebar(false); $('#toggle-side').focus(); } else if (dock.api.hasMaximizedGroup()) dock.exitMaximized(); else { sources.forEach((s) => { s.probe = null; s.roi = null; s.faceMode = 'off'; }); refreshHeads(); } }
});

// LUTs referenced by saved chains come back from the browser's LUT store
lutListeners.add(() => { renderSources(); refreshHeads(); needClear = true; });
refreshRecent().then(() => renderSources());
for (const saved of state.sources) {
  [saved.settings.chain?.lut1, saved.settings.chain?.lut2].forEach((n) => { if (n) ensureLut(n); });
  const s = addSource(saved.kind, saved.name, saved.url, saved.settings);
  if (saved.pattern) Object.assign(s.pattern, saved.pattern);
  if (saved.audioIn) Object.assign(s.audioIn, saved.audioIn);
  // own images (img:…) and logo patterns come from IndexedDB: started once that is read
  if (s.kind === 'pattern' && !/^(img:|logo$|testcard-logo$)/.test(s.pattern.id)) s.startPattern();
  if (s.kind === 'audio' && s.audioIn.mode === 'generator') s.startAudio();
  if (s.kind === 'audio' && s.audioIn.mode === 'bridge' && s.audioIn.bridgeUrl) s.startAudio(undefined, bridgeUrl());
}
// own images and logo from IndexedDB (#52); the change listener starts their pattern sources
loadUserPatterns();
mountOpple($('#opple'), {
  bridgeWs: () => bridgeUrl(),
  /** light scopes as their own layout (top: diagram, vectorscope, channels; bottom: time course, grid) */
  openScopes: () => {
    const idxs = LIGHT_SCOPES.map((scope) => {
      const i = state.panels.findIndex((p) => p.scope === scope);
      if (i >= 0) return i;
      state.panels.push(panel(scope));
      return state.panels.length - 1;
    });
    state.layoutName = ''; save();
    dock.showGrid(idxs, 3);
  },
});
mountGenerator($('#gen'), state.gen, state.genSink ?? '', (cfg, sink) => { state.gen = cfg; state.genSink = sink; save(); }, () => addAudioSource('generator'), () => {
  // A/V offset measured at a bridge source (median), for the calibration of the outputs
  for (const s of sources) {
    const r = s.audio?.av.result();
    if (r && r.medianMs !== null && r.pairs.length >= 3) return { ms: r.medianMs, source: s.name };
  }
  return null;
});
applySidebar();
renderHeader();
// Touch Shading (#54): gestures on the scopes → lz-camera-bridge or the simulator
const shading = new ShadingControl({
  simSource: () => {
    let s = sources.find((x) => x.url === SIM_URL);
    if (!s) { s = addSource('file', SHADING_T.simName, SIM_URL, { colorspace: '709' }); if (state.panels[0]) switchSource(state.panels[0], s.id); }
    return s;
  },
  panelSource,
  hud: alertHud,
  redraw: () => panelSigs.clear(),
}, app);
registerMenuCommand('scopes', { id: 'shading', label: SHADING_T.menu, title: SHADING_T.buttonTitle }, () => shading.toggleBar());
registerMenuCommand('scopes', { id: 'cameras', label: SHADING_T.camMenu, title: SHADING_T.camMenuTitle }, () => { void shading.openCameras(); });
const dock = createDock($('#dock'), {
  element: panelElement,
  title: panelTitle,
  onLayout: () => {
    needClear = true;
    clearTimeout(layoutSave);
    layoutSave = window.setTimeout(() => { state.dock = dock.layoutJSON(); save(); }, 300);
  },
});
let layoutSave = 0;
if (!(state.dock && dock.restore(state.dock))) dock.applyPreset(state.layout);
// narrow windows and phones: the panels as tabs of one group (dragging stays on wide screens)
const compactQuery = matchMedia('(max-width: 640px), (max-width: 900px) and (max-height: 500px)');
const applyCompact = () => { dock.setCompact(compactQuery.matches); needClear = true; };
compactQuery.addEventListener('change', applyCompact);
applyCompact();
if (!state.scenes.some((sc) => sc.id === state.activeScene)) state.activeScene = state.scenes[0].id;
// application menu (#53): native in the desktop app, menu bar in the header in the browser
const menuState = (): MenuState => ({
  sidebar: state.sidebar, frozen, layout: state.layoutName ? '' : state.layout,
  layouts: Object.entries(PRESETS).map(([k, l]) => [k, l.label]),
  theme: state.theme, themes: THEMES,
  stage: state.stage ?? 'signal', stages: STAGES.map((st) => [st, STAGE_LABELS[st]]),
  scopes: (Object.entries(SCOPE_LABELS) as [string, string][]),
  hasPattern: sources.some((x) => x.kind === 'pattern'),
  help: helpOn(),
});
const menuActions: MenuActions = {
  manual: (lang) => openManual(lang),
  settings: (page) => openSettings(page),
  layouts: () => openToolDialog('laymenu'),
  layoutsExport: () => downloadJson(loadLayouts(), 'lz-scopes-layouts.json'),
  layoutsImport: () => importLayouts(() => { if ($<HTMLDialogElement>('#laymenu').open) renderLayoutMenu(); }),
  snapshot: () => snapshot(),
  sidebar: () => toggleSidebar(),
  layout: (k) => { if (k in PRESETS) setLayout(k); },
  addPanel: (scope) => addScopePanel(scope && scope in SCOPE_LABELS ? scope as ScopeType : undefined),
  exitSolo: () => { if (dock.api.hasMaximizedGroup()) dock.exitMaximized(); },
  freeze: () => toggleFreeze(),
  stageNext: () => setStage(STAGES[(STAGES.indexOf(state.stage ?? 'signal') + 1) % STAGES.length]),
  stage: (id) => { if ((STAGES as string[]).includes(id)) setStage(id as Stage); },
  theme: (id) => { if (isTheme(id)) { setTheme(id); refreshSettings(); } },
  fullscreen: () => toggleFullscreen(),
  addSource: (kind) => { if (SOURCE_ITEMS.some(([k]) => k === kind)) addSourceOfKind(kind); },
  output: () => openToolDialog('outmenu'),
  outputPattern: () => { const p = sources.find((x) => x.kind === 'pattern'); if (p) openOutput(p.pattern); },
  led: () => openLed(),
  calibration: () => openCalibrationDialog(),
  help: () => { setHelpOn(!helpOn()); for (const v of views.values()) fillHead(v); refreshMenu(); },
  feedback: () => openFeedback({
    version: typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '',
    displayFps: () => displayFps,
    panels: () => dock.openIdx().map((i) => state.panels[i].scope),
    // no names or URLs: they can hold addresses and credentials; the codec text of NDI/DeckLink carries the device name
    sources: () => sources.map((s) => ({
      kind: s.kind, status: s.status, width: s.width, height: s.height, depth: s.depth, fps: s.fps, dropped: s.dropped,
      codec: s.info?.codec?.split(' · ')[0], pixFmt: s.info?.pixFmt,
      sourceSize: s.info?.sourceWidth ? `${s.info.sourceWidth}×${s.info.sourceHeight}` : undefined,
      stats: s.ready ? `${s.statsPerf.path} ${s.statsPerf.ms.toFixed(2)} ms` : undefined,
      message: s.status === 'error' ? s.message : undefined,
    })),
    bridge: async () => { await refreshFfmpegInfo(); return bridgeHealth ? (bridgeHealth.ffmpeg ? `${bridgeHealth.ffmpeg.version ?? '?'} · ${bridgeHealth.ffmpeg.origin}` : '') : false; },
  }),
};
mountMenu($('#menubar'), menuState, menuActions);
requestAnimationFrame(frame);
// Control API: the bridge forwards Companion/HTTP commands to this window.
connectRemote(bridgeUrl, execute, controlState);
// Auto-connect saved network sources (bridge must be running).
sources.forEach((s) => { if (s.kind === 'stream' && s.url) s.connectStream(s.url, bridgeUrl()); });

// Resolve playback (#88): live window capture while the timeline plays
Source.onResolve = (s, msg) => resolvePlayback.onResolve(s, msg);
Source.onStop = (s) => resolvePlayback.onStop(s);

// running DaVinci Resolve on the bridge machine: one click to connect
mountResolveLive($('#resolve-live'), {
  http: () => bridgeUrl().replace(/^ws/, 'http'),
  connect: () => { if (!sources.some((x) => x.url === 'resolve:' && x.status !== 'idle')) addResolve(); },
  connected: () => sources.some((x) => x.url === 'resolve:' && (x.status === 'live' || x.status === 'connecting')),
});

