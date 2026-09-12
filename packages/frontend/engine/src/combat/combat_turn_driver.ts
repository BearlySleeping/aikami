// packages/frontend/engine/src/combat/combat_turn_driver.ts
//
// Per-world combat turn driver — binds the pure turn coordinator
// (`@aikami/utils`) to one ECS world and to the engine bridge.
//
// The coordinator owns *what* the turn order / round / budgets are; this
// module owns *when* they move and *who* acts. All turn state is per-world
// (a `WeakMap<World, DriverState>`), never module-global, so two worlds in one
// process cannot corrupt each other.
//
// Raw entity ids never leave this boundary: turn state is keyed by
// `combatantId`, and the `combatantId ↔ eid` map is rebuilt from the adapter's
// identity registry at `startCombatTurns`.
//
// Contract: C-514 AC-2, AC-3, AC-5, AC-6

import type {
  AutoEndPolicy,
  CombatantTurnStatus,
  CombatBudgetCost,
  CombatInvalidReason,
  CombatOutcome,
  CombatTurnState,
  TurnBudget,
  TurnTrigger,
} from '@aikami/types';
import {
  createTurnState,
  DEFAULT_MOVEMENT_PER_TURN,
  defaultTurnBudget,
  endTurn,
  getActiveTurn as getCoordinatorActiveTurn,
  getForcedEndReason,
  spendBudget as spendTurnBudget,
} from '@aikami/utils';
import type { World } from 'bitecs';
import { getComponent, query } from 'bitecs';
import { logger } from '$logger';
import { CombatStats } from '../components/combat_stats.ts';
import { Companion } from '../components/companion.ts';
import { StatusEffects } from '../components/status_effects.ts';
import type { TurnOrderData } from '../components/turn_order.ts';
import { TurnOrder } from '../components/turn_order.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import {
  deriveCombatantId,
  getCombatIdentityRegistry,
  registerCombatantIdentity,
} from './combat_state_adapter.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Who decides a combatant's turn. */
export type ControllerKind = 'player' | 'companion_ai' | 'enemy_ai';

/**
 * Engine callbacks the driver needs but must not import (turn_manager owns
 * them). Injected at `startCombatTurns` so the dependency stays one-way.
 */
export type CombatTurnHooks = {
  /** Runs one deterministic AI turn (enemy GOAP tactics / companion policy). */
  runAiTurn: (
    world: World,
    bridge: EngineBridge,
    entityId: number,
    kind: 'companion_ai' | 'enemy_ai',
  ) => void;
  /** Emits `COMBAT_STATE_UPDATE` for the world. */
  emitStateUpdate: (world: World, bridge: EngineBridge) => void;
  /**
   * Handles a downed combatant's turn (death saves). Returns `true` when the
   * hook handled it and the driver must leave the turn with that combatant.
   */
  runDownedTurn?: (world: World, bridge: EngineBridge, entityId: number) => boolean;
};

export type StartCombatTurnsOptions = {
  /** Runtime eid of the player entity. Defaults to the project convention (1). */
  playerEntityId?: number;
  /** Stable combatant id for the player entity. Defaults to `'player'`. */
  playerCombatantId?: string;
  /** Encounter namespace for the combatant-id fallback. */
  encounterId?: string;
  /** Turn movement allowance. Defaults to {@link DEFAULT_MOVEMENT_PER_TURN}. */
  movementPerTurn?: number;
  /** Initial auto-end policy for player-controlled combatants. Defaults to `'manual'`. */
  policy?: AutoEndPolicy;
  hooks: CombatTurnHooks;
};

/** Result of spending the active turn's budget — a typed rejection, never a throw. */
export type SpendBudgetResult =
  | { ok: true; budget: TurnBudget }
  | { ok: false; reason: CombatInvalidReason };

/** The active turn resolved to a runtime entity id. */
export type ActiveTurnInfo = {
  entityId: number;
  combatantId: string;
  turnId: string;
  round: number;
};

export type DeathSaveState = { successes: number; failures: number };

// ---------------------------------------------------------------------------
// Per-world state
// ---------------------------------------------------------------------------

type DriverState = {
  turnState: CombatTurnState;
  /** `combatantId → runtime eid` — the only place a raw eid lives. */
  combatants: Map<string, number>;
  controllers: Map<string, ControllerKind>;
  policy: AutoEndPolicy;
  playerEntityId: number;
  playerCombatantId: string;
  encounterId: string;
  movementPerTurn: number;
  hooks: CombatTurnHooks;
  /** Per-world death-save counters (AC-6 — never a module singleton). */
  deathSaves: Map<number, DeathSaveState>;
};

