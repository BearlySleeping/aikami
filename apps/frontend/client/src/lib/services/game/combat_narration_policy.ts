// apps/frontend/client/src/lib/services/game/combat_narration_policy.ts
//
// Facts-only narration policy (Combat-06).
//
// The narrator is PRESENTATION: it may rephrase the resolved `CombatEvent[]`
// and nothing else. This module is the deterministic gate that rejects prose
// which adds a mechanic, a number, a condition or an outcome the events do not
// contain — the caller then uses the authored template instead (AC-11).
//
// Contract: C-526 AC-11

import { COMBAT_AI_BOUNDS } from '@aikami/schemas';
import type { CombatEvent } from '@aikami/types';
import { narrationFactsFromEvents } from '../../views/combat/combat_narration';

/**
 * Condition words that can never appear in narration.
 *
 * Conditions are not part of the resolved event vocabulary in this slice, so
 * any mention is an invented mechanic.
 */
const FORBIDDEN_CONDITION_TERMS = [
  'poisoned',
  'poison',
  'stunned',
  'frozen',
  'burning',
  'cursed',
  'bleeding',
  'blinded',
  'silenced',
] as const;

/** Outcome words that require the matching fact in the events. */
const DEATH_TERMS = ['slain', 'killed', 'dies', 'dead', 'corpse'] as const;
const VICTORY_TERMS = ['victory', 'victorious', 'triumph', 'defeated the', 'routs'] as const;

type NarrationValidation =
  | { ok: true; text: string }
  | {
      ok: false;
      reason: 'empty' | 'too_long' | 'numeric' | 'invented_condition' | 'invented_outcome';
    };

const containsAny = (text: string, terms: readonly string[]): boolean =>
  terms.some((term) => text.includes(term));

/**
 * Validates model-authored narration against the events it claims to describe.
 *
 * Rejections are deliberate: a rejected block degrades to the authored
 * template, which can never contradict the kernel.
 */
export const validateCombatNarrationText = (options: {
  text: string;
  events: readonly CombatEvent[];
}): NarrationValidation => {
  const text = options.text.trim();
  if (text.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (text.length > COMBAT_AI_BOUNDS.narrationTextChars) {
    return { ok: false, reason: 'too_long' };
  }
  // No numerals: the model rephrases events, it does not restate mechanics.
  if (/\d/.test(text)) {
    return { ok: false, reason: 'numeric' };
  }
  if (containsAny(text.toLowerCase(), FORBIDDEN_CONDITION_TERMS)) {
    return { ok: false, reason: 'invented_condition' };
  }
  const facts = narrationFactsFromEvents(options.events);
  if (facts.defeated.length === 0 && containsAny(text.toLowerCase(), DEATH_TERMS)) {
    return { ok: false, reason: 'invented_outcome' };
  }
  if (facts.ended === null && containsAny(text.toLowerCase(), VICTORY_TERMS)) {
    return { ok: false, reason: 'invented_outcome' };
  }
  return { ok: true, text };
};
