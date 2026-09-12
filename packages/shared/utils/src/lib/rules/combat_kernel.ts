// packages/shared/utils/src/lib/rules/combat_kernel.ts
//
// Pure, deterministic combat kernel — the single mechanical authority for
// Combat 2.0. Snapshot-in / `{ state, events }`-out, no I/O, no engine or
// client imports, and no ambient randomness. The RNG is advanced only through
// explicit named substreams carried in the state.
//
// Contract: C-509 AC-2, AC-4, AC-5, AC-7

import {
  COMBAT_REPLAY_VERSION,
  COMBAT_SCHEMA_VERSION,
  CombatCommandSchema,
  CombatStateSchema,
} from '@aikami/schemas';
import type {
  BattlefieldState,
  CombatAbilityDefinition,
  CombatActionCost,
  CombatantState,
  CombatCommand,
  CombatDivergence,
  CombatEvent,
  CombatInvalidReason,
  CombatObjectiveState,
  CombatOutcome,
  CombatReplay,
  CombatRngState,
  CombatRngStreamKey,
  CombatState,
  CombatValidationResult,
  GridPoint,
  ReplayCombatResult,
  ResolveCombatResult,
  TurnBudget,
} from '@aikami/types';
import { Value } from 'typebox/value';
import {
  createSeedableRng,
  deserializeRng,
  type SeedableRng,
  serializeRng,
} from '../rng/seedable_rng';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Rules version stamped on every state this kernel creates. */
export const COMBAT_RULES_VERSION = 'combat-2.0.0';

/**
 * Movement allowance restored when a combatant's turn starts.
 *
 * Combat-01 has no per-combatant speed field (§8.1 does not carry one), so the
 * turn-start budget reset uses this single documented allowance. Per-combatant
 * speed arrives with the tactical preview slice (Combat-03).
 */
export const DEFAULT_MOVEMENT_PER_TURN = 6;

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
  targetOutOfRange: 'combat.invalid.target_out_of_range',
  movementBudgetExceeded: 'combat.invalid.movement_budget_exceeded',
  pathBlocked: 'combat.invalid.path_blocked',
  pathInvalid: 'combat.invalid.path_invalid',
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const DAMAGE_DICE_PATTERN = /^(\d+)d(\d+)(?:\+(\d+))?$/;

/** Distinct salts keep the three named substreams independent on one seed. */
const STREAM_SALTS: Record<CombatRngStreamKey, number> = {
  initiative: 0x1f2e3d4c,
  actions: 0x2b3c4d5e,
  loot: 0x3c4d5e6f,
};

const deriveStreamSeed = (seed: number, salt: number): number =>
  (Math.imul(seed ^ salt, 0x85ebca6b) ^ salt) | 0;

/**
 * Structural clone of pure JSON combat data.
 *
 * `structuredClone` is available in Bun, Node ≥17, browsers and workers, and
 * is fully typed (`<T>(value: T) => T`) — no casting at this boundary. Clone
 * failures propagate so callers can fail without sharing the input reference.
 */
const cloneValue = <T>(value: T): T => structuredClone(value);

/**
 * Sorted-key JSON — the canonical byte-equivalence form. `JSON.stringify`
 * preserves insertion order, which is not stable across runs.
 */
export const canonicalCombatJson = (value: unknown): string => JSON.stringify(canonicalize(value));

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
};

const manhattan = (a: GridPoint, b: GridPoint): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

const turnIdFor = (round: number, combatantId: string): string => `r${round}:${combatantId}`;

/** Total order on combatant ids — the deterministic initiative tiebreak. */
const compareCombatantIds = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

/**
 * d20 attack outcome. Natural 20 always hits, natural 1 always misses
 * (both by the rules, not by the clamping of the totals).
 */
const resolveHit = (naturalRoll: number, totalRoll: number, armorClass: number): boolean => {
  if (naturalRoll === 20) {
    return true;
  }
  if (naturalRoll === 1) {
    return false;
  }
  return totalRoll >= armorClass;
};

const failure = (reasonCode: CombatInvalidReason) => ({
  valid: false as const,
  reasonCode,
  messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
});

const createRngState = (seed: number): CombatRngState => ({
  seed,
  streams: {
    initiative: serializeRng(createSeedableRng(deriveStreamSeed(seed, STREAM_SALTS.initiative))),
    actions: serializeRng(createSeedableRng(deriveStreamSeed(seed, STREAM_SALTS.actions))),
    loot: serializeRng(createSeedableRng(deriveStreamSeed(seed, STREAM_SALTS.loot))),
  },
});

