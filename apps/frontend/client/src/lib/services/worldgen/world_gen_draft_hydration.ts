// apps/frontend/client/src/lib/services/worldgen/world_gen_draft_hydration.ts
//
// G01 — the durable boundary of the draft service: reading a stored draft back
// into a live session, and copying the in-memory session safely.
//
// Split out of `world_gen_draft_service.svelte.ts` because neither responsibility
// is orchestration: this module has no run, no clock and no cancellation, which
// is exactly why it can be reasoned about (and tested) without a provider.

import type { WorldGenDraft } from '@aikami/schemas';
import type { WorldGenDraftStore } from './types/world_gen_draft_service.types.ts';
import type { WorldGenDraftAccumulator } from './world_gen_draft_builder.ts';

// ---------------------------------------------------------------------------
// Reading the store
// ---------------------------------------------------------------------------

/**
 * What a store read produced.
 *
 * A failure is a VALUE here rather than a thrown error, because the two callers
 * want opposite things: the reload path degrades quietly, and the hydration path
 * has to tell the player their draft is unreadable. Returning the reason keeps
 * that decision at the call site instead of burying it in a `catch`.
 */
export type StoredDraftRead =
  | { ok: true; draft: WorldGenDraft | undefined }
  | { ok: false; reason: string };

/**
 * Reads one draft by id.
 *
 * `undefined` with `ok: true` means "no such row" — an ordinary state, not a
 * fault. `ok: false` means the row exists but could not be turned into a draft,
 * and `reason` says why.
 */
export const readStoredDraft = async (
  store: WorldGenDraftStore,
  draftId: string,
): Promise<StoredDraftRead> => {
  try {
    return { ok: true, draft: await store.get(draftId) };
  } catch (error) {
    return { ok: false, reason: describeReadFailure(error) };
  }
};

/**
 * Reads the newest stored draft.
 *
 * This is the path a REAL page reload needs. `reload()` answers "re-read the
 * draft I already know about"; a service rebuilt from scratch — which is what a
 * browser reload produces — has no draft id to ask for, and G01 keeps at most
 * one private draft per device in practice, so the newest row is the answer.
 */
export const readLatestStoredDraft = async (
  store: WorldGenDraftStore,
): Promise<StoredDraftRead> => {
  try {
    const [newest] = await store.latest(1);
    return { ok: true, draft: newest };
  } catch (error) {
    return { ok: false, reason: describeReadFailure(error) };
  }
};

/** Renders a store failure as one sentence a diagnostic can carry. */
const describeReadFailure = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : 'The stored draft could not be read for an unstated reason.';

// ---------------------------------------------------------------------------
// Session copying
// ---------------------------------------------------------------------------

/**
 * A detached copy of an accumulator.
 *
 * The arrays are copied and the NPC objects are re-created, because the hazard
 * being defended against is not a mutated string — it is a LATE stage of a
 * RETIRED run pushing a payload in through the same array reference the live
 * session is reading. A shallow spread of the accumulator would share every one
 * of those arrays.
 */
export const cloneAccumulator = (source: WorldGenDraftAccumulator): WorldGenDraftAccumulator => ({
  setting:
    source.setting === undefined
      ? undefined
      : { ...source.setting, themes: [...source.setting.themes] },
  cast: source.cast.map((npc) => ({ ...npc })),
  places: source.places.map((place) => ({ ...place, npcIds: [...place.npcIds] })),
  arcs: source.arcs.map((arc) => ({
    ...arc,
    objectives: [...arc.objectives],
    questGiverIds: [...arc.questGiverIds],
  })),
  hudWidgets: source.hudWidgets.map((widget) => ({ ...widget })),
});

/**
 * Reconstructs an accumulator from a loaded draft.
 *
 * Used by hydration so that a re-run after a reload can REUSE the stored
 * stages instead of re-billing the provider for a world the player already
 * paid to generate. The draft has been through the repository's validation
 * gates, so these arrays are known to be coherent.
 */
export const accumulatorFromDraft = (draft: WorldGenDraft): WorldGenDraftAccumulator => ({
  setting: draft.setting,
  cast: draft.cast,
  places: draft.places,
  arcs: draft.arcs,
  hudWidgets: draft.hudWidgets,
});

/**
 * Rebuilds the checkpoint session from a loaded draft.
 *
 * Copying into a fresh `Map` is the point: the caller must never end up holding
 * the same map instance the draft's own array came from, or a later run could
 * mutate "the loaded draft" as a side effect.
 */
export const checkpointsFromDraft = (draft: WorldGenDraft): Map<string, string> =>
  new Map(draft.checkpoints.map(({ stage, fingerprint }) => [stage, fingerprint]));
