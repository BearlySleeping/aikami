// apps/frontend/client/src/lib/views/settings/connection/connection_manager_composition.ts
//
// Production wiring for the Connection Manager. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capability options so unit tests never touch the global
// service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import {
  configService,
  fetchModelsFromProvider,
  fetchWithCredentialPolicy,
  getOllamaRuntimeEndpoints,
  PROVIDER_MODEL_FETCH,
  resolveChatTestRequest,
} from '$services';
import {
  type ConnectionManagerViewModelInterface,
  createConnectionManagerViewModel,
} from './connection_manager_view_model.svelte';

export const getConnectionManagerViewModel = (
  options: BaseViewModelOptions,
): ConnectionManagerViewModelInterface =>
  createConnectionManagerViewModel({
    ...options,
    config: configService,
    ai: {
      providerModelFetch: PROVIDER_MODEL_FETCH,
      fetchModelsFromProvider,
      fetchWithCredentialPolicy,
      getOllamaRuntimeEndpoints,
      resolveChatTestRequest,
    },
  });
