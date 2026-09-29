// Minimal reader for uncompressed, interleaved RGB/RGBA TIFFs with 8 or 16 bit per
// sample (what DaVinci Resolve's ExportCurrentFrameAsStill writes as .tif).

/** @returns {{ width: number, height: number, bits: number, spp: number, data: Uint8Array | Uint16Array }} */
export function readTiff(buf) {
  const le = buf[0] === 0x49; // 'II'
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  if (u16(2) !== 42) throw new Error('keine TIFF-Datei');
  const ifd = u32(4), n = u16(ifd), tags = {};
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + k * 12, tag = u16(e), type = u16(e + 2), count = u32(e + 4);
    const size = type === 3 ? 2 : type === 4 ? 4 : 1;
    const at = count * size > 4 ? u32(e + 8) : e + 8;
    const vals = [];
    for (let j = 0; j < Math.min(count, 4096); j++) vals.push(type === 3 ? u16(at + j * 2) : type === 4 ? u32(at + j * 4) : buf[at + j]);
    tags[tag] = vals;
  }
  const width = tags[256][0], height = tags[257][0], bits = tags[258]?.[0] ?? 8, spp = tags[277]?.[0] ?? 1;
  if ((tags[259]?.[0] ?? 1) !== 1) throw new Error('komprimiertes TIFF wird nicht unterstützt');
  if ((tags[284]?.[0] ?? 1) !== 1) throw new Error('planares TIFF wird nicht unterstützt');
  const offsets = tags[273], counts = tags[279];
  const bytes = width * height * spp * (bits / 8);
  const raw = Buffer.alloc(bytes);
  let pos = 0;
  for (let s = 0; s < offsets.length && pos < bytes; s++) { buf.copy(raw, pos, offsets[s], offsets[s] + counts[s]); pos += counts[s]; }
  let data;
  if (bits !== 16) data = new Uint8Array(raw.buffer, raw.byteOffset, bytes);
  else if (le && raw.byteOffset % 2 === 0) data = new Uint16Array(raw.buffer, raw.byteOffset, bytes / 2); // zero-copy on little-endian hosts
  else { data = new Uint16Array(bytes / 2); for (let i = 0; i < data.length; i++) data[i] = le ? raw.readUInt16LE(i * 2) : raw.readUInt16BE(i * 2); }
  return { width, height, bits, spp, data };
}

/** Interleaved RGB(A) → RGBA of the given bit depth, nearest-neighbour downscale to maxWidth. */
export function toRgba(img, maxWidth, outBits) {
  const scale = maxWidth > 0 && img.width > maxWidth ? img.width / maxWidth : 1;
  const w = Math.round(img.width / scale) & ~1, h = Math.round(img.height / scale) & ~1;
  const out = outBits === 16 ? new Uint16Array(w * h * 4) : new Uint8Array(w * h * 4);
  const conv = img.bits === outBits ? 1 : img.bits === 16 ? 1 / 257 : 257;
  const max = outBits === 16 ? 65535 : 255;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor(y * scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor(x * scale)), i = (sy * img.width + sx) * img.spp, o = (y * w + x) * 4;
      out[o] = img.data[i] * conv; out[o + 1] = img.data[i + 1] * conv; out[o + 2] = img.data[i + 2] * conv; out[o + 3] = max;
    }
  }
  return { width: w, height: h, data: out };
}
