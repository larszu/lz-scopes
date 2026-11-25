// Interlaced sources (#219): field order and optional de-interlacing per source.
//
// An interlaced frame carries two fields woven line by line, taken 1/(2·fps) apart. Without
// de-interlacing (the default) the bridge keeps them woven and scales each field on its own
// (swscale `interl=1`), so no line of one field is mixed into the other and every scope value
// still belongs to one field (docs/research/frame-integrity.md). With de-interlacing on, ffmpeg's
// bwdif makes one progressive picture per frame: the lines of the second field are interpolated
// from the first field and its neighbours in time (w3fdif/yadif family), so values in moving areas
// are no longer signal values. Static areas keep their lines.
//
// Field order = which field comes first in time. Sources:
// - ffprobe `field_order` (libavutil AVFieldOrder): tt = top coded and displayed first, bb =
//   bottom first, tb = top coded first, bottom displayed first, bt = the reverse. What counts for
//   the time order is the display order: tt/bt → upper first, bb/tb → lower first (same mapping
//   as the QuickTime 'fiel' atom: 9 = bottom displayed earliest with top stored first, 14 = top
//   displayed earliest).
// - DeckLink helper: `fieldOrder` from IDeckLinkDisplayMode::GetFieldDominance
//   (bmdUpperFieldFirst / bmdLowerFieldFirst, DeckLink SDK manual, "BMDFieldDominance").
// - other helpers without `fieldOrder`: 525-line SD (480/486 active lines) lower field first, all
//   else upper field first – the usual digital capture of SMPTE ST 125 / ITU-R BT.656 525-line
//   video (DV NTSC, DeckLink NTSC modes report bmdLowerFieldFirst), 625-line and 1080i (SMPTE
//   ST 274, field 1 carries the first active line) upper field first. A guess; the source card
//   lets the user set it.

/** Choices of the source card (param `field`): auto = as reported, else forced. */
export const FIELD_CHOICES = ['auto', 'progressive', 'tff', 'bff'];

/** `field` and `deint` query parameters of a bridge stream. */
export function interlaceOptions(params) {
  const get = (k) => (typeof params?.get === 'function' ? params.get(k) : params?.[k]) ?? '';
  const field = get('field');
  return { field: FIELD_CHOICES.includes(field) ? field : 'auto', deint: get('deint') === '1' };
}

/** ffprobe field_order → 'tff' | 'bff', null for progressive or unknown. */
export function probeFieldOrder(fieldOrder) {
  const f = String(fieldOrder ?? '');
  if (f === 'tt' || f === 'bt') return 'tff';
  if (f === 'bb' || f === 'tb') return 'bff';
  return null;
}

/** Field order of an interlaced helper signal without its own `fieldOrder`. */
export const defaultFieldOrder = (height) => (Number(height) === 480 || Number(height) === 486 ? 'bff' : 'tff');

/**
 * What the bridge does with the fields of one source.
 * `detected`: 'tff' | 'bff' for an interlaced signal as the source reports it, null when it
 * reports progressive (or nothing). `opts`: interlaceOptions().
 * Returns `interlaced` (treated as interlaced), `fields` ('tff' | 'bff' | null), `forced` (the
 * card overrides what the source reports), `deinterlace` and the ffmpeg `filter` to put before
 * the scaler ('' when none). `interl` = scale field by field (woven fields only).
 */
export function interlacePlan(detected, opts = { field: 'auto', deint: false }) {
  const field = opts.field ?? 'auto';
  const fields = field === 'tff' || field === 'bff' ? field : field === 'progressive' ? null : (detected ?? null);
  const forced = field !== 'auto' && fields !== (detected ?? null);
  const interlaced = !!fields;
  const deinterlace = interlaced && !!opts.deint;
  // mode=send_frame: one picture per frame, the frame rate stays; deint=all: also frames the
  // decoder does not flag (raw helper input carries no flags), parity explicit for the same reason
  const filter = deinterlace ? `bwdif=mode=send_frame:parity=${fields}:deint=all` : '';
  return { interlaced, fields, detected: detected ?? null, forced, deinterlace, filter, interl: interlaced && !deinterlace };
}

/** Fields for the info message: what the client shows on the card and in the readouts. */
export function interlaceInfo(plan) {
  return {
    ...(plan.interlaced ? { interlaced: true, fields: plan.fields } : {}),
    ...(plan.deinterlace ? { deinterlaced: true } : {}),
    // what the source itself reports, so the card can show it next to "auto"
    ...(plan.detected ? { sourceFields: plan.detected } : {}),
    ...(plan.forced ? { fieldsForced: true } : {}),
  };
}
