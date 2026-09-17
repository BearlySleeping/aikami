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
// identity registry at `startCombatTurns`. Roster discovery itself lives in
// `combat_roster.ts` so this module stays inside the source-file-size budget.
//
// Contract: C-514 AC-2, AC-3, AC-5, AC-6; C-515 AC-6, AC-7

import type {
  AutoEndPolicy,
  CombatAbilityDefinition,
  CombatantTurnStatus,
  CombatBudgetCost,
  CombatEngineKind,
  CombatInvalidReason,
  CombatOutcome,
  CombatState,
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
import { hasComponent } from 'bitecs';
import { logger } from '$logger';
import { CombatMovement } from '../components/combat_movement.ts';
import { CombatStats } from '../components/combat_stats.ts';
import { StatusEffects } from '../components/status_effects.ts';
import { TurnOrder } from '../components/turn_order.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import type { ControllerKind } from './combat_roster.ts';
import { peekEncounterRunId } from './combat_run_identity.ts';
import {
  collectParticipants,
  controllerFor,
  initiativeOf,
  resolveCombatantId,
  teamOf,
} from './combat_roster.ts';
import { allStatuses, statusFor } from './combat_turn_status.ts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Who decides a combatant's turn (canonical definition lives in the roster module). */
export type { ControllerKind };

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
  /**
   * Ability catalog injected at encounter start (C-515 AC-7).
   *
   * The worker holds no production catalog yet, so this defaults to `{}` — a
   * preview for an unknown ability is a typed `abilityUnknown` rejection, never
   * a crash.
   */
  abilityCatalog?: Record<string, CombatAbilityDefinition>;
  /**
   * Which resolver owns this encounter (C-516 AC-1). Pinned at encounter
   * start and echoed on `COMBAT_STARTED`; never re-read from the flag.
   */
  engine?: CombatEngineKind;
  /**
   * Per-combatant ability grants (C-516 AC-2). When supplied, the projection
   * uses these instead of granting every catalog ability to every combatant.
   */
  abilityIdsByCombatant?: Record<string, string[]>;
  /** Encounter seed for the preview snapshot. Defaults to `0`; never advanced. */
  seed?: number;
  /**
   * When `true`, the driver emits the active turn but leaves AI turns to the
   * caller (C-516 v2: the kernel drives turn order, so the legacy AI hook must
   * not run inside the driver). Legacy leaves this `false`.
   */
  deferAiTurns?: boolean;
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

/**
 * Per-world driver state.
 *
 * Exported for the type-only consumers that project it (the status module);
 * the runtime value stays module-private via `driverStates`.
 */
export type DriverState = {
  turnState: CombatTurnState;
  /** Monotonic revision for every preview-relevant turn or budget mutation. */
  stateRevision: number;
  /** `combatantId → runtime eid` — the only place a raw eid lives. */
  combatants: Map<string, number>;
  controllers: Map<string, ControllerKind>;
  policy: AutoEndPolicy;
  playerEntityId: number;
  playerCombatantId: string;
  encounterId: string;
  movementPerTurn: number;
  /** Per-combatant movement allowance, keyed by `combatantId` (C-515 AC-6). */
  movementAllowance: Map<string, number>;
  /** Injected ability catalog for the preview path (C-515 AC-7). */
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  /** Resolver pinned at encounter start (C-516 AC-1). */
  engine: CombatEngineKind;
  /** Per-combatant ability grants, keyed by `combatantId` (C-516 AC-2). */
  abilityIdsByCombatant: Record<string, string[]>;
  /** Encounter seed carried into the preview snapshot; never advanced. */
  seed: number;
  /** Delegates AI turns to the caller when true (C-516 v2). */
  deferAiTurns: boolean;
  hooks: CombatTurnHooks;
  /** Per-world death-save counters (AC-6 — never a module singleton). */
  deathSaves: Map<number, DeathSaveState>;
};

const driverStates = new WeakMap<World, DriverState>();

// The status projection (driver state → `CombatantTurnStatus[]`) lives in its
// own module; re-exported because the driver's emit path and its tests resolve
// it from here.
export { allStatuses, statusFor } from './combat_turn_status.ts';

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
  const budgetChanged =
    budget.movementRemaining !== 0 || budget.actionAvailable || budget.quickActionAvailable;
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
  if (budgetChanged) {
    state.stateRevision += 1;
  }
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
  const previousTurnState = state.turnState;
  const transition = endTurn({
    state: state.turnState,
    status: statuses,
    trigger,
    policy: activeId === undefined ? state.policy : policyFor(state, activeId),
    movementPerTurn: state.movementPerTurn,
    movementPerTurnFor: (combatantId) => state.movementAllowance.get(combatantId),
  });
  state.turnState = transition.state;
  if (
    transition.state.turnId !== previousTurnState.turnId ||
    transition.state.activeIndex !== previousTurnState.activeIndex ||
    transition.state.round !== previousTurnState.round
  ) {
    state.stateRevision += 1;
  }

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
    // Review F-B: the client binds its command-admission envelope to the
    // execution run AND the turn identity. Both are published with every turn
    // change so a command confirmed here cannot be admitted in a later run (or
    // a later turn at the same revision).
    const runId = peekEncounterRunId(world, state.encounterId);
    bridge.emit({
      type: 'TURN_CHANGED',
      currentEntityId: eid,
      activeEntities: activeEntityIds(world, state),
      stateRevision: state.stateRevision,
      activeCombatantId: active.combatantId,
      turnId: active.turnId,
      ...(runId === null ? {} : { encounterRunId: runId }),
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

    // C-516 v2: the kernel owns turn order and AI resolution, so the driver
    // stops here and lets the resolver drive the rest of the round.
    if (state.deferAiTurns) {
      return;
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
    const outcomeAfterAiTurn = getForcedEndReason(allStatuses(state, world));
    if (outcomeAfterAiTurn?.victory === true) {
      finishEncounter(world, bridge, state, outcomeAfterAiTurn);
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
  const movementAllowance = new Map<string, number>();
  const statuses: CombatantTurnStatus[] = [];

  participants.forEach((eid, index) => {
    const combatantId = resolveCombatantId(world, eid, index, {
      encounterId,
      playerCombatantId,
      playerEntityId,
    });
    combatants.set(combatantId, eid);
    controllers.set(combatantId, controllerFor(eid, playerEntityId));
    // C-515 AC-6: the per-combatant `CombatMovement` allowance wins; a
    // combatant without the component keeps the call-level default. The
    // component-existence check matters because the SoA arrays are
    // module-level and an eid recycled from another world can still hold a
    // stale value.
    movementAllowance.set(
      combatantId,
      hasComponent(world, eid, CombatMovement)
        ? (CombatMovement.movementPerTurn[eid] ?? movementPerTurn)
        : movementPerTurn,
    );
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
    turnState: createTurnState(statuses, movementPerTurn, (combatantId) =>
      movementAllowance.get(combatantId),
    ),
    stateRevision: 0,
    combatants,
    controllers,
    policy: options.policy ?? 'manual',
    playerEntityId,
    playerCombatantId,
    encounterId,
    movementPerTurn,
    movementAllowance,
    abilityCatalog: options.abilityCatalog ?? {},
    engine: options.engine ?? 'legacy',
    abilityIdsByCombatant: options.abilityIdsByCombatant ?? {},
    seed: options.seed ?? 0,
    deferAiTurns: options.deferAiTurns ?? false,
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
    engine: state.engine,
    playerEntityId,
    // The UI binds its preview requests to this id (C-515 AC-5); omitting it
    // made every preview answer `encounterEnded`.
    encounterId: state.encounterId,
    // Review F9: the execution-run identity for THIS attempt, so a client
    // presentation callback can prove which run it belongs to.
    ...(peekEncounterRunId(world, state.encounterId) === null
      ? {}
      : { encounterRunId: peekEncounterRunId(world, state.encounterId) as string }),
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

  const previousBudget = state.turnState.budgets[active.combatantId];
  const result = spendTurnBudget(state.turnState, active.combatantId, cost, amount);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }
  state.turnState = result.state;

  const budget =
    result.state.budgets[active.combatantId] ??
    defaultTurnBudget(state.movementAllowance.get(active.combatantId) ?? state.movementPerTurn);
  if (
    previousBudget !== undefined &&
    (budget.movementRemaining !== previousBudget.movementRemaining ||
      budget.actionAvailable !== previousBudget.actionAvailable ||
      budget.quickActionAvailable !== previousBudget.quickActionAvailable ||
      budget.reactionAvailable !== previousBudget.reactionAvailable)
  ) {
    state.stateRevision += 1;
  }
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

/**
 * The active combatant's budget, or `null` when no turn is running.
 */
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

/** Everything the tactical preview handler needs from the live turn driver. */
export type CombatPreviewDriverSnapshot = {
  encounterId: string;
  /** Monotonic preview revision for turn and budget changes. */
  stateRevision: number;
  playerCombatantId: string;
  seed: number;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  /** Resolver pinned at encounter start (C-516 AC-1). */
  engine: CombatEngineKind;
  /** Per-combatant ability grants (C-516 AC-2). */
  abilityIdsByCombatant: Record<string, string[]>;
  /** The active combatant's id, or `null` when no turn is running. */
  activeCombatantId: string | null;
  /** The driver's turn order — the preview state must mirror it exactly. */
  order: string[];
  activeIndex: number;
  /** Copy of every live budget, keyed by `combatantId`. */
  budgets: Record<string, TurnBudget>;
};

/**
 * A read-only copy of the driver state the preview path needs, or `null` when
 * no encounter is running for this world.
 *
 * The driver is the turn authority: the preview state takes its order,
 * active index and budgets from here so a preview answers for the combatant
 * whose turn it actually is (C-515 AC-6, AC-7).
 */
export const getCombatPreviewSnapshot = (world: World): CombatPreviewDriverSnapshot | null => {
  const state = driverStates.get(world);
  if (state === undefined) {
    return null;
  }
  const active = getCoordinatorActiveTurn(state.turnState);
  const budgets: Record<string, TurnBudget> = {};
  for (const [combatantId, budget] of Object.entries(state.turnState.budgets)) {
    budgets[combatantId] = { ...budget };
  }
  return {
    encounterId: state.encounterId,
    stateRevision: state.stateRevision,
    playerCombatantId: state.playerCombatantId,
    seed: state.seed,
    abilityCatalog: state.abilityCatalog,
    engine: state.engine,
    abilityIdsByCombatant: state.abilityIdsByCombatant,
    activeCombatantId: active?.combatantId ?? null,
    order: [...state.turnState.order],
    activeIndex: state.turnState.activeIndex,
    budgets,
  };
};

/**
 * Re-points the driver at the kernel's freshly resolved state (C-516 AC-4).
 *
 * The kernel owns HP/budgets/revision; the driver owns *whose turn it is* for
 * the preview path. After a v2 commit the two must agree or the next preview
 * would answer with a stale budget or the wrong active combatant. When the
 * kernel reports the encounter ended the driver state is cleared instead —
 * the resolver owns the `COMBAT_ENDED` emission, so this never double-emits.
 */
export const syncDriverFromResolvedCombatState = (world: World, state: CombatState): void => {
  const driver = driverStates.get(world);
  if (driver === undefined) {
    return;
  }

  if (state.phase === 'ended') {
    resetCombatTurns(world);
    return;
  }

  const budgets: Record<string, TurnBudget> = {};
  for (const combatant of Object.values(state.combatants)) {
    budgets[combatant.combatantId] = { ...combatant.budget };
  }

  driver.stateRevision = state.stateRevision;
  driver.turnState = {
    order: [...state.initiative.order],
    activeIndex: state.initiative.activeIndex,
    round: state.round,
    turnId: state.turnId,
    budgets,
  };
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
