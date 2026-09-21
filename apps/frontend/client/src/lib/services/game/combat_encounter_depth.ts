// apps/frontend/client/src/lib/services/game/combat_encounter_depth.ts
//
// Content-pack → encounter depth projection (Combat-08).
//
// The content-pack loader lives on the MAIN thread, so this is where an authored
// encounter's objectives, morale rules and reaction registry become the pinned
// depth the engine resolves against. It validates the authored values through
// the SAME closed schemas the kernel evaluates — content never carries a bespoke
// rule shape, and an invalid authored rule is a rejected encounter, not a
// silently ignored one.
//
// Nothing here is a second rules authority: the shapes are the kernel's own
// `ObjectiveRules`, `MoraleRules` and `ReactionRegistry`, and the entry's fields
// are typed by those same schemas, so no cast stands between the manifest and
// the kernel.
//
// Contract: C-532 AC-1, AC-2, AC-3, AC-7

import type { ContentPackLoaderInterface, EncounterDepth } from '@aikami/frontend/engine';
import {
  emptyMoraleRules,
  emptyObjectiveRules,
  emptyReactionRegistry,
  MoraleRulesSchema,
  ObjectiveRulesSchema,
  ReactionRegistrySchema,
} from '@aikami/schemas';
import { Value } from 'typebox/value';
import { logger } from '$logger';

/**
 * Builds the pinned Combat-08 depth for one authored encounter.
 *
 * Distinguishes an encounter that authors no depth (valid, `undefined`) from
 * invalid authored content (`ok: false`), so roster construction can preserve
 * the former and reject the latter.
 */
export const buildEncounterDepthFromContentPack = (options: {
  contentPack: ContentPackLoaderInterface;
  encounterId: string;
}): { ok: true; depth: EncounterDepth | undefined } | { ok: false; issues: string[] } => {
  const { contentPack, encounterId } = options;
  const encounter = contentPack.getEncounter(encounterId);
  if (encounter === undefined) {
    return { ok: true, depth: undefined };
  }

  const { objectiveRules, moraleRules, reactionRegistry } = encounter;
  if (objectiveRules === undefined && moraleRules === undefined && reactionRegistry === undefined) {
    return { ok: true, depth: undefined };
  }

  const issues: string[] = [];
  if (objectiveRules !== undefined && !Value.Check(ObjectiveRulesSchema, objectiveRules)) {
    issues.push('objectiveRules: schema-invalid');
  }
  if (moraleRules !== undefined && !Value.Check(MoraleRulesSchema, moraleRules)) {
    issues.push('moraleRules: schema-invalid');
  }
  if (reactionRegistry !== undefined && !Value.Check(ReactionRegistrySchema, reactionRegistry)) {
    issues.push('reactionRegistry: schema-invalid');
  }
  if (issues.length > 0) {
    logger.warn('combatEncounterDepth:invalid-authored-content', { encounterId, issues });
    return { ok: false, issues };
  }

  // An encounter that authors only SOME of the triple keeps the empty rules for
  // the rest, so a partially authored fight behaves exactly like the pre-532
  // one in every lane it did not author.
  return {
    ok: true,
    depth: {
      objectiveRules: objectiveRules ?? emptyObjectiveRules(),
      moraleRules: moraleRules ?? emptyMoraleRules(),
      reactionRegistry: reactionRegistry ?? emptyReactionRegistry(),
    },
  };
};
