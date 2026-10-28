// QC metrics from ffmpeg's `signalstats` filter (#202, idea from QCTools): temporal outliers,
// vertical line repetition and the share outside the broadcast range. They find the faults that
// a waveform does not show by itself – single dropped pixels from a radio link, repeated lines
// from a hung decoder, levels outside 16–235 on the Y′CbCr signal.
//
// The filter runs before the scaler (on the full picture, in Y′CbCr – after our scale it would
// be R′G′B′ and BRNG meaningless) and prints its values through `metadata=mode=print` into the
// log, in the same shape as showinfo:
//
//   [Parsed_metadata_1 @ …] frame:12   pts:12  pts_time:0.48
//   [Parsed_metadata_1 @ …] lavfi.signalstats.YMIN=16
//   …
//
// A frame is complete when the next `frame:` line arrives, or when the reader flushes.

/** Filter chain in front of the scaler; `stat` keeps the three that cost something. */
export const SIGNALSTATS_VF = 'signalstats=stat=tout+vrep+brng,metadata=mode=print';

const KEYS = {
  YMIN: 'yMin', YLOW: 'yLow', YAVG: 'yAvg', YHIGH: 'yHigh', YMAX: 'yMax',
  UAVG: 'uAvg', VAVG: 'vAvg', SATAVG: 'satAvg', SATMAX: 'satMax', HUEMED: 'hueMed',
  TOUT: 'tout', VREP: 'vrep', BRNG: 'brng', YDIF: 'yDif',
};

/** One frame's metrics; shares are 0…1, levels are 8-bit code values as ffmpeg reports them. */
export class SignalstatsTracker {
  /** @param {(m: Record<string, number>) => void} onFrame called at most `everyMs` apart */
  constructor(onFrame, everyMs = 250) {
    this.onFrame = onFrame;
    this.everyMs = everyMs;
    this.rest = '';
    this.cur = null;
    this.last = 0;
  }

  /** stderr chunk; returns the lines that are not ours (errors belong in the tail). */
  push(text) {
    const lines = (this.rest + text).split('\n');
    this.rest = lines.pop() ?? '';
    const other = [];
    for (const line of lines) {
      if (!/Parsed_metadata_\d+/.test(line)) { other.push(line); continue; }
      const frame = /\bframe:(\d+)/.exec(line);
      if (frame) { this.flush(); this.cur = { frame: Number(frame[1]) }; continue; }
      const kv = /lavfi\.signalstats\.([A-Z]+)=(-?[\d.]+)/.exec(line);
      if (kv && this.cur) {
        const key = KEYS[kv[1]];
        if (key) this.cur[key] = Number(kv[2]);
      }
    }
    return other;
  }

  /** Hand the frame on, at most every `everyMs` – the values are a QC reading, not a trace. */
  flush(now = Date.now()) {
    const m = this.cur;
    this.cur = null;
    if (!m || m.yAvg === undefined) return;
    if (now - this.last < this.everyMs) return;
    this.last = now;
    this.onFrame(m);
  }
}
