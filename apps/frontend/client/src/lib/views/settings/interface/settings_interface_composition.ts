// apps/frontend/client/src/lib/views/settings/interface/settings_interface_composition.ts
//
// Production wiring for the Interface settings section. The ViewModel receives
// the shared configured preference authority as a typed capability.

import { HUD_WIDGET_CAPABILITIES } from '@aikami/constants';
import { configuredHudPreferenceService } from '$views/hud_preference_composition.ts';
import {
  createSettingsInterfaceViewModel,
  type SettingsInterfaceViewModelInterface,
  type SettingsInterfaceViewModelOptions,
} from './settings_interface_view_model.svelte';

/**
 * Builds the interface settings ViewModel wired to the production HUD
 * preference authority.
 *
 * Every registered capability is reported as available: the client always has a
 * clock, a party slot and a local music library. A capability that later becomes
 * conditional only has to stop being listed here — the resolver already treats a
 * missing capability as "dormant", never as "delete the preference".
 */
export const getSettingsInterfaceViewModel = (
  options: Omit<SettingsInterfaceViewModelOptions, 'hud' | 'capabilities'>,
): SettingsInterfaceViewModelInterface =>
  createSettingsInterfaceViewModel({
    ...options,
    hud: configuredHudPreferenceService,
    capabilities: [...HUD_WIDGET_CAPABILITIES],
  });
