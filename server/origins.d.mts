export function normalizeOrigin(o: unknown): string | null;
export function defaultOriginsFile(env?: Record<string, string | undefined>): string;
export class OriginStore {
  constructor(file?: string | null);
  allowTemporarily(o: string): string | null;
  has(o: string): boolean;
  list(): string[];
  add(o: string): string | null;
  remove(o: string): void;
}
export function clockAccess(r: { remote?: string; origin?: string; host?: string; store?: OriginStore }): null | { status: number; error: string };
export function newNonce(now?: number): string;
export function takeNonce(n: string, now?: number): boolean;
export function consentPage(requested: string | null, store: OriginStore, nonce: string): string;
export const CONSENT_HEADERS: Record<string, string>;
