// apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_composition.ts
//
// Production wiring for the focused setup subflow. This is the only module in
// the feature that imports the `$services` barrel and the platform probe; the
// ViewModel receives its dependencies as typed capability options so unit tests
// never touch the global service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { isTauri } from '$lib/views/utils/is_tauri';
import {
  campaignService,
  capabilityService,
  configService,
  equipmentService,
  gameModeService,
  inventoryService,
  playerStateService,
  routerService,
  runtimeConfigService,
  worldStateService,
} from '$services';
import { getAiSettingsViewModel } from '../settings/ai/ai_settings_composition.ts';
import {
  createSetupSubflowViewModel,
  type SetupOrigin,
  type SetupSubflowViewModelInterface,
} from './setup_subflow_view_model.svelte';

/** Public options accepted by the production factory (no capabilities). */
export type SetupSubflowCompositionOptions = BaseViewModelOptions & {
  origin?: SetupOrigin;
};

export const getSetupSubflowViewModel = (
  options: SetupSubflowCompositionOptions,
): SetupSubflowViewModelInterface =>
  createSetupSubflowViewModel({
    ...options,
    config: configService,
    detection: capabilityService,
    runtimeConfig: runtimeConfigService,
    campaign: campaignService,
    router: routerService,
    reset: {
      inventory: inventoryService,
      worldState: worldStateService,
      playerState: playerStateService,
      equipment: equipmentService,
      gameMode: gameModeService,
    },
    isDesktop: () => isTauri(),
    createEditor: () => getAiSettingsViewModel({ className: 'SetupSubflowEditor' }),
  });
