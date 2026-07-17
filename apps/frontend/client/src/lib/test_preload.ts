// apps/frontend/client/src/lib/test_preload.ts
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

// biome-ignore-all lint/style/useNamingConvention: Mock object properties must mirror PascalCase class names from @aikami/frontend-services for module mocking
// biome-ignore-all lint/style/noNonNullAssertion: safe regex group access in fake DB
// biome-ignore-all lint/style/noSubstr: string parsing in fake SQL parser
import { mock } from 'bun:test';

// ── Svelte 5 runes ──────────────────────────────────────────────────────────

(globalThis as Record<string, unknown>).$state = (value: unknown) => value;
(globalThis as Record<string, unknown>).$state.raw = (value: unknown) => value;
(globalThis as Record<string, unknown>).$state.snapshot = (value: unknown) => value;
(globalThis as Record<string, unknown>).$derived = (value: unknown) => value;

// ── IndexedDB polyfill (required by DraftStore in test env) ────────────────

const _indexedStore = new Map<string, Map<string, Map<string, unknown>>>();
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
  open: (dbName: string, _version?: number) => {
    // Treat deleted databases as empty (Firebase Integrity check)
    if (_deletedDatabases.has(dbName)) {
      _deletedDatabases.delete(dbName);
      _indexedStore.delete(dbName);
    }
    if (!_indexedStore.has(dbName)) {
      _indexedStore.set(dbName, new Map());
    }
    const dbStores = _indexedStore.get(dbName) ?? new Map();
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
      transaction: (_storeName: string | string[], _mode: string) => {
        return {
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
        };
      },
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
    // Fire onupgradeneeded if database is new (no stores exist yet)
    if (dbStores.size === 0) {
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
  firebaseFunctionsService: { call: mock(async () => ({})) },
  firebaseAnalyticService: { logEvent: mock(async () => {}) },
  firebaseAuthService: {
    currentUser: null,
    onAuthStateChanged: mock(() => () => {}),
  },
  firebaseCloudMessaging: {},
  firebaseRemoteConfig: {},
  firebaseStorageService: {},
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
const _FRONTEND_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/packages/frontend/services/src/index.ts';

mock.module(_FRONTEND_SVC_PATH, () => ({
  ...frontendServicesMock,
  __esModule: true,
}));

// ── Consistent mock for $services (local barrel) ──────────────────────────
// All ViewModels import from $services. Without a global mock, the first
// test file that mocks the barrel with mock.module() leaks its partial
// mock to all subsequent test files. Provide a comprehensive stub barrel
// here so every test sees a consistent set of functional stubs.

const _LOCAL_SVC_PATH =
  '/home/sonny/Development/Projects/passion/aikami/apps/frontend/client/src/lib/services/index.ts';

const _createServiceStub = () => {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (!(prop in _target)) {
        // Auto-create mock functions for any missing method
        (_target as Record<string, unknown>)[prop] = mock(() => {});
      }
      return (_target as Record<string, unknown>)[prop];
    },
  };
  return new Proxy({} as Record<string, unknown>, handler) as Record<string, unknown>;
};

/**
 * Creates a callable Proxy stub with a mutable `.fn` property.
 *
 * Bun's mock.module() freezes module exports, preventing tests from
 * reassigning exported mock functions. This wrapper makes the export
 * callable (via `apply` trap) while also supporting property mutation
 * through a writable `.fn` on the underlying target object.
 *
 * Tests can replace the implementation by mutating `stub.fn = newMock`
 * instead of trying to reassign an export on the frozen module namespace.
 */
const _createCallableStub = () => {
  const target = { fn: mock(() => {}) as (...args: never) => unknown };
  return new Proxy(
    mock(() => {}),
    {
      apply(_t, _thisArg, args) {
        return target.fn(...args);
      },
      get(_t, prop) {
        if (prop === 'fn') {
          return target.fn;
        }
        return Reflect.get(_t, prop);
      },
      set(_t, prop, value) {
        if (prop === 'fn') {
          target.fn = value as (...args: never) => unknown;
          return true;
        }
        return Reflect.set(_t, prop, value);
      },
    },
  );
};

