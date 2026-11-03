// Frame protocol 2 (docs/frame-protocol.md): binary header and the 20 ms sound packetizer,
// shared by the ffmpeg path (server/index.mjs) and the capture helpers (server/helper-input.mjs).

/** 16-byte header of proto 2: 4 ASCII bytes, uint32, float64 (little endian). */
export function packetHeader(magic, count, value) {
  const b = Buffer.alloc(16);
  b.write(magic, 0, 'ascii'); b.writeUInt32LE(count >>> 0, 4); b.writeDoubleLE(value, 8);
  return b;
}

/** Splits a raw f32le stream into 20 ms packets with an LZA1 header; never drops. */
export class AudioPacketizer {
  constructor(sampleRate, channels, send) {
    this.frameBytes = channels * 4;
    this.packetFrames = Math.max(1, Math.round(sampleRate * 0.02));
    this.send = send; this.pending = []; this.bytes = 0; this.index = 0; this.packets = 0;
  }
  push(chunk) {
    this.pending.push(chunk); this.bytes += chunk.length;
    const want = this.packetFrames * this.frameBytes;
    while (this.bytes >= want) this.emit(want);
  }
  flush() { const b = this.bytes - (this.bytes % this.frameBytes); if (b > 0) this.emit(b); }
  emit(len) {
    const all = this.pending.length === 1 ? this.pending[0] : Buffer.concat(this.pending, this.bytes);
    const data = all.subarray(0, len), rest = all.subarray(len);
    this.pending = rest.length ? [rest] : []; this.bytes = rest.length;
    const n = len / this.frameBytes;
    this.send(Buffer.concat([packetHeader('LZA1', n, this.index), data]));
    this.index += n; this.packets++;
  }
}
