// apps/frontend/client/src/lib/services/game/npc_action_decision_service.svelte.ts
//
// The opt-in consumer (issue #381, lane C).
//
// This is the ONE shipping call site for a decision backend. It exists because
// #381's acceptance criteria ask for "at least one actual enum/boolean call
// site implemented end-to-end", and because a decision subsystem that no
// gameplay path can reach is a foundation nobody will ever be able to retire.
//
// ---------------------------------------------------------------------------
// What it replaces, and what it does not
// ---------------------------------------------------------------------------
//
// It replaces the `command` half of the C-401 call-2 extraction: the field that
// asked a text LLM to compose a content-pack id out of prose. It does NOT
// replace call 2 itself — `choices` is generative (labels, authored dialogue
// keys) and no decision model produces it. The workload limitation is real and
// is stated in the report rather than hidden by quietly narrowing the claim.
//
// ---------------------------------------------------------------------------
// The rules this consumer is built to obey
// ---------------------------------------------------------------------------
//
//   - The turn's ONE absolute deadline is shared. The decision dispatch and the
//     fallback read the same `deadlineAt`; neither restarts it.
//   - A result for a turn that is no longer current is DISCARDED, never applied.
//   - `_validateCommandPreconditions` still runs over whatever comes back, and
//     `executeCommand` is still the only mutation owner. Narrowing the
//     reachable set is not the same as replacing the validator.
//   - The fallback runs AT MOST ONCE, and only when the decision abstained. A
//     decision that was ACCEPTED never triggers a retry of a mutation.
//   - Every attempt is recorded exactly once, and a backend's own attempt count
//     is copied rather than reconstructed.
//   - `off` is instantaneous and does not require a restart, a re-auth or a
//     reload of anything: the next turn takes the existing LLM path.

import { BaseFrontendClass, type BaseFrontendClassOptions } from '@aikami/frontend/services/base';
import {
  analyzeDecisionSchema,
  bindDecisionPolicy,
  buildDecisionDispatch,
  createDecisionPlanCache,
  type DecisionAdapter,
  type DecisionResult,
  runDecision,
} from '@aikami/frontend-ai-gateway/decision';
import {
  NPC_ACTION_NONE_ID,
  NPC_ACTION_SELECTION_TASK_ID,
  NPC_ACTION_SELECTION_TASK_VERSION,
  npcActionSelectionPolicy,
  npcActionSelectionSchema,
} from '@aikami/frontend-ai-gateway/decision/tasks';
import type { NpcDialogueCommand } from '@aikami/types';
import { adapterForBackend } from '../ai/decision/decision_backend_logic.ts';
import { decisionBackendService } from '../ai/decision_backend_service.svelte.ts';
import type { ResolvedDecisionBackend } from '../config/decision_backend_resolution.ts';
import {
  commandForActionId,
  enumerateNpcActionCandidates,
  type NpcActionCandidateInput,
  type NpcActionCandidateSet,
  optionDescriptionsFor,
} from './npc_action_candidates.ts';
import {
  hasFallbackBudget,
  isStaleNpcActionResult,
  type NpcActionAttempt,
  type NpcActionDecisionCapabilities,
  type NpcActionDecisionMode,
  type NpcActionDecisionRequest,
  type NpcActionQualification,
  type NpcActionResolution,
  resolveNpcActionRoute,
} from './npc_action_decision.ts';

export type NpcActionDecisionServiceInterface = {
  mode(): NpcActionDecisionMode;
  setMode(next: NpcActionDecisionMode): void;
  /** Enumerates this turn's candidates from world state. */
  candidatesFor(input: NpcActionCandidateInput): NpcActionCandidateSet;
  qualification(): NpcActionQualification;
  /** Dispatches one turn. Never throws for a backend failure. */
  resolve(request: NpcActionDecisionRequest): Promise<NpcActionResolution>;
  /** Whether the remaining budget permits the single fallback. */
  budgetAllowsFallback(deadlineAt: number): boolean;
  /** Drops in-flight results after a configuration change. */
  invalidate(): void;
};

/** Options accepted by {@link NpcActionDecisionService}. */
export type NpcActionDecisionServiceOptions = BaseFrontendClassOptions & {
  readonly capabilities?: Partial<NpcActionDecisionCapabilities>;
};

