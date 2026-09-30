// H.264 transport for remote bridges (#16): ffmpeg encodes with libx264 into FLV on a pipe,
// this demuxer turns every FLV video tag into one H.264 access unit in Annex-B form
// (start codes; SPS/PPS in front of every key frame), as WebCodecs expects without a
// `description` (W3C AVC WebCodecs Registration, "annexb" format).
//
// FLV is used only as framing: every tag carries its length, so an access unit is complete
// the moment it arrives – splitting a raw Annex-B stream at the next access unit
// delimiter would add one frame of delay.
//
// FLV layout (as written by ffmpeg's flvenc): 9-byte header 'FLV', version, flags,
// uint32 header size; then per tag: uint32 previous tag size, 11-byte tag header
// (type, uint24 data size, uint24 timestamp + uint8 extension, uint24 stream id), data.
// Video tag data (type 9): byte (frame type << 4 | codec id 7 = AVC), AVC packet type
// (0 = AVCDecoderConfigurationRecord, 1 = NAL units), int24 composition time, payload.
// NAL units in the payload are length-prefixed (lengthSizeMinusOne + 1 bytes, from the
// configuration record, ISO/IEC 14496-15).

const START = Buffer.from([0, 0, 0, 1]);

/** RFC 6381 codec string from the first bytes of an AVCDecoderConfigurationRecord or SPS. */
export function avcCodecString(profile, compat, level) {
  const hex = (v) => v.toString(16).padStart(2, '0');
  return `avc1.${hex(profile)}${hex(compat)}${hex(level)}`;
}

/** Parse an AVCDecoderConfigurationRecord: NAL length size, SPS and PPS lists, codec string. */
export function parseAvcConfig(rec) {
  if (rec.length < 7 || rec[0] !== 1) throw new Error('AVCDecoderConfigurationRecord ungültig');
  const lengthSize = (rec[4] & 3) + 1;
  let i = 5;
  const sps = [], pps = [];
  const nSps = rec[i++] & 31;
  for (let k = 0; k < nSps; k++) { const n = rec.readUInt16BE(i); sps.push(rec.subarray(i + 2, i + 2 + n)); i += 2 + n; }
  const nPps = rec[i++];
  for (let k = 0; k < nPps; k++) { const n = rec.readUInt16BE(i); pps.push(rec.subarray(i + 2, i + 2 + n)); i += 2 + n; }
  return { lengthSize, sps, pps, codec: avcCodecString(rec[1], rec[2], rec[3]) };
}

/** Length-prefixed NAL units → Annex B (optionally with parameter sets in front). */
export function toAnnexB(payload, lengthSize, prefix = []) {
  const parts = [];
  for (const p of prefix) parts.push(START, p);
  let i = 0;
  while (i + lengthSize <= payload.length) {
    let n = 0;
    for (let k = 0; k < lengthSize; k++) n = n * 256 + payload[i + k];
    i += lengthSize;
    if (n === 0 || i + n > payload.length) break;
    parts.push(START, payload.subarray(i, i + n));
    i += n;
  }
  return Buffer.concat(parts);
}

/**
 * Streaming FLV → H.264 demuxer. `onConfig({ codec })` once per configuration record,
 * `onFrame({ key, data, pts })` per access unit (Annex B, pts in ms).
 */
export class FlvH264Demuxer {
  constructor(onConfig, onFrame) {
    this.onConfig = onConfig; this.onFrame = onFrame;
    this.buf = Buffer.alloc(0); this.headerDone = false; this.config = null;
  }
  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    if (!this.headerDone) {
      if (this.buf.length < 13) return;
      if (this.buf.toString('ascii', 0, 3) !== 'FLV') throw new Error('kein FLV');
      const size = this.buf.readUInt32BE(5);
      this.buf = this.buf.subarray(size + 4); // header + PreviousTagSize0
      this.headerDone = true;
    }
    while (this.buf.length >= 11) {
      const type = this.buf[0] & 0x1f, size = this.buf.readUIntBE(1, 3);
      if (this.buf.length < 11 + size + 4) return;
      const ts = this.buf.readUIntBE(4, 3) | (this.buf[7] << 24);
      const data = this.buf.subarray(11, 11 + size);
      this.buf = this.buf.subarray(11 + size + 4);
      if (type === 9 && data.length > 5 && (data[0] & 0x0f) === 7) this.video(data, ts);
    }
  }
  video(data, ts) {
    const key = data[0] >> 4 === 1, packetType = data[1];
    const cts = ((data[2] << 16) | (data[3] << 8) | data[4]) << 8 >> 8; // int24
    const payload = data.subarray(5);
    if (packetType === 0) {
      this.config = parseAvcConfig(payload);
      this.onConfig({ codec: this.config.codec });
    } else if (packetType === 1 && this.config) {
      const c = this.config;
      this.onFrame({ key, pts: ts + cts, data: toAnnexB(payload, c.lengthSize, key ? [...c.sps, ...c.pps] : []) });
    }
  }
}
