// apps/frontend/client/src/lib/services/campaign/campaign_service.svelte.ts
//
// Singleton campaign lifecycle service — bridges the campaign repository,
// boot state machine, and game state.
// Contract: C-313 Introduce the Campaign Aggregate and Boot State Machine
// Contract: C-323 Enforce the Mandatory Text AI Capability Gate

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { Campaign, CapabilityProfile } from '@aikami/types';
import { AiTextProviderRequiredError } from '@aikami/utils';
import { aiSettingsService } from '$services';
import { registerSerializable } from '../game/serializable_service.ts';
import { transition } from './boot_state_machine.ts';
import { campaignRepository } from './campaign_repository.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CampaignServiceInterface = BaseFrontendClassInterface & {
  /** All campaigns, sorted newest first. */
  readonly campaigns: readonly Campaign[];
  /** The currently active campaign, or undefined. */
  readonly activeCampaign: Campaign | undefined;
  /** Whether a campaign operation is in progress. */
  readonly isBusy: boolean;

  /** Creates a new campaign (idle → creating) and returns it. */
  startNewCampaign(options?: {
    personaId?: string;
    capabilityProfile?: CapabilityProfile;
    /** Content pack ID for this campaign. Defaults to 'emberwatch'. */
    contentPackId?: string;
  }): Promise<Campaign>;
  /** Loads an existing campaign (idle/creating/failed → loading → playing). */
  loadCampaign(options: { campaignId: string }): Promise<Campaign>;
  /** Resumes the active campaign from paused → playing. */
  resumeCampaign(): void;
  /** Pauses the active campaign (playing → paused). */
  pauseCampaign(): void;
  /** Saves the active campaign state. */
  saveCampaign(options?: { slotId?: string }): Promise<void>;
  /** Returns the latest campaign by lastSavedAt, or undefined. */
  getLatestCampaign(): Campaign | undefined;
  /** Returns whether any resumable campaigns exist. */
  hasCampaigns(): boolean;
  /** Refreshes the campaign list from IndexedDB. */
  refreshCampaigns(): Promise<void>;
  /** Transitions the active campaign to 'playing' after setup completes. */
  completeSetup(): void;
  /** Transitions the active campaign to 'failed' with an error. */
  failCampaign(error: string): void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a new unique campaign identifier. */
const generateCampaignId = (): string => crypto.randomUUID();

/** Creates a deterministic seed from the current timestamp. */
const generateSeed = (): number => Math.floor(Date.now() / 1000);

/** Builds a capability profile from current AI settings. */
const buildCapabilityProfile = (): CapabilityProfile => {
  const { textProvider, ttsProvider, imageProvider } = aiSettingsService;
  return {
    textProvider: !!(
      textProvider.apiKey ||
      (textProvider.endpoint?.includes('localhost') && textProvider.model)
    ),
    imageProvider: !!(imageProvider.apiKey || imageProvider.endpoint),
    voiceProvider: !!(ttsProvider.apiKey || ttsProvider.endpoint),
  };
};

/**
 * Returns true when the AI gate bypass is active for QA/CI testing.
 * Checks window.__AIKAMI_AI_GATE_BYPASS__ first, then PUBLIC_AI_GATE_BYPASS
 * env var (which is compiled away by Vite in non-emulator builds).
 */
