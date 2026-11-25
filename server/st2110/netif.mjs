// Network interface facts for the ST 2110 receive paths and the PTP monitor (#231):
// - OUI from a PTP clock identity,
// - PTP hardware clocks (PHC) per interface and the receive load, both Linux only (sysfs).
//
// Linux sysfs (kernel documentation ABI/testing/sysfs-class-net-statistics, sysfs-ptp [Wissen]):
// /sys/class/net/<if>/statistics/{rx,tx}_{bytes,packets} are counters since the interface came up;
// /sys/class/net/<if>/device/ptp/ptp<N> exists when the driver registers a PTP hardware clock.
// A PHC only says that hardware time stamps are possible: Node's sockets cannot request
// SO_TIMESTAMPING, so this bridge still works with software time stamps and says so.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';

/**
 * OUI (three octets, "AC-DE-48") of a clock identity in hex (16 digits), when it was formed from an
 * EUI-48 (FF-FE in octets 3–4, IEEE 1588-2008 §7.5.2.2.2 [Wissen]); null for other identities.
 * The vendor name is not looked up: the IEEE registry is not bundled.
 */
export function ouiOf(clockIdHex) {
  const h = String(clockIdHex ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase();
  if (h.length !== 16 || h.slice(6, 10) !== 'fffe') return null;
  return h.slice(0, 6).toUpperCase().match(/../g).join('-');
}

const readNum = (f) => { try { return Number(readFileSync(f, 'utf8').trim()); } catch { return null; } };

/** Interfaces with an IPv4 address, plus PHC and counters where the system tells (Linux). */
export function interfaceFacts({ sys = '/sys/class/net', platform = process.platform, ifaces = networkInterfaces() } = {}) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    const v4 = (list ?? []).find((a) => a.family === 'IPv4' && !a.internal);
    if (!v4) continue;
    const e = { name, address: v4.address, mac: v4.mac ?? null, phc: null, rxBytes: null, rxPackets: null, speedMbit: null };
    if (platform === 'linux' && existsSync(`${sys}/${name}`)) {
      try { e.phc = readdirSync(`${sys}/${name}/device/ptp`).find((x) => /^ptp\d+$/.test(x)) ?? null; } catch { /* no PHC */ }
      e.rxBytes = readNum(`${sys}/${name}/statistics/rx_bytes`);
      e.rxPackets = readNum(`${sys}/${name}/statistics/rx_packets`);
      const sp = readNum(`${sys}/${name}/speed`);
      e.speedMbit = sp && sp > 0 ? sp : null;
    }
    out.push(e);
  }
  return out;
}

/** Receive load per interface from two readings (Mbit/s and share of the link speed). */
export class InterfaceLoad {
  constructor(read = interfaceFacts, now = () => Date.now()) { this.read = read; this.now = now; this.last = new Map(); }
  sample() {
    const t = this.now();
    return this.read().map((e) => {
      const prev = this.last.get(e.name);
      this.last.set(e.name, { t, rxBytes: e.rxBytes, rxPackets: e.rxPackets });
      let rxMbit = null, rxPps = null;
      if (prev && e.rxBytes !== null && prev.rxBytes !== null && t > prev.t) {
        rxMbit = Math.round(((e.rxBytes - prev.rxBytes) * 8) / ((t - prev.t) / 1000) / 1e4) / 100;
        rxPps = Math.round((e.rxPackets - prev.rxPackets) / ((t - prev.t) / 1000));
      }
      return { name: e.name, address: e.address, phc: e.phc, speedMbit: e.speedMbit, rxMbit, rxPps, load: rxMbit !== null && e.speedMbit ? Math.round((rxMbit / e.speedMbit) * 1000) / 10 : null };
    });
  }
}
