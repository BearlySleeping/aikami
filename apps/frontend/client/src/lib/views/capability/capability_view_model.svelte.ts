// apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts
//
// ViewModel for the pre-game capability detection screen.
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
  VOICE_PROVIDERS,
} from '$services';
import type { Connection, ConnectionCapability } from '$types';
import { DEFAULT_IMAGE_OPTIONS, DEFAULT_VOICE_OPTIONS } from '$types';
import type { ConnectionManagerViewModelInterface } from '$views/settings/connection/connection_manager_view_model.svelte';
import { getConnectionManagerViewModel } from '$views/settings/connection/connection_manager_view_model.svelte';

// ── Types ──────────────────────────────────────────────────────────────

/** Connection entry info passed from ViewModel to View for rendering a row. */
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
  /** Whether the guided cloud connection modal is visible. */
  readonly showCloudSetup: boolean;
  /** Error message to display, or empty string. */
  readonly errorMessage: string;
  /** Unified connection entries filtered by active tab. */
  readonly connectionEntries: readonly ConnectionEntry[];
  /** All tabs for the UI with checkmark when a provider is configured. */
  readonly tabs: readonly { id: ConnectionCapability; label: string; hasProvider: boolean }[];
  /** Whether at least one text provider is configured (required to start). */
  readonly hasTextProvider: boolean;
  /** ViewModel for the cloud connection editor panel. */
  readonly cloudConnectionVm: ConnectionManagerViewModelInterface;

  /** Starts provider detection. Called on initialization. */
  startDetection(): Promise<void>;
  /** Switches to a different tab. */
  setActiveTab(tab: ConnectionCapability): void;
  /** Sets a connection as default (does NOT navigate). */
  setDefaultConnection(connectionId: string): void;
  /** Opens the connection editor pre-filled for an existing connection. */
  editConnection(connectionId: string): void;
  /** Opens the guided cloud connection modal for the active tab's capability. */
  openCloudSetup(): void;
  /** Closes the guided cloud connection modal. */
  closeCloudSetup(): void;
  /** Starts the campaign and navigates to /setup. */
  startCampaign(): Promise<void>;
};

export type CapabilityViewModelOptions = BaseViewModelOptions;

// ── Constants ──────────────────────────────────────────────────────────

