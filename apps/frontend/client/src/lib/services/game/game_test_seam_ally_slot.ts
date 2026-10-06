// apps/frontend/client/src/lib/services/game/game_test_seam_ally_slot.ts
//
// Which NPC fills an encounter's ALLY slot (C-526 AC-6), resolved from the
// loaded content pack.
//
// Split out of `game_test_seam_encounter_probes.ts`: the fallback policy — a
// preferred companion, else a distinct authored combatant, else a synthetic id
// carrying real authored stats — is one decision with a wide blast radius, and
// two probes must answer it identically. `startCompanionEncounter` recruits the
// slot it resolves; `companionCombatantIdFor` reports the slot id to the lane.
// Keeping the policy in one place is what makes those two answers agree.
//
// Non-production test apparatus: the pack is the real loaded pack, and every
// stat this hands back is authored. Reachable only through
// `window.__AIKAMI_TEST__`, which `game_test_seam.ts` installs outside
// production mode.

import type { ContentPackLoaderInterface } from '@aikami/frontend/engine/sim';
import type { ContentPackCombatStats, ContentPackNpcEntry } from '@aikami/types';

/**
 * Synthetic ally id used when the loaded pack authors no distinct combat-capable
 * companion (C-526 AC-6 E2E). The STATS are real authored stats; only the
 * identity is synthetic, and it is distinct so validation accepts the roster.
 */
export const ALLY_COMBATANT_ID = 'e2e_companion_ally';

/**
 * The ALLY slot one encounter will fight with, resolved from the loaded pack.
 *
 * `npc` is the authored entry when the ally maps to one and `undefined` for the
 * synthetic fallback — which is what tells the roster projection whether to
 * carry an authored `npcId`.
 */
export type AllySlot = {
  readonly npc: ContentPackNpcEntry | undefined;
  readonly npcId: string | undefined;
  readonly name: string;
  readonly classId: string | undefined;
  readonly stats: ContentPackCombatStats;
};

/**
 * Builds the ally-slot resolver against one loaded pack.
 *
 * The engine is deliberately NOT imported here: the composition root loads
 * `@aikami/frontend/engine` dynamically to keep the boot chunk small, so the pack
 * arrives as an option instead of being resolved through a static import.
 */
export const createAllySlotResolver = (deps: {
  readonly contentPack: ContentPackLoaderInterface;
}): {
  /** The ally slot for one encounter, or `undefined` when none can fight. */
  readonly resolveAllySlot: (options: {
    readonly preferredNpcId: string | undefined;
    readonly enemyNpc: ContentPackNpcEntry | undefined;
    readonly enemyNpcId: string;
    readonly enemyStats: ContentPackCombatStats;
  }) => AllySlot | undefined;
  /** The first authored combat-capable NPC that is not this encounter's enemy. */
  readonly firstAuthoredCombatNpcExcluding: (enemyNpcId: string) => string | undefined;
} => {
  const { contentPack } = deps;

  /**
   * The first authored combat-capable NPC of ANY encounter that is not the given
   * encounter's own enemy.
   *
   * Both probes need this candidate and both must agree on it: a lane that
   * recruits one combatant and then asks the seam which id it would use has to
   * get the same answer.
   */
  const firstAuthoredCombatNpcExcluding = (enemyNpcId: string): string | undefined =>
    contentPack
      .getAllEncounters()
      .flatMap((entry) => entry.enemyNpcIds)
      .find(
        (candidate) =>
          candidate !== enemyNpcId && contentPack.getNpc(candidate)?.combatStats !== undefined,
      );

  /** The ally slot for one authored NPC, or `undefined` when it cannot fight. */
  const authoredAllySlot = (npcId: string): AllySlot | undefined => {
    const npc = contentPack.getNpc(npcId);
    if (npc?.combatStats === undefined) {
      return undefined;
    }
    return { npc, npcId, name: npc.name, classId: npc.companionClassId, stats: npc.combatStats };
  };

  /**
   * The synthetic ally slot: a distinct id carrying a REAL authored
   * combatant's stats.
   *
   * The deployed pack authors no distinct combat-capable companion (it ships
   * ONE combat NPC), so the id must differ from the enemy's or validation would
   * reject a roster that puts one combatant on both teams; everything else —
   * stats, roster projection, worker placement, v2 kernel, control-mode
   * plumbing — is the production path.
   */
  const syntheticAllySlot = (options: {
    readonly enemyNpc: ContentPackNpcEntry | undefined;
    readonly enemyNpcId: string;
    readonly enemyStats: ContentPackCombatStats;
  }): AllySlot => ({
    npc: undefined,
    npcId: ALLY_COMBATANT_ID,
    name: `${options.enemyNpc?.name ?? options.enemyNpcId} (ally)`,
    classId: options.enemyNpc?.companionClassId,
    stats: options.enemyStats,
  });

  /**
   * Resolves the ally slot for one encounter.
   *
   * A preferred companion is used only when the loaded pack actually authors
   * combat stats for it; otherwise a distinct authored combatant fills the slot,
   * and only a pack carrying neither falls back to the synthetic ally. The
   * deployed asset seed lags the repo's combat-capable NPCs (see
   * combat_v2.spec.ts), so resolving this at runtime is what keeps the lane
   * runnable in every environment without stubbing the roster.
   */
  const resolveAllySlot = (options: {
    readonly preferredNpcId: string | undefined;
    readonly enemyNpc: ContentPackNpcEntry | undefined;
    readonly enemyNpcId: string;
    readonly enemyStats: ContentPackCombatStats;
  }): AllySlot | undefined => {
    if (options.preferredNpcId !== undefined) {
      const preferred = authoredAllySlot(options.preferredNpcId);
      if (preferred !== undefined) {
        return preferred;
      }
    }
    const alternativeNpcId = firstAuthoredCombatNpcExcluding(options.enemyNpcId);
    if (alternativeNpcId === undefined) {
      return syntheticAllySlot(options);
    }
    return authoredAllySlot(alternativeNpcId);
  };

  return { resolveAllySlot, firstAuthoredCombatNpcExcluding };
};
