// apps/frontend/client/src/lib/views/combat/combat_intent_translations.ts
//
// Maps compiler/kernel i18n keys onto the generated translation functions.
//
// Extracted from `combat_view_model.svelte.ts` (on the source-file-size guard's
// grandfathered baseline). The table is a pure value: the compiler and kernel
// emit stable keys, never prose, and this is the single place a key is resolved
// to a message.
//
// Contract: C-525 AC-4/AC-5

import m from '$i18n';

/** Maps compiler/kernel i18n keys onto the generated translation functions. */
export const COMBAT_INTENT_TRANSLATIONS: Record<string, () => string> = {
  'combat.intent.too_long': m.combatIntentTooLong,
  'combat.intent.stale': m.combatIntentStale,
  'combat.intent.ambiguous': m.combatIntentAmbiguous,
  'combat.intent.unresolved': m.combatIntentUnresolved,
  'combat.intent.unavailable': m.combatIntentUnavailable,
  'combat.clarify.option_1': m.combatClarifyOption1,
  'combat.clarify.option_2': m.combatClarifyOption2,
  'combat.clarify.option_3': m.combatClarifyOption3,
  'combat.clarify.option_4': m.combatClarifyOption4,
  'combat.invalid.state_shape': m.combatInvalidStateShape,
  'combat.invalid.command_shape': m.combatInvalidCommandShape,
  'combat.invalid.encounter_ended': m.combatInvalidEncounterEnded,
  'combat.invalid.stale_revision': m.combatInvalidStaleRevision,
  'combat.invalid.not_active_combatant': m.combatInvalidNotActiveCombatant,
  'combat.invalid.actor_unknown': m.combatInvalidActorUnknown,
  'combat.invalid.ability_unknown': m.combatInvalidAbilityUnknown,
  'combat.invalid.ability_not_available': m.combatInvalidAbilityNotAvailable,
  'combat.invalid.no_action_available': m.combatInvalidNoActionAvailable,
  'combat.invalid.target_invalid': m.combatInvalidTargetInvalid,
  'combat.invalid.target_defeated': m.combatInvalidTargetDefeated,
  'combat.invalid.target_not_participating': m.combatInvalidTargetNotParticipating,
  'combat.invalid.target_out_of_range': m.combatInvalidTargetOutOfRange,
  'combat.invalid.target_not_visible': m.combatInvalidTargetNotVisible,
  'combat.invalid.movement_budget_exceeded': m.combatInvalidMovementBudgetExceeded,
  'combat.invalid.path_blocked': m.combatInvalidPathBlocked,
  'combat.invalid.path_invalid': m.combatInvalidPathInvalid,
  'combat.invalid.unsupported_in_v2': m.combatInvalidUnsupportedInV2,
  'combat.invalid.reaction_pending': m.combatInvalidReactionPending,
  'combat.invalid.reaction_not_pending': m.combatInvalidReactionNotPending,
  'combat.invalid.reaction_stale': m.combatInvalidReactionStale,
  'combat.invalid.reaction_actor_not_eligible': m.combatInvalidReactionActorNotEligible,
  'combat.invalid.encounter_run_mismatch': m.combatInvalidEncounterRunMismatch,
  'combat.invalid.retreat_not_authored': m.combatInvalidRetreatNotAuthored,
  'combat.invalid.retreat_not_toward_exit': m.combatInvalidRetreatNotTowardExit,
  'combat.invalid.surrender_not_authored': m.combatInvalidSurrenderNotAuthored,
  'combat.reaction.cost': m.combatReactionCost,
};
