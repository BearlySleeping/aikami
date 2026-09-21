// apps/frontend/client/src/lib/views/chat/cyoa_sandbox_composition.ts
//
// Production wiring for the /dev/cyoa sandbox. The ViewModel receives its
// choice-history store and choice-buttons factory as typed capabilities.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import * as appServices from '$services';
import { getChoiceButtonsViewModel } from './choice_buttons_view_model.svelte.ts';
import {
  type CyoaSandboxViewModelInterface,
  type CyoaSandboxViewModelOptions,
  createCyoaSandboxViewModel,
} from './cyoa_sandbox_view_model.svelte.ts';

/** Builds the CYOA sandbox wired to the production singletons. */
export const getCyoaSandboxViewModel = (
  options: BaseViewModelOptions,
): CyoaSandboxViewModelInterface => {
  const opts: CyoaSandboxViewModelOptions = {
    ...options,
    choiceHistory: appServices.choiceHistoryStore,
    choiceButtons: { create: getChoiceButtonsViewModel },
  };
  return createCyoaSandboxViewModel(opts);
};
