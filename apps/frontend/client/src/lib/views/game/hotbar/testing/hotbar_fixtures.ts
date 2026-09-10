// apps/frontend/client/src/lib/views/game/hotbar/testing/hotbar_fixtures.ts
//
// Feature-owned test doubles for the hotbar ViewModel. Operations are not
// defaulted to success: an unconfigured call throws, so a test cannot pass by
// accident on a silent no-op.

import type { HotbarPlayerStateCapabilities } from '../hotbar_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Player-state capability with empty slots/uses until overridden. */
export const createHotbarPlayerState = (
  overrides: Partial<HotbarPlayerStateCapabilities> = {},
): HotbarPlayerStateCapabilities => ({
  hotbarSlots: [],
  abilityUses: {},
  useAbility: () => unconfigured('useAbility'),
  ...overrides,
});
