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

// Set by scripts/src/lib/herdr/session.ts / herdr_adapter.ts for
// contract-scoped pipeline runs — same offset formula as
// packages/shared/constants/src/lib/development_ports.ts's
// contractPortOffset(), so this lands on the identical value independently
// (can't import that helper here either, same ESM-loader constraint above).
// 0 for a manual, non-contract test run.
const EMULATOR_PORT_OFFSET = Number(process.env.PUBLIC_EMULATOR_PORT_OFFSET || 0);

const CLIENT_PORT = 5274 + EMULATOR_PORT_OFFSET;
const SITE_PORT = 5280 + EMULATOR_PORT_OFFSET;
const HUB_PORT = 5276 + EMULATOR_PORT_OFFSET;
const HUB_WORKER_PORT = 5278 + EMULATOR_PORT_OFFSET;

// 🔴 The hub is served from a different port in CI than it is locally, and
// that is deliberate rather than an inconsistency.
//
// The hub is an SSR app on adapter-cloudflare whose /api routes need D1 and
// R2 bindings. Locally the herdr `hub` tab is `vite dev` on HUB_PORT, and
// SvelteKit's platform proxy supplies those bindings. In CI we serve BUILT
// output, and `vite preview` deliberately does NOT set up the platform proxy
// — the built hub's real equivalent is `wrangler dev --local` against
// build/_worker.js, which run_hub_worker.ts starts on HUB_WORKER_PORT with
// genuine local D1/R2.
//
// Client and site have no such split: both are static builds (adapter-static
// / Astro `output: 'static'`), so previewing them is just serving files.
const HUB_SERVER_PORT = process.env.CI ? HUB_WORKER_PORT : HUB_PORT;

// ── Dev server base URLs ──────────────────────────────────────

