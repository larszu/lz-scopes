// Official download pages for manufacturer look LUTs. None of them is bundled: the terms either
// forbid redistribution (Canon, Panasonic, ARRI, Blackmagic) or could not be read (Sony, RED).
// Only pages that were actually opened on 29.09.2026 are listed; see docs/research/lut-cst.md.

export interface LutSource { vendor: string; looks: string; url?: string; note: string }

export const LUT_SOURCES: LutSource[] = [
  { vendor: 'Sony', looks: 's709, kreative Looks (S-Log3/S-Gamut3.Cine)', url: 'https://sony-cinematography.com/resources/luts/', note: 'LC-709/Cine+709 dort nicht; Sony-Profiseiten waren nicht abrufbar' },
  { vendor: 'Panasonic', looks: 'V-Log → V-709 (Lumix)', url: 'https://av.jpn.support.panasonic.com/support/global/cs/dsc/download/lut/index.html', note: 'Weitergabe ohne Genehmigung untersagt (Nutzungsbedingungen)' },
  { vendor: 'Panasonic', looks: 'VariCam-LUT-Bibliothek', url: 'https://pro-av.panasonic.net/en/cinema_camera_varicam_eva/support/lut/', note: '' },
  { vendor: 'Canon', looks: 'Canon Log 2/3 → Canon 709', url: 'https://hk.canon/en/support/0200747702', note: 'Weitergabe ausdrücklich untersagt; „BT.709 Wide DR“-Seite nicht abrufbar' },
  { vendor: 'ARRI', looks: 'LogC4/LogC3 → Rec.709 (LUT-Generator)', url: 'https://www.arri.com/en/learn-help/learn-help-camera-system/tools/lut-generator', note: 'Weitergabe nur mit Zustimmung (arri.com/en/legal)' },
  { vendor: 'ARRI', looks: 'Look Library', url: 'https://www.arri.com/en/learn-help/learn-help-camera-system/image-science/look-files/look-library-faq', note: '' },
  { vendor: 'RED', looks: 'IPP2 Output Presets (709/2020)', url: 'https://www.reddigitalcinema.com/download/ipp2-output-presets', note: 'Bedingungen hinter einer Zustimmungs-Checkbox, Text nicht einsehbar' },
  { vendor: 'Blackmagic', looks: 'Gen 5 Film to Video / Extended Video', note: 'nur mit DaVinci Resolve (Ordner LUT/Blackmagic Design), keine eigene Download-Seite' },
];
