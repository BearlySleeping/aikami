// packages/frontend/engine/src/combat/combat_v2_resolver.ts
//
// The v2 command resolver (Combat-04).
//
// Responsibilities, in order:
//   1. Project the live ECS world into a versioned `CombatState` whose revision
//      is the *driver's* revision — the same revision previews are answered
//      against, so a preview and its commit cannot disagree.
//   2. Map the bridge command onto a kernel `CombatCommand` for the ACTIVE
//      combatant. The client never supplies mechanical numbers: an ATTACK is
//      the basic attack plus a target id, and the roll/damage come from the
//      kernel's own RNG substream. A move is addressed by destination CELL, and
//      the engine reconstructs the path from the same reachability projection
//      the preview used — so "the committed path equals the previewed path" is
//      true by construction, not by client honesty.
//   3. Resolve through the pure kernel and commit through `applyCombatResult`.
//   4. Map the kernel's `CombatEvent`s onto the bridge events the existing
//      sidebar already renders.
//
// FLEE is deliberately NOT here: it is the party-level retreat exit and is
// handled by the dispatcher before the engine branch (see
// `combat_command_dispatch.ts`).
//
// Contract: C-516 AC-4, AC-5, AC-8

import type {
  CombatAbilityDefinition,
  CombatCommand,
  CombatEvent,
  CombatInvalidReason,
  CombatState,
  GridPoint,
} from '@aikami/types';
import {
  COMBAT_MESSAGE_KEYS,
  COMBAT_RULES_VERSION,
  findCombatPathToCell,
  getLegalActions,
  resolveCombatCommand,
} from '@aikami/utils';
import type { World } from 'bitecs';
import { GridPosition } from '../components/grid_position.ts';
import type { EngineBridge } from '../engine_bridge.ts';
import { snapshotBattlefield } from './combat_battlefield.ts';
import { captureEncounterForRetry } from './combat_encounter_retry.ts';
import { clearEncounterEngine } from './combat_encounter_start.ts';
import {
  applyCombatResult,
  getCombatIdentityRegistry,
  snapshotCombatState,
} from './combat_state_adapter.ts';
import {
  getActiveTurn,
  getCombatPreviewSnapshot,
  syncDriverFromResolvedCombatState,
} from './combat_turn_driver.ts';
import {
  getLiveV2CombatState,
  resetLiveV2CombatState,
  setLiveV2CombatState,
} from './combat_v2_state.ts';

// ---------------------------------------------------------------------------
// Bridge command vocabulary this resolver owns
// ---------------------------------------------------------------------------

/** The commands the v2 resolver resolves. */
export type V2ResolvableCommand =
  | {
      type: 'COMBAT_ACTION';
      action: 'ATTACK' | 'ABILITY' | 'DEFEND' | 'WAIT';
      /**
       * Target combatant: an authored combatant id, or a runtime eid for older
       * callers. Both are resolved against the identity registry.
       */
      targetId?: number | string;
      /** Catalog ability id for an `ABILITY` action. */
      abilityId?: string;
    }
  | { type: 'COMBAT_MOVE'; cellX: number; cellY: number }
  | { type: 'COMBAT_END_TURN' }
  /**
   * Combat-07: use one authored affordance on one authored object.
   *
   * The bridge names stable authored ids only — the kernel owns eligibility,
   * cost, the check and every consequence.
   */
  | {
      type: 'COMBAT_INTERACT';
      objectId: string;
      affordanceId: string;
      /** Optional second object the approach names (e.g. an oil pool). */
      targetObjectId?: string | null;
    };

export type ResolveV2CombatCommandOptions = {
  world: World;
  bridge: EngineBridge;
  command: V2ResolvableCommand;
  /** Injected catalog — the same one the encounter started with. */
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  /** The ability an ATTACK maps to. Defaults to `basic_melee`. */
  basicAttackAbilityId?: string;
  /** Per-combatant ability grants, mirroring the encounter snapshot. */
  abilityIdsByCombatant?: Record<string, string[]>;
};

