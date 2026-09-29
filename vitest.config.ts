import { defineConfig } from 'vitest/config';

// Agent worktrees live under .claude/ – never collect their tests. The Companion
// module (companion/) runs its own: npm run companion:test.
export default defineConfig({ test: { exclude: ['node_modules/**', 'dist/**', '.claude/**', 'release/**', 'companion/**'] } });
