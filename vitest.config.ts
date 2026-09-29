import { defineConfig } from 'vitest/config';

// Agent worktrees live under .claude/ – never collect their tests.
export default defineConfig({ test: { exclude: ['node_modules/**', 'dist/**', '.claude/**', 'release/**'] } });
