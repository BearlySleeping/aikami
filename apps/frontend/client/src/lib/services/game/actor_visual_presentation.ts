// apps/frontend/client/src/lib/services/game/actor_visual_presentation.ts
//
// Content-pack → actor visual projection (enemy visual transport).
//
// The combat kernel carries an authored `npcId` and NOTHING about how an actor
// looks — that is deliberate. Mechanical combat state stays
// presentation-agnostic, so a combatant never drags an asset URL through a
// snapshot that a model reads and a save file persists.
//
// This is the other half: the main thread owns the content pack, so it is the
// only place that can answer "how does npcId draw itself?". The projection is:
//
//   combatant authored npcId
//     → this resolver
//     → ContentPackNpcEntry.visual
//     → ActorVisual
//     → renderer
//
// The fallback is EXPLICIT rather than silent: an unknown npcId, an absent pack
// or an NPC that authored no `visual` all resolve to the LPC path, and the
// resolution says which of those happened. That is what makes "missing visual
// follows the documented fallback" an assertion rather than an assumption.

import type { ContentPackLoaderInterface } from '@aikami/frontend/engine';
import type { ActorVisual } from '@aikami/schemas';

/** How an actor draws itself, and why that answer was given. */
export type ActorVisualResolution = {
  visual: ActorVisual;
  /** `authored` when the pack declared it; `fallback` when the default applied. */
  source: 'authored' | 'fallback';
  /** Empty when authored; names the reason otherwise. */
  reason: string;
};

/** The default every pack actor has always had: composed LPC layers. */
const LPC_FALLBACK_VISUAL: ActorVisual = { kind: 'lpc' };

const fallback = (reason: string): ActorVisualResolution => ({
  visual: LPC_FALLBACK_VISUAL,
  source: 'fallback',
  reason,
});

/**
 * Resolves one authored NPC's visual from the content pack.
 *
 * Never throws and never invents art: every miss is a named fallback to LPC,
 * which is the pre-existing behaviour for a pack that declares no visuals.
 *
 * The caller supplies a LIVE pack accessor rather than a value: the pack is
 * loaded asynchronously and can be replaced on a pack switch, so capturing the
 * loader at construction time would pin the first pack forever. The caller
 * passes the resulting `.visual` straight to `GameWorld`.
 */
const resolveActorVisualForNpc = (options: {
  contentPack: ContentPackLoaderInterface | undefined;
  npcId: string;
}): ActorVisualResolution => {
  const { contentPack, npcId } = options;
  if (contentPack === undefined) {
    return fallback('no content pack is loaded');
  }
  const npc = contentPack.getNpc(npcId);
  if (npc === undefined) {
    return fallback(`the pack declares no NPC "${npcId}"`);
  }
  if (npc.visual === undefined) {
    return fallback('the pack authored no visual for this NPC');
  }
  return { visual: npc.visual, source: 'authored', reason: '' };
};

/**
 * The resolver `GameWorld` takes, bound to a live pack accessor.
 *
 * A function rather than a value: the pack loads asynchronously and is replaced
 * on a pack switch, so capturing the loader would pin the first pack forever.
 */
export const actorVisualResolverFor =
  (
    contentPack: () => ContentPackLoaderInterface | undefined,
  ): ((npcId: string) => ActorVisual | undefined) =>
  (npcId) =>
    resolveActorVisualForNpc({ contentPack: contentPack(), npcId }).visual;
