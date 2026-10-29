// Camera control for the colour match. LZ Scopes is public: only protocols with a public
// manufacturer specification are spoken here, each with its source (docs/research/
// farbabgleich-werkzeug.md, "Protokolle"). Everything else goes through the guide mode.
//
// 1. Blackmagic Camera Control REST API – Blackmagic Design, "Blackmagic Camera Control,
//    Developer Information", section "Color Correction Control API" (pp. 66–69):
//    https://documents.blackmagicdesign.com/DeveloperManuals/BlackmagicCameraControl.pdf
//    Base URL `<camera>/control/api/v1/`, GET/PUT /colorCorrection/lift|gamma|gain|color, JSON
//    {red, green, blue, luma} or {hue, saturation}; omitted fields stay unchanged. Ranges from
//    the SDI Camera Control table of the same document (group 8: lift −2…2, gamma −4…4,
//    gain 0…16, hue −1…1, saturation 0…2); the tool uses a narrower window around neutral.
// 2. lz-camera-bridge paint bus – the bridge's own WebSocket commands that Touch Shading already
//    sends (src/shading/model.ts busCommands). LZ Scopes speaks no camera protocol there; which
//    one the bridge uses towards the camera is outside this repository.
// 3. Guide mode – no protocol: the tool says which value to turn by how much, the person confirms.

import type { CameraBridgeLink } from '../shading/bridge';
import { busCommands, type Paint, type PaintField } from '../shading/model';
import type { MatchCamera, ParamDef, Values } from './engine';

// ------------------------------------------------------------------ Blackmagic REST

const ch = ['red', 'green', 'blue'] as const;
export const BMD_PARAMS: ParamDef[] = [
  ...ch.map((c): ParamDef => ({ id: `lift.${c}`, label: `Lift ${c}`, stage: 'black', min: -0.2, max: 0.2, step: 0.001, probe: 0.01 })),
  ...ch.map((c): ParamDef => ({ id: `gain.${c}`, label: `Gain ${c}`, stage: 'white', min: 0.5, max: 2, step: 0.001, probe: 0.04 })),
  { id: 'lift.luma', label: 'Lift luma', stage: 'pedestal', min: -0.2, max: 0.2, step: 0.001, probe: 0.01 },
  { id: 'gamma.luma', label: 'Gamma luma', stage: 'gamma', min: -1, max: 1, step: 0.005, probe: 0.05 },
  { id: 'color.saturation', label: 'Saturation', stage: 'matrix', min: 0.5, max: 1.5, step: 0.005, probe: 0.05 },
  { id: 'color.hue', label: 'Hue', stage: 'matrix', min: -0.2, max: 0.2, step: 0.002, probe: 0.02 },
];

/** Values → one JSON body per endpoint ({lift: {red, luma}, …}). */
export function bmdRestBody(v: Values): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [k, x] of Object.entries(v)) { const [ep, f] = k.split('.'); (out[ep] ??= {})[f] = x; }
  return out;
}

export class BmdRestCamera implements MatchCamera {
  params = BMD_PARAMS;
  constructor(private base: string, private f: typeof fetch = fetch) {}
  private url(ep: string) { return `${this.base.replace(/\/+$/, '')}/control/api/v1/colorCorrection/${ep}`; }
  async read(): Promise<Values> {
    const out: Values = {};
    for (const ep of ['lift', 'gamma', 'gain', 'color']) {
      const r = await this.f(this.url(ep));
      if (!r.ok) throw new Error(`${ep}: HTTP ${r.status}`);
      const j = (await r.json()) as Record<string, number>;
      for (const p of this.params) { const [e, k] = p.id.split('.'); if (e === ep && typeof j[k] === 'number') out[p.id] = j[k]; }
    }
    return out;
  }
  async write(v: Values) {
    for (const [ep, body] of Object.entries(bmdRestBody(v))) {
      const r = await this.f(this.url(ep), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`${ep}: HTTP ${r.status}`);
    }
  }
}

// ------------------------------------------------------------------ lz-camera-bridge paint bus

