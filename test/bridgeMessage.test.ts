// Bridge messages (#94): English text + code from the bridge, translation in the UI.
import { afterEach, describe, expect, it } from 'vitest';
import { BridgeError, bmsg, field, toMsg } from '../server/messages.mjs';
import { errorText } from '../server/ptp.mjs';
import { setLang } from '../src/i18n';
import { bridgeMessage, bridgeText, ptpLockText } from '../src/i18n/bridgeMessage';
import en from '../src/i18n/en/bridge';

afterEach(() => setLang('en'));

describe('server/messages.mjs', () => {
  it('normalises strings, errors and message objects', () => {
    expect(toMsg('Connection refused')).toEqual({ message: 'Connection refused' });
    expect(toMsg(new BridgeError('ffmpeg.missing', 'ffmpeg not found'))).toEqual({ message: 'ffmpeg not found', code: 'ffmpeg.missing' });
    expect(toMsg(bmsg('ffmpeg.exit', 'ffmpeg exited (1)', { code: 1 }))).toEqual({ message: 'ffmpeg exited (1)', code: 'ffmpeg.exit', params: { code: 1 } });
    // Node's own error codes are not message codes
    expect(toMsg(Object.assign(new Error('spawn x ENOENT'), { code: 'ENOENT' }))).toEqual({ message: 'spawn x ENOENT' });
    expect(field('note', bmsg('yuv.rgbSource', 'Source is R′G′B′ (gbrp)', { pixFmt: 'gbrp' }))).toEqual({ note: 'Source is R′G′B′ (gbrp)', noteCode: 'yuv.rgbSource', noteParams: { pixFmt: 'gbrp' } });
  });
  it('every code the bridge sends has an English text', async () => {
    // @ts-expect-error plain JS module
    const { validateInput } = await import('../server/index.mjs');
    const codes = [validateInput(''), validateInput('-x'), validateInput('file:///etc/passwd'), errorText({ code: 'EACCES' }, 319)].map((m) => (m as { code: string }).code);
    for (const c of codes) expect(en).toHaveProperty(`bridge.${c}`);
  });
  it('helper STAT/ERR: JSON with code or plain text', async () => {
    // @ts-expect-error plain JS module
    const { helperText } = await import('../server/helper-input.mjs');
    expect(helperText(Buffer.from('{"code":"ndi.lost","message":"Connection to the NDI source lost"}'))).toEqual({ code: 'ndi.lost', message: 'Connection to the NDI source lost' });
    expect(helperText(Buffer.from('NDI source "x" not found'))).toEqual({ message: 'NDI source "x" not found' });
  });
});

describe('src/i18n/bridgeMessage.ts', () => {
  it('translates known codes, keeps unknown ones and ffmpeg lines as sent', () => {
    setLang('de');
    expect(bridgeMessage({ code: 'ffmpeg.missing', message: 'ffmpeg not found' })).toBe('ffmpeg nicht gefunden');
    expect(bridgeMessage({ code: 'ffmpeg.exit', params: { code: 1 }, message: 'ffmpeg exited (1)' })).toBe('ffmpeg beendet (1)');
    expect(bridgeMessage({ code: 'some.future', message: 'Something new' })).toBe('Something new');
    expect(bridgeMessage({ message: '[rtsp @ 0x1] method DESCRIBE failed: 404 Not Found' })).toBe('[rtsp @ 0x1] method DESCRIBE failed: 404 Not Found');
    expect(bridgeMessage(undefined, 'error')).toBe('error');
    setLang('en');
    expect(bridgeMessage({ code: 'ffmpeg.missing', message: 'ffmpeg not found' })).toBe('ffmpeg not found');
  });
  it('nested reason and other text fields', () => {
    setLang('de');
    const note = { own: false, note: 'Own RTP reception not possible (No free UDP ports) – ffmpeg receives', noteCode: 'rtp.ownFailed', noteParams: { reason: { code: 'rtsp.noPorts', message: 'No free UDP ports' } } };
    expect(bridgeText(note, 'note')).toBe('RTP-Eigenempfang nicht möglich (Keine freien UDP-Ports) – ffmpeg empfängt');
    expect(bridgeText({ error: '' }, 'error', '–')).toBe('–');
    expect(ptpLockText(4, 'locked')).toBe('extern gebunden');
    expect(ptpLockText(9, '9')).toBe('9');
  });
});
