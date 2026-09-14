// packages/frontend/engine/src/combat/combat_ai_decision.ts
//
// AI decision pipeline (Combat-06).
//
// `produceAiCombatDecision` is the AI counterpart of the player's
// submit → interpret → compile → confirm flow, minus the human:
//
//   1. project the current kernel state;
//   2. ask the injected decision service (when enabled) for a decision;
//   3. execute the decision ONE STEP AT A TIME — each step is grounded by the
//      C-525 compiler against the CURRENT revision and committed through
//      `commitV2KernelCommand`, then the next step is re-grounded against the
//      new revision. Step two is never precompiled against step one's
//      pre-commit state.
//
// Any failure — flag off, provider offline, timeout, invalid output, a stale
// revision, an illegal step — falls back to the deterministic
// `chooseV2AiCommand`, and a fallback that is itself rejected ends the turn.
// The model never supplies ids, coordinates, dice or HP, and never mutates
// state: it only picks selectors, and the kernel re-validates every commit.
//
// Contract: C-526 AC-4, AC-5 (grounding), AC-7, AC-9

import { AiCombatDecisionSchema, COMBAT_AI_BOUNDS } from '@aikami/schemas';
import type {
  AiCombatDecision,
  CombatAbilityDefinition,
  CombatAiDecisionRecord,
  CombatAiDegradedReason,
  CombatCommand,
  CombatDecisionContext,
  CombatEvent,
  CombatState,
  IntentStep,
} from '@aikami/types';
import { compileActionIntent } from '@aikami/utils';
import type { World } from 'bitecs';
import { Value } from 'typebox/value';
import { logger } from '$logger';
import type { EngineBridge } from '../engine_bridge.ts';
import type { CombatDecisionPolicy } from './combat_ai_perception.ts';
import { authoredTelegraphForCommand, buildCombatDecisionContext } from './combat_ai_perception.ts';
import { getActiveTurn } from './combat_turn_driver.ts';
import { chooseV2AiCommand } from './combat_v2_ai.ts';
import {
  buildV2CombatState,
  commitV2KernelCommand,
  DEFAULT_BASIC_ATTACK_ABILITY_ID,
} from './combat_v2_resolver.ts';

// ---------------------------------------------------------------------------
// Injected decision service contract
// ---------------------------------------------------------------------------

/** What the engine hands the decision service. */
export type AiDecisionRequest = {
  context: CombatDecisionContext;
  signal?: AbortSignal;
};

/** What the service answers — always resolved, never thrown. */
export type AiDecisionResponse =
  | {
      ok: true;
      decision: AiCombatDecision;
      latencyMs: number;
      provider?: string;
      model?: string;
    }
  | {
      ok: false;
      reason: CombatAiDegradedReason;
      latencyMs: number;
      provider?: string;
      model?: string;
    };

/** The injected `combat_ai_service.svelte.ts#decide` capability. */
export type AiCombatDecider = (request: AiDecisionRequest) => Promise<AiDecisionResponse>;

// ---------------------------------------------------------------------------
// Outcome
// ---------------------------------------------------------------------------

export type AiCombatDecisionOutcome = {
  source: 'llm' | 'fallback';
  /** Every command the pipeline committed, in order. */
  commands: CombatCommand[];
  stepsExecuted: number;
  /** True when the decision's intent could not be fully executed. */
  partial: boolean;
  degradedReason?: CombatAiDegradedReason;
  /** Bounded, presentation-safe intention line (AC-7). */
  telegraph?: string;
  record: CombatAiDecisionRecord;
};

