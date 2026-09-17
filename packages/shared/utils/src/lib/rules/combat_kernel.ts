// packages/shared/utils/src/lib/rules/combat_kernel.ts
//
// Pure, deterministic combat kernel — the single mechanical authority for
// Combat 2.0. Snapshot-in / `{ state, events }`-out, no I/O, no engine or
// client imports, and no ambient randomness. The RNG is advanced only through
// explicit named substreams carried in the state.
//
// Contract: C-509 AC-2, AC-4, AC-5, AC-7

import {
  COMBAT_SCHEMA_VERSION,
  CombatStateSchema,
  createEncounterRunId,
  emptyEnvironmentalState,
  emptyEnvironmentBundle,
  emptyMoraleRules,
  emptyObjectiveRules,
  emptyReactionRegistry,
  emptyReactionState,
  hasValidBattlefieldGridLengths,
} from '@aikami/schemas';
import type {
  BattlefieldState,
  CombatAbilityDefinition,
  CombatantState,
  CombatCommand,
  CombatEnvironmentBundle,
  CombatEvent,
  CombatEventEnvelope,
  CombatObjectiveState,
  CombatState,
  EnvironmentalState,
  GridPoint,
  MoraleRules,
  ObjectiveRules,
  ParticipationState,
  ReactionRegistry,
  ResolveCombatResult,
  SerializableCommandContinuation,
} from '@aikami/types';
import { Value } from 'typebox/value';
import { deserializeRng, serializeRng } from '../rng/seedable_rng';
// The ordered resolution pass owns steps 4–6 (participation/morale, objectives,
// settlement). The kernel owns steps 1–3 and the commit boundary.
// Contract: C-532 AC-1, AC-2, AC-5.
import { resolveEncounterBatch } from './combat_encounter_resolution';
// The environmental registry owns authored-object resolution; the kernel owns
// the commit boundary. Contract: C-531 AC-2.
import {
  applyEnvironmentalCommand,
  applyEnvironmentalRoundStart,
  coverArmorClassBonus,
} from './combat_environment';
// The validation/normalization boundary is a separate module so the kernel
// stays the ordered pipeline; `validateMove` is shared with the continuation
// resume. Contract: C-509 AC-1; C-532 AC-2, AC-3.
import {
  type CombatCommandInput,
  failure,
  validateCombatCommand,
  validateMove,
} from './combat_kernel_validation';
// The pure reaction mechanics own trigger detection, ordering and eligibility.
// Contract: C-532 AC-3.
import { authoredMoraleResponse, isInExitZone } from './combat_morale';
import { interactionKey } from './combat_objectives';
import {
  advanceReactorQueue,
  buildMoveContinuation,
  buildReactionWindow,
  computeOpportunityTriggers,
  continuationCanResume,
  opportunityReaction,
  reactorIsEligible,
  resolveReactionWindow,
} from './combat_reactions';
// The pure spatial leaf owns quantization + line of sight. The kernel imports
// it (never `combat_tactical.ts`, which would close an import cycle).
// Contract: C-515 AC-3.
import { pathTraversalCost } from './combat_spatial';
// The turn/budget authority lives in the coordinator; the kernel delegates to
// it so there is exactly one implementation of turn advance and budget
// legality. Contract: C-514 AC-1, AC-2, AC-3.
import { turnIdFor } from './combat_turn_coordinator';

// The command-validation boundary keeps its public import site through the
// kernel facade. Contract: C-509 AC-1; C-532 AC-2, AC-3.
export { type CombatCommandInput, validateCombatCommand } from './combat_kernel_validation';
// Re-exported so existing callers keep importing it from the kernel.
export { COMBAT_MESSAGE_KEYS } from './combat_message_keys';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export {
  COMBAT_RULES_VERSION,
  isSupportedCombatRulesVersion,
  SUPPORTED_COMBAT_RULES_VERSIONS,
} from './combat_rules_version';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

import { compareCombatantIds, createRngState, resolveHit, rollDamage } from './combat_kernel_rng';
import { advanceTurn } from './combat_kernel_turns';

