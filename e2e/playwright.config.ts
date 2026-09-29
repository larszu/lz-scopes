import { defineConfig } from '@playwright/test';

// End-to-end tests against the desktop app (Electron + bridge). Not part of `npm test`:
//   npm run test:e2e          (builds dist first)
// One worker: every test starts its own app instance with its own profile and port.
// Timeouts are generous – without a GPU Chromium renders WebGL in software (SwiftShader).
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 60_000 },
  reporter: [['list']],
  outputDir: '../test-results/e2e',
});
