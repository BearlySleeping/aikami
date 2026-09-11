// apps/frontend/client/src/lib/views/settings/ai/capability_detail_composition.ts
//
// Production wiring for a per-capability AI detail page. This is the only
// module in the feature that wires the child AI settings composition; the
// ViewModel receives the child as a typed construction capability.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import type { ConnectionCapability } from '$types';
import { getAiSettingsViewModel } from './ai_settings_composition.ts';
import {
  type CapabilityDetailViewModelInterface,
  createCapabilityDetailViewModel,
} from './capability_detail_view_model.svelte';

/** Public options accepted by the production factory (no capabilities). */
export type CapabilityDetailCompositionOptions = BaseViewModelOptions & {
  capability: ConnectionCapability;
};

export const getCapabilityDetailViewModel = (
  options: CapabilityDetailCompositionOptions,
): CapabilityDetailViewModelInterface =>
  createCapabilityDetailViewModel({
    ...options,
    createAiSettings: () =>
      getAiSettingsViewModel({
        className: 'AiSettingsViewModel',
        capability: options.capability,
      }),
  });
