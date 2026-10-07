// Single-entry ZIP extraction for the test videos (#52): the Blender downloads are ZIP files
// with one entry, stored or deflate. Streams the entry and checks size and CRC-32.
const fs = require('node:fs');
const zlib = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

/** Read the local header of a single-entry ZIP and stream its data to `out`, checking CRC-32 and size. */
async function unzipSingle(zipPath, out, expect) {
  const fd = await fs.promises.open(zipPath, 'r');
  try {
    const head = Buffer.alloc(30);
    await fd.read(head, 0, 30, 0);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error('kein ZIP');
    const flags = head.readUInt16LE(6), method = head.readUInt16LE(8);
    const comp = head.readUInt32LE(18), nameLen = head.readUInt16LE(26), extraLen = head.readUInt16LE(28);
    if (flags & 0x1) throw new Error('verschlüsseltes ZIP');
    if ((flags & 0x8) && !comp) throw new Error('ZIP mit nachgestellten Größen nicht unterstützt');
    if (method !== 0 && method !== 8) throw new Error(`ZIP-Methode ${method} nicht unterstützt`);
    const start = 30 + nameLen + extraLen;
    let crc = 0, n = 0;
    const check = new Transform({ transform(chunk, _e, cb) { crc = zlib.crc32(chunk, crc); n += chunk.length; cb(null, chunk); } });
    const src = fs.createReadStream(zipPath, { start, end: start + comp - 1 });
    await pipeline(src, ...(method === 8 ? [zlib.createInflateRaw()] : []), check, fs.createWriteStream(out));
    if (n !== expect.size) throw new Error(`entpackt ${n} statt ${expect.size} Bytes`);
    if (crc.toString(16).padStart(8, '0') !== expect.crc32) throw new Error('CRC-32 stimmt nicht');
  } finally { await fd.close(); }
}

module.exports = { unzipSingle };
