// apps/frontend/client/src/lib/views/combat/combat_narration.ts
//
// Combat narration (Combat-05).
//
// Narration is PRESENTATION. It can never add a mechanic, a dice result or a
// fact the engine did not emit:
//
//   - attempt narration happens BEFORE resolution and therefore claims nothing
//     about hit/damage/movement/death;
//   - outcome narration is derived ONLY from the `CombatEvent[]` the kernel
//     returned, and every clause cites an event that exists;
//   - both paths fall back to authored templates, so a narration difference can
//     never affect a replay or a saved game (nothing here is persisted).
//
// The prompt builders are pure and exportable so a caller can narrate with the
// model while the templates keep the offline path playable.
//
// Contract: C-525 AC-7

import type { CombatEvent, CombatState, GridPoint } from '@aikami/types';

// ── Authored fallback templates ────────────────────────────────────────────

/** Authored templates used when the model is unavailable (offline mode). */
export const AUTHORED_COMBAT_NARRATION = {
  attempt: {
    ability: 'You make your move.',
    move: 'You break into motion.',
    defend: 'You brace for the next blow.',
    wait: 'You hold your ground.',
    endTurn: 'You let the moment pass.',
  },
  hit: 'The blow lands.',
  miss: 'The blow goes wide.',
  critical: 'A critical hit!',
  damage: 'Wounds are taken.',
  downed: 'A fighter drops to one knee.',
  defeated: 'A fighter falls and does not rise.',
  movement: 'Boots scrape across the ground.',
  turn: 'The turn passes to the next fighter.',
  victory: 'The field is yours.',
  defeat: 'The fight slips away.',
  none: '',
} as const;

const ACTION_KINDS = ['ability', 'move', 'defend', 'wait', 'endTurn'] as const;

export type CombatAttemptKind = (typeof ACTION_KINDS)[number];

// ── Attempt narration (may precede resolution) ─────────────────────────────

export type CombatAttemptNarrationInput = {
  kind: CombatAttemptKind;
  actorName: string;
  targetName?: string;
  abilityName?: string;
};

/**
 * One sentence describing what the actor is ATTEMPTING.
 *
 * Deliberately free of outcome verbs: at this point nothing has resolved, so
 * "you strike at the goblin" is allowed and "you hit the goblin" is not.
 */
export const buildAttemptNarration = (input: CombatAttemptNarrationInput): string => {
  if (input.kind !== 'ability') {
    return AUTHORED_COMBAT_NARRATION.attempt[input.kind];
  }
  const ability = input.abilityName ?? 'attack';
  const target = input.targetName ?? 'the nearest foe';
  return `${input.actorName} winds up ${ability} at ${target}.`;
};

/** Offline attempt template for a `CombatAttemptKind`. */
export const attemptNarrationTemplate = (kind: CombatAttemptKind): string =>
  AUTHORED_COMBAT_NARRATION.attempt[kind];

// ── Outcome facts derived from events ──────────────────────────────────────

/** Everything narration is allowed to say, each item traced to an event. */
export type CombatNarrationFacts = {
  attacks: Array<{ attackerId: string; targetId: string; hit: boolean; critical: boolean }>;
  damages: Array<{ targetId: string; amount: number; damageType: string }>;
  movements: Array<{ combatantId: string; cells: number }>;
  downed: string[];
  defeated: string[];
  turnEnded: string[];
  ended: { victory: boolean; reason: string } | null;
};

/** Pure projection of `CombatEvent[]` — the sole input to outcome narration. */
export const narrationFactsFromEvents = (events: readonly CombatEvent[]): CombatNarrationFacts => {
  const facts: CombatNarrationFacts = {
    attacks: [],
    damages: [],
    movements: [],
    downed: [],
    defeated: [],
    turnEnded: [],
    ended: null,
  };
  for (const event of events) {
    switch (event.kind) {
      case 'attackRolled':
        facts.attacks.push({
          attackerId: event.attackerId,
          targetId: event.targetId,
          hit: event.hit,
          critical: event.isCriticalHit,
        });
        break;
      case 'damageApplied':
        facts.damages.push({
          targetId: event.targetId,
          amount: event.amount,
          damageType: event.damageType,
        });
        break;
      case 'movementCommitted':
        facts.movements.push({
          combatantId: event.combatantId,
          cells: Math.max(0, event.movementCost),
        });
        break;
      case 'combatantDowned':
        facts.downed.push(event.combatantId);
        break;
      case 'combatantDefeated':
        facts.defeated.push(event.combatantId);
        break;
      case 'turnEnded':
        facts.turnEnded.push(event.combatantId);
        break;
      case 'combatEnded':
        facts.ended = { victory: event.victory, reason: event.reason };
        break;
      default:
        break;
    }
  }
  return facts;
};

