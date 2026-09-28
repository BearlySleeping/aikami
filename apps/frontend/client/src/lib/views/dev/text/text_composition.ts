// apps/frontend/client/src/lib/views/dev/text/text_composition.ts
//
// Production wiring for the dev text sandbox. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { configService, textGenerationService, textTelemetryService } from '$services';
import { createTextViewModel, type TextViewModelInterface } from './text_view_model.svelte';

/**
 * Builds the text ViewModel wired to the production config, text-generation and
 * telemetry singletons.
 */
export const getTextViewModel = (options: BaseViewModelOptions): TextViewModelInterface =>
  createTextViewModel({
    ...options,
    config: configService,
    textGeneration: textGenerationService,
    telemetry: textTelemetryService,
  });
