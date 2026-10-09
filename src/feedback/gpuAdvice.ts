// Which GPU the app renders on, and whether that slows the scopes down (desktop app only).
// Chromium on Windows takes the first adapter the driver reports and cannot switch to the
// dedicated GPU by itself; the user has to choose "High performance" for the app in the
// Windows graphics settings (docs/research/windows-und-ndi.md).

export interface GpuDevice { vendorId: number; deviceId: number; active: boolean; driver?: string | null }
export interface GpuSnapshot { platform: string; gpus: GpuDevice[]; gpuFeatures: Record<string, string> }

export type GpuAdvice = { kind: 'software' } | { kind: 'integrated'; active: string; other: string };

const VENDORS: Record<number, string> = { 0x8086: 'Intel', 0x10de: 'NVIDIA', 0x1002: 'AMD', 0x106b: 'Apple', 0x5143: 'Qualcomm' };
export const vendorName = (id: number) => VENDORS[id] ?? `0x${id.toString(16)}`;

export function gpuAdvice(s: GpuSnapshot): GpuAdvice | null {
  const webgl = s.gpuFeatures.webgl2 ?? s.gpuFeatures.webgl ?? '';
  // software rendering (SwiftShader) or WebGL switched off: every frame is drawn on the CPU
  if (/software|unavailable|disabled/.test(webgl) || /software|disabled/.test(s.gpuFeatures.gpu_compositing ?? '')) return { kind: 'software' };
  if (s.platform !== 'win32') return null;
  const active = s.gpus.find((g) => g.active);
  // Intel integrated next to a dedicated NVIDIA/AMD card, but the app runs on Intel
  const dedicated = s.gpus.find((g) => !g.active && (g.vendorId === 0x10de || g.vendorId === 0x1002));
  if (active && active.vendorId === 0x8086 && dedicated) return { kind: 'integrated', active: vendorName(active.vendorId), other: vendorName(dedicated.vendorId) };
  return null;
}