const BUS: [PaintField, ParamDef['stage']][] = [
  ['blackR', 'black'], ['blackG', 'black'], ['blackB', 'black'], ['whiteR', 'white'], ['whiteG', 'white'], ['whiteB', 'white'],
  ['masterBlack', 'pedestal'], ['masterGamma', 'gamma'], ['saturation', 'matrix'],
];

export class BridgeCamera implements MatchCamera {
  params: ParamDef[];
  constructor(private link: CameraBridgeLink, private n: number, private mode = '') {
    const known = link.states.get(n)?.paint ?? {};
    // only what the camera reports: a field the bridge never sent is a field the camera lacks
    this.params = BUS.filter(([f]) => known[f] !== undefined).map(([f, stage]) => ({ id: f, label: f, stage, min: 0, max: 255, step: 1, probe: 8 }));
  }
  async read(): Promise<Values> { return { ...(this.link.states.get(this.n)?.paint ?? {}) } as Values; }
  async write(v: Values) {
    const cur: Paint = { ...(this.link.states.get(this.n)?.paint ?? {}), ...(v as Paint) };
    const { commands, error } = busCommands(Object.keys(v) as PaintField[], cur, this.mode);
    if (error) throw new Error(`bridge: ${error}`);
    for (const c of commands) if (!this.link.send(this.n, c.cmd, c.params)) throw new Error('bridge: not connected');
  }
}

// ------------------------------------------------------------------ guide mode

export interface GuideChange { param: ParamDef; from: number; to: number }

/** Guide-mode parameters: menu steps of a camera, scale unknown – the loop measures it. */
export const GUIDE_PARAMS: ParamDef[] = [
  { id: 'blackR', label: 'Black R', stage: 'black', min: -99, max: 99, step: 1, probe: 5 },
  { id: 'blackB', label: 'Black B', stage: 'black', min: -99, max: 99, step: 1, probe: 5 },
  { id: 'whiteR', label: 'White R / R gain', stage: 'white', min: -99, max: 99, step: 1, probe: 5 },
  { id: 'whiteB', label: 'White B / B gain', stage: 'white', min: -99, max: 99, step: 1, probe: 5 },
  { id: 'pedestal', label: 'Master pedestal', stage: 'pedestal', min: -99, max: 99, step: 1, probe: 5 },
  { id: 'gamma', label: 'Gamma', stage: 'gamma', min: -99, max: 99, step: 1, probe: 5 },
  { id: 'saturation', label: 'Saturation / chroma level', stage: 'matrix', min: -99, max: 99, step: 1, probe: 5 },
];

export class GuideCamera implements MatchCamera {
  private v: Values;
  constructor(public params: ParamDef[], private ask: (changes: GuideChange[]) => Promise<void>) {
    this.v = Object.fromEntries(params.map((p) => [p.id, 0]));
  }
  async read() { return { ...this.v }; }
  async write(v: Values) {
    const changes = Object.entries(v).map(([k, to]) => ({ param: this.params.find((p) => p.id === k)!, from: this.v[k], to })).filter((c) => c.param && c.from !== c.to);
    if (changes.length) await this.ask(changes);
    this.v = { ...this.v, ...v };
  }
}

// ------------------------------------------------------------------ Panasonic AW-CGI (aw_cam)
//
// Source: Panasonic Connect, "AW-UE150/AW-HE145 Integrated Camera Interface Specifications"
// (Apr. 1, 2022), https://eww.pass.panasonic.co.jp/pro-av/support/content/guide/DEF/UE150/AW-UE150HE145_InterfaceSpecification_E.pdf
// p. 7 (IP send format `http://<camera>/cgi-bin/aw_cam?cmd=<Command>&res=1`, reply = command
// echo in the body), p. 30 (R/B Gain OSG:39/OSG:3A, 738h…800h…8C8h = −200…0…+200), p. 31
// (Master Pedestal OSJ:0F, 738h…8C8h; R/B Pedestal ORP/OBP, 032h…096h…0FAh = −100…0…+100),
// p. 33 (Gamma OSA:6A, 67h…94h = 0.30…0.75, step 0.01), p. 35 (Matrix Type OSE:31, 3 = USER;
// linear matrix OSD:A4…A9 R-G, R-B, G-R, G-B, B-R, B-G, 41h…80h…BFh = −63…0…+63), pp. 35–36
// (Color Correction OSD:80…9F, 16 axes from B_Mg to B, saturation then phase, 41h…BFh). Request
// = the command with Q instead of O (QSG:39, QRP …). Other models have their own specification;
// the codes here are the UE150/HE145 ones, and a model that does not answer a request does not
// get that parameter.

