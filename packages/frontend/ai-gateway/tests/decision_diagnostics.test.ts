// packages/frontend/ai-gateway/tests/decision_diagnostics.test.ts
//
// Contract C-567: the effective-route report.
//
// The point of this surface is that a user who disagrees with it can see WHICH
// stage produced the verdict: the schema, the policy, the bounds, or the
// backend. A single "not eligible" would be unactionable, and would make a
// task look broken when the only problem is that nobody installed a model.

import { describe, expect, test } from 'bun:test';
import Type from 'typebox';
import {
  buildDecisionDiagnostics,
  DECISION_EXPERIMENTAL_PREFERENCE,
  type DecisionAdapter,
  type DecisionTaskPolicy,
} from '../src/lib/decision/index.ts';

const PILOT_SCHEMA = Type.Object(
  {
    commandKind: Type.Union([Type.Literal('trade'), Type.Literal('recruit')]),
  },
  { additionalProperties: false },
);

const PILOT_POLICY: DecisionTaskPolicy = {
  task: 'npc-command-kind',
  enabled: true,
  instructions: 'Decide which bounded dialogue command the player message asks this NPC for.',
  fieldInstructions: { commandKind: 'Which command does the player ask for?' },
  optionDescriptions: {
    commandKind: {
      trade: 'The player wants to open the trade overlay.',
      recruit: 'The player asks this NPC to join the party.',
    },
  },
};

const READY_ADAPTER: DecisionAdapter = {
  backendId: 'systemone:nimble',
  dialect: 'jev-v1',
  capability: async () => ({
    backendId: 'systemone:nimble',
    dialect: 'jev-v1',
    ready: true,
    primitives: ['choice'],
    maxOptions: 64,
    maxQuestions: 16,
    maxContextBytes: 65_536,
    languages: ['en'],
    checkpoint: 'nimble:latest',
    runtime: 'ollama 0.36.1',
  }),
  run: async (request) => ({
    ok: true,
    answers: request.unit.questions.map((question) => ({
      questionKey: question.key,
      optionKey: question.options?.[0]?.key,
    })),
    inferenceMs: 1,
    queueMs: 0,
    checkpoint: 'nimble:latest',
  }),
};

const NOT_READY_ADAPTER: DecisionAdapter = {
  ...READY_ADAPTER,
  capability: async () => ({
    backendId: 'systemone:nimble',
    dialect: 'jev-v1',
    ready: false,
    notReadyReason: 'runtime 0.34.3 is older than the 0.35.0 floor required by /v1/systemone',
    primitives: ['choice'],
    maxOptions: 64,
    maxQuestions: 16,
    maxContextBytes: 65_536,
    languages: ['en'],
  }),
};

const report = (overrides: Partial<Parameters<typeof buildDecisionDiagnostics>[0]> = {}) =>
  buildDecisionDiagnostics({
    task: 'npc-command-kind',
    schema: PILOT_SCHEMA,
    policy: PILOT_POLICY,
    ...overrides,
  });

describe('each stage is distinguishable', () => {
  test('an incompatible schema is reported by code and path', async () => {
    const diagnostics = await report({
      schema: Type.Object({ freeText: Type.String() }),
    });
    expect(diagnostics.stage).toBe('schema');
    expect(diagnostics.eligible).toBe(false);
    expect(diagnostics.schemaReasons.length).toBeGreaterThan(0);
    expect(diagnostics.summary).toContain('not decision-compatible');
  });

  test('a policy refusal is a different stage from a schema refusal', async () => {
    const diagnostics = await report({ policy: { ...PILOT_POLICY, enabled: false } });
    expect(diagnostics.stage).toBe('policy');
    expect(diagnostics.schemaReasons[0]?.code).toBe('semantic-opt-in-required');
  });

  test('an oversize context is reported as a bounds failure, not a schema one', async () => {
    const diagnostics = await report({
      context: 'x'.repeat(60_000),
      limits: { maxContextBytes: 100 },
    });
    expect(diagnostics.stage).toBe('bounds');
    expect(diagnostics.summary).toContain('does not fit');
  });
});