/** What a v2 resolve produced — never throws. */
export type ResolveV2CombatCommandResult =
  | { ok: true; state: CombatState; events: CombatEvent[] }
  | { ok: false; reasonCode: CombatInvalidReason; messageKey: string };

export const DEFAULT_BASIC_ATTACK_ABILITY_ID = 'basic_melee';

const rejection = (reasonCode: CombatInvalidReason): ResolveV2CombatCommandResult => ({
  ok: false,
  reasonCode,
  messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
});

// ---------------------------------------------------------------------------
// Live kernel state (one per world / encounter)
// ---------------------------------------------------------------------------

// The evolving kernel state of a running v2 encounter lives in
// `combat_v2_state.ts` so the retry path can reset it without importing this
// module. Re-deriving the RNG streams from the ECS on every command would reset
// them to their seed-derived first value, so every attack would roll the SAME
// d20 — an encounter where that roll missed could never land a hit.
export { getLiveV2CombatState, resetLiveV2CombatState };

// ---------------------------------------------------------------------------
// State projection
// ---------------------------------------------------------------------------

/**
 * Builds the `CombatState` a commit is resolved against.
 *
 * The driver is the turn authority (active combatant, round, live budgets) and
 * the ECS world is the HP/position authority; the projection combines both
 * exactly like the C-515 preview path, so preview and commit read the same
 * revision.
 */
export const buildV2CombatState = (options: {
  world: World;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  abilityIdsByCombatant?: Record<string, string[]>;
}): CombatState | null => {
  const { world, abilityCatalog: _catalog, abilityIdsByCombatant } = options;
  const driver = getCombatPreviewSnapshot(world);
  if (driver === null) {
    return null;
  }

  // The live state already carries the RNG streams, phase and revision, so it
  // — not a fresh projection — is the base for the next command.
  const live = getLiveV2CombatState(world);
  if (live !== null && live.encounterId === driver.encounterId) {
    const registry = getCombatIdentityRegistry(world);
    registry.sync(world);
    for (const { combatantId, entityId } of registry.entries()) {
      const combatant = live.combatants[combatantId];
      if (combatant !== undefined) {
        combatant.position = {
          x: GridPosition.x[entityId] ?? combatant.position.x,
          y: GridPosition.y[entityId] ?? combatant.position.y,
        };
      }
    }
    return live;
  }

  const state = snapshotCombatState(world, {
    encounterId: driver.encounterId,
    rulesVersion: COMBAT_RULES_VERSION,
    seed: driver.seed,
    abilityCatalog: _catalog,
    battlefield: snapshotBattlefield(world),
    playerCombatantId: driver.playerCombatantId,
    ...(abilityIdsByCombatant === undefined ? {} : { abilityIdsByCombatant }),
  });

  state.initiative.order = [...driver.order];
  state.initiative.activeIndex = driver.activeIndex;
  state.stateRevision = driver.stateRevision;
  for (const [combatantId, budget] of Object.entries(driver.budgets)) {
    const combatant = state.combatants[combatantId];
    if (combatant !== undefined) {
      combatant.budget = { ...budget };
    }
  }

  setLiveV2CombatState(world, state);
  // AC-10 / R-3: this is the opening state; record it so RETRY can rebuild the
  // encounter roster on the same entities from the preserved seed.
  captureEncounterForRetry({ world, state });
  return state;
};

// ---------------------------------------------------------------------------
// Command mapping
// ---------------------------------------------------------------------------

