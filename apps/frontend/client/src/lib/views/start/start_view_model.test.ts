// apps/frontend/client/src/lib/views/start/start_view_model.test.ts
// Contract: C-323 AC-3 (start menu routes to capability screen instead of dialog)
// Contract: C-345 (pack browser) — wired into startNewGame by C-405
// Contract: C-405 AC-1/AC-2/AC-3 (default path skips world generation)
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

type MockPack = {
  id: string;
  name: string;
  description: string;
  version: string;
  updatedAt: string;
};

let mockAvailablePacks: MockPack[] = [];

const PACK_EMBERWATCH: MockPack = {
  id: 'emberwatch',
  name: 'Emberwatch: The Fading Ward',
  description: 'The wardstone that protects Emberwatch Village is failing.',
  version: '2.1.0',
  updatedAt: '2026-07-13T00:00:00.000Z',
};

// Generic second pack used to exercise multi-pack (browser) behavior.
const PACK_SECOND: MockPack = {
  id: 'stormreach',
  name: 'Stormreach',
  description: 'A coastal fortress under siege by a rising tide of nightmares.',
  version: '1.0.0',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Import the stub barrel (preloaded mock) so we can mutate service methods.
// These are the same Proxy stubs that test_preload installed globally.
// ---------------------------------------------------------------------------

import * as _svcStubs from '$services';

// ---------------------------------------------------------------------------
// Mock GameOverlayService to break ecs_worker dependency chain
// ---------------------------------------------------------------------------

let mockSessionMarkerCampaignId: string | undefined;
let mockClearSessionMarkerCalls = 0;

const _setupServiceOverrides = (): void => {
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

  // Fresh mock each test so `.mock.calls` assertions are scoped to this test.
  (_svcStubs.campaignService as Record<string, unknown>).startNewCampaign = mock(async () => ({
    id: 'camp-new',
    state: 'creating',
  }));
  (_svcStubs.campaignService as Record<string, unknown>).completeSetup = mock(() => {});

  // ── routerService ─────────────────────────────────────────────────────
  (_svcStubs.routerService as Record<string, unknown>).goToRoute = mock(
    async (
      route: string,
      options?: { queryParameters?: Record<string, string>; pathParameters?: unknown },
    ) => {
      routeCalls.push({ route, options });
    },
  );

  // ── gameOverlayService — crash recovery stubs ──
  (_svcStubs.gameOverlayService as Record<string, unknown>).checkSessionMarker = mock(
    async () => mockSessionMarkerCampaignId,
  );
  (_svcStubs.gameOverlayService as Record<string, unknown>).clearSessionMarker = mock(async () => {
    mockClearSessionMarkerCalls++;
  });

  // ── aiGatewayService.resolveMode — mock text resolution ──
  (_svcStubs.aiGatewayService as Record<string, unknown>).resolveMode = mock(() => {
    // Default: no-op (succeeds), overridden in individual tests
  });

  // ── aiSettingsService.textProvider — ensure it returns a configured key ──
  Object.defineProperty(_svcStubs.aiSettingsService, 'textProvider', {
    get: () => ({ apiKey: 'test-key', endpoint: '', model: '' }),
    configurable: true,
  });

  // ── packRegistryService (C-345 / C-405) ────────────────────────────────
  (_svcStubs.packRegistryService as Record<string, unknown>).refresh = mock(async () => {
    // The getter below returns mockAvailablePacks — the real service would
    // populate this from /content-packs/index.json.
  });

  Object.defineProperty(_svcStubs.packRegistryService, 'availablePacks', {
    get: () => mockAvailablePacks,
    configurable: true,
  });
};

// ---------------------------------------------------------------------------
// Mock persona_service (Bun resolution for .svelte → .svelte.ts)
// ---------------------------------------------------------------------------

mock.module('$lib/services/persona/persona_service.svelte', () => ({
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
    showPackBrowser: boolean;
    selectedPackId: string | undefined;
    initialize(): Promise<void>;
    startNewGame(): Promise<void>;
    startWorldGeneration(): Promise<void>;
    continueGame(): Promise<void>;
    acceptRecovery(): Promise<void>;
    declineRecovery(): Promise<void>;
    openPackBrowser(): Promise<void>;
    closePackBrowser(): void;
    selectPack(packId: string): void;
    confirmPackSelection(): Promise<void>;
  };
};

/** Sets the stored characters in localStorage for the character-count branch. */
const setCharacters = (count: number): void => {
  if (count === 0) {
    localStorage.removeItem('aikami-characters');
    return;
  }
  const characters = Array.from({ length: count }, (_, i) => ({
    persona: { id: `persona-${i}` },
  }));
  localStorage.setItem('aikami-characters', JSON.stringify(characters));
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StartViewModel', () => {
  beforeEach(() => {
    mockClearSessionMarkerCalls = 0;
    fetchSavesResult = [];
    routeCalls = [];
    mockAvailablePacks = [];
    localStorage.clear();
    _setupServiceOverrides();
  });

  // ── C-405 AC-1: New Game routes to persona creation (onboarding) ──────

  // ── New Game: routes to the capability screen ──────────────────────────

  describe('startNewGame()', () => {
    test('routes to /capability', async () => {
      const vm = createViewModel();

      await vm.startNewGame();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('capability');
    });

    test('does not open the pack browser', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH, PACK_SECOND];
      const vm = createViewModel();

      await vm.startNewGame();

      expect(vm.showPackBrowser).toBe(false);
      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('capability');
    });
  });

  // ── C-405 AC-2: all three character-count branches reach a playable path ──

  describe('NewCampaignDestination (AC-2)', () => {
    test('zero characters → persona creation (onboarding)', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH];
      setCharacters(0);
      const vm = createViewModel();

      await vm.openPackBrowser();

      expect(routeCalls[0].route).toBe('personaCreate');
      expect(routeCalls[0].options?.queryParameters).toEqual({ onboarding: '1' });
    });

    test('one character → /game directly', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH];
      setCharacters(1);
      const vm = createViewModel();

      await vm.openPackBrowser();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('game');
    });

    test('two characters → persona picker (/personas)', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH];
      setCharacters(2);
      const vm = createViewModel();

      await vm.openPackBrowser();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('personas');
    });

    test('confirmPackSelection carries the selected pack into the branch', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH, PACK_SECOND];
      setCharacters(0);
      const vm = createViewModel();

      await vm.openPackBrowser();
      vm.selectPack('stormreach');
      await vm.confirmPackSelection();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('personaCreate');
      expect(routeCalls[0].options?.queryParameters).toEqual({ onboarding: '1' });
      expect(
        (_svcStubs.campaignService.startNewCampaign as ReturnType<typeof mock>).mock.calls[0]?.[0],
      ).toEqual({ contentPackId: 'stormreach' });
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

  // ── AC-3: starts new game regardless of AI gate ──

  test('startNewGame routes to /capability even when gateway resolveMode would fail', async () => {
    const vm = createViewModel();

    // Even when gateway resolution would fail, startNewGame proceeds to the
    // capability screen (which handles provider setup).
    (_svcStubs.aiGatewayService as Record<string, unknown>).resolveMode = mock(() => {
      throw new Error('No text generation provider configured.');
    });

    await vm.startNewGame();

    expect(routeCalls).toHaveLength(1);
    expect(routeCalls[0].route).toBe('capability');
  });

  test('continueGame succeeds even when gateway resolveMode would fail', async () => {
    const vm = createViewModel();
    vm.availableSaves = [
      { id: 'auto-save', timestamp: 1000, mapName: 'Town', campaignId: 'camp-1' },
    ];
    vm.hasSaves = true;

    // Even when gateway resolution would fail, continueGame proceeds
    (_svcStubs.aiGatewayService as Record<string, unknown>).resolveMode = mock(() => {
      throw new Error('No text generation provider configured.');
    });

    await vm.continueGame();

    // Should route to /game, not /capability
    expect(routeCalls).toHaveLength(1);
    expect(routeCalls[0].route).toBe('game');
  });

  test('startNewGame routes to /capability when gateway resolves successfully', async () => {
    const vm = createViewModel();

    // Gateway resolves successfully
    (_svcStubs.aiGatewayService as Record<string, unknown>).resolveMode = mock(() => ({
      capability: 'text',
      mode: 'offline',
      provider: 'ollama',
      model: 'llama3',
    }));

    await vm.startNewGame();

    expect(routeCalls).toHaveLength(1);
    expect(routeCalls[0].route).toBe('capability');
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

      expect(mockClearSessionMarkerCalls).toBeGreaterThanOrEqual(1);
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

      expect(mockClearSessionMarkerCalls).toBeGreaterThanOrEqual(1);
      expect(routeCalls).toHaveLength(0);
      expect(vm.showRecoveryPrompt).toBe(false);
    });

    test('declineRecovery() clears session marker silently', async () => {
      mockSessionMarkerCampaignId = 'camp-crash-1';
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.showRecoveryPrompt).toBe(true);

      await vm.declineRecovery();

      expect(mockClearSessionMarkerCalls).toBeGreaterThanOrEqual(1);
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

  // ── C-345 Pack Browser (wired by C-405 AC-3) ───────────────────────────

  describe('pack browser', () => {
    test('openPackBrowser loads packs and shows browser when multiple packs available', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH, PACK_SECOND];
      const vm = createViewModel();

      await vm.openPackBrowser();

      expect(vm.showPackBrowser).toBe(true);
      expect(vm.selectedPackId).toBe('emberwatch');
      expect(routeCalls).toHaveLength(0);
    });

    test('openPackBrowser skips browser when only one pack available', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH];
      const vm = createViewModel();

      await vm.openPackBrowser();

      expect(vm.showPackBrowser).toBe(false);
      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('personaCreate');
    });

    test('closePackBrowser hides the browser and clears selection', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH, PACK_SECOND];
      const vm = createViewModel();
      await vm.openPackBrowser();
      expect(vm.showPackBrowser).toBe(true);

      vm.closePackBrowser();

      expect(vm.showPackBrowser).toBe(false);
      expect(vm.selectedPackId).toBeUndefined();
      expect(routeCalls).toHaveLength(0);
    });

    test('selectPack updates selectedPackId', async () => {
      const vm = createViewModel();
      vm.selectPack('stormreach');
      expect(vm.selectedPackId).toBe('stormreach');
    });

    test('confirmPackSelection hides browser and proceeds with selected pack', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH, PACK_SECOND];
      const vm = createViewModel();
      await vm.openPackBrowser();
      vm.selectPack('stormreach');

      await vm.confirmPackSelection();

      expect(vm.showPackBrowser).toBe(false);
      expect(vm.selectedPackId).toBeUndefined();
      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('personaCreate');
    });

    test('confirmPackSelection with 1 character routes directly to /game', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH, PACK_SECOND];
      setCharacters(1);
      const vm = createViewModel();
      await vm.openPackBrowser();
      vm.selectPack('stormreach');

      await vm.confirmPackSelection();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('game');
    });

    test('confirmPackSelection with 0 characters routes to persona creation', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH, PACK_SECOND];
      setCharacters(0);
      const vm = createViewModel();
      await vm.openPackBrowser();

      await vm.confirmPackSelection();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('personaCreate');
      expect(routeCalls[0].options?.queryParameters).toEqual({ onboarding: '1' });
    });

    test('confirmPackSelection with 2+ characters routes to /personas', async () => {
      mockAvailablePacks = [PACK_EMBERWATCH, PACK_SECOND];
      setCharacters(2);
      const vm = createViewModel();
      await vm.openPackBrowser();

      await vm.confirmPackSelection();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('personas');
    });

    test('confirmPackSelection with no selection is a no-op', async () => {
      const vm = createViewModel();
      await vm.confirmPackSelection();
      expect(routeCalls).toHaveLength(0);
    });

    test('startWorldGeneration routes to the worldgen preview', async () => {
      const vm = createViewModel();

      await vm.startWorldGeneration();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('worldgen');
    });

    test('openPackBrowser falls back to emberwatch when no packs are installed', async () => {
      mockAvailablePacks = [];
      setCharacters(0);
      const vm = createViewModel();

      await vm.openPackBrowser();

      expect(vm.showPackBrowser).toBe(false);
      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('personaCreate');
      expect(routeCalls[0].options?.queryParameters).toEqual({ onboarding: '1' });
      expect(
        (_svcStubs.campaignService.startNewCampaign as ReturnType<typeof mock>).mock.calls[0]?.[0],
      ).toEqual({ contentPackId: 'emberwatch' });
    });
  });
});
