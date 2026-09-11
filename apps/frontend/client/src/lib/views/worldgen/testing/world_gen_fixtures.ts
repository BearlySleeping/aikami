// apps/frontend/client/src/lib/views/worldgen/testing/world_gen_fixtures.ts
//
// Feature-owned capability fixtures for WorldGenWizardViewModel tests. Each
// fixture is a plain object — no `$services` barrel, no `mock.module`, no
// dependency on a shared test inventory.

import type {
  WorldGenCampaignCapabilities,
  WorldGenRouterCapabilities,
  WorldGenSeedingCapabilities,
  WorldGenTextCapabilities,
  WorldGenWorldStateCapabilities,
} from '../world_gen_wizard_view_model.svelte.ts';

/** The full capability set the wizard ViewModel consumes. */
export type WorldGenCapabilities = {
  campaign: WorldGenCampaignCapabilities;
  router: WorldGenRouterCapabilities;
  textGeneration: WorldGenTextCapabilities;
  worldState: WorldGenWorldStateCapabilities;
  worldGenSeeding: WorldGenSeedingCapabilities;
};

/**
 * Builds no-op (or overridden) wizard capabilities. Individual capabilities
 * may be replaced wholesale via `overrides`.
 */
export const createWorldGenCapabilities = (
  overrides: Partial<WorldGenCapabilities> = {},
): WorldGenCapabilities => ({
  campaign: { activeCampaign: undefined },
  router: { goToRoute: async () => {} },
  textGeneration: { extractStructure: async () => undefined },
  worldState: {
    subscribeToWorld: async () => {},
    addLocation: () => {},
  },
  worldGenSeeding: {
    seedNpcs: async () => {},
    seedLocations: async () => {},
    seedPartyArcs: async () => {},
    seedHudWidgets: async () => {},
  },
  ...overrides,
});