export type ProduceAiCombatDecisionOptions = {
  world: World;
  bridge: EngineBridge;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  /** The AI combatant whose turn this is. */
  combatantId: string;
  /** Player runtime eid — never AI-driven; guards a turn that moved on. */
  playerEntityId?: number;
  abilityIdsByCombatant?: Record<string, string[]>;
  basicAttackAbilityId?: string;
  /** Character policy for the perception snapshot (AC-8). */
  policy?: CombatDecisionPolicy;
  /** Resolved kernel events, for the bounded recent-events section. */
  recentEvents?: readonly CombatEvent[];
  /** The pinned encounter flag. Off ⇒ deterministic AI only (AC-9). */
  llmEnabled: boolean;
  /** The decision service; absent ⇒ deterministic AI only. */
  decide?: AiCombatDecider;
  /** Client-minted decision id. */
  decisionId?: string;
  /** Hard deadline for the model call; defaults to the §18 4 s budget. */
  hardDeadlineMs?: number;
  /**
   * When supplied, a decision produced against a different revision is
   * discarded as stale instead of being re-grounded (prefetch discipline,
   * AC-5).
   */
  requireRevision?: number;
  /** Maximum steps to execute from one decision; defaults to the step bound. */
  maxSteps?: number;
  onDegraded?: (event: { actorId: string; reason: CombatAiDegradedReason }) => void;
  onRecord?: (record: CombatAiDecisionRecord) => void;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_HARD_DEADLINE_MS = 4000;

const TIMED_OUT: unique symbol = Symbol('combat-ai-decision-timeout');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Projects the live kernel state, or `undefined` when unavailable. */
const projectState = (options: {
  world: World;
  abilityCatalog: Record<string, CombatAbilityDefinition>;
  abilityIdsByCombatant?: Record<string, string[]>;
}): CombatState | undefined =>
  buildV2CombatState({
    world: options.world,
    abilityCatalog: options.abilityCatalog,
    ...(options.abilityIdsByCombatant === undefined
      ? {}
      : { abilityIdsByCombatant: options.abilityIdsByCombatant }),
  }) ?? undefined;

/** Whether `combatantId` is still the active, living combatant. */
const isStillActive = (state: CombatState, combatantId: string): boolean => {
  if (state.phase === 'ended') {
    return false;
  }
  const actor = state.combatants[combatantId];
  if (actor === undefined || actor.defeated) {
    return false;
  }
  return state.initiative.order[state.initiative.activeIndex] === combatantId;
};

/**
 * Races a decision call against the hard deadline.
 *
 * A timeout, an abort and a provider rejection are all the same failure to the
 * caller: fall back deterministically (AC-4, AC-9).
 */
const requestDecision = async (options: {
  decide: AiCombatDecider;
  context: CombatDecisionContext;
  hardDeadlineMs: number;
}): Promise<AiDecisionResponse | typeof TIMED_OUT> => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, options.hardDeadlineMs);
  try {
    return await new Promise<AiDecisionResponse | typeof TIMED_OUT>((resolve) => {
      const onAbort = (): void => {
        resolve(TIMED_OUT);
      };
      controller.signal.addEventListener('abort', onAbort, { once: true });
      options
        .decide({ context: options.context, signal: controller.signal })
        .then(
          (response) => {
            resolve(controller.signal.aborted ? TIMED_OUT : response);
          },
          () => {
            resolve(TIMED_OUT);
          },
        )
        .finally(() => {
          controller.signal.removeEventListener('abort', onAbort);
        });
    });
  } finally {
    clearTimeout(timer);
  }
};

/** The single-step intent envelope for one step of a decision. */
const stepIntent = (options: {
  decisionId: string;
  encounterId: string;
  actorId: string;
  revision: number;
  step: IntentStep;
  index: number;
}) => ({
  intentId: `${options.decisionId}:step-${options.index + 1}`.slice(
    0,
    COMBAT_AI_BOUNDS.decisionIdChars,
  ),
  encounterId: options.encounterId,
  actorId: options.actorId,
  basedOnRevision: options.revision,
  source: 'ai_decision' as const,
  steps: [options.step],
});

// ---------------------------------------------------------------------------
// produceAiCombatDecision
// ---------------------------------------------------------------------------

/**
 * Produces and executes one AI turn.
 *
 * Always resolves with an outcome; never throws and never leaves the turn
 * wedged. When no legal command exists at all, the outcome carries no commands
 * and the turn driver ends the turn.
 */