const UNQUALIFIED = (reason: string): NpcActionQualification => ({
  qualified: false,
  taskId: NPC_ACTION_SELECTION_TASK_ID,
  taskVersion: NPC_ACTION_SELECTION_TASK_VERSION,
  dialect: 'jev-v1',
  checkpoint: '',
  reason,
});

/**
 * The opt-in consumer for `npc-action-selection`.
 *
 * State is deliberately tiny: the mode the player chose, and a plan cache.
 * Everything that can go wrong is a function in `npc_action_decision.ts`; this
 * class only performs effects.
 */
class NpcActionDecisionService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements NpcActionDecisionServiceInterface
{
  /** Compiled plans are cached by schema content, so a repeated option set is
   * compiled once and a different one is a different plan. */
  private readonly _plans = createDecisionPlanCache();
  private _mode: NpcActionDecisionMode = 'off';
  /** Bumped on every configuration change; late results are dropped. */
  private _generation = 0;

  private readonly _caps: NpcActionDecisionCapabilities;

  constructor(options: NpcActionDecisionServiceOptions) {
    super(options);
    const injected = options.capabilities ?? {};
    this._caps = {
      resolveBackend: injected.resolveBackend ?? (() => decisionBackendService.resolve()),
      createAdapter: injected.createAdapter ?? adapterForBackend,
      readQualification:
        injected.readQualification ??
        // Qualification is read from the saved connection, never inferred. It
        // is false until a shipped measurement records a qualification for
        // THIS task, at THIS task version, for THIS checkpoint.
        ((backend) =>
          backend.qualifiedForGameplay
            ? {
                qualified: true,
                taskId: NPC_ACTION_SELECTION_TASK_ID,
                taskVersion: NPC_ACTION_SELECTION_TASK_VERSION,
                dialect: 'jev-v1',
                checkpoint: backend.checkpoint,
                reason: 'the saved connection is marked qualified for gameplay',
              }
            : UNQUALIFIED(
                'no measurement has qualified this checkpoint for npc-action-selection on held-out data',
              )),
    };
  }

  mode(): NpcActionDecisionMode {
    return this._mode;
  }

  /**
   * Switches the path.
   *
   * `off` takes effect on the NEXT turn with no restart and no reload: the
   * routing decision is made per turn, so this is the immediate rollback path.
   */
  setMode(next: NpcActionDecisionMode): void {
    if (this._mode === next) {
      return;
    }
    this._mode = next;
    this._generation += 1;
    this.info('npc action decision mode changed', { mode: next });
  }

  invalidate(): void {
    this._generation += 1;
  }

  qualification(): NpcActionQualification {
    const backend = this._caps.resolveBackend();
    if (backend === undefined) {
      return UNQUALIFIED('no decision backend is configured');
    }
    return this._caps.readQualification(backend);
  }

  candidatesFor(input: NpcActionCandidateInput): NpcActionCandidateSet {
    return enumerateNpcActionCandidates(input);
  }

