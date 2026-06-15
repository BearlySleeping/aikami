// apps/frontend/client/src/lib/views/app/boot/boot_diagnostics_view_model.svelte.ts
//
// ViewModel for the in-game boot diagnostics screen. Pings local AI providers
// (Ollama on :11434, ComfyUI on :8188) via the Tauri HTTP plugin to bypass
// CORS, and gates entry to the game loop until both are online.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';

// ── Types ──────────────────────────────────────────────────────────────

/** Connection status for a single AI provider. */
export type ProviderStatus = 'pending' | 'online' | 'offline';

export type BootDiagnosticsViewModelOptions = BaseViewModelOptions & {
  /** Callback fired when the player clicks the enabled "Initialize Core" button. */
  onBootComplete: () => void;
  /**
   * Injectable fetch implementation for provider pings.
   * Defaults to the Tauri HTTP plugin's fetch (bypasses CORS for localhost).
   * Tests can inject a mock to simulate online/offline responses.
   */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
};

export type BootDiagnosticsViewModelInterface = BaseViewModelInterface & {
  /** Ollama (Text AI) connection status. */
  readonly ollamaStatus: ProviderStatus;
  /** ComfyUI (Image AI) connection status. */
  readonly comfyStatus: ProviderStatus;
  /** Whether both providers are online and the player can proceed. */
  readonly canBoot: boolean;

  /** Manually re-run provider checks. Called automatically by the polling interval. */
  checkProviders(): Promise<void>;
  /** Starts a 3-second polling interval for provider checks. */
  startPolling(): void;
  /** Fires the onBootComplete callback to proceed past diagnostics. */
  initializeCore(): void;
};

// ── Constants ──────────────────────────────────────────────────────────

/** Ollama default API endpoint. */
const OLLAMA_URL = 'http://localhost:11434/' as const;

/** ComfyUI system stats endpoint. */
const COMFY_URL = 'http://localhost:8188/system_stats' as const;

/** Polling interval in milliseconds. */
const POLL_INTERVAL_MS = 3000;

// ── ViewModel ──────────────────────────────────────────────────────────

class BootDiagnosticsViewModel
  extends BaseViewModel<BootDiagnosticsViewModelOptions>
  implements BootDiagnosticsViewModelInterface
{
  /** Ollama connection status. */
  ollamaStatus = $state<ProviderStatus>('pending');

  /** ComfyUI connection status. */
  comfyStatus = $state<ProviderStatus>('pending');

  /** Interval ID for polling, cleared on dispose. */
  private _pollIntervalId: ReturnType<typeof setInterval> | undefined;

  /** Callback to proceed past diagnostics. */
  private readonly _onBootComplete: () => void;

  /** Injectable fetch implementation for provider pings. */
  private readonly _fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

  /** Flag tracking whether the Tauri fetch implementation has been loaded. */
  private _fetchResolved = false;

  constructor(options: BootDiagnosticsViewModelOptions) {
    super(options);
    this._onBootComplete = options.onBootComplete;
    this._fetchImpl = options.fetchImpl ?? this._tauriFetchLoader;
  }

  // ── Derived State ────────────────────────────────────────────────────

  get canBoot(): boolean {
    return this.ollamaStatus === 'online' && this.comfyStatus === 'online';
  }

  // ── Initialization ───────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Run the first check immediately
    await this.checkProviders();
    return super.initialize();
  }

  // ── Actions ──────────────────────────────────────────────────────────

  /** Pings Ollama and ComfyUI to determine their connection status. */
  async checkProviders(): Promise<void> {
    await Promise.all([this._checkOllama(), this._checkComfyUI()]);
  }

  /** Starts polling every 3 seconds. Safe to call multiple times. */
  startPolling(): void {
    if (this._pollIntervalId !== undefined) {
      return;
    }

    this._pollIntervalId = setInterval(() => {
      void this.checkProviders();
    }, POLL_INTERVAL_MS);
  }

  /** Fires the onBootComplete callback. Called when the player clicks "Initialize Core". */
  initializeCore(): void {
    if (!this.canBoot) {
      return;
    }

    this._onBootComplete();
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  override async dispose(): Promise<void> {
    if (this._pollIntervalId !== undefined) {
      clearInterval(this._pollIntervalId);
      this._pollIntervalId = undefined;
    }

    return super.dispose();
  }

  // ── Private Helpers ──────────────────────────────────────────────────

  /**
   * Pings the Ollama API endpoint.
   * Uses the Tauri HTTP plugin to bypass CORS. Falls back gracefully to
   * showing 'offline' if the plugin is not available or the request fails.
   */
  private async _checkOllama(): Promise<void> {
    try {
      const response = await this._tauriFetch(OLLAMA_URL);
      this.ollamaStatus = response.ok ? 'online' : 'offline';
    } catch {
      this.ollamaStatus = 'offline';
    }
  }

  /**
   * Pings the ComfyUI system_stats endpoint.
   * Uses the Tauri HTTP plugin to bypass CORS. Falls back gracefully to
   * showing 'offline' if the plugin is not available or the request fails.
   */
  private async _checkComfyUI(): Promise<void> {
    try {
      const response = await this._tauriFetch(COMFY_URL);
      this.comfyStatus = response.ok ? 'online' : 'offline';
    } catch {
      this.comfyStatus = 'offline';
    }
  }

  /**
   * Default fetch implementation — loads the Tauri HTTP plugin lazily.
   *
   * The plugin's fetch uses the native Rust HTTP stack, bypassing browser
   * CORS policies — essential for pinging localhost from the webview.
   * If running outside Tauri (e.g. browser dev mode), this will throw and
   * the caller must handle the error gracefully.
   */
  private readonly _tauriFetchLoader = async (
    url: string,
    _init?: RequestInit,
  ): Promise<Response> => {
    if (!this._fetchResolved) {
      const module = await import('@tauri-apps/plugin-http');
      this._fetchResolved = true;

      return module.fetch(url, {
        method: 'GET',
        connectTimeout: 3000,
      });
    }

    const module = await import('@tauri-apps/plugin-http');
    return module.fetch(url, {
      method: 'GET',
      connectTimeout: 3000,
    });
  };

  /**
   * Performs an HTTP GET request via the injectable fetch implementation.
   */
  private async _tauriFetch(url: string): Promise<Response> {
    return this._fetchImpl(url, { method: 'GET' });
  }
}

// ── Factory ────────────────────────────────────────────────────────────

export const getBootDiagnosticsViewModel = (
  options: BootDiagnosticsViewModelOptions,
): BootDiagnosticsViewModelInterface => BootDiagnosticsViewModel.create(options);
