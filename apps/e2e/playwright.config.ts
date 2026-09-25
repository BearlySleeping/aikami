// apps/e2e/playwright.config.ts
// Unified Playwright configuration for PWA + Game + AI Services E2E tests.
// Uses Node.js runtime (NOT Bun) to avoid CDP websocket hanging issues.
//
// C-054: Adds setup project for auth state caching (AC-1), custom fixtures,
// and emulator lifecycle hooks.
//
// Port numbers are resolved by the local E2E config module. Keeping that
// module in the Node-loaded config tree avoids importing incompatible
// monorepo package barrels while still sharing one checkout-scoped offset.

import type { PlaywrightTestConfig } from '@playwright/test';
import { defineConfig, devices } from '@playwright/test';

import { EMULATOR_PORTS, IS_E2E_CI } from './src/config';

// Ports are resolved by the E2E checkout allocator in src/config.ts. The
// config imports the same effective values as preflight, auth, and visual
// capture, so CI's hub-worker port cannot drift from the local SSR port.
const CLIENT_PORT = EMULATOR_PORTS.client;
// C-526 AC-10: a SECOND client server, started with `PUBLIC_COMBAT_LLM_AGENTS=1`.
// The flag is `static: true`, so it must be set on the server that serves the
// app — a separate port with its own env is the only way to run both the flag-off
// and the enabled-agent lanes in one suite.
const CLIENT_LLM_PORT = EMULATOR_PORTS.clientLlm;

// The second client server AND the `client-llm-on` project exist ONLY when the
// enabled-agent lane is selected. Playwright has one global `webServer` array, so
// without this guard every unrelated E2E run would pay for an extra Vite dev
// server it never uses.
//
// 🔴 The signal must travel in the ENVIRONMENT, not in `process.argv`. Playwright
// forks a separate worker PROCESS per test file, and each worker re-evaluates
// this config with its OWN argv — which does not contain `--project=…`. Deciding
// from argv alone therefore defines the project during collection and then
// throws "Project \"client-llm-on\" not found in the worker process" at run time.
// Detecting the request here and promoting it to an env var, which Playwright
// forwards to its workers, makes both processes agree.
if (
  process.env.E2E_LLM_LANE !== '1' &&
  process.argv.some((argument) => argument.includes('client-llm-on'))
) {
  process.env.E2E_LLM_LANE = '1';
}

const LLM_LANE_ENABLED = process.env.E2E_LLM_LANE === '1';

// ── Project selection promotion ───────────────────────────────
//
// The server lifecycle is orchestrated per-run by the E2E preflight
// (src/services/preflight.ts, run from global_setup.ts), which needs to know
// exactly which `--project` values were requested so it starts only the
// servers those projects use — a `--project=game` run must not pay for a site
// or hub server (C-526 remediation).
//
// 🔴 The signal must travel in the ENVIRONMENT, not in `process.argv`.
// Playwright forks a separate worker PROCESS per test file, and each worker
// re-evaluates this config with its OWN argv — which does not contain
// `--project=…`. The main process resolves once and everything else (workers,
// globalSetup) inherits `E2E_SELECTED_PROJECTS`. When no `--project` is given
// (run all), nothing is promoted and the preflight assumes the full set.
const projectArgValues: string[] = [];
for (let index = 0; index < process.argv.length; index++) {
  const argument = process.argv[index];
  if (argument === '--project' && process.argv[index + 1]) {
    projectArgValues.push(process.argv[index + 1] as string);
  } else if (argument.startsWith('--project=')) {
    projectArgValues.push(argument.slice('--project='.length));
  }
}
if (projectArgValues.length > 0 && !process.env.E2E_SELECTED_PROJECTS) {
  process.env.E2E_SELECTED_PROJECTS = projectArgValues.join(',');
}

