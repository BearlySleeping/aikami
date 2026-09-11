// apps/frontend/client/src/lib/views/start/testing/start_fixtures.ts
//
// Feature-owned capability fixtures for StartViewModel tests. Each fixture is
// a plain object — no `$services` barrel, no `mock.module`, and no dependency
// on the test preload's mock inventory.

import type { Campaign, PackIndexEntry } from '@aikami/types';
import type { SaveSlotInfo } from '$types';
import type {
  StartAssetPrefetchCapabilities,
  StartCampaignCapabilities,
  StartEquipmentCapabilities,
  StartGameModeCapabilities,
  StartGameOverlayCapabilities,
  StartGameSaveCapabilities,
  StartInventoryCapabilities,
  StartPackRegistryCapabilities,
  StartPlatformCapabilities,
  StartPlayerStateCapabilities,
  StartRouterCapabilities,
  StartWorldStateCapabilities,
} from '../start_view_model.svelte.ts';

/** The full capability set the start-menu ViewModel consumes. */
export type StartCapabilities = {
  campaign: StartCampaignCapabilities;
  router: StartRouterCapabilities;
  inventory: StartInventoryCapabilities;
  worldState: StartWorldStateCapabilities;
  playerState: StartPlayerStateCapabilities;
  equipment: StartEquipmentCapabilities;
  gameMode: StartGameModeCapabilities;
  gameOverlay: StartGameOverlayCapabilities;
  gameSave: StartGameSaveCapabilities;
  packRegistry: StartPackRegistryCapabilities;
  assets: StartAssetPrefetchCapabilities;
  platform: StartPlatformCapabilities;
};

/** A captured `router.goToRoute` invocation. */
export type RouteCall = {
  route: string;
  options?: { queryParameters?: Record<string, string>; pathParameters?: unknown };
};

/** Builds a valid campaign with sensible defaults. */
export const makeCampaign = (overrides: Partial<Campaign> = {}): Campaign => ({
  id: 'camp-1',
  name: 'Emberwatch',
  state: 'playing',
  contentPackId: 'emberwatch',
  seed: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lastSavedAt: new Date().toISOString(),
  capabilityProfile: { textProvider: true, imageProvider: false, voiceProvider: false },
  ...overrides,
});

/** Builds a valid pack index entry with sensible defaults. */
export const makePack = (overrides: Partial<PackIndexEntry> = {}): PackIndexEntry => ({
  id: 'emberwatch',
  name: 'Emberwatch: The Fading Ward',
  description: 'The wardstone that protects Emberwatch Village is failing.',
  version: '2.1.0',
  updatedAt: '2026-07-13T00:00:00.000Z',
  ...overrides,
});

/** A mutable test harness around StartViewModel's capabilities. */
export type StartHarness = {
  capabilities: StartCapabilities;
  routeCalls: RouteCall[];
  newAdventureCalls: string[];
  campaigns: Campaign[];
  availablePacks: PackIndexEntry[];
  availableSaves: SaveSlotInfo[];
  setCampaigns(next: Campaign[]): void;
  setAvailablePacks(next: PackIndexEntry[]): void;
  setAvailableSaves(next: SaveSlotInfo[]): void;
  setSessionMarker(campaignId: string | undefined): void;
  clearSessionMarkerCalls(): number;
  reset(): void;
};

/** Builds a fresh capability harness for one start-menu test. */
export const createStartHarness = (): StartHarness => {
  const routeCalls: RouteCall[] = [];
  const newAdventureCalls: string[] = [];
  const campaigns: Campaign[] = [];
  const availablePacks: PackIndexEntry[] = [];
  const availableSaves: SaveSlotInfo[] = [];
  let sessionMarkerCampaignId: string | undefined;
  let clearSessionMarkerCount = 0;

  const capabilities: StartCapabilities = {
    campaign: {
      get campaigns(): readonly Campaign[] {
        return campaigns;
      },
      get activeCampaign(): Campaign | undefined {
        return campaigns[0];
      },
      refreshCampaigns: async () => {},
      startNewCampaign: async (options) => {
        newAdventureCalls.push('start');
        return makeCampaign({
          id: 'camp-new',
          name: 'New Adventure',
          state: 'creating',
          contentPackId: options?.contentPackId ?? 'emberwatch',
          lastSavedAt: undefined,
        });
      },
      loadCampaign: async ({ campaignId }) => {
        const found = campaigns.find((campaign) => campaign.id === campaignId);
        if (!found) {
          throw new Error(`Campaign not found: ${campaignId}`);
        }
        return { ...found, state: 'playing' };
      },
    },
    router: {
      goToRoute: async (route, options) => {
        routeCalls.push({ route: route as string, options });
      },
    },
    inventory: { reset: () => {} },
    worldState: { reset: () => {} },
    playerState: { reset: () => {} },
    equipment: { reset: () => {} },
    gameMode: { reset: () => {} },
    gameOverlay: {
      saveGame: async () => {
        newAdventureCalls.push('save');
      },
      checkSessionMarker: async () => sessionMarkerCampaignId,
      clearSessionMarker: async () => {
        clearSessionMarkerCount++;
      },
    },
    gameSave: {
      fetchAvailableSaves: async () => {},
      get availableSaves(): SaveSlotInfo[] {
        return availableSaves;
      },
    },
    packRegistry: {
      refresh: async () => {},
      get availablePacks(): readonly PackIndexEntry[] {
        return availablePacks;
      },
    },
    assets: {
      phase: 'idle',
      coreProgress: null,
      warmProgress: null,
      prefetchError: undefined,
      warmStarted: false,
      warmRemaining: () => {},
      ensureStarted: () => {},
    },
    platform: {
      isTauri: () => false,
      closeWindow: async () => {},
    },
  };

  return {
    capabilities,
    routeCalls,
    newAdventureCalls,
    campaigns,
    availablePacks,
    availableSaves,
    setCampaigns(next: Campaign[]): void {
      campaigns.length = 0;
      campaigns.push(...next);
    },
    setAvailablePacks(next: PackIndexEntry[]): void {
      availablePacks.length = 0;
      availablePacks.push(...next);
    },
    setAvailableSaves(next: SaveSlotInfo[]): void {
      availableSaves.length = 0;
      availableSaves.push(...next);
    },
    setSessionMarker(campaignId: string | undefined): void {
      sessionMarkerCampaignId = campaignId;
    },
    clearSessionMarkerCalls(): number {
      return clearSessionMarkerCount;
    },
    reset(): void {
      routeCalls.length = 0;
      newAdventureCalls.length = 0;
      campaigns.length = 0;
      availablePacks.length = 0;
      availableSaves.length = 0;
      sessionMarkerCampaignId = undefined;
      clearSessionMarkerCount = 0;
    },
  };
};
