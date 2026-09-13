// packages/shared/utils/src/lib/rules/combat_intent_parser.ts
//
// Deterministic offline intent parser (Combat-05).
//
// When the model is unavailable, slow, rate-limited or returns something the
// schema rejects, an ordinary "move / attack / ability / defend / end turn"
// instruction must still be playable. This module is the deterministic mirror
// of the interpreter: pure, synchronous, selector-only output (never an id, a
// coordinate or a dice value) and deliberately conservative — anything it
// cannot read confidently is `unparseable` rather than a guess.
//
// Contract: C-525 AC-6

import { COMBAT_INTENT_BOUNDS } from '@aikami/schemas';
import type {
  AbilitySelector,
  ActionIntent,
  EntitySelector,
  IntentInterpreterResult,
  IntentStep,
  LocationSelector,
} from '@aikami/types';

// ---------------------------------------------------------------------------
// Grammar tables — data, not code
// ---------------------------------------------------------------------------

/** Ability tags the parser recognises, longest phrase first. */
const ABILITY_TAGS: ReadonlyArray<{ pattern: RegExp; tag: string }> = [
  { pattern: /\b(melee|close combat|sword|swing|stab|slash|punch|kick)\b/, tag: 'melee_attack' },
  { pattern: /\b(ranged|bow|arrow|shoot|shot|snipe)\b/, tag: 'ranged_attack' },
  { pattern: /\b(defend|block|brace|guard)\b/, tag: 'defend' },
];

const HOSTILE_TARGET = /\b(enem(?:y|ies)|hostile|foe|opponent|monster|creature)\b/;
const ALLY_TARGET = /\b(ally|allies|companion|friend|teammate)\b/;
const LAST_ATTACKER = /\b(who(?:ever)? (?:just )?(?:hit|attacked) me|my attacker|last attacker)\b/;
const PREVIOUS_TARGET = /\b(same target|previous target|that one again)\b/;
const SAFE_DESTINATION = /\b(safe|safety|cover|away|back off|retreat|flee)\b/;
const END_TURN = /\b(end (?:my )?turn|pass(?: the)? turn|finish (?:my )?turn|done)\b/;
const WAIT = /\b(wait|hold|hold position|stand by|skip)\b/;
const DEFEND = /\b(defend|block|brace|guard)\b/;
const MOVE_VERB =
  /\b(move|go|walk|run|step|advance|charge|close in|approach|retreat|flee|fall back|back off)\b/;
const ABILITY_VERB = /\b(attack|hit|strike|shoot|fire|cast|use|swing|cast spell)\b/;

/**
 * Object affordances are Combat-07. A phrase that asks to manipulate the world
 * is refused with a typed reason instead of being mapped onto whatever verb
 * happens to appear in it ("throw the barrel" is not an attack).
 */
const OBJECT_AFFORDANCE =
  /\b(barrel|crate|chest|door|lever|switch|urn|sarcophagus|pick(?: up)?|lift|grab|push|pull|throw|open|unlock|drink|read|talk to|examine|inspect)\b/;

/** `use fireball` / `cast the fireball` → the free-text ability tag. */
const NAMED_ABILITY =
  /\b(?:use|cast|cast spell)\s+(?:my\s+|the\s+|a\s+|an\s+)?([a-z][a-z0-9 _-]{1,63})\b/;

/** `move to the goblin` / `attack the hobgoblin archer` → the named target. */
const NAMED_TARGET =
  /\b(?:move to|go to|approach|attack|hit|strike|shoot|target)\s+(?:the\s+)([a-z][a-z0-9 _-]{1,63})\b/;

/** Words that end an ability phrase rather than belonging to its name. */
const ABILITY_PHRASE_STOP_WORDS = new Set([
  'my',
  'the',
  'a',
  'an',
  'some',
  'his',
  'her',
  'its',
  'at',
  'on',
  'to',
  'and',
  'then',
  'with',
  'using',
  'attack',
  'attacks',
  'strike',
  'hit',
  'target',
  'enemy',
  'enemies',
  'hostile',
  'him',
  'her',
  'them',
  'it',
  'nearest',
  'closest',
  'farthest',
]);

/**
 * Reads an ability reference out of `use <name> … `.
 *
 * The phrase ends at the first stop word, so "use my heavy melee attack" is
 * `heavy_melee` — not `heavy_melee_attack` (which is not a catalogued id).
 */
const readNamedAbility = (text: string): string | null => {
  const captured = NAMED_ABILITY.exec(text)?.[1];
  if (captured === undefined) {
    return null;
  }
  const tokens: string[] = [];
  for (const token of captured.trim().split(/\s+/)) {
    if (ABILITY_PHRASE_STOP_WORDS.has(token)) {
      break;
    }
    tokens.push(token);
    if (tokens.length === 3) {
      break;
    }
  }
  const tag = normalizeIntentTag(tokens.join('_'));
  return tag.length === 0 ? null : tag;
};

