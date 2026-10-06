// apps/frontend/client/src/lib/views/dev/text/text_composition.ts
//
// Production wiring for the dev text sandbox. This is the only module in the
// feature that imports the `$services` barrel; the ViewModel receives its
// dependencies as typed capabilities, so unit tests never touch the global
// service registry.

import { getPublicMode } from '@aikami/frontend/configs';
import type { BaseViewModelOptions } from '@aikami/frontend/services/base';
import { configService, textGenerationService, textTelemetryService } from '$services';
import { createTextViewModel, type TextViewModelInterface } from './text_view_model.svelte';

/**
 * Builds the text ViewModel wired to the production config, text-generation and
 * telemetry singletons.
 */
export const getTextViewModel = (options: BaseViewModelOptions): TextViewModelInterface => {
  if (typeof window !== 'undefined' && getPublicMode() !== 'production') {
    // The text sandbox can read the same telemetry seam without booting a game.
    // biome-ignore lint/style/useNamingConvention: existing browser test seam contract
    const globals: Window & { __AIKAMI_TEST__?: object } = window;
    Object.assign(globals, {
      // biome-ignore lint/style/useNamingConvention: existing browser test seam contract
      __AIKAMI_TEST__: Object.assign(globals.__AIKAMI_TEST__ ?? {}, {
        getTextTelemetry: () => ({
          spans: textTelemetryService.spans,
          summary: textTelemetryService.summary,
        }),
      }),
    });
  }
  return createTextViewModel({
    ...options,
    config: configService,
    textGeneration: textGenerationService,
    telemetry: textTelemetryService,
  });
};
