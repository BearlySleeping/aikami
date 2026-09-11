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
import type { CapabilityStatusEntry } from './ai_connection_status.svelte';
import type { AiSettingsViewModelInterface } from './ai_settings_view_model.svelte';

/** Presentation state and actions for configuring one AI capability. */
export type CapabilityDetailViewModelInterface = BaseViewModelInterface & {
  readonly capability: ConnectionCapability;
  readonly status: string;
  /** Human-readable label for {@link status} — never the raw enum value. */
  readonly statusLabel: string;
  readonly statusColor: string;
  readonly modelName: string | undefined;
  readonly providerLabel: string | undefined;
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

  get connectionId(): string | undefined {
    return this._getStatusEntry()?.connectionId;
  }

  get status(): string {
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

  get modelName(): string | undefined {
    return this._getStatusEntry()?.modelName;
  }

  get providerLabel(): string | undefined {
    return this._getStatusEntry()?.providerLabel;
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
