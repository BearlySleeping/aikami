// apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts
//
// ViewModel for the pre-game capability detection screen.
// Orchestrates provider detection, presents three paths based on results,
// and creates the campaign with the chosen capability profile.
// Contract: C-318

import { TEXT_PROVIDERS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CapabilityProfile, CapabilitySnapshot } from '@aikami/types';
import { encrypt } from '$lib/utils/crypto_vault';
import { campaignService, capabilityService, PROVIDER_MODEL_FETCH, routerService } from '$services';

// ── Types ──────────────────────────────────────────────────────────────

export type CapabilityViewModelInterface = BaseViewModelInterface & {
  /** Current capability snapshot from detection. */
  readonly snapshot: CapabilitySnapshot;
  /** Whether detection is currently running. */
  readonly isDetecting: boolean;
  /** Whether local AI was detected (Ollama reachable). */
  readonly localAiDetected: boolean;
  /** Whether a cloud provider is configured. */
  readonly cloudConfigured: boolean;
  /** Whether the guided cloud connection modal is visible. */
  readonly showCloudSetup: boolean;
  /** Selected cloud provider for guided setup. */
  readonly selectedCloudProvider: string;
  /** Temporary API key for the guided cloud setup. */
  tempApiKey: string;
  /** Test result message from the cloud connection test. */
  readonly testResult: string;
  /** Whether a connection test is in progress. */
  readonly isTesting: boolean;
  /** Error message to display, or empty string. */
  readonly errorMessage: string;

  /** Starts provider detection. Called on initialization. */
  startDetection(): Promise<void>;
  /** Selects the "Play Offline Demo" path. */
  selectOfflineDemo(): Promise<void>;
  /** Selects the "Use Detected Local AI" path. */
  selectLocalAi(): Promise<void>;
  /** Opens the guided cloud connection modal. */
  openCloudSetup(providerId?: string): void;
  /** Closes the guided cloud connection modal. */
  closeCloudSetup(): void;
  /** Selects a cloud provider in the guided setup. */
  selectCloudProvider(providerId: string): void;
  /** Tests the cloud connection with the entered API key. */
  testCloudConnection(): Promise<void>;
  /** Saves the cloud connection and proceeds. */
  confirmCloudConnection(): Promise<void>;
  /** Human-readable label for the selected cloud provider. */
  readonly selectedCloudProviderLabel: string;
  /** Whether the selected cloud provider is OpenRouter (special routing note). */
  readonly isCloudProviderOpenRouter: boolean;
};

export type CapabilityViewModelOptions = BaseViewModelOptions;

// ── ViewModel ──────────────────────────────────────────────────────────

