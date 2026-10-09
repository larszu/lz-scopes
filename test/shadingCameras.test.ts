import { describe, expect, it } from 'vitest';
import { MODES, MODE_IDS, cameraConfigMessage, formOf, freeNumber, shadingCaps } from '../src/shading/cameras';
import { CameraBridgeLink } from '../src/shading/bridge';
import en from '../src/i18n/en/shading';
import de from '../src/i18n/de/shading';

describe('camera setup for the camera bridge', () => {
  it('HTTP CGI (Sony SRG): only the fields of the mode, numbers as numbers, no empty fields', () => {
    const r = cameraConfigMessage({ cameraNumber: 2, label: ' SRG-A40 ', mode: 'http-cgi', camHost: '192.168.0.80', camPort: '80', cgiFamily: 'sony', camUser: 'admin', camPass: '', tcpHost: 'ignored' });
    expect(r).toEqual({ message: { type: 'setCameraConfig', cameraNumber: 2, config: { connectionMode: 'http-cgi', label: 'SRG-A40', camHost: '192.168.0.80', camPort: 80, cgiFamily: 'sony', camUser: 'admin' } } });
  });
  it('missing address and bad numbers are reported, nothing is sent', () => {
    expect(cameraConfigMessage({ cameraNumber: 1, label: '', mode: 'visca', camHost: ' ' })).toEqual({ missing: ['camHost'] });
    expect(cameraConfigMessage({ cameraNumber: 1, label: '', mode: 'visca', camHost: '10.0.0.5', camPort: 'abc' })).toEqual({ missing: ['camPort'] });
    expect(cameraConfigMessage({ cameraNumber: 0, label: '', mode: 'demo' })).toEqual({ missing: [] });
    expect(cameraConfigMessage({ cameraNumber: 3, label: '', mode: 'demo' })).toEqual({ message: { type: 'setCameraConfig', cameraNumber: 3, config: { connectionMode: 'demo' } } });
  });
  it('editing an existing camera: values back into the form, the password never', () => {
    expect(formOf(4, { connectionMode: 'jvc', camHost: '10.0.0.9', camPort: 80, camUser: 'jvc', camPass: 'secret', label: 'Bühne' }))
      .toEqual({ cameraNumber: 4, label: 'Bühne', mode: 'jvc', camHost: '10.0.0.9', camPort: '80', camUser: 'jvc' });
  });
  it('next free number and Touch Shading capabilities per mode', () => {
    expect(freeNumber([1, 2, 4])).toBe(3);
    expect(shadingCaps('http-cgi', 'sony')).toEqual(['whiteBalance']);
    expect(shadingCaps('visca')).toEqual([]);
    expect(shadingCaps('demo').length).toBeGreaterThan(0);
  });
  it('every mode and field has a label in both languages', () => {
    for (const dict of [en, de] as Record<string, unknown>[]) {
      for (const m of MODE_IDS) {
        expect(dict[`shading.cam.mode.${m}`], m).toBeTruthy();
        for (const f of MODES[m].fields) expect(dict[`shading.cam.field.${f}`], f).toBeTruthy();
      }
    }
  });
  it('the link keeps the full configs and the errors per camera', () => {
    const link = new CameraBridgeLink(() => 'ws://x', () => {});
    link.receive({ type: 'cameras', cameras: [{ cameraNumber: 2, connected: false, config: { connectionMode: 'visca', camHost: '10.0.0.5', label: 'PTZ' } }] });
    expect(link.cameras).toEqual([{ cameraNumber: 2, label: 'PTZ', mode: 'visca', connected: false }]);
    expect(link.configs.get(2)).toMatchObject({ camHost: '10.0.0.5' });
    link.receive({ type: 'error', message: 'Keine Kamera-IP konfiguriert', cameraNumber: 2 });
    expect(link.cameraErrors.get(2)).toBe('Keine Kamera-IP konfiguriert');
    link.receive({ type: 'cameras', cameras: [{ cameraNumber: 2, connected: true, config: { connectionMode: 'visca' } }] });
    expect(link.cameraErrors.has(2)).toBe(false);
  });
});
