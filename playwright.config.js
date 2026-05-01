// Playwright config — runtime-fidelity gate for browser-only DOM code.
// Per CLAUDE.md Step 3 rule 9 ("smoke-test runtime fidelity") and issue #11.
// Boots `npm run dev` (python3 -m http.server 8000), drives a real Chromium
// against http://localhost:8000, and runs the e2e specs under tests/e2e/.
//
// Single project (chromium) for G1; mobile/iOS projects can be added later
// without changing spec authoring.

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  // Each spec resets the bus/router via window-exposed helpers, so tests are
  // independent — but we keep workers low to avoid the dev server fighting
  // for port 8000.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8000',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8000',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
