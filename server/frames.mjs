// Whole-frame assembly for the raw video pipes (ffmpeg rawvideo → WebSocket).
//
// ffmpeg writes a frame as one continuous run of bytes, but the pipe hands it over in chunks
// of arbitrary size. The scopes must only ever see complete pictures – one frame, never the
// tail of one and the head of the next (no "rolling shutter" mix, no tearing). This class
// collects chunks and emits each frame as its own buffer exactly when all of its bytes are
// there; the emitted buffers never share memory with later frames.

export class FrameAssembler {
  /** @param {number} frameBytes @param {(frame: Buffer) => void} onFrame */
  constructor(frameBytes, onFrame) {
    this.frameBytes = frameBytes; this.onFrame = onFrame;
    /** @type {Buffer[]} */
    this.pending = []; this.bytes = 0;
  }
  /** @param {Buffer} chunk */
  push(chunk) {
    if (!(this.frameBytes > 0)) return;
    this.pending.push(chunk); this.bytes += chunk.length;
    while (this.bytes >= this.frameBytes) {
      const all = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending, this.bytes);
      // copy: the frame owns its memory, independent of the pipe's chunk buffers
      const frame = Buffer.from(all.subarray(0, this.frameBytes));
      const rest = all.subarray(this.frameBytes);
      // the remainder is copied as well, so no frame depends on the caller's chunk memory
      this.pending = rest.length ? [Buffer.from(rest)] : []; this.bytes = rest.length;
      this.onFrame(frame);
    }
  }
  /** bytes of the next, still incomplete frame */
  get partial() { return this.bytes; }
}