const defaultBudget = (): TurnBudget => ({
  movementRemaining: DEFAULT_MOVEMENT_PER_TURN,
  actionAvailable: true,
  quickActionAvailable: true,
  reactionAvailable: true,
});

const activeCombatantId = (state: CombatState): string | null =>
  state.initiative.order[state.initiative.activeIndex] ?? null;

const rollDamage = (rng: SeedableRng, dice: string, isCritical: boolean): number => {
  const match = DAMAGE_DICE_PATTERN.exec(dice);
  if (match === null) {
    return 0;
  }
  const count = Number.parseInt(match[1], 10);
  const sides = Number.parseInt(match[2], 10);
  const bonus = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  const diceCount = isCritical ? count * 2 : count;
  let total = bonus;
  for (let index = 0; index < diceCount; index++) {
    total += rng.dice(sides);
  }
  return Math.max(0, total);
};

/**
 * `party_defeated` takes precedence when both sides are wiped on the same
 * command — a mutual wipe is a loss.
 */
const evaluateOutcome = (combatants: Record<string, CombatantState>): CombatOutcome | null => {
  const all = Object.values(combatants);
  const party = all.filter((combatant) => combatant.team === 'player' || combatant.team === 'ally');
  const enemies = all.filter((combatant) => combatant.team === 'enemy');
  if (party.length > 0 && party.every((combatant) => combatant.defeated)) {
    return { victory: false, reason: 'party_defeated' };
  }
  if (enemies.length > 0 && enemies.every((combatant) => combatant.defeated)) {
    return { victory: true, reason: 'all_enemies_defeated' };
  }
  return null;
};

const normalizeCommand = (command: CombatCommand): CombatCommand => {
  switch (command.kind) {
    case 'move':
      return {
        kind: 'move',
        combatantId: command.combatantId,
        path: command.path.map((cell) => ({ x: cell.x, y: cell.y })),
      };
    case 'useAbility':
      return {
        kind: 'useAbility',
        combatantId: command.combatantId,
        abilityId: command.abilityId,
        targetIds: [...new Set(command.targetIds)].sort(),
      };
    case 'defend':
      return { kind: 'defend', combatantId: command.combatantId };
    case 'wait':
      return { kind: 'wait', combatantId: command.combatantId };
    case 'endTurn':
      return { kind: 'endTurn', combatantId: command.combatantId };
    default:
      return command;
  }
};

const checkActionCost = (
  budget: TurnBudget,
  cost: CombatActionCost,
): CombatInvalidReason | null => {
  switch (cost) {
    case 'action':
      return budget.actionAvailable ? null : 'noActionAvailable';
    case 'quick':
      return budget.quickActionAvailable ? null : 'noActionAvailable';
    case 'reaction':
      // Reactions are Combat-08 — no reaction window exists in Combat-01.
      return 'noActionAvailable';
    case 'free':
      return null;
    default:
      return 'noActionAvailable';
  }
};

// ---------------------------------------------------------------------------
// createCombatState
// ---------------------------------------------------------------------------

export type CreateCombatStateInput = {
  encounterId: string;
  rulesVersion: string;
  seed: number;
  combatants: CombatantState[];
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  battlefield: BattlefieldState;
  objectives?: CombatObjectiveState[];
};

/**
 * Builds a versioned {@link CombatState}: deterministic initiative order
 * (initiative desc, combatantId asc), named RNG substreams derived from the
 * encounter seed, and every input structurally cloned so the caller's objects
 * are never shared with the returned state.
 */
export const createCombatState = (input: CreateCombatStateInput): CombatState => {
  const combatants: Record<string, CombatantState> = {};
  for (const combatant of input.combatants) {
    combatants[combatant.combatantId] = cloneValue(combatant);
  }

  const order = Object.values(combatants)
    .sort(
      (a, b) => b.initiative - a.initiative || compareCombatantIds(a.combatantId, b.combatantId),
    )
    .map((combatant) => combatant.combatantId);

  const hasCombatants = order.length > 0;

  return {
    schemaVersion: COMBAT_SCHEMA_VERSION,
    rulesVersion: input.rulesVersion,
    encounterId: input.encounterId,
    stateRevision: 0,
    round: 1,
    phase: hasCombatants ? 'active' : 'ended',
    turnId: hasCombatants ? turnIdFor(1, order[0]) : null,
    rng: createRngState(input.seed),
    initiative: { order, activeIndex: 0 },
    combatants,
    abilityCatalog: cloneValue(input.abilityCatalog),
    battlefield: cloneValue(input.battlefield),
    objectives: cloneValue(input.objectives ?? []),
    outcome: hasCombatants ? null : { victory: false, reason: 'no_combatants' },
  };
};

