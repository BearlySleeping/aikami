// apps/frontend/client/src/lib/views/start/start_view_model.test.ts
// Contract: C-323 AC-3 (start menu routes to capability screen instead of dialog)
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
let fetchSavesResult: Array<{
  id: string;
  timestamp: number;
  mapName: string;
  campaignId?: string;
}> = [];
let routeCalls: Array<{
  route: string;
  options?: { queryParameters?: Record<string, string>; pathParameters?: unknown };
}> = [];

// ---------------------------------------------------------------------------
// Import the stub barrel (preloaded mock) so we can mutate service methods.
// These are the same Proxy stubs that test_preload installed globally.
// ---------------------------------------------------------------------------

import * as _svcStubs from '$services';

// ---------------------------------------------------------------------------
// Mock GameOverlayService to break ecs_worker dependency chain
// ---------------------------------------------------------------------------

let mockSessionMarkerCampaignId: string | undefined;

const mockCheckSessionMarker = mock(async () => mockSessionMarkerCampaignId);
const mockClearSessionMarker = mock(async () => {});

mock.module('$lib/services/game/game_overlay_service.svelte', () => ({
  // biome-ignore lint/style/useNamingConvention: must match module export name
  GameOverlayService: {
    checkSessionMarker: mockCheckSessionMarker,
    clearSessionMarker: mockClearSessionMarker,
  },
  gameOverlayService: {},
}));

const _setupServiceOverrides = (): void => {
  // ── gameStateService.reset ────────────────────────────────────────────
  (_svcStubs.gameStateService as Record<string, unknown>).reset = mock(() => {
    resetCalls++;
  });

  // ── gameSaveService ───────────────────────────────────────────────────
  // fetchAvailableSaves populates the availableSaves getter
  (_svcStubs.gameSaveService as Record<string, unknown>).fetchAvailableSaves = mock(async () => {
    // The getter below returns fetchSavesResult — the real service
    // would populate this from local DB; we simulate it inline.
  });

  Object.defineProperty(_svcStubs.gameSaveService, 'availableSaves', {
    get: () => fetchSavesResult,
    configurable: true,
  });

  // ── campaignService ──────────────────────────────────────────────────
  (_svcStubs.campaignService as Record<string, unknown>).loadCampaign = mock(async () => ({
    id: 'camp-1',
    state: 'playing',
  }));

  // ── routerService ─────────────────────────────────────────────────────
  (_svcStubs.routerService as Record<string, unknown>).goToRoute = mock(
    async (
      route: string,
      options?: { queryParameters?: Record<string, string>; pathParameters?: unknown },
    ) => {
      routeCalls.push({ route, options });
    },
  );

  // ── aiGatewayService.resolveMode — mock text resolution ──
  (_svcStubs.aiGatewayService as Record<string, unknown>).resolveMode = mock(() => {
    // Default: no-op (succeeds), overridden in individual tests
  });

  // ── aiSettingsService.textProvider — ensure it returns a configured key ──
  Object.defineProperty(_svcStubs.aiSettingsService, 'textProvider', {
    get: () => ({ apiKey: 'test-key', endpoint: '', model: '' }),
    configurable: true,
  });
};

// ---------------------------------------------------------------------------
// Mock persona_repository (pre-existing Bun resolution issue for .svelte → .svelte.ts)
// ---------------------------------------------------------------------------

