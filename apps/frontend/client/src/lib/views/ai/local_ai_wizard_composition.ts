// apps/frontend/client/src/lib/views/ai/local_ai_wizard_composition.ts
//
// Production wiring for the local AI install wizard ViewModel. This is the only
// module in the feature that imports the `$services` barrel and the platform
// probe; the ViewModel receives its dependencies as typed capabilities.

import { isTauri } from '$lib/views/utils/is_tauri';
import { configService, getTauriRuntimeInfo, sidecarService } from '$services';
import {
  createLocalAiWizardViewModel,
  type LocalAiWizardViewModelInterface,
  type LocalAiWizardViewModelOptions,
} from './local_ai_wizard_view_model.svelte';

type LocalAiWizardCompositionOptions = Omit<
  LocalAiWizardViewModelOptions,
  'isDesktop' | 'sidecar' | 'config' | 'runtime'
>;

/**
 * Builds the local AI wizard ViewModel wired to the production sidecar,
 * connection catalog, and Tauri runtime probes.
 */
export const getLocalAiWizardViewModel = (
  options: LocalAiWizardCompositionOptions,
): LocalAiWizardViewModelInterface =>
  createLocalAiWizardViewModel({
    ...options,
    isDesktop: isTauri,
    sidecar: sidecarService,
    config: configService,
    runtime: { getRuntimeInfo: getTauriRuntimeInfo },
  });
