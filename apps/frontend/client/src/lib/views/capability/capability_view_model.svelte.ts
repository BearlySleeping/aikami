// apps/frontend/client/src/lib/views/capability/capability_view_model.svelte.ts
//
// ViewModel for the pre-game capability detection screen.
// Orchestrates provider detection, presents three paths based on results,
// and creates the campaign with the chosen capability profile.
// Contract: C-318

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { CapabilityProfile, CapabilitySnapshot, DetectionStatus } from '@aikami/types';
import { campaignService, capabilityService, routerService } from '$services';
import type { Connection } from '$types/connection';
import type { ConnectionManagerViewModelInterface } from '$views/settings/connection/connection_manager_view_model.svelte';
import { getConnectionManagerViewModel } from '$views/settings/connection/connection_manager_view_model.svelte';

// ── Types ──────────────────────────────────────────────────────────────

/** Status badge info passed from ViewModel to View for rendering. */
export type StatusBadgeInfo = {
  label: string;
  status: DetectionStatus;
};

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
  /** Error message to display, or empty string. */
  readonly errorMessage: string;
  /** Status badges derived from the snapshot. */
  readonly statusBadges: readonly StatusBadgeInfo[];
  /** ViewModel for the cloud connection editor panel. */
  readonly cloudConnectionVm: ConnectionManagerViewModelInterface;
  /** Existing cloud connections from settings. */
  readonly cloudConnections: readonly Connection[];
  /** The default cloud connection, or undefined. */
  readonly defaultConnection: Connection | undefined;
  /** Provider display labels (id → label). */
  readonly providerLabels: Record<string, string>;

  /** Starts provider detection. Called on initialization. */
  startDetection(): Promise<void>;
  /** Selects the "Play Offline Demo" path. */
  selectOfflineDemo(): Promise<void>;
  /** Selects the "Use Detected Local AI" path. */
  selectLocalAi(): Promise<void>;
  /** Selects an existing cloud connection and starts the campaign. */
  selectCloudConnection(connectionId: string): Promise<void>;
  /** Opens the guided cloud connection modal. */
  openCloudSetup(): void;
  /** Closes the guided cloud connection modal. */
  closeCloudSetup(): void;
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

  /** Error message for display. */
  errorMessage = $state('');

  /** Cloud connection editor ViewModel — reused from settings. */
  cloudConnectionVm: ConnectionManagerViewModelInterface;

  // ── Constructor ──────────────────────────────────────────────────────

  constructor(options: CapabilityViewModelOptions) {
    super(options);
    this.cloudConnectionVm = getConnectionManagerViewModel({
      className: 'CloudConnectionViewModel',
    });

    // Sync: when the connection editor closes itself (save or cancel),
    // close our modal and detect if a new connection was created.
    $effect(() => {
      void this.cloudConnectionVm.isEditorOpen;
      if (!this.cloudConnectionVm.isEditorOpen && this.showCloudSetup) {
        this._handleEditorClosed();
      }
    });
  }

  // ── Derived ──────────────────────────────────────────────────────────

  get localAiDetected(): boolean {
    return this.snapshot.textStatus === 'detected';
  }

  get cloudConfigured(): boolean {
    return this.snapshot.textStatus === 'configured';
  }

  get statusBadges(): readonly StatusBadgeInfo[] {
    return [
      { label: 'Text AI', status: this.snapshot.textStatus },
      { label: 'Image AI', status: this.snapshot.imageStatus },
      { label: 'Voice', status: this.snapshot.voiceStatus },
    ];
  }

  get cloudConnections(): readonly Connection[] {
    return this.cloudConnectionVm.connections;
  }

  get defaultConnection(): Connection | undefined {
    return this.cloudConnectionVm.connections.find(
      (c) => c.id === this.cloudConnectionVm.defaultConnectionId,
    );
  }

  get providerLabels(): Record<string, string> {
    return this.cloudConnectionVm.providerLabels;
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
        voiceStatus: result.voiceStatus,
      });
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
   * Selects an existing cloud connection and starts the campaign.
   */
  async selectCloudConnection(connectionId: string): Promise<void> {
    this.debug('selectCloudConnection', { connectionId });
    await this._startCampaign({
      textProvider: true,
      imageProvider: false,
      voiceProvider: false,
    });
  }

  /**
   * Opens the guided cloud connection modal.
   * The connection editor panel (from settings) handles the provider
   * selection, API key entry, and testing.
   */
  openCloudSetup(): void {
    this.cloudConnectionVm.openCreate();
    this.showCloudSetup = true;
  }

  /** Closes the guided cloud connection modal. */
  closeCloudSetup(): void {
    this.cloudConnectionVm.cancelEdit();
    this.showCloudSetup = false;
  }

  /**
   * Called when the connection editor panel closes itself (via save or cancel).
   * Closes the modal so the user sees their connections listed in the main view.
   */
  private _handleEditorClosed(): void {
    this.showCloudSetup = false;
  }

  // ── Private ──────────────────────────────────────────────────────────

  /**
   * Creates a new campaign with the given capability profile and
   * navigates to character onboarding (/setup).
   */
  private async _startCampaign(profile: CapabilityProfile): Promise<void> {
    try {
      await campaignService.startNewCampaign();
      if (campaignService.activeCampaign) {
        campaignService.activeCampaign.capabilityProfile = profile;
        // Transition creating → playing (persists via repository internally)
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
