// Cameras of the camera bridge, set up from LZ Scopes (Scopes → Cameras …, and from the Touch
// Shading bar): add, change, connect, remove – with the bridge's own commands (setCameraConfig,
// connectCamera, disconnectCamera, removeCamera; lz-camera-bridge packages/bridge/src/
// BridgeServer.ts). LZ Scopes keeps no camera list of its own; the bridge stores it.

import { BRIDGE_PAINT_CAPS, capsKey } from './model';
import type { CameraBridgeLink } from './bridge';
import { button, field, h, hint, numberInput, openModal, select, textInput, type Kid, type Modal } from '../ui';
import { t, type Key } from '../i18n';

type FieldKey = 'camHost' | 'camPort' | 'camUser' | 'camPass' | 'cgiFamily' | 'tcpHost' | 'tcpPort' | 'ccuId' | 'serialPath' | 'baudRate'
  | 'bmHost' | 'lumixHost' | 'lumixPort' | 'canonHost' | 'canonPort' | 'viscaSerialPath' | 'viscaBaudRate' | 'viscaAddress';

interface ModeDef { fields: FieldKey[]; defaults?: Partial<Record<FieldKey, number | string>> }

/**
 * Connection modes offered here, with the fields the bridge reads for each (backendFactory.ts
 * makeBackend, v2.2.0) and their defaults. Sony over USB/Wi-Fi, gimbals and the B4 lens need the
 * LZ Camera Bridge app (USB drivers, SSH pairing); they still show up in the list when set up there.
 */
export const MODES: Record<string, ModeDef> = {
  'http-cgi': { fields: ['camHost', 'camPort', 'cgiFamily', 'camUser', 'camPass'], defaults: { camPort: 80, cgiFamily: 'sony' } },
  visca: { fields: ['camHost', 'camPort'], defaults: { camPort: 1259 } },
  'visca-serial': { fields: ['viscaSerialPath', 'viscaBaudRate', 'viscaAddress'], defaults: { viscaBaudRate: 9600, viscaAddress: 1 } },
  'panasonic-ptz': { fields: ['camHost', 'camPort'], defaults: { camPort: 80 } },
  birddog: { fields: ['camHost', 'camPort'], defaults: { camPort: 8080 } },
  jvc: { fields: ['camHost', 'camPort', 'camUser', 'camPass'], defaults: { camPort: 80 } },
  blackmagic: { fields: ['bmHost'] },
  'canon-ccapi': { fields: ['canonHost', 'canonPort'], defaults: { canonPort: 8080 } },
  'lumix-http': { fields: ['lumixHost', 'lumixPort'], defaults: { lumixHost: '192.168.54.1', lumixPort: 80 } },
  zcam: { fields: ['camHost', 'camPort'], defaults: { camPort: 80 } },
  tcp: { fields: ['tcpHost', 'tcpPort', 'ccuId'], defaults: { tcpPort: 7700, ccuId: 0 } },
  serial: { fields: ['serialPath', 'baudRate', 'ccuId'], defaults: { baudRate: 38400, ccuId: 0 } },
  demo: { fields: [] },
};
export const MODE_IDS = Object.keys(MODES);

const NUMERIC = new Set<FieldKey>(['camPort', 'tcpPort', 'ccuId', 'baudRate', 'lumixPort', 'canonPort', 'viscaBaudRate', 'viscaAddress']);
/** fields the camera cannot work without (makeBackend throws without them) */
const REQUIRED = new Set<FieldKey>(['camHost', 'tcpHost', 'serialPath', 'bmHost', 'canonHost', 'viscaSerialPath']);

export type CameraForm = { cameraNumber: number; label: string; mode: string } & Partial<Record<FieldKey, string>>;

/** Which Touch Shading controls a mode offers (empty: the camera can be listed, not shaded). */
export function shadingCaps(mode: string, family?: string): string[] {
  return BRIDGE_PAINT_CAPS[capsKey(mode, family)] ?? [];
}

