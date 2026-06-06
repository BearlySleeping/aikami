// apps/e2e/playwright.config.ts
// Unified Playwright configuration for PWA + Game + AI Services E2E tests.
// Uses Node.js runtime (NOT Bun) to avoid CDP websocket hanging issues.

import { defineConfig, devices } from '@playwright/test';
import { EMULATOR_PORTS } from '@aikami/constants';

const PORT = EMULATOR_PORTS;

export default defineConfig({
  // Global setup: purge Firebase emulators before tests run
  globalSetup: './src/global_setup.ts',
  // Global teardown: purge Firebase emulators after all tests complete
  globalTeardown: './src/global_teardown.ts',

  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['github']] : 'list',

  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    // ── PWA tests ───────────────────────────────────────────
    {
      name: 'pwa',
      testDir: './tests/pwa',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${PORT.pwa}`,
      },
    },
    // ── Game tests ──────────────────────────────────────────
    {
      name: 'game',
      testDir: './tests/game',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: `http://localhost:${PORT.game}`,
      },
    },
    // ── AI Services tests (future) ──────────────────────────
    {
      name: 'ai-services',
      testDir: './tests/ai-services',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
});