const CLIENT_BASE_URL = `http://localhost:${CLIENT_PORT}`;
const SITE_BASE_URL = `http://localhost:${SITE_PORT}`;
// Hub SSR dev server (C-396): public catalog browse surface.
const HUB_BASE_URL = `http://localhost:${HUB_SERVER_PORT}`;

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

  // Reporter: `list` everywhere, plus an HTML report in CI.
  //
  // 🔴 NOT the `github` reporter. It emits `::error` workflow commands, and
  // moon re-prints a failed task's output un-prefixed in its REVIEW block —
  // so GitHub would raise an annotation from that, AND
  // scripts/src/lib/ci/report.ts would raise a second one for the same
  // failure. The report script is the single annotator by design; it parses
  // this exact `list` failure format. The HTML report is uploaded as a
  // workflow artifact, which is where traces, screenshots and video live.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

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

  // ── Server lifecycle ──────────────────────────────────────
  //
  // 🔴 `reuseExistingServer: !process.env.CI` is what lets one config serve
  // both worlds. Locally your herdr tabs are already listening on these
  // ports, so Playwright attaches to them and starts nothing — the workflow
  // README.md documents stays exactly as it is. In CI there is no herdr (it
  // is a nix flake input, not something a GitHub runner has), so Playwright
  // starts each server itself and tears it down when the run ends.
  //
  // CI serves BUILT output rather than `vite dev`: no HMR warm-up, no
  // first-request compile stalls behind a 15s expect timeout, and the bytes
  // under test are the bytes that ship. The heavy job runs the moon builds
  // first — cache-warm — so these commands only have to serve. See
  // .github/workflows/pr-checks.yml.
  //
  // Each app reads PORT (client/site vite+astro config, run_hub_worker.ts),
  // so the contract port offset above propagates without a second source of
  // truth for port numbers.
  webServer: [
    {
      command: 'bun run preview',
      cwd: '../frontend/client',
      url: CLIENT_BASE_URL,
      env: { PORT: String(CLIENT_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'bun run preview',
      cwd: '../frontend/site',
      url: SITE_BASE_URL,
      env: { PORT: String(SITE_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // See HUB_SERVER_PORT above for why CI and local differ here.
      command: process.env.CI ? 'bun run dev:worker' : 'bun run dev',
      cwd: '../frontend/hub',
      url: HUB_BASE_URL,
      env: { PORT: String(HUB_SERVER_PORT) },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],

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

    // ── Site Domain (Astro Marketing Site) ──────────────────
    {
      name: 'site-chromium',
      testDir: './tests/site',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: SITE_BASE_URL,
      },
    },
    {
      name: 'site-mobile',
      testDir: './tests/site',
      use: {
        ...devices['Pixel 5'],
        baseURL: SITE_BASE_URL,
      },
    },
    {
      name: 'site-firefox',
      testDir: './tests/site',
      use: {
        ...devices['Desktop Firefox'],
        baseURL: SITE_BASE_URL,
      },
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

    // ── Hub Domain (C-396) ────────────────────────────────
    // The hub is an SSR app on its own dev server. Hub tests manage their
    // own session cookie (POST /api/auth/session) — no storageState dep.
    {
      name: 'hub',
      testDir: './tests/hub',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: HUB_BASE_URL,
      },
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

    // ── Release Gate: Offline Profile ─────────────────────
    // C-335 AC-2: Runs the full production journey with network
    // throttled to offline using a pre-cached local AI model.
    {
      name: 'client-offline',
      testDir: './tests/client',
      testMatch: /release_gate\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: CLIENT_BASE_URL,
        storageState: AUTH_STATE_FILE,
        // Network: offline with localhost passthrough for dev server
        contextOptions: {
          offline: false, // We handle offline via route interception
        },
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=gl',
            '--enable-webgl',
            '--ignore-gpu-blocklist',
            '--disable-lcd-text',
            '--font-render-hinting=none',
            '--disable-font-subpixel-positioning',
            '--force-color-profile=srgb',
            '--disable-gpu-rasterization',
            '--disable-accelerated-2d-canvas',
          ],
        },
      },
      dependencies: ['setup'],
    },

    // ── Release Gate: Keyboard-Only Profile ────────────────
    // C-335 AC-3: Runs the full production journey using only
    // keyboard inputs (Tab, Enter, Escape, I, arrow keys, Space).
    // No page.mouse or page.touch calls allowed.
    {
      name: 'client-keyboard',
      testDir: './tests/client',
      testMatch: /release_gate\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: CLIENT_BASE_URL,
        storageState: AUTH_STATE_FILE,
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=gl',
            '--enable-webgl',
            '--ignore-gpu-blocklist',
            '--disable-lcd-text',
            '--font-render-hinting=none',
            '--disable-font-subpixel-positioning',
            '--force-color-profile=srgb',
            '--disable-gpu-rasterization',
            '--disable-accelerated-2d-canvas',
          ],
        },
      },
      dependencies: ['setup'],
    },

    // ── Release Gate: WebGPU Profile (Manual Opt-In) ───────
    // C-335: WebGPU coverage is a manual test on hardware with
    // a real GPU. Not run by default in CI.
    // Conditionally included only when TEST_WEBGPU=true
    ...(process.env.TEST_WEBGPU === 'true'
      ? [
          {
            name: 'client-webgpu',
            testDir: './tests/client',
            testMatch: /release_gate\.spec\.ts/,
            use: {
              ...devices['Desktop Chrome'],
              baseURL: CLIENT_BASE_URL,
              storageState: AUTH_STATE_FILE,
              launchOptions: {
                args: [
                  '--enable-webgpu',
                  '--enable-unsafe-webgpu',
                  '--enable-features=Vulkan,UseSkiaRenderer',
                  '--ignore-gpu-blocklist',
                  '--disable-lcd-text',
                  '--font-render-hinting=none',
                  '--disable-font-subpixel-positioning',
                  '--force-color-profile=srgb',
                ],
              },
            },
            dependencies: ['setup'],
          },
        ]
      : []),
  ],
} satisfies PlaywrightTestConfig);
