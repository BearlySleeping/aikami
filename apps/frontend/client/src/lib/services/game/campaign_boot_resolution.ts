// apps/frontend/client/src/lib/services/game/campaign_boot_resolution.ts
//
// Boot campaign resolution — which campaign does this boot attempt run?
//
// Extracted from `GameBootService._stageLoadCampaign`: the resolution order
// (explicit campaignId → newest campaign → auto-created default) and the state
// machine drive into a loadable state are one cohesive responsibility that does
// not belong in the boot pipeline's orchestration.
//
// The caller owns two things and passes them in deliberately:
//   - `isCurrent()` — this attempt's generation guard. Every await boundary
//     re-checks it so a superseded boot stops touching shared state.
//   - `adopt()` — the boot's generation-guarded sink that both stores the
//     campaign and publishes it as the session's active campaign. This module
//     never writes to the campaign service itself.

import type { Campaign } from '@aikami/types';
import { transition } from '../campaign/boot_state_machine.ts';
import { campaignService } from '../campaign/campaign_service.svelte.ts';

/** Collaboration surface the boot pipeline supplies to the resolver. */
export type BootCampaignResolutionDeps = {
  /** Campaign the boot explicitly targets, if any. */
  readonly campaignId: string | undefined;
  /** Whether this boot attempt still owns the session (generation guard). */
  readonly isCurrent: () => boolean;
  /** Generation-guarded sink: stores AND publishes the resolved campaign. */
  readonly adopt: (campaign: Campaign) => void;
  readonly debug: (...args: unknown[]) => void;
  readonly warn: (...args: unknown[]) => void;
};

/**
 * Resolves the campaign for this boot attempt and drives its state machine to
 * a loadable state (`playing` stays `playing`, `creating` completes setup, and
 * anything else that can legally load goes to `loading`).
 *
 * Returns the adopted campaign, or `undefined` when the attempt was superseded
 * mid-resolution — the caller must then abandon the stage rather than proceed.
 */
export const resolveBootCampaign = async (
  deps: BootCampaignResolutionDeps,
): Promise<Campaign | undefined> => {
  const { campaignId, isCurrent, adopt, debug, warn } = deps;

  let campaign: Campaign | undefined;
  if (campaignId) {
    const { campaignStorage } = await import('../campaign/campaign_storage.svelte');
    campaign = await campaignStorage.getById(campaignId);
  }

  // Check generation after async operation
  if (!isCurrent()) {
    return undefined;
  }

  if (!campaign) {
    // Fallback: latest campaign or default transient
    const latest = campaignService.getLatestCampaign();
    if (latest) {
      campaign = latest;
      debug('stage:loading_campaign:latest-campaign', { campaignId: latest.id });
    } else {
      // No campaign exists (e.g. straight to /game without setup) — create
      // the default Emberwatch campaign so save/continue work end-to-end.
      campaign = await campaignService.ensureDefaultCampaign();
      debug('stage:loading_campaign:default-created', { campaignId: campaign.id });
    }
  }

  if (!campaign) {
    return undefined;
  }

  const { campaignStorage } = await import('../campaign/campaign_storage.svelte');

  if (campaign.state === 'playing') {
    debug('stage:loading_campaign:already-playing');
    adopt(campaign);
    return campaign;
  }

  if (campaign.state === 'creating') {
    // Campaign is still in setup — auto-complete to playing so the boot
    // pipeline can proceed. This happens when the user navigates to /game
    // without finishing the persona creation flow (C-435 regression).
    debug('stage:loading_campaign:auto-completing-setup');
    const currentState = campaign.state;
    try {
      const playingState = transition(currentState, { type: 'SETUP_COMPLETE' });
      campaign = { ...campaign, state: playingState, updatedAt: new Date().toISOString() };
      await campaignStorage.update(campaign);
      adopt(campaign);
      debug('stage:loading_campaign:setup-completed', { campaignId: campaign.id });
    } catch (error) {
      warn('stage:loading_campaign:auto-setup-failed', {
        currentState,
        error: String(error),
      });
      adopt(campaign);
    }
    return campaign;
  }

  try {
    // Validate transition is legal from current state
    const loadingState = transition(campaign.state, {
      type: 'LOAD_REQUESTED',
      campaignId: campaign.id,
    });
    campaign = { ...campaign, state: loadingState, updatedAt: new Date().toISOString() };
    await campaignStorage.update(campaign);
    // Only mutate if generation is still current after await
    adopt(campaign);
  } catch (error) {
    warn('stage:loading_campaign:transition-failed', {
      currentState: campaign.state,
      error: String(error),
    });
    adopt(campaign);
  }
  return campaign;
};
