// apps/frontend/client/src/lib/views/dev/combat/inspector/combat_debug_inspector_selectors.ts
//
// Domain-state selectors for the combat debug inspector. These read the
// authoritative `CombatState` directly — encounter context, live environment /
// objectives, the open reaction window, and the development assertions — and
// project it into plain readonly data. Kept separate from the entry module so
// the environment/objective/reaction domain shapes stay in one cohesive unit.
//
// Pure by construction: no `$services`, no runes, no DOM, no network, no clock.
// Selectors detect and describe; they never repair state.
//
// Contract: combat debug workspace (execution prompt §3, §5)

import type {
  BattlefieldObject,
  CombatEvent,
  CombatObjectiveState,
  CombatPhase,
  CombatState,
  EnvironmentalState,
  ReactionState,
  ReactionWindow,
} from '@aikami/types';
import { parseActiveCombatantId } from '../session/combat_debug_live_session.ts';
import type {
  CombatDebugAcceptedCommandRecord,
  CombatDebugAssertionViolation,
} from '../types/combat_debug_types.ts';

// ---------------------------------------------------------------------------
// Context tab
// ---------------------------------------------------------------------------

/** One named RNG substream as the context tab renders it. */
export type CombatDebugRngStreamSummary = {
  readonly name: string;
  readonly seed: number;
  readonly state: number;
};

/** A flat, plain-data projection of the encounter-level context. */
export type CombatDebugContextSummary = {
  readonly runId: string;
  readonly encounterId: string;
  readonly rulesVersion: string;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly round: number;
  readonly turnId: string | undefined;
  readonly phase: CombatPhase;
  readonly activeCombatantId: string | undefined;
  readonly seed: number;
  readonly rngStreams: readonly CombatDebugRngStreamSummary[];
  readonly settlementPresent: boolean;
  readonly outcomePresent: boolean;
};

/**
 * Projects the encounter-level context (identity, revision, phase, active
 * actor, RNG substreams) into one flat record. RNG substreams are enumerated
 * from the pinned `state.rng.streams` record and sorted by name so the panel
 * order is stable regardless of insertion order.
 */
