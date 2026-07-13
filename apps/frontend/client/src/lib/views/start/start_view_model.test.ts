// apps/frontend/client/src/lib/views/start/start_view_model.test.ts
//
// Unit tests for the campaign-first StartViewModel.
// Contract: C-317 Rebuild the Start Menu Around Campaigns, Not Personas
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Campaign } from '@aikami/types';

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

let campaigns: Campaign[] = [];
let startNewCampaignCalls = 0;
let startNewCampaignError: Error | undefined;
let loadCampaignCalls: Array<{ campaignId: string }> = [];
let loadCampaignError: Error | undefined;
let refreshCampaignsError: Error | undefined;
let resetCalls = 0;
let routeCalls: Array<{ route: string }> = [];
let textProviderConfig: { apiKey: string; endpoint: string; model: string } = {
  apiKey: 'test-key',
  endpoint: '',
  model: '',
};

// ---------------------------------------------------------------------------
// Campaign fixtures
// ---------------------------------------------------------------------------

const makeCampaign = (overrides: Partial<Campaign>): Campaign => ({
  id: 'campaign-1',
  name: 'New Adventure',
  state: 'playing',
  contentPackId: 'emberwatch',
  seed: 12345,
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T12:00:00.000Z',
  capabilityProfile: {
    textProvider: true,
    imageProvider: false,
    voiceProvider: false,
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// Import the stub barrel (preloaded mock) so we can mutate service methods.
// ---------------------------------------------------------------------------

import * as _svcStubs from '$services';

const _setupServiceOverrides = (): void => {
  // ── campaignService ───────────────────────────────────────────────────
  Object.defineProperty(_svcStubs.campaignService, 'campaigns', {
    get: () => campaigns,
    configurable: true,
  });

  Object.defineProperty(_svcStubs.campaignService, 'isBusy', {
    get: () => false,
    configurable: true,
  });

  (_svcStubs.campaignService as Record<string, unknown>).startNewCampaign = mock(async () => {
    if (startNewCampaignError) {
      throw startNewCampaignError;
    }
    startNewCampaignCalls++;
    const campaign = makeCampaign({ id: `new-${startNewCampaignCalls}`, state: 'creating' });
    campaigns = [campaign, ...campaigns];
    return campaign;
  });

  (_svcStubs.campaignService as Record<string, unknown>).loadCampaign = mock(
    async (options: { campaignId: string }) => {
      if (loadCampaignError) {
        throw loadCampaignError;
      }
      loadCampaignCalls.push(options);
      const found = campaigns.find((c) => c.id === options.campaignId);
      if (!found) {
        throw new Error(`Campaign not found: ${options.campaignId}`);
      }
      return { ...found, state: 'playing' };
    },
  );

  (_svcStubs.campaignService as Record<string, unknown>).refreshCampaigns = mock(async () => {
    if (refreshCampaignsError) {
      throw refreshCampaignsError;
    }
  });

  // ── game state reset services ─────────────────────────────────────────
  (_svcStubs.inventoryService as Record<string, unknown>).reset = mock(() => {
    resetCalls++;
  });
  (_svcStubs.worldStateService as Record<string, unknown>).reset = mock(() => {
    resetCalls++;
  });
  (_svcStubs.playerStateService as Record<string, unknown>).reset = mock(() => {
    resetCalls++;
  });
  (_svcStubs.equipmentService as Record<string, unknown>).reset = mock(() => {
    resetCalls++;
  });
  (_svcStubs.gameModeService as Record<string, unknown>).reset = mock(() => {
    resetCalls++;
  });

  // ── routerService ─────────────────────────────────────────────────────
  (_svcStubs.routerService as Record<string, unknown>).goToRoute = mock(async (route: string) => {
    routeCalls.push({ route });
  });

  // ── aiSettingsService.textProvider ────────────────────────────────────
  Object.defineProperty(_svcStubs.aiSettingsService, 'textProvider', {
    get: () => textProviderConfig,
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

type TestViewModel = {
  campaignSummaries: ReadonlyArray<{
    id: string;
    name: string;
    lastSavedAt: string | undefined;
    lastSavedLabel: string;
    contentPackLabel: string;
    isResumable: boolean;
    isFailed: boolean;
    isCreating: boolean;
    capabilities: { textProvider: boolean; imageProvider: boolean; voiceProvider: boolean };
  }>;
  latestResumableCampaign:
    | { id: string; name: string; lastSavedLabel: string; isResumable: boolean }
    | undefined;
  hasResumableCampaign: boolean;
  hasCampaigns: boolean;
  campaignsLoadFailed: boolean;
  showLoadCampaignModal: boolean;
  showNewAdventureConfirm: boolean;
  showMissingProvidersDialog: boolean;
  menuItemIds: readonly string[];
  errorMessage: string | undefined;
  isTauri: boolean;
  initialize(): Promise<void>;
  startNewAdventure(): Promise<void>;
  confirmNewAdventure(): Promise<void>;
  cancelNewAdventure(): void;
  continueLatestCampaign(): Promise<void>;
  openLoadCampaign(): void;
  closeLoadCampaign(): void;
  loadCampaignById(campaignId: string): Promise<void>;
  proceedWithoutProviders(): Promise<void>;
};

const createViewModel = (): TestViewModel => {
  const vm = getStartViewModel({ className: 'StartViewModel' });
  return vm as unknown as TestViewModel;
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StartViewModel (campaign-first, C-317)', () => {
  beforeEach(() => {
    campaigns = [];
    startNewCampaignCalls = 0;
    startNewCampaignError = undefined;
    loadCampaignCalls = [];
    loadCampaignError = undefined;
    refreshCampaignsError = undefined;
    resetCalls = 0;
    routeCalls = [];
    textProviderConfig = { apiKey: 'test-key', endpoint: '', model: '' };
    _setupServiceOverrides();
  });

  // ── AC-1: Continue shows only for resumable campaigns ─────────────────

  describe('AC-1: latestResumableCampaign / hasResumableCampaign', () => {
    test('exposes latest resumable campaign when one is playing', async () => {
      campaigns = [makeCampaign({ id: 'c-1', state: 'playing', name: 'Emberwatch Run' })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.hasResumableCampaign).toBe(true);
      expect(vm.latestResumableCampaign?.id).toBe('c-1');
      expect(vm.latestResumableCampaign?.name).toBe('Emberwatch Run');
    });

    test('paused and saving states are resumable', async () => {
      campaigns = [makeCampaign({ id: 'c-paused', state: 'paused' })];
      const vm = createViewModel();
      await vm.initialize();
      expect(vm.hasResumableCampaign).toBe(true);

      campaigns = [makeCampaign({ id: 'c-saving', state: 'saving' })];
      expect(vm.latestResumableCampaign?.id).toBe('c-saving');
    });

    test('failed campaigns are NOT resumable', async () => {
      campaigns = [makeCampaign({ id: 'c-failed', state: 'failed' })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.hasResumableCampaign).toBe(false);
      expect(vm.latestResumableCampaign).toBeUndefined();
    });

    test('creating and loading campaigns are NOT resumable', async () => {
      campaigns = [
        makeCampaign({ id: 'c-creating', state: 'creating' }),
        makeCampaign({ id: 'c-loading', state: 'loading' }),
      ];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.hasResumableCampaign).toBe(false);
    });

    test('picks the newest resumable campaign, skipping non-resumable ones', async () => {
      campaigns = [
        makeCampaign({ id: 'c-creating', state: 'creating', updatedAt: '2026-07-03T00:00:00Z' }),
        makeCampaign({ id: 'c-resumable', state: 'paused', updatedAt: '2026-07-02T00:00:00Z' }),
        makeCampaign({ id: 'c-older', state: 'playing', updatedAt: '2026-07-01T00:00:00Z' }),
      ];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.latestResumableCampaign?.id).toBe('c-resumable');
    });

    test('no campaigns → Continue hidden', async () => {
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.hasResumableCampaign).toBe(false);
      expect(vm.hasCampaigns).toBe(false);
    });
  });

  describe('AC-1: continueLatestCampaign()', () => {
    test('loads the latest resumable campaign and routes to /game', async () => {
      campaigns = [makeCampaign({ id: 'c-1', state: 'paused' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.continueLatestCampaign();

      expect(loadCampaignCalls).toHaveLength(1);
      expect(loadCampaignCalls[0].campaignId).toBe('c-1');
      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('game');
    });

    test('does nothing when no resumable campaign exists', async () => {
      campaigns = [makeCampaign({ id: 'c-failed', state: 'failed' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.continueLatestCampaign();

      expect(loadCampaignCalls).toHaveLength(0);
      expect(routeCalls).toHaveLength(0);
    });

    test('sets error message when loadCampaign throws', async () => {
      campaigns = [makeCampaign({ id: 'c-1', state: 'playing' })];
      loadCampaignError = new Error('IndexedDB unavailable');
      const vm = createViewModel();
      await vm.initialize();

      await vm.continueLatestCampaign();

      expect(routeCalls).toHaveLength(0);
      expect(vm.errorMessage).toBeDefined();
    });
  });

  // ── AC-2: New Adventure always creates a fresh campaign ───────────────

  describe('AC-2: startNewAdventure()', () => {
    test('creates a new campaign and routes to /setup with zero campaigns', async () => {
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      expect(startNewCampaignCalls).toBe(1);
      expect(routeCalls).toHaveLength(1);
      expect(routeCalls[0].route).toBe('setup');
    });

    test('creates a new campaign even when non-resumable campaigns exist', async () => {
      campaigns = [
        makeCampaign({ id: 'c-failed', state: 'failed' }),
        makeCampaign({ id: 'c-creating', state: 'creating' }),
      ];
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      expect(startNewCampaignCalls).toBe(1);
      expect(routeCalls[0].route).toBe('setup');
    });

    test('resets stale game state before routing to /setup', async () => {
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      // inventory, world, player, equipment, gameMode
      expect(resetCalls).toBe(5);
    });

    test('shows missing-providers advisory when no text provider, without blocking', async () => {
      textProviderConfig = { apiKey: '', endpoint: '', model: '' };
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      // Advisory dialog shown, no campaign created yet
      expect(vm.showMissingProvidersDialog).toBe(true);
      expect(startNewCampaignCalls).toBe(0);

      // Player can proceed anyway (soft advisory, not a hard block)
      await vm.proceedWithoutProviders();

      expect(vm.showMissingProvidersDialog).toBe(false);
      expect(startNewCampaignCalls).toBe(1);
      expect(routeCalls[0].route).toBe('setup');
    });

    test('sets error message when startNewCampaign throws', async () => {
      startNewCampaignError = new Error('busy');
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      expect(routeCalls).toHaveLength(0);
      expect(vm.errorMessage).toBeDefined();
    });
  });

  // ── AC-4: Destructive confirmation ────────────────────────────────────

  describe('AC-4: New Adventure confirmation with resumable campaign', () => {
    test('shows confirmation dialog instead of creating immediately', async () => {
      campaigns = [makeCampaign({ id: 'c-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(true);
      expect(startNewCampaignCalls).toBe(0);
      expect(routeCalls).toHaveLength(0);
    });

    test('confirm proceeds — creates campaign and routes to /setup', async () => {
      campaigns = [makeCampaign({ id: 'c-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();
      await vm.confirmNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(false);
      expect(startNewCampaignCalls).toBe(1);
      expect(routeCalls[0].route).toBe('setup');
    });

    test('cancel aborts — no campaign created, dialog closed', async () => {
      campaigns = [makeCampaign({ id: 'c-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();
      vm.cancelNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(false);
      expect(startNewCampaignCalls).toBe(0);
      expect(routeCalls).toHaveLength(0);
    });

    test('no confirmation when only failed campaigns exist', async () => {
      campaigns = [makeCampaign({ id: 'c-failed', state: 'failed' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.startNewAdventure();

      expect(vm.showNewAdventureConfirm).toBe(false);
      expect(startNewCampaignCalls).toBe(1);
    });
  });

  // ── AC-3: Load Campaign summary cards ─────────────────────────────────

  describe('AC-3: campaignSummaries', () => {
    test('maps campaigns to display summaries with content pack label', async () => {
      campaigns = [
        makeCampaign({
          id: 'c-1',
          name: 'The Fading Ward',
          state: 'playing',
          lastSavedAt: '2026-07-01T12:00:00.000Z',
        }),
      ];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries).toHaveLength(1);
      const summary = vm.campaignSummaries[0];
      expect(summary.id).toBe('c-1');
      expect(summary.name).toBe('The Fading Ward');
      expect(summary.contentPackLabel).toBe('Emberwatch: The Fading Ward');
      expect(summary.isResumable).toBe(true);
      expect(summary.lastSavedAt).toBe('2026-07-01T12:00:00.000Z');
      expect(summary.capabilities.textProvider).toBe(true);
    });

    test('never-saved campaign shows "Not yet saved" label', async () => {
      campaigns = [makeCampaign({ id: 'c-1', state: 'creating', lastSavedAt: undefined })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].lastSavedLabel).toBe('Not yet saved');
    });

    test('flags failed and creating campaigns', async () => {
      campaigns = [
        makeCampaign({ id: 'c-failed', state: 'failed' }),
        makeCampaign({ id: 'c-creating', state: 'creating' }),
      ];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].isFailed).toBe(true);
      expect(vm.campaignSummaries[0].isCreating).toBe(false);
      expect(vm.campaignSummaries[1].isFailed).toBe(false);
      expect(vm.campaignSummaries[1].isCreating).toBe(true);
    });

    test('unknown content pack falls back to generic label', async () => {
      campaigns = [makeCampaign({ id: 'c-1', contentPackId: 'mystery-pack' })];
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignSummaries[0].contentPackLabel).toBe('Unknown Adventure');
    });
  });

  describe('AC-3: load campaign modal + loadCampaignById()', () => {
    test('open/close modal toggles state', async () => {
      const vm = createViewModel();
      await vm.initialize();

      vm.openLoadCampaign();
      expect(vm.showLoadCampaignModal).toBe(true);

      vm.closeLoadCampaign();
      expect(vm.showLoadCampaignModal).toBe(false);
    });

    test('loads a resumable campaign and routes to /game', async () => {
      campaigns = [makeCampaign({ id: 'c-1', state: 'paused' })];
      const vm = createViewModel();
      await vm.initialize();

      vm.openLoadCampaign();
      await vm.loadCampaignById('c-1');

      expect(loadCampaignCalls[0].campaignId).toBe('c-1');
      expect(routeCalls[0].route).toBe('game');
      expect(vm.showLoadCampaignModal).toBe(false);
    });

    test('failed campaign load is blocked with an error message', async () => {
      campaigns = [makeCampaign({ id: 'c-failed', state: 'failed' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.loadCampaignById('c-failed');

      expect(loadCampaignCalls).toHaveLength(0);
      expect(routeCalls).toHaveLength(0);
      expect(vm.errorMessage).toBeDefined();
    });

    test('creating campaign routes to /setup to resume character creation', async () => {
      campaigns = [makeCampaign({ id: 'c-creating', state: 'creating' })];
      const vm = createViewModel();
      await vm.initialize();

      await vm.loadCampaignById('c-creating');

      expect(loadCampaignCalls).toHaveLength(0);
      expect(routeCalls[0].route).toBe('setup');
    });

    test('sets error message when loadCampaign throws', async () => {
      campaigns = [makeCampaign({ id: 'c-1', state: 'playing' })];
      loadCampaignError = new Error('boom');
      const vm = createViewModel();
      await vm.initialize();

      await vm.loadCampaignById('c-1');

      expect(routeCalls).toHaveLength(0);
      expect(vm.errorMessage).toBeDefined();
    });
  });

  // ── Degraded state ─────────────────────────────────────────────────────

  describe('degraded state: refreshCampaigns() fails', () => {
    test('marks campaignsLoadFailed, hides Continue, New Adventure still works', async () => {
      refreshCampaignsError = new Error('IndexedDB blocked');
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.campaignsLoadFailed).toBe(true);
      expect(vm.hasResumableCampaign).toBe(false);

      await vm.startNewAdventure();
      expect(startNewCampaignCalls).toBe(1);
    });
  });

  // ── AC-5: Keyboard focus order ─────────────────────────────────────────

  describe('AC-5: menuItemIds focus order', () => {
    test('full order with resumable campaign: continue first', async () => {
      campaigns = [makeCampaign({ id: 'c-1', state: 'playing' })];
      const vm = createViewModel();
      await vm.initialize();

      const ids = vm.menuItemIds;
      expect(ids[0]).toBe('continue');
      expect(ids[1]).toBe('new-adventure');
      expect(ids[2]).toBe('load-campaign');
      expect(ids[3]).toBe('settings');
      expect(ids[4]).toBe('account');
      expect(ids[5]).toBe('credits');
    });

    test('continue omitted when no resumable campaign', async () => {
      const vm = createViewModel();
      await vm.initialize();

      expect(vm.menuItemIds).not.toContain('continue');
      expect(vm.menuItemIds[0]).toBe('new-adventure');
    });

    test('quit only present in Tauri', async () => {
      const vm = createViewModel();
      await vm.initialize();

      // Not running in Tauri in the test environment
      expect(vm.isTauri).toBe(false);
      expect(vm.menuItemIds).not.toContain('quit');
    });
  });
});
