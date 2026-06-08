// apps/frontend/pwa/src/lib/test_preload.ts
// Preload for Bun test runner — runs once before all test files.
//
// 1. Polyfill Svelte 5 runes so .svelte.ts files are parseable without the
//    Svelte compiler.
//
// 2. Provide a consistent mock for @aikami/frontend/services so all test
//    files see the same exports regardless of load order.
//
// 3. Set Vite env vars so @aikami/frontend/configs/environment.ts can
//    validate without crashing in Bun.

import { mock } from 'bun:test';

// ── Svelte 5 runes ──────────────────────────────────────────────────────────

(globalThis as Record<string, unknown>).$state = (value: unknown) => value;
(globalThis as Record<string, unknown>).$derived = (value: unknown) => value;

const effectPolyfill = ((fn: () => void) => {
  fn();
}) as unknown as Record<string, unknown>;
effectPolyfill.root = (fn: () => void) => {
  fn();
  return () => {};
};
(globalThis as Record<string, unknown>).$effect = effectPolyfill;

// ── Consistent mock for @aikami/frontend/services ───────────────────────────
// Multiple test files mock this module with different exports. Bun caches the
// first mock and subsequent test files get the cached version. Define a
// superset here so all tests see all needed exports.

class MockBaseFrontendClass {
  protected readonly _options: { className: string };
  constructor(options: { className: string }) {
    this._options = options;
  }
  protected debug(..._args: unknown[]): void {}
  protected info(..._args: unknown[]): void {}
  protected log(..._args: unknown[]): void {}
  protected warn(..._args: unknown[]): void {}
  protected error(..._args: unknown[]): void {}
}

class MockBaseViewModel extends MockBaseFrontendClass {
  __mounted = false;
  errorMessage = undefined;
  get showLoadingView(): boolean {
    return false;
  }
  async initialize(): Promise<void> {}
  async dispose(): Promise<void> {}
}

mock.module('@aikami/frontend/services', () => ({
  BaseFrontendClass: MockBaseFrontendClass,
  BaseViewModel: MockBaseViewModel,
}));

// ── Vite env vars required by @aikami/frontend/configs/environment.ts ─────

process.env.PUBLIC_APP_ID = 'pwa';
process.env.PUBLIC_MODE = 'emulator';
process.env.PUBLIC_FIREBASE_API_KEY = 'mock-api-key';
process.env.PUBLIC_FIREBASE_AUTH_DOMAIN = 'mock.firebaseapp.com';
process.env.PUBLIC_FIREBASE_STORAGE_BUCKET = 'mock.appspot.com';
process.env.PUBLIC_FIREBASE_APP_ID = 'mock-app-id';
process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID = 'mock-sender-id';
process.env.PUBLIC_FIREBASE_MEASUREMENT_ID = 'mock-measurement-id';
process.env.PUBLIC_IMAGE_URL = 'http://localhost:8188';