const driverStates = new WeakMap<World, DriverState>();

// ---------------------------------------------------------------------------
// Participant discovery
// ---------------------------------------------------------------------------

const initiativeOf = (world: World, eid: number): number => {
  const turnOrder = getComponent(world, eid, TurnOrder) as TurnOrderData | undefined;
  return turnOrder?.initiativeValue ?? 0;
};

/**
 * Live combat participants in deterministic initiative order: initiative desc,
 * eid asc as the tiebreak (mirrors `initCombat`'s historical ordering).
 */
const collectParticipants = (world: World): number[] => {
  const participants: number[] = [];
  for (const eid of query(world, [CombatStats, TurnOrder])) {
    if (eid <= 0) {
      continue;
    }
    const turnOrder = getComponent(world, eid, TurnOrder) as TurnOrderData | undefined;
    if (turnOrder?.isActive !== true) {
      continue;
    }
    participants.push(eid);
  }
  return participants.sort((a, b) => {
    const diff = initiativeOf(world, b) - initiativeOf(world, a);
    return diff !== 0 ? diff : a - b;
  });
};

const controllerFor = (eid: number, playerEntityId: number): ControllerKind => {
  if (eid === playerEntityId) {
    return 'player';
  }
  if (Companion.recruited[eid] === true) {
    return 'companion_ai';
  }
  return 'enemy_ai';
};

/**
 * Resolves the stable combatant id for a participant: the adapter's identity
 * registry first, then the adapter's authored-id derivation. Never a raw eid.
 */
const resolveCombatantId = (
  world: World,
  eid: number,
  index: number,
  options: { encounterId: string; playerCombatantId: string; playerEntityId: number },
): string => {
  const registry = getCombatIdentityRegistry(world);
  const mapped = registry.toCombatantId(eid);
  if (mapped !== null && mapped !== '') {
    return mapped;
  }
  const derived = deriveCombatantId({
    entityId: eid,
    encounterId: options.encounterId,
    playerCombatantId: options.playerCombatantId,
    playerEntityId: options.playerEntityId,
    spawnIndex: index,
  });
  registerCombatantIdentity({
    entityId: eid,
    encounterId: options.encounterId,
    playerCombatantId: options.playerCombatantId,
    playerEntityId: options.playerEntityId,
    spawnIndex: index,
  });
  return derived;
};

// ---------------------------------------------------------------------------
// Status projection
// ---------------------------------------------------------------------------

/**
 * Team classification for one entity.
 *
 * Shared by the initial roster build (`startCombatTurns`, which runs before a
 * `DriverState` exists) and the live projection (`teamFor`), so the two can
 * never disagree on who is on which side.
 */
const teamOf = (eid: number, playerEntityId: number): CombatantTurnStatus['team'] => {
  if (eid === playerEntityId) {
    return 'player';
  }
  if (Companion.recruited[eid] === true) {
    return 'ally';
  }
  return 'enemy';
};

const teamFor = (state: DriverState, eid: number): CombatantTurnStatus['team'] =>
  teamOf(eid, state.playerEntityId);

const isDefeated = (state: DriverState, eid: number, hp: number): boolean => {
  if (TurnOrder.isActive[eid] !== true) {
    return true;
  }
  if (hp > 0) {
    return false;
  }
  // A downed combatant with pending death saves stays in the turn order.
  return !state.deathSaves.has(eid);
};

const statusFor = (
  state: DriverState,
  world: World,
  eid: number,
  combatantId: string,
): CombatantTurnStatus => {
  const hp = CombatStats.health[eid] ?? 0;
  return {
    combatantId,
    initiative: initiativeOf(world, eid),
    team: teamFor(state, eid),
    hp,
    downed: hp <= 0,
    stunned: (StatusEffects.isStunned[eid] ?? 0) === 1,
    defeated: isDefeated(state, eid, hp),
  };
};

const allStatuses = (state: DriverState, world: World): CombatantTurnStatus[] => {
  const statuses: CombatantTurnStatus[] = [];
  for (const combatantId of state.turnState.order) {
    const eid = state.combatants.get(combatantId);
    if (eid === undefined) {
      continue;
    }
    statuses.push(statusFor(state, world, eid, combatantId));
  }
  return statuses;
};

// ---------------------------------------------------------------------------
// Emit helpers
// ---------------------------------------------------------------------------

