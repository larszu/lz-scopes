import type { ChildProcess } from 'node:child_process';
export function startLatencySource(target: string, opts?: { width?: number; height?: number; fps?: number; ffmpeg?: string; codec?: 'h264' | 'hevc'; bframes?: number }): { stop: () => void; process: ChildProcess };