export const produceAiCombatDecision = async (
  options: ProduceAiCombatDecisionOptions,
): Promise<AiCombatDecisionOutcome> => {
  const { world, bridge, abilityCatalog, combatantId } = options;
  const basicAttackAbilityId = options.basicAttackAbilityId ?? DEFAULT_BASIC_ATTACK_ABILITY_ID;
  const maxSteps = options.maxSteps ?? COMBAT_AI_BOUNDS.steps;
  const decisionId = options.decisionId ?? `ai:${combatantId}:${Date.now()}`;
  const startedAt = Date.now();

  const project = (): CombatState | undefined =>
    projectState({
      world,
      abilityCatalog,
      ...(options.abilityIdsByCombatant === undefined
        ? {}
        : { abilityIdsByCombatant: options.abilityIdsByCombatant }),
    });

  const state = project();
  if (state === undefined) {
    return {
      source: 'fallback',
      commands: [],
      stepsExecuted: 0,
      partial: false,
      degradedReason: 'stale',
      record: {
        decisionId,
        encounterId: 'unknown',
        actorId: combatantId,
        basedOnRevision: 0,
        source: 'fallback',
        latencyMs: Date.now() - startedAt,
        fallbackReason: 'stale',
      },
    };
  }

  const encounterId = state.encounterId;
  const basedOnRevision = state.stateRevision;
  const committed: CombatCommand[] = [];

  const record = (fields: {
    source: 'llm' | 'fallback';
    latencyMs: number;
    fallbackReason?: CombatAiDegradedReason;
    goal?: string;
    confidence?: AiCombatDecision['confidence'];
    rationale?: string;
    provider?: string;
    model?: string;
  }): CombatAiDecisionRecord => {
    const value: CombatAiDecisionRecord = {
      decisionId,
      encounterId,
      actorId: combatantId,
      basedOnRevision,
      source: fields.source,
      latencyMs: fields.latencyMs,
      ...(fields.fallbackReason === undefined ? {} : { fallbackReason: fields.fallbackReason }),
      ...(fields.goal === undefined ? {} : { goal: fields.goal }),
      ...(fields.confidence === undefined ? {} : { confidence: fields.confidence }),
      ...(fields.rationale === undefined ? {} : { rationale: fields.rationale }),
      ...(fields.provider === undefined ? {} : { provider: fields.provider }),
      ...(fields.model === undefined ? {} : { model: fields.model }),
    };
    options.onRecord?.(value);
    return value;
  };

  /** Commits the deterministic `chooseV2AiCommand` for the current state. */
  const runDeterministic = (reason?: CombatAiDegradedReason): AiCombatDecisionOutcome => {
    const current = project();
    if (current === undefined || !isStillActive(current, combatantId)) {
      return {
        source: 'fallback',
        commands: committed,
        stepsExecuted: committed.length,
        partial: committed.length > 0,
        ...(reason === undefined ? {} : { degradedReason: reason }),
        record: record({
          source: 'fallback',
          latencyMs: Date.now() - startedAt,
          ...(reason === undefined ? {} : { fallbackReason: reason }),
          rationale: 'deterministic fallback',
        }),
      };
    }
    const command = chooseV2AiCommand({
      state: current,
      combatantId,
      abilityCatalog,
      basicAttackAbilityId,
    });
    const resolved = commitV2KernelCommand({ world, bridge, state: current, command });
    if (resolved.ok) {
      committed.push(command);
    } else {
      logger.warn('[combat_ai_decision] deterministic fallback rejected', {
        combatantId,
        reasonCode: resolved.reasonCode,
      });
    }
    return {
      source: 'fallback',
      commands: committed,
      stepsExecuted: committed.length,
      partial: committed.length > 0,
      ...(reason === undefined ? {} : { degradedReason: reason }),
      telegraph: authoredTelegraphForCommand({ state: current, command }),
      record: record({
        source: 'fallback',
        latencyMs: Date.now() - startedAt,
        ...(reason === undefined ? {} : { fallbackReason: reason }),
        rationale: 'deterministic fallback',
      }),
    };
  };

  /** Compiles and commits one step against the current revision. */
  const commitStep = (step: IntentStep, index: number): boolean => {
    const current = project();
    if (current === undefined || !isStillActive(current, combatantId)) {
      return false;
    }
    const compiled = compileActionIntent({
      state: current,
      intent: stepIntent({
        decisionId,
        encounterId,
        actorId: combatantId,
        revision: current.stateRevision,
        step,
        index,
      }),
    });
    if (!compiled.ok || compiled.kind !== 'plan') {
      return false;
    }
    const resolved = commitV2KernelCommand({
      world,
      bridge,
      state: current,
      command: compiled.plan.command,
    });
    if (!resolved.ok) {
      return false;
    }
    committed.push(compiled.plan.command);
    return true;
  };

  /** Tries the decision's fallback steps, first legal one wins. */
  const runFallbackSteps = (fallbackSteps: readonly IntentStep[]): boolean => {
    for (let index = 0; index < fallbackSteps.length; index++) {
      const step = fallbackSteps[index];
      if (step === undefined) {
        continue;
      }
      if (commitStep(step, index)) {
        return true;
      }
    }
    return false;
  };

  // ── Flag off: the pinned kill switch (AC-9) ──────────────────────────
  if (!options.llmEnabled) {
    options.onDegraded?.({ actorId: combatantId, reason: 'disabled' });
    return runDeterministic('disabled');
  }

  if (options.decide === undefined) {
    options.onDegraded?.({ actorId: combatantId, reason: 'offline' });
    return runDeterministic('offline');
  }

  const context = buildCombatDecisionContext({
    state,
    combatantId,
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.recentEvents === undefined ? {} : { recentEvents: options.recentEvents }),
  });
  if (context === undefined) {
    return runDeterministic('stale');
  }

  // ── Prefetch revision discipline (AC-5) ──────────────────────────────
  if (options.requireRevision !== undefined && options.requireRevision !== basedOnRevision) {
    options.onDegraded?.({ actorId: combatantId, reason: 'stale' });
    return runDeterministic('stale');
  }

  const response = await requestDecision({
    decide: options.decide,
    context,
    hardDeadlineMs: options.hardDeadlineMs ?? DEFAULT_HARD_DEADLINE_MS,
  });

  if (response === TIMED_OUT) {
    options.onDegraded?.({ actorId: combatantId, reason: 'timeout' });
    return runDeterministic('timeout');
  }
  if (!response.ok) {
    options.onDegraded?.({ actorId: combatantId, reason: response.reason });
    return runDeterministic(response.reason);
  }
  if (!Value.Check(AiCombatDecisionSchema, response.decision)) {
    options.onDegraded?.({ actorId: combatantId, reason: 'invalid' });
    return runDeterministic('invalid');
  }
  if (response.decision.actorId !== combatantId || response.decision.encounterId !== encounterId) {
    options.onDegraded?.({ actorId: combatantId, reason: 'invalid' });
    return runDeterministic('invalid');
  }

  const decision = response.decision;
  const goal = decision.goal;
  const confidence = decision.confidence;
  const rationale = decision.shortReason;

  // ── Step-wise execution (AC-4) ───────────────────────────────────────
  const intentSteps = decision.intent.slice(0, maxSteps);
  let partial = decision.intent.length > intentSteps.length;
  let telegraph = decision.proposedLine;

  for (let index = 0; index < intentSteps.length; index++) {
    const step = intentSteps[index];
    if (step === undefined) {
      break;
    }
    if (commitStep(step, index)) {
      continue;
    }
    // The step became illegal or stale: fall back for the WHOLE remaining
    // intent — the decision's own fallback first, then the deterministic AI.
    logger.info('[combat_ai_decision] step not legal at commit time', {
      combatantId,
      stepIndex: index,
    });
    const fellBack = runFallbackSteps(decision.fallback);
    if (!fellBack) {
      partial = true;
      commitStep({ kind: 'end_turn' }, index);
    }
    break;
  }

  const firstCommand = committed[0];
  if (telegraph === undefined && firstCommand !== undefined) {
    const current = project();
    telegraph = authoredTelegraphForCommand({
      state: current ?? state,
      command: firstCommand,
    });
  }

  const outcome: AiCombatDecisionOutcome = {
    source: 'llm',
    commands: committed,
    stepsExecuted: committed.length,
    partial,
    record: record({
      source: 'llm',
      latencyMs: response.latencyMs,
      goal,
      confidence,
      ...(rationale === undefined ? {} : { rationale }),
      ...(response.provider === undefined ? {} : { provider: response.provider }),
      ...(response.model === undefined ? {} : { model: response.model }),
    }),
  };
  if (telegraph !== undefined) {
    outcome.telegraph = telegraph;
  }
  return outcome;
};