export interface PanaCmd { id: string; label: string; stage: ParamDef['stage']; set: string; query: string; zero: number; range: number; digits: number }

const PANA_AXES = ['B_Mg', 'Mg', 'Mg_R', 'Mg_R_R', 'R', 'R_R_Yl', 'R_Yl', 'R_Yl_Yl', 'Yl', 'Yl_Yl_G', 'Yl_G', 'G', 'G_Cy', 'Cy', 'Cy_B', 'B'];
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');

export const PANA_CMDS: PanaCmd[] = [
  { id: 'pana.rgain', label: 'R Gain', stage: 'white', set: 'OSG:39:', query: 'QSG:39', zero: 0x800, range: 200, digits: 3 },
  { id: 'pana.bgain', label: 'B Gain', stage: 'white', set: 'OSG:3A:', query: 'QSG:3A', zero: 0x800, range: 200, digits: 3 },
  { id: 'pana.rped', label: 'R Pedestal', stage: 'black', set: 'ORP:', query: 'QRP', zero: 0x096, range: 100, digits: 3 },
  { id: 'pana.bped', label: 'B Pedestal', stage: 'black', set: 'OBP:', query: 'QBP', zero: 0x096, range: 100, digits: 3 },
  { id: 'pana.mped', label: 'Master Pedestal', stage: 'pedestal', set: 'OSJ:0F:', query: 'QSJ:0F', zero: 0x800, range: 200, digits: 3 },
  // gamma 0.30…0.75 in 0.01 steps: counted in hundredths around 0.55 (80h)
  { id: 'pana.gamma', label: 'Gamma', stage: 'gamma', set: 'OSA:6A:', query: 'QSA:6A', zero: 0x80, range: 25, digits: 2 },
  ...['R-G', 'R-B', 'G-R', 'G-B', 'B-R', 'B-G'].map((n, i): PanaCmd => ({ id: `pana.matrix.${n}`, label: `Matrix ${n}`, stage: 'matrix', set: `OSD:${hex2(0xa4 + i)}:`, query: `QSD:${hex2(0xa4 + i)}`, zero: 0x80, range: 63, digits: 2 })),
  ...PANA_AXES.flatMap((n, i): PanaCmd[] => [
    { id: `pana.cc.${n}.sat`, label: `${n} Saturation`, stage: 'multiaxis', set: `OSD:${hex2(0x80 + 2 * i)}:`, query: `QSD:${hex2(0x80 + 2 * i)}`, zero: 0x80, range: 63, digits: 2 },
    { id: `pana.cc.${n}.phase`, label: `${n} Phase`, stage: 'multiaxis', set: `OSD:${hex2(0x81 + 2 * i)}:`, query: `QSD:${hex2(0x81 + 2 * i)}`, zero: 0x80, range: 63, digits: 2 },
  ]),
];

/** Command string for one value relative to neutral (e.g. R Gain −200…200). */
export function panaCommand(c: PanaCmd, v: number): string {
  const n = c.zero + Math.max(-c.range, Math.min(c.range, Math.round(v)));
  return c.set + n.toString(16).toUpperCase().padStart(c.digits, '0');
}

/** Value from a reply like `OSG:39:80A` (relative to neutral); null for anything else (ER1…ER3). */
export function panaParse(c: PanaCmd, reply: string): number | null {
  const body = reply.trim().replace(/^"|"$/g, '');
  if (!body.startsWith(c.set)) return null;
  const n = parseInt(body.slice(c.set.length), 16);
  return Number.isFinite(n) ? n - c.zero : null;
}

