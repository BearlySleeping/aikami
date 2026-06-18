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
 * instead of trying to reassign `setPendingGameLoad = newMock` on the
 * frozen module namespace.
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
  SentenceBoundaryChunker: class {},
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
  characterCreationService: _createServiceStub(),
  CharacterCreationService: class {},
  characterService: _createServiceStub(),
  CharacterService: class {},
  characterTextStreamService: _createServiceStub(),
  CharacterTextStreamService: class {},
  chatService: _createServiceStub(),
  contextBuilder: _createServiceStub(),
  conversationRepository: _createServiceStub(),
  npcChatService: _createServiceStub(),
  configService: _createServiceStub(),
  ConfigService: class {},
  diceService: _createServiceStub(),
  DiceService: class {},
  ExpressionAssetResolver: class {},
  setPendingGameLoad: _createCallableStub(),
  consumePendingGameLoad: _createCallableStub(),
  gameSaveService: _createServiceStub(),
  GameSaveService: class {},
  gameStateService: _createServiceStub(),
  GameStateService: class {},
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
  __esModule: true,
});

mock.module(_LOCAL_SVC_PATH, _localServicesMock);

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
process.env.PUBLIC_MODE = 'emulator';
process.env.PUBLIC_FIREBASE_API_KEY = 'mock-api-key';
process.env.PUBLIC_FIREBASE_AUTH_DOMAIN = 'mock.firebaseapp.com';
process.env.PUBLIC_FIREBASE_STORAGE_BUCKET = 'mock.appspot.com';
process.env.PUBLIC_FIREBASE_APP_ID = 'mock-app-id';
process.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID = 'mock-sender-id';
process.env.PUBLIC_FIREBASE_MEASUREMENT_ID = 'mock-measurement-id';
process.env.PUBLIC_IMAGE_URL = 'http://localhost:8188';