const nameOf = (state: CombatState, combatantId: string): string =>
  state.combatants[combatantId]?.name ?? combatantId;

/** Path length in cells for a committed move (for narration only). */
export const movementCells = (path: readonly GridPoint[]): number => Math.max(0, path.length - 1);

// ── Outcome narration (after resolution) ───────────────────────────────────

export type CombatOutcomeNarrationInput = {
  state: CombatState;
  events: readonly CombatEvent[];
};

/**
 * One authored sentence per resolved fact, in event order.
 *
 * Returns the empty string when the events add no facts (an empty turn narrates
 * nothing rather than inventing action).
 */
export const buildOutcomeNarration = (input: CombatOutcomeNarrationInput): string => {
  const facts = narrationFactsFromEvents(input.events);
  const clauses: string[] = [];

  for (const attack of facts.attacks) {
    const attacker = nameOf(input.state, attack.attackerId);
    const target = nameOf(input.state, attack.targetId);
    if (attack.critical) {
      clauses.push(`${attacker} lands a critical hit on ${target}.`);
    } else if (attack.hit) {
      clauses.push(`${attacker} hits ${target}.`);
    } else {
      clauses.push(`${attacker} misses ${target}.`);
    }
  }
  for (const damage of facts.damages) {
    clauses.push(`${nameOf(input.state, damage.targetId)} takes ${damage.amount} damage.`);
  }
  for (const movement of facts.movements) {
    clauses.push(`${nameOf(input.state, movement.combatantId)} moves ${movement.cells} cells.`);
  }
  for (const combatantId of facts.downed) {
    clauses.push(`${nameOf(input.state, combatantId)} is downed.`);
  }
  for (const combatantId of facts.defeated) {
    clauses.push(`${nameOf(input.state, combatantId)} falls.`);
  }
  if (facts.ended !== null) {
    clauses.push(
      facts.ended.victory ? AUTHORED_COMBAT_NARRATION.victory : AUTHORED_COMBAT_NARRATION.defeat,
    );
  }
  return clauses.join(' ');
};

// ── Prompt builders (model narration, same facts only) ─────────────────────

/** Prompt for attempt narration — states explicitly that nothing resolved yet. */
export const buildAttemptNarrationPrompt = (input: CombatAttemptNarrationInput): string =>
  [
    'Write one short sentence of combat narration, past tense, second person.',
    `The actor is attempting: ${input.kind}.`,
    `Actor: ${input.actorName}.`,
    ...(input.targetName === undefined ? [] : [`Target: ${input.targetName}.`]),
    ...(input.abilityName === undefined ? [] : [`Ability: ${input.abilityName}.`]),
    'Nothing has resolved yet: do not state or imply a hit, a miss, damage, movement, death or victory.',
  ].join('\n');

/**
 * Prompt for outcome narration.
 *
 * The fact list is rendered from `narrationFactsFromEvents`, so the model can
 * only rephrase what the kernel emitted.
 */
export const buildOutcomeNarrationPrompt = (input: CombatOutcomeNarrationInput): string => {
  const facts = narrationFactsFromEvents(input.events);
  const lines = [
    'Write at most three short sentences of combat narration from these resolved facts only.',
    'Do not add mechanics, numbers, injuries or outcomes that are not listed.',
    `Attacks: ${JSON.stringify(facts.attacks)}`,
    `Damage: ${JSON.stringify(facts.damages)}`,
    `Movements: ${JSON.stringify(facts.movements)}`,
    `Downed: ${JSON.stringify(facts.downed)}`,
    `Defeated: ${JSON.stringify(facts.defeated)}`,
    `Ended: ${JSON.stringify(facts.ended)}`,
  ];
  return lines.join('\n');
};
