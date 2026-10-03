// apps/frontend/client/src/lib/services/ai/decision/decision_backend_logic.test.ts
//
// The pure logic behind the decision backend (issue #381).
//
// These are the functions the service delegates to. Testing them here is what
// lets the service class stay an internal shell: the section's tests stub the
// service INTERFACE, and the rules the class applies are pinned here.

import { describe, expect, test } from 'bun:test';
import type { DecisionReadinessVerdict } from '@aikami/frontend/ai-gateway/decision';
import {
  adapterForBackend,
  DECISION_TEST_TIMEOUT_MS,
  decisionGameplayRouting,
  decisionTaskSummaries,
  deriveDecisionBackendState,
  isTestResultCurrent,
} from './decision_backend_logic';

/** A readiness verdict in the state the test cares about. */
const verdict = (state: DecisionReadinessVerdict['state']): DecisionReadinessVerdict => ({
  state,
  reason: `canned ${state}`,
});

describe('deriveDecisionBackendState', () => {
  test('an unconfigured or disabled capability is disabled', () => {
    expect(
      deriveDecisionBackendState({ configured: false, enabled: false, workloadQualified: true }),
    ).toBe('disabled');
    expect(
      deriveDecisionBackendState({ configured: true, enabled: false, workloadQualified: true }),
    ).toBe('disabled');
  });

  test('configured but never tested is NOT ready — nothing has answered', () => {
    expect(
      deriveDecisionBackendState({ configured: true, enabled: true, workloadQualified: true }),
    ).toBe('disabled');
  });

  test('a failed test is not ready, however qualified the workload is', () => {
    for (const state of ['unreachable', 'unauthorized', 'model-missing'] as const) {
      expect(
        deriveDecisionBackendState({
          configured: true,
          enabled: true,
          verdict: verdict(state),
          workloadQualified: true,
        }),
      ).toBe('disabled');
    }
  });

  test('a successful sample is ready but never qualified on its own', () => {
    expect(
      deriveDecisionBackendState({
        configured: true,
        enabled: true,
        verdict: verdict('ready'),
        workloadQualified: false,
      }),
    ).toBe('ready');
  });

  test('qualified needs a passing sample AND a cleared workload gate', () => {
    expect(
      deriveDecisionBackendState({
        configured: true,
        enabled: true,
        verdict: verdict('ready'),
        workloadQualified: true,
      }),
    ).toBe('qualified');
  });
});

describe('decisionGameplayRouting', () => {
  test('no backend is refused', () => {
    const decision = decisionGameplayRouting({
      configured: false,
      enabled: false,
      state: 'disabled',
      workloadQualified: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('no decision backend');
  });

  test('`ready` is refused, and says why a sample is not a qualification', () => {
    const decision = decisionGameplayRouting({
      configured: true,
      enabled: true,
      state: 'ready',
      workloadQualified: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('a sample decision is not a task qualification');
  });

  test('qualified without a cleared workload gate is refused by name', () => {
    const decision = decisionGameplayRouting({
      configured: true,
      enabled: true,
      state: 'qualified',
      workloadQualified: false,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('frozen gate has not been cleared');
  });

  // C-568: this replaced "even fully qualified, this release ships routing
  // disabled". That test asserted the PRE-gated contract — it was passing
  // against a function that refused unconditionally — so it could not tell a
  // real qualification from a hard-coded `false`.
  //
  // The refusal now lives where it belongs: a qualification must be EVIDENCE
  // for a specific task, version, dialect and checkpoint. See
  // `npc_action_decision_qualification.test.ts`, which is where that rule is
  // pinned. What this test now pins is that the gate opens when all three legs
  // hold.
  test('routing is permitted only once all three legs hold', () => {
    const decision = decisionGameplayRouting({
      configured: true,
      enabled: true,
      state: 'qualified',
      workloadQualified: true,
    });
    expect(decision.allowed).toBe(true);
  });
});

describe('isTestResultCurrent', () => {
  const base = {
    generation: 1,
    currentGeneration: 1,
    testedConnectionId: 'connection-1',
    resolvedConnectionId: 'connection-1',
  };

  test('a result for the current configuration is shown', () => {
    expect(isTestResultCurrent(base)).toBe(true);
  });

  test('a result is dropped when the player saved again mid-test', () => {
    expect(isTestResultCurrent({ ...base, currentGeneration: 2 })).toBe(false);
  });

  test('a result is dropped when the resolved connection changed underneath it', () => {
    expect(isTestResultCurrent({ ...base, resolvedConnectionId: 'connection-2' })).toBe(false);
  });

  test('a result is dropped when nothing is configured any more', () => {
    expect(isTestResultCurrent({ ...base, resolvedConnectionId: undefined })).toBe(false);
  });
});

describe('the task list', () => {
  test('no task is qualified unless a measurement says so', () => {
    expect(decisionTaskSummaries(false).every((task) => !task.qualified)).toBe(true);
    // With a measurement recorded, ONLY the task that measurement covered is
    // qualified. The research probe is a different task: its qualification was
    // never measured, so it does not inherit the gameplay task's.
    expect(
      decisionTaskSummaries(true).find((task) => task.id === 'npc-action-selection')?.qualified,
    ).toBe(true);
    expect(
      decisionTaskSummaries(true).find((task) => task.id === 'npc-command-kind')?.qualified,
    ).toBe(false);
  });

  test('the research probe is still labelled a probe, not a routing claim', () => {
    const probe = decisionTaskSummaries(false).find((task) => task.id === 'npc-command-kind');
    expect(probe?.label).toContain('research probe');
  });
});

describe('adapterForBackend', () => {
  const backend = (overrides: Record<string, unknown> = {}) =>
    ({
      connectionId: 'connection-1',
      registryId: 'jev-external',
      endpoint: 'http://127.0.0.1:8080/',
      checkpoint: 'laya-nimble-q4',
      runtime: 'jev',
      languages: ['en'],
      qualifiedForGameplay: false,
      ...overrides,
    }) as Parameters<typeof adapterForBackend>[0];

  test('a jev runtime is never handed an Ollama version route', () => {
    const adapter = adapterForBackend(backend());
    // The identity carries the endpoint, so two endpoints are two backends.
    expect(adapter.backendId).toBe('jev:jev:http://127.0.0.1:8080/v1/systemone#laya-nimble-q4');
  });

  test('an ollama runtime gets its own identity and its own version route', () => {
    const adapter = adapterForBackend(
      backend({ runtime: 'ollama', endpoint: 'http://127.0.0.1:11434' }),
    );
    expect(adapter.backendId).toBe('jev:ollama:http://127.0.0.1:11434/v1/systemone#laya-nimble-q4');
  });

  test('the declared checkpoint is the one the adapter will ask for', () => {
    expect(adapterForBackend(backend()).backendId).toContain('#laya-nimble-q4');
  });

  test('a test waits long enough for a cold model to load', () => {
    expect(DECISION_TEST_TIMEOUT_MS).toBeGreaterThan(5_000);
  });
});
