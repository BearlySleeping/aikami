// apps/frontend/client/src/lib/views/settings/ai_privacy/ai_privacy_view_model.svelte.ts
//
// C-464 AC-8: AI & Privacy ViewModel — shows only AI connection status and
// a "Connect AI" call-to-action. Offline mode and telemetry toggles moved
// to the Data section (export_view_model).

import { TEXT_PROVIDERS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { configService, routerService } from '$services';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AIConnectionStatus = 'connected' | 'offline' | 'not_configured' | 'loading';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export type AIPrivacyViewModelInterface = BaseViewModelInterface & {
  /** Derived AI connection status from configService. */
  readonly aiConnectionStatus: AIConnectionStatus;
  /** Active provider label, if configured. */
  readonly activeProviderLabel: string | undefined;

  /** Navigates to the Capability Setup flow (C-318). */
  connectAi(): Promise<void>;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type AIPrivacyViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Local providers don't need API keys — they are usable out of the box.
// Cloud providers require a non-empty API key to be usable.
const LOCAL_PROVIDERS = new Set([
  'ollama',
  'llamacpp',
  'ooba',
  'comfyui',
  'webui',
  'kokoro',
  'voicevox',
]);

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class AIPrivacyViewModel
  extends BaseViewModel<AIPrivacyViewModelOptions>
  implements AIPrivacyViewModelInterface
{
  get aiConnectionStatus(): AIConnectionStatus {
    if (!configService.isLoaded) {
      return 'loading';
    }

    const { connections } = configService.state;
    const hasUsableConnection = connections.some(
      (c) => LOCAL_PROVIDERS.has(c.provider) || (c.apiKey?.trim().length ?? 0) > 0,
    );

    if (!hasUsableConnection) {
      return 'not_configured';
    }

    return 'connected';
  }

  get activeProviderLabel(): string | undefined {
    if (!configService.isLoaded) {
      return undefined;
    }
    if (configService.state.connections.length > 0) {
      const providerId = configService.state.connections[0].provider;
      const provider = TEXT_PROVIDERS.find((p) => p.id === providerId);
      return provider?.label;
    }
    return undefined;
  }

  async connectAi(): Promise<void> {
    await routerService.goToRoute('setup', {
      pathParameters: undefined,
      queryParameters: { from: 'settings' },
    });
  }
}

export const getAIPrivacyViewModel = (
  options: AIPrivacyViewModelOptions,
): AIPrivacyViewModelInterface => AIPrivacyViewModel.create(options);
