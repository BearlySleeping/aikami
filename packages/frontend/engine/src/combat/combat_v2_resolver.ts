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
  ResolveCombatResult,
} from '@aikami/types';
import {
  COMBAT_MESSAGE_KEYS,
  COMBAT_RULES_VERSION,
  findCombatPathToCell,
  getLegalActions,
  resolveCombatCommand,
} from '@aikami/utils';
import type { World } from 'bitecs';
import { logger } from '$logger';
import type { EngineBridge } from '../engine_bridge.ts';
import { snapshotBattlefield } from './combat_battlefield.ts';
import { pathsAreEquivalent, resolveTargetIds } from './combat_v2_command_mapping.ts';
import { emitEconomyChanges, mapCombatEventToBridge } from './combat_v2_events.ts';
import { clearCombatCheckModifiers, getCombatCheckModifiers } from './combat_check_modifiers.ts';
import {
  admitV2Command,
  recordCommandOutcome,
} from './combat_command_envelope.ts';
import { clearEncounterDepth, getEncounterDepth } from './combat_encounter_depth.ts';
import {
  clearEncounterEnvironment,
  getEncounterEnvironment,
} from './combat_encounter_environment.ts';
import { captureEncounterForRetry } from './combat_encounter_retry.ts';
import { clearEncounterEngine } from './combat_encounter_start.ts';
import { resolveEngineReactionPolicies } from './combat_v2_reaction_policy.ts';
import { getOrAllocateEncounterRunId, resetEncounterRunId } from './combat_run_identity.ts';
import { bumpCombatSessionRevision } from './combat_session_checkpoint.ts';
import {
  applyCombatResult,
  getCombatIdentityRegistry,
  installCombatProjection,
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

/**
 * The command-admission identity every ordinary v2 command MUST carry
 * (review F-B). The engine verifies it before the kernel is reached.
 */
export type V2Admission = {
  /** Unique per command attempt; the idempotency key. */
  commandId?: string;
  /** The authored encounter the command belongs to. */
  encounterId?: string;
  /** The execution run the command was confirmed against. */
  encounterRunId?: string;
  /** The acting stable combatant id (authored, never an eid). */
  combatantId?: string;
  /** The turn identity the command was confirmed on. */
  turnId?: string;
  /** The revision the caller confirmed against. */
  basedOnRevision?: number;
};

/** The commands the v2 resolver resolves. */
export type V2ResolvableCommand =
  | (V2Admission & {
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
    })
  | (V2Admission & {
      type: 'COMBAT_MOVE';
      cellX: number;
      cellY: number;
      /**
       * The exact cell path the preview was confirmed against. When present the
       * engine refuses the command if its own reconstruction differs — a
       * topology change must never silently turn an approved path into a
       * different one that ends on the same tile (review F3).
       */
      path?: GridPoint[];
    })
  | (V2Admission & { type: 'COMBAT_END_TURN' })
  /**
   * Combat-07: use one authored affordance on one authored object.
   *
   * The bridge names stable authored ids only — the kernel owns eligibility,
   * cost, the check and every consequence.
   */
  | (V2Admission & {
      type: 'COMBAT_INTERACT';
      objectId: string;
      affordanceId: string;
      /** Optional second object the approach names (e.g. an oil pool). */
      targetObjectId?: string | null;
    })
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
  | {
      ok: true;
      state: CombatState;
      events: CombatEvent[];
      /**
       * The transition was already projected onto the ECS. Nothing was
       * re-published: the original acceptance stands. Review F2 idempotency.
       */
      duplicate?: boolean;
    }
  | {
      ok: false;
      reasonCode: CombatInvalidReason;
      messageKey: string;
      /**
       * The precise admission cause when the refusal came from the command
       * envelope rather than the kernel (review F-B). Additive: an existing
       * consumer that only reads `reasonCode` is unaffected.
       */
      detail?: string;
    };

export {
  emitEconomyChanges,
  engineReactionPolicyFor,
  mapCombatEventToBridge,
  playerControlsCombatant,
} from './combat_v2_events.ts';

export { pathsAreEquivalent, resolveTargetIds } from './combat_v2_command_mapping.ts';

export const DEFAULT_BASIC_ATTACK_ABILITY_ID = 'basic_melee';

/** A typed refusal carrying the stable i18n key and the precise admission cause. */
const rejection = (
  reasonCode: CombatInvalidReason,
  detail?: string,
): ResolveV2CombatCommandResult => ({
  ok: false,
  reasonCode,
  messageKey: COMBAT_MESSAGE_KEYS[reasonCode],
  ...(detail === undefined ? {} : { detail }),
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
  // Review F7/F-A: installing an authoritative state must also seed the apply
  // guard with THAT revision. A restore or a fresh opening state at revision N
  // otherwise leaves the guard expecting 0, so the next accepted command is
  // silently dropped from the ECS while the resolver still publishes N+1.
  installCombatProjection(world, state);
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
    // Review F3/F-D: an approved preview is a statement about a particular
    // command against a particular revision. When the client sends the path it
    // confirmed, the engine refuses to execute a MATERIALLY DIFFERENT path that
    // happens to end on the same tile (terrain, occupancy or cost changed
    // between preview and commit). `staleRevision` is the honest reason: the
    // confirmation no longer describes the state, so a fresh preview is
    // required.
    if (command.path !== undefined && !pathsAreEquivalent(command.path, path)) {
      return 'staleRevision';
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

  // ── ONE command-admission boundary (review F-B) ─────────────────────────
  // A reaction is admitted by the kernel's own window/version/run checks; every
  // ordinary command is admitted here, before the kernel is reached, against
  // the encounter, the execution run, the expected revision, the turn identity
  // and the engine's own actor-ownership policy. A rejection spends no budget,
  // consumes no RNG, emits no event and mutates no ECS component.
  if (command.type === 'COMBAT_REACTION_SELECTED') {
    return commitV2KernelCommand({
      world,
      bridge,
      state,
      command: mapped,
      basedOnRevision: command.basedOnRevision,
    });
  }

  const admission = admitV2Command({
    world,
    state,
    identity: command,
    command: mapped,
    isActorEngineControlled: true,
  });
  if (admission.status === 'rejected') {
    logger.warn('combat:v2-command-not-admitted', {
      detail: admission.detail,
      encounterId: state.encounterId,
      commandType: command.type,
    });
    return rejection(admission.reasonCode, admission.detail);
  }
  if (admission.status === 'duplicate') {
    // Idempotent replay of an already-decided command: never resolve twice, so
    // no second roll, no second cost. A rejected original stays rejected; an
    // accepted original is acknowledged without re-publishing its facts.
    if (admission.entry.outcome === 'rejected') {
      return rejection(admission.entry.reasonCode ?? 'invalidCommandShape');
    }
    return { ok: true, state, events: [], duplicate: true };
  }

  const result = commitV2KernelCommand({
    world,
    bridge,
    state,
    command: mapped,
    basedOnRevision: admission.identity.basedOnRevision,
  });
  recordCommandOutcome({
    world,
    encounterId: state.encounterId,
    identity: admission.identity,
    digest: admission.digest,
    command: mapped,
    previousRevision: state.stateRevision,
    resultRevision: result.ok ? result.state.stateRevision : null,
    outcome: result.ok ? 'accepted' : 'rejected',
    ...(result.ok ? {} : { reasonCode: result.reasonCode }),
  });
  return result;
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
  return commitV2ResolvedResult({ world, bridge, previous: state, result });
};

/**
 * Publishes one already-resolved kernel result through the single commit path.
 *
 * Shared by {@link commitV2KernelCommand} and the party-escape exit
 * ({@link resolvePartyEscape}), so every accepted transition — including the
 * terminal FLEE settlement — applies to the ECS, publishes its facts, emits the
 * terminal event and runs the v2 cleanup through exactly one implementation.
 */
export const commitV2ResolvedResult = (options: {
  world: World;
  bridge: EngineBridge;
  previous: CombatState;
  result: ResolveCombatResult;
}): ResolveV2CombatCommandResult => {
  const { world, bridge, previous: state, result } = options;
  if (!result.valid) {
    return rejection(result.reasonCode);
  }

  // Review F-A: the apply guard is a hard gate, not a hint. A rejection here
  // means the ECS does NOT hold the transition the kernel resolved, so nothing
  // downstream may observe it as accepted: no events, no economy, no terminal
  // settlement, no live-state advance, no AI continuation.
  const applied = applyCombatResult(world, state, result);
  if (applied.status === 'rejected') {
    logger.warn('combat:v2-application-rejected', {
      reason: applied.reason,
      encounterId: applied.encounterId,
      projectedRevision: applied.projectedRevision,
      previousStateRevision: applied.previousStateRevision,
      resultRevision: applied.resultRevision,
    });
    return rejection(
      applied.reason === 'revisionMismatch' || applied.reason === 'revisionGap'
        ? 'staleRevision'
        : 'invalidStateShape',
    );
  }
  if (applied.status === 'duplicate') {
    // Already projected: the original acceptance stands and re-publishing the
    // same facts would double-count them.
    return { ok: true, state: result.state, events: [], duplicate: true };
  }

  // The accepted-command boundary advances ONLY here — after the transition was
  // accepted and projected. The save read barrier reads this value, so a save
  // can prove that its parts belong to one accepted boundary (review F-B).
  bumpCombatSessionRevision(world, result.state.encounterId);

  // Publication order (review F-A / F9): the accepted transition and its ECS
  // projection are installed FIRST, then the mechanical facts are published,
  // then the terminal event — so no consumer observes a success that the ECS
  // did not receive.
  setLiveV2CombatState(world, result.state);

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

  // Review F8: the ENGINE owns the deterministic NPC reaction policy. A window
  // whose current reactor the player does not control must resolve without a
  // mounted decision surface — otherwise an enemy reaction deadlocks the
  // encounter in phase 'reaction' forever. The drain is injected with this
  // module's own commit function, which keeps the module graph acyclic.
  resolveEngineReactionPolicies({
    world,
    bridge,
    readState: () => getLiveV2CombatState(world),
    commit: (command) => {
      const current = getLiveV2CombatState(world);
      if (current === null) {
        return rejection('encounterEnded');
      }
      return commitV2KernelCommand({ world, bridge, state: current, command });
    },
  });

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
