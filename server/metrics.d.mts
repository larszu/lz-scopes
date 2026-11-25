export const METRICS_CONTENT_TYPE: string;
export const PTP_STATES: string[];
export function metricsText(s: {
  version?: string; uptimeS: number; appConnected: boolean; events: number;
  streams: { id: number; source: string; sent: number; dropped: number; bytes: number; width?: number; height?: number; fps?: number }[];
  ptp: unknown; rtp: unknown;
}): string;
export function metricsAccess(o: { remote?: string; token?: string; presented?: string | null; origin?: string; host?: string }): { status: number; error: string } | null;
