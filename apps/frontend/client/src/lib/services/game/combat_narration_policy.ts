// apps/frontend/client/src/lib/services/game/combat_narration_policy.ts
//
// Facts-only narration policy (Combat-06, AC-11).
//
// The narrator is PRESENTATION: it may rephrase the resolved `CombatEvent[]`
// and nothing else. This module is the deterministic gate that decides whether
// a model reply may be shown at all — the caller falls back to the authored
// template when it may not.
//
// ── Why this is not a blacklist (C-526 review finding F7) ────────────────────
//
// The first implementation tried to detect invented mechanics by scanning for
// forbidden WORDS ("slain", "victory", …). That cannot be sound: any unlisted
// phrasing passes, and the actor a death word referred to was guessed from
// clause position, so one actor's defeat could authorise a sentence about a
// different actor's death. A blacklist can only ever grow; it can never
// guarantee anything.
//
// The guarantee is now STRUCTURAL instead:
//
//   1. Every mechanical sentence comes from `renderNarrationClaims`, which
//      renders a claim ONLY from the resolved fact it references. The model
//      authors references (`{ kind: 'defeated', index: 2 }`), never wording, so
//      "defeat authorises a victory sentence" and "one actor's defeat
//      authorises another actor's death" are not representable — there is no
//      field in which the model could write either.
//   2. An unresolvable reference rejects the WHOLE draft, so partial prose can
//      never look verified.
//   3. The optional free-text `flavor` channel is admitted ONLY when it is
//      mechanically inert **by construction**: it may not name any combatant
//      (every actor-scoped mechanical claim is about a combatant, so refusing
//      combatant references removes the entire class of invented
//      actor-scoped outcomes), may not contain a digit, and may not use
//      outcome or condition vocabulary.
//
// Point 3 is deliberately CONSERVATIVE and is documented as bounded, not as
// semantic certainty: a phrasing we cannot verify degrades to the authored
// template. We do not claim that regex "guarantees facts-only prose" — we claim
// that the only mechanical prose shown is rendered from verified references,
// and that anything we cannot verify is replaced by an authored template.
//
// Contract: C-526 AC-11 (repaired)

import { COMBAT_AI_BOUNDS } from '@aikami/schemas';
import type { CombatEvent, CombatState, NarrationFactRef } from '@aikami/types';
import {
  narrationFactsFromEvents,
  renderNarrationClaims,
} from '../../views/combat/combat_narration';

/**
 * Outcome and condition vocabulary the FLAVOUR channel may not use.
 *
 * The deterministic renderer already owns every one of these meanings, so a
 * flavour sentence that uses them is either redundant or an invention.
 */
const MECHANICAL_VOCABULARY = [
  // outcomes
  'hit',
  'hits',
  'miss',
  'misses',
  'struck',
  'strikes',
  'damage',
  'wound',
  'wounds',
  'wounded',
  'hurt',
  'slain',
  'slays',
  'killed',
  'kills',
  'dies',
  'died',
  'dead',
  'death',
  'corpse',
  'victory',
  'victorious',
  'triumph',
  'defeat',
  'defeated',
  'routs',
  'routed',
  'downed',
  'falls',
  'fell',
  'surrenders',
  'flees',
  // conditions
  'poisoned',
  'stunned',
  'frozen',
  'burning',
  'cursed',
  'bleeding',
  'blinded',
  'silenced',
] as const;

/** Why a model draft was rejected; the caller then narrates from templates. */
export type CombatNarrationRejection =
  | 'empty'
  | 'too_long'
  | 'unresolved_claim'
  | 'flavor_without_claims'
  | 'flavor_numeric'
  | 'flavor_names_combatant'
  | 'flavor_mechanical_vocabulary'
  | 'flavor_empty';

export type CombatNarrationValidation =
  | { ok: true; text: string; source: 'llm' }
  | { ok: false; reason: CombatNarrationRejection };

/** Lower-case word tokens, so "hits" cannot hide inside "bullets". */
const wordsOf = (text: string): string[] => text.toLowerCase().match(/[a-z]+/g) ?? [];

/**
 * Whether one flavour sentence is mechanically inert.
 *
 * Conservative by design: an unverifiable phrasing is refused rather than
 * trusted, and the authored template takes over. `combatantNames` deliberately
 * includes every id and display name the events mention, so a flavour sentence
 * cannot smuggle an actor-scoped outcome claim past the check.
 */
