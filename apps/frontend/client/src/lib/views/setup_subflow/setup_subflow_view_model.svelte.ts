// apps/frontend/client/src/lib/views/setup_subflow/setup_subflow_view_model.svelte.ts
//
// Shared ViewModel for the focused setup subflow. Replaces the old
// capability_view + wizard with three entry paths (recommended, existing,
// text-only) over a single flow. Calls C-481's shared services directly.
// Contract: C-483 AC-1, AC-2, AC-3, AC-4, AC-5, AC-6

import { TEXT_PROVIDERS } from '@aikami/constants';
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CapabilitySnapshot, ConnectionEntry } from '@aikami/types';
import { capabilityService, configService, runtimeConfigService } from '$services';
import type { ConnectionCapability } from '$types';

// ── Types ──────────────────────────────────────────────────────────────

/** Entry path for the setup flow. */
export type SetupEntryPath = 'recommended' | 'existing' | 'text-only';

/** Step within the shared setup flow. */
export type SetupFlowStep =
  | 'idle'
  | 'entry'
  | 'detecting'
  | 'results'
  | 'plan'
  | 'applying'
  | 'ready'
  | 'error';

/** A discovered provider during scanning. */
export type DiscoveredProvider = {
  readonly provider: string;
  readonly capability: ConnectionCapability;
  readonly label: string;
  readonly isLocal: boolean;
  readonly isCompatible: boolean;
  readonly modelName: string | undefined;
  readonly baseUrl: string | undefined;
};

/** A capability toggle for the feature selection step. */
export type CapabilityToggle = {
  readonly id: ConnectionCapability;
  readonly label: string;
  readonly required: boolean;
  enabled: boolean;
  readonly description: string;
};

/** Summary of a plan step. */
export type PlanSummary = {
  readonly capabilities: readonly CapabilityToggle[];
  readonly providers: readonly DiscoveredProvider[];
  readonly totalDownloads: number;
  readonly totalBytes: number;
  readonly requiresOnline: boolean;
  readonly hasPaidServices: boolean;
  readonly resourceWarnings: readonly string[];
};

export type SetupSubflowViewModelInterface = BaseViewModelInterface & {
  /** Current flow step. */
  readonly step: SetupFlowStep;
  /** Selected entry path. */
  readonly entryPath: SetupEntryPath | null;
  /** Capability toggles for the feature selection. */
  readonly capabilityToggles: readonly CapabilityToggle[];
  /** Discovered providers after scanning. */
  readonly discoveredProviders: readonly DiscoveredProvider[];
  /** Plan summary for review. */
  readonly planSummary: PlanSummary | null;
  /** Error message to display. */
  readonly errorMessage: string;
  /** Whether detection is in progress. */
  readonly isDetecting: boolean;
  /** Whether applying is in progress. */
  readonly isApplying: boolean;
  /** Whether text is ready (required for start). */
  readonly isTextReady: boolean;
  /** Snapshot from capability detection. */
  readonly snapshot: CapabilitySnapshot | null;

  /** Selects an entry path. */
  selectEntryPath(path: SetupEntryPath): void;
  /** Toggles a capability on/off. */
  toggleCapability(capability: ConnectionCapability): void;
  /** Starts provider discovery. */
  startDiscovery(): Promise<void>;
  /** Applies the selected plan. */
  applyPlan(): Promise<void>;
  /** Goes back one step. */
  goBack(): void;
  /** Resets the flow. */
  reset(): void;
  /** Leaves setup (navigates away without losing state). */
  leave(): void;
  /** Retries after an error. */
  retry(): void;
};

export type SetupSubflowViewModelOptions = BaseViewModelOptions;

// ── Constants ──────────────────────────────────────────────────────────

const CAPABILITY_DEFINITIONS: readonly CapabilityToggle[] = [
  {
    id: 'text',
    label: 'Text (Story & Dialogue)',
    required: true,
    enabled: true,
    description: 'Required for all gameplay. Powers NPC dialogue, narration, and player actions.',
  },
  {
    id: 'image',
    label: 'Artwork (Scenes & Characters)',
    required: false,
    enabled: false,
    description: 'Generate character portraits, scene illustrations, and environment art.',
  },
  {
    id: 'voice',
    label: 'Read Aloud (Voice Narration)',
    required: false,
    enabled: false,
    description: 'Have the story read aloud with AI-generated speech.',
  },
];

const LOCAL_PROVIDER_IDS = new Set([
  'ollama',
  'llamacpp',
  'ooba',
  'comfyui',
  'webui',
  'kokoro',
  'voicevox',
]);

// ── ViewModel ──────────────────────────────────────────────────────────