const clearCurrentTurnFlags = (state: DriverState): void => {
  for (const eid of state.combatants.values()) {
    TurnOrder.currentTurn[eid] = false;
  }
};

const setCurrentTurnEntity = (state: DriverState, eid: number): void => {
  clearCurrentTurnFlags(state);
  TurnOrder.currentTurn[eid] = true;
};

const activeEntityIds = (world: World, state: DriverState): number[] => {
  const ids: number[] = [];
  for (const [combatantId, eid] of state.combatants) {
    if (!statusFor(state, world, eid, combatantId).defeated) {
      ids.push(eid);
    }
  }
  return ids;
};

/** One `ACTION_ECONOMY_CHANGED` per budget change — the widened engine event. */
export const emitActionEconomy = (
  bridge: EngineBridge,
  entityId: number,
  budget: TurnBudget,
): void => {
  bridge.emit({
    type: 'ACTION_ECONOMY_CHANGED',
    entityId,
    movementRemaining: budget.movementRemaining,
    actionAvailable: budget.actionAvailable,
    quickActionAvailable: budget.quickActionAvailable,
    // Deprecated alias kept for one release (Q3 resolution).
    bonusActionAvailable: budget.quickActionAvailable,
    reactionAvailable: budget.reactionAvailable,
  });
};

const emitActiveBudget = (bridge: EngineBridge, state: DriverState): void => {
  const active = getCoordinatorActiveTurn(state.turnState);
  if (active === null) {
    return;
  }
  const eid = state.combatants.get(active.combatantId);
  const budget = state.turnState.budgets[active.combatantId];
  if (eid === undefined || budget === undefined) {
    return;
  }
  emitActionEconomy(bridge, eid, budget);
};

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

const exhaustBudget = (state: DriverState, combatantId: string): void => {
  const budget = state.turnState.budgets[combatantId];
  if (budget === undefined) {
    return;
  }
  state.turnState = {
    ...state.turnState,
    budgets: {
      ...state.turnState.budgets,
      [combatantId]: {
        ...budget,
        movementRemaining: 0,
        actionAvailable: false,
        quickActionAvailable: false,
      },
    },
  };
};

/**
 * Auto-end policy for one combatant: player-controlled turns honour the
 * world's policy (default `manual`), AI turns always auto-end when exhausted.
 */
const policyFor = (state: DriverState, combatantId: string): AutoEndPolicy => {
  const kind = state.controllers.get(combatantId);
  if (kind === undefined || kind === 'player') {
    return state.policy;
  }
  return 'auto_when_exhausted';
};

/**
 * Ends the active turn and advances. Returns `false` when the encounter ended
 * (the driver state has been cleared by then).
 */
const advanceTurns = (
  world: World,
  bridge: EngineBridge,
  state: DriverState,
  trigger: TurnTrigger,
): boolean => {
  const statuses = allStatuses(state, world);
  const activeId = getCoordinatorActiveTurn(state.turnState)?.combatantId;
  const transition = endTurn({
    state: state.turnState,
    status: statuses,
    trigger,
    policy: activeId === undefined ? state.policy : policyFor(state, activeId),
    movementPerTurn: state.movementPerTurn,
  });
  state.turnState = transition.state;

  if (transition.outcome === undefined && transition.state.turnId !== null) {
    return true;
  }

  const outcome: CombatOutcome = transition.outcome ??
    getForcedEndReason(statuses) ?? { victory: false, reason: 'no_combatants' };
  finishEncounter(world, bridge, state, outcome);
  return false;
};

const finishEncounter = (
  world: World,
  bridge: EngineBridge,
  state: DriverState,
  outcome: CombatOutcome,
): void => {
  clearCurrentTurnFlags(state);
  driverStates.delete(world);
  bridge.emit({ type: 'COMBAT_ENDED', victory: outcome.victory });
};

// ---------------------------------------------------------------------------
// Turn resolution
// ---------------------------------------------------------------------------

/**
 * Resolves the active turn: emits exactly one `TURN_CHANGED` per active turn,
 * runs AI/companion turns on their own turn (never inside the player's action),
 * auto-skips stunned/defeated combatants, and returns once a player-controlled
 * turn is active or the encounter ended.
 */
