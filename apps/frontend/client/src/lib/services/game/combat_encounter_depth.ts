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
// `ObjectiveRules`, `MoraleRules` and `ReactionRegistry`.
//
// Contract: C-532 AC-1, AC-2, AC-3, AC-7

import type { ContentPackLoaderInterface, EncounterDepth } from '@aikami/frontend/engine';
import { MoraleRulesSchema, ObjectiveRulesSchema, ReactionRegistrySchema } from '@aikami/schemas';
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

  const authored = encounter as unknown as {
    objectiveRules?: unknown;
    moraleRules?: unknown;
    reactionRegistry?: unknown;
  };
  if (
    authored.objectiveRules === undefined &&
    authored.moraleRules === undefined &&
    authored.reactionRegistry === undefined
  ) {
    return { ok: true, depth: undefined };
  }

  const issues: string[] = [];
  const objectiveRules = ObjectiveRulesSchema;
  const moraleRules = MoraleRulesSchema;
  const reactionRegistry = ReactionRegistrySchema;

  if (authored.objectiveRules !== undefined) {
    try {
      if (!Value.Check(objectiveRules, authored.objectiveRules)) {
        issues.push('objectiveRules: schema-invalid');
      }
    } catch {
      issues.push('objectiveRules: unreadable');
    }
  }
  if (authored.moraleRules !== undefined) {
    try {
      if (!Value.Check(moraleRules, authored.moraleRules)) {
        issues.push('moraleRules: schema-invalid');
      }
    } catch {
      issues.push('moraleRules: unreadable');
    }
  }
  if (authored.reactionRegistry !== undefined) {
    try {
      if (!Value.Check(reactionRegistry, authored.reactionRegistry)) {
        issues.push('reactionRegistry: schema-invalid');
      }
    } catch {
      issues.push('reactionRegistry: unreadable');
    }
  }
  if (issues.length > 0) {
    logger.warn('combatEncounterDepth:invalid-authored-content', { encounterId, issues });
    return { ok: false, issues };
  }

  return {
    ok: true,
    depth: {
      objectiveRules:
        authored.objectiveRules === undefined
          ? { definitions: [], protectedActorIds: [] }
          : (authored.objectiveRules as EncounterDepth['objectiveRules']),
      moraleRules:
        authored.moraleRules === undefined
          ? {
              startingMorale: 100,
              breakThreshold: 0,
              triggers: [],
              responses: [],
              exitZones: [],
              leaderIds: [],
            }
          : (authored.moraleRules as EncounterDepth['moraleRules']),
      reactionRegistry:
        authored.reactionRegistry === undefined
          ? { definitions: [] }
          : (authored.reactionRegistry as EncounterDepth['reactionRegistry']),
    },
  };
};
