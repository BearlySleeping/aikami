// apps/frontend/client/src/lib/views/combat/combat_intent_translations.ts
//
// Maps compiler/kernel message keys onto their player-facing English text.
//
// Extracted from `combat_view_model.svelte.ts` (on the source-file-size guard's
// grandfathered baseline). The table is a pure value: the compiler and kernel
// emit stable keys, never prose, and this is the single place a key is resolved
// to a message.
//
// The interface is English-only — there is no runtime locale negotiation and no
// translation catalogue — so these are literal strings, not message functions.
//
// Contract: C-525 AC-4/AC-5

/** Maps compiler/kernel message keys onto their player-facing English text. */
export const COMBAT_INTENT_TRANSLATIONS: Record<string, string> = {
  'combat.intent.too_long': 'That instruction is too long.',
  'combat.intent.stale': 'The fight changed. Review the instruction and try again.',
  'combat.intent.ambiguous': 'That instruction has more than one possible meaning.',
  'combat.intent.unresolved': 'That instruction could not be resolved.',
  'combat.intent.unavailable': 'Combat instructions are temporarily unavailable.',
  'combat.clarify.option_1': 'First target',
  'combat.clarify.option_2': 'Second target',
  'combat.clarify.option_3': 'Third target',
  'combat.clarify.option_4': 'Fourth target',
  'combat.invalid.state_shape': 'Combat state is unavailable.',
  'combat.invalid.command_shape': 'That combat action is invalid.',
  'combat.invalid.encounter_ended': 'That encounter has ended.',
  'combat.invalid.stale_revision': 'The fight changed before the action could resolve.',
  'combat.invalid.not_active_combatant': 'It is not your turn.',
  'combat.invalid.actor_unknown': 'The acting combatant is unavailable.',
  'combat.invalid.ability_unknown': 'That ability is unknown.',
  'combat.invalid.ability_not_available': 'That ability is not available to this combatant.',
  'combat.invalid.no_action_available': 'No action is available this turn.',
  'combat.invalid.target_invalid': 'That target is invalid.',
  'combat.invalid.target_defeated': 'That target is already defeated.',
  'combat.invalid.target_not_participating':
    'That target has left the fight and cannot be attacked.',
  'combat.invalid.target_out_of_range': 'That target is out of range.',
  'combat.invalid.target_not_visible': 'That target is not visible.',
  'combat.invalid.movement_budget_exceeded': 'That move exceeds the remaining movement.',
  'combat.invalid.path_blocked': 'That path is blocked.',
  'combat.invalid.path_invalid': 'That path is invalid.',
  'combat.invalid.unsupported_in_v2': 'That action is not supported in this encounter.',
  'combat.invalid.reaction_pending': 'Resolve the pending reaction first.',
  'combat.invalid.reaction_not_pending': 'There is no reaction to resolve.',
  'combat.invalid.reaction_stale': 'That reaction window has changed.',
  'combat.invalid.reaction_actor_not_eligible': 'That combatant cannot take this reaction.',
  'combat.invalid.encounter_run_mismatch': 'That reaction belongs to a different encounter run.',
  'combat.invalid.retreat_not_authored': 'Retreat is not available in this encounter.',
  'combat.invalid.retreat_not_toward_exit': 'Retreat must move toward an exit.',
  'combat.invalid.surrender_not_authored': 'Surrender is not available in this encounter.',
  'combat.reaction.cost': '1 reaction',
};
