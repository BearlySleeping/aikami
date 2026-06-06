import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the Astro landing page.
 * Uses emulator mode for Firebase-dependent features.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',
  timeout: 30000,

  use: {
    baseURL: 'http://localhost:4321',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Auto-start Astro dev server in emulator mode before running tests
  webServer: process.env.CI
    ? {
        command: 'bun run build && bun run preview',
        url: 'http://localhost:4321',
        reuseExistingServer: false,
        timeout: 120 * 1000,
      }
    : {
        command: 'bun run dev -- --mode emulator',
        url: 'http://localhost:4321',
        reuseExistingServer: !process.env.CI,
        timeout: 120 * 1000,
        stdout: 'pipe',
        stderr: 'pipe',
      },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
});
