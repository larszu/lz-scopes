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