const hasWord = (pattern: RegExp, text: string): boolean => pattern.test(text);

/** Normalises free text into an authored-content-shaped tag. */
export const normalizeIntentTag = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, '_')
    .replaceAll(/[^a-z0-9_]/g, '');

const namedRef = (value: string): string =>
  value.trim().slice(0, COMBAT_INTENT_BOUNDS.namedRefChars);

// ---------------------------------------------------------------------------
// Clause parsing
// ---------------------------------------------------------------------------

const parseTargetSelector = (text: string): EntitySelector => {
  if (hasWord(LAST_ATTACKER, text)) {
    return { kind: 'last_attacker' };
  }
  if (hasWord(PREVIOUS_TARGET, text)) {
    return { kind: 'previous_target' };
  }
  if (hasWord(ALLY_TARGET, text)) {
    return { kind: 'nearest_ally' };
  }
  const named = NAMED_TARGET.exec(text)?.[1];
  if (named !== undefined && !hasWord(HOSTILE_TARGET, text)) {
    return { kind: 'explicit', namedRef: namedRef(named) };
  }
  return { kind: 'nearest_hostile' };
};

const parseDestinationSelector = (text: string): LocationSelector => {
  if (hasWord(SAFE_DESTINATION, text)) {
    return { kind: 'nearest_safe' };
  }
  const target = parseTargetSelector(text);
  let band: 'melee' | 'reach' | 'ranged' = 'reach';
  if (hasWord(ABILITY_TAGS[1].pattern, text)) {
    band = 'ranged';
  } else if (hasWord(/\b(adjacent|next to|beside|in melee|melee range)\b/, text)) {
    band = 'melee';
  }
  return { kind: 'relative', relativeTo: target, band, direction: 'toward' };
};

const parseAbilitySelector = (text: string): AbilitySelector => {
  const named = readNamedAbility(text);
  if (named !== null) {
    return { kind: 'tag', value: named };
  }
  if (/\bstrongest|most damaging|biggest\b/.test(text)) {
    return { kind: 'strongest' };
  }
  if (/\bfire\b/.test(text)) {
    return { kind: 'strongest', damageType: 'fire' };
  }
  for (const entry of ABILITY_TAGS) {
    if (entry.pattern.test(text)) {
      return { kind: 'tag', value: entry.tag };
    }
  }
  return { kind: 'tag', value: 'basic_melee' };
};

/**
 * Reads one ordinary combat instruction into intent steps.
 *
 * Returns `null` when the text asks for nothing this parser understands: an
 * unreadable instruction must never become an arbitrary action.
 */
export const parseIntentSteps = (rawText: string): IntentStep[] | null => {
  const text = rawText.trim().toLowerCase();
  if (text.length === 0) {
    return null;
  }
  // Ordered so an explicit "end turn" wins over the generic move/ability verbs.
  if (hasWord(END_TURN, text)) {
    return [{ kind: 'end_turn' }];
  }
  if (hasWord(DEFEND, text) && !hasWord(MOVE_VERB, text)) {
    return [{ kind: 'defend' }];
  }
  if (hasWord(ABILITY_VERB, text)) {
    return [
      {
        kind: 'use_ability',
        ability: parseAbilitySelector(text),
        target: parseTargetSelector(text),
      },
    ];
  }
  if (hasWord(MOVE_VERB, text)) {
    return [{ kind: 'move', destination: parseDestinationSelector(text) }];
  }
  if (hasWord(WAIT, text)) {
    return [{ kind: 'wait' }];
  }
  return null;
};

// ---------------------------------------------------------------------------
// parseCombatIntent (AC-6)
// ---------------------------------------------------------------------------

export type ParseCombatIntentOptions = {
  /** Client-minted intent id. */
  intentId: string;
  encounterId: string;
  actorId: string;
  basedOnRevision: number;
  text: string;
};

/**
 * Deterministic, always-typed answer for an ordinary instruction.
 *
 * Never throws, never returns an id/coordinate/dice value, and never widens the
 * intent vocabulary: an unreadable phrase is a typed `unparseable` so the UI can
 * ask instead of acting on a guess.
 */
export const parseCombatIntent = (options: ParseCombatIntentOptions): IntentInterpreterResult => {
  const text = options.text.slice(0, COMBAT_INTENT_BOUNDS.rawTextChars);
  if (hasWord(OBJECT_AFFORDANCE, text)) {
    // Reserved for Combat-07: refuse rather than invent an interaction.
    return { ok: false, reason: 'refused' };
  }
  const steps = parseIntentSteps(text);
  if (steps === null) {
    return { ok: false, reason: 'unparseable' };
  }
  const intent: ActionIntent = {
    intentId: options.intentId,
    encounterId: options.encounterId,
    actorId: options.actorId,
    basedOnRevision: options.basedOnRevision,
    source: 'fallback_parser',
    steps,
    rawText: text,
  };
  return { ok: true, intent };
};