export const buildCombatDebugContext = (state: CombatState): CombatDebugContextSummary => {
  const rngStreams: CombatDebugRngStreamSummary[] = Object.entries(state.rng.streams)
    .map(([name, stream]) => ({ name, seed: stream.seed, state: stream.state }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    runId: state.encounterRunId,
    encounterId: state.encounterId,
    rulesVersion: state.rulesVersion,
    schemaVersion: state.schemaVersion,
    revision: state.stateRevision,
    round: state.round,
    turnId: state.turnId === null ? undefined : state.turnId,
    phase: state.phase,
    activeCombatantId: parseActiveCombatantId(state.turnId),
    seed: state.rng.seed,
    rngStreams,
    settlementPresent: state.settlement !== null,
    outcomePresent: state.outcome !== null,
  };
};

// ---------------------------------------------------------------------------
// Objects / objectives tab
// ---------------------------------------------------------------------------

/** One live battlefield object plus its per-affordance availability. */
export type CombatDebugObjectSummary = {
  readonly objectId: string;
  readonly definitionId: string;
  readonly state: BattlefieldObject['state'];
  readonly affordances: readonly {
    readonly affordanceId: string;
    readonly available: boolean;
  }[];
};

/** One objective record projected from the live state. */
export type CombatDebugObjectiveRow = {
  readonly objectiveId: string;
  readonly kind: string;
  readonly progress: number;
  readonly deadlineRound: number | undefined;
  readonly required: boolean;
  readonly satisfied: boolean | undefined;
};

/** The objects/objectives tab projection. */
export type CombatDebugObjectsSummary = {
  readonly objects: readonly CombatDebugObjectSummary[];
  readonly objectives: readonly CombatDebugObjectiveRow[];
};

/**
 * Live-object affordances are derived, not stored: `BattlefieldObject` carries
 * `affordanceIds` but no availability map. Availability is "the object is
 * intact AND the definition is in the pinned bundle AND the affordance exists
 * in that definition and the bundle". A definition missing from the bundle is
 * unavailable rather than optimistically assumed usable.
 */
const projectObjectAffordances = (options: {
  state: CombatState;
  object: BattlefieldObject;
}): CombatDebugObjectSummary['affordances'] => {
  const { state, object } = options;
  const bundleDefinition = state.environmentBundle.objectDefinitions[object.definitionId];
  return object.affordanceIds.map((affordanceId) => ({
    affordanceId,
    available:
      object.state === 'intact' &&
      bundleDefinition !== undefined &&
      bundleDefinition.affordanceIds.includes(affordanceId) &&
      state.environmentBundle.affordances[affordanceId] !== undefined,
  }));
};

/**
 * `CombatObjectiveState` carries only `{objectiveId, kind: string, status,
 * progress}` — it has no `deadlineRound`, `required` or `satisfied` field. The
 * authored `ObjectiveDefinition` in `state.objectiveRules` supplies `required`
 * and, for the `interact_before_deadline` primitive, `deadlineRound`. An
 * objective with no matching definition projects `required: false` and
 * `deadlineRound: undefined`, and `satisfied` is `undefined` unless a
 * definitively complete objective is observed (a `failed` objective is never
 * "satisfied").
 */
const projectObjectiveRow = (options: {
  state: CombatState;
  objective: CombatObjectiveState;
}): CombatDebugObjectiveRow => {
  const { state, objective } = options;
  const definition = state.objectiveRules.definitions.find(
    (candidate) => candidate.objectiveId === objective.objectiveId,
  );
  const deadlineRound =
    definition?.rule.kind === 'interact_before_deadline'
      ? definition.rule.deadlineRound
      : undefined;

  return {
    objectiveId: objective.objectiveId,
    kind: objective.kind,
    progress: objective.progress,
    deadlineRound,
    required: definition?.required ?? false,
    satisfied: objective.status === 'complete' ? true : undefined,
  };
};

/**
 * Projects the environmental objects (with derived affordance availability) and
 * every objective record. Objects keep their record key order; objectives keep
 * the authored array order so the panel is replay-stable.
 */
export const buildCombatDebugObjectsSummary = (state: CombatState): CombatDebugObjectsSummary => {
  const environment: EnvironmentalState = state.environment;
  const objects: CombatDebugObjectSummary[] = Object.entries(environment.objects).map(
    ([objectId, object]) => ({
      objectId,
      definitionId: object.definitionId,
      state: object.state,
      affordances: projectObjectAffordances({ state, object }),
    }),
  );

  return {
    objects,
    objectives: state.objectives.map((objective) => projectObjectiveRow({ state, objective })),
  };
};

// ---------------------------------------------------------------------------
// Reactions tab
// ---------------------------------------------------------------------------

/**
 * The open reaction window projection.
 *
 * The requested `trigger` / `policy` fields do not exist verbatim on the wire:
 * the window names its registered reaction via `reactionId`, and the reacting
 * actor's policy lives on `ParticipationState.reactionPolicy` (resolved as the
 * current reactor's policy, falling back to the mover's). `orderedReactors` is
 * the window's `reactorQueue`, which the kernel already orders by initiative
 * desc then stable id asc.
 */
export type CombatDebugReactionSummary = {
  readonly windowId: string | undefined;
  readonly trigger: string | undefined;
  readonly currentReactorId: string | undefined;
  readonly windowVersion: number | undefined;
  readonly orderedReactors: readonly string[];
  readonly policy: string | undefined;
};

/**
 * Projects the first open reaction window. `state.reaction.windows` is bounded
 * and nesting is capped at one in this release, so the first window is the
 * active one; an empty array projects an all-`undefined` summary rather than
 * dropping the tab.
 */
export const buildCombatDebugReactionSummary = (state: CombatState): CombatDebugReactionSummary => {
  const reaction: ReactionState = state.reaction;
  const window: ReactionWindow | undefined = reaction.windows[0];
  if (!window) {
    return {
      windowId: undefined,
      trigger: undefined,
      currentReactorId: undefined,
      windowVersion: undefined,
      orderedReactors: [],
      policy: undefined,
    };
  }

  const currentReactorId = window.currentReactorId ?? undefined;
  const policySource = currentReactorId ?? window.moverId;
  const policy = state.participation[policySource]?.reactionPolicy;

  return {
    windowId: window.windowId,
    trigger: window.reactionId,
    currentReactorId,
    windowVersion: window.version,
    orderedReactors: [...window.reactorQueue],
    policy,
  };
};

// ---------------------------------------------------------------------------
// Development assertions
// ---------------------------------------------------------------------------

/** Options for {@link evaluateCombatDebugAssertions}. */
export type EvaluateCombatDebugAssertionsOptions = {
  readonly state: CombatState;
  /** Revision observed before this state; the monotonicity baseline. */
  readonly previousRevision: number;
  /** Full committed event history observed for this run. */
  readonly events: readonly CombatEvent[];
  /** Accepted-command metadata correlated by the live observer. */
  readonly acceptedCommands: readonly CombatDebugAcceptedCommandRecord[];
};

/** Detects combatants whose budget or HP left the schema's legal envelope. */
const collectBudgetBoundViolations = (state: CombatState): CombatDebugAssertionViolation[] => {
  const violations: CombatDebugAssertionViolation[] = [];
  for (const [combatantId, combatant] of Object.entries(state.combatants)) {
    if (combatant.budget.movementRemaining < 0) {
      violations.push({
        assertion: 'budget-bounds',
        detail: `Combatant "${combatantId}" has movementRemaining ${combatant.budget.movementRemaining} (must be >= 0).`,
        revision: state.stateRevision,
        commandId: undefined,
      });
    }
    const hpInBounds = combatant.hp >= 0 && combatant.hp <= combatant.maxHp;
    if (!hpInBounds && !combatant.downed) {
      violations.push({
        assertion: 'budget-bounds',
        detail: `Combatant "${combatantId}" has hp ${combatant.hp} outside [0, ${combatant.maxHp}] while not downed.`,
        revision: state.stateRevision,
        commandId: undefined,
      });
    }
  }
  return violations;
};

/**
 * Development assertions over a freshly observed state. Only checks that can be
 * implemented HONESTLY from the arguments are reported:
 *
 * - `monotonic-revision` — `state.stateRevision >= previousRevision`.
 * - `budget-bounds` — non-negative movement and in-range HP unless downed.
 * - `single-settlement` — settlement is terminal and emitted at most once.
 * - `no-ordinary-command-during-reaction` — an accepted ordinary command must
 *   not commit at the revision owned by an open reaction window.
 *
 * `snapshot-purity` is deliberately NOT reported: this function receives the
 * state by reference and cannot observe a pre-call snapshot without mutating or
 * re-serializing it, so any check would be a tautology rather than a detection.
 * Violations are returned, never repaired.
 */
export const evaluateCombatDebugAssertions = (
  options: EvaluateCombatDebugAssertionsOptions,
): readonly CombatDebugAssertionViolation[] => {
  const { state, previousRevision, events, acceptedCommands } = options;
  const violations: CombatDebugAssertionViolation[] = [];

  if (state.stateRevision < previousRevision) {
    violations.push({
      assertion: 'monotonic-revision',
      detail: `stateRevision ${state.stateRevision} is lower than the previously observed revision ${previousRevision}.`,
      revision: state.stateRevision,
      commandId: undefined,
    });
  }

  violations.push(...collectBudgetBoundViolations(state));

  if (state.settlement !== null && state.phase !== 'ended') {
    violations.push({
      assertion: 'single-settlement',
      detail: `Settlement "${state.settlement.settlementId}" present while phase is "${state.phase}" (expected "ended").`,
      revision: state.stateRevision,
      commandId: undefined,
    });
  }

  const settlementEvents = events.filter((event) => event.kind === 'encounterSettled');
  if (settlementEvents.length > 1) {
    violations.push({
      assertion: 'single-settlement',
      detail: `Observed ${settlementEvents.length} encounter settlement events; expected exactly one terminal settlement.`,
      revision: state.stateRevision,
      commandId: undefined,
    });
  }

  const ordinaryCommandDuringReaction = acceptedCommands.find(
    (command) =>
      command.commandType !== undefined &&
      command.commandType !== 'COMBAT_REACTION_SELECTED' &&
      command.stateRevision === state.stateRevision,
  );
  if (state.phase === 'reaction' && ordinaryCommandDuringReaction !== undefined) {
    violations.push({
      assertion: 'no-ordinary-command-during-reaction',
      detail: `An accepted command at revision ${state.stateRevision} coincides with an open reaction phase; a command committed during reaction suspension is a violation.`,
      revision: state.stateRevision,
      commandId: ordinaryCommandDuringReaction.commandId,
    });
  }

  return violations;
};