const cloneValue = <T>(value: T): T => structuredClone(value);

// Canonical sorted-key JSON lives in a leaf module so the replay helpers can use
// it without importing the kernel back. Re-exported here because existing
// callers import it from the kernel. Contract: C-531 AC-7.
export { canonicalCombatJson } from './combat_canonical_json';

/**
 * Runs the ordered resolution pass (steps 4–6) for the batch committed so
 * far and appends its events. Returns `true` when the encounter settled.
 *
 * The accumulator is drained so a later call in the same command does not
 * re-apply an already-applied morale trigger or interaction.
 */
const runResolutionPass = (options: {
  state: CombatState;
  envelope: CombatEventEnvelope;
  events: CombatEvent[];
  accumulator: BatchAccumulator;
}): boolean => {
  const result = resolveEncounterBatch({
    state: options.state,
    envelope: options.envelope,
    previousProgress: options.state.objectives,
    removedCombatantIds: options.accumulator.removedCombatantIds,
    committedInteractionKeys: options.accumulator.committedInteractionKeys,
  });
  options.events.push(...result.events);
  options.accumulator.removedCombatantIds = [];
  options.accumulator.committedInteractionKeys = [];
  return result.settled;
};

/** Combatants removed and interactions committed by the current command. */
type BatchAccumulator = {
  removedCombatantIds: string[];
  committedInteractionKeys: string[];
};

/**
 * Commits a contiguous run of movement cells and charges only those cells.
 * Returns the movement cost charged.
 */
const commitMoveCells = (options: {
  state: CombatState;
  combatantId: string;
  cells: readonly GridPoint[];
  envelope: CombatEventEnvelope;
  events: CombatEvent[];
}): number => {
  const { state, cells, envelope, events } = options;
  if (cells.length === 0) {
    return 0;
  }
  const actor = state.combatants[options.combatantId];
  const path = cells.map((cell) => ({ x: cell.x, y: cell.y }));
  const movementCost = pathTraversalCost({ battlefield: state.battlefield, path });
  const last = path[path.length - 1];
  actor.position = { x: last.x, y: last.y };
  actor.budget.movementRemaining -= movementCost;
  events.push({
    ...envelope,
    kind: 'movementCommitted',
    combatantId: options.combatantId,
    path,
    movementCost,
    movementRemaining: actor.budget.movementRemaining,
  });
  return movementCost;
};

/**
 * Opens the reaction window for the first opportunity trigger on a move, or
 * returns `null` when the move triggers nothing.
 */
const openReactionWindowForMove = (options: {
  state: CombatState;
  combatantId: string;
  commandId: string;
  path: readonly GridPoint[];
  envelope: CombatEventEnvelope;
  events: CombatEvent[];
  accumulator: BatchAccumulator;
}): boolean => {
  const { state } = options;
  const mover = state.combatants[options.combatantId];
  const triggers = computeOpportunityTriggers({
    mover,
    path: options.path,
    combatants: state.combatants,
    participation: state.participation,
    registry: state.reactionRegistry,
    abilityCatalog: state.abilityCatalog,
    cause: 'voluntary',
    nested: state.reaction.windows.length > 0,
  });
  const trigger = triggers[0];
  if (trigger === undefined) {
    return false;
  }
  const reaction = opportunityReaction(state.reactionRegistry);
  if (reaction === null) {
    return false;
  }

  // Commit the prefix that has NOT yet left the threat range; the trigger cell
  // is deliberately not committed.
  const prefix = options.path.slice(0, trigger.pathIndex);
  const spentMovement = commitMoveCells({
    state,
    combatantId: options.combatantId,
    cells: prefix,
    envelope: options.envelope,
    events: options.events,
  });

  const continuation = buildMoveContinuation({
    continuationId: `cont:${options.combatantId}:${options.commandId}`,
    initiatingCommandId: options.commandId,
    combatantId: options.combatantId,
    fullPath: options.path,
    committedPathIndex: trigger.pathIndex - 1,
    spentMovement,
  });
  const window = buildReactionWindow({
    initiatingCommandId: options.commandId,
    moverId: options.combatantId,
    reactionId: reaction.reactionId,
    trigger,
    continuation,
    version: 1,
  });
  state.reaction = {
    windows: [
      { ...window, continuation: { ...window.continuation, pendingWindowId: window.windowId } },
    ],
  };
  state.phase = 'reaction';
  options.events.push({
    ...options.envelope,
    kind: 'reactionWindowOpened',
    windowId: window.windowId,
    windowVersion: window.version,
    initiatingCommandId: window.initiatingCommandId,
    moverId: window.moverId,
    reactionId: window.reactionId,
    reactorQueue: [...window.reactorQueue],
    triggerCell: { ...window.triggerCell },
  });
  return true;
};

