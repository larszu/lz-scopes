// One camera link for the shading bar, picked by the address (#222):
//   ws://host:9700     the bridge's own WebSocket (CameraBridgeLink)
//   http://host:8640   an NMOS node – IS-04 Node API, then IS-12 (Is12Link)
import { CameraBridgeLink, type ShadingLink } from './bridge';
import { Is12Link } from './is12';

export const isNmosAddress = (url: string) => /^https?:\/\//i.test(url.trim());

export class AutoLink implements ShadingLink {
  private inner: CameraBridgeLink | Is12Link;
  constructor(private url: () => string, private changed: () => void) {
    this.inner = this.make();
  }
  private make() { return isNmosAddress(this.url()) ? new Is12Link(this.url, this.changed) : new CameraBridgeLink(this.url, this.changed); }
  /** which protocol is in use */
  get kind(): 'bridge' | 'nmos' { return this.inner instanceof Is12Link ? 'nmos' : 'bridge'; }
  get cameras() { return this.inner.cameras; }
  get configs() { return this.inner.configs; }
  get cameraErrors() { return this.inner.cameraErrors; }
  get states() { return this.inner.states; }
  get data() { return this.inner.data; }
  get status() { return this.inner.status; }
  get lastError() { return this.inner.lastError; }
  /** what the bridge reported about itself (bridge route only) */
  get info() { return this.inner instanceof CameraBridgeLink ? this.inner.info : null; }
  subscribe(f: () => void) { return this.inner.subscribe(f); }
  request(msg: Record<string, unknown>) { return this.inner.request(msg); }
  connect() {
    // address changed to the other protocol: start over with the right link
    if (isNmosAddress(this.url()) !== (this.kind === 'nmos')) { this.inner.disconnect(); this.inner = this.make(); }
    void this.inner.connect();
  }
  disconnect() { this.inner.disconnect(); }
  send(cameraNumber: number, cmd: string, params: Record<string, number>) { return this.inner.send(cameraNumber, cmd, params); }
}
