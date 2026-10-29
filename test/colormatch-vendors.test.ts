import { describe, expect, it } from 'vitest';
import { PANA_CMDS, PanasonicCamera, SonyCgiCamera, ViscaIpCamera, panaCommand, panaParse, sonyParse, viscaGainCommand, viscaGainParse, viscaPacket } from '../src/colormatch/adapters';
import { runMatch } from '../src/colormatch/engine';
import { CHARTS } from '../src/colormatch/charts';
import { SimCamera, render, sceneOf, virtualClock } from '../src/colormatch/sim';
import type { Space } from '../src/deltae';

// Simulated camera answers for the documented commands (sources in src/colormatch/adapters.ts).
const cmd = (id: string) => PANA_CMDS.find((c) => c.id === id)!;
const SP: Space = { transfer: 'sdr', gamut: '709', hlgLw: 1000 };

/** Panasonic aw_cam over a fake fetch: keeps registers, echoes like the camera (spec p. 7). */
function panaFetch(reg: Record<string, string>, log: string[]) {
  return (async (url: string) => {
    const c = decodeURIComponent(new URL(url).searchParams.get('cmd')!);
    log.push(c);
    let body: string;
    if (c.startsWith('Q')) {
      const key = 'O' + c.slice(1);
      body = key in reg ? `${key}:${reg[key]}` : 'ER1:' + c;
    } else {
      const i = c.lastIndexOf(':');
      reg[c.slice(0, i)] = c.slice(i + 1);
      body = c;
    }
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
}

describe('Panasonic AW-CGI', () => {
  it('encodes the documented data ranges', () => {
    expect(panaCommand(cmd('pana.rgain'), -200)).toBe('OSG:39:738');
    expect(panaCommand(cmd('pana.rgain'), 200)).toBe('OSG:39:8C8');
    expect(panaCommand(cmd('pana.rped'), 0)).toBe('ORP:096');
    expect(panaCommand(cmd('pana.bped'), 100)).toBe('OBP:0FA');
    expect(panaCommand(cmd('pana.mped'), -200)).toBe('OSJ:0F:738');
    expect(panaCommand(cmd('pana.gamma'), -25)).toBe('OSA:6A:67'); // 0.30
    expect(panaCommand(cmd('pana.gamma'), 20)).toBe('OSA:6A:94'); // 0.75
    expect(panaCommand(cmd('pana.matrix.B-G'), -63)).toBe('OSD:A9:41');
    expect(panaCommand(cmd('pana.cc.B_Mg.sat'), 0)).toBe('OSD:80:80');
    expect(panaCommand(cmd('pana.cc.B.phase'), 63)).toBe('OSD:9F:BF');
    expect(PANA_CMDS.filter((c) => c.stage === 'multiaxis')).toHaveLength(32);
  });

  it('parses replies and rejects errors', () => {
    expect(panaParse(cmd('pana.rgain'), 'OSG:39:80A')).toBe(10);
    expect(panaParse(cmd('pana.rped'), 'ORP:032')).toBe(-100);
    expect(panaParse(cmd('pana.rgain'), 'ER3:OSG:39')).toBeNull();
  });

  it('reads only what the camera answers, sets Matrix Type USER before the matrix', async () => {
    const log: string[] = [];
    const reg: Record<string, string> = { 'OSG:39': '800', 'OSG:3A': '800', ORP: '096', OBP: '096', 'OSD:A4': '80' };
    const cam = new PanasonicCamera('http://cam.invalid', panaFetch(reg, log));
    const v = await cam.read();
    expect(Object.keys(v).sort()).toEqual(['pana.bgain', 'pana.bped', 'pana.matrix.R-G', 'pana.rgain', 'pana.rped']);
    expect(cam.params).toHaveLength(5);
    log.length = 0;
    await cam.write({ 'pana.rgain': 12, 'pana.matrix.R-G': -5 });
    expect(log).toEqual(['OSG:39:80C', 'OSE:31:3', 'OSD:A4:7B']);
    await cam.write({ 'pana.matrix.R-G': 1 });
    expect(log.filter((c) => c === 'OSE:31:3')).toHaveLength(1);
  });

  it('closes the loop through the CGI commands', async () => {
    // the fake camera's registers drive a simulated picture: aw_cam value → model value
    const reg: Record<string, string> = {}, log: string[] = [];
    for (const c of PANA_CMDS.filter((x) => x.stage !== 'multiaxis')) reg[c.set.slice(0, -1)] = c.zero.toString(16).toUpperCase().padStart(c.digits, '0');
    const clock = virtualClock(), scene = sceneOf(CHARTS.classic24);
    const model = new SimCamera(scene, { whiteR: 12, whiteB: -9, blackR: 5, pedestal: 3, gamma: 12, 'matrix.rg': 15 }, clock, 0);
    const cam = new PanasonicCamera('http://cam.invalid', panaFetch(reg, log));
    const val = (k: string) => parseInt(reg[k], 16);
    const measure = async () => {
      await model.write({
        whiteR: (val('OSG:39') - 0x800) / 4, whiteB: (val('OSG:3A') - 0x800) / 4,
        blackR: (val('ORP') - 0x96) / 2, blackB: (val('OBP') - 0x96) / 2, pedestal: (val('OSJ:0F') - 0x800) / 4,
        gamma: -(val('OSA:6A') - 0x80) * 2, 'matrix.rg': (val('OSD:A4') - 0x80) / 2,
      });
      return model.patches();
    };
    const r = await runMatch({ camera: cam, measure, target: render(scene, {}), space: SP, chart: CHARTS.classic24, clock, latencyMs: 0 });
    expect(r.startDe).toBeGreaterThan(2);
    // the camera's integer steps are coarser than the model: less precise than the simulator test
    expect(r.endDe).toBeLessThan(r.startDe * 0.6);
    expect(log).toContain('OSE:31:3');
  });
});

describe('Sony CGI', () => {
  it('parses the standard inquiry format', () => {
    expect(sonyParse('WhiteBalanceMode=auto&WhiteBalanceCrGain=128')).toEqual({ WhiteBalanceMode: 'auto', WhiteBalanceCrGain: '128' });
  });

  it('switches to manual once and sets R/B gain through imaging.cgi', async () => {
    const urls: string[] = [];
    const f = (async (url: string) => {
      urls.push(url);
      if (url.includes('inquiry.cgi')) return new Response('WhiteBalanceMode=auto&WhiteBalanceCrGain=128&WhiteBalanceCbGain=120');
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const cam = new SonyCgiCamera('http://cam.invalid/', f);
    expect(await cam.read()).toEqual({ WhiteBalanceCrGain: 128, WhiteBalanceCbGain: 120 });
    await cam.write({ WhiteBalanceCrGain: 140 });
    await cam.write({ WhiteBalanceCbGain: 110.4 });
    expect(urls.slice(1)).toEqual([
      'http://cam.invalid/command/imaging.cgi?WhiteBalanceMode=manual&WhiteBalanceCrGain=140',
      'http://cam.invalid/command/imaging.cgi?WhiteBalanceCbGain=110',
    ]);
  });

  it('reports HTTP errors (e.g. missing Digest credentials)', async () => {
    const cam = new SonyCgiCamera('http://cam.invalid', (async () => new Response('', { status: 401 })) as unknown as typeof fetch);
    await expect(cam.read()).rejects.toThrow('401');
  });
});

describe('Sony VISCA over IP', () => {
  const reply = (payload: number[]) => { const p = viscaPacket('command', 0, payload); p[1] = 0x11; return p; };

  it('builds the documented header and direct command', () => {
    const p = viscaPacket('command', 0x01020304, viscaGainCommand('visca.rgain', 10));
    expect(Array.from(p)).toEqual([0x01, 0x00, 0x00, 0x09, 0x01, 0x02, 0x03, 0x04, 0x81, 0x01, 0x04, 0x43, 0x00, 0x00, 0x08, 0x0a, 0xff]);
    expect(viscaPacket('inquiry', 1, [0x81, 0x09, 0x04, 0x44, 0xff])[1]).toBe(0x10);
    expect(viscaGainCommand('visca.bgain', -128).slice(6, 8)).toEqual([0, 0]);
  });

  it('reads and writes over a simulated UDP transport', async () => {
    const gains: Record<number, number> = { 0x43: 0x80, 0x44: 0x70 }, sent: Uint8Array[] = [];
    const cam = new ViscaIpCamera({
      async send(pk) {
        sent.push(pk);
        const p = pk.subarray(8);
        if (pk[1] === 0x10 && p[3] === 0x35) return reply([0x90, 0x50, 0x00, 0xff]); // WB mode auto
        if (pk[1] === 0x10) { const g = gains[p[3]]; return reply([0x90, 0x50, 0, 0, g >> 4, g & 15, 0xff]); }
        gains[p[3]] = (p[6] << 4) | p[7];
        return reply([0x90, 0x51, 0xff]);
      },
    });
    expect(await cam.read()).toEqual({ 'visca.rgain': 0, 'visca.bgain': -16 });
    await cam.write({ 'visca.rgain': 7 });
    expect(gains[0x43]).toBe(0x87);
    expect(sent.map((p) => p[7])).toEqual([1, 2, 3, 4, 5]); // sequence numbers count up
    expect(Array.from(sent[3].subarray(8))).toEqual([0x81, 0x01, 0x04, 0x35, 0x05, 0xff]); // manual WB before the first gain (p. 15)
    expect(viscaGainParse(reply([0x90, 0x60, 0x02, 0xff]))).toBeNull();
  });

  it('throws on a VISCA error reply', async () => {
    const cam = new ViscaIpCamera({ async send() { return reply([0x90, 0x60, 0x02, 0xff]); } });
    await expect(cam.write({ 'visca.bgain': 1 })).rejects.toThrow('VISCA error');
  });
});
