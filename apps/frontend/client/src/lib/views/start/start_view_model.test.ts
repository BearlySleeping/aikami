// apps/frontend/client/src/lib/views/start/start_view_model.test.ts
import { beforeEach, describe, expect, mock, test } from 'bun:test';

// $state and $derived are polyfilled globally via test_preload.ts.
//
// Re-mock $app/navigation and $app/state here so that when the $services
// barrel (reached transitively from StartViewModel) tries to import
// onboarding.svelte.ts, Bun can resolve these SvelteKit virtual modules.
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

// The test_preload.ts provides a comprehensive barrel mock with Proxy-based
// stubs for all $services. We mutate the specific service stubs that
// StartViewModel interacts with before each test instead of replacing
// the entire module.

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

let resetCalls = 0;
let fetchSavesResult: Array<{ id: string; timestamp: number; mapName: string }> = [];
let getSavePayloadResult: string | undefined;
let getSavePayloadError: Error | undefined;
let routeCalls: Array<{ route: string }> = [];
let pendingPayload: string | undefined;

// ---------------------------------------------------------------------------
// Import the stub barrel (preloaded mock) so we can mutate service methods.
// These are the same Proxy stubs that test_preload installed globally.
// ---------------------------------------------------------------------------

import * as _svcStubs from '$services';

const _setupServiceOverrides = (): void => {
  // ── gameStateService.reset ────────────────────────────────────────────
  (_svcStubs.gameStateService as Record<string, unknown>).reset = mock(() => {
    resetCalls++;
  });

  // ── gameSaveService ───────────────────────────────────────────────────
  // fetchAvailableSaves populates the availableSaves getter
  (_svcStubs.gameSaveService as Record<string, unknown>).fetchAvailableSaves = mock(async () => {
    // The getter below returns fetchSavesResult — the real service
    // would populate this from IndexedDB; we simulate it inline.
  });

  Object.defineProperty(_svcStubs.gameSaveService, 'availableSaves', {
    get: () => fetchSavesResult,
    configurable: true,
  });

  (_svcStubs.gameSaveService as Record<string, unknown>).getSavePayload = mock(
    async (_slotId: string) => {
      if (getSavePayloadError) {
        throw getSavePayloadError;
      }
      return getSavePayloadResult ?? '';
    },
  );

  // ── routerService ─────────────────────────────────────────────────────
  (_svcStubs.routerService as Record<string, unknown>).goToRoute = mock(async (route: string) => {
    routeCalls.push({ route });
  });

  // ── setPendingGameLoad ───────────────────────────────────────────────
  (_svcStubs as Record<string, unknown>).setPendingGameLoad = mock((payload: string) => {
    pendingPayload = payload;
  });

  // ── aiSettingsService.textProvider — ensure it returns a configured key ──
  Object.defineProperty(_svcStubs.aiSettingsService, 'textProvider', {
    get: () => ({ apiKey: 'test-key', endpoint: '', model: '' }),
    configurable: true,
  });
};

// ---------------------------------------------------------------------------
// Import StartViewModel AFTER mocks are configured
// ---------------------------------------------------------------------------

const { getStartViewModel } = await import('./start_view_model.svelte.ts');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createViewModel = () => {
  const vm = getStartViewModel({ className: 'StartViewModel' });
  return vm as unknown as {
    hasSaves: boolean;
    availableSaves: Array<{ id: string; timestamp: number; mapName: string }>;
    errorMessage: string | undefined;
    initialize(): Promise<void>;
    startNewGame(): Promise<void>;
    continueGame(): Promise<void>;
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StartViewModel', () => {
  beforeEach(() => {
    resetCalls = 0;
    fetchSavesResult = [];
    getSavePayloadResult = undefined;
    getSavePayloadError = undefined;
    routeCalls = [];
    pendingPayload = undefined;
    _setupServiceOverrides();
  });

  // ── AC-1: New Game routes to /setup ──────────────────────────────────

  describe('startNewGame()', () => {
    test('routes to /setup', async () => {
      const vm = createViewModel();

      await vm.startNewGame();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('setup');
    });

    test('calls gameStateService.reset() to clear stale state', async () => {
      const vm = createViewModel();

      await vm.startNewGame();

      expect(resetCalls).toBe(1);
    });
  });

  // ── AC-3: Continue loads save and routes to /game ────────────────────

  describe('continueGame()', () => {
    test('loads the most recent save and routes to /game', async () => {
      const vm = createViewModel();
      vm.availableSaves = [
        { id: 'manual-1', timestamp: 2000, mapName: 'Plains' },
        { id: 'auto-save', timestamp: 1000, mapName: 'Town' },
      ];
      vm.hasSaves = true;
      getSavePayloadResult = '{"entities":[],"components":{}}';

      await vm.continueGame();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('game');
      expect(pendingPayload).toBe('{"entities":[],"components":{}}');
    });

    test('sets pending game load payload before navigating', async () => {
      const vm = createViewModel();
      vm.availableSaves = [{ id: 'auto-save', timestamp: 1000, mapName: 'Town' }];
      vm.hasSaves = true;
      getSavePayloadResult = 'snapshot-data';

      await vm.continueGame();

      expect(pendingPayload).toBe('snapshot-data');
      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('game');
    });

    test('warns and does not route when no saves exist', async () => {
      const vm = createViewModel();
      vm.availableSaves = [];
      vm.hasSaves = false;

      await vm.continueGame();

      expect(routeCalls).toHaveLength(0);
      expect(pendingPayload).toBeUndefined();
    });

    test('sets error message when getSavePayload throws', async () => {
      const vm = createViewModel();
      vm.availableSaves = [{ id: 'corrupt-save', timestamp: 1000, mapName: 'Void' }];
      vm.hasSaves = true;
      getSavePayloadError = new Error('IndexedDB not available');

      await vm.continueGame();

      expect(routeCalls).toHaveLength(0);
      expect(vm.errorMessage).toBe('Failed to load save. Try starting a new game.');
    });
  });

  // ── AC-1/3: initialize() checks for existing saves ────────────────────

  describe('initialize()', () => {
    test('sets hasSaves=true when saves are found', async () => {
      fetchSavesResult = [{ id: 'auto-save', timestamp: Date.now(), mapName: 'Town' }];
      const vm = createViewModel();

      await vm.initialize();

      expect(vm.hasSaves).toBe(true);
      expect(vm.availableSaves).toHaveLength(1);
    });

    test('sets hasSaves=false when no saves exist', async () => {
      fetchSavesResult = [];
      const vm = createViewModel();

      await vm.initialize();

      expect(vm.hasSaves).toBe(false);
      expect(vm.availableSaves).toHaveLength(0);
    });

    test('handles empty IndexedDB gracefully', async () => {
      fetchSavesResult = [];
      const vm = createViewModel();

      await vm.initialize();

      expect(vm.hasSaves).toBe(false);
      expect(vm.errorMessage).toBeUndefined(); // graceful degradation
    });
  });
});
