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

import type { CombatEvent, CombatState, GridPoint, NarrationFactRef } from '@aikami/types';

// ── Authored fallback templates ────────────────────────────────────────────

/** Authored templates used when the model is unavailable (offline mode). */
export const AUTHORED_COMBAT_NARRATION = {
  attempt: {
    ability: 'You make your move.',
    move: 'You break into motion.',
    defend: 'You brace for the next blow.',
    wait: 'You hold your ground.',
    endTurn: 'You let the moment pass.',
    interact: 'You reach for the battlefield around you.',
    surrender: 'You lower your guard and yield.',
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
  environmentBroken: 'The battlefield itself gives way.',
  environmentIgnited: 'Flame takes hold.',
  environmentCover: 'Cover shifts.',
  hazard: 'The hazard bites.',
  none: '',
} as const;

const ACTION_KINDS = [
  'ability',
  'move',
  'defend',
  'wait',
  'endTurn',
  'interact',
  'surrender',
] as const;

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
  /** Combat-07: committed environmental consequences, in event order. */
  objectStateChanges: Array<{ objectId: string; state: 'intact' | 'broken' }>;
  objectIgnitions: Array<{ objectId: string; ignited: boolean }>;
  objectCoverChanges: Array<{ objectId: string; cover: 'none' | 'half' | 'full' }>;
  surfacesCreated: Array<{ surfaceKind: 'oil' | 'fire'; cells: number }>;
  environmentalChecks: Array<{ combatantId: string; success: boolean }>;
  environmentalDamages: Array<{ combatantId: string; amount: number }>;
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
    objectStateChanges: [],
    objectIgnitions: [],
    objectCoverChanges: [],
    surfacesCreated: [],
    environmentalChecks: [],
    environmentalDamages: [],
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
          cells: movementCells(event.path),
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
      case 'objectStateChanged':
        facts.objectStateChanges.push({ objectId: event.objectId, state: event.state });
        break;
      case 'objectIgnitedChanged':
        facts.objectIgnitions.push({ objectId: event.objectId, ignited: event.ignited });
        break;
      case 'objectCoverChanged':
        facts.objectCoverChanges.push({ objectId: event.objectId, cover: event.cover });
        break;
      case 'surfaceCreated':
        facts.surfacesCreated.push({ surfaceKind: event.surfaceKind, cells: 1 });
        break;
      case 'environmentalCheckRolled':
        facts.environmentalChecks.push({
          combatantId: event.combatantId,
          success: event.success,
        });
        break;
      case 'environmentalDamageApplied':
        facts.environmentalDamages.push({
          combatantId: event.combatantId,
          amount: event.amount,
        });
        break;
      default:
        break;
    }
  }
  return facts;
};

const nameOf = (input: CombatOutcomeNarrationInput, combatantId: string): string =>
  input.names?.[combatantId] ?? input.state?.combatants[combatantId]?.name ?? combatantId;

/** Path length in cells for a committed move (for narration only). */
export const movementCells = (path: readonly GridPoint[]): number => Math.max(0, path.length - 1);

// ── Outcome narration (after resolution) ───────────────────────────────────

export type CombatOutcomeNarrationInput = {
  events: readonly CombatEvent[];
  /**
   * authored combatant id → display name.
   *
   * Preferred over `state` when present: the engine already resolves names, so a
   * caller that received them never needs a state snapshot just to narrate.
   */
  names?: Record<string, string>;
  /** Optional snapshot, used for names when no explicit map is supplied. */
  state?: CombatState;
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
    const attacker = nameOf(input, attack.attackerId);
    const target = nameOf(input, attack.targetId);
    if (attack.critical) {
      clauses.push(`${attacker} lands a critical hit on ${target}.`);
    } else if (attack.hit) {
      clauses.push(`${attacker} hits ${target}.`);
    } else {
      clauses.push(`${attacker} misses ${target}.`);
    }
  }
  for (const damage of facts.damages) {
    clauses.push(`${nameOf(input, damage.targetId)} takes ${damage.amount} damage.`);
  }
  for (const movement of facts.movements) {
    clauses.push(`${nameOf(input, movement.combatantId)} moves ${movement.cells} cells.`);
  }
  for (const combatantId of facts.downed) {
    clauses.push(`${nameOf(input, combatantId)} is downed.`);
  }
  for (const combatantId of facts.defeated) {
    clauses.push(`${nameOf(input, combatantId)} falls.`);
  }
  // Combat-07: environmental clauses cite only committed environmental events.
  for (const change of facts.objectStateChanges) {
    clauses.push(
      change.state === 'broken'
        ? `${change.objectId} breaks.`
        : `${change.objectId} is set back up.`,
    );
  }
  for (const ignition of facts.objectIgnitions) {
    clauses.push(
      ignition.ignited ? `${ignition.objectId} catches fire.` : `${ignition.objectId} goes out.`,
    );
  }
  for (const change of facts.objectCoverChanges) {
    clauses.push(`${change.objectId} now grants ${change.cover} cover.`);
  }
  for (const surface of facts.surfacesCreated) {
    clauses.push(`${surface.surfaceKind} spreads across the ground.`);
  }
  for (const damage of facts.environmentalDamages) {
    clauses.push(`${nameOf(input, damage.combatantId)} takes ${damage.amount} damage.`);
  }
  if (facts.ended !== null) {
    clauses.push(
      facts.ended.victory ? AUTHORED_COMBAT_NARRATION.victory : AUTHORED_COMBAT_NARRATION.defeat,
    );
  }
  return clauses.join(' ');
};

