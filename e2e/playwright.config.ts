import { defineConfig } from '@playwright/test';

// End-to-end tests against the desktop app (Electron + bridge). Not part of `npm test`:
//   npm run test:e2e          (builds dist first)
// One worker: every test starts its own app instance with its own profile and port.
// Timeouts are generous – without a GPU Chromium renders WebGL in software (SwiftShader).
// One retry in CI: a saturated runner can keep the renderer busy long enough that the window
// stops answering control commands altogether. Each test brings its own app, so a retry starts
// from a clean one – what fails twice is the program, what fails once was the machine.
export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 180_000,
  expect: { timeout: 60_000 },
  reporter: [['list']],
  outputDir: '../test-results/e2e',
});
