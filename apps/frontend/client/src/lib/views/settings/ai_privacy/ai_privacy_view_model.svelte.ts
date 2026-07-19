// apps/frontend/client/src/lib/views/settings/ai_privacy/ai_privacy_view_model.svelte.ts
//
// AI & Privacy ViewModel — simplified panel for the Basic settings tier.
// Shows AI connection status, a "Connect AI" call-to-action routing to
// Capability Setup (C-318), an offline mode toggle, and telemetry opt-out.
import { TEXT_PROVIDERS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { configService } from '$services';

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
  /** Offline mode toggle — when true, no AI calls are attempted. */
  readonly offlineMode: boolean;
  /** Telemetry opt-out. */
  readonly telemetryOptOut: boolean;

  /** Navigates to the Capability Setup flow (C-318). */
  connectAi(): Promise<void>;
  /** Toggles offline mode. */
  toggleOfflineMode(): void;
  /** Toggles telemetry opt-out. */
  toggleTelemetry(): void;
};

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type AIPrivacyViewModelOptions = BaseViewModelOptions;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'aikami_ai_privacy_settings';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class AIPrivacyViewModel
  extends BaseViewModel<AIPrivacyViewModelOptions>
  implements AIPrivacyViewModelInterface
{
  offlineMode = $state<boolean>(false);
  telemetryOptOut = $state<boolean>(false);

  override async initialize(): Promise<void> {
    this._loadFromStorage();
    await super.initialize();
  }

  get aiConnectionStatus(): AIConnectionStatus {
    if (!configService.isLoaded) {
      return 'loading';
    }

    const hasConnections = configService.state.connections.length > 0;
    const hasApiKey = Object.keys(configService.state.text.apiKeys).some(
      (k) => configService.state.text.apiKeys[k] && configService.state.text.apiKeys[k].length > 0,
    );

    if (!hasConnections && !hasApiKey) {
      return 'not_configured';
    }

    // Credentials are configured — return 'connected' to indicate readiness
    // (actual runtime connectivity is not checked here; offline status is handled separately)
    return 'connected';
  }

  get activeProviderLabel(): string | undefined {
    if (!configService.isLoaded) {
      return undefined;
    }
    // Use the first connection's provider label, or the text provider label
    if (configService.state.connections.length > 0) {
      const providerId = configService.state.connections[0].provider;
      const provider = TEXT_PROVIDERS.find((p) => p.id === providerId);
      return provider?.label;
    }
    const providerId = configService.state.text.provider;
    const provider = TEXT_PROVIDERS.find((p) => p.id === providerId);
    return provider?.label;
  }

  async connectAi(): Promise<void> {
    window.location.href = '/setup?from=settings';
  }

  toggleOfflineMode(): void {
    this.offlineMode = !this.offlineMode;
    this._persist();
    this.debug('toggleOfflineMode', { offlineMode: this.offlineMode });
  }

  toggleTelemetry(): void {
    this.telemetryOptOut = !this.telemetryOptOut;
    this._persist();
    this.debug('toggleTelemetry', { telemetryOptOut: this.telemetryOptOut });
  }

  private _persist(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          offlineMode: this.offlineMode,
          telemetryOptOut: this.telemetryOptOut,
        }),
      );
    } catch {
      // localStorage may be unavailable
    }
  }

  private _loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed.offlineMode === 'boolean') {
          this.offlineMode = parsed.offlineMode;
        }
        if (typeof parsed.telemetryOptOut === 'boolean') {
          this.telemetryOptOut = parsed.telemetryOptOut;
        }
      }
    } catch {
      // Invalid stored data — keep defaults
    }
  }
}

export const getAIPrivacyViewModel = (
  options: AIPrivacyViewModelOptions,
): AIPrivacyViewModelInterface => AIPrivacyViewModel.create(options);