class CapabilityViewModel
  extends BaseViewModel<CapabilityViewModelOptions>
  implements CapabilityViewModelInterface
{
  /** Current capability snapshot. */
  snapshot = $state<CapabilitySnapshot>({
    isComplete: false,
    textStatus: 'pending',
    imageStatus: 'pending',
    voiceStatus: 'detected',
    summary: 'Detecting AI providers...',
  });

  /** Whether detection is currently running. */
  isDetecting = $state(false);

  /** Whether the guided cloud connection modal is visible. */
  showCloudSetup = $state(false);

  /** Selected cloud provider ID for guided setup. */
  selectedCloudProvider = $state('openrouter');

  /** Temporary API key for the guided setup input field. */
  tempApiKey = $state('');

  /** Test result message (latency + success/error). */
  testResult = $state('');

  /** Whether a connection test is in progress. */
  isTesting = $state(false);

  /** Error message for display. */
  errorMessage = $state('');

  // ── Derived ──────────────────────────────────────────────────────────

  get localAiDetected(): boolean {
    return this.snapshot.textStatus === 'detected';
  }

  get cloudConfigured(): boolean {
    return this.snapshot.textStatus === 'configured';
  }

  get selectedCloudProviderLabel(): string {
    const provider = TEXT_PROVIDERS.find((p) => p.id === this.selectedCloudProvider);
    return provider?.label ?? this.selectedCloudProvider;
  }

  get isCloudProviderOpenRouter(): boolean {
    return this.selectedCloudProvider === 'openrouter';
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    await this.startDetection();
    return super.initialize();
  }

  // ── Detection ────────────────────────────────────────────────────────

  /** Runs provider detection and updates the snapshot. */
  async startDetection(): Promise<void> {
    if (this.isDetecting) {
      return;
    }

    this.isDetecting = true;

    try {
      const result = await capabilityService.detect();
      this.snapshot = result;
      this.debug('startDetection:complete', {
        textStatus: result.textStatus,
        imageStatus: result.imageStatus,
      });
    } catch (error) {
      this.warn('startDetection:failed', error);
      this.snapshot = {
        ...this.snapshot,
        isComplete: true,
        textStatus: 'error',
        imageStatus: 'error',
        summary: 'Detection error — offline demo available',
      };
    } finally {
      this.isDetecting = false;
    }
  }

  // ── Path selection ───────────────────────────────────────────────────

  /**
   * "Play Offline Demo" — creates campaign with no AI providers.
   * Proceeds directly to character onboarding (/setup).
   */
  async selectOfflineDemo(): Promise<void> {
    this.debug('selectOfflineDemo');
    await this._startCampaign({
      textProvider: false,
      imageProvider: false,
      voiceProvider: false,
    });
  }

  /**
   * "Use Detected Local AI" — creates campaign with text AI enabled.
   */
  async selectLocalAi(): Promise<void> {
    this.debug('selectLocalAi');
    await this._startCampaign({
      textProvider: true,
      imageProvider: this.snapshot.imageStatus === 'detected',
      voiceProvider: false,
    });
  }

  /**
   * Opens the guided cloud connection modal.
   * Defaults to 'openrouter' as the most user-friendly cloud option.
   */
  openCloudSetup(providerId?: string): void {
    this.selectedCloudProvider = providerId ?? 'openrouter';
    this.tempApiKey = '';
    this.testResult = '';
    this.showCloudSetup = true;
  }

  /** Closes the guided cloud connection modal. */
  closeCloudSetup(): void {
    this.showCloudSetup = false;
    this.tempApiKey = '';
    this.testResult = '';
  }

  /** Selects a cloud provider in the guided setup. */
  selectCloudProvider(providerId: string): void {
    this.selectedCloudProvider = providerId;
    this.testResult = '';
  }

  /**
   * Tests the cloud connection with the entered API key.
   * Shows latency and result inline.
   */
  async testCloudConnection(): Promise<void> {
    if (this.isTesting || !this.tempApiKey.trim()) {
      return;
    }

    this.isTesting = true;
    this.testResult = '';
    const startTime = performance.now();

    try {
      // Use the selected provider's model-fetch endpoint
      const providerConfig = PROVIDER_MODEL_FETCH[this.selectedCloudProvider];
      if (!providerConfig) {
        this.testResult = `✗ Provider ${this.selectedCloudProvider} not configured`;
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      // Build headers based on provider's auth configuration
      const headers: Record<string, string> = {};
      const { auth, extraHeaders } = providerConfig;
      if (auth.location === 'header') {
        const value = auth.prefix
          ? `${auth.prefix}${this.tempApiKey.trim()}`
          : this.tempApiKey.trim();
        headers[auth.name] = value;
      }
      if (extraHeaders) {
        Object.assign(headers, extraHeaders);
      }

      const response = await fetch(providerConfig.url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency = Math.round(performance.now() - startTime);

      if (response.ok) {
        const body = (await response.json()) as { data?: unknown[] };
        const modelCount = Array.isArray(body.data) ? body.data.length : 0;
        this.testResult = `✓ Connected — ${latency}ms, ${modelCount} models available`;
        this.debug('testCloudConnection:success', {
          provider: this.selectedCloudProvider,
          latency,
          modelCount,
        });
      } else {
        this.testResult = `✗ Connection failed (HTTP ${response.status})`;
        this.debug('testCloudConnection:bad-status', {
          provider: this.selectedCloudProvider,
          status: response.status,
        });
      }
    } catch (error) {
      const latency = Math.round(performance.now() - startTime);
      this.testResult = `✗ Connection failed — ${String(error).slice(0, 100)}`;
      this.debug('testCloudConnection:error', {
        provider: this.selectedCloudProvider,
        latency,
        error: String(error),
      });
    } finally {
      this.isTesting = false;
    }
  }

  /**
   * Saves the cloud API key to the encrypted vault and proceeds.
   * On success, creates campaign with text AI enabled.
   */
  async confirmCloudConnection(): Promise<void> {
    const key = this.tempApiKey.trim();
    if (!key) {
      this.errorMessage = 'Please enter an API key.';
      return;
    }

    try {
      // Encrypt and store the API key under the selected provider's ID
      await encrypt({ text: JSON.stringify({ apiKeys: { [this.selectedCloudProvider]: key } }) });
      this.debug('confirmCloudConnection:saved', { provider: this.selectedCloudProvider });

      this.showCloudSetup = false;

      await this._startCampaign({
        textProvider: true,
        imageProvider: false,
        voiceProvider: false,
      });
    } catch (error) {
      this.warn('confirmCloudConnection:failed', error);
      this.errorMessage =
        'Failed to store API key. Your browser may not support encryption (requires HTTPS or localhost).';
    }
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Creates a new campaign with the given capability profile and
   * navigates to character onboarding (/setup).
   */
  private async _startCampaign(profile: CapabilityProfile): Promise<void> {
    try {
      await campaignService.startNewCampaign();
      // Override capability profile on the already-created campaign
      if (campaignService.activeCampaign) {
        campaignService.activeCampaign.capabilityProfile = profile;
        // Direct assignment since the property is $state
        // The campaign was already persisted; update it
        await campaignService.saveCampaign();
      }

      await routerService.goToRoute('setup', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
    } catch (error) {
      this.error('_startCampaign:failed', error);
      this.errorMessage = 'Failed to create campaign. Please try again.';
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────

export const getCapabilityViewModel = (
  options: CapabilityViewModelOptions,
): CapabilityViewModelInterface => CapabilityViewModel.create(options);
