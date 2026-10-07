// Official download pages for manufacturer look LUTs. None of them is bundled: the terms either
// forbid redistribution (Canon, Panasonic, ARRI, Blackmagic) or could not be read (Sony, RED).
// Only pages that were actually opened on 29.09.2026 are listed; see docs/research/lut-cst.md.

import { t } from './i18n';

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