const isAiGateBypassed = (): boolean => {
  if (
    typeof window !== 'undefined' &&
    (window as unknown as Record<string, unknown>).__AIKAMI_AI_GATE_BYPASS__
  ) {
    return true;
  }
  try {
    return import.meta.env.PUBLIC_AI_GATE_BYPASS === 'true';
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Campaign Service
// ---------------------------------------------------------------------------

class CampaignService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements CampaignServiceInterface
{
  /** All campaigns from IndexedDB. */
  campaigns: Campaign[] = $state([]);
  /** The currently active campaign. */
  activeCampaign = $state<Campaign | undefined>(undefined);
  /** Whether a campaign operation is in progress. */
  isBusy = $state(false);

  constructor(options: BaseFrontendClassOptions) {
    super(options);

    // Register for save/load serialization
    registerSerializable('campaign', {
      serialize: (): unknown => this.activeCampaign ?? null,
      hydrate: (data: unknown): void => {
        if (data) {
          this.activeCampaign = data as Campaign;
        }
      },
    });
  }

  /** Loads campaign state and refreshes the list from IndexedDB. */
  async initialize(): Promise<void> {
    await this.refreshCampaigns();
  }

  /** @inheritdoc */
  async startNewCampaign(options?: {
    personaId?: string;
    capabilityProfile?: CapabilityProfile;
    contentPackId?: string;
  }): Promise<Campaign> {
    if (this.isBusy) {
      throw new Error('Campaign operation already in progress');
    }

    this.isBusy = true;

    try {
      const now = new Date().toISOString();
      const state = transition('idle', { type: 'START_NEW' });

      const capabilityProfile = options?.capabilityProfile ?? buildCapabilityProfile();

      // Gate: text AI provider is mandatory unless QA/CI bypass is active
      if (!capabilityProfile.textProvider && !isAiGateBypassed()) {
        this.debug('startNewCampaign:gate-blocked', { reason: 'textProvider false' });
        throw new AiTextProviderRequiredError(
          'A text AI provider is required to start a campaign. Install Ollama or configure a cloud provider.',
        );
      }

      if (isAiGateBypassed() && !capabilityProfile.textProvider) {
        this.debug('startNewCampaign:gate-bypassed', { mode: 'QA/CI' });
      }

      const campaign: Campaign = {
        id: generateCampaignId(),
        name: 'New Adventure',
        state,
        personaId: options?.personaId,
        contentPackId: options?.contentPackId ?? 'emberwatch',
        seed: generateSeed(),
        createdAt: now,
        updatedAt: now,
        capabilityProfile,
      };

      await campaignRepository.create(campaign);
      this.activeCampaign = campaign;
      this.campaigns = [campaign, ...this.campaigns];

      this.debug('startNewCampaign', { campaignId: campaign.id });
      return campaign;
    } finally {
      this.isBusy = false;
    }
  }

  /** @inheritdoc */
  async loadCampaign(options: { campaignId: string }): Promise<Campaign> {
    if (this.isBusy) {
      throw new Error('Campaign operation already in progress');
    }

    this.isBusy = true;

    try {
      const campaign = await campaignRepository.getById(options.campaignId);
      if (!campaign) {
        throw new Error(`Campaign not found: ${options.campaignId}`);
      }

      // Validate transition is legal; if invalid, transition() throws.
      transition(campaign.state, {
        type: 'LOAD_REQUESTED',
        campaignId: options.campaignId,
      });

      const updated: Campaign = {
        ...campaign,
        state: 'loading',
        updatedAt: new Date().toISOString(),
      };
      await campaignRepository.update(updated);

      // Transition to playing via LOAD_COMPLETE
      const playing: Campaign = {
        ...updated,
        state: transition('loading', { type: 'LOAD_COMPLETE' }),
        updatedAt: new Date().toISOString(),
      };
      await campaignRepository.update(playing);

      this.activeCampaign = playing;
      await this.refreshCampaigns();

      this.debug('loadCampaign', { campaignId: playing.id, state: playing.state });
      return playing;
    } catch (error) {
      // If load fails after we've started, mark as failed
      if (this.activeCampaign) {
        try {
          this._applyTransition({ type: 'LOAD_FAILED', error: String(error) });
        } catch {
          // Best effort
        }
      }
      throw error;
    } finally {
      this.isBusy = false;
    }
  }

  /** @inheritdoc */
  resumeCampaign(): void {
    if (!this.activeCampaign) {
      throw new Error('No active campaign');
    }
    const state = transition(this.activeCampaign.state, { type: 'RESUME' });
    const updated: Campaign = {
      ...this.activeCampaign,
      state,
      updatedAt: new Date().toISOString(),
    };
    this.activeCampaign = updated;
    void campaignRepository.update(updated);
  }

  /** @inheritdoc */
  pauseCampaign(): void {
    if (!this.activeCampaign) {
      throw new Error('No active campaign');
    }
    const state = transition(this.activeCampaign.state, { type: 'PAUSE' });
    const updated: Campaign = {
      ...this.activeCampaign,
      state,
      updatedAt: new Date().toISOString(),
    };
    this.activeCampaign = updated;
    void campaignRepository.update(updated);
  }

  /** @inheritdoc */
  async saveCampaign(options?: { slotId?: string }): Promise<void> {
    if (!this.activeCampaign) {
      throw new Error('No active campaign to save');
    }

    const state = transition(this.activeCampaign.state, { type: 'SAVE_REQUESTED' });
    const saving: Campaign = {
      ...this.activeCampaign,
      state,
      updatedAt: new Date().toISOString(),
    };
    this.activeCampaign = saving;

    try {
      const now = new Date().toISOString();
      const complete: Campaign = {
        ...saving,
        state: transition('saving', { type: 'SAVE_COMPLETE' }),
        lastSavedAt: now,
        lastSaveSlotId: options?.slotId ?? 'auto-save',
        updatedAt: now,
      };
      await campaignRepository.update(complete);
      this.activeCampaign = complete;
      await this.refreshCampaigns();

      this.debug('saveCampaign', { campaignId: complete.id });
    } catch (error) {
      this._applyTransition({ type: 'SAVE_FAILED', error: String(error) });
      throw error;
    }
  }

  /** @inheritdoc */
  completeSetup(): void {
    if (!this.activeCampaign) {
      throw new Error('No active campaign');
    }
    this._applyTransition({ type: 'SETUP_COMPLETE' });
  }

  /** @inheritdoc */
  failCampaign(error: string): void {
    if (!this.activeCampaign) {
      return;
    }
    try {
      this._applyTransition({ type: 'LOAD_FAILED', error });
    } catch {
      // The transition may not be valid from the current state — that's OK
      this.debug('failCampaign:transition-invalid', { current: this.activeCampaign.state, error });
    }
  }

  /** @inheritdoc */
  getLatestCampaign(): Campaign | undefined {
    return this.campaigns[0];
  }

  /** @inheritdoc */
  hasCampaigns(): boolean {
    return this.campaigns.length > 0;
  }

  /** @inheritdoc */
  async refreshCampaigns(): Promise<void> {
    try {
      const all = await campaignRepository.getAll();
      this.campaigns = all;
      this.debug('refreshCampaigns', { count: all.length });
    } catch (error) {
      this.warn('refreshCampaigns:failed', error);
      this.campaigns = [];
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /** Applies a state machine transition and persists the result. */
  private _applyTransition(
    event:
      | { type: 'SETUP_COMPLETE' }
      | { type: 'LOAD_FAILED'; error: string }
      | { type: 'SAVE_FAILED'; error: string },
  ): void {
    if (!this.activeCampaign) {
      return;
    }
    const state = transition(this.activeCampaign.state, event);
    const updated: Campaign = {
      ...this.activeCampaign,
      state,
      updatedAt: new Date().toISOString(),
    };
    this.activeCampaign = updated;
    void campaignRepository.update(updated);

    // Keep the campaigns list in sync so getLatestCampaign() returns accurate state
    this.campaigns = this.campaigns.map((c) => (c.id === updated.id ? updated : c));

    this.debug('_applyTransition', { event: event.type, newState: state });
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const campaignService: CampaignServiceInterface = CampaignService.create({
  className: 'CampaignService',
});
