// apps/frontend/client/src/lib/views/start/start_view_model.test.ts
// Contract: C-317 Rebuild the Start Menu Around Campaigns, Not Personas
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

/** Mock campaign shape for tests. */
type MockCampaign = {
  id: string;
  name: string;
  state: string;
  contentPackId: string;
  lastSavedAt?: string;
  capabilityProfile: {
    textProvider: boolean;
    imageProvider: boolean;
    voiceProvider: boolean;
  };
  createdAt: string;
  updatedAt: string;
};

let mockCampaigns: MockCampaign[] = [];
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
let newAdventureCalls: string[] = [];

const PACK_EMBERWATCH: MockPack = {
  id: 'emberwatch',
  name: 'Emberwatch: The Fading Ward',
  description: 'The wardstone that protects Emberwatch Village is failing.',
  version: '2.1.0',
  updatedAt: '2026-07-13T00:00:00.000Z',
};

const PACK_SECOND: MockPack = {
  id: 'stormreach',
  name: 'Stormreach',
  description: 'A coastal fortress under siege by a rising tide of nightmares.',
  version: '1.0.0',
  updatedAt: '2026-07-20T00:00:00.000Z',
};

/** Creates a mock campaign with sensible defaults. */
const makeCampaign = (overrides: Partial<MockCampaign> = {}): MockCampaign => ({
  id: 'camp-1',
  name: 'Emberwatch',
  state: 'playing',
  contentPackId: 'emberwatch',
  lastSavedAt: new Date().toISOString(),
  capabilityProfile: { textProvider: true, imageProvider: false, voiceProvider: false },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Import the stub barrel (preloaded mock) so we can mutate service methods.
// ---------------------------------------------------------------------------

import * as _svcStubs from '$services';

// ---------------------------------------------------------------------------
// Mock GameOverlayService to break ecs_worker dependency chain
// ---------------------------------------------------------------------------

let mockSessionMarkerCampaignId: string | undefined;
let mockClearSessionMarkerCalls = 0;

const _setupServiceOverrides = (): void => {
  // ── campaignService ──────────────────────────────────────────────────
  (_svcStubs.campaignService as Record<string, unknown>).refreshCampaigns = mock(async () => {
    // The getter below returns mockCampaigns
  });

  Object.defineProperty(_svcStubs.campaignService, 'campaigns', {
    get: () => mockCampaigns,
    configurable: true,
  });

  (_svcStubs.campaignService as Record<string, unknown>).loadCampaign = mock(
    async (options: { campaignId: string }) => {
      const found = mockCampaigns.find((c: MockCampaign) => c.id === options.campaignId);
      if (!found) {
        throw new Error(`Campaign not found: ${options.campaignId}`);
      }
      return { ...found, state: 'playing' };
    },
  );

  (_svcStubs.campaignService as Record<string, unknown>).startNewCampaign = mock(
    async (options?: { contentPackId?: string }) => {
      newAdventureCalls.push('start');
      return {
        id: 'camp-new',
        name: 'New Adventure',
        state: 'creating',
        contentPackId: options?.contentPackId ?? 'emberwatch',
        capabilityProfile: { textProvider: true, imageProvider: false, voiceProvider: false },
      };
    },
  );

  (_svcStubs.campaignService as Record<string, unknown>).getLatestCampaign = mock(() =>
    mockCampaigns.length > 0 ? mockCampaigns[0] : undefined,
  );

  (_svcStubs.campaignService as Record<string, unknown>).hasCampaigns = mock(
    () => mockCampaigns.length > 0,
  );

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
  (_svcStubs.gameOverlayService as Record<string, unknown>).saveGame = mock(async () => {
    newAdventureCalls.push('save');
  });

  // ── gameSaveService ──
  const mockSaves: Array<{ id: string; timestamp: number; mapName: string; campaignId?: string }> =
    [];
  (_svcStubs.gameSaveService as Record<string, unknown>).fetchAvailableSaves = mock(async () => {
    // Populated per-test by setting the getter
  });
  Object.defineProperty(_svcStubs.gameSaveService, 'availableSaves', {
    get: () => mockSaves,
    configurable: true,
  });

  // ── aiSettingsService.textProvider — ensure it returns a configured key ──
  Object.defineProperty(_svcStubs.aiSettingsService, 'textProvider', {
    get: () => ({ apiKey: 'test-key', endpoint: '', model: '' }),
    configurable: true,
  });

  // ── packRegistryService (C-345 / C-405) ────────────────────────────────
  (_svcStubs.packRegistryService as Record<string, unknown>).refresh = mock(async () => {});
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

import { AiTextProviderRequiredError } from '@aikami/utils';
import type { CampaignSummary } from './start_view_model.svelte';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createViewModel = () => {
  const vm = getStartViewModel({ className: 'StartViewModel' });
  return vm as unknown as {
    latestResumableCampaign: CampaignSummary | undefined;
    campaignSummaries: CampaignSummary[];
    showLoadCampaign: boolean;
    showNewAdventureConfirm: boolean;
    errorMessage: string | undefined;
    showRecoveryPrompt: boolean;
    recoveryCampaignId: string | undefined;
    isRecovering: boolean;
    showPackBrowser: boolean;
    selectedPackId: string | undefined;
    initialize(): Promise<void>;
    startNewAdventure(): Promise<void>;
    continueLatestCampaign(): Promise<void>;
    openLoadCampaign(): void;
    closeLoadCampaign(): void;
    loadCampaignById(campaignId: string): Promise<void>;
    confirmNewAdventure(): Promise<void>;
    cancelNewAdventure(): void;
    startWorldGeneration(): Promise<void>;
    acceptRecovery(): Promise<void>;
    declineRecovery(): Promise<void>;
    openPackBrowser(): Promise<void>;
    closePackBrowser(): void;
    selectPack(packId: string): void;
    confirmPackSelection(): Promise<void>;
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StartViewModel (C-317 Campaign-First)', () => {
  beforeEach(() => {
    mockClearSessionMarkerCalls = 0;
    mockCampaigns = [];
    routeCalls = [];
    mockAvailablePacks = [];
    newAdventureCalls = [];
    localStorage.clear();
    _setupServiceOverrides();
  });

  // ── AC-1: Continue Shows Only for Resumable Campaigns ────────────────

  describe('AC-1: Continue visibility', () => {
    test('shows Continue when a resumable campaign exists (playing)', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeDefined();
      expect(vm.latestResumableCampaign?.id).toBe('camp-1');
      expect(vm.latestResumableCampaign?.isResumable).toBe(true);
    });

    test('shows Continue when campaign is paused', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'paused' })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeDefined();
      expect(vm.latestResumableCampaign?.isResumable).toBe(true);
    });

    test('shows Continue when campaign is saving', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'saving' })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeDefined();
      expect(vm.latestResumableCampaign?.isResumable).toBe(true);
    });

    test('hides Continue when no campaigns exist', async () => {
      mockCampaigns = [];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeUndefined();
    });

    test('hides Continue when campaign is in failed state', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'failed' })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeUndefined();
    });

    test('hides Continue when campaign is in creating state', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'creating' })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeUndefined();
    });

    test('hides Continue when campaign is in loading state', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'loading' })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeUndefined();
    });

    test('shows latest resumable campaign when multiple campaigns exist', async () => {
      mockCampaigns = [
        makeCampaign({ id: 'camp-old', state: 'failed', name: 'Failed Campaign' }),
        makeCampaign({ id: 'camp-resumable', state: 'playing', name: 'Active Campaign' }),
        makeCampaign({ id: 'camp-new', state: 'creating', name: 'New Campaign' }),
      ];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeDefined();
      expect(vm.latestResumableCampaign?.id).toBe('camp-resumable');
    });

    test('continueLatestCampaign loads and routes to /game', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.continueLatestCampaign();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('game');
    });

    test('continueLatestCampaign does nothing when no resumable campaign', async () => {
      mockCampaigns = [];
      const vm = createViewModel();
      await vm.initialize();

      await vm.continueLatestCampaign();

      expect(routeCalls).toHaveLength(0);
    });

    test('continueLatestCampaign sets error when loadCampaign throws', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();

      // Override loadCampaign to throw
      (_svcStubs.campaignService as Record<string, unknown>).loadCampaign = mock(async () => {
        throw new Error('Campaign not found');
      });

      await vm.continueLatestCampaign();

      expect(routeCalls).toHaveLength(0);
      expect(vm.errorMessage).toBe('Failed to load campaign. Try starting a new adventure.');
    });
  });

  // ── AC-2: New Adventure Always Creates a Fresh Campaign Draft ────────

  describe('AC-2: New Adventure', () => {
    test('creates a fresh campaign and routes to personaCreate', async () => {
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('personaCreate');
      expect(routeCalls[0].options?.queryParameters).toEqual({ onboarding: '1' });
    });

    test('routes to capability screen when text provider is missing', async () => {
      const vm = createViewModel();
      await vm.initialize();

      // Override startNewCampaign to throw text-provider error
      (_svcStubs.campaignService as Record<string, unknown>).startNewCampaign = mock(async () => {
        throw new AiTextProviderRequiredError('Text provider required');
      });

      await vm.startNewAdventure();

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('capability');
    });

    test('routes directly when no campaigns exist', async () => {
      mockCampaigns = [];
      const vm = createViewModel();
      await vm.initialize();
      await vm.startNewAdventure();

      expect(routeCalls[0].route).toBe('personaCreate');
    });

    test('shows confirmation when one resumable campaign exists', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();
      await vm.startNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(true);
      expect(routeCalls).toHaveLength(0);
    });

    test('shows confirmation when three campaigns include a resumable campaign', async () => {
      mockCampaigns = [
        makeCampaign({ id: 'camp-1', state: 'failed' }),
        makeCampaign({ id: 'camp-2', state: 'playing' }),
        makeCampaign({ id: 'camp-3', state: 'creating' }),
      ];
      const vm = createViewModel();
      await vm.initialize();
      await vm.startNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(true);
      expect(routeCalls).toHaveLength(0);
    });
  });

  // ── AC-3: Load Campaign Shows All Campaigns as Summary Cards ─────────

  describe('AC-3: Load Campaign', () => {
    test('openLoadCampaign shows the modal', async () => {
      const vm = createViewModel();
      vm.openLoadCampaign();

      expect(vm.showLoadCampaign).toBe(true);
    });

    test('closeLoadCampaign hides the modal', async () => {
      const vm = createViewModel();
      vm.openLoadCampaign();
      expect(vm.showLoadCampaign).toBe(true);

      vm.closeLoadCampaign();
      expect(vm.showLoadCampaign).toBe(false);
    });

    test('campaignSummaries contains all campaigns sorted newest first', async () => {
      mockCampaigns = [
        makeCampaign({
          id: 'camp-1',
          name: 'First',
          state: 'playing',
          updatedAt: '2026-01-02T00:00:00.000Z',
        }),
        makeCampaign({
          id: 'camp-2',
          name: 'Second',
          state: 'failed',
          updatedAt: '2026-01-03T00:00:00.000Z',
        }),
        makeCampaign({
          id: 'camp-3',
          name: 'Third',
          state: 'creating',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }),
      ];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries).toHaveLength(3);
      expect(vm.campaignSummaries[0].id).toBe('camp-2');
      expect(vm.campaignSummaries[1].id).toBe('camp-1');
      expect(vm.campaignSummaries[2].id).toBe('camp-3');
    });

    test('campaign summary has correct content pack label', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', contentPackId: 'emberwatch' })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].contentPackLabel).toBe('Emberwatch: The Fading Ward');
    });

    test('campaign summary shows "Not yet saved" when never saved', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', lastSavedAt: undefined })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].lastSavedLabel).toBe('Not yet saved');
    });

    test('campaign summary shows "Not yet saved" for an invalid timestamp', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', lastSavedAt: 'invalid' })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].lastSavedLabel).toBe('Not yet saved');
    });

    test('campaign summary formats recent save times as relative labels', async () => {
      const now = Date.now();
      mockCampaigns = [
        makeCampaign({ id: 'just-now', lastSavedAt: new Date(now).toISOString() }),
        makeCampaign({ id: 'minutes', lastSavedAt: new Date(now - 5 * 60000).toISOString() }),
        makeCampaign({ id: 'hours', lastSavedAt: new Date(now - 3 * 3600000).toISOString() }),
        makeCampaign({ id: 'days', lastSavedAt: new Date(now - 2 * 86400000).toISOString() }),
      ];
      const vm = createViewModel();
      await vm.initialize();

      const labels = Object.fromEntries(
        vm.campaignSummaries.map((campaign) => [campaign.id, campaign.lastSavedLabel]),
      );
      expect(labels['just-now']).toBe('Just now');
      expect(labels.minutes).toBe('5m ago');
      expect(labels.hours).toBe('3h ago');
      expect(labels.days).toBe('2d ago');
    });

    test('campaign summary formats older save times as calendar dates', async () => {
      const now = new Date();
      const lastSavedAt = new Date(now.getFullYear() - 1, 0, 2);
      mockCampaigns = [makeCampaign({ id: 'camp-1', lastSavedAt: lastSavedAt.toISOString() })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].lastSavedLabel).toBe(
        lastSavedAt.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      );
    });

    test('campaign summary has correct isResumable for each state', async () => {
      mockCampaigns = [
        makeCampaign({ id: 'c1', state: 'playing' }),
        makeCampaign({ id: 'c2', state: 'paused' }),
        makeCampaign({ id: 'c3', state: 'saving' }),
        makeCampaign({ id: 'c4', state: 'failed' }),
        makeCampaign({ id: 'c5', state: 'creating' }),
        makeCampaign({ id: 'c6', state: 'loading' }),
      ];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].isResumable).toBe(true); // playing
      expect(vm.campaignSummaries[1].isResumable).toBe(true); // paused
      expect(vm.campaignSummaries[2].isResumable).toBe(true); // saving
      expect(vm.campaignSummaries[3].isResumable).toBe(false); // failed
      expect(vm.campaignSummaries[4].isResumable).toBe(false); // creating
      expect(vm.campaignSummaries[5].isResumable).toBe(false); // loading
    });

    test('loadCampaignById loads campaign and routes to /game', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.loadCampaignById('camp-1');

      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('game');
    });

    test('loadCampaignById sets error when campaign not found', async () => {
      const vm = createViewModel();
      await vm.initialize();

      await vm.loadCampaignById('nonexistent');

      expect(routeCalls).toHaveLength(0);
      expect(vm.errorMessage).toBe('Failed to load campaign.');
    });

    test('empty campaign list shows no campaigns', async () => {
      mockCampaigns = [];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries).toHaveLength(0);
    });
  });

  // ── AC-4: Destructive Confirmation Before Overwriting Active Campaign ─

  describe('AC-4: New Adventure confirmation', () => {
    test('shows confirmation dialog when resumable campaign exists', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(true);
      expect(routeCalls).toHaveLength(0); // Not routed yet
    });

    test('does NOT show confirmation when no resumable campaigns exist', async () => {
      mockCampaigns = [];
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(false);
      expect(routeCalls).toHaveLength(1); // Routed directly
    });

    test('confirmNewAdventure saves, creates campaign, and routes to personaCreate', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();
      expect(vm.showNewAdventureConfirm).toBe(true);

      await vm.confirmNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(false);
      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('personaCreate');
      expect(newAdventureCalls).toEqual(['save', 'start']);
    });

    test('cancelNewAdventure hides dialog without routing', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();
      expect(vm.showNewAdventureConfirm).toBe(true);

      vm.cancelNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(false);
      expect(routeCalls).toHaveLength(0);
    });
  });

  // ── AC-5: Crash Recovery (C-334, preserved) ─────────────────────────

  describe('AC-5 Crash Recovery (C-334)', () => {
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

    test('acceptRecovery() routes to /game', async () => {
      mockSessionMarkerCampaignId = 'camp-crash-1';
      // Set up mock saves so acceptRecovery finds one
      const mockSaves = [
        { id: 'auto-save', timestamp: Date.now(), mapName: 'CrashMap', campaignId: 'camp-crash-1' },
      ];
      Object.defineProperty(_svcStubs.gameSaveService, 'availableSaves', {
        get: () => mockSaves,
        configurable: true,
      });
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.showRecoveryPrompt).toBe(true);
      await vm.acceptRecovery();

      expect(mockClearSessionMarkerCalls).toBeGreaterThanOrEqual(1);
      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('game');
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

  // ── Pack Browser (C-345, preserved) ──────────────────────────────────

  describe('pack browser (C-345)', () => {
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
  });

  // ── initialize() ─────────────────────────────────────────────────────

  describe('initialize()', () => {
    test('sets latestResumableCampaign when campaigns exist', async () => {
      mockCampaigns = [makeCampaign({ id: 'camp-1', state: 'playing' })];
      const vm = createViewModel();

      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeDefined();
      expect(vm.latestResumableCampaign?.id).toBe('camp-1');
    });

    test('handles empty IndexedDB gracefully', async () => {
      mockCampaigns = [];
      const vm = createViewModel();

      await vm.initialize();

      expect(vm.latestResumableCampaign).toBeUndefined();
      expect(vm.campaignSummaries).toHaveLength(0);
      expect(vm.errorMessage).toBeUndefined();
    });

    test('handles campaign refresh failure gracefully', async () => {
      (_svcStubs.campaignService as Record<string, unknown>).refreshCampaigns = mock(async () => {
        throw new Error('Storage error');
      });
      const vm = createViewModel();

      await vm.initialize();

      expect(vm.initError).toBe('Error: Storage error');
    });
  });
});
