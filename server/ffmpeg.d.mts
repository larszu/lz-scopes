export type BroadcastFormat = 'prores' | 'jpegxs' | 'jpeg2000' | 'dnxhd' | 'dolbyE' | 'ac3' | 's302m' | 'sdp';
export interface FfmpegInfo { path: string; origin: 'env' | 'bundled' | 'vendor' | 'system' | 'none'; version: string | null; license: string | null; srt: boolean; inputSrt: boolean; formats?: Record<BroadcastFormat, boolean> }
export const BROADCAST_FORMATS: Record<BroadcastFormat, { decoders?: string[]; demuxers?: string[] }>;
export function listedNames(text: string): Set<string>;
export function broadcastFormats(decoders: Set<string>, demuxers: Set<string>): Record<BroadcastFormat, boolean>;
export function hostTarget(platform?: string, arch?: string): string;
export function bundledDirs(env?: Record<string, string | undefined>, resourcesPath?: string): { dir: string; kind: 'bundled' | 'vendor' }[];
export function ffmpegCandidates(env?: Record<string, string | undefined>): string[];
export function ffmpegOrigin(path: string | null | undefined, env?: Record<string, string | undefined>): FfmpegInfo['origin'];
export function licenseOf(configuration: string): string;
export function outputProtocols(text: string): Set<string>;
export function ffmpegInfo(path: string | null | undefined, env?: Record<string, string | undefined>): Promise<FfmpegInfo | null>;
export function hasSrt(path: string): Promise<boolean>;
export function ffmpegFor(url: string, candidates?: string[]): Promise<string | null>;
export function noFfmpegMessage(url: string, candidates?: string[]): import('./messages.mjs').BridgeMsg & { code: string };
