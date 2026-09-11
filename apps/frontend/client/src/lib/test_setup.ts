// apps/frontend/client/src/lib/test_setup.ts
// biome-ignore-all lint/style/useNamingConvention: Mock object properties must mirror PascalCase class names from @aikami/frontend-services for module mocking
// Infrastructure setup for the Bun test runner — runs once before all test
// files.
//
// 1. Polyfill Svelte 5 runes so .svelte.ts files are parseable without the
//    Svelte compiler.
//
// 2. Provide the base-class/platform mock for @aikami/frontend/services so
//    importing the package root does not pull the router/dialog/R2/preference
//    aggregation.
//
// 3. Set Vite env vars so @aikami/frontend-configs/environment.ts can
//    validate without crashing in Bun.
//
// The legacy `$services` barrel mock and the global storage mock have been
// removed: the client runtime graph no longer reaches the barrel or the
// database from this lane, and migrated features inject capabilities with
// feature-owned fixtures.

import { mock } from 'bun:test';
import { resolve } from 'node:path';

// ── Svelte 5 runes ──────────────────────────────────────────────────────────

(globalThis as Record<string, unknown>).$state = (value: unknown) => value;
(globalThis as Record<string, unknown>).$state.raw = (value: unknown) => value;
(globalThis as Record<string, unknown>).$state.snapshot = (value: unknown) => value;
(globalThis as Record<string, unknown>).$derived = (value: unknown) => value;

// ── IndexedDB polyfill (required by DraftStore in test env) ────────────────

const _indexedStore = new Map<string, Map<string, Map<string, unknown>>>();
const _indexedDatabaseVersions = new Map<string, number>();
const _deletedDatabases = new Set<string>();

/** Creates a request-like object that fires onsuccess on next microtask. */
const _createRequest = <T>(result: T) => {
  const request = {
    onsuccess: undefined as (() => void) | undefined,
    onerror: undefined as (() => void) | undefined,
    result,
    error: null as DOMException | null,
  };
  queueMicrotask(() => request.onsuccess?.());
  return request;
};

(globalThis as Record<string, unknown>).indexedDB = {
  open: (dbName: string, version?: number) => {
    // Treat deleted databases as empty (Firebase Integrity check)
    if (_deletedDatabases.has(dbName)) {
      _deletedDatabases.delete(dbName);
      _indexedStore.delete(dbName);
      _indexedDatabaseVersions.delete(dbName);
    }
    if (!_indexedStore.has(dbName)) {
      _indexedStore.set(dbName, new Map());
    }
    const dbStores = _indexedStore.get(dbName) ?? new Map();
    const currentVersion = _indexedDatabaseVersions.get(dbName);
    const requestedVersion = version ?? currentVersion ?? 1;
    const shouldUpgrade = currentVersion === undefined || requestedVersion > currentVersion;
    if (shouldUpgrade) {
      _indexedDatabaseVersions.set(dbName, requestedVersion);
    }
    const db = {
      objectStoreNames: {
        contains: (storeName: string) => dbStores.has(storeName),
      },
      createObjectStore: (storeName: string, _options?: unknown) => {
        if (!dbStores.has(storeName)) {
          dbStores.set(storeName, new Map());
        }
        return {
          createIndex: (..._args: unknown[]) => {},
        };
      },
      transaction: (_storeName: string | string[], _mode: string) => ({
        objectStore: (name: string) => {
          const store = dbStores.get(name) ?? new Map();
          const indexStore = new Map<string, Map<string, unknown[]>>();
          return {
            get: (key: string) => _createRequest(store.get(key)),
            put: (value: Record<string, unknown>) => {
              const key =
                (value as { id?: string; chatId?: string }).id ??
                (value as { chatId?: string }).chatId ??
                '';
              store.set(key, value);
              return _createRequest(key);
            },
            delete: (key: string) => {
              store.delete(key);
              return _createRequest(undefined);
            },
            getAll: () => _createRequest(Array.from(store.values())),
            index: (indexName: string) => {
              if (!indexStore.has(indexName)) {
                indexStore.set(indexName, new Map());
              }
              return {
                getAll: (key: string) => {
                  const results = Array.from(store.values()).filter(
                    (doc) => (doc as Record<string, unknown>)[indexName] === key,
                  );
                  return _createRequest(results);
                },
              };
            },
          };
        },
      }),
      onclose: null as (() => void) | null,
      close: () => {},
    };
    const openRequest = {
      onupgradeneeded: undefined as ((event: unknown) => void) | undefined,
      onsuccess: undefined as ((event: unknown) => void) | undefined,
      onerror: undefined as ((event: unknown) => void) | undefined,
      result: db,
      error: null as DOMException | null,
    };
    // Initial opens and later version increases both require an upgrade event.
    if (shouldUpgrade) {
      queueMicrotask(() => {
        openRequest.onupgradeneeded?.({ target: openRequest } as unknown);
        openRequest.onsuccess?.({ target: openRequest } as unknown);
      });
    } else {
      queueMicrotask(() => openRequest.onsuccess?.({ target: openRequest } as unknown));
    }
    return openRequest;
  },
  deleteDatabase: (dbName: string) => {
    _deletedDatabases.add(dbName);
    _indexedStore.delete(dbName);
    _indexedDatabaseVersions.delete(dbName);
    const request = {
      onsuccess: undefined as (() => void) | undefined,
      onerror: undefined as (() => void) | undefined,
      result: undefined,
      error: null as DOMException | null,
    };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  },
};