/** The kernel command a bridge command maps onto, or a typed reason why not. */
export const toKernelCombatCommand = (options: {
  state: CombatState;
  combatantId: string;
  command: V2ResolvableCommand;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  basicAttackAbilityId: string;
  /**
   * Runtime eid → authored combatant id, from the adapter's identity registry.
   * The bridge's numeric `targetId` is an eid, and only the registry knows
   * which combatant that eid is today.
   */
  toCombatantId?: (entityId: number) => string | undefined;
}): CombatCommand | CombatInvalidReason => {
  const { state, combatantId, command, abilityCatalog, basicAttackAbilityId } = options;

  if (command.type === 'COMBAT_END_TURN') {
    return { kind: 'endTurn', combatantId };
  }

  if (command.type === 'COMBAT_INTERACT') {
    // The client supplies ids, never mechanics; eligibility, the check, the
    // dice and the effects all come from the kernel's environmental registry.
    // Contract: C-531 AC-2, AC-4.
    return {
      kind: 'interactWithObject',
      combatantId,
      objectId: command.objectId,
      affordanceId: command.affordanceId,
      targetObjectId: command.targetObjectId ?? null,
    };
  }

  if (command.type === 'COMBAT_MOVE') {
    const path = findCombatPathToCell({
      state,
      combatantId,
      to: { x: command.cellX, y: command.cellY },
    });
    if (path === null) {
      return 'pathInvalid';
    }
    return { kind: 'move', combatantId, path };
  }

  if (command.action === 'DEFEND' || command.action === 'WAIT') {
    return { kind: 'defend', combatantId };
  }

  const abilityId =
    command.action === 'ATTACK' ? basicAttackAbilityId : (command.abilityId ?? undefined);
  if (abilityId === undefined) {
    return 'invalidCommandShape';
  }
  if (abilityCatalog[abilityId] === undefined) {
    return 'abilityUnknown';
  }
  const targetIds = resolveTargetIds({
    state,
    targetId: command.targetId,
    ...(options.toCombatantId === undefined ? {} : { toCombatantId: options.toCombatantId }),
  });
  return { kind: 'useAbility', combatantId, abilityId, targetIds };
};

/**
 * Resolves a bridge target selection to a combatant id.
 *
 * The client addresses targets by combatant id (`String(targetId)` — an
 * authored id, never a raw eid); a numeric target that is not an authored id
 * falls back to the raw-eid convention older code used.
 */
export const resolveTargetIds = (options: {
  state: CombatState;
  targetId?: number | string;
  toCombatantId?: (entityId: number) => string | undefined;
}): string[] => {
  const { state, targetId } = options;
  if (targetId === undefined) {
    return [];
  }
  // The client may address a target by authored combatant id (v2 rosters are
  // keyed by authored id, which is not always numeric) or by runtime eid; the
  // registry decides the latter.
  const asAuthoredId = String(targetId);
  if (state.combatants[asAuthoredId] !== undefined) {
    return [asAuthoredId];
  }
  if (typeof targetId === 'number') {
    const mapped = options.toCombatantId?.(targetId);
    if (mapped !== undefined && state.combatants[mapped] !== undefined) {
      return [mapped];
    }
  }
  return [asAuthoredId];
};

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

/**
 * Maps one kernel event onto the bridge events the sidebar already consumes.
 *
 * Log text is derived from the RESOLVED event — never from the command — so a
 * miss reads as a miss. `eidFor` translates the kernel's authored combatant id
 * back to the runtime entity id the UI keys HP bars and floating text on.
 */
