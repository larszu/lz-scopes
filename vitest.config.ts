import { defineConfig } from 'vitest/config';

// Agent worktrees live under .claude/ – never collect their tests. The Companion
// module (companion/) runs its own: npm run companion:test. vendor/ holds checked-out sources
// (camera bridge, DeckLink SDK) with their own tests.
export default defineConfig({ test: { exclude: ['node_modules/**', 'dist/**', '.claude/**', 'release/**', 'companion/**', 'e2e/**', 'vendor/**'] } });
