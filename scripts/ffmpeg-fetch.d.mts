export function hostTarget(platform?: string, arch?: string): string;
export function configureFlags(files: string[]): Set<string>;
export function checkFlags(flags: Set<string>): string[];
export function fetchFfmpeg(target?: string): Promise<string>;
export function fetchSources(): Promise<string>;
