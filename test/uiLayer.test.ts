import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// One opening/closing logic for dialogs and popovers (docs/architecture/ui.md, #111): only the
// UI layer src/ui (modal, popover) and the menu bar (WAI-ARIA menubar on native popovers, placed
// by src/ui/popover.ts place()) may create dialogs or popovers. Feature modules use modal(),
// openModal() and popover() so Esc, focus trap and focus return behave the same everywhere.

const ROOT = join(__dirname, '..', 'src');
const ALLOWED = new Set(['ui/modal.ts', 'ui/popover.ts', 'menu/menubar.ts']);
const PATTERNS = [/\.showModal\(/, /\bh\(\s*'dialog'/, /createElement\(\s*'dialog'/, /popover:\s*'(auto|manual)'/, /\.popover\s*=\s*'/];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? (n === 'vendor' ? [] : files(p)) : /\.ts$/.test(n) ? [p] : [];
  });
}

describe('UI layer', () => {
  it('creates dialogs and popovers only in src/ui and the menu bar', () => {
    const hits = files(ROOT).map((p) => relative(ROOT, p).split('\\').join('/'))
      .filter((r) => !ALLOWED.has(r))
      .flatMap((r) => readFileSync(join(ROOT, r), 'utf8').split('\n').map((l, i) => (PATTERNS.some((re) => re.test(l)) ? `${r}:${i + 1}` : '')).filter(Boolean));
    expect(hits).toEqual([]);
  });
});
