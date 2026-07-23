import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Some sandboxed dev environments ship a pre-installed Chromium and forbid `playwright install`;
// CI installs its own via `npx playwright install`, so this path won't exist there.
const sandboxChromium = '/opt/pw-browsers/chromium';
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH || (existsSync(sandboxChromium) ? sandboxChromium : undefined);

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: chromiumPath ? { executablePath: chromiumPath } : {} },
    },
  ],
  webServer: {
    command: 'npm run build -w server && npm run build -w client && node server/dist/index.js',
    cwd: '..',
    url: 'http://localhost:4000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: 'production',
      DB_PATH: ':memory:',
      JWT_SECRET: 'e2e-test-secret',
      PORT: '4000',
      // The client is served by this same process here, so its own origin must be allowed.
      CORS_ORIGINS: 'http://localhost:4000',
    },
  },
});