const LOCAL_PROVIDERS = new Set(['ollama', 'ooba', 'comfyui', 'webui', 'kokoro', 'voicevox']);

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
    voiceStatus: 'detected',
    summary: 'Detecting AI providers...',
  });

  isDetecting = $state(false);
  activeTab = $state<ConnectionCapability>('text');
  showCloudSetup = $state(false);
  errorMessage = $state('');

  cloudConnectionVm: ConnectionManagerViewModelInterface;

  constructor(options: CapabilityViewModelOptions) {
    super(options);
    this.cloudConnectionVm = getConnectionManagerViewModel({
      className: 'CloudConnectionViewModel',
    });

    $effect(() => {
      void this.cloudConnectionVm.isEditorOpen;
      if (!this.cloudConnectionVm.isEditorOpen && this.showCloudSetup) {
        this._handleEditorClosed();
      }
    });

    // When the connection list changes (add/edit/delete), re-ensure defaults
    $effect(() => {
      void configService.state.connections;
      this._ensureAllDefaults();
    });
  }

  // ── Derived ──────────────────────────────────────────────────────────

  /** Tabs with per-tab checkmark when at least one provider exists. */
  get tabs(): readonly { id: ConnectionCapability; label: string; hasProvider: boolean }[] {
    const connections = configService.state.connections ?? [];
    return CAPABILITY_TABS.map((tab) => ({
      ...tab,
      hasProvider: connections.some((c) => (c.capability ?? 'text') === tab.id),
    }));
  }

  /** True when at least one text connection exists — required to start. */
  get hasTextProvider(): boolean {
    const connections = configService.state.connections ?? [];
    return connections.some((c) => (c.capability ?? 'text') === 'text');
  }

  /** True when at least one image connection exists. */
  get hasImageProvider(): boolean {
    const connections = configService.state.connections ?? [];
    return connections.some((c) => (c.capability ?? 'text') === 'image');
  }

  /** True when at least one voice connection exists. */
  get hasVoiceProvider(): boolean {
    const connections = configService.state.connections ?? [];
    return connections.some((c) => (c.capability ?? 'text') === 'voice');
  }

  get connectionEntries(): readonly ConnectionEntry[] {
    const connections = configService.state.connections;
    if (!connections || connections.length === 0) {
      return [];
    }

    const defaultByCap = configService.state.defaultByCapability ?? {};
    const capDefault = defaultByCap[this.activeTab] ?? null;

    return connections
      .filter((c) => (c.capability ?? 'text') === this.activeTab)
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
    await this.startDetection();
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

  /** Opens the connection editor pre-filled for an existing connection. */
  editConnection(connectionId: string): void {
    this.cloudConnectionVm.openEdit(connectionId);
    this.showCloudSetup = true;
  }

  /** Starts the campaign and navigates to /setup. */
  async startCampaign(): Promise<void> {
    this.debug('startCampaign');
    await this._startCampaign({
      textProvider: this.hasTextProvider,
      imageProvider: this.hasImageProvider,
      voiceProvider: this.hasVoiceProvider,
    });
  }

  openCloudSetup(): void {
    this.cloudConnectionVm.openCreateFor(this.activeTab);
    this.showCloudSetup = true;
  }

  closeCloudSetup(): void {
    this.cloudConnectionVm.cancelEdit();
    this.showCloudSetup = false;
  }

  private _handleEditorClosed(): void {
    this.showCloudSetup = false;
    this._ensureAllDefaults();
  }

  /**
   * Ensures every capability with at least one connection has a default
   * selected. Falls back to the first connection when none is set.
   * Called on initial detection and when the connection list mutates.
   */
  private _ensureAllDefaults(): void {
    const connections = configService.state.connections ?? [];
    const defaultByCap = configService.state.defaultByCapability ?? {};
    let changed = false;

    for (const capability of CAPABILITY_TABS) {
      const capConnections = connections.filter((c) => (c.capability ?? 'text') === capability.id);
      if (capConnections.length === 0) {
        continue;
      }

      const currentDefault = defaultByCap[capability.id];
      const stillExists = currentDefault
        ? capConnections.some((c) => c.id === currentDefault)
        : false;

      if (!stillExists) {
        // Pick the first connection for this capability as the new default
        configService.setDefaultConnection(capConnections[0].id);
        changed = true;
      }
    }

    if (changed) {
      void configService.save();
    }
  }

  // ── Private: provider labels ─────────────────────────────────────────

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

  // ── Private: source badges ───────────────────────────────────────────

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
      gemini: 'GEMINI_API_KEY',
      mistral: 'MISTRAL_API_KEY',
      cohere: 'COHERE_API_KEY',
    };
    return mapping[provider];
  }

  // ── Private: auto-seed detected connections ──────────────────────────

  private _seedDetectedConnections(result: CapabilitySnapshot): void {
    if (result.textStatus === 'detected' && result.textProviderId === 'ollama') {
      this._seedConnection({
        capability: 'text',
        provider: 'ollama',
        name: 'Ollama (local)',
        model: result.textModelName ?? '',
        baseUrl: 'http://localhost:11434/v1',
      });
    }

    if (result.imageStatus === 'detected') {
      this._seedConnection({
        capability: 'image',
        provider: 'comfyui',
        name: 'ComfyUI (local)',
        model: '',
        baseUrl: 'http://localhost:8188',
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

    // Set per-capability default if this is the first connection for its capability
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
      if (campaignService.activeCampaign) {
        campaignService.completeSetup();
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
