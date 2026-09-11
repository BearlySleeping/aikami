// apps/frontend/client/src/lib/views/game/boot/testing/game_boot_fixtures.ts
//
// Feature-owned test doubles for the game-boot ViewModel. Operations are not
// defaulted to success: an unconfigured call throws, so a test cannot pass by
// accident on a silent no-op.

import type {
  GameBootCapabilities,
  GameBootProgress,
  GameBootRouterCapabilities,
} from '../game_boot_view_model.svelte';

const unconfigured = (operation: string): never => {
  throw new Error(`Unexpected ${operation} call; configure this fixture explicitly.`);
};

/** Boot capability in a representative mid-boot state. */
export const createGameBoot = (
  overrides: Partial<GameBootCapabilities> = {},
): GameBootCapabilities => ({
  bootProgress: {
    stage: 'loading-content',
    stageIndex: 1,
    stageCount: 4,
    detail: 'Loading content packs…',
  },
  isBooting: true,
  resetForRetry: () => unconfigured('resetForRetry'),
  teardown: () => unconfigured('teardown'),
  ...overrides,
});

/** Convenience: build a boot capability from a progress snapshot. */
export const createGameBootWithProgress = (bootProgress: GameBootProgress): GameBootCapabilities =>
  createGameBoot({ bootProgress });

/** Router capability whose navigation throws until overridden. */
export const createGameBootRouter = (
  overrides: Partial<GameBootRouterCapabilities> = {},
): GameBootRouterCapabilities => ({
  goToHref: () => unconfigured('goToHref'),
  ...overrides,
});