describe('the report under the shipped preference', () => {
  test('a fully ready backend is still not eligible, and says why', async () => {
    const diagnostics = await report({ adapter: READY_ADAPTER });
    // This is the headline: the preference ships disabled, so no amount of
    // backend readiness makes a task eligible.
    expect(diagnostics.eligible).toBe(false);
    expect(diagnostics.refusalCode).toBe('preference-disabled');
    expect(diagnostics.stage).toBe('readiness');
  });

  test('a ready backend is reported as eligible only under an explicit opt-in', async () => {
    const diagnostics = await report({
      adapter: READY_ADAPTER,
      preference: {
        ...DECISION_EXPERIMENTAL_PREFERENCE,
        enabled: true,
        tasks: ['npc-command-kind'],
      },
    });
    expect(diagnostics.eligible).toBe(true);
    expect(diagnostics.stage).toBe('eligible');
    expect(diagnostics.backendId).toBe('systemone:nimble');
    // The checkpoint and runtime reported are the ones that answered, which
    // is the whole reason diagnostics exists.
    expect(diagnostics.checkpoint).toBe('nimble:latest');
    expect(diagnostics.runtime).toBe('ollama 0.36.1');
  });

  test('an opted-in task with a not-ready backend is refused, with setup guidance', async () => {
    const diagnostics = await report({
      adapter: NOT_READY_ADAPTER,
      preference: {
        ...DECISION_EXPERIMENTAL_PREFERENCE,
        enabled: true,
        tasks: ['npc-command-kind'],
      },
    });
    expect(diagnostics.eligible).toBe(false);
    expect(diagnostics.refusalCode).toBe('backend-not-ready');
    expect(diagnostics.setupSteps.map((step) => step.id)).toContain('decision.setup.runtimeTooOld');
    expect(diagnostics.summary).toContain('0.34.3');
  });

  test('no backend configured is reported as absent, not as a broken task', async () => {
    const diagnostics = await report({
      preference: {
        ...DECISION_EXPERIMENTAL_PREFERENCE,
        enabled: true,
        tasks: ['npc-command-kind'],
      },
    });
    expect(diagnostics.eligible).toBe(false);
    expect(diagnostics.summary).toContain('no decision backend is configured');
  });
});

describe('the report never leaks', () => {
  test('an ineligible report carries no credentials or endpoint material', async () => {
    const diagnostics = await report({
      adapter: {
        ...NOT_READY_ADAPTER,
        capability: async () => ({
          backendId: 'systemone:nimble',
          dialect: 'jev-v1',
          ready: false,
          notReadyReason: 'HTTP 401 for http://user:hunter2@127.0.0.1:11434/v1/systemone?key=abc',
          primitives: ['choice'],
          maxOptions: 64,
          maxQuestions: 16,
          maxContextBytes: 65_536,
          languages: ['en'],
        }),
      },
      preference: {
        ...DECISION_EXPERIMENTAL_PREFERENCE,
        enabled: true,
        tasks: ['npc-command-kind'],
      },
    });
    const rendered = JSON.stringify(diagnostics);
    expect(rendered).not.toContain('hunter2');
    expect(rendered).not.toContain('abc');
  });

  test('diagnostics never forward the caller context to an inspected backend', async () => {
    // A readiness report must not ship game state to a third-party endpoint
    // just to look at it. The probe case is the synthetic one by construction.
    let seenState: string | undefined;
    const adapter: DecisionAdapter = {
      ...READY_ADAPTER,
      run: async (request) => {
        seenState = request.unit.state;
        return {
          ok: true,
          answers: request.unit.questions.map((question) => ({
            questionKey: question.key,
            optionKey: question.options?.[0]?.key,
          })),
          inferenceMs: 1,
          queueMs: 0,
        };
      },
    };
    await report({ adapter, context: 'SECRET PLAYER TRANSCRIPT' });
    expect(seenState).toBeDefined();
    expect(seenState).not.toContain('SECRET PLAYER TRANSCRIPT');
  });
});
