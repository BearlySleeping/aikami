// apps/frontend/client/src/lib/views/settings/ai/ai_capability_badge_composition.ts
//
// Production wiring for the Settings header AI capability badge. This is the
// only module that connects the badge ViewModel to configService and the shared
// connection-test store.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { configService } from '$services';
import {
  type AiCapabilityBadgeViewModelInterface,
  createAiCapabilityBadgeViewModel,
} from './ai_capability_badge_view_model.svelte';
import { type AiConnectionStatus, buildCapabilityStatuses } from './ai_connection_status.svelte';

export const getAiCapabilityBadgeViewModel = (
  options: BaseViewModelOptions,
  status: AiConnectionStatus,
): AiCapabilityBadgeViewModelInterface =>
  createAiCapabilityBadgeViewModel({
    ...options,
    getCapabilityStatuses: () =>
      buildCapabilityStatuses(
        {
          getAiConnections: () => configService.getAiConnections(),
          getDefaultByCapability: () => configService.state.defaultByCapability,
        },
        status,
      ),
  });
