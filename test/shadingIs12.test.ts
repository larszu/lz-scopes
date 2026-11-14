// Touch Shading over NMOS IS-12 (#222): a fake device that answers like lz-camera-bridge's
// IS-12 model (block cam3 with paint, exposure, tally) behind a fake IS-04 Node API.
import { describe, expect, it } from 'vitest';
import { Is12Link, is12Sets, busToBipolar, bipolarToBus, type Is12Deps } from '../src/shading/is12';
import { AutoLink, isNmosAddress } from '../src/shading/link';
import { busCommands } from '../src/shading/model';

const MEMBERS = [
  { role: 'DeviceManager', oid: 2, classId: [1, 3, 1], userLabel: null, owner: 1 },
  { role: 'cam3', oid: 10, classId: [1, 1], userLabel: 'Bühne links', owner: 1 },
  { role: 'paint', oid: 11, classId: [1, 2, 0, 1], userLabel: null, owner: 10 },
  { role: 'exposure', oid: 12, classId: [1, 2, 0, 2], userLabel: null, owner: 10 },
  { role: 'tally', oid: 15, classId: [1, 2, 0, 5], userLabel: null, owner: 10 },
];

function fakeDevice() {
  const values: Record<string, unknown> = { '11.4': 10, '11.6': 0, '11.7': 0, '11.8': 0, '12.1': 50, '15.1': true, '15.2': false };
  const sets: { oid: number; index: number; value: unknown }[] = [];
  let sock: any;
  const deps: Is12Deps = {
    fetch: async (url) => ({ ok: url.endsWith('/x-nmos/node/v1.3/devices'), json: async () => [{ controls: [{ type: 'urn:x-nmos:control:ncp/v1.0', href: 'ws://dev/x-nmos/ncp/v1.0' }] }] }),
    socket: () => {
      sock = {
        readyState: 0, onopen: null, onclose: null, onerror: null, onmessage: null,
        close() {},
        send(raw: string) {
          const m = JSON.parse(raw);
          if (m.messageType !== 0) return;
          const responses = m.commands.map((c: any) => {
            const key = `${c.oid}.${c.arguments?.id?.index}`;
            if (c.oid === 1 && c.methodId.level === 2) return { handle: c.handle, result: { status: 200, value: MEMBERS } };
            if (c.methodId.index === 1) return { handle: c.handle, result: key in values ? { status: 200, value: values[key] } : { status: 200, value: null } };
            if (c.methodId.index === 2) { sets.push({ oid: c.oid, index: c.arguments.id.index, value: c.arguments.value }); values[key] = c.arguments.value; return { handle: c.handle, result: { status: 200 } }; }
            return { handle: c.handle, result: { status: 501, errorMessage: 'no' } };
          });
          queueMicrotask(() => sock.onmessage({ data: JSON.stringify({ messageType: 1, responses }) }));
        },
      };
      queueMicrotask(() => { sock.readyState = 1; sock.onopen({}); });
      return sock;
    },
  };
  return { deps, sets, push: (m: unknown) => sock.onmessage({ data: JSON.stringify(m) }) };
}

const settle = () => new Promise((r) => setTimeout(r, 10));

describe('Touch Shading over IS-12', () => {
  it('maps the bus commands to IS-12 Sets', () => {
    expect(is12Sets('setMasterBlack', { value: 128 })).toEqual([{ kind: 'paint', index: 4, value: 0 }]);
    expect(is12Sets('setWhiteBalance', { r: 255, b: 1 })).toEqual([{ kind: 'paint', index: 6, value: 100 }, { kind: 'paint', index: 8, value: -100 }]);
    expect(is12Sets('setIris', { value: 255 })).toEqual([{ kind: 'exposure', index: 1, value: 100 }]);
    expect(is12Sets('recallPreset', { value: 1 })).toBeNull();
    for (let b = 1; b <= 255; b++) expect(bipolarToBus(busToBipolar(b))).toBe(b);
  });

  it('finds the camera, reads its values on the bus scale and shades it', async () => {
    const d = fakeDevice();
    const link = new Is12Link(() => 'http://bridge:8640/', () => {}, d.deps);
    await link.connect();
    await settle(); await settle();
    expect(link.status).toBe('open');
    expect(link.cameras).toEqual([{ cameraNumber: 3, label: 'Bühne links', mode: 'is12', connected: true }]);
    expect(link.states.get(3)?.paint.masterBlack).toBe(bipolarToBus(10));
    expect(link.data.get(3)).toMatchObject({ iris: 127, tally: 'program' }) // 50 % of 0..255, rounded;

    // what the shading bar sends for a white gain change goes out as Sets on the paint object
    const { commands } = busCommands(['whiteR'], { whiteR: 140, whiteG: 128, whiteB: 128 }, 'is12');
    for (const c of commands) expect(link.send(3, c.cmd, c.params)).toBe(true);
    await settle();
    expect(d.sets.filter((s) => s.oid === 11).map((s) => s.index)).toEqual([6, 7, 8]);
    expect(d.sets.find((s) => s.index === 6)?.value).toBe(busToBipolar(140));
    expect(link.states.get(3)?.origins.whiteR).toBe('commanded');

    // a change at the camera arrives as PropertyChanged
    d.push({ messageType: 2, notifications: [{ oid: 11, eventId: { level: 1, index: 1 }, eventData: { propertyId: { level: 3, index: 9 }, changeType: 0, value: -20, sequenceItemIndex: null } }] });
    expect(link.states.get(3)?.paint.saturation).toBe(bipolarToBus(-20));
    expect(link.states.get(3)?.origins.saturation).toBe('confirmed');
    expect(link.send(9, 'setMasterBlack', { value: 128 })).toBe(false);
  });

  it('picks the protocol from the address', () => {
    expect(isNmosAddress('http://bridge:8640')).toBe(true);
    expect(isNmosAddress('ws://localhost:9700')).toBe(false);
    let url = 'ws://localhost:9700';
    const link = new AutoLink(() => url, () => {});
    expect(link.kind).toBe('bridge');
    url = 'http://127.0.0.1:1';
    link.connect();
    expect(link.kind).toBe('nmos');
    link.disconnect();
  });
});
