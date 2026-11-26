export const EVENT_KINDS: string[];
export interface EventEntry { id: number; t: number; kind: string; source: string; item: string; from: string | null; to: string }
export class EventLog {
  constructor(o?: { max?: number; now?: () => number });
  max: number;
  now: () => number;
  entries: EventEntry[];
  readonly total: number;
  add(kind: string, source: string, item: string, to: unknown, from?: unknown): EventEntry;
  change(key: string, kind: string, source: string, item: string, value: unknown): EventEntry | null;
  forget(prefix: string): void;
  list(o?: { since?: number; limit?: number }): EventEntry[];
  clear(): void;
}
export function redactSource(url: string): string;
export function formatOf(info: Record<string, unknown>): string | null;
export function audioOf(info: Record<string, unknown>): string | null;
export function observePtp(log: EventLog, st: unknown): void;
export function observeRtp(log: EventLog, st: unknown): void;
export function eventsCsv(entries: EventEntry[]): string;
export interface StreamRecord { id: number; source: string; sent: number; dropped: number; bytes: number; width?: number; height?: number; fps?: number; since: number }
export function tapStream(ws: { send: (data: unknown, ...rest: unknown[]) => unknown; on: (ev: 'close', cb: () => void) => unknown }, o: { log: EventLog; url: string; streams: Map<number, StreamRecord>; id: number }): StreamRecord;
