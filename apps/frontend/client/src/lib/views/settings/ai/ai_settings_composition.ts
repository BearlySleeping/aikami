// apps/frontend/client/src/lib/views/settings/ai/ai_settings_composition.ts
//
// Production wiring for the AI Settings editor. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capability options so unit tests never touch the global
// service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import {
  campaignService,
  configService,
  fetchModelsFromProvider,
  fetchWithCredentialPolicy,
  hasVerificationStrategy,
  imageGenerationService,
  PROVIDER_MODEL_FETCH,
  resolveChatTestRequest,
  styleProfileService,
  ttsService,
  verifyConnection,
  voiceModelService,
} from '$services';
import type { ConnectionCapability } from '$types';
import {
  type AiSettingsViewModelInterface,
  createAiSettingsViewModel,
} from './ai_settings_view_model.svelte';

/** Public options accepted by the production factory (no capabilities). */
export type AiSettingsCompositionOptions = BaseViewModelOptions & {
  showAdvancedSections?: boolean;
  capability?: ConnectionCapability;
};

export const getAiSettingsViewModel = (
  options: AiSettingsCompositionOptions,
): AiSettingsViewModelInterface =>
  createAiSettingsViewModel({
    ...options,
    config: configService,
    campaign: campaignService,
    image: imageGenerationService,
    styleProfiles: styleProfileService,
    tts: ttsService,
    voiceModel: voiceModelService,
    ai: {
      providerModelFetch: PROVIDER_MODEL_FETCH,
      fetchModelsFromProvider,
      fetchWithCredentialPolicy,
      hasVerificationStrategy,
      resolveChatTestRequest,
      verifyConnection,
    },
  });
