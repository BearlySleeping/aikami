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
import { aiSettingsService, configService } from '$services';
import { registerSerializable } from '../game/serializable_service.ts';
import { transition } from './boot_state_machine.ts';
import { campaignStorage } from './campaign_storage.svelte.ts';

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
  /**
   * Ensures a campaign exists for the current session.
   *
   * Returns the active campaign when present, otherwise reuses or creates the
   * stable default Emberwatch campaign. This lets the game work when entered
   * straight to /game without running setup — saves still get a campaignId
   * and Continue-after-refresh can resume.
   */
  ensureDefaultCampaign(): Promise<Campaign>;
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

/**
 * Stable ID of the auto-created campaign used when the game is entered
 * without running setup (straight to /game). Deterministic so re-boots find
 * the same record and stay idempotent.
 */
const DEFAULT_CAMPAIGN_ID = 'default-emberwatch';

/** Creates a deterministic seed from the current timestamp. */
const generateSeed = (): number => Math.floor(Date.now() / 1000);

/** Local text providers that don't require an API key. */
const LOCAL_TEXT_PROVIDERS = new Set(['ollama', 'llamacpp', 'ooba']);

/**
 * Whether a connection for the given capability is configured. Reads the
 * C-230 connections (where API keys actually live) rather than the legacy
 * `aiSettingsService` provider config, which is no longer populated from
 * connections. Local text providers count as configured without a key.
 */
const hasConnectionForCapability = (capability: string): boolean => {
  const connections = configService.state.connections ?? [];
  return connections.some((c) => {
    if ((c.capability ?? 'text') !== capability) {
      return false;
    }
    if (capability === 'text' && LOCAL_TEXT_PROVIDERS.has(c.provider)) {
      return true;
    }
    return Boolean(c.apiKey || (c.baseUrl && c.model));
  });
};

/** Builds a capability profile from current AI settings. */
const buildCapabilityProfile = (): CapabilityProfile => {
  const { ttsProvider, imageProvider } = aiSettingsService;
  return {
    textProvider: hasConnectionForCapability('text'),
    imageProvider: hasConnectionForCapability('image') || !!(imageProvider.apiKey || imageProvider.endpoint),
    voiceProvider: hasConnectionForCapability('voice') || !!(ttsProvider.apiKey || ttsProvider.endpoint),
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

      await campaignStorage.create(campaign);
      this.activeCampaign = campaign;
      this.campaigns = [campaign, ...this.campaigns];

      this.debug('startNewCampaign', { campaignId: campaign.id });
      return campaign;
    } finally {
      this.isBusy = false;
    }
  }

  /** @inheritdoc */
  async ensureDefaultCampaign(): Promise<Campaign> {
    if (this.activeCampaign) {
      return this.activeCampaign;
    }

    const buildDefault = (): Campaign => {
      const now = new Date().toISOString();
      return {
        id: DEFAULT_CAMPAIGN_ID,
        name: 'Emberwatch',
        state: 'playing',
        contentPackId: 'emberwatch',
        seed: generateSeed(),
        createdAt: now,
        updatedAt: now,
        capabilityProfile: buildCapabilityProfile(),
      };
    };

    try {
      const existing = await campaignStorage.getById(DEFAULT_CAMPAIGN_ID);
      if (existing) {
        this.activeCampaign = existing;
        this.debug('ensureDefaultCampaign:reused', { campaignId: existing.id });
        return existing;
      }

      const campaign = buildDefault();
      await campaignStorage.create(campaign);
      this.activeCampaign = campaign;
      await this.refreshCampaigns();
      this.debug('ensureDefaultCampaign:created', { campaignId: campaign.id });
      return campaign;
    } catch (error) {
      // Storage unavailable (e.g. in-memory fallback DB) — return a transient
      // campaign so the save flow still records a campaignId this session.
      this.warn('ensureDefaultCampaign:storage-failed', { error: String(error) });
      const transient = buildDefault();
      this.activeCampaign = transient;
      return transient;
    }
  }

  /** @inheritdoc */
  async loadCampaign(options: { campaignId: string }): Promise<Campaign> {
    if (this.isBusy) {
      throw new Error('Campaign operation already in progress');
    }

    this.isBusy = true;

    try {
      const campaign = await campaignStorage.getById(options.campaignId);
      if (!campaign) {
        throw new Error(`Campaign not found: ${options.campaignId}`);
      }

      // Already playing (e.g. resumed from a saved session or the default
      // Emberwatch campaign) — activate without re-running the
      // LOAD_REQUESTED → LOAD_COMPLETE transitions (the state machine only
      // allows LOAD_REQUESTED from idle/failed). Mirrors the boot pipeline's
      // playing-state handling.
      if (campaign.state === 'playing') {
        this.activeCampaign = campaign;
        await this.refreshCampaigns();
        this.debug('loadCampaign:already-playing', { campaignId: campaign.id });
        return campaign;
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
      await campaignStorage.update(updated);

      // Transition to playing via LOAD_COMPLETE
      const playing: Campaign = {
        ...updated,
        state: transition('loading', { type: 'LOAD_COMPLETE' }),
        updatedAt: new Date().toISOString(),
      };
      await campaignStorage.update(playing);

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
    void campaignStorage.update(updated);
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
    void campaignStorage.update(updated);
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
      await campaignStorage.update(complete);
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
      const all = await campaignStorage.getAll();
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
    void campaignStorage.update(updated);

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
