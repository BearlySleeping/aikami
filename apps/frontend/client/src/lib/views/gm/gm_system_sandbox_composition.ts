// apps/frontend/client/src/lib/views/gm/gm_system_sandbox_composition.ts
//
// Production wiring for the GM Narrative Director sandbox. This is the only
// module in the feature that imports the `$services` singletons and the child
// compositions; the ViewModel receives them as typed capabilities.

import { gmPromptService, narrativeDirectorService } from '$services';
import { getAddressModeTogggleViewModel } from './address_mode_toggle_composition.ts';
import {
  createGmSystemSandboxViewModel,
  type GmSystemSandboxViewModelInterface,
  type GmSystemSandboxViewModelOptions,
} from './gm_system_sandbox_view_model.svelte';
import { getPushStoryButtonViewModel } from './push_story_button_composition.ts';
import { getSessionSummaryPanelViewModel } from './session_summary_panel_composition.ts';

/**
 * Builds the GM-system sandbox ViewModel wired to the production GM prompt and
 * narrative director singletons plus the child compositions.
 */
export const getGmSystemSandboxViewModel = (
  options: Omit<
    GmSystemSandboxViewModelOptions,
    | 'prompt'
    | 'narrative'
    | 'createAddressModeViewModel'
    | 'createPushStoryViewModel'
    | 'createSessionSummaryViewModel'
  >,
): GmSystemSandboxViewModelInterface =>
  createGmSystemSandboxViewModel({
    ...options,
    prompt: gmPromptService,
    narrative: narrativeDirectorService,
    createAddressModeViewModel: getAddressModeTogggleViewModel,
    createPushStoryViewModel: getPushStoryButtonViewModel,
    createSessionSummaryViewModel: getSessionSummaryPanelViewModel,
  });
