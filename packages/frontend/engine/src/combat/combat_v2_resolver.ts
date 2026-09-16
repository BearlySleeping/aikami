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

import { settlementToVictoryProjection } from '@aikami/schemas';
import type {
  CombatAbilityDefinition,
  CombatCommand,
  CombatEvent,
  CombatInvalidReason,
  CombatState,
  GridPoint,
  ParticipationStatus,
  ReactionChoice,
  ReactionChoiceSource,
  ReactionPolicy,
  ReactionWindow,
} from '@aikami/types';
import {
  COMBAT_MESSAGE_KEYS,
  COMBAT_RULES_VERSION,
  findCombatPathToCell,
  getLegalActions,
  resolveCombatCommand,
} from '@aikami/utils';
import type { World } from 'bitecs';
import type { EngineBridge } from '../engine_bridge.ts';
import { snapshotBattlefield } from './combat_battlefield.ts';
import { clearCombatCheckModifiers, getCombatCheckModifiers } from './combat_check_modifiers.ts';
import { clearEncounterDepth, getEncounterDepth } from './combat_encounter_depth.ts';
import {
  clearEncounterEnvironment,
  getEncounterEnvironment,
} from './combat_encounter_environment.ts';
import { captureEncounterForRetry } from './combat_encounter_retry.ts';
import { clearEncounterEngine } from './combat_encounter_start.ts';
import { getOrAllocateEncounterRunId, resetEncounterRunId } from './combat_run_identity.ts';
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
import { persistWorldObjectState } from './combat_world_object_state.ts';

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
      /**
       * The COMPLETE target set for a multi-target ability, when the compiled
       * plan names more than one. `targetId` stays the first target for the
       * legacy single-target callers; the kernel re-validates cardinality, so a
       * fan-out the ability does not author is a typed rejection rather than a
       * silent multi-hit for one cost.
       */
      targetIds?: Array<number | string>;
      /** Catalog ability id for an `ABILITY` action. */
      abilityId?: string;
      /** See {@link V2Admission.basedOnRevision}. */
      basedOnRevision?: number;
    }
  | { type: 'COMBAT_MOVE'; cellX: number; cellY: number; basedOnRevision?: number }
  | { type: 'COMBAT_END_TURN'; basedOnRevision?: number }
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
      /** See {@link V2Admission.basedOnRevision}. */
      basedOnRevision?: number;
    }
  /**
   * Combat-08: the decision for one open reaction window.
   *
   * The bridge names window identity, version and encounter-run identity; the
   * kernel revalidates all three plus the reactor's eligibility before any
   * reaction resource or RNG is spent, so a duplicate or stale choice is a
   * no-op rather than a second attack.
   */
  | {
      type: 'COMBAT_REACTION_SELECTED';
      /** The reactor deciding. Must be the window's current reactor. */
      reactorId: string;
      encounterRunId: string;
      windowId: string;
      windowVersion: number;
      choice: ReactionChoice;
      source: ReactionChoiceSource;
      basedOnRevision: number;
    };

/**
 * The admission fields every v2 command MAY carry (C-525 AC-4; review F2).
 *
 * `basedOnRevision` is the revision the caller confirmed against. It is the
 * one input that can produce `staleRevision`; absent keeps the pre-existing
 * behaviour for internal callers (the AI runner commits a projection it just
 * built, so its revision is current by construction).
 */
