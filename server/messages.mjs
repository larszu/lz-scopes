// Messages of the bridge that end up in the UI (#94). The bridge speaks English; a message the
// UI may translate carries a stable code plus its parameters next to the English text:
//
//   { type: 'error', message: 'ffmpeg not found', code: 'ffmpeg.missing' }
//   { …, note: '…', noteCode: 'yuv.rgbSource', noteParams: { pixFmt } }   (text fields other than `message`)
//
// The UI looks the code up as `bridge.<code>` (src/i18n/bridgeMessage.ts) and falls back to the
// English text for unknown codes, older bridges and texts that come from ffmpeg itself.
// Scripts and Companion simply read `message`. A parameter may itself be a message
// ({ code, params, message }), e.g. the reason inside "own RTP reception not possible (…)".

/** An Error with a code for the UI. */
export class BridgeError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [params] */
  constructor(code, message, params) {
    super(message);
    this.code = code;
    if (params) this.params = params;
  }
}

/** Our codes are `area.name` in lower camel case; Node's own codes (ENOENT, ERR_…) are not. */
const isCode = (c) => typeof c === 'string' && /^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$/.test(c);

/** A message object: { code, message, params? }. */
export const bmsg = (code, message, params) => ({ code, message, ...(params ? { params } : {}) });

/**
 * Normalise anything thrown or returned into { message, code?, params? }: a string (English
 * text without code, e.g. an ffmpeg line), an Error (code when it is a BridgeError) or a
 * message object.
 */
export function toMsg(e) {
  if (e == null) return { message: '' };
  if (typeof e === 'string') return { message: e };
  const message = String(e.message ?? e);
  return {
    message,
    ...(isCode(e.code) ? { code: e.code } : {}),
    ...(e.params ? { params: e.params } : {}),
  };
}

/** Fields for a text field other than `message`: { note, noteCode?, noteParams? }. */
export function field(name, m) {
  const x = toMsg(m);
  return { [name]: x.message, ...(x.code ? { [`${name}Code`]: x.code } : {}), ...(x.params ? { [`${name}Params`]: x.params } : {}) };
}
