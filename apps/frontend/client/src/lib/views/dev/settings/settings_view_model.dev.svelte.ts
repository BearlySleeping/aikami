// apps/frontend/client/src/lib/views/dev/settings/settings_view_model.dev.svelte.ts
//
// DevSettingsViewModel — extends the production SettingsViewModel for the
// dev sandbox. Volume controls are handled by SettingsAudioViewModel
// (instantiated by the parent SettingsViewModel).
import {
  SettingsViewModel,
  type SettingsViewModelInterface,
  type SettingsViewModelOptions,
} from '../../settings/settings_view_model.svelte';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type DevSettingsViewModelInterface = SettingsViewModelInterface;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type DevSettingsViewModelOptions = SettingsViewModelOptions;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Dev sandbox SettingsViewModel.
 *
 * Extends the production SettingsViewModel (tab navigation, ProvidersView,
 * SettingsAudioViewModel). Previously added volume controls directly; now
 * those are handled by the Audio sub-tab's own view model.
 */
class DevSettingsViewModel extends SettingsViewModel implements DevSettingsViewModelInterface {}

export const getDevSettingsViewModel = (
  options: DevSettingsViewModelOptions,
): DevSettingsViewModelInterface => new DevSettingsViewModel(options);