class SetupSubflowViewModel
  extends BaseViewModel<SetupSubflowViewModelOptions>
  implements SetupSubflowViewModelInterface
{
  step = $state<SetupFlowStep>('entry');
  entryPath = $state<SetupEntryPath | null>(null);
  errorMessage = $state('');
  isDetecting = $state(false);
  isApplying = $state(false);
  snapshot = $state<CapabilitySnapshot | null>(null);

  // Selected capability toggles (mirror the definitions, user can enable optional ones).
  private _capabilityToggles = $state<CapabilityToggle[]>(
    CAPABILITY_DEFINITIONS.map((d) => ({ ...d })),
  );
  private _discoveredProviders = $state<DiscoveredProvider[]>([]);
  private _planSummary = $state<PlanSummary | null>(null);

  // ── Getters ────────────────────────────────────────────────────────────

  get capabilityToggles(): readonly CapabilityToggle[] {
    return this._capabilityToggles;
  }

  get discoveredProviders(): readonly DiscoveredProvider[] {
    return this._discoveredProviders;
  }

  get planSummary(): PlanSummary | null {
    return this._planSummary;
  }

  get isTextReady(): boolean {
    if (!this.snapshot) {
      return false;
    }
    return this.snapshot.textStatus === 'detected' || this.snapshot.textStatus === 'configured';
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  override async initialize(): Promise<void> {
    // Detect without auto-scanning — user must explicitly trigger.
    return super.initialize();
  }

  // ── Entry path selection ───────────────────────────────────────────────

  selectEntryPath(path: SetupEntryPath): void {
    this.entryPath = path;
    this.errorMessage = '';

    if (path === 'text-only') {
      // Text-only skips optional selection — go straight to applying text.
      this._capabilityToggles = this._capabilityToggles.map((t) => ({
        ...t,
        enabled: t.id === 'text',
      }));
      void this._applyTextOnly();
    } else {
      // Recommended or existing — show feature selection.
      this.step = 'results';
    }
  }

  toggleCapability(capability: ConnectionCapability): void {
    const toggle = this._capabilityToggles.find((t) => t.id === capability);
    if (toggle && !toggle.required) {
      toggle.enabled = !toggle.enabled;
    }
  }

  // ── Discovery ──────────────────────────────────────────────────────────

  async startDiscovery(): Promise<void> {
    if (this.isDetecting) {
      return;
    }

    this.isDetecting = true;
    this.errorMessage = '';
    this.step = 'detecting';

    try {
      const snapshot = await capabilityService.detect();
      this.snapshot = snapshot;

      // Build discovered providers from snapshot.
      const providers: DiscoveredProvider[] = [];
      if (snapshot.textStatus === 'detected' && snapshot.textProviderId) {
        providers.push({
          provider: snapshot.textProviderId,
          capability: 'text',
          label:
            TEXT_PROVIDERS.find((p) => p.id === snapshot.textProviderId)?.label ??
            snapshot.textProviderId,
          isLocal: LOCAL_PROVIDER_IDS.has(snapshot.textProviderId),
          isCompatible: true,
          modelName: snapshot.textModelName,
          baseUrl: runtimeConfigService.getTextUrl() ?? undefined,
        });
      }
      if (snapshot.imageStatus === 'detected') {
        providers.push({
          provider: 'comfyui',
          capability: 'image',
          label: 'ComfyUI (local)',
          isLocal: true,
          isCompatible: true,
          modelName: undefined,
          baseUrl: runtimeConfigService.getImageUrl() ?? undefined,
        });
      }
      if (snapshot.voiceStatus === 'detected') {
        providers.push({
          provider: 'kokoro',
          capability: 'voice',
          label: 'Kokoro (local)',
          isLocal: true,
          isCompatible: true,
          modelName: undefined,
          baseUrl: undefined,
        });
      }

      this._discoveredProviders = providers;
      this._buildPlan(snapshot, providers);
      this.step = 'plan';
      this.debug('startDiscovery:complete', { providers: providers.length });
    } catch (error) {
      this.warn('startDiscovery:failed', error);
      this.errorMessage = 'Discovery failed. You can enter provider details manually.';
      this.step = 'error';
    } finally {
      this.isDetecting = false;
    }
  }

  // ── Apply plan ─────────────────────────────────────────────────────────

  async applyPlan(): Promise<void> {
    if (this.isApplying) {
      return;
    }

    this.isApplying = true;
    this.errorMessage = '';
    this.step = 'applying';

    try {
      const enabledCaps = this._capabilityToggles.filter((t) => t.enabled).map((t) => t.id);

      // Detect and seed connections for enabled capabilities.
      if (enabledCaps.includes('text')) {
        await this._ensureTextProvider();
      }
      if (enabledCaps.includes('image')) {
        await this._ensureImageProvider();
      }
      if (enabledCaps.includes('voice')) {
        await this._ensureVoiceProvider();
      }

      this.step = 'ready';
      this.debug('applyPlan:complete', { capabilities: enabledCaps });
    } catch (error) {
      this.warn('applyPlan:failed', error);
      this.errorMessage = 'Failed to apply configuration. Please try again.';
      this.step = 'error';
    } finally {
      this.isApplying = false;
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────

  goBack(): void {
    this.errorMessage = '';
    if (this.step === 'plan') {
      this.step = 'results';
    } else if (this.step === 'results') {
      this.step = 'entry';
      this.entryPath = null;
    } else {
      this.step = 'entry';
      this.entryPath = null;
    }
  }

  reset(): void {
    this.step = 'entry';
    this.entryPath = null;
    this.errorMessage = '';
    this.isDetecting = false;
    this.isApplying = false;
    this.snapshot = null;
    this._capabilityToggles = CAPABILITY_DEFINITIONS.map((d) => ({ ...d }));
    this._discoveredProviders = [];
    this._planSummary = null;
  }

  leave(): void {
    // Leave without resetting — resume will re-derive from C-482 durable state.
    this.step = 'entry';
  }

  retry(): void {
    this.errorMessage = '';
    if (this.snapshot) {
      this.step = 'plan';
    } else {
      this.step = 'results';
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private async _applyTextOnly(): Promise<void> {
    this.isApplying = true;
    this.step = 'applying';

    try {
      await this._ensureTextProvider();
      this.step = 'ready';
      this.debug('_applyTextOnly:complete');
    } catch (error) {
      this.warn('_applyTextOnly:failed', error);
      this.errorMessage = 'Failed to configure text. You can try again or set up later.';
      this.step = 'error';
    } finally {
      this.isApplying = false;
    }
  }

  private async _ensureTextProvider(): Promise<void> {
    const connections = (configService.state.connections ?? []) as ConnectionEntry[];
    const hasText = connections.some(
      (c) => (c.capability ?? 'text') === 'text' && this._isUsable(c),
    );
    if (hasText) {
      return;
    }

    // Detect and auto-seed if we have a snapshot.
    if (this.snapshot?.textStatus === 'detected' && this.snapshot.textProviderId) {
      const textBaseUrl = runtimeConfigService.getTextUrl();
      configService.addConnection({
        name: `${this.snapshot.textProviderId} (local)`,
        provider: this.snapshot.textProviderId,
        capability: 'text',
        apiKey: '',
        baseUrl: textBaseUrl ?? '',
        model: this.snapshot.textModelName ?? '',
        generationParams: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 1024,
          contextSize: 4096,
        },
        isDefault: connections.length === 0,
        source: 'detected',
      });
    }

    await configService.save();
  }

  private async _ensureImageProvider(): Promise<void> {
    const connections = (configService.state.connections ?? []) as ConnectionEntry[];
    const hasImage = connections.some(
      (c) => (c.capability ?? 'text') === 'image' && this._isUsable(c),
    );
    if (hasImage) {
      return;
    }

    if (this.snapshot?.imageStatus === 'detected') {
      const imageBaseUrl = runtimeConfigService.getImageUrl();
      configService.addConnection({
        name: 'ComfyUI (local)',
        provider: 'comfyui',
        capability: 'image',
        apiKey: '',
        baseUrl: imageBaseUrl ?? '',
        model: '',
        imageOptions: { checkpoint: '', width: 512, height: 512, steps: 20, cfg: 7 },
        generationParams: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 1024,
          contextSize: 4096,
        },
        isDefault: connections.length === 0,
        source: 'detected',
      });
    }

    await configService.save();
  }

  private async _ensureVoiceProvider(): Promise<void> {
    const connections = (configService.state.connections ?? []) as ConnectionEntry[];
    const hasVoice = connections.some(
      (c) => (c.capability ?? 'text') === 'voice' && this._isUsable(c),
    );
    if (hasVoice) {
      return;
    }

    if (this.snapshot?.voiceStatus === 'detected') {
      configService.addConnection({
        name: 'Kokoro (local)',
        provider: 'kokoro',
        capability: 'voice',
        apiKey: '',
        baseUrl: '',
        model: '',
        voiceOptions: { voiceId: 'default', speed: 1, pitch: 0 },
        generationParams: {
          temperature: 0.7,
          topP: 0.95,
          topK: 40,
          repetitionPenalty: 1,
          presencePenalty: 0,
          maxTokens: 1024,
          contextSize: 4096,
        },
        isDefault: connections.length === 0,
        source: 'detected',
      });
    }

    await configService.save();
  }

  private _isUsable(connection: ConnectionEntry): boolean {
    if (LOCAL_PROVIDER_IDS.has(connection.provider)) {
      return true;
    }
    return (connection.apiKey?.trim().length ?? 0) > 0;
  }

  private _buildPlan(snapshot: CapabilitySnapshot, providers: DiscoveredProvider[]): void {
    const resourceWarnings: string[] = [];

    // Check for download requirements.
    if (snapshot.textStatus === 'not_found') {
      resourceWarnings.push(
        'A text AI provider is required. You can use a cloud service or install Ollama.',
      );
    }

    // Determine online/paid requirements.
    const hasOnlineOnly =
      providers.length === 0 &&
      snapshot.textStatus !== 'detected' &&
      snapshot.textStatus !== 'configured';
    if (hasOnlineOnly) {
      resourceWarnings.push('Some features require an internet connection for cloud AI services.');
    }

    this._planSummary = {
      capabilities: this._capabilityToggles,
      providers,
      totalDownloads: 0,
      totalBytes: 0,
      requiresOnline: hasOnlineOnly,
      hasPaidServices: false,
      resourceWarnings,
    };
  }
}

// ── Factory ────────────────────────────────────────────────────────────

export const getSetupSubflowViewModel = (
  options: SetupSubflowViewModelOptions,
): SetupSubflowViewModelInterface => SetupSubflowViewModel.create(options);
