// Official download pages for manufacturer look LUTs. None of them is bundled: the terms either
// forbid redistribution (Canon, Panasonic, ARRI, Blackmagic) or could not be read (Sony, RED).
// Only pages that were actually opened on 29.09.2026 are listed; see docs/research/lut-cst.md.

import { t } from './i18n';
import { GAMUTS, transferLabel, type GamutId, type Transfer } from './color';
import { addLutText, type Lut } from './lut';

export interface LutSource { vendor: string; looks: string; url?: string; note: string }

export const LUT_SOURCES: LutSource[] = [
  { vendor: 'Sony', looks: t('lut.src.sonyLooks'), url: 'https://sony-cinematography.com/resources/luts/', note: t('lut.src.sonyNote') },
  { vendor: 'Panasonic', looks: 'V-Log → V-709 (Lumix)', url: 'https://av.jpn.support.panasonic.com/support/global/cs/dsc/download/lut/index.html', note: t('lut.src.panaNote') },
  { vendor: 'Panasonic', looks: t('lut.src.varicam'), url: 'https://pro-av.panasonic.net/en/cinema_camera_varicam_eva/support/lut/', note: '' },
  { vendor: 'Canon', looks: 'Canon Log 2/3 → Canon 709', url: 'https://hk.canon/en/support/0200747702', note: t('lut.src.canonNote') },
  { vendor: 'ARRI', looks: t('lut.src.arriLooks'), url: 'https://www.arri.com/en/learn-help/learn-help-camera-system/tools/lut-generator', note: t('lut.src.arriNote') },
  { vendor: 'ARRI', looks: 'Look Library', url: 'https://www.arri.com/en/learn-help/learn-help-camera-system/image-science/look-files/look-library-faq', note: '' },
  { vendor: 'RED', looks: 'IPP2 Output Presets (709/2020)', url: 'https://www.reddigitalcinema.com/download/ipp2-output-presets', note: t('lut.src.redNote') },
  { vendor: 'Blackmagic', looks: 'Gen 5 Film to Video / Extended Video', note: t('lut.src.bmdNote') },
];

// ---------------------------------------------------------------- BBC HDR production LUTs (#210)
// bbc/bbc_hdr_television_production_luts, release v1.8 (09/2026), Apache 2.0 – redistribution is
// allowed. They are still not bundled: each 33³ cube is about 1 MB. The app downloads a file on
// request from a fixed commit. Only the Type I variants (nominal range 0–1 in and out, "intended
// for software applications", BBC Implementation Guidelines) fit the chain of LZ Scopes, which
// feeds the LUT nominal R′G′B′; Type II/III expect the full 10-bit container and would be wrong here.
// See docs/research/lut-cst.md, section "BBC-HDR-LUTs".

export const BBC_LUT_REPO = 'https://github.com/bbc/bbc_hdr_television_production_luts';
export const BBC_LUT_COMMIT = 'dd2744578d64f1a0d0b9f2eb58276ffa10cc4895';
const BBC_DIR = 'LUT_files/CUBE_LUT_files/BBC_LUT_Release_v1-8_Grouped_2026-09-16/Primary_Conversions_Post-Production_Type_I_Nominal_Range';
const BBC_RAW = 'https://raw.githubusercontent.com/bbc/bbc_hdr_television_production_luts';

export interface BbcLut {
  /** BBC LUT number with variant letter */
  id: string;
  file: string;
  label: string;
  /** what the LUT expects and delivers; gamut BT.2020 for BT.2100 signals */
  in: { transfer: Transfer; gamut: GamutId };
  out: { transfer: Transfer; gamut: GamutId };
  /** HLG output: display peak of the 1000 cd/m² reference condition */
  lw?: number;
}

export const BBC_LUTS: BbcLut[] = [
  { id: '1a', file: '1a_PQ1000_HLG_Type1_Transcode_nocomp-v1-8-cicp.cube', label: 'PQ 1000 cd/m² → HLG', in: { transfer: 'pq', gamut: '2020' }, out: { transfer: 'hlg', gamut: '2020' }, lw: 1000 },
  { id: '2a', file: '2a_PQ4000_HLG_Type1_Transcode_nocomp-v1-8-cicp.cube', label: t('lut.bbc.2a'), in: { transfer: 'pq', gamut: '2020' }, out: { transfer: 'hlg', gamut: '2020' }, lw: 1000 },
  { id: '3a', file: '3a_BT709_HLG_Type1_Display_DirectMapping_nocomp-v1-8-cicp.cube', label: t('lut.bbc.3a'), in: { transfer: 'sdr', gamut: '709' }, out: { transfer: 'hlg', gamut: '2020' }, lw: 1000 },
  { id: '5a', file: '5a_BT709_HLG_Type1_Display_UpMapping_nocomp-v1-8-cicp.cube', label: t('lut.bbc.5a'), in: { transfer: 'sdr', gamut: '709' }, out: { transfer: 'hlg', gamut: '2020' }, lw: 1000 },
  { id: '7a', file: '7a_HLG_PQ1000_Type1_Transcode_nocomp-v1-8-cicp.cube', label: 'HLG → PQ 1000 cd/m²', in: { transfer: 'hlg', gamut: '2020' }, out: { transfer: 'pq', gamut: '2020' } },
  { id: '8a', file: '8a_HLG_BT709_Type1_Display_DownMapping_CAM_nocomp-v1-8-cicp.cube', label: t('lut.bbc.8a'), in: { transfer: 'hlg', gamut: '2020' }, out: { transfer: 'sdr', gamut: '709' } },
];

export const bbcLutUrl = (l: BbcLut) => `${BBC_RAW}/${BBC_LUT_COMMIT}/${BBC_DIR}/${l.file}`;
/** Name under which the LUT is kept in the library: the BBC file name, so it stays recognisable. */
export const bbcLutName = (l: BbcLut) => `BBC ${l.file}`;

/** Download a BBC LUT, parse it and keep it in the library (IndexedDB) like a loaded file. */
export async function loadBbcLut(l: BbcLut, get: typeof fetch = fetch): Promise<Lut> {
  const r = await get(bbcLutUrl(l));
  if (!r.ok) throw new Error(t('lut.bbc.http', { status: String(r.status) }));
  return addLutText(bbcLutName(l), await r.text());
}

/** Whether the LUT input matches what reaches the LUT slot; null = fits. */
export function bbcLutMismatch(l: BbcLut, at: { transfer: Transfer; gamut: GamutId }): string | null {
  if (at.transfer === l.in.transfer && at.gamut === l.in.gamut) return null;
  return t('lut.bbc.mismatch', { want: `${transferLabel(l.in.transfer)} ${GAMUTS[l.in.gamut].name}`, have: `${transferLabel(at.transfer)} ${GAMUTS[at.gamut].name}` });
}
