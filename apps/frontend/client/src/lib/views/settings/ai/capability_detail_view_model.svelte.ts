// apps/frontend/client/src/lib/views/settings/ai/capability_detail_view_model.svelte.ts
//
// ViewModel for a per-capability detail page (Story & Dialogue, Artwork,
// Read Aloud). Derives status from the shared AiSettingsViewModel and
// delegates connection editing to the existing provider editor.
// Contract: C-484 AC-2

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { ConnectionCapability } from '$types';
import type { CapabilityStatus, CapabilityStatusEntry } from './ai_connection_status.svelte';
import type { AiSettingsViewModelInterface } from './ai_settings_view_model.svelte';
import { buildCapabilityGuidance, type CapabilityGuidance } from './capability_guidance';

/** Presentation state and actions for configuring one AI capability. */
export type CapabilityDetailViewModelInterface = BaseViewModelInterface & {
  readonly capability: ConnectionCapability;
  readonly status: CapabilityStatus;
  /** Human-readable label for {@link status} — never the raw enum value. */
  readonly statusLabel: string;
  readonly statusColor: string;
  readonly title: string;
  readonly description: string;
  readonly availabilityLabel: string;
  readonly setupActionLabel: string;
  readonly playableWithout: string;
  readonly modelName: string | undefined;
  readonly providerLabel: string | undefined;
  readonly connectionLabel: string;
  readonly connectionId: string | undefined;
  readonly aiSettingsViewModel: AiSettingsViewModelInterface;
  openSetup(): void;
  openChange(): void;
  testConnection(): Promise<void>;
  readonly isTesting: boolean;
  readonly isConfigured: boolean;
};

/** Identifies the AI capability exposed by a capability detail ViewModel. */
export type CapabilityDetailViewModelOptions = BaseViewModelOptions & {
  capability: ConnectionCapability;
  /**
   * Shared capability-status projection (config + the shared connection-test
   * store). Injected so the status card never reads the AI settings editor.
   */
  getStatusEntries: () => readonly CapabilityStatusEntry[];
  /** Builds the shared AI settings editor the detail page's controls delegate to. */
  createAiSettings: () => AiSettingsViewModelInterface;
};

class CapabilityDetailViewModel
  extends BaseViewModel<CapabilityDetailViewModelOptions>
  implements CapabilityDetailViewModelInterface
{
  readonly capability: ConnectionCapability;
  readonly aiSettingsViewModel: AiSettingsViewModelInterface;
  private readonly _getStatusEntries: () => readonly CapabilityStatusEntry[];

  constructor(options: CapabilityDetailViewModelOptions) {
    super(options);
    this.capability = options.capability;
    this._getStatusEntries = options.getStatusEntries;
    this.aiSettingsViewModel = options.createAiSettings();
  }

  override async initialize(): Promise<void> {
    await this.aiSettingsViewModel.initialize();
    await super.initialize();
  }

  /**
   * The detail page owns the AI editor it created, so it is responsible for
   * disposing it. Without this the editor's effects/resources outlive every
   * visit to the capability tab.
   */
  override async dispose(): Promise<void> {
    await this.aiSettingsViewModel.dispose();
    await super.dispose();
  }

  get connectionId(): string | undefined {
    return this._getStatusEntry()?.connectionId;
  }

  get status(): CapabilityStatus {
    const entry = this._getStatusEntry();
    if (!entry) {
      return 'not_configured';
    }
    return entry.status;
  }

  get statusLabel(): string {
    switch (this.status) {
      case 'reachable':
        return 'Reachable';
      case 'unreachable':
        return 'Unreachable';
      case 'testing':
        return 'Testing…';
      case 'not_tested':
        return 'Configured · Not tested';
      default:
        return 'Not configured';
    }
  }

  get statusColor(): string {
    const entry = this._getStatusEntry();
    if (!entry) {
      return 'badge-ghost';
    }
    return entry.color;
  }

  get guidance(): CapabilityGuidance {
    return buildCapabilityGuidance({ capability: this.capability, status: this.status });
  }

  get title(): string {
    return this.guidance.title;
  }

  get description(): string {
    return this.guidance.description;
  }

  get availabilityLabel(): string {
    return this.guidance.availabilityLabel;
  }

  get setupActionLabel(): string {
    return this.guidance.setupActionLabel;
  }

  get playableWithout(): string {
    return this.guidance.playableWithout;
  }

  get modelName(): string | undefined {
    return this._getStatusEntry()?.modelName;
  }

  get providerLabel(): string | undefined {
    return this._getStatusEntry()?.providerLabel;
  }

  get connectionLabel(): string {
    if (!this.isConfigured) {
      return 'No connection configured';
    }
    const provider = this.providerLabel ?? 'Configured provider';
    return this.modelName ? `${provider} · ${this.modelName}` : provider;
  }

  get isConfigured(): boolean {
    return this.status !== 'not_configured';
  }

  get isTesting(): boolean {
    return this.status === 'testing';
  }

  openSetup(): void {
    this.aiSettingsViewModel.openCapabilitySetup(this.capability);
  }

  openChange(): void {
    const entry = this._getStatusEntry();
    if (entry?.connectionId) {
      this.aiSettingsViewModel.openEditConnection(entry.connectionId);
    } else {
      this.aiSettingsViewModel.openCapabilitySetup(this.capability);
    }
  }

  async testConnection(): Promise<void> {
    const entry = this._getStatusEntry();
    if (entry?.connectionId) {
      await this.aiSettingsViewModel.testConnection(entry.connectionId);
    }
  }

  private _getStatusEntry(): CapabilityStatusEntry | undefined {
    return this._getStatusEntries().find((entry) => entry.capability === this.capability);
  }
}

/** Creates an instrumented detail ViewModel for the requested AI capability. */
export const createCapabilityDetailViewModel = (
  options: CapabilityDetailViewModelOptions,
): CapabilityDetailViewModelInterface => CapabilityDetailViewModel.create(options);
