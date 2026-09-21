// apps/frontend/client/src/lib/views/studio/studio_outcome_messages.ts
//
// C-512 / C-513 — the studio's outcome phrasing.
//
// Pure string mapping, extracted from `studio_view_model.svelte.ts`: the
// ViewModel owns state and transitions, and these three functions own the way a
// save, a delete refusal and a publish refusal are worded. Nothing here reads or
// writes view state.
//
// Contract: C-512 Creator Studio and Runtime Asset Generation, C-513

import type { CommunityPublishOutcome, GeneratedAssetSaveOutcome } from '$types';

export const describeSaveOutcome = (outcome: GeneratedAssetSaveOutcome): string => {
  if (outcome.registered) {
    if (outcome.unchanged) {
      return `Saved "${outcome.tag}" — identical bytes were already stored (version ${outcome.version ?? 1}).`;
    }
    return `Saved "${outcome.tag}" as version ${outcome.version ?? 1}.`;
  }
  if (outcome.reason === 'generation_disabled') {
    return 'Not saved: asset generation is disabled (PUBLIC_ASSET_GENERATION is off).';
  }
  if (outcome.reason === 'not_initialized') {
    return 'Not saved: the asset registry is still starting up — try again in a moment.';
  }
  return `Not saved${outcome.reason ? `: ${outcome.reason}` : ''}.`;
};

export const describeDeleteRefusal = (reason: string | undefined): string => {
  if (reason === 'seed_tag') {
    return 'That asset belongs to the catalog and cannot be deleted here.';
  }
  if (reason === 'not_found') {
    return 'That asset is already gone.';
  }
  return `Delete failed${reason ? `: ${reason}` : ''}.`;
};

/** Phrases a publish outcome for the user (AC-1 / AC-2 / AC-7). */
export const describePublishOutcome = (outcome: CommunityPublishOutcome): string => {
  if (outcome.published) {
    return `Published "${outcome.slug}" revision ${outcome.revision} — pending review.`;
  }
  if (outcome.reason === 'rights-unresolved') {
    return "Not published: no rights decision permits community distribution for this asset (generated assets need C-518's scoped rights record).";
  }
  if (outcome.reason === 'rights-denied') {
    return `Not published: the rights decision does not permit ${outcome.missing?.join(', ') ?? 'community distribution'}.`;
  }
  if (outcome.reason === 'not_initialized') {
    return 'Not published: the local registry is still starting up — try again in a moment.';
  }
  if (outcome.reason === 'bytes_not_cached') {
    return 'Not published: the asset is not cached on this device.';
  }
  return `Not published (${outcome.reason}).`;
};