const _localServicesMock = () => ({
  aiService: _createServiceStub(),
  AIService: class {},
  streamOrchestratorService: _createServiceStub(),
  textGenerationService: _createServiceStub(),
  TextGenerationService: class {},
  analyticService: _createServiceStub(),
  AnalyticService: class {},
  appService: _createServiceStub(),
  AppService: class {},
  audioContextManager: _createServiceStub(),
  AudioContextManager: class {},
  audioQueuePlayer: _createServiceStub(),
  audioService: _createServiceStub(),
  AudioService: class {},
  AudioQueuePlayer: class {},
  ttsService: _createServiceStub(),
  TtsService: class {},
  authService: _createServiceStub(),
  AuthService: class {},
  personaCreationService: _createServiceStub(),
  PersonaCreationService: class {},
  characterService: _createServiceStub(),
  CharacterService: class {},
  personaCreationTextStreamService: _createServiceStub(),
  PersonaCreationTextStreamService: class {},
  chatService: _createServiceStub(),
  contextBuilder: _createServiceStub(),
  conversationRepository: _createServiceStub(),
  npcChatService: _createServiceStub(),
  configService: _createServiceStub(),
  ConfigService: class {},
  diceService: _createServiceStub(),
  DiceService: class {},
  draftStore: _createServiceStub(),
  DraftStore: class {},
  MessageBranchStore: class {},
  ExpressionAssetResolver: class {},
  gameSaveService: _createServiceStub(),
  GameSaveService: class {},
  setPendingGameLoad: _createCallableStub(),
  gameStateService: Object.assign(_createServiceStub(), {
    worldGenOutput: {
      worldName: 'The Realm',
      worldDescription: 'A world of adventure awaits.',
      npcs: [],
      locations: ['Town Square'],
      partyArcs: [],
      hudWidgets: [],
    },
  }),
  GameStateService: class {},
  // C-314: Split services
  playerStateService: Object.assign(_createServiceStub(), {
    playerLevel: 1,
    playerXp: 0,
    playerXpToNext: 100,
    playerHp: 100,
    playerMaxHp: 100,
    playerBaseAttack: 5,
    playerBaseDefense: 12,
    characterSheetSummary: '',
    reset: _createCallableStub(),
    startListening: _createCallableStub(),
  }),
  worldStateService: Object.assign(_createServiceStub(), {
    currentWorld: undefined,
    currentLocation: undefined,
    worldVariables: {},
    isConnected: false,
    activeContexts: [],
    worldGenOutput: {
      worldName: 'The Realm',
      worldDescription: 'A world of adventure awaits.',
      npcs: [],
      locations: ['Town Square'],
      partyArcs: [],
      hudWidgets: [],
    },
    quests: [],
    defeatedEnemies: [],
    reset: _createCallableStub(),
    startListening: _createCallableStub(),
  }),
  inventoryService: Object.assign(_createServiceStub(), {
    inventory: [],
    gold: 100,
    isOpen: false,
    addGold: _createCallableStub(),
    removeGold: _createCallableStub(),
    open: _createCallableStub(),
    close: _createCallableStub(),
    toggle: _createCallableStub(),
    startListening: _createCallableStub(),
    reset: _createCallableStub(),
  }),
  equipmentService: Object.assign(_createServiceStub(), {
    equippedWeapon: undefined,
    equippedArmor: undefined,
    totalAttack: 5,
    totalDefense: 12,
    equipItem: _createCallableStub(),
    unequipItem: _createCallableStub(),
    reset: _createCallableStub(),
  }),
  gameModeService: Object.assign(_createServiceStub(), {
    currentMode: 'EXPLORE',
    setMode: _createCallableStub(),
    reset: _createCallableStub(),
  }),
  getItemDefinition: mock((itemId: string) => ({
    label: itemId,
    attackBonus: 0,
    defenseBonus: 0,
    equippable: false,
    slot: undefined,
  })),
  imageGenerationService: _createServiceStub(),
  ImageGenerationService: class {},
  notificationService: _createServiceStub(),
  NotificationService: class {},
  npcService: _createServiceStub(),
  NpcService: class {},
  onboardingService: _createServiceStub(),
  personaService: _createServiceStub(),
  preferenceService: _createServiceStub(),
  // biome-ignore lint/complexity/noStaticOnlyClass: stub class for barrel mock
  PreferenceService: class {
    static create() {
      return {};
    }
  },
  aiSettingsService: _createServiceStub(),
  AISettingsService: class {},
  storageService: _createServiceStub(),
  StorageService: class {},
  userService: _createServiceStub(),
  UserService: class {},
  routerService: _createServiceStub(),
  pixiTextureInjector: _createServiceStub(),
  gameOverlayService: _createServiceStub(),
  GameOverlayService: class {},
  gameEngineService: _createServiceStub(),
  GameEngineService: class {},
  sessionService: Object.assign(_createServiceStub(), {
    activeSession: null,
    chatLocked: false,
    sessions: [],
    latestSummary: null,
    showAutoSummaryToast: false,
    isEndingSession: false,
    isStartingSession: false,
    reset: mock(async () => {}),
  }),
  SessionService: class {},
  campaignService: _createServiceStub(),
  capabilityService: Object.assign(_createServiceStub(), {
    detect: mock(async () => ({
      isComplete: true,
      textStatus: 'detected',
      imageStatus: 'detected',
      voiceStatus: 'detected',
      summary: 'Mock detection',
    })),
    detectText: mock(async () => 'detected'),
    detectImage: mock(async () => 'detected'),
    checkCloudTextConfig: mock(() => 'not_found'),
  }),
  gmPromptService: _createServiceStub(),
  messageBranchStore: _createServiceStub(),
  SentenceBoundaryChunker: class {},
  __esModule: true,
});

