// apps/frontend/client/src/lib/views/settings/settings_composition.ts
//
// Production wiring for the settings page ViewModel. This is the only module
// in the feature that imports the `$services` barrel and every sibling feature
// composition; the ViewModel receives each sub-ViewModel and the router as
// typed construction capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { routerService } from '$services';
import { getAgentEditorViewModel } from '../agent/editor/agent_editor_composition.ts';
import { getAgentListViewModel } from '../agent/list/agent_list_composition.ts';
import { getAccountViewModel } from './account/account_composition.ts';
import { getAiActivityViewModel } from './ai/ai_activity_composition.ts';
import { getAiCapabilityBadgeViewModel } from './ai/ai_capability_badge_composition.ts';
import { createAiConnectionStatus } from './ai/ai_connection_status.svelte';
import { getCapabilityDetailViewModel } from './ai/capability_detail_composition.ts';
import { getSettingsAudioViewModel } from './audio/settings_audio_composition.ts';
import { getAutonomousSettingsViewModel } from './autonomous/autonomous_settings_view_model.svelte';
import { getSettingsControlsViewModel } from './controls/settings_controls_view_model.svelte';
import { getSettingsDisplayViewModel } from './display/settings_display_view_model.svelte';
import { getExportViewModel } from './export/export_composition.ts';
import { getGameplayViewModel } from './gameplay/gameplay_composition.ts';
import { getSettingsMusicViewModel } from './music/settings_music_composition.ts';
import {
  createSettingsViewModel,
  type SettingsViewModelInterface,
} from './settings_view_model.svelte';

/**
 * Builds the settings ViewModel wired to every production sub-ViewModel
 * factory and the router singleton.
 *
 * One connection-test store is created per settings session and shared by the
 * header badge and the capability detail pages; the SettingsViewModel resets it
 * on dispose.
 */
export const getSettingsViewModel = (options: BaseViewModelOptions): SettingsViewModelInterface => {
  const connectionStatus = createAiConnectionStatus();
  return createSettingsViewModel({
    ...options,
    connectionStatus,
    router: routerService,
    createAccount: (subOptions) => getAccountViewModel(subOptions),
    createGameplay: (subOptions) => getGameplayViewModel(subOptions),
    createAudio: (subOptions) => getSettingsAudioViewModel(subOptions),
    createDisplay: (subOptions) => getSettingsDisplayViewModel(subOptions),
    createControls: (subOptions) => getSettingsControlsViewModel(subOptions),
    createMusic: (subOptions) => getSettingsMusicViewModel(subOptions),
    createAutonomous: (subOptions) => getAutonomousSettingsViewModel(subOptions),
    createExport: (subOptions) => getExportViewModel(subOptions),
    createAiCapabilityBadge: (subOptions) =>
      getAiCapabilityBadgeViewModel(subOptions, connectionStatus),
    createCapabilityDetail: (subOptions) =>
      getCapabilityDetailViewModel(subOptions, connectionStatus),
    createAiActivity: (subOptions) => getAiActivityViewModel(subOptions),
    createAgentList: (subOptions) => getAgentListViewModel(subOptions),
    createAgentEditor: (subOptions) => getAgentEditorViewModel(subOptions),
  });
};