mock.module('$lib/services/persona/persona_repository.svelte', () => ({
  personaService: {
    setActivePersona: mock(async () => {}),
  },
}));

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
    availableSaves: Array<{ id: string; timestamp: number; mapName: string; campaignId?: string }>;
    errorMessage: string | undefined;
    showRecoveryPrompt: boolean;
    recoveryCampaignId: string | undefined;
    isRecovering: boolean;
    initialize(): Promise<void>;
    startNewGame(): Promise<void>;
    continueGame(): Promise<void>;
    acceptRecovery(): Promise<void>;
    declineRecovery(): Promise<void>;
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StartViewModel', () => {
  beforeEach(() => {
    resetCalls = 0;
    fetchSavesResult = [];
    routeCalls = [];
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
        { id: 'manual-1', timestamp: 2000, mapName: 'Plains', campaignId: 'camp-1' },
        { id: 'auto-save', timestamp: 1000, mapName: 'Town', campaignId: 'camp-1' },
      ];
      vm.hasSaves = true;

      await vm.continueGame();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('game');
    });

    test('navigates to /game with most recent save campaign', async () => {
      const vm = createViewModel();
      vm.availableSaves = [
        { id: 'auto-save', timestamp: 1000, mapName: 'Town', campaignId: 'camp-1' },
      ];
      vm.hasSaves = true;

      await vm.continueGame();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('game');
    });

    test('warns and does not route when no saves exist', async () => {
      const vm = createViewModel();
      vm.availableSaves = [];
      vm.hasSaves = false;

      await vm.continueGame();

      expect(routeCalls).toHaveLength(0);
    });

    test('sets error message when campaignService.loadCampaign throws', async () => {
      const vm = createViewModel();
      vm.availableSaves = [
        { id: 'corrupt-save', timestamp: 1000, mapName: 'Void', campaignId: 'camp-1' },
      ];
      vm.hasSaves = true;

      // Override campaignService.loadCampaign to throw
      (_svcStubs.campaignService as Record<string, unknown>).loadCampaign = mock(async () => {
        throw new Error('Campaign not found');
      });

      await vm.continueGame();

      expect(routeCalls).toHaveLength(0);
      expect(vm.errorMessage).toBe('Failed to load save. Try starting a new game.');
    });
  });

  // ── AC-3: Routes to capability screen when text provider unresolved ──

  test('startNewGame routes to /capability when gateway resolveMode fails', async () => {
    const vm = createViewModel();

    // Make gateway resolution fail
    (_svcStubs.aiGatewayService as Record<string, unknown>).resolveMode = mock(() => {
      throw new Error('No text generation provider configured.');
    });

    await vm.startNewGame();

    expect(routeCalls).toHaveLength(1);
    expect(routeCalls[0].route).toBe('capability');
    expect(routeCalls[0].options?.queryParameters?.reason).toBe('text-required');
  });

  test('continueGame routes to /capability when gateway resolveMode fails', async () => {
    const vm = createViewModel();
    vm.availableSaves = [
      { id: 'auto-save', timestamp: 1000, mapName: 'Town', campaignId: 'camp-1' },
    ];
    vm.hasSaves = true;

    // Make gateway resolution fail
    (_svcStubs.aiGatewayService as Record<string, unknown>).resolveMode = mock(() => {
      throw new Error('No text generation provider configured.');
    });

    await vm.continueGame();

    expect(routeCalls).toHaveLength(1);
    expect(routeCalls[0].route).toBe('capability');
    expect(routeCalls[0].options?.queryParameters?.reason).toBe('text-required');
  });

  test('startNewGame routes to /setup when gateway resolves successfully', async () => {
    const vm = createViewModel();

    // Gateway resolves successfully (default mock returns undefined, which is fine)
    (_svcStubs.aiGatewayService as Record<string, unknown>).resolveMode = mock(() => ({
      capability: 'text',
      mode: 'offline',
      provider: 'ollama',
      model: 'llama3',
    }));

    await vm.startNewGame();

    expect(routeCalls).toHaveLength(1);
    expect(routeCalls[0].route).toBe('setup');
  });

  // ── AC-5: Crash Recovery ────────────────────────────────────────────

  describe('AC-5 Crash Recovery', () => {
    test('initialize() shows recovery prompt when session marker exists', async () => {
      mockSessionMarkerCampaignId = 'camp-crash-1';
      const vm = createViewModel();

      await vm.initialize();

      expect(vm.showRecoveryPrompt).toBe(true);
      expect(vm.recoveryCampaignId).toBe('camp-crash-1');
    });

    test('initialize() does not show recovery prompt when no session marker', async () => {
      mockSessionMarkerCampaignId = undefined;
      const vm = createViewModel();

      await vm.initialize();

      expect(vm.showRecoveryPrompt).toBe(false);
      expect(vm.recoveryCampaignId).toBeUndefined();
    });

    test('acceptRecovery() loads latest save and routes to /game', async () => {
      mockSessionMarkerCampaignId = 'camp-crash-1';
      fetchSavesResult = [
        { id: 'auto-save', timestamp: Date.now(), mapName: 'CrashMap', campaignId: 'camp-crash-1' },
      ];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.showRecoveryPrompt).toBe(true);
      await vm.acceptRecovery();

      expect(mockClearSessionMarker).toHaveBeenCalled();
      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('game');
      expect(vm.showRecoveryPrompt).toBe(false);
    });

    test('acceptRecovery() handles no saves gracefully', async () => {
      mockSessionMarkerCampaignId = 'camp-crash-empty';
      fetchSavesResult = [];
      const vm = createViewModel();
      await vm.initialize();

      await vm.acceptRecovery();

      expect(mockClearSessionMarker).toHaveBeenCalled();
      expect(routeCalls).toHaveLength(0);
      expect(vm.showRecoveryPrompt).toBe(false);
    });

    test('declineRecovery() clears session marker silently', async () => {
      mockSessionMarkerCampaignId = 'camp-crash-1';
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.showRecoveryPrompt).toBe(true);

      await vm.declineRecovery();

      expect(mockClearSessionMarker).toHaveBeenCalled();
      expect(vm.showRecoveryPrompt).toBe(false);
      expect(vm.recoveryCampaignId).toBeUndefined();
    });
  });

  // ── AC-1/3: initialize() checks for existing saves ────────────────────

  describe('initialize()', () => {
    test('sets hasSaves=true when saves are found', async () => {
      fetchSavesResult = [
        { id: 'auto-save', timestamp: Date.now(), mapName: 'Town', campaignId: 'camp-1' },
      ];
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

  // ── C-345 Pack Browser ────────────────────────────────────────────────

  describe('pack browser', () => {
    test.todo('openPackBrowser loads packs and shows browser when multiple packs available');
    test.todo('openPackBrowser skips browser when only one pack available');
    test.todo('closePackBrowser hides the browser and clears selection');
    test.todo('selectPack updates selectedPackId');
    test.todo('confirmPackSelection hides browser and proceeds with selected pack');
    test.todo('confirmPackSelection with 1 character routes directly to /game');
    test.todo('confirmPackSelection with 0 characters routes to /setup');
    test.todo('confirmPackSelection with 2+ characters routes to /characters');
  });
});
