// Touch Shading (#54): gestures on parade, waveform and vectorscope move the paint of a camera
// (through lz-camera-bridge) or of the simulator. Off by default; only while "Shading aktiv" is
// on, with a target chosen, do pointer drags on these scopes send anything. A stop button puts
// back every value the session changed.

import { WAVE_ZOOMS, channelLayout, isWaveform, plotRect, waveLevel, type ScopeType } from '../graticule';
import type { PanelState } from '../panel';
import type { Source } from '../sources';
import { CameraBridgeLink } from './bridge';
import {
  FIELDS, LIMITS, NEUTRAL_PAINT, busCommands, slopeScale, clampValue, fieldAvailable, formatValue, slope, vectorGesture, vectorMode, waveTarget,
  type Channel, type Paint, type PaintField,
} from './model';
import { ShadingSim, SIM_URL } from './sim';
import { T } from './text';

const STORE = 'lz-scopes.shading';
type Target = 'sim' | number;

interface Gesture {
  panel: number;
  scope: ScopeType;
  fields: PaintField[];
  channel: Channel | 'y';
  /** waveform: section of the parade (0-based) and the level grabbed / the level now */
  section?: number; sections?: number;
  grab?: number; level?: number;
  /** vectorscope: centre-relative pointer positions */
  from?: [number, number]; last?: [number, number]; mode?: 'hue' | 'saturation' | null;
  startSat?: number;
  /** fractional bus units not yet sent */
  acc: number;
  before: Paint;
}

export interface ShadingHost {
  /** create (or find) the simulator source and show it in the panels */
  simSource(): Source;
  panelSource(p: PanelState): Source | null;
  hud(msg: string): void;
  redraw(): void;
}

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: (Node | string)[]) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) (el as unknown as Record<string, unknown>)[k] = v;
    else if (v !== undefined && v !== false) el.setAttribute(k, String(v));
  }
  el.append(...kids);
  return el;
};

const SUPPORTED: ScopeType[] = ['parade', 'yrgb', 'wf-luma', 'wf-color', 'vector'];

export class ShadingControl {
  active = false;
  target: Target | null = null;
  /** values at the start of the session (the stop button returns to these) */
  start: Paint = {};
  cur: Paint = {};
  touched = new Set<PaintField>();
  undoStack: Paint[] = [];
  gesture: Gesture | null = null;
  message = '';
  bridgeUrl = 'ws://localhost:9700';
  /** where the bar sits; it covers part of the scopes, so it can move out of the way */
  atTop = false;
  open = false;
  readonly link: CameraBridgeLink;
  private sim: ShadingSim | null = null;
  private dirty = new Set<PaintField>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private bar: HTMLElement;
  private version = 0;

  constructor(private host: ShadingHost, mount: HTMLElement) {
    try { const s = JSON.parse(localStorage.getItem(STORE) ?? '{}'); if (typeof s.bridgeUrl === 'string') this.bridgeUrl = s.bridgeUrl; this.atTop = s.atTop === true; } catch { /* defaults */ }
    this.link = new CameraBridgeLink(() => this.bridgeUrl, () => { this.syncFromBridge(); this.render(); });
    this.bar = h('div', { class: 'shading-bar hidden', role: 'region', 'aria-label': 'Touch Shading' });
    mount.append(this.bar);
    window.addEventListener('keydown', (e) => { if (this.active && e.key === 'Escape' && this.touched.size) { e.preventDefault(); this.emergencyStop(); } });
    this.render();
  }

  /** changes whenever the overlay must be redrawn */
  sig() { return this.active ? `sh${this.version}` : ''; }

  toggleBar(force?: boolean) {
    this.open = force ?? !this.open;
    if (this.open) this.link.connect();
    this.render();
  }

  private persist() { try { localStorage.setItem(STORE, JSON.stringify({ bridgeUrl: this.bridgeUrl, atTop: this.atTop })); } catch { /* private window */ } }

  private mode(): string | 'sim' {
    if (this.target === 'sim') return 'sim';
    return this.link.cameras.find((c) => c.cameraNumber === this.target)?.mode ?? '';
  }