export type V2Admission = {
  basedOnRevision?: number;
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
  //
  // It is returned UNCHANGED. Earlier revisions re-read `GridPosition` from the
  // ECS into the live state on every projection, which let rendering
  // interpolation write unrecorded tactical movement back into the mechanical
  // authority and could strand the kernel's positions at a revision no command
  // produced. Committed moves are projected ECS-ward exactly once by
  // `applyCombatResult`; there is no ECS→kernel position path after start.
  const live = getLiveV2CombatState(world);
  if (live !== null && live.encounterId === driver.encounterId) {
    return live;
  }

  const pinned = getEncounterEnvironment(world);
  const depth = getEncounterDepth(world);
  // C-531 AC-2: the pinned sheet modifiers ride every projection, so the
  // inspector's preview and the kernel's commit read the same modifier.
  const checkModifiers = getCombatCheckModifiers(world);
  const state = snapshotCombatState(world, {
    encounterId: driver.encounterId,
    rulesVersion: COMBAT_RULES_VERSION,
    seed: driver.seed,
    // C-532: execution identity is allocated outside the pure kernel so a
    // deterministic retry (same encounter + seed) is still a distinct run.
    encounterRunId: getOrAllocateEncounterRunId(world, driver.encounterId),
    abilityCatalog: _catalog,
    battlefield: snapshotBattlefield(world),
    playerCombatantId: driver.playerCombatantId,
    ...(abilityIdsByCombatant === undefined ? {} : { abilityIdsByCombatant }),
    ...(checkModifiers === undefined ? {} : { checkModifiersByCombatant: checkModifiers }),
    ...(pinned === undefined
      ? {}
      : { environment: pinned.state, environmentBundle: pinned.bundle }),
    // C-532: the pinned authored objectives, morale rules and reactions ride
    // every projection, so preview, commit and replay read one authority.
    ...(depth === undefined
      ? {}
      : {
          objectiveRules: depth.objectiveRules,
          moraleRules: depth.moraleRules,
          reactionRegistry: depth.reactionRegistry,
        }),
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

  if (command.type === 'COMBAT_REACTION_SELECTED') {
    // The reactor, not the active combatant, owns this command: a window
    // suspends the MOVER's turn while a different actor decides. Contract:
    // C-532 AC-3.
    return {
      kind: 'resolveReaction',
      combatantId: command.reactorId,
      encounterRunId: command.encounterRunId,
      windowId: command.windowId,
      windowVersion: command.windowVersion,
      choice: command.choice,
      source: command.source,
    };
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
    ...(command.targetIds === undefined
      ? { targetId: command.targetId }
      : { targetIds: command.targetIds }),
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
  targetIds?: Array<number | string>;
  toCombatantId?: (entityId: number) => string | undefined;
}): string[] => {
  const { state, toCombatantId } = options;
  // A complete target set takes precedence over the legacy single target; the
  // kernel dedupes and sorts during normalization.
  const requested = options.targetIds ?? (options.targetId === undefined ? [] : [options.targetId]);
  return requested.map((targetId) =>
    resolveOneTargetId({
      state,
      targetId,
      ...(toCombatantId === undefined ? {} : { toCombatantId }),
    }),
  );
};

const resolveOneTargetId = (options: {
  state: CombatState;
  targetId: number | string;
  toCombatantId?: (entityId: number) => string | undefined;
}): string => {
  const { state, targetId } = options;
  // The client may address a target by authored combatant id (v2 rosters are
  // keyed by authored id, which is not always numeric) or by runtime eid; the
  // registry decides the latter.
  const asAuthoredId = String(targetId);
  if (state.combatants[asAuthoredId] !== undefined) {
    return asAuthoredId;
  }
  if (typeof targetId === 'number') {
    const mapped = options.toCombatantId?.(targetId);
    if (mapped !== undefined && state.combatants[mapped] !== undefined) {
      return mapped;
    }
  }
  return asAuthoredId;
};

// ---------------------------------------------------------------------------
// Event mapping
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reaction surface
// ---------------------------------------------------------------------------

/**
 * Whether the player's side controls `combatantId`.
 *
 * The player's side is the only one with a decision surface. Every other actor
 * resolves through a pinned deterministic policy so the kernel is never blocked
 * waiting for a model call. Contract: C-532 "Player and AI policy".
 */
const _playerControls = (state: CombatState, combatantId: string): boolean => {
  const combatant = state.combatants[combatantId];
  return (
    combatant?.team === 'player' ||
    (combatant?.team === 'ally' && combatant.controlMode === 'direct')
  );
};

/**
 * The policy that governs one reactor.
 *
 * An actor the player does not control has no decision surface to open, so it
 * resolves deterministically: `auto` accepts the legal opportunity the engine
 * already established eligibility for, and an authored `never` still declines.
 * The player's own side uses its authored policy, which defaults to `ask`.
 */
const _reactionPolicyFor = (state: CombatState, reactorId: string): ReactionPolicy => {
  const authored = state.participation[reactorId]?.reactionPolicy;
  if (_playerControls(state, reactorId)) {
    return authored ?? 'ask';
  }
  return authored === 'never' ? 'never' : 'auto';
};

/**
 * Emits `COMBAT_REACTION_OPENED` for one open window.
 *
 * The ENGINE decides who is asked: the reactor queue, the trigger cell and the
 * already-committed prefix all come from the window the kernel opened, so the
 * decision surface never re-derives eligibility. Contract: C-532 AC-3.
 */
const _emitReactionOpened = (options: {
  bridge: EngineBridge;
  state: CombatState;
  window: ReactionWindow;
}): void => {
  const { bridge, state, window } = options;
  const reaction = state.reactionRegistry.definitions.find(
    (definition) => definition.reactionId === window.reactionId,
  );
  const reactorId = window.currentReactorId ?? window.reactorQueue[0] ?? null;
  bridge.emit({
    type: 'COMBAT_REACTION_OPENED',
    encounterId: state.encounterId,
    encounterRunId: state.encounterRunId,
    windowId: window.windowId,
    windowVersion: window.version,
    // C-532: the committed revision this window belongs to. The resolver emits
    // the window before the economy events, so the client must decide against
    // THIS revision rather than its own last-seen counter.
    stateRevision: state.stateRevision,
    initiatingCommandId: window.initiatingCommandId,
    moverId: window.moverId,
    reactionId: window.reactionId,
    currentReactorId: reactorId,
    reactorQueue: [...window.reactorQueue],
    triggerCell: { ...window.triggerCell },
    reactionPolicy: reactorId === null ? 'auto' : _reactionPolicyFor(state, reactorId),
    abilityId: reaction?.abilityId ?? '',
    committedCells: window.continuation.committedCells.map((cell) => ({ x: cell.x, y: cell.y })),
  });
};

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
      // C-532 (review F4): publish the authored identity alongside the eid so
      // the UI can apply companion control ownership without inferring it.
      bridge.emit({
        type: 'TURN_CHANGED',
        currentEntityId: eidFor(event.combatantId),
        activeEntities,
        stateRevision: state.stateRevision,
        activeCombatantId: event.combatantId,
        combatantIdsByEntity: combatantIdsByEntityFor(state, eidFor),
      });
      return;
    }
    case 'reactionWindowOpened': {
      // C-532 AC-3: the encounter is now suspended on this window until the
      // reactor decides, so the surface must be told before anything else.
      const window = state.reaction.windows.find((entry) => entry.windowId === event.windowId);
      if (window !== undefined) {
        _emitReactionOpened({ bridge, state, window });
      }
      return;
    }
    case 'reactionResolved': {
      // The queue may still hold reactors: the SAME window advances to the next
      // one (same windowId, new version), and nothing else would ask it. A
      // window newly opened by the resumed move announces itself through its
      // own `reactionWindowOpened`, so only a same-id window is re-emitted.
      const advanced = state.reaction.windows.find((entry) => entry.windowId === event.windowId);
      if (advanced !== undefined) {
        _emitReactionOpened({ bridge, state, window: advanced });
      }
      return;
    }
    case 'combatEnded': {
      // C-532 (review F9): the terminal event is emitted by the caller AFTER
      // the final `COMBAT_EVENTS_RESOLVED` batch, so the presentation run still
      // has its facts when it ends. Mapping it here would end narration first
      // and drop the terminal batch. Deliberately a no-op.
      return;
    }
    default: {
      // Movement and round bookkeeping have no sidebar representation yet.
      return;
    }
  }
};