mock.module(_LOCAL_SVC_PATH, _localServicesMock);

// Also mock the bare specifier — Bun resolves $services via tsconfig paths
// before testing mock.module for bare specifiers.
mock.module('$services', _localServicesMock);

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

// ── Vite env vars required by @aikami/frontend/configs/environment.ts ─────

process.env.PUBLIC_APP_ID = 'client';
process.env.PUBLIC_MODE = 'testing';
process.env.PUBLIC_FIREBASE_API_KEY = 'mock-api-key';
process.env.PUBLIC_FIREBASE_AUTH_DOMAIN = 'mock.firebaseapp.com';
process.env.PUBLIC_FIREBASE_STORAGE_BUCKET = 'mock.appspot.com';
process.env.PUBLIC_FIREBASE_APP_ID = 'mock-app-id';
process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID = 'mock-sender-id';
process.env.PUBLIC_FIREBASE_MEASUREMENT_ID = 'mock-measurement-id';
process.env.PUBLIC_IMAGE_URL = 'http://localhost:8188';

// Ensure no OpenRouter API keys leak from the direnv environment.
// Testing mode should have no external API keys so ConfigService
// tests can assert empty apiKeys state.
delete process.env.PUBLIC_OPENROUTER_API_KEY;
delete process.env.PUBLIC_OPENROUTER_MODEL;
delete process.env.OPENROUTER_API_KEY;
delete process.env.PUBLIC_OLLAMA_MODEL;

// ── Mock @aikami/frontend/repositories (C-321: Turso persistence) ──────────
//
// Provides an in-memory LocalDatabaseInterface fake so that repository
// tests don't require a real SQLite connection.

/** In-memory row store for the fake database. */
const _fakeDbTables = new Map<string, Record<string, unknown>[]>();

const _getFakeTable = (name: string): Record<string, unknown>[] => {
  if (!_fakeDbTables.has(name)) {
    _fakeDbTables.set(name, []);
  }
  return _fakeDbTables.get(name)!;
};