/**
 * The bridge message for a form: only the fields of the chosen mode, numbers as numbers, empty
 * fields left out (the bridge then uses its default). Errors name the missing required fields.
 */
export function cameraConfigMessage(f: CameraForm): { message: Record<string, unknown> } | { missing: FieldKey[] } {
  const def = MODES[f.mode];
  if (!def || !(f.cameraNumber >= 1 && f.cameraNumber <= 99)) return { missing: [] };
  const config: Record<string, unknown> = { connectionMode: f.mode };
  if (f.label.trim()) config.label = f.label.trim();
  const missing: FieldKey[] = [];
  for (const k of def.fields) {
    const raw = (f[k] ?? '').trim();
    if (!raw) { if (REQUIRED.has(k)) missing.push(k); continue; }
    if (NUMERIC.has(k)) { const n = Number(raw); if (Number.isFinite(n)) config[k] = n; else missing.push(k); }
    else config[k] = raw;
  }
  if (missing.length) return { missing };
  return { message: { type: 'setCameraConfig', cameraNumber: f.cameraNumber, config } };
}

/** Form values of an existing camera (password never shown again). */
export function formOf(cameraNumber: number, cfg: Record<string, unknown>): CameraForm {
  const mode = String(cfg.connectionMode ?? 'http-cgi');
  const f: CameraForm = { cameraNumber, label: String(cfg.label ?? ''), mode };
  for (const k of MODES[mode]?.fields ?? []) if (k !== 'camPass' && cfg[k] !== undefined) f[k] = String(cfg[k]);
  return f;
}

export const freeNumber = (taken: number[]) => { let n = 1; while (taken.includes(n)) n++; return n; };

const label = (k: FieldKey) => t(`shading.cam.field.${k}` as Key);
const modeLabel = (m: string) => t(`shading.cam.mode.${m}` as Key);

