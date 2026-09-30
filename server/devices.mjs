// Capture devices through ffmpeg (avfoundation / dshow / v4l2): format lists, explicit
// mode, raw pixel format and decode matrix. Used by server/index.mjs for `device:` URLs.
//
// Everything here only builds argument lists and parses ffmpeg's text output, so it is
// testable without hardware. The listings follow ffmpeg's own messages:
//   avfoundation: "Supported modes:" / "Supported pixel formats:" (libavdevice/avfoundation.m)
//   dshow:        -list_options true   (libavdevice/dshow.c)
//   v4l2:         -list_formats all    (libavdevice/v4l2.c)

/** device:<fmt>:<name> → { fmt, name } or null. */
export function parseDeviceUrl(url) {
  const m = /^device:(avfoundation|dshow|v4l2):(.+)$/.exec(url ?? '');
  return m ? { fmt: m[1], name: m[2] } : null;
}

/**
 * Raw pixel formats in order of preference: 10/16-bit 4:2:2 and 4:4:4 first (no
 * quantisation to 8 bit before the scopes), then packed 8-bit 4:2:2, then the rest.
 * Compressed formats (mjpeg, h264) come last – they are decoded, never preferred.
 */
export const PIXFMT_PREFERENCE = [
  'yuv422p16', 'yuv422p16le', 'yuv444p16', 'yuv444p16le', 'p216le', 'p216',
  'yuv422p10', 'yuv422p10le', 'yuv444p10', 'yuv444p10le', 'v210', 'p210le', 'p210', 'y210le', 'y210',
  'bgr48be', 'rgb48le', 'rgb48be',
  'uyvy422', 'yuyv422', 'nv16', 'yuv422p',
  'nv12', 'yuv420p', '0rgb', 'bgr0', 'rgb0', 'bgra', 'rgba', 'rgb24', 'bgr24',
];

/** Pixel formats that carry more than 8 bit per component. */
export const isDeepPixfmt = (p) => /(p10|p12|p16|p210|p216|y210|v210|48)/.test(String(p ?? ''));

/** Best raw format from what the device offers (null = let ffmpeg decide). */
export function pickPixfmt(supported) {
  const list = (supported ?? []).map(String);
  for (const p of PIXFMT_PREFERENCE) if (list.includes(p)) return p;
  return list.find((p) => !/mjpeg|h264|hevc|compressed/i.test(p)) ?? null;
}

/**
 * Modes and pixel formats from ffmpeg's messages.
 * @returns {{ modes: { width: number, height: number, fpsMin: number, fpsMax: number, pixfmt?: string }[], pixfmts: string[] }}
 */
export function parseFormatList(stderr, fmt) {
  const modes = [], pixfmts = [];
  const addPix = (p) => { if (p && !pixfmts.includes(p)) pixfmts.push(p); };
  const lines = String(stderr ?? '').split('\n');
  if (fmt === 'avfoundation') {
    let section = '';
    for (const l of lines) {
      if (/Supported modes:/i.test(l)) { section = 'modes'; continue; }
      if (/Supported pixel formats:/i.test(l)) { section = 'pix'; continue; }
      const mode = /\]\s+(\d+)x(\d+)@\[([\d.]+)\s+([\d.]+)\]fps/.exec(l);
      const pix = /\]\s{2,}([a-z0-9_]+)\s*$/.exec(l);
      if (section === 'modes' && mode) modes.push({ width: +mode[1], height: +mode[2], fpsMin: +mode[3], fpsMax: +mode[4] });
      else if (section === 'pix' && pix) addPix(pix[1]);
      else section = '';
    }
  } else if (fmt === 'dshow') {
    // [dshow @ …]   pixel_format=uyvy422  min s=1920x1080 fps=25 max s=1920x1080 fps=60
    // [dshow @ …]   vcodec=mjpeg  min s=1280x720 fps=5 max s=1280x720 fps=30
    for (const l of lines) {
      const m = /(pixel_format|vcodec)=(\S+)\s+min s=(\d+)x(\d+) fps=([\d.]+)\s+max s=(\d+)x(\d+) fps=([\d.]+)/.exec(l);
      if (!m) continue;
      const pixfmt = m[2];
      addPix(pixfmt);
      const w = +m[6], h = +m[7];
      if (!modes.some((x) => x.width === w && x.height === h && x.pixfmt === pixfmt && x.fpsMax === +m[8])) {
        modes.push({ width: w, height: h, fpsMin: +m[5], fpsMax: +m[8], pixfmt });
      }
    }
  } else if (fmt === 'v4l2') {
    // [video4linux2,v4l2 @ …] Raw       :     yuyv422 :           YUYV 4:2:2 : 640x480 1280x720
    // [video4linux2,v4l2 @ …] Compressed:       mjpeg :          Motion-JPEG : {32-1920, 2}x{…}
    for (const l of lines) {
      const m = /\]\s*(Raw|Compressed)\s*:\s*(\S+)\s*:[^:]*:\s*(.*)$/.exec(l);
      if (!m) continue;
      addPix(m[2]);
      for (const s of m[3].matchAll(/(\d+)x(\d+)/g)) modes.push({ width: +s[1], height: +s[2], fpsMin: 0, fpsMax: 0, pixfmt: m[2] });
    }
  }
  return { modes, pixfmts };
}