export class PanasonicCamera implements MatchCamera {
  params: ParamDef[];
  private userMatrix = false;
  constructor(private base: string, private f: typeof fetch = fetch, private cmds: PanaCmd[] = PANA_CMDS) {
    this.params = cmds.map((c) => ({ id: c.id, label: c.label, stage: c.stage, min: -c.range, max: c.range, step: 1, probe: Math.max(2, Math.round(c.range / 10)) }));
  }
  private async send(cmd: string): Promise<string> {
    const r = await this.f(`${this.base.replace(/\/+$/, '')}/cgi-bin/aw_cam?cmd=${encodeURIComponent(cmd)}&res=1`);
    if (!r.ok) throw new Error(`${cmd}: HTTP ${r.status}`);
    const t = (await r.text()).trim();
    if (/^ER\d/.test(t)) throw new Error(`${cmd}: ${t}`);
    return t;
  }
  async read(): Promise<Values> {
    const out: Values = {};
    for (const c of this.cmds) {
      try { const v = panaParse(c, await this.send(c.query)); if (v != null) out[c.id] = v; } catch { /* not on this model or not in this mode */ }
    }
    // only what the camera answers is offered to the loop
    this.params = this.params.filter((p) => out[p.id] !== undefined);
    return out;
  }
  async write(v: Values) {
    for (const [k, x] of Object.entries(v)) {
      const c = this.cmds.find((q) => q.id === k);
      if (!c) continue;
      // matrix and colour correction act only with Matrix Type USER (OSE:31:3, p. 35)
      if ((c.stage === 'matrix' || c.stage === 'multiaxis') && !this.userMatrix) { await this.send('OSE:31:3'); this.userMatrix = true; }
      await this.send(panaCommand(c, x));
    }
  }
}

// ------------------------------------------------------------------ Sony CGI (SRG series)
//
// Source: Sony, "Color Video Camera – VISCA Command List / CGI Command List, Software Version 1.0,
// SRG-A40/A12" (5-053-155-11 (1), 2023), "Technical Manual – VISCA/CGI Command List" on
// https://www.sony.com.hk/en/electronics/support/ptz-and-remote-cameras-ptz-cameras/srg-a40/manuals
// p. 31 (syntax `http://<camera>/command/<cgi>?<parameter>=<value>`, HTTP Digest authentication,
// inquiry `inquiry.cgi?inq=<Inquiry>` → `<parameter>=<value>&…`), p. 43 (imaging.cgi), p. 47
// (WhiteBalanceCrGain = R gain, WhiteBalanceCbGain = B gain, 0…255, default 128, effective with
// WhiteBalanceMode=manual). The list has no pedestal, gamma, matrix or colour-correction
// parameters for these models – those stay out.

export const SONY_CGI_PARAMS: ParamDef[] = [
  { id: 'WhiteBalanceCrGain', label: 'R gain', stage: 'white', min: 0, max: 255, step: 1, probe: 8 },
  { id: 'WhiteBalanceCbGain', label: 'B gain', stage: 'white', min: 0, max: 255, step: 1, probe: 8 },
];

/** `a=1&b=x` → { a: '1', b: 'x' } (standard inquiry format, p. 31). */
export function sonyParse(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.trim().split('&')) { const i = part.indexOf('='); if (i > 0) out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1)); }
  return out;
}

export class SonyCgiCamera implements MatchCamera {
  params = SONY_CGI_PARAMS;
  private manual = false;
  /** `f` has to answer the Digest challenge (p. 31). */
  constructor(private base: string, private f: typeof fetch = fetch) {}
  private url(cgi: string, q: string) { return `${this.base.replace(/\/+$/, '')}/command/${cgi}?${q}`; }
  async read(): Promise<Values> {
    const r = await this.f(this.url('inquiry.cgi', 'inq=imaging'));
    if (!r.ok) throw new Error(`inquiry: HTTP ${r.status}`);
    const kv = sonyParse(await r.text()), out: Values = {};
    for (const p of this.params) if (kv[p.id] !== undefined) out[p.id] = Number(kv[p.id]);
    this.manual = kv.WhiteBalanceMode === 'manual';
    return out;
  }
  async write(v: Values) {
    const q = Object.entries(v).filter(([k]) => this.params.some((p) => p.id === k)).map(([k, x]) => `${k}=${Math.round(x)}`);
    if (!q.length) return;
    if (!this.manual) q.unshift('WhiteBalanceMode=manual');
    const r = await this.f(this.url('imaging.cgi', q.join('&')));
    if (!r.ok) throw new Error(`imaging: HTTP ${r.status}`);
    this.manual = true;
  }
}

