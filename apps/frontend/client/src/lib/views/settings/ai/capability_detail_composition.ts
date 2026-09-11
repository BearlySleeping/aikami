// apps/frontend/client/src/lib/views/settings/ai/capability_detail_composition.ts
//
// Production wiring for a per-capability AI detail page. This is the only
// module in the feature that wires the child AI settings composition; the
// ViewModel receives the child as a typed construction capability.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { configService } from '$services';
import type { ConnectionCapability } from '$types';
import {
  type AiConnectionStatus,
  buildCapabilityStatusEntries,
} from './ai_connection_status.svelte';
import { getAiSettingsViewModel } from './ai_settings_composition.ts';
import {
  type CapabilityDetailViewModelInterface,
  createCapabilityDetailViewModel,
} from './capability_detail_view_model.svelte';

/** Public options accepted by the production factory (no capabilities). */
export type CapabilityDetailCompositionOptions = BaseViewModelOptions & {
  capability: ConnectionCapability;
};

/**
 * Shared status projection for every capability detail page. Reads saved
 * config + the session's test-result store directly, so the status card no
 * longer depends on the AI settings editor instance.
 */
const _getStatusEntries = (status: AiConnectionStatus) => () =>
  buildCapabilityStatusEntries({
    connections: configService.getAiConnections(),
    providers: configService.getProviders(),
    defaultByCapability: configService.state.defaultByCapability,
    testResults: status.testResults,
    testingIds: status.testingIds,
  });

export const getCapabilityDetailViewModel = (
  options: CapabilityDetailCompositionOptions,
  status: AiConnectionStatus,
): CapabilityDetailViewModelInterface =>
  createCapabilityDetailViewModel({
    ...options,
    getStatusEntries: _getStatusEntries(status),
    createAiSettings: () =>
      getAiSettingsViewModel(
        {
          className: 'AiSettingsViewModel',
          capability: options.capability,
        },
        status,
      ),
  });
