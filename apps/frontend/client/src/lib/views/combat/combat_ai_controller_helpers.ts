// apps/frontend/client/src/lib/views/combat/combat_ai_controller_helpers.ts
//
// Pure helpers for the client half of the LLM AI turn (Combat-06, AC-5/AC-6).
//
// Extracted from `combat_ai_controller.svelte.ts` so the controller stays under
// the source-file-size hard limit: these functions are pure projections over a
// `CombatState`, with no lifecycle or bridge state of their own.
//
// Contract: C-526 AC-4, AC-5, AC-6

import { BASIC_MELEE_ABILITY_ID } from '@aikami/constants';
import { chooseV2AiCommand } from '@aikami/frontend/engine';
import type { CombatCommand, CombatState, IntentStep } from '@aikami/types';
import type { EncounterRunIdentity } from '../../services/game/combat_ai_lifecycle';

/**
 * Turns the deterministic planner's next command into intent STEPS.
 *
 * The companion flow needs an intent, not a command: proposing a command would
 * bypass the compiler the player's own plans go through, and would make the
 * proposal a different kind of object from every other plan in the UI. The
 * mapping is deliberately selector-based, so the proposal is re-grounded against
 * the live state when the player approves it.
 */
export const deterministicStepsFor = (options: {
  state: CombatState;
  combatantId: string;
}): IntentStep[] => {
  const command: CombatCommand = chooseV2AiCommand({
    state: options.state,
    combatantId: options.combatantId,
    abilityCatalog: options.state.abilityCatalog,
    basicAttackAbilityId: BASIC_MELEE_ABILITY_ID,
  });
  switch (command.kind) {
    case 'useAbility':
      return [
        {
          kind: 'use_ability',
          ability: { kind: 'tag', value: command.abilityId },
          target: { kind: 'nearest_hostile' },
        },
      ];
    case 'move':
      return [
        {
          kind: 'move',
          destination: {
            kind: 'relative',
            relativeTo: { kind: 'nearest_hostile' },
            band: 'melee',
          },
        },
      ];
    case 'defend':
      return [{ kind: 'defend' }];
    case 'wait':
      return [{ kind: 'wait' }];
    default:
      return [{ kind: 'end_turn' }];
  }
};

/**
 * Resolves the kernel snapshot for a request: the cached state when it still
 * matches the run and revision, otherwise a fresh bounded snapshot.
 */
export const resolveStateSnapshot = async (options: {
  runAtRequest: EncounterRunIdentity;
  event: { encounterId: string; stateRevision: number };
  readCurrentState: (event: {
    encounterId: string;
    stateRevision: number;
  }) => CombatState | undefined;
  requestSnapshot: () => Promise<CombatState | undefined>;
}): Promise<CombatState | undefined> => {
  const cached = options.readCurrentState(options.event);
  const state = cached ?? (await options.requestSnapshot());
  if (state === undefined) {
    return undefined;
  }
  if (state.encounterId !== options.runAtRequest.encounterId) {
    return undefined;
  }
  if (state.encounterId !== options.event.encounterId) {
    return undefined;
  }
  return state.stateRevision === options.event.stateRevision ? state : undefined;
};

/**
 * The upcoming AI-controlled actors in initiative order, starting AFTER the
 * active position — never a fixed "first three non-player actors".
 *
 * Only the knowledge group of the first upcoming AI actor is returned, so a
 * batch never mixes companions with enemies (AC-5, AC-2). A `direct` companion
 * is skipped: the AI layer must never plan a player-owned turn.
 */
export const upcomingAiActors = (options: {
  state: CombatState;
  playerCombatantId: string;
  isPlayerControlled?: (combatantId: string) => boolean;
  maxActors: number;
}): Array<{ combatantId: string; team: string }> => {
  const { state } = options;
  const order = state.initiative.order;
  const found: Array<{ combatantId: string; team: string }> = [];
  for (let step = 1; step < order.length && found.length < options.maxActors; step++) {
    const index = (state.initiative.activeIndex + step) % order.length;
    const combatantId = order[index];
    if (combatantId === undefined || combatantId === options.playerCombatantId) {
      continue;
    }
    if (options.isPlayerControlled?.(combatantId) === true) {
      continue;
    }
    const combatant = state.combatants[combatantId];
    if (combatant === undefined || combatant.defeated) {
      continue;
    }
    found.push({ combatantId, team: combatant.team });
  }
  const lead = found[0];
  if (lead === undefined) {
    return [];
  }
  return found.filter((actor) => actor.team === lead.team);
};
