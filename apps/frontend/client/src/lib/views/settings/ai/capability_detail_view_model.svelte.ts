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
} from '@aikami/frontend/services';
import type { ConnectionCapability } from '$types';
import {
  type AiSettingsViewModelInterface,
  getAiSettingsViewModel,
} from './ai_settings_view_model.svelte';

/** Presentation state and actions for configuring one AI capability. */
export type CapabilityDetailViewModelInterface = BaseViewModelInterface & {
  readonly capability: ConnectionCapability;
  readonly status: string;
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
};

class CapabilityDetailViewModel
  extends BaseViewModel<CapabilityDetailViewModelOptions>
  implements CapabilityDetailViewModelInterface
{
  readonly capability: ConnectionCapability;
  readonly aiSettingsViewModel: AiSettingsViewModelInterface;

  constructor(options: CapabilityDetailViewModelOptions) {
    super(options);
    this.capability = options.capability;
    this.aiSettingsViewModel = getAiSettingsViewModel({ className: 'AiSettingsViewModel' });
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
    return this.status === 'connected' || this.status === 'offline';
  }

  get isTesting(): boolean {
    const entry = this._getStatusEntry();
    if (!entry?.connectionId) {
      return false;
    }
    return this.aiSettingsViewModel.testingIds.has(entry.connectionId);
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

  private _getStatusEntry() {
    return this.aiSettingsViewModel.statusEntries.find((e) => e.capability === this.capability);
  }
}

/** Creates an instrumented detail ViewModel for the requested AI capability. */
export const getCapabilityDetailViewModel = (
  options: CapabilityDetailViewModelOptions,
): CapabilityDetailViewModelInterface => CapabilityDetailViewModel.create(options);