  /**
   * Dispatches one turn.
   *
   * Returns a resolution the caller can act on WITHOUT knowing whether a
   * backend was involved. It never throws for a backend failure: an abstention
   * is a result, and the caller's fallback is the documented next step, not an
   * error path this method invents.
   */
  async resolve(request: NpcActionDecisionRequest): Promise<NpcActionResolution> {
    const { input, deadlineAt, signal, context } = request;
    const candidates = this.candidatesFor(input);
    const backend = this._caps.resolveBackend();
    const qualification =
      backend === undefined
        ? UNQUALIFIED('no decision backend is configured')
        : this._caps.readQualification(backend);

    const route = resolveNpcActionRoute({
      mode: this._mode,
      configured: backend !== undefined,
      qualification,
      taskId: NPC_ACTION_SELECTION_TASK_ID,
      candidates,
    });

    if (route.route === 'llm' || backend === undefined) {
      return {
        command: undefined,
        source: 'none',
        attempts: [{ source: 'llm', outcome: 'not-run', reason: route.reason }],
      };
    }

    // Capture the generation so a configuration change mid-flight drops the
    // result instead of answering the new configuration's question.
    const generation = this._generation;
    const optionIds = candidates.candidates.map((candidate) => candidate.id);
    const schema = npcActionSelectionSchema(optionIds);
    const policy = npcActionSelectionPolicy(optionIds, optionDescriptionsFor(candidates));

    const analyzed = this._plans.analyze({
      schema: schema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema cast for AI envelope or rAF polyfill
    });
    if (analyzed.analysis.ok !== true) {
      return {
        command: undefined,
        source: 'none',
        attempts: [
          { source: 'decision', outcome: 'rejected', reason: 'candidate set did not compile' },
        ],
      };
    }
    const bound = this._plans.bind({
      plan: analyzed.analysis.plan,
      policy,
      supportedLanguages: [...backend.languages],
    });
    if (bound.ok !== true) {
      return {
        command: undefined,
        source: 'none',
        attempts: [
          { source: 'decision', outcome: 'rejected', reason: 'candidate set did not bind' },
        ],
      };
    }

    const dispatched = buildDecisionDispatch({ plan: bound.plan, context });
    if (dispatched.ok !== true) {
      return {
        command: undefined,
        source: 'none',
        attempts: [{ source: 'decision', outcome: 'rejected', reason: dispatched.refusal.reason }],
      };
    }

    const started = Date.now();
    let result: DecisionResult;
    try {
      result = await runDecision({
        plan: bound.plan,
        schema: schema as unknown as Record<string, unknown>, // guard-ignore lint/type-safety/casting: TypeBox schema cast for AI envelope or rAF polyfill
        policy,
        adapter: this._caps.createAdapter(backend),
        context,
        ...(request.language === undefined ? {} : { language: request.language }),
        deadlineAt,
        signal,
        requestId: `npc-action:${request.staleness.turnSequence}`,
        stateRevision: request.staleness.stateRevision,
        planCacheHit: analyzed.cacheHit,
      });
    } catch (error) {
      return {
        command: undefined,
        source: 'none',
        attempts: [
          {
            source: 'decision',
            outcome: 'abstained',
            ms: Date.now() - started,
            reason: String(error),
          },
        ],
      };
    }

    // A result for a turn that has moved on is discarded, never applied. Both
    // the generation and the campaign/conversation/turn revision are checked.
    if (
      generation !== this._generation ||
      isStaleNpcActionResult(request.staleness, request.currentStaleness())
    ) {
      return {
        command: undefined,
        source: 'none',
        attempts: [
          {
            source: 'decision',
            outcome: 'rejected',
            ms: Date.now() - started,
            reason: 'stale turn discarded',
          },
        ],
      };
    }

    const attempt: NpcActionAttempt =
      result.ok === true
        ? { source: 'decision', outcome: 'accepted', ms: result.provenance.timings.totalMs }
        : {
            source: 'decision',
            outcome: 'abstained',
            ms: result.provenance.timings.totalMs,
            reason: result.reason,
          };

    if (result.ok !== true) {
      // Abstention is the ONLY path that earns a fallback. The caller decides
      // whether budget allows one; this method never runs it, so a mutation that
      // succeeded is structurally incapable of being retried here.
      return { command: undefined, source: 'none', attempts: [attempt] };
    }

    const actionId = result.value.actionId;
    if (typeof actionId !== 'string') {
      return {
        command: undefined,
        source: 'none',
        attempts: [{ source: 'decision', outcome: 'rejected', reason: 'no actionId in result' }],
      };
    }

    // Shadow dispatches are measured and discarded. The turn behaves exactly as
    // `off` does; only the comparison accumulates.
    if (this._mode === 'shadow') {
      return {
        command: undefined,
        actionId,
        source: 'none',
        attempts: [{ ...attempt, outcome: 'accepted', reason: 'shadow: discarded' }],
      };
    }

    const command: NpcDialogueCommand | undefined =
      actionId === NPC_ACTION_NONE_ID ? undefined : commandForActionId(candidates, actionId);

    // A literal this turn did not enumerate resolves to nothing rather than to
    // a plausible-looking command. Reconstruct already refused unknown option
    // keys, so reaching here with no command means `none`.
    return {
      command,
      actionId,
      source: 'decision',
      attempts: [attempt],
    };
  }

  /** Whether the fallback has budget. Exposed so the caller uses one rule. */
  budgetAllowsFallback(deadlineAt: number): boolean {
    return hasFallbackBudget({ deadlineAt, now: Date.now() });
  }
}

/** The shared instance. */
export const npcActionDecisionService: NpcActionDecisionServiceInterface =
  NpcActionDecisionService.create({
    className: 'NpcActionDecisionService',
  });
