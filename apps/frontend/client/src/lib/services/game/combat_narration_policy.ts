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

type CombatantMention = { combatantId: string; start: number; end: number };

/** Resolves authored names (and explicit ids) mentioned in one narration block. */
const combatantMentions = (options: {
  text: string;
  combatantIds: readonly string[];
  names?: Readonly<Record<string, string>>;
}): CombatantMention[] => {
  const aliases = new Map<string, Set<string>>();
  const namedCombatants = Object.entries(options.names ?? {});
  const knownCombatantIds = new Set([
    ...options.combatantIds,
    ...namedCombatants.map(([id]) => id),
  ]);
  for (const combatantId of knownCombatantIds) {
    const name = options.names?.[combatantId];
    const values = [
      combatantId,
      ...(name === undefined ? [] : [name, ...name.split(/\s+/)]),
    ].filter((value) => value.length >= 3);
    for (const value of values) {
      const alias = value.toLowerCase();
      const matchingIds = aliases.get(alias) ?? new Set<string>();
      matchingIds.add(combatantId);
      aliases.set(alias, matchingIds);
    }
  }

  const mentions: CombatantMention[] = [];
  for (const [alias, matchingIds] of aliases) {
    if (matchingIds.size !== 1) {
      continue;
    }
    const combatantId = [...matchingIds][0];
    if (combatantId === undefined) {
      continue;
    }
    let start = options.text.indexOf(alias);
    while (start >= 0) {
      const before = options.text[start - 1];
      const after = options.text[start + alias.length];
      if (
        (before === undefined || !/[a-z0-9]/.test(before)) &&
        (after === undefined || !/[a-z0-9]/.test(after))
      ) {
        mentions.push({ combatantId, start, end: start + alias.length });
      }
      start = options.text.indexOf(alias, start + alias.length);
    }
  }
  return mentions.sort((left, right) => left.start - right.start);
};

/** Finds the combatant a death word grammatically claims was defeated. */
const deathClaimSubject = (options: {
  text: string;
  term: string;
  termStart: number;
  mentions: readonly CombatantMention[];
}): string | undefined => {
  const clauseStart = Math.max(
    options.text.lastIndexOf('.', options.termStart),
    options.text.lastIndexOf('!', options.termStart),
    options.text.lastIndexOf('?', options.termStart),
    options.text.lastIndexOf(';', options.termStart),
  );
  const followingStops = ['.', '!', '?', ';']
    .map((stop) => options.text.indexOf(stop, options.termStart))
    .filter((index) => index >= 0);
  const clauseEnd = followingStops.length === 0 ? options.text.length : Math.min(...followingStops);
  const before = options.mentions.filter(
    (mention) => mention.start > clauseStart && mention.end <= options.termStart,
  );
  const after = options.mentions.filter(
    (mention) =>
      mention.start >= options.termStart + options.term.length && mention.end <= clauseEnd,
  );
  if (options.term === 'killed') {
    const passivePrefix = options.text.slice(before.at(-1)?.end ?? clauseStart, options.termStart);
    if (/\b(?:is|was|gets|got|lies)\b/.test(passivePrefix)) {
      return before.at(-1)?.combatantId;
    }
    return after[0]?.combatantId;
  }
  if (options.term === 'corpse') {
    return after[0]?.combatantId ?? before.at(-1)?.combatantId;
  }
  return before.at(-1)?.combatantId ?? after[0]?.combatantId;
};

/** Every death word must resolve to a combatant actually defeated by the kernel. */
const hasInventedDeathClaim = (options: {
  text: string;
  defeated: readonly string[];
  names?: Readonly<Record<string, string>>;
}): boolean => {
  const mentions = combatantMentions({
    text: options.text,
    combatantIds: options.defeated,
    names: options.names,
  });
  for (const term of DEATH_TERMS) {
    let termStart = options.text.indexOf(term);
    while (termStart >= 0) {
      const subject = deathClaimSubject({ text: options.text, term, termStart, mentions });
      if (subject === undefined || !options.defeated.includes(subject)) {
        return true;
      }
      termStart = options.text.indexOf(term, termStart + term.length);
    }
  }
  return false;
};

/**
 * Validates model-authored narration against the events it claims to describe.
 *
 * Rejections are deliberate: a rejected block degrades to the authored
 * template, which can never contradict the kernel.
 */
export const validateCombatNarrationText = (options: {
  text: string;
  events: readonly CombatEvent[];
  names?: Readonly<Record<string, string>>;
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
  const lowerText = text.toLowerCase();
  if (
    containsAny(lowerText, DEATH_TERMS) &&
    hasInventedDeathClaim({
      text: lowerText,
      defeated: facts.defeated,
      ...(options.names === undefined ? {} : { names: options.names }),
    })
  ) {
    return { ok: false, reason: 'invented_outcome' };
  }
  if (facts.ended?.victory !== true && containsAny(lowerText, VICTORY_TERMS)) {
    return { ok: false, reason: 'invented_outcome' };
  }
  return { ok: true, text };
};
