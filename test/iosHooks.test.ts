// iOS shell (src/native/ios.ts): the bridge address lives in Settings → Bridge since #111, so
// afterApp hooks in through src/bridgeField.ts and the settings registry instead of a DOM search.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const browse = vi.fn();
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({ browseBridges: (o: unknown) => browse(o), cameras: async () => ({ cameras: [], authorization: 'unknown' }), info: async () => null }) }));
vi.mock('@capacitor-community/bluetooth-le', () => ({ BleClient: {} }));
vi.mock('../src/native/mobile.css', () => ({}));
vi.stubGlobal('document', { documentElement: {}, querySelectorAll: () => [] });

const { afterApp } = await import('../src/native/ios');
const { bindBridgeField, bridgeField } = await import('../src/bridgeField');

function setup(initial: string) {
  let value = initial, placeholder = '';
  bindBridgeField({ get: () => value, set: (v) => { value = v; }, setPlaceholder: (p) => { placeholder = p; } });
  const deps = { bridge: bridgeField, extend: vi.fn(), register: vi.fn(), refresh: vi.fn() };
  afterApp(deps);
  return { deps, value: () => value, placeholder: () => placeholder };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('iOS afterApp hooks', () => {
  beforeEach(() => browse.mockReset());

  it('extends the bridge settings page and adds the cameras page', () => {
    browse.mockResolvedValue({ bridges: [] });
    const { deps, placeholder } = setup('ws://10.0.0.1:4192');
    expect(deps.extend).toHaveBeenCalledWith('bridge', expect.any(Function));
    expect(deps.register).toHaveBeenCalledWith(expect.objectContaining({ id: 'ios-cameras' }));
    expect(placeholder()).not.toBe('');
    expect(browse).not.toHaveBeenCalled(); // address set: no automatic search
  });

  it('normalises typed addresses before they are stored', () => {
    browse.mockResolvedValue({ bridges: [] });
    const { value } = setup('x');
    bridgeField.set('192.168.1.20');
    expect(value()).toBe('ws://192.168.1.20:4192');
  });

  it('empty address and exactly one bridge via Bonjour: takes it', async () => {
    browse.mockResolvedValue({ bridges: [{ name: 'Studio', host: 'studio.local.', port: 4192, addresses: ['10.0.0.7'] }] });
    const { deps, value } = setup('');
    await flush();
    expect(browse).toHaveBeenCalledOnce();
    expect(value()).toBe('ws://10.0.0.7:4192');
    expect(deps.refresh).toHaveBeenCalled();
  });

  it('two bridges: leaves the choice to the user', async () => {
    browse.mockResolvedValue({ bridges: [
      { name: 'A', host: 'a.local.', port: 4192, addresses: ['10.0.0.1'] },
      { name: 'B', host: 'b.local.', port: 4192, addresses: ['10.0.0.2'] },
    ] });
    const { value } = setup('');
    await flush();
    expect(value()).toBe('');
  });
});