const _fakeLocalDatabase = {
  async query(options: { sql: string; args: readonly unknown[] }) {
    const sql = options.sql.trim().toUpperCase();

    if (sql.includes('FROM META WHERE KEY')) {
      const rows = _getFakeTable('meta');
      const match = rows.find((r) => r.key === options.args[0]);
      return { rows: match ? [match] : [] };
    }

    // Handle SELECT ... FROM table WHERE col = ?
    const selectMatch = sql.match(
      /FROM\s+(\w+)\s*(?:WHERE\s+(\w+)\s*=\s*\?)?(?:\s*ORDER BY\s+(\w+)\s*(DESC|ASC)?)?/,
    );
    if (selectMatch) {
      const tableName = selectMatch[1]!.toLowerCase();
      const whereCol = selectMatch[2]?.toLowerCase();
      const orderCol = selectMatch[3]?.toLowerCase();
      const orderDir = selectMatch[4];
      let rows = _getFakeTable(tableName);
      if (whereCol) {
        rows = rows.filter((r) => r[whereCol] === options.args[0]);
      }
      if (orderCol) {
        rows = [...rows].sort((a, b) => {
          const aVal = String(a[orderCol] ?? '');
          const bVal = String(b[orderCol] ?? '');
          return orderDir === 'DESC' ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
        });
      }
      return { rows };
    }

    // Handle COUNT(*)
    if (sql.includes('COUNT(*)')) {
      const countMatch = sql.match(/FROM\s+(\w+)(?:\s+WHERE\s+(\w+)\s*=\s*\?)?/);
      if (countMatch) {
        const tableName = countMatch[1]!.toLowerCase();
        const whereCol = countMatch[2]?.toLowerCase();
        let rows = _getFakeTable(tableName);
        if (whereCol) {
          rows = rows.filter((r) => r[whereCol] === options.args[0]);
        }
        return { rows: [{ n: rows.length }] };
      }
    }

    return { rows: [] };
  },

  async execute(options: { sql: string; args: readonly unknown[] }) {
    const sql = options.sql.trim().toUpperCase();

    // INSERT OR REPLACE
    const insertMatch = sql.match(/INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/);
    if (insertMatch) {
      const tableName = insertMatch[1]!.toLowerCase();
      const columns = insertMatch[2]!.split(',').map((c) => c.trim().toLowerCase());
      const rows = _getFakeTable(tableName);
      const newRow: Record<string, unknown> = {};
      for (let i = 0; i < columns.length; i++) {
        newRow[columns[i]] = options.args[i];
      }
      // Replace by id if present
      const idIdx = columns.indexOf('id');
      if (idIdx >= 0) {
        const existingIdx = rows.findIndex((r) => r.id === options.args[idIdx]);
        if (existingIdx >= 0) {
          rows[existingIdx] = newRow;
        } else {
          rows.push(newRow);
        }
      } else {
        rows.push(newRow);
      }
      return;
    }

    // UPDATE
    const updateMatch = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(\w+)\s*=\s*\?/);
    if (updateMatch) {
      const tableName = updateMatch[1]!.toLowerCase();
      const whereCol = updateMatch[3]!.toLowerCase();
      const whereVal = options.args[options.args.length - 1];
      const rows = _getFakeTable(tableName);
      const row = rows.find((r) => r[whereCol] === whereVal);
      if (row) {
        const setPairs = updateMatch[2]!.split(',').map((s) => s.trim());
        let argIdx = 0;
        for (const pair of setPairs) {
          const eqIdx = pair.indexOf('=');
          if (eqIdx >= 0) {
            row[pair.substring(0, eqIdx).trim().toLowerCase()] = options.args[argIdx++];
          }
        }
      }
      return;
    }

    // DELETE
    const deleteMatch = sql.match(/FROM\s+(\w+)\s+WHERE\s+(\w+)\s*=\s*\?/);
    if (deleteMatch) {
      const tableName = deleteMatch[1]!.toLowerCase();
      const whereCol = deleteMatch[2]!.toLowerCase();
      const whereVal = options.args[0];
      const rows = _getFakeTable(tableName);
      const idx = rows.findIndex((r) => r[whereCol] === whereVal);
      if (idx >= 0) {
        rows.splice(idx, 1);
      }
    }
  },

  async transaction(queries: readonly { sql: string; args: readonly unknown[] }[]) {
    for (const query of queries) {
      if (query.sql.includes('?, ?, ?, ?, ?)') && query.args.length < 5) {
        throw new Error('SQL error: wrong number of arguments');
      }
      await this.execute(query);
    }
  },

  async sync() {},
  async close() {},

  _reset() {
    _fakeDbTables.clear();
  },
};

mock.module('@aikami/frontend/repositories', () => ({
  getLocalDatabase: mock(async () => _fakeLocalDatabase),
  closeLocalDatabase: mock(async () => {}),
  resetLocalDatabase: mock(() => {
    _fakeDbTables.clear();
  }),
  __esModule: true,
}));