/**
 * Resumes a movement suspended by a reaction.
 *
 * The mover's position is already at the end of the committed prefix, so the
 * remaining path is contiguous from there. The remaining path is re-scanned
 * for a further trigger; the scan is bounded by the path length because every
 * window consumes at least one path cell.
 *
 * A mover that is downed, removed, surrendered, or in an ended encounter
 * cannot continue: the remainder is cancelled and the accumulated movement is
 * NOT replayed or re-charged.
 */
const resumeContinuation = (options: {
  state: CombatState;
  continuation: SerializableCommandContinuation;
  envelope: CombatEventEnvelope;
  events: CombatEvent[];
}): void => {
  const { state, continuation } = options;
  const mover = state.combatants[continuation.combatantId];
  const canResume = continuationCanResume({
    mover,
    participation: state.participation[continuation.combatantId],
    phaseEnded: state.phase === 'ended',
  });

  if (!canResume || mover === undefined) {
    options.events.push({
      ...options.envelope,
      kind: 'movementContinuationResumed',
      continuationId: continuation.continuationId,
      combatantId: continuation.combatantId,
      committedCells: [],
      cancelled: true,
    });
    return;
  }

  // Revalidate the still-uncommitted remainder against CURRENT state before
  // charging a single cell. Terrain, movement budget, contiguity and the
  // actor's own position may all have changed while the reaction window was
  // open, and a stale continuation must cancel safely rather than replay or
  // re-charge an illegal cell. Contract: C-532 AC-3.
  if (continuation.remainingPath.length > 0) {
    const remainder = validateMove(
      state,
      { kind: 'move', combatantId: continuation.combatantId, path: continuation.remainingPath },
      mover,
    );
    if (!remainder.valid) {
      options.events.push({
        ...options.envelope,
        kind: 'movementContinuationResumed',
        continuationId: continuation.continuationId,
        combatantId: continuation.combatantId,
        committedCells: [],
        cancelled: true,
      });
      return;
    }
  }

  const triggers = computeOpportunityTriggers({
    mover,
    path: continuation.remainingPath,
    combatants: state.combatants,
    participation: state.participation,
    registry: state.reactionRegistry,
    abilityCatalog: state.abilityCatalog,
    cause: 'voluntary',
    nested: false,
    alreadyOfferedReactorIds: continuation.resolvedReactorIds,
  });
  const trigger = triggers[0];
  const prefix =
    trigger === undefined
      ? continuation.remainingPath
      : continuation.remainingPath.slice(0, trigger.pathIndex);
  const charged = commitMoveCells({
    state,
    combatantId: continuation.combatantId,
    cells: prefix,
    envelope: options.envelope,
    events: options.events,
  });
  options.events.push({
    ...options.envelope,
    kind: 'movementContinuationResumed',
    continuationId: continuation.continuationId,
    combatantId: continuation.combatantId,
    committedCells: prefix.map((cell) => ({ x: cell.x, y: cell.y })),
    cancelled: false,
  });

  // A retreat suspended mid-path can still reach its exit zone on resume.
  // Contract: C-532 AC-2.
  const participation = state.participation[continuation.combatantId];
  if (participation?.status === 'retreating') {
    const response = authoredMoraleResponse(state.moraleRules, 'retreat');
    if (
      response !== null &&
      response.exitZoneId !== null &&
      isInExitZone({
        rules: state.moraleRules,
        exitZoneId: response.exitZoneId,
        cell: mover.position,
      })
    ) {
      state.participation[continuation.combatantId] = { ...participation, status: 'escaped' };
      options.events.push({
        ...options.envelope,
        kind: 'participationChanged',
        combatantId: continuation.combatantId,
        status: 'escaped',
        reasonCode: 'reached_exit_zone',
      });
    }
  }

  if (trigger === undefined) {
    return;
  }
  const reaction = opportunityReaction(state.reactionRegistry);
  if (reaction === null) {
    return;
  }
  const sequence = continuation.resolvedWindowIds.length + 1;
  const nextContinuation = buildMoveContinuation({
    continuationId: continuation.continuationId,
    initiatingCommandId: continuation.initiatingCommandId,
    combatantId: continuation.combatantId,
    fullPath: continuation.remainingPath,
    committedPathIndex: trigger.pathIndex - 1,
    spentMovement: continuation.spentMovement + charged,
  });
  const window = buildReactionWindow({
    initiatingCommandId: continuation.initiatingCommandId,
    moverId: continuation.combatantId,
    reactionId: reaction.reactionId,
    trigger,
    continuation: {
      ...nextContinuation,
      resolvedWindowIds: [...continuation.resolvedWindowIds],
      resolvedReactorIds: [...continuation.resolvedReactorIds],
    },
    version: sequence,
  });
  state.reaction = {
    windows: [
      { ...window, continuation: { ...window.continuation, pendingWindowId: window.windowId } },
    ],
  };
  state.phase = 'reaction';
  options.events.push({
    ...options.envelope,
    kind: 'reactionWindowOpened',
    windowId: window.windowId,
    windowVersion: window.version,
    initiatingCommandId: window.initiatingCommandId,
    moverId: window.moverId,
    reactionId: window.reactionId,
    reactorQueue: [...window.reactorQueue],
    triggerCell: { ...window.triggerCell },
  });
};

