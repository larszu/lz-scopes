export interface BridgeMsg { message: string; code?: string; params?: Record<string, unknown> }
export class BridgeError extends Error {
  constructor(code: string, message: string, params?: Record<string, unknown>);
  code: string;
  params?: Record<string, unknown>;
}
export function bmsg(code: string, message: string, params?: Record<string, unknown>): BridgeMsg & { code: string };
export function toMsg(e: unknown): BridgeMsg;
export function field(name: string, m: unknown): Record<string, unknown>;
