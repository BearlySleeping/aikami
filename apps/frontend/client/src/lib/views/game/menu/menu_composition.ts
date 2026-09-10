// apps/frontend/client/src/lib/views/game/menu/menu_composition.ts
//
// Production wiring for the main menu. This is the only module in the feature
// that imports the `$services` singletons and the real platform probe; the
// ViewModel receives them as typed capabilities.

import { isTauri } from '$lib/views/utils/is_tauri';
import { campaignService, gameSaveService, routerService } from '$services';
import {
  createMenuViewModel,
  type MenuViewModelInterface,
  type MenuViewModelOptions,
} from './menu_view_model.svelte';

/**
 * Builds the menu ViewModel wired to the production save, campaign, and router
 * singletons.
 */
export const getMenuViewModel = (
  options: Omit<MenuViewModelOptions, 'gameSave' | 'campaign' | 'router' | 'isTauri'>,
): MenuViewModelInterface =>
  createMenuViewModel({
    ...options,
    gameSave: gameSaveService,
    campaign: campaignService,
    router: {
      openGame: () => {
        void routerService.goToRoute('game', {
          queryParameters: undefined,
          pathParameters: undefined,
        });
      },
    },
    isTauri,
    quitApp: async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    },
  });
