// apps/frontend/client/src/lib/views/game/menu/testing/menu_fixtures.ts
//
// Feature-owned test doubles for the menu ViewModel. Operations are not
// defaulted to success: an unconfigured call throws, so a test cannot pass by
// accident on a silent no-op.

import type {
  MenuCampaignCapabilities,
  MenuGameSaveCapabilities,
  MenuRouterCapabilities,
} from '../menu_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Save-slot capability with no saves until overridden. */
export const createMenuGameSave = (
  overrides: Partial<MenuGameSaveCapabilities> = {},
): MenuGameSaveCapabilities => ({
  availableSaves: [],
  fetchAvailableSaves: () => unconfigured('fetchAvailableSaves'),
  ...overrides,
});

/** Campaign capability whose load throws until overridden. */
export const createMenuCampaign = (
  overrides: Partial<MenuCampaignCapabilities> = {},
): MenuCampaignCapabilities => ({
  loadCampaign: () => unconfigured('loadCampaign'),
  ...overrides,
});

/** Router capability whose navigation throws until overridden. */
export const createMenuRouter = (
  overrides: Partial<MenuRouterCapabilities> = {},
): MenuRouterCapabilities => ({
  openGame: () => unconfigured('openGame'),
  ...overrides,
});
