export const CODECS10: Record<string, { args: (fps: number) => string[]; mux: 'ts' | 'nut' }>;
export const HEADER10: number;
export function parseFrame10(buf: Buffer): { w: number; h: number; full: boolean; matrix: '709' | '2020'; transfer: 'sdr' | 'pq' | 'hlg' } | null;
export function out10Format(target: string, codec: string): { format?: string; error?: string };
export function out10Args(o: { w: number; h: number; fps: number; codec: string; target: string; full: boolean; matrix: string; transfer: string }): string[];
export function handleOut10(ws: unknown, q: URLSearchParams, ffmpegs: string[]): void;