/** Projects the resolved state's authored ids through the identity registry. */
const combatantIdsByEntityFor = (
  state: CombatState,
  eidFor: (combatantId: string) => number,
): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const combatantId of Object.keys(state.combatants)) {
    const entityId = eidFor(combatantId);
    if (entityId !== 0) {
      map[String(entityId)] = combatantId;
    }
  }
  return map;
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

  return commitV2KernelCommand({
    world,
    bridge,
    state,
    command: mapped,
    // Review F2: every v2 command variant now carries (or defaults to) the
    // revision it was confirmed against, so a delayed ordinary command is
    // rejected exactly like a stale reaction — no cost, no RNG, no event.
    ...(command.basedOnRevision === undefined ? {} : { basedOnRevision: command.basedOnRevision }),
  });
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
  basedOnRevision?: number;
}): ResolveV2CombatCommandResult => {
  const { world, bridge, state, command } = options;

  const result = resolveCombatCommand({
    state,
    command,
    basedOnRevision: options.basedOnRevision ?? state.stateRevision,
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
  // C-532 (review F9): END only AFTER the final facts batch, and carry the
  // authoritative settlement. The ViewModel ends its narration run on this
  // event, so emitting it first dropped the terminal batch's template.
  if (result.state.phase === 'ended') {
    emitCombatEnded({ bridge, state: result.state, eidFor });
  }
  // Carry the resolved state (RNG progress, phase, revision) into the next
  // command; without it every attack re-rolls the same die face.
  setLiveV2CombatState(world, result.state);
  syncDriverFromResolvedCombatState(world, result.state);
  if (result.state.phase === 'ended') {
    // C-531 AC-7: capture the committed object state BEFORE the encounter's
    // environment is cleared, so destroyed/moved objects keep their identity
    // when the player returns to exploration (and across a save/reload).
    persistWorldObjectState(world, {
      state: result.state.environment,
      bundle: result.state.environmentBundle,
    });
    clearEncounterEngine(world);
    resetLiveV2CombatState(world);
    // C-532: the run is over; a future encounter (or retry) allocates a new id.
    resetEncounterRunId(world, result.state.encounterId);
    clearEncounterEnvironment(world);
    clearEncounterDepth(world);
    // C-531 AC-2: the pinned sheet modifiers expire with the encounter.
    clearCombatCheckModifiers(world);
  }

  return { ok: true, state: result.state, events: result.events };
};

/**
 * Emits the terminal bridge event for a settled v2 encounter.
 *
 * Carries the authoritative settlement (victory/defeat/escape + reason +
 * objectives) and the participation status of every combatant, so the UI can
 * label defeated/surrendered/escaped/ally actors from mechanics instead of
 * assuming "every non-player actor is defeated on victory".
 * Contract: C-532 AC-5.
 */
export const emitCombatEnded = (options: {
  bridge: EngineBridge;
  state: CombatState;
  eidFor: (combatantId: string) => number;
}): void => {
  const { bridge, state, eidFor } = options;
  const settlement = state.settlement;
  const victory =
    settlement === null
      ? (state.outcome?.victory ?? false)
      : settlementToVictoryProjection(settlement);
  const participation = Object.fromEntries(
    Object.entries(state.participation).map(([combatantId, entry]) => [combatantId, entry.status]),
  );
  // The UI keys its initiative rows by runtime eid, so project the same status
  // through the identity registry once, at the boundary.
  const participationByEntity: Record<string, ParticipationStatus> = {};
  for (const [combatantId, status] of Object.entries(participation)) {
    const entityId = eidFor(combatantId);
    if (entityId !== 0) {
      participationByEntity[String(entityId)] = status;
    }
  }
  bridge.emit({
    type: 'COMBAT_ENDED',
    victory,
    ...(settlement === null
      ? {}
      : {
          settlement: {
            settlementId: settlement.settlementId,
            result: settlement.result,
            reasonCode: settlement.reasonCode,
            objectiveResults: settlement.objectiveResults.map((entry) => ({ ...entry })),
          },
        }),
    participation,
    participationByEntity,
  });
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