  // ------------------------------------------------------------ session

  async setTarget(t: Target | null) {
    if (this.active) this.deactivate();
    this.target = t;
    if (t === 'sim') {
      const src = this.host.simSource();
      this.sim ??= new ShadingSim(src);
      if (!this.sim.paint.saturation) await this.sim.start(NEUTRAL_PAINT);
    }
    this.render();
  }

  activate() {
    if (this.target === null) { this.message = T.chooseTargetFirst; this.render(); return; }
    const known = this.targetPaint();
    this.start = { ...known };
    this.cur = { ...known };
    this.touched.clear();
    this.undoStack = [];
    this.active = true;
    this.message = this.target === 'sim' ? T.simNote : '';
    this.bump();
  }

  deactivate() {
    this.flush();
    this.active = false;
    this.gesture = null;
    this.bump();
  }

  /** Not-Aus: every value of this session back to where it started, then off. */
  emergencyStop() {
    if (this.touched.size) {
      for (const f of this.touched) this.cur[f] = this.start[f];
      this.dirty = new Set(this.touched);
      this.flush();
      this.host.hud(T.restored(this.touched.size));
    }
    this.touched.clear();
    this.undoStack = [];
    this.deactivate();
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    for (const f of Object.keys(prev) as PaintField[]) { this.cur[f] = prev[f]; this.dirty.add(f); }
    this.flush();
    this.bump();
  }

  private targetPaint(): Paint {
    if (this.target === 'sim') return { ...NEUTRAL_PAINT, ...(this.sim?.paint ?? {}) };
    if (typeof this.target === 'number') return { ...(this.link.states.get(this.target)?.paint ?? {}) };
    return {};
  }

  /** state broadcast of the bridge: values nobody in this session is moving follow the camera */
  private syncFromBridge() {
    if (!this.active || typeof this.target !== 'number') return;
    const st = this.link.states.get(this.target)?.paint ?? {};
    for (const f of Object.keys(st) as PaintField[]) {
      if (this.start[f] === undefined) this.start[f] = st[f];
      if (!this.dirty.has(f) && !(this.gesture?.fields.includes(f))) this.cur[f] = st[f];
    }
  }

  private bump() { this.version++; document.body.classList.toggle('shading-on', this.active); this.render(); this.host.redraw(); }

  /** Move fields by `by` bus units (each within its rails); returns whether anything changed. */
  private move(fields: PaintField[], by: number): boolean {
    let moved = false;
    for (const f of fields) {
      const v = this.cur[f];
      if (v === undefined) continue;
      const next = clampValue(f, this.start[f] ?? v, v + by);
      if (next !== v) { this.cur[f] = next; this.dirty.add(f); this.touched.add(f); moved = true; }
    }
    if (moved) this.scheduleFlush();
    return moved;
  }

