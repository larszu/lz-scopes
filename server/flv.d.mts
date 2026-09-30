export function avcCodecString(profile: number, compat: number, level: number): string;
export function parseAvcConfig(rec: Buffer): { lengthSize: number; sps: Buffer[]; pps: Buffer[]; codec: string };
export function toAnnexB(payload: Buffer, lengthSize: number, prefix?: Buffer[]): Buffer;
export class FlvH264Demuxer {
  constructor(onConfig: (c: { codec: string }) => void, onFrame: (f: { key: boolean; pts: number; data: Buffer }) => void);
  push(chunk: Buffer): void;
}