/** The dialog. `link` is the Touch Shading connection to the bridge. */
export function openCameraDialog(link: CameraBridgeLink, onTarget?: (cameraNumber: number) => void): Modal {
  let form: CameraForm | null = null;
  let note = '';
  const m = openModal({ title: t('shading.cam.title'), id: 'cameras', cls: 'cameras', size: 'lg', sticky: true });
  const render = () => {
    const rows: Kid[] = [];
    if (link.status !== 'open') rows.push(hint(t('shading.cam.noBridge')));
    else if (!link.cameras.length && !form) rows.push(hint(t('shading.cam.empty')));
    if (link.cameras.length) {
      rows.push(h('ul', { class: 'cam-list' }, ...link.cameras.map((c) => {
        const cfg = link.configs.get(c.cameraNumber) ?? {};
        const caps = shadingCaps(String(cfg.connectionMode ?? ''), cfg.cgiFamily ? String(cfg.cgiFamily) : undefined);
        const err = link.cameraErrors.get(c.cameraNumber);
        return h('li', { class: 'cam-row', 'data-camera': String(c.cameraNumber) },
          h('span', { class: 'dot', 'data-status': c.connected ? 'live' : err ? 'error' : 'idle', title: c.connected ? t('shading.cam.connected') : t('shading.cam.notConnected') }),
          h('span', { class: 'cam-name' }, `${c.cameraNumber} · ${c.label}`),
          h('span', { class: 'hint' }, `${modeLabel(String(cfg.connectionMode ?? '')) || String(cfg.connectionMode ?? '')}${caps.length ? '' : ` · ${t('shading.cam.noShading')}`}`),
          err ? h('span', { class: 'cam-err', role: 'alert' }, err) : null,
          h('span', { class: 'cam-actions' },
            c.connected
              ? button(t('shading.cam.disconnect'), () => link.request({ type: 'disconnectCamera', cameraNumber: c.cameraNumber }), { small: true })
              : button(t('shading.cam.connect'), () => { link.cameraErrors.delete(c.cameraNumber); link.request({ type: 'connectCamera', cameraNumber: c.cameraNumber }); render(); }, { small: true }),
            caps.length && onTarget ? button(t('shading.cam.useAsTarget'), () => { onTarget(c.cameraNumber); m.close(); }, { small: true, title: t('shading.cam.useAsTargetTitle') }) : null,
            button(t('shading.cam.edit'), () => { form = formOf(c.cameraNumber, cfg); note = ''; render(); }, { small: true, variant: 'ghost' }),
            button(t('shading.cam.remove'), () => link.request({ type: 'removeCamera', cameraNumber: c.cameraNumber }), { small: true, variant: 'ghost' })));
      })));
    }
    if (form) rows.push(editor(form));
    else rows.push(button(t('shading.cam.add'), () => { form = { cameraNumber: freeNumber(link.cameras.map((c) => c.cameraNumber)), label: '', mode: 'http-cgi' }; note = ''; render(); }, { variant: 'primary', disabled: link.status !== 'open', attrs: { 'data-cam-add': '' } }));
    m.setBody(...rows);
  };
  const editor = (f: CameraForm): HTMLElement => {
    const def = MODES[f.mode];
    const set = (k: keyof CameraForm) => (v: string | number) => { (f as Record<string, unknown>)[k] = String(v); };
    const caps = shadingCaps(f.mode, f.cgiFamily);
    const fields = def.fields.map((k) => {
      const ph = def.defaults?.[k] !== undefined ? String(def.defaults[k]) : '';
      if (k === 'cgiFamily') return field(label(k), select(f.cgiFamily ?? String(def.defaults?.cgiFamily ?? 'sony'), [['sony', t('shading.cam.family.sony')], ['vissonic', t('shading.cam.family.vissonic')]], (v) => { f.cgiFamily = v; render(); }));
      if (NUMERIC.has(k)) return field(label(k), numberInput(f[k] === undefined || f[k] === '' ? '' : Number(f[k]), set(k), { placeholder: ph, size: 'xl' }));
      return field(label(k), textInput(f[k] ?? '', set(k), { placeholder: ph || (k.endsWith('Host') ? '192.168.0.100' : ''), live: true, mono: k.endsWith('Host') || k.endsWith('Path'), attrs: k === 'camPass' ? { type: 'password', autocomplete: 'new-password' } : {} }));
    });
    return h('div', { class: 'cam-editor', 'data-cam-editor': '' },
      field(t('shading.cam.number'), numberInput(f.cameraNumber, (v) => { f.cameraNumber = Math.round(v); }, { min: 1, max: 99, size: 's' })),
      field(t('shading.cam.name'), textInput(f.label, (v) => { f.label = v; }, { placeholder: t('shading.cam.namePlaceholder'), live: true })),
      field(t('shading.cam.protocol'), select(f.mode, MODE_IDS.map((id) => [id, modeLabel(id)]), (v) => { form = { cameraNumber: f.cameraNumber, label: f.label, mode: v }; render(); }, '', { 'data-cam-mode': '' })),
      hint(caps.length ? t('shading.cam.capsYes', { caps: caps.map((c) => t(`shading.cam.cap.${c}` as Key)).join(', ') }) : t('shading.cam.capsNo')),
      ...fields,
      note ? h('p', { class: 'cam-err', role: 'alert' }, note) : null,
      h('div', { class: 'row' },
        button(t('shading.cam.save'), () => {
          const r = cameraConfigMessage(f);
          if ('missing' in r) { note = r.missing.length ? t('shading.cam.missing', { fields: r.missing.map(label).join(', ') }) : t('shading.cam.badNumber'); render(); return; }
          link.request(r.message);
          link.cameraErrors.delete(f.cameraNumber);
          link.request({ type: 'connectCamera', cameraNumber: f.cameraNumber });
          form = null; render();
        }, { variant: 'primary', attrs: { 'data-cam-save': '' } }),
        button(t('common.cancel'), () => { form = null; render(); }, { variant: 'ghost' })));
  };
  const off = link.subscribe(render);
  m.dlg.addEventListener('close', off);
  link.request({ type: 'listCameras' });
  render();
  return m;
}
