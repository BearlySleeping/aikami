// apps/frontend/client/src/lib/services/ai/decision_backend_service.svelte.ts
//
// The configure → test → sample flow for decision backends (issue #381).
//
// What this service is: the product path. A player picks a runtime, points at an
// endpoint, names a checkpoint, optionally stores a credential, and presses
// "Test connection". What comes back is a REAL sample decision dispatched
// through the same adapter, runner and reconstruction the evaluator uses.
//
// What this service is NOT: a router. Nothing here feeds a gameplay call site.
// A configured backend is `ready` for testing and shadow evaluation, and it is
// NOT qualified for automatic gameplay — that is a separate gate over a frozen
// held-out corpus, and `decisionGameplayRouting` below refuses by construction
// until that gate has actually been cleared. The distinction is carried in the
// type, not only in the wording.
import {
  type DecisionReadinessVerdict,
  describeDecisionReadiness,
  redactEndpoint,
} from '@aikami/frontend/ai-gateway/decision';
import { BaseFrontendClass, type BaseFrontendClassOptions } from '@aikami/frontend/services/base';
import { configService } from '../config/config_service.svelte.ts';
import type { ResolvedDecisionBackend } from '../config/decision_backend_resolution';
import {
  adapterForBackend,
  DECISION_TEST_TIMEOUT_MS,
  decisionGameplayRouting,
  decisionTaskSummaries,
  defaultDecisionProbe,
  deriveDecisionBackendState,
  isTestResultCurrent,
} from './decision/decision_backend_logic';
import type {
  DecisionBackendCapabilities,
  DecisionBackendSummary,
  DecisionGameplayRouting,
  DecisionTestOutcome,
} from './decision/types';

export type DecisionBackendServiceOptions = BaseFrontendClassOptions & {
  readonly capabilities?: Partial<DecisionBackendCapabilities>;
};

/** Public service interface. */
export type DecisionBackendServiceInterface = {
  /** The last explicit test. Never auto-probed on load. */
  readonly lastVerdict: DecisionReadinessVerdict | undefined;
  /** Whether a test is in flight. */
  readonly isTesting: boolean;
  resolve(): ResolvedDecisionBackend | undefined;
  summary(): DecisionBackendSummary;
  gameplayRouting(): DecisionGameplayRouting;
  test(): Promise<DecisionTestOutcome | undefined>;
  invalidate(): void;
  persist(): Promise<void>;
};

/**
 * The configure → test → sample flow for decision backends.
 *
 * What this service is: the product path. What it is NOT is a router — nothing
 * here feeds a gameplay call site, and `gameplayRouting()` refuses
 * unconditionally in this release.
 */

class DecisionBackendService
  extends BaseFrontendClass<DecisionBackendServiceOptions>
  implements DecisionBackendServiceInterface
{
  /** The last explicit test, or undefined. Never auto-probed on load. */
  lastVerdict = $state<DecisionReadinessVerdict | undefined>(undefined);
  isTesting = $state(false);
  /** Which connection the in-flight test belongs to, so a late result is dropped. */
  private _generation = 0;

  private readonly _capabilities: DecisionBackendCapabilities;

  constructor(options: DecisionBackendServiceOptions) {
    super(options);
    const injected = options.capabilities ?? {};
    this._capabilities = {
      resolveBackend: injected.resolveBackend ?? (() => configService.resolveDecisionBackend()),
      persist: injected.persist ?? (() => configService.save()),
      createAdapter: injected.createAdapter ?? adapterForBackend,
      probe: injected.probe ?? defaultDecisionProbe,
    };
  }

  /** Resolves the configured backend. */
  resolve(): ResolvedDecisionBackend | undefined {
    return this._capabilities.resolveBackend();
  }

  /**
   * Whether a measurement has cleared the workload gate.
   *
   * Read from the saved connection rather than assumed. Today the only way to
   * set it is a measurement this build does not ship, so it is always false.
   */
  workloadQualified(_backend: ResolvedDecisionBackend): boolean {
    return _backend.qualifiedForGameplay;
  }

  /** The unconfigured projection. Shown before anything has been saved. */
  private _unconfigured(): DecisionBackendSummary {
    return {
      configured: false,
      enabled: false,
      state: 'disabled',
      runtimeLabel: '—',
      endpointLabel: '—',
      checkpoint: '—',
      hasCredential: false,
      tasks: decisionTaskSummaries(false),
    };
  }

  /** Projects the section's view of the world. */
  summary(): DecisionBackendSummary {
    const backend = this.resolve();
    if (backend === undefined) {
      return this._unconfigured();
    }
    const workloadQualified = this.workloadQualified(backend);
    return {
      configured: true,
      enabled: true,
      state: deriveDecisionBackendState({
        configured: true,
        enabled: true,
        verdict: this.lastVerdict,
        workloadQualified,
      }),
      runtimeLabel: backend.runtime,
      endpointLabel: redactEndpoint(backend.endpoint),
      checkpoint: backend.checkpoint,
      hasCredential: backend.credential !== undefined,
      tasks: decisionTaskSummaries(workloadQualified),
    };
  }

  /** Whether automatic gameplay routing would be permitted right now. */
  gameplayRouting(): DecisionGameplayRouting {
    const backend = this.resolve();
    return decisionGameplayRouting({
      configured: backend !== undefined,
      enabled: backend !== undefined,
      state: this.summary().state,
      workloadQualified: backend === undefined ? false : this.workloadQualified(backend),
    });
  }

  /**
   * Runs a REAL sample decision against the configured backend.
   *
   * A version list or a bound port is not a test: the readiness probe runs the
   * full pipeline once on the synthetic probe case and requires a value that
   * validates against the original schema.
   */
  async test(): Promise<DecisionTestOutcome | undefined> {
    const backend = this.resolve();
    if (backend === undefined) {
      return undefined;
    }
    const generation = ++this._generation;
    this.isTesting = true;
    this.lastVerdict = undefined;
    try {
      const verdict = await this._capabilities.probe({
        adapter: this._capabilities.createAdapter(backend),
        signal: new AbortController().signal,
        deadlineAt: Date.now() + DECISION_TEST_TIMEOUT_MS,
      });
      // A result for a configuration the player has since changed is dropped
      // rather than displayed as if it described the new one.
      if (
        !isTestResultCurrent({
          generation,
          currentGeneration: this._generation,
          testedConnectionId: backend.connectionId,
          resolvedConnectionId: this.resolve()?.connectionId,
        })
      ) {
        return undefined;
      }
      this.lastVerdict = verdict;
      this.info('decision backend test completed', {
        state: verdict.state,
        runtime: backend.runtime,
        checkpoint: backend.checkpoint,
        hasCredential: backend.credential !== undefined,
      });
      return { verdict, steps: describeDecisionReadiness(verdict) };
    } finally {
      if (generation === this._generation) {
        this.isTesting = false;
      }
    }
  }

  /** Drops a stale result when the configuration changes underneath it. */
  invalidate(): void {
    this._generation += 1;
    this.isTesting = false;
    this.lastVerdict = undefined;
  }

  /** Persists a configuration change and drops the now-stale verdict. */
  async persist(): Promise<void> {
    this.invalidate();
    await this._capabilities.persist();
  }
}

/**
 * The shared instance.
 *
 * Production wiring only. Tests hand the section a stub implementing
 * {@link DecisionBackendServiceInterface}, so no unit test reaches a socket or
 * the local vault.
 */
export const decisionBackendService: DecisionBackendServiceInterface =
  DecisionBackendService.create({ className: 'DecisionBackendService' });
