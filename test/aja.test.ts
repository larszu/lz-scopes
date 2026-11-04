// AJA cards through the native helper (helpers/aja, libajantv2): bridge routing, setup steps,
// query parameters and the helper's counter records. The helper itself is run when it is built.
import { existsSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { applyDecodeOverride, deviceOptions } from '../server/devices.mjs';
// @ts-expect-error plain JS module
import { startHelperStream } from '../server/helper-input.mjs';
// @ts-expect-error plain JS module
import { decodeParams, outputSize, validateInput } from '../server/index.mjs';
// @ts-expect-error plain JS module
import { recordMode } from '../server/record.mjs';
import { ajaInputName, ajaSteps, type AjaStatus } from '../src/ajaSetup';
import { stepStates } from '../src/decklinkSetup';
import { bridgeInputParams } from '../src/sources';

describe('AJA', () => {
  it('accepts aja:<n> as a bridge source and nothing else under that scheme', () => {
    expect(validateInput('aja:0')).toBeNull();
    expect(validateInput('aja:12')).toBeNull();
    expect(validateInput('aja:x')).not.toBeNull();
    expect(validateInput('aja:0 --list')).not.toBeNull();
  });

  it('passes 8 bit and the input connector to the bridge', () => {
    expect(bridgeInputParams('aja:0', { ajaBits: 8, ajaInput: 'sdi2' } as never)).toEqual({ pixel: '8', input: 'sdi2' });
    expect(bridgeInputParams('aja:0', { ajaBits: 10 } as never)).toEqual({});
    // DeckLink settings do not leak into AJA sources and back
    expect(bridgeInputParams('aja:0', { deckLinkBits: 8, deckLinkInput: 'hdmi' } as never)).toEqual({});
    expect(bridgeInputParams('decklink:0', { ajaBits: 8, ajaInput: 'sdi2' } as never)).toEqual({});
  });

  it('names the connectors as on the card', () => {
    expect(ajaInputName('sdi1')).toBe('SDI 1');
    expect(ajaInputName('hdmi2')).toBe('HDMI 2');
    expect(ajaInputName('odd')).toBe('odd');
  });

  const base: AjaStatus = { available: true, helper: true, platform: 'darwin', devices: [] };
  it('ticks off the setup steps the bridge reports', () => {
    expect(stepStates(ajaSteps({ ...base, available: false, helper: false }))).toEqual(['next', 'open', 'open']);
    expect(stepStates(ajaSteps(base))).toEqual(['done', 'next', 'open']);
    const dev = { index: 0, name: 'KONA 5', inputs: ['sdi1', 'sdi2'] };
    expect(stepStates(ajaSteps({ ...base, devices: [{ ...dev, busy: true }] }))).toEqual(['done', 'done', 'next']);
    expect(stepStates(ajaSteps({ ...base, devices: [dev] }))).toEqual(['done', 'done', 'done']);
    expect(ajaSteps({ ...base, platform: 'linux' })[1].title).not.toBe(ajaSteps(base)[1].title);
  });

  it('records AJA sources encoded, like DeckLink', () => {
    expect(recordMode('aja:0')).toBe('encode');
  });

  it("counts the helper's skipped and the card's dropped pictures as dropped", async () => {
    const fake = fileURLToPath(new URL('./fixtures/fake-helper.mjs', import.meta.url));
    const msgs: Record<string, unknown>[] = [];
    await new Promise<void>((done) => {
      const ws = Object.assign(new EventEmitter(), {
        OPEN: 1, readyState: 1, bufferedAmount: 0,
        send(d: Buffer | string) { if (typeof d === 'string') msgs.push(JSON.parse(d)); },
        close() { ws.readyState = 3; ws.emit('close'); done(); },
      });
      startHelperStream(ws, {
        bin: process.execPath, args: [fake, '--aja-stat'], label: 'AJA', params: new URLSearchParams(''),
        ctx: { ffmpeg: 'ffmpeg', fail: () => ws.close(), outputSize, decodeParams, applyDecodeOverride, deviceOptions },
      });
    });
    const stats = msgs.filter((m) => m.type === 'stats');
    expect(stats.length).toBeGreaterThan(0);
    expect(Math.max(...stats.map((m) => Number(m.dropped)))).toBe(5);
    // counters are no status text
    expect(stats.some((m) => /skipped|dropped/.test(String(m.message ?? '')))).toBe(false);
  });

  const bin = fileURLToPath(new URL(`../helpers/bin/lz-aja${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
  it.skipIf(!existsSync(bin))('built helper lists devices (none without a card) and reports the SDK', async () => {
    const out = await new Promise<string>((res) => execFile(bin, ['--list'], (_e, o) => res(String(o))));
    const j = JSON.parse(out);
    expect(j.ok).toBe(true);
    expect(j.sdk).toMatch(/^\d+\.\d+/);
    expect(Array.isArray(j.devices)).toBe(true);
  });
  it.skipIf(!existsSync(bin))('built helper answers a missing device with a coded ERR record', async () => {
    const out = await new Promise<Buffer>((res) => execFile(bin, ['--capture', '63'], { encoding: 'buffer' }, (_e, o) => res(o)));
    expect(out.toString('ascii', 0, 4)).toBe('ERR ');
    const j = JSON.parse(out.subarray(8, 8 + out.readUInt32LE(4)).toString('utf8'));
    expect(['aja.noDevices', 'aja.noDevice']).toContain(j.code);
  });
});