// ── Constrained fact references (deterministic rendering) ───────────────────

/**
 * Renders ONE mechanical claim from the fact it references.
 *
 * The model authors references, never wording: this function is the only place
 * a mechanical sentence comes from, so "the model invented an outcome" is not
 * representable. Returns `undefined` when the reference does not resolve to a
 * fact the events actually contain — the caller then rejects the whole draft
 * and uses the authored template (AC-11).
 */
export const renderNarrationClaim = (options: {
  claim: NarrationFactRef;
  facts: CombatNarrationFacts;
  names?: Record<string, string>;
  state?: CombatState;
}): string | undefined => {
  const { claim, facts } = options;
  const nameOfClaim = (combatantId: string): string => {
    const named = options.names?.[combatantId];
    if (named !== undefined && named.length > 0) {
      return named;
    }
    const fromState = options.state?.combatants[combatantId]?.name;
    if (fromState !== undefined && fromState.length > 0) {
      return fromState;
    }
    return combatantId;
  };
  switch (claim.kind) {
    case 'attack': {
      const attack = facts.attacks[claim.index];
      if (attack === undefined) {
        return undefined;
      }
      const attacker = nameOfClaim(attack.attackerId);
      const target = nameOfClaim(attack.targetId);
      if (attack.critical) {
        return `${attacker} lands a critical hit on ${target}.`;
      }
      return attack.hit ? `${attacker} hits ${target}.` : `${attacker} misses ${target}.`;
    }
    case 'damage': {
      const damage = facts.damages[claim.index];
      if (damage === undefined) {
        return undefined;
      }
      return `${nameOfClaim(damage.targetId)} takes ${damage.amount} damage.`;
    }
    case 'movement': {
      const movement = facts.movements[claim.index];
      if (movement === undefined) {
        return undefined;
      }
      return `${nameOfClaim(movement.combatantId)} moves ${movement.cells} cells.`;
    }
    case 'downed': {
      const combatantId = facts.downed[claim.index];
      if (combatantId === undefined) {
        return undefined;
      }
      return `${nameOfClaim(combatantId)} is downed.`;
    }
    case 'defeated': {
      const combatantId = facts.defeated[claim.index];
      if (combatantId === undefined) {
        return undefined;
      }
      return `${nameOfClaim(combatantId)} falls.`;
    }
    case 'ended': {
      if (facts.ended === null) {
        return undefined;
      }
      return facts.ended.victory
        ? AUTHORED_COMBAT_NARRATION.victory
        : AUTHORED_COMBAT_NARRATION.defeat;
    }
  }
};

/**
 * Renders an ordered claim list.
 *
 * Returns `undefined` when ANY reference fails to resolve, so a draft that
 * points past the end of a fact list can never produce partial prose that looks
 * verified.
 */
export const renderNarrationClaims = (options: {
  claims: readonly NarrationFactRef[];
  facts: CombatNarrationFacts;
  names?: Record<string, string>;
  state?: CombatState;
}): string | undefined => {
  const clauses: string[] = [];
  for (const claim of options.claims) {
    const clause = renderNarrationClaim({
      claim,
      facts: options.facts,
      ...(options.names === undefined ? {} : { names: options.names }),
      ...(options.state === undefined ? {} : { state: options.state }),
    });
    if (clause === undefined) {
      return undefined;
    }
    clauses.push(clause);
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
  const nameHint = (combatantId: string): string => nameOf(input, combatantId);
  const lines = [
    'You are narrating a resolved combat turn. You may NOT invent mechanics.',
    '',
    'Return JSON with two fields:',
    '  claims: an ordered list of the resolved facts you want narrated. Each entry',
    '          references a fact by kind and index from the lists below.',
    '  flavor: OPTIONAL one evocative sentence that asserts nothing mechanical.',
    '          It may not name any combatant, contain digits, or use outcome',
    '          vocabulary (hit, miss, damage, wound, downed, dead, slain, victory,',
    '          defeat). Wording for mechanics comes from the facts, not from you.',
    '',
    'Fact lists (index: value):',
  ];
  facts.attacks.forEach((attack, index) => {
    let outcome = 'miss';
    if (attack.hit) {
      outcome = attack.critical ? 'critical hit' : 'hit';
    }
    lines.push(
      `  attack[${index}]: ${nameHint(attack.attackerId)} -> ${nameHint(attack.targetId)} (${outcome})`,
    );
  });
  facts.damages.forEach((damage, index) => {
    lines.push(`  damage[${index}]: ${nameHint(damage.targetId)} takes ${damage.amount}`);
  });
  facts.movements.forEach((movement, index) => {
    lines.push(`  movement[${index}]: ${nameHint(movement.combatantId)} moves ${movement.cells}`);
  });
  facts.downed.forEach((combatantId, index) => {
    lines.push(`  downed[${index}]: ${nameHint(combatantId)}`);
  });
  facts.defeated.forEach((combatantId, index) => {
    lines.push(`  defeated[${index}]: ${nameHint(combatantId)}`);
  });
  if (facts.ended !== null) {
    lines.push(`  ended: the encounter ${facts.ended.victory ? 'was won' : 'was lost'}`);
  }
  if (facts.attacks.length + facts.damages.length + facts.movements.length === 0) {
    lines.push('  (no attacks, damage or movement resolved this turn)');
  }
  return lines.join('\n');
};
