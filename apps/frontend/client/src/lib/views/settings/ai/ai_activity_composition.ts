// apps/frontend/client/src/lib/views/settings/ai/ai_activity_composition.ts
//
// Production wiring for the AI Activity settings section. This is the only
// module in the feature that imports the `$services` barrel.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { configService, textTelemetryService } from '$services';
import {
  type AiActivityViewModelInterface,
  createAiActivityViewModel,
} from './ai_activity_view_model.svelte';

/** Builds the Activity ViewModel wired to config + telemetry singletons. */
export const getAiActivityViewModel = (
  options: BaseViewModelOptions,
): AiActivityViewModelInterface =>
  createAiActivityViewModel({
    ...options,
    config: configService,
    telemetry: textTelemetryService,
  });