// ---------------------------------------------------------------------------
// validateCombatCommand
// ---------------------------------------------------------------------------

export type CombatCommandInput = {
  state: CombatState;
  command: CombatCommand;
  basedOnRevision?: number;
};

const validateMove = (
  state: CombatState,
  command: Extract<CombatCommand, { kind: 'move' }>,
  actor: CombatantState,
): CombatValidationResult => {
  const path = command.path;
  const battlefield = state.battlefield;
  const seen = new Set<string>();

  for (const cell of path) {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
      return failure('pathInvalid');
    }
    if (cell.x < 0 || cell.y < 0 || cell.x >= battlefield.width || cell.y >= battlefield.height) {
      return failure('pathInvalid');
    }
    if (cell.x === actor.position.x && cell.y === actor.position.y) {
      return failure('pathInvalid');
    }
    const key = `${cell.x}:${cell.y}`;
    if (seen.has(key)) {
      return failure('pathInvalid');
    }
    seen.add(key);
  }

  if (manhattan(actor.position, path[0]) !== 1) {
    return failure('pathInvalid');
  }
  for (let index = 1; index < path.length; index++) {
    if (manhattan(path[index - 1], path[index]) !== 1) {
      return failure('pathInvalid');
    }
  }
  for (const cell of path) {
    if (battlefield.blockedCells.some((blocked) => blocked.x === cell.x && blocked.y === cell.y)) {
      return failure('pathBlocked');
    }
  }
  if (path.length > actor.budget.movementRemaining) {
    return failure('movementBudgetExceeded');
  }
  return { valid: true, normalizedCommand: command };
};

const validateUseAbility = (
  state: CombatState,
  command: Extract<CombatCommand, { kind: 'useAbility' }>,
  actor: CombatantState,
): CombatValidationResult => {
  const ability = state.abilityCatalog[command.abilityId];
  if (ability === undefined) {
    return failure('abilityUnknown');
  }
  if (!actor.abilityIds.includes(command.abilityId)) {
    return failure('abilityNotAvailable');
  }
  const costFailure = checkActionCost(actor.budget, ability.actionCost);
  if (costFailure !== null) {
    return failure(costFailure);
  }

  const isAttack = ability.kind === 'melee_attack' || ability.kind === 'ranged_attack';
  if (isAttack && command.targetIds.length === 0) {
    return failure('targetInvalid');
  }
  for (const targetId of command.targetIds) {
    if (targetId === command.combatantId) {
      return failure('targetInvalid');
    }
    const target = state.combatants[targetId];
    if (target === undefined) {
      return failure('targetInvalid');
    }
    if (target.defeated) {
      return failure('targetDefeated');
    }
  }
  if (isAttack) {
    for (const targetId of command.targetIds) {
      const target = state.combatants[targetId];
      if (manhattan(actor.position, target.position) > ability.rangeCells) {
        return failure('targetOutOfRange');
      }
    }
  }
  return { valid: true, normalizedCommand: command };
};

/**
 * Validates a command without touching the state and without ever throwing.
 * `basedOnRevision` is the only input that can produce `staleRevision`.
 */
export const validateCombatCommand = (input: CombatCommandInput): CombatValidationResult => {
  const { state } = input;

  if (!Value.Check(CombatCommandSchema, input.command)) {
    return failure('invalidCommandShape');
  }
  const command = normalizeCommand(input.command);

  if (input.basedOnRevision !== undefined && input.basedOnRevision !== state.stateRevision) {
    return failure('staleRevision');
  }
  if (state.phase === 'ended') {
    return failure('encounterEnded');
  }

  const actor = state.combatants[command.combatantId];
  if (actor === undefined) {
    return failure('actorUnknown');
  }
  if (activeCombatantId(state) !== command.combatantId) {
    return failure('notActiveCombatant');
  }

  switch (command.kind) {
    case 'move':
      return validateMove(state, command, actor);
    case 'useAbility':
      return validateUseAbility(state, command, actor);
    case 'defend':
    case 'wait':
      // Defend and wait both spend the action; Combat-01 gives them no other
      // observable budget effect and no event (a budget event is Combat-03).
      return actor.budget.actionAvailable
        ? { valid: true, normalizedCommand: command }
        : failure('noActionAvailable');
    case 'endTurn':
      return { valid: true, normalizedCommand: command };
    default:
      return failure('invalidCommandShape');
  }
};

