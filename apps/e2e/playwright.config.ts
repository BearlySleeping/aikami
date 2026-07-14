// apps/e2e/playwright.config.ts
// Unified Playwright configuration for PWA + Game + AI Services E2E tests.
// Uses Node.js runtime (NOT Bun) to avoid CDP websocket hanging issues.
//
// C-054: Adds setup project for auth state caching (AC-1), custom fixtures,
// and emulator lifecycle hooks.
//
// Port numbers are hardcoded here (not imported from @aikami/constants)
// because the config is loaded by Node.js directly as ESM, and the
// monorepo packages are CJS modules incompatible with ESM imports.

import type { PlaywrightTestConfig } from '@playwright/test';
import { defineConfig, devices } from '@playwright/test';

// ── Emulator Ports ────────────────────────────────────────────
//
// 🔴 HARDCODED — Must stay in sync with:
//    packages/shared/constants/src/lib/development_ports.ts
//
// Not imported because the config is loaded by Node.js ESM loader
// and monorepo packages are CJS/TS modules incompatible with
// Node.js native ESM imports.
// ──────────────────────────────────────────────────────────────

const AUTH_PORT = 9098;
const FIRESTORE_PORT = 8081;
const STORAGE_PORT = 9198;
const PUBSUB_PORT = 8086;
const CLIENT_PORT = 5274;

/**
 * Worker-specific project ID for emulator data isolation.
 * Playwright sets TEST_WORKER_INDEX per worker process.
 * Each worker uses a distinct project namespace in the emulator
 * so parallel tests don't mutate each other's data.
 */
const PROJECT_ID = `demo-aikami-worker-${process.env.TEST_WORKER_INDEX || '0'}`;

// ── Environment binding for Firebase Admin SDK ─────────────────

// Protocol-free host strings (no http:// prefix — Firebase Admin SDK requires this)
process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${FIRESTORE_PORT}`;
process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${AUTH_PORT}`;
process.env.FIREBASE_STORAGE_EMULATOR_HOST = `127.0.0.1:${STORAGE_PORT}`;
process.env.PUBSUB_EMULATOR_HOST = `127.0.0.1:${PUBSUB_PORT}`;
process.env.GCLOUD_PROJECT = PROJECT_ID;

// ── Dev server base URLs ──────────────────────────────────────

const CLIENT_BASE_URL = `http://localhost:${CLIENT_PORT}`;

// Auth state cache file — per-worker for data isolation.
// Falls back to worker-0 if the specific worker file doesn't exist
// (e.g., more workers than auth states generated).
const getAuthStateFile = (workerIndex: string | number): string => {
  const specific = `./.auth/user-worker-${workerIndex}.json`;
  // In Bun runner context, we can check synchronously
  try {
    const { existsSync } = require('node:fs');
    if (existsSync(specific)) {
      return specific;
    }
  } catch {
    // fs not available in this context — let Playwright handle it
  }
  return `./.auth/user-worker-0.json`;
};

// Worker index for this process (0 = setup/serial, 1+ = parallel workers)
const WORKER_INDEX = process.env.TEST_WORKER_INDEX || '0';
const AUTH_STATE_FILE = getAuthStateFile(WORKER_INDEX);

// ── Global lifecycle hooks ────────────────────────────────────

const GLOBAL_SETUP = './src/global_setup.ts';
const GLOBAL_TEARDOWN = './src/global_teardown.ts';

// ── Core configuration ────────────────────────────────────────

export default defineConfig({
  // Global setup/teardown for database purging (C-054 AC-3)
  globalSetup: GLOBAL_SETUP,
  globalTeardown: GLOBAL_TEARDOWN,

  // Test directory: app-specific test files live in tests/{client,game,ai-services}/
  testDir: './tests',

  // Run all projects in parallel
  fullyParallel: true,

  // Fail CI on test.only()
  forbidOnly: !!process.env.CI,

  // Retry on CI (flake guard), no retries locally
  retries: process.env.CI ? 2 : 0,

  // Single worker in CI (deterministic), auto locally
  workers: process.env.CI ? 1 : undefined,

  // Reporter: list locally, github in CI
  reporter: process.env.CI ? [['github']] : [['list']],

  // Shared settings for all projects
  use: {
    // Default base URL — overridden per-project
    baseURL: CLIENT_BASE_URL,

    // Capture trace on first retry
    trace: 'on-first-retry',

    // Screenshots only on failure
    screenshot: 'only-on-failure',

    // Video retained on failure for CI debugging
    video: 'retain-on-failure',
  },

  // Timeout per test
  timeout: 60_000,

  // Expect timeout
  expect: {
    timeout: 15_000,
  },

  // ── Operational domain projects ────────────────────────────

  projects: [
    // ── Setup (Auth State Caching) ──────────────────────────
    {
      name: 'setup',
      testDir: './src',
      testMatch: /auth\.setup\.ts/,
    },

    // ── Client Domain ──────────────────────────────────────
    {
      name: 'client',
      testDir: './tests/client',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: CLIENT_BASE_URL,
        // Load pre-authenticated session state for protected-route tests.
        // Tests that need unauthenticated access should use the guestUser fixture,
        // which creates its own isolated context without storageState.
        storageState: AUTH_STATE_FILE,
        // Enable WebGL so tests that navigate to /game can load the PixiJS engine.
        // Without these flags, WebGPU/WebGL are unavailable in headless Chromium
        // and the game engine falls back to Canvas2D (or crashes), breaking any
        // test that touches the game canvas (inventory, game_page, etc.).
        //
        // Font rendering flags match the game project for deterministic pixel
        // output across headless CI machines with no dedicated GPU.
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=gl',
            '--enable-webgl',
            '--ignore-gpu-blocklist',
            // C-200 AC-1: Deterministic font rendering
            '--disable-lcd-text',
            '--font-render-hinting=none',
            '--disable-font-subpixel-positioning',
            '--force-color-profile=srgb',
            // Stability
            '--disable-gpu-rasterization',
            '--disable-accelerated-2d-canvas',
          ],
        },
      },
      dependencies: ['setup'],
    },

    // ── Game Domain ────────────────────────────────────────
    {
      name: 'game',
      testDir: './tests/game',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: CLIENT_BASE_URL,
        // C-200: Rendering determinism — Mesa software rasterization + font
        // subpixel deactivation for identical grayscale anti-aliasing across
        // headless CI machines with no dedicated GPU.
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=gl',
            '--enable-webgl',
            '--ignore-gpu-blocklist',
            '--enable-features=Vulkan,UseSkiaRenderer',
            // C-200 AC-1: Deterministic font rendering
            '--disable-lcd-text',
            '--font-render-hinting=none',
            '--disable-font-subpixel-positioning',
            '--force-color-profile=srgb',
            // C-217: GPU rasterization stability
            '--disable-gpu-rasterization',
            '--disable-accelerated-2d-canvas',
          ],
          // C-200 AC-1: Mesa software rasterization
          env: {
            // biome-ignore lint/style/useNamingConvention: process env variable
            LIBGL_ALWAYS_SOFTWARE: '1',
          },
        },
      },
      // Game tests don't need authentication — no setup dependency.
    },

    // ── AI Services Domain (future) ────────────────────────
    {
      name: 'ai-services',
      testDir: './tests/ai-services',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
} satisfies PlaywrightTestConfig);
