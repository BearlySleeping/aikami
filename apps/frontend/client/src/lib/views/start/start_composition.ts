// apps/frontend/client/src/lib/views/start/start_composition.ts
//
// Production wiring for the start menu. This is the only module in the feature
// that imports the `$services` barrel and the Tauri platform probe; the
// ViewModel receives its dependencies as typed capabilities, so unit tests
// never touch the global service registry.

import { isTauri } from '$lib/views/utils/is_tauri';
import {
  assetPrefetchService,
  campaignService,
  equipmentService,
  gameModeService,
  gameOverlayService,
  gameSaveService,
  inventoryService,
  packRegistryService,
  playerStateService,
  routerService,
  worldStateService,
} from '$services';
import {
  createStartViewModel,
  type StartViewModelInterface,
  type StartViewModelOptions,
} from './start_view_model.svelte';

/** Start-menu options with the wired capabilities removed. */
export type StartPublicOptions = Omit<
  StartViewModelOptions,
  | 'campaign'
  | 'router'
  | 'inventory'
  | 'worldState'
  | 'playerState'
  | 'equipment'
  | 'gameMode'
  | 'gameOverlay'
  | 'gameSave'
  | 'packRegistry'
  | 'assets'
  | 'platform'
>;

/**
 * Builds the start-menu ViewModel wired to the production campaign, router,
 * game-state, save/recovery, pack-registry, asset-prefetch, and desktop
 * platform singletons.
 */
export const getStartViewModel = (options: StartPublicOptions): StartViewModelInterface =>
  createStartViewModel({
    ...options,
    startWithLoadingView: true,
    campaign: campaignService,
    router: routerService,
    inventory: inventoryService,
    worldState: worldStateService,
    playerState: playerStateService,
    equipment: equipmentService,
    gameMode: gameModeService,
    gameOverlay: gameOverlayService,
    gameSave: gameSaveService,
    packRegistry: packRegistryService,
    assets: assetPrefetchService,
    platform: {
      isTauri,
      closeWindow: async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await getCurrentWindow().close();
      },
    },
  });
