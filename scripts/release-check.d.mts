export function requiredAssets(manifest?: unknown): [string, (name: string) => boolean][];
export function missingAssets(names: string[], req?: [string, (name: string) => boolean][]): string[];
