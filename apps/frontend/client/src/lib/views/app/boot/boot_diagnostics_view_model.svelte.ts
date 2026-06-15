// apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.svelte
//
// ViewModel for the in-game boot diagnostics screen. Pings AI providers
// to determine connectivity. Text providers (Ollama, OpenRouter) and Image
// providers (ComfyUI) are checked; Voice defaults to online (Kokoro WebGPU).
//
// Ollama is pinged via native fetch (CORS-limited in browser mode;
// requires Tauri or Ollama running with CORS headers to show online).
// ComfyUI is pinged via the Vite dev proxy (/api/image) matching the
// LocalServiceDetector pattern used in the settings/config system.
// OpenRouter verifies configuration via aiSettingsService.
//
// Gate: only Text provider must be online. Image/Voice are optional.
//
// Contract: C-130 (origin), C-133 (flexible provider onboarding)

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { aiSettingsService } from '$services';

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

const OLLAMA_URL = 'http://localhost:11434/' as const;
const COMFY_PROXY_PATH = '/api/image/object_info' as const;
const POLL_INTERVAL_MS = 3000;
const PING_TIMEOUT_MS = 3000;

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
    if (this.activeTextProvider === 'ollama') {
      return this._checkOllama();
    }
    return this._checkOpenRouter();
  }

  /**
   * Pings Ollama via native fetch with manual abort timeout.
   * In browser mode CORS will block → caught → offline.
   */
  private async _checkOllama(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      const response = await fetch(OLLAMA_URL, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      this.textStatus = response.ok ? 'online' : 'offline';
    } catch {
      this.textStatus = 'offline';
    }
  }

  /**
   * Validates OpenRouter configuration via aiSettingsService.
   * Checks for a configured API key or endpoint+model combination.
   */
  private async _checkOpenRouter(): Promise<void> {
    try {
      const { textProvider } = aiSettingsService;
      if (textProvider.apiKey || (textProvider.endpoint && textProvider.model)) {
        this.textStatus = 'online';
        return;
      }
      this.textStatus = 'unconfigured';
    } catch {
      this.textStatus = 'unconfigured';
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
    return this._checkComfyUI();
  }

  /**
   * Checks ComfyUI availability.
   *
   * First checks aiSettingsService.imageProvider configuration
   * (matches the OpenRouter pattern). If configured, treats as online.
   * Otherwise falls back to a health check via the Vite dev proxy.
   */
  private async _checkComfyUI(): Promise<void> {
    // Check if image provider is already configured in settings
    try {
      const { imageProvider } = aiSettingsService;
      if (imageProvider.endpoint || imageProvider.model) {
        this.imageStatus = 'online';
        return;
      }
    } catch {
      // Fall through to proxy check
    }

    // Health check via Vite dev proxy (same-origin, no CORS issues)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
      const response = await fetch(COMFY_PROXY_PATH, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      this.imageStatus = response.status < 500 ? 'online' : 'offline';
    } catch {
      this.imageStatus = 'offline';
    }
  }
}

// ── Factory ────────────────────────────────────────────────────────────

export const getBootDiagnosticsViewModel = (
  options: BootDiagnosticsViewModelOptions,
): BootDiagnosticsViewModelInterface => BootDiagnosticsViewModel.create(options);
