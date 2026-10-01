// packages/frontend/ai-gateway/tests/decision_preference.test.ts
//
// Contract C-567: the experimental preference, which ships DISABLED.
//
// Two properties are worth more than the individual refusals:
//
//   1. The shipped preference refuses everything. There is no global "route all
//      enum schemas to the decision model" switch, and opt-in is per task.
//   2. Resolution is POLICY-FIRST. A ready backend cannot buy its way past a
//      disabled preference, a disabled role, or a cloud/privacy refusal — the
//      readiness check is the LAST gate, not the first.

import { describe, expect, test } from 'bun:test';
import {
  DECISION_EXPERIMENTAL_PREFERENCE,
  DECISION_MINIMUM_BUDGET_MS,
  type DecisionExperimentalPreference,
  type DecisionReadinessVerdict,
  resolveDecisionPreference,
} from '../src/lib/decision/index.ts';

const READY: DecisionReadinessVerdict = {
  state: 'ready',
  reason: 'a sample decision was answered',
  observed: { checkpoint: 'nimble:latest', runtime: 'ollama 0.36.1' },
  capability: {
    backendId: 'systemone:nimble',
    dialect: 'jev-v1',
    ready: true,
    primitives: ['choice'],
    maxOptions: 64,
    maxQuestions: 16,
    maxContextBytes: 65_536,
    languages: ['en'],
  },
};

const NOT_READY: DecisionReadinessVerdict = {
  state: 'unsupported-runtime',
  reason: 'runtime 0.34.3 is older than the 0.35.0 floor',
  capability: {
    backendId: 'systemone:nimble',
    dialect: 'jev-v1',
    ready: false,
    primitives: ['choice'],
    maxOptions: 64,
    maxQuestions: 16,
    maxContextBytes: 65_536,
    languages: ['en'],
  },
};

/** A preference that has explicitly opted in, for testing steps 3–6. */
const ENABLED: DecisionExperimentalPreference = {
  enabled: true,
  tasks: ['npc-command-kind'],
  allowCloud: false,
};

const resolve = (overrides: Partial<Parameters<typeof resolveDecisionPreference>[0]> = {}) =>
  resolveDecisionPreference({
    preference: ENABLED,
    task: 'npc-command-kind',
    backendKind: 'local',
    readiness: READY,
    contextBytes: 1_000,
    remainingBudgetMs: 5_000,
    ...overrides,
  });

describe('the shipped preference is off', () => {
  test('it is disabled, names no tasks, and forbids cloud', () => {
    expect(DECISION_EXPERIMENTAL_PREFERENCE.enabled).toBe(false);
    expect(DECISION_EXPERIMENTAL_PREFERENCE.tasks).toEqual([]);
    expect(DECISION_EXPERIMENTAL_PREFERENCE.allowCloud).toBe(false);
  });

  test('a ready backend changes nothing while it is disabled', () => {
    const decision = resolveDecisionPreference({
      preference: DECISION_EXPERIMENTAL_PREFERENCE,
      task: 'npc-command-kind',
      backendKind: 'local',
      readiness: READY,
      contextBytes: 100,
      remainingBudgetMs: 5_000,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('preference-disabled');
    }
  });

  test('enabling alone opts in nothing: opt-in is per task', () => {
    const decision = resolveDecisionPreference({
      preference: { ...DECISION_EXPERIMENTAL_PREFERENCE, enabled: true },
      task: 'anything',
      backendKind: 'local',
      readiness: READY,
      contextBytes: 100,
      remainingBudgetMs: 5_000,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('task-not-opted-in');
    }
  });
});

describe('policy is resolved before readiness', () => {
  test('an explicitly disabled role is not re-enabled by a ready backend', () => {
    const decision = resolve({ roleDisabled: true });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('role-explicitly-disabled');
    }
  });

  test('cloud is refused by default even with an explicit opt-in', () => {
    const decision = resolve({ backendKind: 'cloud' });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('cloud-not-permitted');
    }
  });

  test('an explicit cloud pin is still refused when cloud is not permitted', () => {
    // Pinning a backend is not a licence to spend.
    const decision = resolve({ backendKind: 'cloud', explicitBackendId: 'systemone:nimble' });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('cloud-not-permitted');
    }
  });

  test('cloud is permitted only when the preference says so', () => {
    const decision = resolve({
      preference: { ...ENABLED, allowCloud: true },
      backendKind: 'cloud',
    });
    expect(decision.ok).toBe(true);
  });

  test('an explicit pin wins over a blanket role disable', () => {
    const decision = resolve({ roleDisabled: true, explicitBackendId: 'systemone:nimble' });
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.backendId).toBe('systemone:nimble');
    }
  });

  test('oversize context is refused before readiness is consulted', () => {
    const decision = resolve({
      preference: { ...ENABLED, maxContextBytes: 500 },
      contextBytes: 900,
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('context-limit-exceeded');
    }
  });

  test('too little remaining budget is refused rather than started', () => {
    const decision = resolve({ remainingBudgetMs: DECISION_MINIMUM_BUDGET_MS - 1 });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('budget-exceeded');
    }
  });

  test('readiness is the LAST gate: a not-ready backend refuses at the end', () => {
    const decision = resolve({ readiness: NOT_READY });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('backend-not-ready');
      expect(decision.detail).toContain('0.34.3');
    }
  });

  test('a policy refusal is not masked by a ready backend', () => {
    // Every policy refusal above must still hold with readiness === READY.
    for (const overrides of [
      { roleDisabled: true },
      { backendKind: 'cloud' as const },
      { remainingBudgetMs: 0 },
    ]) {
      const decision = resolve(overrides);
      expect(decision.ok).toBe(false);
    }
  });
});

describe('the eligible route', () => {
  test('reports the checkpoint and runtime that actually answered', () => {
    const decision = resolve();
    expect(decision.ok).toBe(true);
    if (decision.ok) {
      expect(decision.backendId).toBe('systemone:nimble');
      expect(decision.checkpoint).toBe('nimble:latest');
      expect(decision.runtime).toBe('ollama 0.36.1');
    }
  });

  test('a ready verdict with no capability reports no backend rather than inventing one', () => {
    const decision = resolve({
      readiness: { state: 'ready', reason: 'ok' },
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.code).toBe('no-backend');
    }
  });
});

describe('explicit pins retain bounds and backend identity', () => {
  test('context and budget refusals also apply to explicit pins', () => {
    expect(
      resolve({
        explicitBackendId: 'systemone:nimble',
        preference: { ...ENABLED, maxContextBytes: 500 },
      }),
    ).toMatchObject({ ok: false, code: 'context-limit-exceeded' });
    expect(
      resolve({
        explicitBackendId: 'systemone:nimble',
        remainingBudgetMs: DECISION_MINIMUM_BUDGET_MS - 1,
      }),
    ).toMatchObject({ ok: false, code: 'budget-exceeded' });
  });
  test('readiness must identify the pinned backend', () => {
    expect(resolve({ explicitBackendId: 'other' })).toMatchObject({
      ok: false,
      code: 'backend-not-ready',
    });
    expect(
      resolve({
        explicitBackendId: 'systemone:nimble',
        readiness: { state: 'ready', reason: 'ok' },
      }),
    ).toMatchObject({ ok: false, code: 'backend-not-ready' });
  });
});