/**
 * Resolves one reaction selection: an accepted legal attack consumes one
 * reaction and rolls once on the named `actions` substream; a declined or
 * no-longer-legal choice consumes nothing.
 */
const resolveReactionWindowCommand = (options: {
  state: CombatState;
  command: Extract<CombatCommand, { kind: 'resolveReaction' }>;
  envelope: CombatEventEnvelope;
  events: CombatEvent[];
  accumulator: BatchAccumulator;
}): void => {
  const { state, command, envelope, events } = options;
  const window = state.reaction.windows.find((entry) => entry.windowId === command.windowId);
  if (window === undefined) {
    return;
  }

  const reactor = state.combatants[command.combatantId];
  const mover = state.combatants[window.moverId];
  const reaction = state.reactionRegistry.definitions.find(
    (entry) => entry.reactionId === window.reactionId,
  );

  let spentReaction = false;
  let abilityId: string | null = null;
  let targetId: string | null = null;

  // Revalidate eligibility immediately before resolution.
  const eligible =
    reaction !== undefined &&
    reactor !== undefined &&
    mover !== undefined &&
    reactorIsEligible({
      reactor,
      mover,
      participation: state.participation[command.combatantId],
      reaction,
      ability: state.abilityCatalog[reaction.abilityId],
      targetPosition: mover.position,
    });

  if (
    command.choice === 'accept' &&
    eligible &&
    reaction !== undefined &&
    reactor !== undefined &&
    mover !== undefined
  ) {
    const ability = state.abilityCatalog[reaction.abilityId];
    abilityId = reaction.abilityId;
    targetId = mover.combatantId;
    const actionsRng = deserializeRng(state.rng.streams.actions);
    const naturalRoll = actionsRng.dice(20);
    const totalRoll = naturalRoll + reactor.attackBonus + ability.attackBonus;
    const effectiveArmorClass =
      mover.armorClass +
      coverArmorClassBonus({
        state,
        attacker: reactor.position,
        target: mover.position,
      });
    const hit = resolveHit(naturalRoll, totalRoll, effectiveArmorClass);
    const isCriticalHit = naturalRoll === 20;

    events.push({
      ...envelope,
      kind: 'attackRolled',
      attackerId: reactor.combatantId,
      targetId: mover.combatantId,
      abilityId: reaction.abilityId,
      naturalRoll,
      totalRoll,
      hit,
      isCriticalHit,
    });

    if (hit && ability.damageDice !== null && ability.damageType !== null) {
      const amount = rollDamage(actionsRng, ability.damageDice, isCriticalHit);
      const hpAfter = Math.max(0, mover.hp - amount);
      const downed = hpAfter <= 0;
      mover.hp = hpAfter;
      mover.downed = downed || mover.downed;
      mover.defeated = downed || mover.defeated;
      events.push({
        ...envelope,
        kind: 'damageApplied',
        attackerId: reactor.combatantId,
        targetId: mover.combatantId,
        amount,
        damageType: ability.damageType,
        hpAfter,
        downed,
      });
      if (downed) {
        events.push({ ...envelope, kind: 'combatantDowned', combatantId: mover.combatantId });
        events.push({ ...envelope, kind: 'combatantDefeated', combatantId: mover.combatantId });
        options.accumulator.removedCombatantIds.push(mover.combatantId);
      }
    }

    state.rng = {
      ...state.rng,
      streams: { ...state.rng.streams, actions: serializeRng(actionsRng) },
    };
    // Consumed whether the attack hits or misses.
    reactor.budget.reactionAvailable = false;
    spentReaction = true;
  }

  events.push({
    ...envelope,
    kind: 'reactionResolved',
    windowId: window.windowId,
    reactorId: command.combatantId,
    choice: command.choice,
    source: command.source,
    spentReaction,
    abilityId,
    targetId,
  });

  // Steps 4–6 run immediately after the reaction's effects, BEFORE offering
  // another reactor or continuing a mover that may have been downed. Without
  // this the local removal accumulator would be discarded when the phase stays
  // `reaction`, and a fatal first reaction would not settle or preserve the
  // required morale/participation transitions. Contract: C-532 AC-3, AC-5.
  if (options.accumulator.removedCombatantIds.length > 0) {
    const settled = runResolutionPass({
      state,
      envelope,
      events,
      accumulator: options.accumulator,
    });
    if (settled || state.phase === 'ended') {
      return;
    }
  }

  const advanced = advanceReactorQueue(window);
  if (advanced.currentReactorId !== null) {
    state.reaction = {
      windows: [
        {
          ...advanced,
          continuation: { ...advanced.continuation, pendingWindowId: advanced.windowId },
        },
      ],
    };
    return;
  }

  // Queue drained: resolve the window, release the suspension, and resume.
  const resolved = resolveReactionWindow(advanced);
  state.reaction = { windows: [] };
  state.phase = 'active';
  resumeContinuation({
    state,
    continuation: resolved.continuation,
    envelope,
    events,
  });
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
  /** Pinned authored objective rules. Absent means the empty rules. */
  objectiveRules?: ObjectiveRules;
  /** Pinned authored morale rules. Absent means no triggers and morale 100. */
  moraleRules?: MoraleRules;
  /** Pinned registered reaction definitions. Absent means no reactions. */
  reactionRegistry?: ReactionRegistry;
  /**
   * Per-combatant participation overrides. An actor with no override starts
   * `active` with the morale rules' authored starting morale.
   */
  participation?: Record<string, ParticipationState>;
  /**
   * Identity of this encounter run. Absent derives a deterministic id from the
   * encounter id and seed, so replay is stable without ambient randomness.
   */
  encounterRunId?: string;
  /**
   * Live authored-object and surface state. Absent means the empty state — a
   * fight with no environmental mechanics (Combat-07).
   */
  environment?: EnvironmentalState;
  /** The pinned definition bundle this encounter resolves against. */
  environmentBundle?: CombatEnvironmentBundle;
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

  const moraleRules = cloneValue(input.moraleRules ?? emptyMoraleRules());
  const participation: Record<string, ParticipationState> = {};
  for (const combatantId of order) {
    const override = input.participation?.[combatantId];
    participation[combatantId] = cloneValue(
      override ?? {
        status: combatants[combatantId].defeated ? 'defeated' : 'active',
        morale: moraleRules.startingMorale,
        appliedTriggerIds: [],
        reactionPolicy: 'ask',
      },
    );
  }

  return {
    schemaVersion: COMBAT_SCHEMA_VERSION,
    rulesVersion: input.rulesVersion,
    encounterId: input.encounterId,
    encounterRunId:
      input.encounterRunId ??
      createEncounterRunId({ encounterId: input.encounterId, seed: input.seed }),
    stateRevision: 0,
    round: 1,
    phase: hasCombatants ? 'active' : 'ended',
    turnId: hasCombatants ? turnIdFor(1, order[0]) : null,
    rng: createRngState(input.seed),
    initiative: { order, activeIndex: 0 },
    combatants,
    abilityCatalog: cloneValue(input.abilityCatalog),
    battlefield: cloneValue(input.battlefield),
    environment: cloneValue(input.environment ?? emptyEnvironmentalState()),
    environmentBundle: cloneValue(input.environmentBundle ?? emptyEnvironmentBundle()),
    objectives: cloneValue(input.objectives ?? []),
    objectiveRules: cloneValue(input.objectiveRules ?? emptyObjectiveRules()),
    participation,
    moraleRules,
    reactionRegistry: cloneValue(input.reactionRegistry ?? emptyReactionRegistry()),
    reaction: emptyReactionState(),
    settlement: null,
    outcome: hasCombatants ? null : { victory: false, reason: 'no_combatants' },
  };
};