// ---------------------------------------------------------------------------
// resolveCombatCommand
// ---------------------------------------------------------------------------

type TurnAdvance = { combatantId: string; round: number; turnId: string };

/** Advances the active index, skipping defeated combatants and wrapping rounds. */
const advanceTurn = (state: CombatState): TurnAdvance | null => {
  const order = state.initiative.order;
  if (order.length === 0) {
    return null;
  }
  let index = state.initiative.activeIndex;
  let round = state.round;
  for (let step = 0; step < order.length; step++) {
    index += 1;
    if (index >= order.length) {
      index = 0;
      round += 1;
    }
    const candidate = state.combatants[order[index]];
    if (candidate !== undefined && !candidate.defeated) {
      state.initiative.activeIndex = index;
      state.round = round;
      candidate.budget = defaultBudget();
      const turnId = turnIdFor(round, candidate.combatantId);
      state.turnId = turnId;
      return { combatantId: candidate.combatantId, round, turnId };
    }
  }
  return null;
};

/**
 * Validates then resolves a single combat command against an immutable state.
 *
 * On `valid: false` the caller's state is untouched and no partial state is
 * ever returned. On success the input is not mutated, `stateRevision` advances
 * by exactly one, and only the relevant RNG substream moves.
 */
export const resolveCombatCommand = (input: CombatCommandInput): ResolveCombatResult => {
  try {
    if (!Value.Check(CombatStateSchema, input.state)) {
      return failure('invalidStateShape');
    }
  } catch {
    return failure('invalidStateShape');
  }

  const validation = validateCombatCommand(input);
  if (!validation.valid) {
    return failure(validation.reasonCode);
  }

  const state = input.state;
  const command = validation.normalizedCommand;
  const revision = state.stateRevision + 1;
  const round = state.round;
  const turnId = state.turnId ?? turnIdFor(round, command.combatantId);
  let next: CombatState;
  try {
    next = cloneValue(state);
  } catch {
    return failure('invalidStateShape');
  }
  const events: CombatEvent[] = [];
  const envelope = { encounterId: next.encounterId, turnId, stateRevision: revision, round };
  const actor = next.combatants[command.combatantId];

  switch (command.kind) {
    case 'move': {
      const path = command.path;
      const last = path[path.length - 1];
      actor.position = { x: last.x, y: last.y };
      actor.budget.movementRemaining -= path.length;
      events.push({
        ...envelope,
        kind: 'movementCommitted',
        combatantId: command.combatantId,
        path: path.map((cell) => ({ x: cell.x, y: cell.y })),
        movementCost: path.length,
        movementRemaining: actor.budget.movementRemaining,
      });
      break;
    }

    case 'useAbility': {
      const ability = next.abilityCatalog[command.abilityId];
      if (ability.actionCost === 'action') {
        actor.budget.actionAvailable = false;
      } else if (ability.actionCost === 'quick') {
        actor.budget.quickActionAvailable = false;
      }

      const isAttack = ability.kind === 'melee_attack' || ability.kind === 'ranged_attack';
      if (isAttack) {
        const actionsRng = deserializeRng(next.rng.streams.actions);
        for (const targetId of command.targetIds) {
          const target = next.combatants[targetId];
          const naturalRoll = actionsRng.dice(20);
          const totalRoll = naturalRoll + actor.attackBonus + ability.attackBonus;
          const hit = resolveHit(naturalRoll, totalRoll, target.armorClass);
          const isCriticalHit = naturalRoll === 20;

          events.push({
            ...envelope,
            kind: 'attackRolled',
            attackerId: command.combatantId,
            targetId,
            abilityId: command.abilityId,
            naturalRoll,
            totalRoll,
            hit,
            isCriticalHit,
          });

          if (!hit || ability.damageDice === null || ability.damageType === null) {
            continue;
          }

          const amount = rollDamage(actionsRng, ability.damageDice, isCriticalHit);
          const hpAfter = Math.max(0, target.hp - amount);
          const downed = hpAfter <= 0;
          target.hp = hpAfter;
          target.downed = downed || target.downed;
          target.defeated = downed || target.defeated;

          events.push({
            ...envelope,
            kind: 'damageApplied',
            attackerId: command.combatantId,
            targetId,
            amount,
            damageType: ability.damageType,
            hpAfter,
            downed,
          });

          if (downed) {
            // Combat-01 equates downed and defeated (death saves/revive are later slices).
            events.push({ ...envelope, kind: 'combatantDowned', combatantId: targetId });
            events.push({ ...envelope, kind: 'combatantDefeated', combatantId: targetId });
          }
        }
        next.rng = {
          ...next.rng,
          streams: { ...next.rng.streams, actions: serializeRng(actionsRng) },
        };
      }

      const outcome = evaluateOutcome(next.combatants);
      if (outcome !== null) {
        next.phase = 'ended';
        next.outcome = outcome;
        events.push({
          ...envelope,
          kind: 'combatEnded',
          victory: outcome.victory,
          reason: outcome.reason,
        });
      }
      break;
    }

    case 'defend':
    case 'wait': {
      actor.budget.actionAvailable = false;
      break;
    }

    case 'endTurn': {
      events.push({ ...envelope, kind: 'turnEnded', combatantId: command.combatantId });
      const advance = advanceTurn(next);
      if (advance !== null) {
        events.push({
          encounterId: next.encounterId,
          turnId: advance.turnId,
          stateRevision: revision,
          round: advance.round,
          kind: 'turnStarted',
          combatantId: advance.combatantId,
        });
      }
      break;
    }

    default:
      return failure('invalidCommandShape');
  }

  next.stateRevision = revision;
  return { valid: true, state: next, events };
};