// ---------------------------------------------------------------------------
// Degradation de-duplication (AC-7)
// ---------------------------------------------------------------------------

/**
 * De-duplicates `COMBAT_AI_DEGRADED` per `(actor, reason)` within an encounter.
 *
 * The contract requires degradation to be reported once per actor and reason,
 * not once per action, so the log is not spammed. `reset()` is called when a
 * new encounter starts.
 */
export type CombatAiDegradedEmitter = {
  emit(event: { actorId: string; reason: CombatAiDegradedReason }): void;
  reset(): void;
};

export const createDegradedEmitter = (options: {
  onDegraded: (event: { actorId: string; reason: CombatAiDegradedReason }) => void;
}): CombatAiDegradedEmitter => {
  const seen = new Set<string>();
  return {
    emit(event) {
      const key = `${event.actorId}:${event.reason}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      options.onDegraded(event);
    },
    reset() {
      seen.clear();
    },
  };
};

// ---------------------------------------------------------------------------
// Turn-driver integration
// ---------------------------------------------------------------------------

/**
 * Runs an AI combatant's whole turn through the decision pipeline.
 *
 * A thin async wrapper the turn driver calls in place of `runV2AiTurns` when
 * the flag is pinned on: it produces one decision and commits its steps, then
 * ends the turn if the actor still holds it (a move does not end a turn).
 */
export const runV2AiTurnWithDecision = async (
  options: ProduceAiCombatDecisionOptions,
): Promise<AiCombatDecisionOutcome> => {
  const outcome = await produceAiCombatDecision(options);
  const { world, bridge, combatantId } = options;
  const state = projectState({
    world,
    abilityCatalog: options.abilityCatalog,
    ...(options.abilityIdsByCombatant === undefined
      ? {}
      : { abilityIdsByCombatant: options.abilityIdsByCombatant }),
  });
  if (state !== undefined && isStillActive(state, combatantId)) {
    const active = getActiveTurn(world);
    if (active !== null && active.combatantId === combatantId) {
      commitV2KernelCommand({
        world,
        bridge,
        state,
        command: { kind: 'endTurn', combatantId },
      });
    }
  }
  return outcome;
};

export type { CombatDecisionPolicy };
/** Re-exported so the worker can wire the same projection the pipeline uses. */
export { buildV2CombatState };

// ---------------------------------------------------------------------------
// Bridge emission (AC-7, AC-9)
// ---------------------------------------------------------------------------

/**
 * Publishes the user-visible outcome of one AI decision.
 *
 * Separated from `produceAiCombatDecision` so the pure pipeline stays testable
 * without a bridge, and so the caller owns de-duplication: pass an emitter from
 * {@link createDegradedEmitter} to honour the once-per-actor-and-reason rule.
 */
export const emitCombatAiOutcome = (options: {
  bridge: EngineBridge;
  encounterId: string;
  actorId: string;
  outcome: AiCombatDecisionOutcome;
  onDegraded?: (event: { actorId: string; reason: CombatAiDegradedReason }) => void;
}): void => {
  if (options.outcome.telegraph !== undefined && options.outcome.telegraph.length > 0) {
    options.bridge.emit({
      type: 'COMBAT_INTENT_TELEGRAPHED',
      encounterId: options.encounterId,
      actorId: options.actorId,
      line: options.outcome.telegraph,
    });
  }
  const reason = options.outcome.degradedReason;
  if (reason === undefined) {
    return;
  }
  if (options.onDegraded !== undefined) {
    options.onDegraded({ actorId: options.actorId, reason });
    return;
  }
  options.bridge.emit({
    type: 'COMBAT_AI_DEGRADED',
    encounterId: options.encounterId,
    actorId: options.actorId,
    reason,
  });
};