  private setField(f: PaintField, value: number): boolean {
    const v = this.cur[f];
    if (v === undefined) return false;
    const lim = f === 'hue' ? LIMITS.hueStep : LIMITS.step;
    const next = clampValue(f, this.start[f] ?? v, Math.max(v - lim, Math.min(v + lim, value)));
    if (next === v) return false;
    this.cur[f] = next; this.dirty.add(f); this.touched.add(f);
    this.scheduleFlush();
    return true;
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, 50); // ≤ 20 commands/s
  }

  private flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!this.dirty.size) return;
    const changed = [...this.dirty];
    this.dirty.clear();
    if (this.target === 'sim') { this.sim?.set(this.cur); }
    else if (typeof this.target === 'number') {
      const { commands, error } = busCommands(changed, this.cur, this.mode());
      if (error) { this.message = error === 'hue' ? T.hueNotOnBus : T.tripleUnknown(error === 'black' ? 'Black' : 'White'); this.render(); return; }
      for (const c of commands) if (!this.link.send(this.target, c.cmd, c.params)) { this.message = T.notConnected; break; }
    }
    this.version++;
    this.host.redraw();
    this.renderValues();
  }

  // ------------------------------------------------------------ gestures

  /** Attach to a panel body. Capture phase: while shading is active, the gesture owns the drag. */
  attach(body: HTMLElement, idx: number, p: () => PanelState) {
    body.addEventListener('pointerdown', (e) => {
      if (!this.active || e.button !== 0 || !SUPPORTED.includes(p().scope)) return;
      const g = this.begin(e, body, idx, p());
      if (!g) return;
      e.stopImmediatePropagation(); e.preventDefault();
      try { body.setPointerCapture(e.pointerId); } catch { /* synthetic events */ }
    }, { capture: true });
    body.addEventListener('pointermove', (e) => {
      if (!this.gesture || this.gesture.panel !== idx) return;
      e.stopImmediatePropagation();
      this.update(e, body, p());
    }, { capture: true });
    const end = (e: PointerEvent) => {
      if (!this.gesture || this.gesture.panel !== idx) return;
      e.stopImmediatePropagation();
      const g = this.gesture;
      this.gesture = null;
      if (g.fields.some((f) => this.cur[f] !== g.before[f])) this.undoStack.push(g.before);
      this.flush();
      this.bump();
    };
    body.addEventListener('pointerup', end, { capture: true });
    body.addEventListener('pointercancel', end, { capture: true });
  }

  private refuse(msg: string) { this.message = msg; this.host.hud(`Shading: ${msg}`); this.render(); return null; }

  private begin(e: PointerEvent, body: HTMLElement, idx: number, p: PanelState): Gesture | null {
    const b = body.getBoundingClientRect();
    const x = e.clientX - b.left, y = e.clientY - b.top;
    const r = plotRect(p.scope, b.width, b.height);
    if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return null;
    let g: Gesture;
    if (isWaveform(p.scope)) {
      const level = waveLevel(r, y, WAVE_ZOOMS[p.waveZoom ?? 'full']);
      let channel: Channel | 'y' = 'y', section = 0, sections = 1;
      if (p.scope === 'parade' || p.scope === 'yrgb') {
        const lay = channelLayout(p.scope, p.channels);
        sections = lay.n;
        section = Math.min(lay.n - 1, Math.floor(((x - r.x) / r.w) * lay.n));
        channel = lay.names[section].toLowerCase() as Channel | 'y';
      }
      const t = waveTarget(channel, level);
      if (t.kind === 'refused') return this.refuse(t.reason);
      g = { panel: idx, scope: p.scope, fields: t.fields, channel, section, sections, grab: level, level, acc: 0, before: {} };
    } else {
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const from: [number, number] = [x - cx, cy - y];
      if (Math.hypot(...from) < r.w * 0.04) return this.refuse(T.vectorCentre);
      g = { panel: idx, scope: p.scope, fields: ['hue', 'saturation'], channel: 'y', from, last: from, mode: null, startSat: this.cur.saturation, acc: 0, before: {} };
    }
    const mode = this.mode();
    const missing = g.fields.filter((f) => !fieldAvailable(f, mode));
    if (g.scope !== 'vector' && missing.length) return this.refuse(T.notControllable(missing.map((f) => FIELDS[f].label).join(', '), mode || '?'));
    const unknown = g.fields.filter((f) => fieldAvailable(f, mode) && this.cur[f] === undefined);
    if (g.scope !== 'vector' && unknown.length) return this.refuse(T.unknownValue(unknown.map((f) => FIELDS[f].label).join(', ')));
    for (const f of g.fields) g.before[f] = this.cur[f];
    this.message = '';
    this.gesture = g;
    this.bump();
    return g;
  }

  private update(e: PointerEvent, body: HTMLElement, p: PanelState) {
    const g = this.gesture!;
    const b = body.getBoundingClientRect();
    const x = e.clientX - b.left, y = e.clientY - b.top;
    const r = plotRect(p.scope, b.width, b.height);
    if (g.scope !== 'vector') {
      const level = waveLevel(r, y, WAVE_ZOOMS[p.waveZoom ?? 'full']);
      const d = level - g.level!;
      g.level = level;
      const ch: Channel = g.channel === 'y' ? 'g' : g.channel;
      const k = slope(g.fields[0], ch, g.grab!, this.cur) * slopeScale(this.mode(), g.fields[0]);
      if (Math.abs(k) < 1e-5) return;
      g.acc += d / k;
      const step = Math.max(-LIMITS.step, Math.min(LIMITS.step, Math.trunc(g.acc)));
      if (step) { g.acc -= step; this.move(g.fields, step); }
      this.version++; this.host.redraw(); this.renderValues();
      return;
    }
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const to: [number, number] = [x - cx, cy - y];
    g.mode ??= vectorMode(g.from!, to);
    if (!g.mode) return;
    const mode = this.mode();
    if (!fieldAvailable(g.mode, mode)) {
      this.message = g.mode === 'hue' ? T.hueSimOnly : T.notControllable(FIELDS.saturation.label, mode);
      this.render(); return;
    }
    if (this.cur[g.mode] === undefined) { this.message = T.unknownValue(FIELDS[g.mode].label); this.render(); return; }
    if (g.mode === 'hue') {
      const { dHue } = vectorGesture(g.last!, to);
      g.acc += dHue;
      const step = Math.max(-LIMITS.hueStep, Math.min(LIMITS.hueStep, Math.trunc(g.acc)));
      if (step) { g.acc -= step; this.move(['hue'], step); }
    } else {
      const { satFactor } = vectorGesture(g.from!, to);
      this.setField('saturation', (g.startSat ?? 128) * satFactor);
    }
    g.last = to;
    this.version++; this.host.redraw(); this.renderValues();
  }

  // ------------------------------------------------------------ overlay

  /** Drawn on top of the panel's overlay: live badge, target line and the value under the finger. */
  drawOverlay(ctx: CanvasRenderingContext2D, idx: number, p: PanelState, w: number, h: number) {
    if (!this.active || !SUPPORTED.includes(p.scope)) return;
    const r = plotRect(p.scope, w, h);
    ctx.save();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = 1; ctx.setLineDash([]);
    ctx.font = '600 11px system-ui, sans-serif';
    const label = this.target === 'sim' ? T.badgeSim : T.badgeCam(this.target as number);
    const tw = ctx.measureText(label).width + 12;
    ctx.fillStyle = 'rgba(214, 64, 52, 0.85)';
    ctx.fillRect(r.x + r.w - tw - 4, r.y + 4, tw, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText(label, r.x + r.w - tw + 2, r.y + 17);
    const g = this.gesture;
    if (g && g.panel === idx) {
      const lines = g.fields.filter((f) => this.cur[f] !== undefined).map((f) => `${FIELDS[f].label} ${formatValue(f, this.cur[f], this.start[f])}`);
      if (g.scope !== 'vector') {
        const range = WAVE_ZOOMS[p.waveZoom ?? 'full'];
        const yOf = (l: number) => r.y + r.h - ((l - range[0]) / (range[1] - range[0])) * r.h;
        const sw = r.w / (g.sections ?? 1), sx = r.x + sw * (g.section ?? 0);
        ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(sx, yOf(g.grab!)); ctx.lineTo(sx + sw, yOf(g.grab!)); ctx.stroke();
        ctx.setLineDash([]); ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, yOf(g.level!)); ctx.lineTo(sx + sw, yOf(g.level!)); ctx.stroke();
        lines.unshift(T.target((g.level! * 100).toFixed(1), (g.grab! * 100).toFixed(1)));
        this.box(ctx, sx + 6, Math.max(r.y + 26, yOf(g.level!) - 8 - lines.length * 14), lines);
      } else {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const [lx, ly] = g.last!;
        ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + lx, cy - ly); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, Math.hypot(lx, ly), 0, Math.PI * 2); ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
        const shown = g.mode ? [`${FIELDS[g.mode].label} ${formatValue(g.mode, this.cur[g.mode], this.start[g.mode])}`] : [T.vectorHint];
        this.box(ctx, r.x + 6, r.y + 26, shown);
      }
    }
    ctx.restore();
  }

  private box(ctx: CanvasRenderingContext2D, x: number, y: number, lines: string[]) {
    ctx.font = '12px ui-monospace, monospace';
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x, y, w, lines.length * 15 + 6);
    ctx.fillStyle = '#fff';
    lines.forEach((l, i) => ctx.fillText(l, x + 6, y + 15 + i * 15));
  }

  // ------------------------------------------------------------ bar

  private valuesEl: HTMLElement | null = null;

  private renderValues() {
    if (!this.valuesEl) return;
    const mode = this.mode();
    const fields = (Object.keys(FIELDS) as PaintField[]).filter((f) => fieldAvailable(f, mode) && (this.active ? this.cur[f] !== undefined : true));
    this.valuesEl.replaceChildren(...fields.map((f) => {
      const v = this.active ? this.cur[f] : this.targetPaint()[f];
      const changed = this.active && this.cur[f] !== this.start[f];
      return h('span', { class: `shv${changed ? ' changed' : ''}`, 'data-field': f }, `${FIELDS[f].label} ${formatValue(f, v, this.active ? this.start[f] : undefined)}`);
    }));
  }

  render() {
    const b = this.bar;
    b.classList.toggle('hidden', !this.open);
    b.classList.toggle('live', this.active);
    b.classList.toggle('top', this.atTop);
    if (!this.open) return;
    const cams = this.link.cameras;
    const targetSel = h('select', {
      title: T.targetTitle, 'data-shading-target': '',
      onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; void this.setTarget(v === '' ? null : v === 'sim' ? 'sim' : Number(v)); },
    }, h('option', { value: '' }, T.chooseTarget), h('option', { value: 'sim' }, T.simOption),
      ...cams.map((c) => h('option', { value: String(c.cameraNumber) }, T.camOption(c.cameraNumber, c.label, c.connected, c.mode)))) as HTMLSelectElement;
    targetSel.value = this.target === null ? '' : String(this.target);
    const url = h('input', { class: 'shading-url', value: this.bridgeUrl, title: T.urlTitle, spellcheck: 'false' }) as HTMLInputElement;
    url.onchange = () => { this.bridgeUrl = url.value.trim(); this.persist(); this.link.disconnect(); this.link.connect(); };
    const linkTxt = this.link.status === 'open' ? T.linkOpen(cams.length) : this.link.status === 'connecting' ? T.linkConnecting : T.linkClosed;
    this.valuesEl = h('div', { class: 'shading-values' });
    b.replaceChildren(
      h('label', { class: 'shading-arm' },
        h('input', { type: 'checkbox', 'data-shading-active': '', ...(this.active ? { checked: '' } : {}), onchange: (e: Event) => ((e.target as HTMLInputElement).checked ? this.activate() : this.deactivate()) }),
        h('span', {}, T.active)),
      targetSel,
      h('button', { class: 'shading-undo', title: T.undoTitle, disabled: !this.undoStack.length || !this.active, onclick: () => this.undo() }, T.undo),
      h('button', { class: 'shading-stop', 'data-shading-stop': '', title: T.stopTitle, onclick: () => this.emergencyStop() }, T.stop),
      this.valuesEl,
      h('details', { class: 'shading-more' }, h('summary', {}, 'Bridge'),
        h('div', { class: 'row' }, url), h('div', { class: 'hint' }, linkTxt),
        h('p', { class: 'hint' }, T.help(LIMITS.step, LIMITS.span))),
      h('span', { class: 'shading-msg', 'data-shading-msg': '' }, this.message),
      h('button', { class: 'icon', title: T.moveBar, onclick: () => { this.atTop = !this.atTop; this.persist(); this.render(); } }, '⇅'),
      h('button', { class: 'icon', title: T.close, onclick: () => { if (this.active) this.deactivate(); this.toggleBar(false); } }, '✕'),
    );
    this.renderValues();
  }
}

export { SIM_URL };
