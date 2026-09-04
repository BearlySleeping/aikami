// apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts
//
// ViewModel for the pre-game capability detection screen.
// C-466: rebuilt on AiSettingsViewModel — connection editing now uses
// the shared AI settings component instead of the legacy ConnectionManager.
//
// Shows tabs (Text | Image | Voice), auto-detects local services,
// auto-seeds connections, and starts the campaign through a unified
// connection list with cloud/local icons and source badges.
// Contract: C-318 (origin), C-323 (offline demo removed, text AI gate)

import { TEXT_PROVIDERS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CapabilityProfile, CapabilitySnapshot } from '@aikami/types';
import {
  campaignService,
  capabilityService,
  configService,
  IMAGE_PROVIDERS,
  routerService,
  runtimeConfigService,
  VOICE_PROVIDERS,
  voiceModelService,
} from '$services';
import type { Connection, ConnectionCapability, VoiceModelState } from '$types';
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_VOICE_OPTIONS } from '$types';
import {
  type AiSettingsViewModelInterface,
  getAiSettingsViewModel,
} from '$views/settings/ai/ai_settings_view_model.svelte';

// ── Types ──────────────────────────────────────────────────────────────

export type ConnectionEntry = {
  connection: Connection;
  /** 🖥️ for local, ☁️ for cloud. */
  icon: string;
  /** Human-readable provider label. */
  providerLabel: string;
  /** Whether this is the default connection. */
  isDefault: boolean;
  /** Source badge label, e.g. "env: OPENROUTER_API_KEY" or "stored" or undefined. */
  sourceBadge?: string;
};

export type CapabilityViewModelInterface = BaseViewModelInterface & {
  /** Current capability snapshot from detection. */
  readonly snapshot: CapabilitySnapshot;
  /** Whether detection is currently running. */
  readonly isDetecting: boolean;
  /** Currently active tab. */
  readonly activeTab: ConnectionCapability;
  /** Error message to display, or empty string. */
  readonly errorMessage: string;
  /** Unified connection entries filtered by active tab. */
  readonly connectionEntries: readonly ConnectionEntry[];
  /** All tabs for the UI with checkmark when a provider is configured. */
  readonly tabs: readonly { id: ConnectionCapability; label: string; hasProvider: boolean }[];
  /** Whether at least one text provider is configured (required to start). */
  readonly hasTextProvider: boolean;
  /** Whether at least one image provider is configured. */
  readonly hasImageProvider: boolean;
  /** Whether at least one voice provider is configured. */
  readonly hasVoiceProvider: boolean;
  /** AiSettingsViewModel for rendering the shared AI settings component (C-466). */
  readonly aiSettingsViewModel: AiSettingsViewModelInterface;

  /** Starts provider detection. Called on initialization. */
  startDetection(): Promise<void>;
  /** Switches to a different tab. */
  setActiveTab(tab: ConnectionCapability): void;
  /** Sets a connection as default (does NOT navigate). */
  setDefaultConnection(connectionId: string): void;
  /** Starts the campaign and navigates to /setup. */
  startCampaign(): Promise<void>;

  // ── Voice model download (C-449 AC-2) ──
  /** Whether to show the local voice model download section in the Voice tab. */
  readonly showVoiceLocalDownload: boolean;
  /** Voice model download state (mirrored from voiceModelService). */
  readonly voiceModelState: VoiceModelState;
  /** Voice model download progress (0–100). */
  readonly voiceModelProgress: number;
  /** Voice model size label. */
  readonly voiceModelSizeLabel: string;
  /** Starts (or joins) the explicit voice model download. */
  downloadVoiceModel(): Promise<void>;
  /** Cancels an in-flight voice model download. */
  cancelVoiceModelDownload(): void;
};

export type CapabilityViewModelOptions = BaseViewModelOptions;

// ── Constants ──────────────────────────────────────────────────────────

const LOCAL_PROVIDERS = new Set([
  'ollama',
  'llamacpp',
  'ooba',
  'comfyui',
  'webui',
  'kokoro',
  'voicevox',
]);