export const mapCombatEventToBridge = (options: {
  event: CombatEvent;
  bridge: EngineBridge;
  state: CombatState;
  eidFor: (combatantId: string) => number;
  activeEntities: number[];
}): void => {
  const { event, bridge, state, eidFor, activeEntities } = options;

  const hpOf = (combatantId: string): { hp: number; maxHp: number } => {
    const combatant = state.combatants[combatantId];
    return { hp: combatant?.hp ?? 0, maxHp: combatant?.maxHp ?? 0 };
  };

  switch (event.kind) {
    case 'attackRolled': {
      if (event.hit) {
        return; // `damageApplied` carries the hit — no duplicate log line.
      }
      const target = hpOf(event.targetId);
      bridge.emit({
        type: 'COMBAT_LOG',
        message: `${event.attackerId} misses ${event.targetId} (roll ${event.totalRoll})`,
        sourceId: eidFor(event.attackerId),
        targetId: eidFor(event.targetId),
        targetRemainingHp: target.hp,
        targetMaxHp: target.maxHp,
      });
      return;
    }
    case 'damageApplied': {
      const target = hpOf(event.targetId);
      const targetEid = eidFor(event.targetId);
      bridge.emit({
        type: 'DAMAGE_DEALT',
        entityId: targetEid,
        amount: event.amount,
        isCritical: false,
        screenX: 0,
        screenY: 0,
        damageType: event.damageType,
      });
      bridge.emit({
        type: 'COMBAT_LOG',
        message: `${event.attackerId} hits ${event.targetId} for ${event.amount}`,
        sourceId: eidFor(event.attackerId),
        targetId: targetEid,
        targetRemainingHp: target.hp,
        targetMaxHp: target.maxHp,
        damageType: event.damageType,
      });
      bridge.emit({
        type: 'COMBAT_STATE_UPDATE',
        entityHpMap: { [targetEid]: target.hp },
        entityMaxHpMap: { [targetEid]: target.maxHp },
      });
      return;
    }
    case 'combatantDowned':
    case 'combatantDefeated': {
      const target = hpOf(event.combatantId);
      bridge.emit({
        type: 'COMBAT_LOG',
        message:
          event.kind === 'combatantDowned'
            ? `${event.combatantId} is down`
            : `${event.combatantId} is defeated`,
        sourceId: eidFor(event.combatantId),
        targetId: eidFor(event.combatantId),
        targetRemainingHp: target.hp,
        targetMaxHp: target.maxHp,
      });
      return;
    }
    case 'turnStarted': {
      bridge.emit({
        type: 'TURN_CHANGED',
        currentEntityId: eidFor(event.combatantId),
        activeEntities,
        stateRevision: state.stateRevision,
      });
      return;
    }
    case 'combatEnded': {
      bridge.emit({ type: 'COMBAT_ENDED', victory: event.victory });
      return;
    }
    default: {
      // Movement and round bookkeeping have no sidebar representation yet.
      return;
    }
  }
};

/** Emits the action-economy event for every combatant whose budget changed. */
export const emitEconomyChanges = (options: {
  bridge: EngineBridge;
  state: CombatState;
  previous: CombatState;
  eidFor: (combatantId: string) => number;
}): void => {
  const { bridge, state, previous, eidFor } = options;
  for (const [combatantId, combatant] of Object.entries(state.combatants)) {
    const before = previous.combatants[combatantId];
    if (before === undefined) {
      continue;
    }
    const changed =
      before.budget.movementRemaining !== combatant.budget.movementRemaining ||
      before.budget.actionAvailable !== combatant.budget.actionAvailable ||
      before.budget.quickActionAvailable !== combatant.budget.quickActionAvailable ||
      before.budget.reactionAvailable !== combatant.budget.reactionAvailable;
    if (!changed) {
      continue;
    }
    const entityId = eidFor(combatantId);
    if (entityId === 0) {
      continue;
    }
    bridge.emit({
      type: 'ACTION_ECONOMY_CHANGED',
      entityId,
      movementRemaining: combatant.budget.movementRemaining,
      actionAvailable: combatant.budget.actionAvailable,
      quickActionAvailable: combatant.budget.quickActionAvailable,
      bonusActionAvailable: combatant.budget.quickActionAvailable,
      reactionAvailable: combatant.budget.reactionAvailable,
      stateRevision: state.stateRevision,
    });
  }
};

// ---------------------------------------------------------------------------
// resolveV2CombatCommand
// ---------------------------------------------------------------------------

