// packages/shared/utils/src/lib/rules/combat_message_keys.ts
//
// Stable i18n keys for every combat rejection reason.
//
// A LEAF module: it exists so the kernel and the environmental resolver share
// one reason→key table without importing each other (which would close a
// module cycle). `combat_kernel.ts` re-exports this for its existing callers.
//
// Contract: C-531 AC-2

import type { CombatInvalidReason } from '@aikami/types';

/** Stable i18n keys returned alongside every rejection. */
export const COMBAT_MESSAGE_KEYS: Record<CombatInvalidReason, string> = {
  invalidStateShape: 'combat.invalid.state_shape',
  invalidCommandShape: 'combat.invalid.command_shape',
  encounterEnded: 'combat.invalid.encounter_ended',
  staleRevision: 'combat.invalid.stale_revision',
  notActiveCombatant: 'combat.invalid.not_active_combatant',
  actorUnknown: 'combat.invalid.actor_unknown',
  abilityUnknown: 'combat.invalid.ability_unknown',
  abilityNotAvailable: 'combat.invalid.ability_not_available',
  noActionAvailable: 'combat.invalid.no_action_available',
  targetInvalid: 'combat.invalid.target_invalid',
  targetDefeated: 'combat.invalid.target_defeated',
  targetNotParticipating: 'combat.invalid.target_not_participating',
  targetOutOfRange: 'combat.invalid.target_out_of_range',
  targetNotVisible: 'combat.invalid.target_not_visible',
  movementBudgetExceeded: 'combat.invalid.movement_budget_exceeded',
  pathBlocked: 'combat.invalid.path_blocked',
  pathInvalid: 'combat.invalid.path_invalid',
  unsupportedInV2: 'combat.invalid.unsupported_in_v2',
  objectUnknown: 'combat.invalid.object_unknown',
  objectDestroyed: 'combat.invalid.object_destroyed',
  affordanceUnknown: 'combat.invalid.affordance_unknown',
  affordanceNotAvailable: 'combat.invalid.affordance_not_available',
  requirementUnmet: 'combat.invalid.requirement_unmet',
  checkModifierUnavailable: 'combat.invalid.check_modifier_unavailable',
  selectorUnresolved: 'combat.invalid.selector_unresolved',
  cascadeLimitExceeded: 'combat.invalid.cascade_limit_exceeded',
  reactionPending: 'combat.invalid.reaction_pending',
  reactionNotPending: 'combat.invalid.reaction_not_pending',
  reactionStale: 'combat.invalid.reaction_stale',
  reactionActorNotEligible: 'combat.invalid.reaction_actor_not_eligible',
  encounterRunMismatch: 'combat.invalid.encounter_run_mismatch',
  retreatNotAuthored: 'combat.invalid.retreat_not_authored',
  retreatNotTowardExit: 'combat.invalid.retreat_not_toward_exit',
  surrenderNotAuthored: 'combat.invalid.surrender_not_authored',
};