// ---------------------------------------------------------------------------
// replayCombat
// ---------------------------------------------------------------------------

export type ReplayCombatInput = {
  initialState: CombatState;
  rulesVersion: string;
  commands: CombatCommand[];
};

/**
 * Reconstructs events and the final state from `initialState` + `rulesVersion`
 * + `commands` alone. Aborts at the first invalid command, returning
 * `finalState: null` plus the events produced up to that point. Never throws.
 */
export const replayCombat = (input: ReplayCombatInput): ReplayCombatResult => {
  const { initialState, rulesVersion, commands } = input;
  const events: CombatEvent[] = [];
  let aborted = rulesVersion !== initialState.rulesVersion;
  let current = initialState;

  if (!aborted) {
    for (const command of commands) {
      const result = resolveCombatCommand({ state: current, command });
      if (!result.valid) {
        aborted = true;
        break;
      }
      for (const event of result.events) {
        events.push(event);
      }
      current = result.state;
    }
  }

  const finalState = aborted ? null : cloneValue(current);
  const replay: CombatReplay = {
    replayVersion: COMBAT_REPLAY_VERSION,
    rulesVersion,
    initialState: cloneValue(initialState),
    commands: commands.map((command) => cloneValue(command)),
    events,
    finalState,
  };

  return { replay, finalState };
};

// ---------------------------------------------------------------------------
// findFirstCombatDivergence
// ---------------------------------------------------------------------------

/**
 * Reports the first divergent event between two replays, or the end of the
 * shorter log when one is a strict prefix of the other. Returns `null` for
 * identical replays. Development/test helper.
 */
export const findFirstCombatDivergence = (
  a: CombatReplay,
  b: CombatReplay,
): CombatDivergence | null => {
  const shared = Math.min(a.events.length, b.events.length);

  for (let index = 0; index < shared; index++) {
    if (canonicalCombatJson(a.events[index]) !== canonicalCombatJson(b.events[index])) {
      return { stateRevision: a.events[index].stateRevision, eventIndex: index };
    }
  }

  if (a.events.length !== b.events.length) {
    const longer = a.events.length > b.events.length ? a : b;
    return { stateRevision: longer.events[shared].stateRevision, eventIndex: shared };
  }

  if (canonicalCombatJson(a.finalState) !== canonicalCombatJson(b.finalState)) {
    return { stateRevision: a.finalState?.stateRevision ?? 0, eventIndex: shared };
  }

  return null;
};