const flavorRejection = (options: {
  flavor: string;
  combatantNames: readonly string[];
}): CombatNarrationRejection | undefined => {
  const flavor = options.flavor.trim();
  if (flavor.length === 0) {
    return 'flavor_empty';
  }
  if (flavor.length > COMBAT_AI_BOUNDS.narrationFlavorChars) {
    return 'too_long';
  }
  if (/\d/.test(flavor)) {
    return 'flavor_numeric';
  }
  const lower = flavor.toLowerCase();
  for (const name of options.combatantNames) {
    const candidate = name.trim().toLowerCase();
    if (candidate.length < 3) {
      continue;
    }
    // Word-boundary containment so "Rat" does not match "Rations".
    const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(lower)) {
      return 'flavor_names_combatant';
    }
  }
  const words = new Set(wordsOf(flavor));
  if (MECHANICAL_VOCABULARY.some((term) => words.has(term))) {
    return 'flavor_mechanical_vocabulary';
  }
  return undefined;
};

/** Every name or id the events mention — the flavour channel's denylist. */
const combatantNamesIn = (options: {
  events: readonly CombatEvent[];
  names?: Readonly<Record<string, string>>;
  state?: CombatState;
}): string[] => {
  const names = new Set<string>();
  const add = (combatantId: string): void => {
    names.add(combatantId);
    const named = options.names?.[combatantId];
    if (named !== undefined) {
      names.add(named);
    }
    const fromState = options.state?.combatants[combatantId]?.name;
    if (fromState !== undefined) {
      names.add(fromState);
    }
  };
  for (const event of options.events) {
    switch (event.kind) {
      case 'attackRolled':
        add(event.attackerId);
        add(event.targetId);
        break;
      case 'damageApplied':
        add(event.targetId);
        break;
      case 'movementCommitted':
      case 'combatantDowned':
      case 'combatantDefeated':
      case 'turnEnded':
        add(event.combatantId);
        break;
      default:
        break;
    }
  }
  // Names the caller supplied but no event touched are still off-limits:
  // narrating an uninvolved combatant is itself an invented fact.
  for (const combatantId of Object.keys(options.names ?? {})) {
    add(combatantId);
  }
  return [...names];
};

/**
 * Validates one model draft and renders the mechanical prose deterministically.
 *
 * Returns the SHOWABLE text (or a typed rejection). `text` is always composed of
 *   - clauses rendered from resolved facts, in the order the model referenced
 *     them, followed by
 *   - the mechanically inert flavour sentence, when one was admitted.
 */
export const validateCombatNarrationDraft = (options: {
  draft: { claims: readonly NarrationFactRef[]; flavor?: string };
  events: readonly CombatEvent[];
  names?: Record<string, string>;
  state?: CombatState;
}): CombatNarrationValidation => {
  const facts = narrationFactsFromEvents(options.events);
  const mechanical = renderNarrationClaims({
    claims: options.draft.claims,
    facts,
    ...(options.names === undefined ? {} : { names: options.names }),
    ...(options.state === undefined ? {} : { state: options.state }),
  });
  if (mechanical === undefined) {
    return { ok: false, reason: 'unresolved_claim' };
  }

  const flavor = options.draft.flavor;
  if (flavor !== undefined) {
    // The flavour channel is ORNAMENT on verified mechanics, never the
    // narration itself. A flavour-only draft would put unverifiable prose on
    // screen with nothing mechanical behind it, so it is refused outright.
    if (options.draft.claims.length === 0) {
      return { ok: false, reason: 'flavor_without_claims' };
    }
    const rejection = flavorRejection({
      flavor,
      combatantNames: combatantNamesIn({
        events: options.events,
        ...(options.names === undefined ? {} : { names: options.names }),
        ...(options.state === undefined ? {} : { state: options.state }),
      }),
    });
    if (rejection !== undefined) {
      return { ok: false, reason: rejection };
    }
  }

  const text = [mechanical, flavor?.trim() ?? ''].filter((part) => part.length > 0).join(' ');
  if (text.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (text.length > COMBAT_AI_BOUNDS.narrationTextChars) {
    return { ok: false, reason: 'too_long' };
  }
  return { ok: true, text, source: 'llm' };
};
