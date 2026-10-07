/* eslint-disable @typescript-eslint/no-explicit-any */
export const PTP_PRIMARY: string;
export const PTP_EVENT_PORT: number;
export const PTP_GENERAL_PORT: number;
export const MSG: { SYNC: number; DELAY_REQ: number; FOLLOW_UP: number; DELAY_RESP: number; ANNOUNCE: number; SIGNALING: number; MANAGEMENT: number };
export const TIME_SOURCES: Record<number, string>;
export const LOCKING_STATUS: string[];
export const RTP_VIDEO_CLOCK: number;
export function clockIdText(id: string): string;
export function parseSmTlv(b: Buffer, off: number): any;
export function parsePtp(b: Buffer): any;
export function buildPtp(o: { type: number; domain?: number; flags?: number; correctionNs?: number; clockIdentity?: string; portNumber?: number; sequenceId?: number; logMessageInterval?: number; body?: Buffer }): Buffer;
export function tsBytes(ns: bigint | number): Buffer;
export function nowUtcNs(): bigint;
export class PtpMonitor {
  constructor(o?: { iface?: string; delayReq?: boolean; taiMinusUtc?: (utcMs: number) => number; now?: () => bigint });
  ourId: string;
  pendingReq: Map<number, { tx: bigint }>;
  start(): Promise<PtpMonitor>;
  stop(): void;
  onPacket(buf: Buffer, rinfo: { address?: string }, rxUtcNs: bigint): void;
  status(prefer?: number): any;
}
export function errorText(e: unknown, port: number): import('./messages.mjs').BridgeMsg;
export function ipv4Interfaces(): { name: string; address: string }[];
export function parseRtp(b: Buffer): { marker: boolean; payloadType: number; seq: number; timestamp: number; ssrc: number } | null;
export function rtpCheck(ts: number, rxPtpSeconds: number, rateNum: number, rateDen: number, clock?: number): { lagSeconds: number; lagFrames: number; frame: number; gridTicks: number };
export class RtpMonitor {
  constructor(o: { group: string; port: number; iface?: string; rateNum?: number; rateDen?: number; ptpNow: () => number | null });
  start(): RtpMonitor;
  stop(): void;
  onPacket(b: Buffer, rxPtpSeconds: number | null): void;
  status(): any;
}
export function isMulticastV4(a: string): boolean;