const resolveActiveTurns = (world: World, bridge: EngineBridge, state: DriverState): void => {
  const guard = state.turnState.order.length * 2 + 2;

  for (let iteration = 0; iteration < guard; iteration++) {
    if (!driverStates.has(world)) {
      return;
    }
    const active = getCoordinatorActiveTurn(state.turnState);
    if (active === null) {
      finishEncounter(world, bridge, state, { victory: false, reason: 'no_combatants' });
      return;
    }
    const eid = state.combatants.get(active.combatantId);
    if (eid === undefined) {
      logger.warn('[combat_turn_driver] unknown combatant on the active turn', {
        combatantId: active.combatantId,
      });
      resetCombatTurns(world);
      return;
    }

    const status = statusFor(state, world, eid, active.combatantId);
    setCurrentTurnEntity(state, eid);
    bridge.emit({
      type: 'TURN_CHANGED',
      currentEntityId: eid,
      activeEntities: activeEntityIds(world, state),
    });
    emitActiveBudget(bridge, state);
    state.hooks.emitStateUpdate(world, bridge);

    if (status.hp <= 0 && state.hooks.runDownedTurn?.(world, bridge, eid) === true) {
      // The downed combatant keeps the turn (C-338 death-save behaviour).
      return;
    }

    if (status.defeated || status.stunned) {
      if (!advanceTurns(world, bridge, state, 'explicit_end_turn')) {
        return;
      }
      continue;
    }

    const kind = state.controllers.get(active.combatantId) ?? 'enemy_ai';
    if (kind === 'player') {
      // Wait for the player's explicit end turn.
      return;
    }

    state.hooks.runAiTurn(world, bridge, eid, kind);
    if (!driverStates.has(world)) {
      return;
    }
    exhaustBudget(state, active.combatantId);
    emitActiveBudget(bridge, state);
    if (!advanceTurns(world, bridge, state, 'auto_exhausted')) {
      return;
    }
  }

  logger.warn('[combat_turn_driver] turn resolution hit its iteration guard', {
    order: state.turnState.order.length,
  });
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Whether combat turns are running for this world. */
export const hasCombatTurns = (world: World): boolean => driverStates.has(world);

/**
 * Initialises per-world turn state from the live ECS participants, emits
 * `COMBAT_STARTED`, and resolves the first active turn. Idempotent: a world
 * already running turns is left alone.
 */
export const startCombatTurns = (
  world: World,
  bridge: EngineBridge,
  options: StartCombatTurnsOptions,
): void => {
  if (!world || !bridge) {
    return;
  }
  if (driverStates.has(world)) {
    return;
  }

  const playerEntityId = options.playerEntityId ?? 1;
  const playerCombatantId = options.playerCombatantId ?? 'player';
  const encounterId = options.encounterId ?? 'encounter';
  const movementPerTurn = options.movementPerTurn ?? DEFAULT_MOVEMENT_PER_TURN;

  const participants = collectParticipants(world);
  if (participants.length === 0) {
    return;
  }

  const combatants = new Map<string, number>();
  const controllers = new Map<string, ControllerKind>();
  const statuses: CombatantTurnStatus[] = [];

  participants.forEach((eid, index) => {
    const combatantId = resolveCombatantId(world, eid, index, {
      encounterId,
      playerCombatantId,
      playerEntityId,
    });
    combatants.set(combatantId, eid);
    controllers.set(combatantId, controllerFor(eid, playerEntityId));
    statuses.push({
      combatantId,
      initiative: initiativeOf(world, eid),
      team: teamOf(eid, playerEntityId),
      hp: CombatStats.health[eid] ?? 0,
      downed: (CombatStats.health[eid] ?? 0) <= 0,
      stunned: (StatusEffects.isStunned[eid] ?? 0) === 1,
      defeated: TurnOrder.isActive[eid] !== true,
    });
  });

  const state: DriverState = {
    turnState: createTurnState(statuses, movementPerTurn),
    combatants,
    controllers,
    policy: options.policy ?? 'manual',
    playerEntityId,
    playerCombatantId,
    encounterId,
    movementPerTurn,
    hooks: options.hooks,
    deathSaves: new Map(),
  };
  driverStates.set(world, state);

  const firstId = state.turnState.order[0];
  const firstEid = firstId === undefined ? 0 : (combatants.get(firstId) ?? 0);
  bridge.emit({
    type: 'COMBAT_STARTED',
    participantIds: participants,
    firstTurnEntityId: firstEid,
  });

  resolveActiveTurns(world, bridge, state);
};

/**
 * Ends the active turn, advances, and resolves subsequent AI turns until a
 * player-controlled turn is active or the encounter ends.
 */
export const endActiveTurn = (
  world: World,
  bridge: EngineBridge,
  trigger: TurnTrigger = 'explicit_end_turn',
): void => {
  if (!world || !bridge) {
    return;
  }
  const state = driverStates.get(world);
  if (state === undefined || state.turnState.turnId === null) {
    return;
  }
  if (!advanceTurns(world, bridge, state, trigger)) {
    return;
  }
  resolveActiveTurns(world, bridge, state);
};

/**
 * Spends part of the active combatant's budget. Returns the typed rejection
 * reason so callers can surface it (AC-3).
 *
 * @param bridge when supplied, an `ACTION_ECONOMY_CHANGED` is emitted.
 */
export const spendActiveBudget = (
  world: World,
  cost: CombatBudgetCost,
  amount?: number,
  bridge?: EngineBridge,
): SpendBudgetResult => {
  const state = driverStates.get(world);
  if (state === undefined) {
    return { ok: false, reason: 'encounterEnded' };
  }
  const active = getCoordinatorActiveTurn(state.turnState);
  if (active === null) {
    return { ok: false, reason: 'encounterEnded' };
  }

  const result = spendTurnBudget(state.turnState, active.combatantId, cost, amount);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  state.turnState = result.state;

  const budget =
    result.state.budgets[active.combatantId] ?? defaultTurnBudget(state.movementPerTurn);
  const eid = state.combatants.get(active.combatantId);
  if (bridge !== undefined && eid !== undefined) {
    emitActionEconomy(bridge, eid, budget);
  }
  return { ok: true, budget };
};

/** The active turn, or `null` when no turn is running. */
export const getActiveTurn = (world: World): ActiveTurnInfo | null => {
  const state = driverStates.get(world);
  if (state === undefined) {
    return null;
  }
  const active = getCoordinatorActiveTurn(state.turnState);
  if (active === null) {
    return null;
  }
  const entityId = state.combatants.get(active.combatantId);
  if (entityId === undefined) {
    return null;
  }
  return { entityId, combatantId: active.combatantId, turnId: active.turnId, round: active.round };
};

/** The active combatant's budget, or `null` when no turn is running. */
export const getActiveBudget = (world: World): TurnBudget | null => {
  const state = driverStates.get(world);
  if (state === undefined) {
    return null;
  }
  const active = getCoordinatorActiveTurn(state.turnState);
  if (active === null) {
    return null;
  }
  return state.turnState.budgets[active.combatantId] ?? null;
};

/**
 * Whether `entityId` owns the active turn. The engine validates this before
 * advancing so a client cannot end a turn that is not active.
 */
export const isActiveTurnOwner = (world: World, entityId: number): boolean =>
  getActiveTurn(world)?.entityId === entityId;

/** Sets the auto-end policy for this world's player-controlled turns. */
export const setAutoEndPolicy = (world: World, policy: AutoEndPolicy): void => {
  const state = driverStates.get(world);
  if (state !== undefined) {
    state.policy = policy;
  }
};

/** The player entity id recorded for this world (project convention: 1). */
export const getPlayerEntityId = (world: World): number =>
  driverStates.get(world)?.playerEntityId ?? 1;

/** The encounter id recorded for this world, when turns are running. */
export const getEncounterId = (world: World): string | null =>
  driverStates.get(world)?.encounterId ?? null;

/** Clears this world's turn state and current-turn flags. Other worlds are untouched. */
export const resetCombatTurns = (world: World): void => {
  const state = driverStates.get(world);
  if (state === undefined) {
    return;
  }
  clearCurrentTurnFlags(state);
  driverStates.delete(world);
};

// ---------------------------------------------------------------------------
// Death-save bookkeeping (per world — AC-6)
// ---------------------------------------------------------------------------

/** Records that a combatant entered the downed state with pending death saves. */
export const beginDeathSaves = (world: World, entityId: number): void => {
  driverStates.get(world)?.deathSaves.set(entityId, { successes: 0, failures: 0 });
};

export const getDeathSaves = (world: World, entityId: number): DeathSaveState | null =>
  driverStates.get(world)?.deathSaves.get(entityId) ?? null;

export const hasDeathSaves = (world: World, entityId: number): boolean =>
  driverStates.get(world)?.deathSaves.has(entityId) ?? false;

export const setDeathSaves = (
  world: World,
  entityId: number,
  successes: number,
  failures: number,
): void => {
  driverStates.get(world)?.deathSaves.set(entityId, { successes, failures });
};

export const clearDeathSaves = (world: World, entityId: number): void => {
  driverStates.get(world)?.deathSaves.delete(entityId);
};