const SITE_PORT = EMULATOR_PORTS.site;
// EMULATOR_PORTS.hub is already the CI worker port when CI is set; using it
// directly keeps Playwright and the service map on the same endpoint.
const HUB_SERVER_PORT = EMULATOR_PORTS.hub;

// ── Dev server base URLs ──────────────────────────────────────

const CLIENT_BASE_URL = `http://localhost:${CLIENT_PORT}`;
const CLIENT_LLM_BASE_URL = `http://localhost:${CLIENT_LLM_PORT}`;
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
  forbidOnly: IS_E2E_CI,

  // Retry on CI (flake guard), no retries locally
  retries: IS_E2E_CI ? 2 : 0,

  // Single worker in CI (deterministic), auto locally
  workers: IS_E2E_CI ? 1 : undefined,

  // Reporter: `list` everywhere, plus an HTML report in CI.
  //
  // 🔴 NOT the `github` reporter. It emits `::error` workflow commands, and
  // moon re-prints a failed task's output un-prefixed in its REVIEW block —
  // so GitHub would raise an annotation from that, AND
  // scripts/src/lib/ci/report.ts would raise a second one for the same
  // failure. The report script is the single annotator by design; it parses
  // this exact `list` failure format. The HTML report is uploaded as a
  // workflow artifact, which is where traces, screenshots and video live.
  reporter: IS_E2E_CI ? [['list'], ['html', { open: 'never' }]] : [['list']],

  // Shared settings for all projects
  use: {
    // Default base URL — overridden per-project
    baseURL: CLIENT_BASE_URL,

    // Mute all browser audio (BGM/SFX/TTS) during E2E runs. This is a
    // browser-level mute that works even when attaching to an already-running
    // dev server (reuseExistingServer), so it needs no build-time env.
    launchOptions: {
      args: ['--mute-audio'],
    },

    // Capture trace on first retry
    trace: 'on-first-retry',

    // Screenshots only on failure
    screenshot: 'only-on-failure',

    // Video retained on failure for CI debugging
    video: 'retain-on-failure',
  },

  // ── Server lifecycle ──────────────────────────────────────
  //
  // 🔴 There is deliberately NO `webServer` array. Playwright starts
  // `webServer` entries BEFORE `globalSetup`, which made backgrounding build
  // work impossible; more importantly a failed entry aborted the whole run
  // before a single test executed, with only the generic
  // "webServer was not able to start" as a signal (C-526 remediation).
  //
  // Instead the per-run preflight in src/services/preflight.ts (driven by
  // src/services/service_map.ts + E2E_SELECTED_PROJECTS above) runs from
  // globalSetup: it probes each required server, reuses it when up (your
  // herdr tabs), checks env seeds, falls back to the CI build recipe plus
  // detached serve processes without herdr, and waits for readiness —
  // failing with an actionable message. global_teardown stops only the
  // servers the preflight spawned itself.

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
      // C-526 AC-10: the enabled-agent spec asserts the flag is ON, so it must
      // only ever run against the `client-llm-on` server. Running it here would
      // assert the opposite of what this lane serves.
      testIgnore: /combat_v2_llm\.spec\.ts/,
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
            '--mute-audio',
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

    // ── Client Domain: enabled LLM agents (C-526 AC-10) ───
    // The SAME test directory as `client`, narrowed to the enabled-agent spec,
    // served from the flag-on server above. Keeping one testDir means shared
    // helpers stay shared; the testMatch is what separates the lanes.
    ...(LLM_LANE_ENABLED
      ? [
          {
            name: 'client-llm-on',
            testDir: './tests/client',
            testMatch: /combat_v2_llm\.spec\.ts/,
            use: {
              ...devices['Desktop Chrome'],
              baseURL: CLIENT_LLM_BASE_URL,
              storageState: AUTH_STATE_FILE,
              launchOptions: {
                args: [
                  '--mute-audio',
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
        ]
      : []),

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
            '--mute-audio',
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
            '--mute-audio',
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
            '--mute-audio',
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
                  '--mute-audio',
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