/**
 * Resolves one bridge command through the v2 kernel and commits the result.
 *
 * A rejected command changes nothing: the kernel returns a typed reason before
 * any mutation, and `applyCombatResult` no-ops on `valid: false`. On success
 * the revision advances by exactly one and the ECS world is updated through
 * the adapter (HP, positions, turn flags, budgets).
 */
export const resolveV2CombatCommand = (
  options: ResolveV2CombatCommandOptions,
): ResolveV2CombatCommandResult => {
  const { world, bridge, command, abilityCatalog } = options;

  const active = getActiveTurn(world);
  if (active === null) {
    return rejection('encounterEnded');
  }

  const state = buildV2CombatState({
    world,
    abilityCatalog,
    ...(options.abilityIdsByCombatant === undefined
      ? {}
      : { abilityIdsByCombatant: options.abilityIdsByCombatant }),
  });
  if (state === null) {
    return rejection('encounterEnded');
  }

  const registry = getCombatIdentityRegistry(world);
  registry.sync(world);
  const mapped = toKernelCombatCommand({
    state,
    combatantId: active.combatantId,
    command,
    abilityCatalog,
    basicAttackAbilityId: options.basicAttackAbilityId ?? DEFAULT_BASIC_ATTACK_ABILITY_ID,
    toCombatantId: (entityId) => registry.toCombatantId(entityId) ?? undefined,
  });
  if (typeof mapped === 'string') {
    return rejection(mapped);
  }

  return commitV2KernelCommand({ world, bridge, state, command: mapped });
};

/**
 * Resolves + commits a kernel command against a projection of the live world.
 *
 * Shared by the bridge path ({@link resolveV2CombatCommand}) and the AI turn
 * runner so both commit through exactly one code path.
 */
export const commitV2KernelCommand = (options: {
  world: World;
  bridge: EngineBridge;
  state: CombatState;
  command: CombatCommand;
}): ResolveV2CombatCommandResult => {
  const { world, bridge, state, command } = options;

  const result = resolveCombatCommand({
    state,
    command,
    basedOnRevision: state.stateRevision,
  });
  if (!result.valid) {
    return rejection(result.reasonCode);
  }

  applyCombatResult(world, state, result);

  const registry = getCombatIdentityRegistry(world);
  registry.sync(world);
  const eidFor = (combatantId: string): number => registry.toEntityId(combatantId) ?? 0;
  const activeEntities = Object.keys(result.state.combatants)
    .map((combatantId) => eidFor(combatantId))
    .filter((entityId) => entityId !== 0);

  for (const event of result.events) {
    mapCombatEventToBridge({ event, bridge, state: result.state, eidFor, activeEntities });
  }
  // C-525 AC-7: hand the client the resolved kernel events so outcome narration
  // derives from `CombatEvent[]` alone (never from the committed command).
  if (result.events.length > 0) {
    bridge.emit({
      type: 'COMBAT_EVENTS_RESOLVED',
      events: result.events,
      names: Object.fromEntries(
        Object.values(result.state.combatants).map((combatant) => [
          combatant.combatantId,
          combatant.name,
        ]),
      ),
    });
  }
  emitEconomyChanges({ bridge, state: result.state, previous: state, eidFor });
  // Carry the resolved state (RNG progress, phase, revision) into the next
  // command; without it every attack re-rolls the same die face.
  setLiveV2CombatState(world, result.state);
  syncDriverFromResolvedCombatState(world, result.state);
  if (result.state.phase === 'ended') {
    clearEncounterEngine(world);
    resetLiveV2CombatState(world);
  }

  return { ok: true, state: result.state, events: result.events };
};

/**
 * The reachable endpoints for the active combatant in the current revision.
 *
 * Shared by the preview handler and the move commit so both read one
 * projection.
 */
export const activeReachableEndpoints = (state: CombatState): GridPoint[] => {
  const active = state.initiative.order[state.initiative.activeIndex];
  if (active === undefined) {
    return [];
  }
  return getLegalActions({ state, combatantId: active }).endpoints;
};
