// Transport on the file path (#191): play, pause, step, seek and shuttle on a file that ffmpeg
// decodes for the scopes (server/media.mjs, input `file:<name>`). The browser's <video> path has
// had this all along; through the bridge it is the only way to hold a 10-bit or 16-bit picture
// still and step through it frame by frame.
//
// ffmpeg cannot be steered once it runs, so every command starts a new one:
//   playing  `-ss <pos> -readrate <rate> -i file`   – paced like a player, the clip loops
//   paused   `-ss <pos> -i file -frames:v 1`        – exactly one picture, it stays on the scopes
// The position comes from the frames handed out since that start (`pos + n / fps`), never from
// ffmpeg's own output – a dropped frame on a busy socket must not move the playhead.
//
// Messages from the page on the stream socket:
//   {type:'clip', op:'play'|'pause'|'seek'|'step'|'rate'|'loop', pos?: s, frames?: n, rate?: x, loop?: bool}
// Message to the page: {type:'clip', state:'playing'|'paused', pos, duration, fps, rate, loop}

/** Rates the page may ask for (shuttle ×2 … ×8, slow motion); outside this it is clamped. */
export const RATE_MIN = 0.1, RATE_MAX = 16;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class ClipTransport {
  /** `send`: message to the page, `relaunch`: start ffmpeg again with the new input arguments. */
  constructor({ duration = 0, fps = 25, loop = true, send = () => {}, relaunch = () => {} } = {}) {
    this.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    this.fps = Number.isFinite(fps) && fps > 0 && fps <= 1000 ? fps : 25;
    this.loop = loop !== false;
    this.send = send;
    this.relaunch = relaunch;
    this.state = 'playing';
    this.rate = 1;
    /** media position (s) the running ffmpeg started at */
    this.pos = 0;
    /** frames it has handed out since then */
    this.frames = 0;
  }

  get paused() { return this.state === 'paused'; }

  /** Media position (s) now; paused it is the picture on screen, not the one read ahead. */
  position() { return this.clampPos(this.paused ? this.pos : this.pos + this.frames / this.fps); }

  /** Position inside the clip (a clip without a known length is not bounded at the end). */
  clampPos(p) {
    const x = Number.isFinite(p) ? Math.max(0, p) : 0;
    return this.duration ? Math.min(this.duration, x) : x;
  }

  /** Frame number of a position (a position may sit in the middle of its frame, see frameStart). */
  frameIndex(p) { return Math.max(0, Math.floor(p * this.fps + 1e-6)); }

  /** Middle of the frame `n` steps on from `p`: a seek must not land on the neighbour. */
  frameStart(p, n = 0) {
    const last = this.duration ? Math.max(0, Math.ceil(this.duration * this.fps) - 1) : Infinity;
    return (clamp(this.frameIndex(p) + n, 0, last) + 0.5) / this.fps;
  }

  /** Input arguments for the next ffmpeg: from where, how fast, and one single picture when paused. */
  input() { return { pos: this.pos, rate: this.paused ? 0 : this.rate, frames: this.paused ? 1 : 0 }; }

  /** One frame went out (both the raw and the H.264 path count here). */
  onFrame() { this.frames++; }

  /** Command from the page; → true when it was one. */
  handle(m) {
    const op = String(m?.op ?? '');
    const asked = Number(m?.pos);
    const from = Number.isFinite(asked) ? this.clampPos(asked) : this.position();
    const rate = Number(m?.rate);
    if (op === 'play') {
      if (Number.isFinite(rate) && rate > 0) this.rate = clamp(rate, RATE_MIN, RATE_MAX);
      // play from the very end: again from the start, like the <video loop> of the browser path
      const atEnd = this.duration > 0 && from >= this.duration - 0.5 / this.fps;
      this.goto(atEnd ? 0 : from, 'playing');
    } else if (op === 'pause') {
      this.goto(this.frameStart(from), 'paused');
    } else if (op === 'seek') {
      // a seek keeps playing or stays paused – that is what a playhead drag does
      this.goto(this.paused ? this.frameStart(from) : from, this.state);
    } else if (op === 'step') {
      this.goto(this.frameStart(this.position(), Math.round(Number(m?.frames) || 0)), 'paused');
    } else if (op === 'rate') {
      this.rate = clamp(Number.isFinite(rate) && rate > 0 ? rate : 1, RATE_MIN, RATE_MAX);
      this.goto(from, 'playing');
    } else if (op === 'loop') {
      this.loop = m?.loop !== false;
      this.report();
    } else return false;
    return true;
  }

  /** New position and state: the running ffmpeg is replaced by one that starts there. */
  goto(pos, state) {
    this.pos = this.clampPos(pos);
    this.frames = 0;
    this.state = state;
    this.report();
    this.relaunch();
  }

  /**
   * ffmpeg ended. → 'hold': the socket stays open with the picture it has (the single frame of a
   * pause, or the end of a clip that does not loop), 'relaunch': play on from the start (loop),
   * 'end': a real error, the socket reports it.
   */
  onExit(code) {
    if (this.paused) return 'hold';
    if (code !== 0) return 'end';
    if (this.loop) { this.pos = 0; this.frames = 0; this.report(); return 'relaunch'; }
    this.pos = this.duration || this.position();
    this.frames = 0;
    this.state = 'paused';
    this.report();
    return 'hold';
  }

  /** Where the playhead stands, for the page. */
  report() {
    this.send({
      type: 'clip', state: this.state, pos: Math.round(this.position() * 1000) / 1000,
      duration: this.duration, fps: this.fps, rate: this.rate, loop: this.loop,
    });
  }
}
