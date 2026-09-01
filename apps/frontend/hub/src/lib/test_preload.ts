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
  (value: unknown) => value,
  { raw: (value: unknown) => value, snapshot: (value: unknown) => value },
) as RunePolyfill;
(globalThis as Record<string, unknown>).$derived = (value: unknown) => value;

const effectPolyfill = ((fn: () => void) => {
  fn();
}) as unknown as Record<string, unknown>;
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
  __esModule: true,
}));

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