// ── Browser API polyfills (required by services in test env) ────────────────

if (typeof KeyboardEvent === 'undefined') {
  (globalThis as Record<string, unknown>).KeyboardEvent = class {
    key: string;
    constructor(_type: string, options?: { key?: string }) {
      this.key = options?.key ?? '';
    }
    preventDefault = mock(() => {});
    stopPropagation = mock(() => {});
  };
}

if (typeof window === 'undefined') {
  (globalThis as Record<string, unknown>).window = {
    AudioContext: class {
      state = 'suspended';
      resume = mock(async () => {});
      close = mock(async () => {});
      createGain = mock(() => ({ connect: mock(() => {}), gain: { value: 1 } }));
      createBufferSource = mock(() => ({
        connect: mock(() => {}),
        start: mock(() => {}),
        stop: mock(() => {}),
      }));
      createDynamicsCompressor = mock(() => ({
        connect: mock(() => {}),
        threshold: { value: -24 },
        knee: { value: 30 },
        ratio: { value: 12 },
        attack: { value: 0.003 },
        release: { value: 0.25 },
      }));
      decodeAudioData = mock(async () => ({ duration: 1 }));
      destination = {};
    },
    innerWidth: 1920,
    innerHeight: 1080,
    addEventListener: mock(() => {}),
    removeEventListener: mock(() => {}),
  };
}

const effectPolyfill = ((fn: () => void) => {
  fn();
}) as unknown as Record<string, unknown>; // guard-ignore lint/type-safety/casting: rune polyfill registration - Svelte 5 runes not available in test env
effectPolyfill.root = (fn: () => void) => {
  fn();
  return () => {};
};
(globalThis as Record<string, unknown>).$effect = effectPolyfill;

// ── Consistent mock for @aikami/frontend/services ───────────────────────────
// Multiple test files mock this module with different exports. Bun caches the
// first mock and subsequent test files get the cached version. Define a
// superset here so all tests see all needed exports.
//
// QUARANTINED LEGACY LANE: migrated features must NOT rely on these base-class
// fakes. Import the real hierarchy from the narrow, import-safe entrypoint
// `@aikami/frontend/services/base` (see dialog_capabilities.ts) — the account
// ViewModel's test is the reference. These fakes survive only for unmigrated
// tests and are deleted with the rest of this preload once none remain. Do not
// extend them.

