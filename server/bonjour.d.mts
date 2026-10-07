export const SERVICE_TYPE: string;
export function shouldAnnounce(host: string | undefined, env?: Record<string, string | undefined>): boolean;
export function instanceName(hostname?: string): string;
export function srvHost(hostname?: string): string;
export function announce(o: { port: number; host?: string }): Promise<{ name: string; stop: () => Promise<void> } | null>;