const CAPABILITY_TABS: readonly { id: ConnectionCapability; label: string }[] = [
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Image' },
  { id: 'voice', label: 'Voice' },
];

// ── ViewModel ──────────────────────────────────────────────────────────

class CapabilityViewModel
  extends BaseViewModel<CapabilityViewModelOptions>
  implements CapabilityViewModelInterface
{
  snapshot = $state<CapabilitySnapshot>({
    isComplete: false,
    textStatus: 'pending',
    imageStatus: 'pending',
    voiceStatus: 'pending',
    summary: 'Connect an AI provider to get started.',
  });

  isDetecting = $state(false);
  activeTab = $state<ConnectionCapability>('text');
  errorMessage = $state('');

  /** Shared AI settings ViewModel for connection management (C-466). */
  readonly aiSettingsViewModel: AiSettingsViewModelInterface;

  constructor(options: CapabilityViewModelOptions) {
    super(options);

    this.aiSettingsViewModel = getAiSettingsViewModel({
      className: 'CapabilityAiSettingsViewModel',
    });
  }

  // ── Derived ──────────────────────────────────────────────────────────

  /** Tabs with per-tab checkmark when at least one usable provider exists. */
  get tabs(): readonly { id: ConnectionCapability; label: string; hasProvider: boolean }[] {
    const connections = ((configService.state.connections ?? []) as Connection[]).filter((c) =>
      this._isUsableConnection(c),
    );
    return CAPABILITY_TABS.map((tab) => ({
      ...tab,
      hasProvider: connections.some((c) => (c.capability ?? 'text') === tab.id),
    }));
  }

  /** True when at least one usable text connection exists. */
  get hasTextProvider(): boolean {
    const connections = ((configService.state.connections ?? []) as Connection[]).filter((c) =>
      this._isUsableConnection(c),
    );
    return connections.some((c) => (c.capability ?? 'text') === 'text');
  }

  /** True when at least one usable image connection exists. */
  get hasImageProvider(): boolean {
    const connections = ((configService.state.connections ?? []) as Connection[]).filter((c) =>
      this._isUsableConnection(c),
    );
    return connections.some((c) => (c.capability ?? 'text') === 'image');
  }

  /** True when at least one usable voice connection exists. */
  get hasVoiceProvider(): boolean {
    const connections = ((configService.state.connections ?? []) as Connection[]).filter((c) =>
      this._isUsableConnection(c),
    );
    return connections.some((c) => (c.capability ?? 'text') === 'voice');
  }

  get connectionEntries(): readonly ConnectionEntry[] {
    const connections = configService.state.connections;
    if (!connections || connections.length === 0) {
      return [];
    }

    const defaultByCap = configService.state.defaultByCapability ?? {};
    const capDefault = defaultByCap[this.activeTab] ?? null;

    return (connections as Connection[])
      .filter((c) => (c.capability ?? 'text') === this.activeTab)
      .filter((c) => this._isUsableConnection(c))
      .map((connection) => {
        const isDefault = connection.id === capDefault;
        return {
          connection,
          icon: LOCAL_PROVIDERS.has(connection.provider) ? '🖥️' : '☁️',
          providerLabel: this._providerLabel(connection),
          isDefault,
          sourceBadge: this._sourceBadge(connection),
        };
      });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    return super.initialize();
  }

  // ── Tab navigation ───────────────────────────────────────────────────

  setActiveTab(tab: ConnectionCapability): void {
    this.activeTab = tab;
  }

  // ── Detection ────────────────────────────────────────────────────────

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
        voiceStatus: result.voiceStatus,
      });

      this._seedDetectedConnections(result);
      this._ensureAllDefaults();
    } catch (error) {
      this.warn('startDetection:failed', error);
      this.snapshot = {
        ...this.snapshot,
        isComplete: true,
        textStatus: 'error',
        imageStatus: 'error',
        voiceStatus: 'error',
        summary: 'Detection error — offline demo available',
      };
    } finally {
      this.isDetecting = false;
    }
  }

  // ── Connection selection ─────────────────────────────────────────────

  /** Sets a connection as default without navigating. */
  setDefaultConnection(connectionId: string): void {
    configService.setDefaultConnection(connectionId);
    void configService.save();
  }

  // ── Campaign start ───────────────────────────────────────────────────

  async startCampaign(): Promise<void> {
    this.debug('startCampaign');
    await this._startCampaign({
      textProvider: this.hasTextProvider,
      imageProvider: this.hasImageProvider,
      voiceProvider: this.hasVoiceProvider,
    });
  }

  // ── Voice model download (C-449 AC-2) ────────────────────────────────

  /** Show local download section in Voice tab when no cloud voice provider is configured. */
  get showVoiceLocalDownload(): boolean {
    return this.activeTab === 'voice' && !this.hasVoiceProvider;
  }

  get voiceModelState(): VoiceModelState {
    return voiceModelService.state;
  }

  get voiceModelProgress(): number {
    const state = voiceModelService.state;
    if (state.status === 'downloading') {
      return Math.round((state.receivedBytes / Math.max(1, state.totalBytes)) * 100);
    }
    if (state.status === 'verifying') {
      return 100;
    }
    return 0;
  }

  get voiceModelSizeLabel(): string {
    const bytes = voiceModelService.totalBytes;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async downloadVoiceModel(): Promise<void> {
    if (!navigator.onLine) {
      this.errorMessage =
        'Cannot download: you appear to be offline. Please check your connection and try again.';
      return;
    }
    try {
      const state = await voiceModelService.download();
      if (state.status === 'ready') {
        this.errorMessage = '';
      } else if (state.status === 'error') {
        this.errorMessage = state.message ?? 'Download failed';
      } else if (state.status === 'not-downloaded') {
        this.errorMessage = '';
      } else {
        this.errorMessage = 'Download failed';
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.errorMessage = `Download failed: ${message}`;
      this.warn('downloadVoiceModel:failed', error);
    }
  }

  cancelVoiceModelDownload(): void {
    voiceModelService.cancel();
  }

  // ── Private helpers ──────────────────────────────────────────────────

  /**
   * Ensures every capability with at least one connection has a default
   * selected. Falls back to the first connection when none is set.
   */
  private _ensureAllDefaults(): void {
    const connections = configService.state.connections ?? [];
    const defaultByCap = configService.state.defaultByCapability ?? {};
    let changed = false;

    for (const capability of CAPABILITY_TABS) {
      const capConnections = (connections as Connection[]).filter(
        (c) => (c.capability ?? 'text') === capability.id && this._isUsableConnection(c),
      );
      if (capConnections.length === 0) {
        continue;
      }

      const currentDefault = defaultByCap[capability.id];
      const stillExists = currentDefault
        ? capConnections.some((c) => c.id === currentDefault)
        : false;

      if (!stillExists) {
        configService.setDefaultConnection(capConnections[0].id);
        changed = true;
      }
    }

    if (changed) {
      void configService.save();
    }
  }

  /** Resolves a human-readable label for any connection provider, regardless of capability. */
  private _providerLabel(connection: Connection): string {
    const capability = connection.capability ?? 'text';
    if (capability === 'image') {
      return (
        IMAGE_PROVIDERS.find((p) => p.id === connection.provider)?.label ?? connection.provider
      );
    }
    if (capability === 'voice') {
      return (
        VOICE_PROVIDERS.find((p) => p.id === connection.provider)?.label ?? connection.provider
      );
    }
    return TEXT_PROVIDERS.find((p) => p.id === connection.provider)?.label ?? connection.provider;
  }

  /**
   * Filters out phantom connections that appear usable but have no actual
   * credentials. Cloud providers seeded from env with empty API keys are
   * hidden until the user provides a real key.
   */
  private _isUsableConnection(connection: Connection): boolean {
    if (LOCAL_PROVIDERS.has(connection.provider)) {
      return true;
    }
    return (connection.apiKey?.trim().length ?? 0) > 0;
  }

  private _sourceBadge(connection: Connection): string | undefined {
    switch (connection.source) {
      case 'detected':
        return 'detected';
      case 'env': {
        const provider = TEXT_PROVIDERS.find((p) => p.id === connection.provider);
        if (!provider || provider.isLocal) {
          return undefined;
        }
        const envName = this._guessEnvKeyName(connection.provider);
        return envName ? `env: ${envName}` : 'env';
      }
      case 'stored':
        return 'stored';
      default:
        return undefined;
    }
  }

  private _guessEnvKeyName(provider: string): string | undefined {
    const mapping: Record<string, string> = {
      openrouter: 'OPENROUTER_API_KEY',
      openai: 'OPENAI_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      deepseek: 'DEEPSEEK_API_KEY',
      google: 'GEMINI_API_KEY',
      mistral: 'MISTRAL_API_KEY',
    };
    return mapping[provider];
  }

  // ── Private: auto-seed detected connections ──────────────────────────

  /**
   * Prunes stale auto-seeded connections from previous sessions and seeds
   * fresh connections for currently detected providers.
   */
  private _seedDetectedConnections(result: CapabilitySnapshot): void {
    const fresh = configService.state.connections.filter((c) => c.source !== 'detected');
    if (fresh.length !== configService.state.connections.length) {
      configService.state.connections = fresh;
    }

    if (result.textStatus === 'detected' && result.textProviderId === 'ollama') {
      const textBaseUrl = runtimeConfigService.getTextUrl();
      this._seedConnection({
        capability: 'text',
        provider: 'ollama',
        name: 'Ollama (local)',
        model: result.textModelName ?? '',
        baseUrl: textBaseUrl ?? '',
      });
    } else if (result.textStatus === 'detected' && result.textProviderId === 'llamacpp') {
      const textBaseUrl = runtimeConfigService.getTextUrl();
      this._seedConnection({
        capability: 'text',
        provider: 'llamacpp',
        name: 'llama.cpp (local)',
        model: result.textModelName ?? '',
        baseUrl: textBaseUrl ?? '',
      });
    }

    if (result.imageStatus === 'detected') {
      const imageBaseUrl = runtimeConfigService.getImageUrl();
      this._seedConnection({
        capability: 'image',
        provider: 'comfyui',
        name: 'ComfyUI (local)',
        model: '',
        baseUrl: imageBaseUrl ?? '',
        imageOptions: { ...DEFAULT_IMAGE_OPTIONS },
      });
    }

    if (result.voiceStatus === 'detected') {
      this._seedConnection({
        capability: 'voice',
        provider: 'kokoro',
        name: 'Kokoro (local)',
        model: '',
        baseUrl: '',
        voiceOptions: { ...DEFAULT_VOICE_OPTIONS },
      });
    }
  }

  private _seedConnection(params: {
    capability: ConnectionCapability;
    provider: string;
    name: string;
    model: string;
    baseUrl: string;
    imageOptions?: typeof DEFAULT_IMAGE_OPTIONS;
    voiceOptions?: typeof DEFAULT_VOICE_OPTIONS;
  }): void {
    const { capability, provider, name, model, baseUrl, imageOptions, voiceOptions } = params;
    const connections = configService.state.connections ?? [];
    const exists = connections.some(
      (c) => c.provider === provider && (c.capability ?? 'text') === capability,
    );
    if (exists) {
      return;
    }

    this.debug('_seedConnection', { capability, provider, model });
    const newId = configService.addConnection({
      name,
      provider,
      capability,
      apiKey: '',
      baseUrl,
      model,
      generationParams: {
        temperature: 0.7,
        topP: 0.95,
        topK: 40,
        repetitionPenalty: 1,
        presencePenalty: 0,
        maxTokens: 1024,
        contextSize: 4096,
      },
      imageOptions,
      voiceOptions,
      isDefault: connections.length === 0,
      source: 'detected',
    });

    const capDefault = configService.state.defaultByCapability?.[capability];
    if (!capDefault) {
      configService.setDefaultConnection(newId);
    }

    void configService.save();
  }

  // ── Private: campaign start ──────────────────────────────────────────

  private async _startCampaign(profile: CapabilityProfile): Promise<void> {
    try {
      await campaignService.startNewCampaign({ capabilityProfile: profile });

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
