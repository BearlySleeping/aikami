// biome-ignore-all lint/style/useNamingConvention: env keys are SCREAMING_SNAKE_CASE literals by platform convention
// apps/frontend/hub/src/lib/test_preload.ts
// Preload for Bun test runner — runs once before all test files.
//
// 1. Polyfill Svelte 5 runes so .svelte.ts files are parseable without the
//    Svelte compiler.
//
// 2. Mock SvelteKit virtual modules ($app/*, $env/*) that Bun cannot resolve.
//
// 3. Mock $logger so server-side code can import it in test context.

import { mock } from 'bun:test';

// ── Svelte 5 runes ──────────────────────────────────────────────────────────

type RunePolyfill = {
  (value: unknown): unknown;
  raw: (value: unknown) => unknown;
  snapshot: (value: unknown) => unknown;
};

(globalThis as unknown as Record<string, RunePolyfill>).$state = Object.assign(
  // guard-ignore lint/type-safety/casting: rune polyfill registration - Svelte 5 runes not available in test env
  (value: unknown) => value,
  { raw: (value: unknown) => value, snapshot: (value: unknown) => value },
) as RunePolyfill;
(globalThis as Record<string, unknown>).$derived = (value: unknown) => value;

const effectPolyfill = ((fn: () => void) => {
  fn();
}) as unknown as Record<string, unknown>; // guard-ignore lint/type-safety/casting: rune polyfill registration - Svelte 5 runes not available in test env
effectPolyfill.root = (fn: () => void) => {
  fn();
  return () => {};
};
(globalThis as Record<string, unknown>).$effect = effectPolyfill;

// ── $app/env/private ────────────────────────────────────────────────────────
// Required by server-side API modules (better_auth.ts, ask.ts, catalog_index.ts)

mock.module('$app/env/private', () => ({
  BETTER_AUTH_SECRET: 'test-secret-min-32-chars-xxxxxxxxxxxxx',
  BETTER_AUTH_URL: 'http://localhost:5276',
  BETTER_AUTH_COOKIE_DOMAIN: 'localhost',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  OPENROUTER_API_KEY: 'test-openrouter-key',
  OPENROUTER_MODEL: 'test-model',
  CATALOG_ORIGIN_URL: 'http://localhost:5276',
  // C-513: the community-asset environment reads this. Absent ⇒ no moderators,
  // which is the fail-closed default the routes already expect.
  MODERATION_ACCOUNT_IDS: undefined,
  __esModule: true,
}));

// ── $app/env/public ─────────────────────────────────────────────────────────
// Required by server-side modules that gate behaviour on the deployment mode
// (better_auth.ts refuses to boot a live mode without a base URL/secret).

mock.module('$app/env/public', () => ({
  PUBLIC_APP_ID: 'hub',
  PUBLIC_MODE: 'testing',
  __esModule: true,
}));

// ── cloudflare:workers ──────────────────────────────────────────────────────
// The adapter-agnostic binding accessor (src/lib/server/worker_env.ts) reads
// `env` from this virtual module. In the real Worker the adapter resolves the
// module to the live `env`; here it is a stable object tests mutate via
// `setWorkerBindings`. A test that never configures bindings therefore sees an
// empty env and fails closed (missing binding) rather than throwing.
//
// The object identity is fixed (and exposed as `globalThis.__workerBindings`)
// so modules that already imported `env` still observe later mutations — a
// module-level `import { env }` would otherwise freeze the value at first read.

const workerBindings: Record<string, unknown> = {};
Object.defineProperty(globalThis, '__workerBindings', {
  value: workerBindings,
  writable: false,
  configurable: true,
});

mock.module('cloudflare:workers', () => ({
  env: workerBindings,
  __esModule: true,
}));

/** Replace the bindings every `getWorkerEnv()` call resolves to in tests. */
export const setWorkerBindings = (bindings: Record<string, unknown> | undefined): void => {
  for (const key of Object.keys(workerBindings)) {
    delete workerBindings[key];
  }
  Object.assign(workerBindings, bindings ?? {});
};

// ── $app/state ──────────────────────────────────────────────────────────────
// Required by view models (head_tags_view_model, app_view_model, error_view_model)

mock.module('$app/state', () => ({
  page: {
    url: new URL('http://localhost/'),
    params: {},
    route: { id: '' },
    status: 200,
    error: null,
    data: {},
  },
  navigating: null,
  __esModule: true,
}));

// ── $app/navigation ─────────────────────────────────────────────────────────
// Required by app_view_model

mock.module('$app/navigation', () => ({
  goto: mock(async () => {}),
  afterNavigate: mock(() => {}),
  beforeNavigate: mock(() => {}),
  disableScrollHandling: mock(() => {}),
  __esModule: true,
}));

// ── $logger ─────────────────────────────────────────────────────────────────
// Required by server-side API modules (catalog_stats.ts, health_db.ts, better_auth.ts)

mock.module('$logger', () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    log: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    spam: mock(() => {}),
  },
  __esModule: true,
}));

// ── Vite env vars required by @aikami/frontend-configs/environment.ts ─────

process.env.PUBLIC_APP_ID = 'hub';
process.env.PUBLIC_MODE = 'testing';