class MockBaseFrontendClass {
  protected readonly _options: { className: string };
  constructor(options: { className: string }) {
    this._options = options;
  }
  static create<O extends { className: string }, T extends MockBaseFrontendClass>(
    this: new (
      options: O,
    ) => T,
    options: O,
  ): T {
    return new this(options);
  }
  protected debug(..._args: unknown[]): void {}
  protected info(..._args: unknown[]): void {}
  protected log(..._args: unknown[]): void {}
  protected warn(..._args: unknown[]): void {}
  protected error(..._args: unknown[]): void {}
  protected showSnackbar(_action: unknown): void {}
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

const frontendServicesMock = {
  BaseFrontendClass: MockBaseFrontendClass,
  BaseViewModel: MockBaseViewModel,
  BaseFormModel: class {},
  dialogService: {},
  routerService: {},
  gameStateSyncService: {},
  routerUtils: {},
  // biome-ignore lint/complexity/noStaticOnlyClass: mock must match real class shape
  PreferenceService: class {
    static create() {
      return {};
    }
  },
  // biome-ignore lint/complexity/noStaticOnlyClass: mock must match real class shape
  CorePreferenceProviderService: class {
    static create() {
      return {};
    }
  },
};

mock.module('@aikami/frontend/services', () => frontendServicesMock);

// The test tsconfig maps @aikami/frontend/services to the real package path.
// Bun resolves via tsconfig paths before checking mock.module for bare
// specifiers, so we also mock by the resolved absolute path.
const _FRONTEND_SVC_PATH = resolve(
  import.meta.dir,
  '../../../../../packages/frontend/services/src/index.ts',
);

mock.module(_FRONTEND_SVC_PATH, () => ({
  ...frontendServicesMock,
  __esModule: true,
}));

// NOTE: the global `$services` barrel mock has been removed. The client
// runtime graph no longer imports the barrel from the Bun test lane; migrated
// features inject capabilities and tests own their fixtures.

// ── Mock $logger alias required by game services ──────────────────────────

// Must cover every method on BaseLoggerService — a missing one is a
// TypeError at the call site, not a quiet no-op. `write` and `setLogLevel`
// are used by BaseClass when a real base subclass logs (the preload's
// former fake base classes stubbed them out, so they went unnoticed).
mock.module('$logger', () => ({
  logger: {
    debug: mock(() => {}),
    info: mock(() => {}),
    log: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    spam: mock(() => {}),
    write: mock(() => {}),
    setLogLevel: mock(() => {}),
  },
  __esModule: true,
}));

// ── @aikami/utils ─────────────────────────────────────────────────────────
//
// NOT mocked. A previous revision replaced the whole barrel with a single
// `toAppError` stub, which erased `BaseClass` and every other export and broke
// ~300 tests with "Export named 'BaseClass' not found". The real module loads
// fine under Bun and already exports `toAppError`.

// ── Mock SvelteKit virtual modules required by transitive dependencies ──────

mock.module('$app/navigation', () => ({
  goto: mock(async () => {}),
  afterNavigate: mock(() => {}),
  beforeNavigate: mock(() => {}),
  disableScrollHandling: mock(() => {}),
}));

mock.module('$app/state', () => ({
  page: {
    url: new URL('http://localhost/'),
    params: {},
    route: { id: '' },
    status: 200,
    error: null,
    data: {},
  },
}));

// ── Mock $lib paths (SvelteKit alias not resolvable in Bun without .svelte-kit) ──
// ConfigService imports $lib/views/utils/crypto_vault and $types which can't be
// resolved. We mock the lorebook_store module so it never loads config_service.
mock.module('$lib/views/utils/crypto_vault', () => ({
  encrypt: mock(async () => {}),
  decrypt: mock(async () => undefined),
  clearVault: mock(() => {}),
}));
// 🔴 Resolved from this file's own location, never a literal absolute path:
// an absolute path bakes in one machine's checkout (or one throwaway contract
// worktree) and silently stops matching everywhere else, leaving the real
// module to load and pull in config_service again.
mock.module(`${import.meta.dir}/services/lorebook/lorebook_store.svelte.ts`, () => ({
  lorebookStore: {
    scanActiveEntries: () => [],
  },
  LorebookStore: class {},
}));

// ── Vite env vars required by @aikami/frontend-configs/environment.ts ─────

process.env.PUBLIC_APP_ID = 'client';
process.env.PUBLIC_MODE = 'testing';
process.env.PUBLIC_IMAGE_URL = 'http://localhost:8188';

// Ensure no OpenRouter API keys leak from the direnv environment.
// Testing mode should have no external API keys so ConfigService
// tests can assert empty apiKeys state.
delete process.env.PUBLIC_OPENROUTER_API_KEY;
delete process.env.PUBLIC_OPENROUTER_MODEL;
delete process.env.OPENROUTER_API_KEY;
delete process.env.PUBLIC_OLLAMA_MODEL;

// ── @aikami/frontend-preview mock ────────────────────────────────────────
// The preview package depends on @aikami/frontend-engine and pixi.js which
// cannot be resolved in bun test. Only createLpcRenderer (which depends on
// pixi.js) is stubbed; pure helpers are re-exported from their real implementations
// via direct module imports to avoid pixi.js dependency.

import {
  getLpcGrid,
  getLpcIconBackgroundPosition,
  getLpcIconBackgroundSize,
  getLpcIconCellPitch,
  pickHeroCell,
} from '../../../../../packages/frontend/preview/src/lib/lpc/lpc_icon_frame.ts';
import {
  createDefaultLpcPreviewState,
  decodeLpcPreviewState,
  encodeLpcPreviewState,
} from '../../../../../packages/frontend/preview/src/lib/lpc/preview_url_state.ts';

mock.module('@aikami/frontend/preview', () => ({
  createLpcRenderer: mock(() => ({
    loadSheet: mock(async () => ({})),
    extractFrame: mock(() => null),
    getFrameTexture: mock(async () => null),
    createSprite: mock(async () => null),
    clearCaches: mock(() => {}),
    resolver: { resolve: mock(() => null) },
  })),
  detectLpcSheetLayout: mock((sheet: { width: number; height: number }) => {
    const pitch = sheet.width >= 1000 ? 128 : 64;
    return {
      pitch,
      columns: Math.floor(sheet.width / pitch),
      rows: Math.floor(sheet.height / pitch),
      scale: 1,
      anchorOffset: pitch === 128 ? { x: -64, y: -64 } : { x: -32, y: -32 },
    };
  }),
  getLpcSpriteAnchor: mock((layout: { anchorOffset: { x: number; y: number } }) => ({
    x: layout.anchorOffset.x,
    y: layout.anchorOffset.y,
  })),
  getLpcIconCellPitch,
  getLpcGrid,
  getLpcIconBackgroundSize,
  getLpcIconBackgroundPosition,
  pickHeroCell,
  encodeLpcPreviewState,
  decodeLpcPreviewState,
  createDefaultLpcPreviewState,
  __esModule: true,
}));

// ── Browser localStorage polyfill (Bun test env lacks it) ──

const _localStore = new Map<string, string>();

(globalThis as Record<string, unknown>).localStorage = {
  getItem(key: string): string | null {
    return _localStore.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    _localStore.set(key, value);
  },
  removeItem(key: string): void {
    _localStore.delete(key);
  },
  clear(): void {
    _localStore.clear();
  },
  get length(): number {
    return _localStore.size;
  },
  key(index: number): string | null {
    const keys = [..._localStore.keys()];
    return keys[index] ?? null;
  },
};