// ---------------------------------------------------------------------------
// resolveCombatCommand
// ---------------------------------------------------------------------------

/**
 * Validates then resolves a single combat command against an immutable state.
 *
 * On `valid: false` the caller's state is untouched and no partial state is
 * ever returned. On success the input is not mutated, `stateRevision` advances
 * by exactly one, and only the relevant RNG substream moves.
 */
export const resolveCombatCommand = (input: CombatCommandInput): ResolveCombatResult => {
  try {
    if (
      !Value.Check(CombatStateSchema, input.state) ||
      !hasValidBattlefieldGridLengths(input.state.battlefield)
    ) {
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
  // Removed combatants and committed interactions accumulate across the batch
  // and are drained by the single ordered resolution pass.
  const accumulator: BatchAccumulator = { removedCombatantIds: [], committedInteractionKeys: [] };

  switch (command.kind) {
    case 'move': {
      const path = command.path;
      const opened = openReactionWindowForMove({
        state: next,
        combatantId: command.combatantId,
        commandId: `move:${command.combatantId}:${revision}`,
        path,
        envelope,
        events,
        accumulator,
      });
      if (!opened) {
        commitMoveCells({
          state: next,
          combatantId: command.combatantId,
          cells: path,
          envelope,
          events,
        });
      }
      break;
    }

    case 'retreat': {
      const path = command.path;
      const opened = openReactionWindowForMove({
        state: next,
        combatantId: command.combatantId,
        commandId: `retreat:${command.combatantId}:${revision}`,
        path,
        envelope,
        events,
        accumulator,
      });
      if (!opened) {
        commitMoveCells({
          state: next,
          combatantId: command.combatantId,
          cells: path,
          envelope,
          events,
        });
      }
      // The declared withdrawal is recorded even when a reaction suspends the
      // path: the actor is retreating from the moment it declares one.
      const response = authoredMoraleResponse(next.moraleRules, 'retreat');
      if (response !== null && response.exitZoneId !== null) {
        const mover = next.combatants[command.combatantId];
        const participation = next.participation[command.combatantId];
        const arrived = isInExitZone({
          rules: next.moraleRules,
          exitZoneId: response.exitZoneId,
          cell: mover.position,
        });
        const status: 'escaped' | 'retreating' = arrived ? 'escaped' : 'retreating';
        if (participation !== undefined && participation.status !== status) {
          next.participation[command.combatantId] = { ...participation, status };
          events.push({
            ...envelope,
            kind: 'participationChanged',
            combatantId: command.combatantId,
            status,
            reasonCode: arrived ? 'reached_exit_zone' : 'declared_retreat',
          });
        }
      }
      break;
    }

    case 'surrender': {
      const participation = next.participation[command.combatantId];
      if (participation !== undefined && participation.status !== 'surrendered') {
        // HP, identity and the initiative slot are preserved: surrender is
        // never represented as `hp = 0` or `defeated = true`.
        next.participation[command.combatantId] = { ...participation, status: 'surrendered' };
        events.push({
          ...envelope,
          kind: 'participationChanged',
          combatantId: command.combatantId,
          status: 'surrendered',
          reasonCode: 'accepted_surrender',
        });
      }
      break;
    }

    case 'resolveReaction': {
      resolveReactionWindowCommand({
        state: next,
        command,
        envelope,
        events,
        accumulator,
      });
      break;
    }

    case 'useAbility': {
      const ability = next.abilityCatalog[command.abilityId];
      if (ability.actionCost === 'action') {
        actor.budget.actionAvailable = false;
      } else if (ability.actionCost === 'quick') {
        actor.budget.quickActionAvailable = false;
      } else if (ability.actionCost === 'reaction') {
        // An accepted legal reaction consumes one reaction whether it hits or
        // misses. Contract: C-532 AC-3.
        actor.budget.reactionAvailable = false;
      }

      const isAttack = ability.kind === 'melee_attack' || ability.kind === 'ranged_attack';
      if (isAttack) {
        const actionsRng = deserializeRng(next.rng.streams.actions);
        for (const targetId of command.targetIds) {
          const target = next.combatants[targetId];
          const naturalRoll = actionsRng.dice(20);
          const totalRoll = naturalRoll + actor.attackBonus + ability.attackBonus;
          // C-531: cover is derived from immutable terrain plus CURRENT object
          // state, so a destroyed cover object stops protecting on the very
          // next attack. Contract: C-531 AC-3.
          const effectiveArmorClass =
            target.armorClass +
            coverArmorClassBonus({
              state: next,
              attacker: actor.position,
              target: target.position,
            });
          const hit = resolveHit(naturalRoll, totalRoll, effectiveArmorClass);
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
            accumulator.removedCombatantIds.push(targetId);
          }
        }
        next.rng = {
          ...next.rng,
          streams: { ...next.rng.streams, actions: serializeRng(actionsRng) },
        };
      }

      break;
    }

    case 'interactWithObject': {
      // A legal attempted check consumes its declared cost even when the roll
      // fails; an invalid command consumes neither resources nor RNG.
      // Contract: C-531 AC-2.
      const actionsRng = deserializeRng(next.rng.streams.actions);
      const environmental = applyEnvironmentalCommand({
        state: next,
        actorId: command.combatantId,
        command,
        envelope,
        rng: actionsRng,
      });
      if (!environmental.ok) {
        return failure(environmental.reasonCode);
      }
      next.rng = {
        ...next.rng,
        streams: { ...next.rng.streams, actions: serializeRng(actionsRng) },
      };
      for (const event of environmental.events) {
        events.push(event);
      }
      // A spent FAILED environmental check does not complete the interaction;
      // only a successful completion is an objective fact. The check is not
      // rolled again — its result is read from the committed event.
      // Contract: C-532 AC-1.
      const checkFailed = environmental.events.some(
        (event) => event.kind === 'environmentalCheckRolled' && !event.success,
      );
      if (!checkFailed) {
        accumulator.committedInteractionKeys.push(
          interactionKey(command.combatantId, command.objectId, command.affordanceId),
        );
      }
      for (const event of environmental.events) {
        if (event.kind === 'combatantDefeated') {
          accumulator.removedCombatantIds.push(event.combatantId);
        }
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
      let advance = advanceTurn(next);
      if (advance !== null) {
        // Surface expiry and hazard cadence are explicit round-boundary rules.
        // Contract: C-531 AC-3.
        if (advance.round > round) {
          const roundEnvelope = {
            encounterId: next.encounterId,
            turnId: advance.turnId,
            stateRevision: revision,
            round: advance.round,
          };
          const roundRng = deserializeRng(next.rng.streams.actions);
          const roundEvents = applyEnvironmentalRoundStart({
            state: next,
            envelope: roundEnvelope,
            rng: roundRng,
          });
          if (roundEvents.length > 0) {
            next.rng = {
              ...next.rng,
              streams: { ...next.rng.streams, actions: serializeRng(roundRng) },
            };
          }
          events.push(...roundEvents);
          for (const event of roundEvents) {
            if (event.kind === 'combatantDefeated') {
              accumulator.removedCombatantIds.push(event.combatantId);
            }
          }

          // Round boundary: objective evaluation runs here, after the batch's
          // committed effects. Contract: C-532 AC-1.
          const roundSettled = runResolutionPass({
            state: next,
            envelope: roundEnvelope,
            events,
            accumulator,
          });
          if (roundSettled) {
            break;
          }

          if (next.combatants[advance.combatantId]?.defeated === true) {
            advance = advanceTurn(next);
          }
        }
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
      }
      break;
    }

    default:
      return failure('invalidCommandShape');
  }

  // Steps 4–6 run once per committed command, after every effect batch. A
  // settlement already committed by the round-boundary pass makes this a
  // no-op. Contract: C-532 AC-1, AC-2, AC-5.
  if (next.settlement === null && next.phase !== 'reaction') {
    runResolutionPass({ state: next, envelope, events, accumulator });
  }

  next.stateRevision = revision;
  return { valid: true, state: next, events };
};

/**
 * Commits the party-level FLEE exit as a terminal `escape` settlement.
 *
 * FLEE is not an ordinary command: it is the whole party disengaging, so it is
 * legal on ANY turn (the client may click Flee while an AI actor is active).
 * The kernel marks every still-contesting friendly combatant `escaped` and runs
 * the SAME ordered resolution pass an ordinary command uses, so the encounter
 * settles as `escape` with full participation events — never as a defeat, and
 * never by bypassing the settlement/environment rules. Contract: C-532 AC-5.
 */
export const resolvePartyEscape = (input: {
  state: CombatState;
  basedOnRevision?: number;
}): ResolveCombatResult => {
  try {
    if (
      !Value.Check(CombatStateSchema, input.state) ||
      !hasValidBattlefieldGridLengths(input.state.battlefield)
    ) {
      return failure('invalidStateShape');
    }
  } catch {
    return failure('invalidStateShape');
  }

  const state = input.state;
  if (input.basedOnRevision !== undefined && input.basedOnRevision !== state.stateRevision) {
    return failure('staleRevision');
  }
  if (state.phase === 'ended') {
    return failure('encounterEnded');
  }

  let next: CombatState;
  try {
    next = cloneValue(state);
  } catch {
    return failure('invalidStateShape');
  }

  const revision = next.stateRevision + 1;
  const activeId = next.initiative.order[next.initiative.activeIndex] ?? 'party';
  const turnId = next.turnId ?? turnIdFor(next.round, activeId);
  const envelope = {
    encounterId: next.encounterId,
    turnId,
    stateRevision: revision,
    round: next.round,
  };
  const events: CombatEvent[] = [];
  const accumulator: BatchAccumulator = { removedCombatantIds: [], committedInteractionKeys: [] };

  let marked = false;
  for (const combatant of Object.values(next.combatants)) {
    if (combatant.team !== 'player' && combatant.team !== 'ally') {
      continue;
    }
    const participation = next.participation[combatant.combatantId];
    if (participation === undefined || participation.status === 'escaped') {
      continue;
    }
    next.participation[combatant.combatantId] = { ...participation, status: 'escaped' };
    marked = true;
    events.push({
      ...envelope,
      kind: 'participationChanged',
      combatantId: combatant.combatantId,
      status: 'escaped',
      reasonCode: 'declared_retreat',
    });
  }
  if (!marked) {
    return failure('encounterEnded');
  }

  runResolutionPass({ state: next, envelope, events, accumulator });
  if (next.settlement === null) {
    return failure('encounterEnded');
  }

  next.stateRevision = revision;
  return { valid: true, state: next, events };
};