/** ffmpeg arguments that make the demuxer print its formats (the run itself fails). */
export function formatListArgs(url) {
  const d = parseDeviceUrl(url);
  if (!d) return null;
  if (d.fmt === 'avfoundation') {
    // an impossible rate prints the modes, an unsupported pixel format the pixel formats
    return [
      ['-hide_banner', '-f', 'avfoundation', '-framerate', '1', '-i', `${d.name}:none`],
      ['-hide_banner', '-f', 'avfoundation', '-pixel_format', 'gray', '-framerate', '30', '-i', `${d.name}:none`, '-frames:v', '1', '-f', 'null', '-'],
    ];
  }
  if (d.fmt === 'dshow') return [['-hide_banner', '-f', 'dshow', '-list_options', 'true', '-i', `video=${d.name}`]];
  return [['-hide_banner', '-f', 'v4l2', '-list_formats', 'all', '-i', d.name]];
}

const SIZE = /^\d{2,5}x\d{2,5}$/;
const RATE = /^\d{1,3}(\.\d{1,3})?$|^\d{1,6}\/\d{1,6}$/;
const PIXFMT = /^[a-z0-9_]{2,20}$/;
export const DECODE_MATRICES = ['bt709', 'bt601', 'bt2020', 'smpte240m'];

/**
 * Validated device/decoding options from the WebSocket query. Unknown or malformed
 * values are dropped – they end up as single argv elements anyway, never in a shell.
 */
export function deviceOptions(params) {
  const get = (k) => (typeof params?.get === 'function' ? params.get(k) : params?.[k]) ?? '';
  const o = {};
  const size = get('size'), rate = get('rate'), pixfmt = get('pixfmt'), matrix = get('matrix'), range = get('range');
  if (SIZE.test(size)) o.size = size;
  if (RATE.test(rate)) o.rate = rate;
  if (PIXFMT.test(pixfmt)) o.pixfmt = pixfmt;
  if (DECODE_MATRICES.includes(matrix)) o.matrix = matrix;
  if (range === 'tv' || range === 'pc') o.range = range;
  return o;
}

/**
 * ffmpeg input arguments for a device. `opts.size`/`opts.pixfmt` select the mode
 * explicitly (avfoundation otherwise picks an arbitrary one – on a FaceTime camera
 * 1552×1552), `rate` is the device's own capture rate.
 */
export function deviceInputArgs(url, rate = '30', opts = {}) {
  const d = parseDeviceUrl(url);
  if (!d) return null;
  const r = ['-framerate', String(opts.rate ?? rate)];
  const size = opts.size ? ['-video_size', opts.size] : [];
  if (d.fmt === 'avfoundation') {
    return ['-f', 'avfoundation', ...r, ...size, '-pixel_format', opts.pixfmt ?? 'uyvy422', '-i', `${d.name}:none`];
  }
  if (d.fmt === 'dshow') {
    const pix = !opts.pixfmt ? [] : /^(mjpeg|h264|hevc)$/.test(opts.pixfmt) ? ['-vcodec', opts.pixfmt] : ['-pixel_format', opts.pixfmt];
    return ['-f', 'dshow', ...r, ...size, ...pix, '-rtbufsize', '256M', '-i', `video=${d.name}`];
  }
  return ['-f', 'v4l2', ...r, ...size, ...(opts.pixfmt ? ['-input_format', opts.pixfmt] : []), '-i', d.name];
}

/** Explicit matrix/range from the client win over tags and the size rule (decodeParams). */
export function applyDecodeOverride(decode, opts = {}) {
  return {
    decodeMatrix: opts.matrix ?? decode.decodeMatrix,
    decodeRange: opts.range ? (opts.range === 'pc' ? 'full' : 'limited') : decode.decodeRange,
  };
}
