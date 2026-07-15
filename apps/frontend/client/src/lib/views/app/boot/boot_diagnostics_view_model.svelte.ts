// apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.svelte
//
// ViewModel for the in-game boot diagnostics screen. Delegates provider
// detection to CapabilityService (C-318) for shared logic between the
// pre-game capability screen and in-game diagnostics.
//
// Gate: only Text provider must be online. Image/Voice are optional.
//
// Contract: C-130 (origin), C-133 (flexible provider onboarding), C-318 (capability delegation)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { DetectionStatus } from '@aikami/types';
import { aiSettingsService, capabilityService } from '$services';

// ── Types ──────────────────────────────────────────────────────────────

export type ActiveTextProvider = 'ollama' | 'openrouter';
export type ActiveImageProvider = 'comfyui' | 'cloud' | 'none';

export type ProviderStatus = 'pending' | 'online' | 'offline' | 'unconfigured' | 'disabled';

export type BootDiagnosticsViewModelOptions = BaseViewModelOptions & {
  onBootComplete: () => void;
};

export type BootDiagnosticsViewModelInterface = BaseViewModelInterface & {
  readonly activeTextProvider: ActiveTextProvider;
  readonly activeImageProvider: ActiveImageProvider;
  readonly textStatus: ProviderStatus;
  readonly imageStatus: ProviderStatus;
  readonly voiceStatus: ProviderStatus;
  readonly canBoot: boolean;
  /** Temporary OpenRouter API key bound to the inline input field. */
  tempOpenRouterKey: string;

  checkProviders(): Promise<void>;
  startPolling(): void;
  initializeCore(): void;
  setActiveTextProvider(provider: ActiveTextProvider): void;
  setActiveImageProvider(provider: ActiveImageProvider): void;
  /** Persists tempOpenRouterKey to aiSettingsService and re-checks providers. */
  saveOpenRouterKey(): Promise<void>;
};

// ── Constants ──────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 3000;

/** Maps CapabilityService DetectionStatus to the ProviderStatus used by this ViewModel. */
const mapDetectionStatus = (s: DetectionStatus): ProviderStatus => {
  switch (s) {
    case 'detected':
    case 'configured':
      return 'online';
    case 'not_found':
    case 'error':
    case 'skipped':
      return 'offline';
    case 'pending':
      return 'pending';
  }
};

// ── ViewModel ──────────────────────────────────────────────────────────

class BootDiagnosticsViewModel
  extends BaseViewModel<BootDiagnosticsViewModelOptions>
  implements BootDiagnosticsViewModelInterface
{
  activeTextProvider = $state<ActiveTextProvider>('ollama');
  activeImageProvider = $state<ActiveImageProvider>('comfyui');
  textStatus = $state<ProviderStatus>('pending');
  imageStatus = $state<ProviderStatus>('pending');
  voiceStatus = $state<ProviderStatus>('online');
  /** Bound to the inline OpenRouter API key input field. */
  tempOpenRouterKey = $state('');

  private _pollIntervalId: ReturnType<typeof setInterval> | undefined;
  private readonly _onBootComplete: () => void;

  constructor(options: BootDiagnosticsViewModelOptions) {
    super(options);
    this._onBootComplete = options.onBootComplete;
  }

  // ── Derived ──────────────────────────────────────────────────────────

  get canBoot(): boolean {
    return this.textStatus === 'online';
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    await this.checkProviders();
    return super.initialize();
  }

  override async dispose(): Promise<void> {
    if (this._pollIntervalId !== undefined) {
      clearInterval(this._pollIntervalId);
      this._pollIntervalId = undefined;
    }
    return super.dispose();
  }

  // ── Provider switching ───────────────────────────────────────────────

  setActiveTextProvider(provider: ActiveTextProvider): void {
    this.activeTextProvider = provider;

    // Auto-populate tempOpenRouterKey from environment when switching
    // to OpenRouter, so the inline input is pre-filled for dev convenience.
    if (provider === 'openrouter' && !this.tempOpenRouterKey) {
      this._prefillOpenRouterKeyFromEnv();
    }

    void this.checkProviders();
  }

  setActiveImageProvider(provider: ActiveImageProvider): void {
    this.activeImageProvider = provider;
    void this.checkProviders();
  }

  /**
   * Persists tempOpenRouterKey as the OpenRouter API key via
   * aiSettingsService, then re-checks providers to update status.
   */
  async saveOpenRouterKey(): Promise<void> {
    const key = this.tempOpenRouterKey.trim();
    if (!key) {
      return;
    }

    try {
      aiSettingsService.setTextProvider({ apiKey: key });
      await aiSettingsService.saveToVault();
    } catch (err) {
      this.debug('saveOpenRouterKey:save-failed', { error: String(err) });
    }

    this.tempOpenRouterKey = '';
    await this.checkProviders();
  }

  /**
   * Reads the OpenRouter API key from the environment (Vite env vars)
   * and pre-fills the tempOpenRouterKey field.
   */
  private _prefillOpenRouterKeyFromEnv(): void {
    try {
      const env = import.meta.env as Record<string, string | undefined>;
      const key = env.PUBLIC_OPENROUTER_API_KEY;
      if (key && key.length > 0) {
        this.tempOpenRouterKey = key;
      }
    } catch {
      // import.meta.env unavailable (e.g. test environment)
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────

  /**
   * Pings the active text and image providers independently.
   *
   * Uses Promise.allSettled with per-check timeouts so a hanging check
   * (e.g. blocked CORS preflight) does not suppress the other result.
   */
  async checkProviders(): Promise<void> {
    await Promise.allSettled([this._checkTextProvider(), this._checkImageProvider()]);
  }

  startPolling(): void {
    if (this._pollIntervalId !== undefined) {
      return;
    }
    this._pollIntervalId = setInterval(() => {
      void this.checkProviders();
    }, POLL_INTERVAL_MS);
  }

  initializeCore(): void {
    if (!this.canBoot) {
      return;
    }
    this._onBootComplete();
  }

  // ── Private: text checks ─────────────────────────────────────────────

  private async _checkTextProvider(): Promise<void> {
    try {
      const status = await capabilityService.detectText();
      this.textStatus = mapDetectionStatus(status);
    } catch {
      this.textStatus = 'offline';
    }
  }

  // ── Private: image checks ────────────────────────────────────────────

  private async _checkImageProvider(): Promise<void> {
    if (this.activeImageProvider === 'none') {
      this.imageStatus = 'disabled';
      return;
    }
    if (this.activeImageProvider === 'cloud') {
      this.imageStatus = 'online';
      return;
    }

    try {
      const status = await capabilityService.detectImage();
      this.imageStatus = mapDetectionStatus(status);
    } catch {
      this.imageStatus = 'offline';
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────

export const getBootDiagnosticsViewModel = (
  options: BootDiagnosticsViewModelOptions,
): BootDiagnosticsViewModelInterface => BootDiagnosticsViewModel.create(options);