// ------------------------------------------------------------------ Sony VISCA over IP
//
// Source: the same Sony SRG-A40/A12 command list, pp. 9–11 (VISCA over IP: UDP port 52381;
// header = payload type 2 bytes (01 00 command, 01 10 inquiry, 01 11 reply) + payload length
// 2 bytes + sequence number 4 bytes, big-endian; camera address locked to 1), p. 15 (R.GAIN
// Direct 8x 01 04 43 00 00 0p 0p FF, B.GAIN Direct 8x 01 04 44 …, pp 00…80…FF = −128…0…+127),
// p. 20 (inquiries 8x 09 04 43 FF / 8x 09 04 44 FF → y0 50 00 00 0p 0p FF). The list has no
// pedestal, gamma or matrix commands for these models.
//
// A web page cannot send UDP: the transport is injected (desktop app or tests).

export interface ViscaTransport { send(packet: Uint8Array): Promise<Uint8Array> }

export function viscaPacket(type: 'command' | 'inquiry', seq: number, payload: number[]): Uint8Array {
  const b = new Uint8Array(8 + payload.length);
  b[0] = 0x01; b[1] = type === 'command' ? 0x00 : 0x10;
  b[2] = (payload.length >> 8) & 0xff; b[3] = payload.length & 0xff;
  b[4] = (seq >>> 24) & 0xff; b[5] = (seq >>> 16) & 0xff; b[6] = (seq >>> 8) & 0xff; b[7] = seq & 0xff;
  b.set(payload, 8);
  return b;
}

const VISCA_GAIN: Record<string, number> = { 'visca.rgain': 0x43, 'visca.bgain': 0x44 };
export const VISCA_PARAMS: ParamDef[] = [
  { id: 'visca.rgain', label: 'R gain', stage: 'white', min: -128, max: 127, step: 1, probe: 8 },
  { id: 'visca.bgain', label: 'B gain', stage: 'white', min: -128, max: 127, step: 1, probe: 8 },
];

/** Direct command: value −128…127 → pp = 80h + value, as two nibbles. */
export function viscaGainCommand(id: string, v: number): number[] {
  const pp = 0x80 + Math.max(-128, Math.min(127, Math.round(v)));
  return [0x81, 0x01, 0x04, VISCA_GAIN[id], 0x00, 0x00, (pp >> 4) & 0x0f, pp & 0x0f, 0xff];
}

/** Reply y0 50 00 00 0p 0p FF (after the 8-byte header) → −128…127; null otherwise. */
export function viscaGainParse(packet: Uint8Array): number | null {
  const p = packet.subarray(8);
  if (p.length < 7 || p[1] !== 0x50 || p[p.length - 1] !== 0xff) return null;
  return ((p[4] << 4) | p[5]) - 0x80;
}

export class ViscaIpCamera implements MatchCamera {
  params = VISCA_PARAMS;
  private seq = 1;
  constructor(private t: ViscaTransport) {}
  async read(): Promise<Values> {
    const out: Values = {};
    for (const p of this.params) {
      const v = viscaGainParse(await this.t.send(viscaPacket('inquiry', this.seq++, [0x81, 0x09, 0x04, VISCA_GAIN[p.id], 0xff])));
      if (v != null) out[p.id] = v;
    }
    return out;
  }
  async write(v: Values) {
    for (const [k, x] of Object.entries(v)) {
      if (!(k in VISCA_GAIN)) continue;
      const p = (await this.t.send(viscaPacket('command', this.seq++, viscaGainCommand(k, x)))).subarray(8);
      if (p.length >= 2 && (p[1] & 0xf0) === 0x60) throw new Error(`VISCA error ${Array.from(p, (b) => b.toString(16).padStart(2, '0')).join(' ')}`);
    }
  }
}
