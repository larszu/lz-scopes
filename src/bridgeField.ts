// The bridge address (Settings → Bridge) as an explicit hook instead of a DOM search: main.ts
// binds its field here, platform shells (src/native/ios.ts) read and set the address, change
// the placeholder and normalise typed input – whether or not the settings window is open.

export interface BridgeFieldBinding {
  get(): string;
  /** store the address (main.ts: state, visible field, save, ffmpeg info) */
  set(v: string): void;
  setPlaceholder(p: string): void;
}

let binding: BridgeFieldBinding | null = null;
let normaliser: (v: string) => string = (v) => v;

/** main.ts: connect the field; replaces an earlier binding. */
export function bindBridgeField(b: BridgeFieldBinding) { binding = b; }

/** Typed input as it is stored (iOS: "192.168.1.20" → ws://192.168.1.20:4192). */
export const normaliseBridge = (v: string) => normaliser(v);

export const bridgeField = {
  bound: () => !!binding,
  get: () => binding?.get() ?? '',
  set: (v: string) => binding?.set(normaliseBridge(v)),
  setPlaceholder: (p: string) => binding?.setPlaceholder(p),
  setNormaliser: (f: (v: string) => string) => { normaliser = f; },
};
export type BridgeField = typeof bridgeField;
