// NMOS node (IS-04 v1.3 Node API, IS-05 v1.1 Connection API) and the ST 2110 HTTP API (#240, #237).
// Runs against a local HTTP server and a fake registry; not run against AMWA nmos-testing.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module
import { NmosNode, applyTransportParams, stableId, taiVersion } from '../server/st2110/nmos.mjs';
// @ts-expect-error plain JS module
import { St2110Service } from '../server/st2110/service.mjs';
// @ts-expect-error plain JS module
import { writeSdp } from '../server/st2110/sdp.mjs';
// @ts-expect-error plain JS module
import { videoFlow } from '../server/st2110/generator.mjs';

const sdpText = writeSdp({ legs: [{ group: '239.10.0.1', port: 5004, source: '192.0.2.10' }], flow: videoFlow({ format: 'small' }) });
type Json = Record<string, unknown> & { id?: string };

describe('NMOS helpers', () => {
  it('stable ids and rising TAI versions', () => {
    expect(stableId('a')).toBe(stableId('a'));
    expect(stableId('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const a = taiVersion(1_000), b = taiVersion(1_000);
    expect(a).toMatch(/^\d+:\d+$/);
    expect(b > a || b.length > a.length).toBe(true);
  });
  it('IS-05 transport parameters rewrite the SDP', () => {
    const out = applyTransportParams(sdpText, [{ multicast_ip: '239.30.0.1', source_ip: '192.0.2.99', destination_port: 6000 }]);
    expect(out).toContain('m=video 6000 RTP/AVP 96');
    expect(out).toContain('c=IN IP4 239.30.0.1/64');
    expect(out).toContain('a=source-filter: incl IN IP4 239.30.0.1 192.0.2.99');
  });
});

describe('NMOS node over HTTP', () => {
  let svc: InstanceType<typeof St2110Service>;
  let base = '';
  const posts: { type: string; data: Json }[] = [];
  let heartbeats = 0;
  beforeAll(async () => {
    svc = new St2110Service({ dir: mkdtempSync(join(tmpdir(), 'lzs-nmos-')), inputs: 2 });
    // fake registry: records POSTs in order
    const fake = async (url: string, init: { method: string; body?: string }) => {
      if (url.includes('/health/nodes/')) { heartbeats++; return { status: 200 }; }
      if (init.method === 'POST') { const b = JSON.parse(init.body ?? '{}'); const fresh = !posts.some((p) => p.data.id === b.data.id); posts.push(b); return { status: fresh ? 201 : 200 }; }
      return { status: 204 };
    };
    svc.nmos = new NmosNode({ inputs: svc.inputs, generators: svc.generators, fetchImpl: fake, heartbeatMs: 60000 });
    await svc.nmos.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${svc.nmos.port}`;
  });
  afterAll(async () => { await svc.stop(); });
  const get = async (p: string) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
  const patch = async (p: string, body: unknown) => { const r = await fetch(base + p, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json() }; };

  it('IS-04: self, device with the IS-05 control, one receiver per input', async () => {
    expect((await get('/x-nmos/')).body).toEqual(['node/', 'connection/']);
    const self = (await get('/x-nmos/node/v1.3/self')).body;
    expect(self).toMatchObject({ id: svc.nmos.nodeId, api: { versions: ['v1.3'] }, clocks: [{ name: 'clk0', ref_type: 'internal' }] });
    expect(self.version).toMatch(/^\d+:\d+$/);
    const [dev] = (await get('/x-nmos/node/v1.3/devices/')).body;
    expect(dev.controls[0].type).toBe('urn:x-nmos:control:sr-ctrl/v1.1');
    const rx = (await get('/x-nmos/node/v1.3/receivers')).body;
    expect(rx.length).toBe(2);
    expect(rx[0]).toMatchObject({ format: 'urn:x-nmos:format:video', transport: 'urn:x-nmos:transport:rtp', subscription: { sender_id: null, active: false }, caps: { media_types: ['video/raw', 'video/SMPTE2022-6'] } });
    expect((await get(`/x-nmos/node/v1.3/receivers/${rx[0].id}`)).body.id).toBe(rx[0].id);
    expect((await get('/x-nmos/node/v1.3/nothing')).status).toBe(404);
    expect((await get('/x-nmos/node/v1.2/self')).status).toBe(404);
  });

  it('IS-05: an SDP in transport_file activates the input; /active and IS-04 follow', async () => {
    const id = svc.nmos.receiverId('net1');
    const before = (await get(`/x-nmos/node/v1.3/receivers/${id}`)).body.version;
    const legs = (await get(`/x-nmos/connection/v1.1/single/receivers/${id}/constraints`)).body;
    expect(legs.length).toBe(2); // ST 2022-7 capable: two legs
    const sender = '11111111-2222-5333-8444-555555555555';
    const r = await patch(`/x-nmos/connection/v1.1/single/receivers/${id}/staged`, { sender_id: sender, master_enable: true, transport_file: { data: sdpText, type: 'application/sdp' }, activation: { mode: 'activate_immediate' } });
    expect(r.status).toBe(200);
    expect(r.body.activation.activation_time).toMatch(/^\d+:\d+$/);
    expect(readFileSync(svc.inputs.file('net1'), 'utf8')).toContain('239.10.0.1');
    const active = (await get(`/x-nmos/connection/v1.1/single/receivers/${id}/active`)).body;
    expect(active).toMatchObject({ master_enable: true, sender_id: sender });
    expect(active.transport_params[0]).toMatchObject({ multicast_ip: '239.10.0.1', source_ip: '192.0.2.10', destination_port: 5004 });
    const rx = (await get(`/x-nmos/node/v1.3/receivers/${id}`)).body;
    expect(rx.subscription).toEqual({ sender_id: sender, active: true });
    expect(rx.version).not.toBe(before);
    expect(svc.status().inputs[0]).toMatchObject({ connected: true, summary: { kind: 'video', address: '239.10.0.1:5004' } });
  });

  it('IS-05: new multicast address only, then disable', async () => {
    const id = svc.nmos.receiverId('net1');
    const r = await patch(`/x-nmos/connection/v1.1/single/receivers/${id}/staged`, { transport_params: [{ multicast_ip: '239.10.0.2' }, {}], activation: { mode: 'activate_immediate' } });
    expect(r.status).toBe(200);
    expect(readFileSync(svc.inputs.file('net1'), 'utf8')).toContain('c=IN IP4 239.10.0.2');
    const off = await patch(`/x-nmos/connection/v1.1/single/receivers/${id}/staged`, { master_enable: false, activation: { mode: 'activate_immediate' } });
    expect(off.status).toBe(200);
    expect(readFileSync(svc.inputs.file('net1'), 'utf8')).toBe('');
    expect((await get(`/x-nmos/node/v1.3/receivers/${id}`)).body.subscription.active).toBe(false);
  });

  it('IS-05: invalid requests are refused with 400', async () => {
    const id = svc.nmos.receiverId('net2');
    expect((await patch(`/x-nmos/connection/v1.1/single/receivers/${id}/staged`, { transport_file: { data: 'v=0\r\nm=audio 5004 RTP/AVP 97\r\n', type: 'application/sdp' } })).status).toBe(400);
    expect((await patch(`/x-nmos/connection/v1.1/single/receivers/${id}/staged`, { transport_params: [{ destination_port: 80 }, {}] })).status).toBe(400);
    expect((await patch(`/x-nmos/connection/v1.1/single/receivers/${id}/staged`, { transport_params: [{ bogus: 1 }, {}] })).status).toBe(400);
    expect((await patch(`/x-nmos/connection/v1.1/single/receivers/${id}/staged`, { master_enable: true, activation: { mode: 'activate_immediate' } })).status).toBe(400); // no SDP yet
    expect((await patch(`/x-nmos/connection/v1.1/single/receivers/${id}/staged`, { activation: { mode: 'activate_scheduled_relative', requested_time: 'soon' } })).status).toBe(400);
  });

  it('IS-05: scheduled relative activation answers 202', async () => {
    const id = svc.nmos.receiverId('net2');
    const r = await patch(`/x-nmos/connection/v1.1/single/receivers/${id}/staged`, { master_enable: true, transport_file: { data: sdpText, type: 'application/sdp' }, activation: { mode: 'activate_scheduled_relative', requested_time: '0:50000000' } });
    expect(r.status).toBe(202);
    await new Promise((ok) => setTimeout(ok, 150));
    expect((await get(`/x-nmos/connection/v1.1/single/receivers/${id}/active`)).body.master_enable).toBe(true);
  });

  it('generator appears as source/flow/sender with a transport file; IS-05 disables it', async () => {
    const port = 30000 + Math.floor(Math.random() * 20000);
    const g = await svc.generators.add({ kind: 'video', format: 'small', host: '127.0.0.1', port });
    expect(g.running).toBe(true);
    const [snd] = (await get('/x-nmos/node/v1.3/senders')).body;
    const [flow] = (await get('/x-nmos/node/v1.3/flows')).body;
    expect(flow).toMatchObject({ media_type: 'video/raw', frame_width: 192, frame_height: 108, interlace_mode: 'progressive' });
    expect(snd.flow_id).toBe(flow.id);
    const tf = await fetch(base + `/x-nmos/connection/v1.1/single/senders/${snd.id}/transportfile`);
    expect(tf.headers.get('content-type')).toBe('application/sdp');
    expect(await tf.text()).toContain(`m=video ${port} RTP/AVP 96`);
    const off = await patch(`/x-nmos/connection/v1.1/single/senders/${snd.id}/staged`, { master_enable: false, activation: { mode: 'activate_immediate' } });
    expect(off.status).toBe(200);
    expect(off.body.master_enable).toBe(false);
    expect(svc.generators.list()[0].running).toBe(false);
    svc.generators.remove(g.id);
  });

  it('registration: node, device, then receivers in order; heartbeat after', async () => {
    svc.nmos.reg.url = 'http://registry.invalid';
    await svc.nmos.heartbeat();
    expect(svc.nmos.reg.state).toBe('registered');
    const types = posts.map((p) => p.type);
    expect(types.slice(0, 2)).toEqual(['node', 'device']);
    expect(types.indexOf('receiver')).toBeGreaterThan(types.indexOf('device'));
    await svc.nmos.heartbeat();
    expect(heartbeats).toBe(1);
  });
});

describe('ST 2110 HTTP API (/api/st2110)', () => {
  it('connects an input from an SDP and refuses a foreign content type', async () => {
    const svc = new St2110Service({ dir: mkdtempSync(join(tmpdir(), 'lzs-api-')), inputs: 1 });
    const { createServer } = await import('node:http');
    const srv = createServer((req, res) => svc.handle(req, res, new URL(req.url ?? '/', 'http://x').pathname, () => null));
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
    const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/api/st2110`;
    expect((await fetch(`${base}/inputs/net1`, { method: 'PUT', headers: { 'content-type': 'text/plain' }, body: sdpText })).status).toBe(415);
    const r = await fetch(`${base}/inputs/net1`, { method: 'PUT', headers: { 'content-type': 'application/sdp' }, body: sdpText });
    expect(r.status).toBe(200);
    const st = await (await fetch(base)).json();
    expect(st.inputs[0]).toMatchObject({ id: 'net1', url: 'st2110:net1', connected: true });
    expect((await fetch(`${base}/generators`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'video', host: '999.1.1.1', port: 5004 }) })).status).toBe(400);
    await new Promise((ok) => srv.close(ok));
    await svc.stop();
  });
});
