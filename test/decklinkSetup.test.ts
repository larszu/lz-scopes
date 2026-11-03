import { describe, expect, it } from 'vitest';
import { deckLinkSteps, stepStates, type DeckLinkStatus } from '../src/decklinkSetup';
// @ts-expect-error plain JS module
import { parseDriverExtension } from '../server/index.mjs';

// `systemextensionsctl list` on macOS 26.6 with Desktop Video 16.5 (UltraStudio Recorder 3G, 03.11.2026)
const WAITING = `2 extension(s)
--- com.apple.system_extension.driver_extension (Go to 'System Settings > General > Login Items & Extensions > Driver Extensions' to modify these system extension(s))
enabled	active	teamID	bundleID (version)	name	[state]
	*	9ZGFBWLSYP	com.blackmagic-design.BlackmagicIO.DExt (16.5/0033.9319.0000)	com.blackmagic-design.BlackmagicIO.DExt	[activated waiting for user]
*	*	9ZGFBWLSYP	com.blackmagic-design.desktopvideo.Network.DExt (16.5/0033.9319.0001)	com.blackmagic-design.desktopvideo.Network.DExt	[activated enabled]`;

describe('DeckLink setup', () => {
  it('reads the state of the BlackmagicIO driver extension', () => {
    expect(parseDriverExtension(WAITING)).toBe('waiting');
    expect(parseDriverExtension(WAITING.replace('[activated waiting for user]', '[activated enabled]'))).toBe('enabled');
    // only the network driver registered: Desktop Video Setup has not registered the device driver yet
    expect(parseDriverExtension(WAITING.split('\n').filter((l) => !l.includes('BlackmagicIO')).join('\n'))).toBe('missing');
  });

  const base: DeckLinkStatus = { available: true, helper: true, platform: 'darwin', devices: [] };
  it('ticks off the steps the bridge reports and marks the next one', () => {
    const none = deckLinkSteps({ ...base, available: false, code: 'decklink.noDriver' });
    expect(none).toHaveLength(4);
    expect(stepStates(none)).toEqual(['done', 'next', 'open', 'open']);
    expect(stepStates(deckLinkSteps({ ...base, driverExtension: 'waiting' }))).toEqual(['done', 'done', 'next', 'open']);
    expect(stepStates(deckLinkSteps({ ...base, driverExtension: 'enabled' }))).toEqual(['done', 'done', 'done', 'next']);
    expect(stepStates(deckLinkSteps({ ...base, devices: [{ index: 0, name: 'UltraStudio Recorder 3G', inputs: ['sdi', 'hdmi'], input: 'sdi' }] }))).toEqual(['done', 'done', 'done', 'done']);
  });
  it('has no approval step outside macOS', () => {
    expect(deckLinkSteps({ ...base, platform: 'win32' })).toHaveLength(3);
    expect(deckLinkSteps({ ...base, platform: 'linux' })).toHaveLength(3);
  });
});
