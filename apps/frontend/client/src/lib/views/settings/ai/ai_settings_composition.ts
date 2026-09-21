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
import { type AiConnectionStatus, createAiConnectionStatus } from './ai_connection_status.svelte';
import {
  type AiSettingsViewModelInterface,
  createAiSettingsViewModel,
} from './ai_settings_view_model.svelte';

/** Public options accepted by the production factory (no capabilities). */
export type AiSettingsCompositionOptions = BaseViewModelOptions & {
  showAdvancedSections?: boolean;
  capability?: ConnectionCapability;
};

/**
 * @param status Session-scoped connection-test store to share with the other
 *   surfaces of the same settings session. Defaults to a fresh store for
 *   standalone use (e.g. the setup subflow's editor).
 */
export const getAiSettingsViewModel = (
  options: AiSettingsCompositionOptions,
  status: AiConnectionStatus = createAiConnectionStatus(),
): AiSettingsViewModelInterface =>
  createAiSettingsViewModel({
    ...options,
    status,
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
