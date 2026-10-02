// packages/frontend/ai-gateway/tests/decision_readiness.test.ts
//
// Contract C-567: readiness means a schema-validated sample decision, not a
// listening socket.
//
// The property under test throughout: an endpoint that answers `200` on a route
// it does not actually implement, and a model listing that contains the
// checkpoint, are both STILL not readiness. Only a real answered decision whose
// reconstructed value satisfies the original schema is.

import { describe, expect, spyOn, test } from 'bun:test';
import Type from 'typebox';
import {
  createSystemOneDecisionAdapter,
  type DecisionAdapter,
  type DecisionAdapterResponse,
  type DecisionCapability,
  type DecisionReadinessVerdict,
  type DecisionRequest,
  describeDecisionReadiness,
  PROBE_CONTEXT,
  probeDecisionBackend,
  redactEndpoint,
  redactReason,
  type SystemOneTransport,
} from '../src/lib/decision/index.ts';

/** A backend that claims readiness and answers whatever it is told to. */
const answeringAdapter = (
  overrides: {
    capability?: Partial<DecisionCapability>;
    run?: (request: DecisionRequest) => DecisionAdapterResponse;
  } = {},
): DecisionAdapter => ({
  backendId: 'test-backend',
  dialect: 'jev-v1',
  capability: async () => ({
    backendId: 'test-backend',
    dialect: 'jev-v1',
    ready: true,
    primitives: ['boolean', 'choice', 'combination'],
    maxOptions: 64,
    maxQuestions: 16,
    maxContextBytes: 65_536,
    languages: ['en'],
    checkpoint: 'test-checkpoint',
    runtime: 'test-runtime',
    ...overrides.capability,
  }),
  run: async (request) =>
    overrides.run?.(request) ?? {
      ok: true,
      // Answer the first choice question with its first option key.
      answers: request.unit.questions.map((question) => ({
        questionKey: question.key,
        optionKey: question.options?.[0]?.key,
      })),
      inferenceMs: 1,
      queueMs: 0,
      checkpoint: 'test-checkpoint',
    },
});

/** A backend that declares itself not ready. */
const notReadyAdapter = (reason: string): DecisionAdapter => ({
  backendId: 'test-backend',
  dialect: 'jev-v1',
  capability: async () => ({
    backendId: 'test-backend',
    dialect: 'jev-v1',
    ready: false,
    notReadyReason: reason,
    primitives: ['choice'],
    maxOptions: 64,
    maxQuestions: 16,
    maxContextBytes: 65_536,
    languages: ['en'],
  }),
  run: async () => ({
    ok: false,
    reason: 'backend-unavailable',
    detail: 'n/a',
    queueMs: 0,
    inferenceMs: 0,
  }),
});

const probeWith = (adapter: DecisionAdapter, overrides = {}): Promise<DecisionReadinessVerdict> =>
  probeDecisionBackend({
    adapter,
    deadlineAt: Date.now() + 5_000,
    signal: new AbortController().signal,
    requestId: 'probe-1',
    stateRevision: 0,
    ...overrides,
  });

describe('readiness requires an answered, schema-valid sample', () => {
  test('a backend that answers a legal value is ready', async () => {
    const verdict = await probeWith(answeringAdapter());
    expect(verdict.state).toBe('ready');
    expect(verdict.observed?.checkpoint).toBe('test-checkpoint');
  });

  test.each([
    ['halt', 'ready'],
    ['not-a-real-key', 'sample-rejected'],
  ])('readiness for option %s is %s', async (optionKey, state) => {
    const verdict = await probeWith(
      answeringAdapter({
        run: (request) => ({
          ok: true,
          answers: [
            {
              questionKey: request.unit.questions[0]?.key ?? '',
              optionKey:
                request.unit.questions[0]?.options?.find((option) => option.value === optionKey)
                  ?.key ?? optionKey,
            },
          ],
          inferenceMs: 1,
          queueMs: 0,
        }),
      }),
    );
    expect(verdict.state).toBe(state);
  });

  test('a backend that reports not ready is not ready, whatever the reason', async () => {
    for (const reason of [
      'runtime 0.34.3 is older than the 0.35.0 floor required by /v1/systemone',
      'checkpoint "nimble" is not installed; the runtime lists 14 model(s)',
      'checkpoint advertises [completion, tools], none of which is decision scoring',
      'endpoint not found: this runtime does not implement /v1/systemone',
    ]) {
      const verdict = await probeWith(notReadyAdapter(reason));
      expect(verdict.state).not.toBe('ready');
      expect(verdict.reason).toBe(reason);
    }
  });

  test('an old-runtime reason classifies as unsupported-runtime, not as unreachable', async () => {
    const verdict = await probeWith(
      notReadyAdapter('runtime 0.34.3 is older than the 0.35.0 floor required by /v1/systemone'),
    );
    expect(verdict.state).toBe('unsupported-runtime');
  });

  test('a missing-model reason classifies as model-missing', async () => {
    const verdict = await probeWith(
      notReadyAdapter('checkpoint "nimble" is not installed; the runtime lists 14 model(s)'),
    );
    expect(verdict.state).toBe('model-missing');
  });

  test('a wrong dialect is refused even from a ready backend', async () => {
    const verdict = await probeWith(answeringAdapter(), { requiredDialect: 'some-other-dialect' });
    expect(verdict.state).toBe('incompatible-dialect');
    expect(verdict.reason).toContain('jev-v1');
  });

  test('a cancelled probe never reports ready', async () => {
    const controller = new AbortController();
    controller.abort();
    const verdict = await probeWith(answeringAdapter(), { signal: controller.signal });
    expect(verdict.state).toBe('cancelled');
  });

  test('an expired deadline never reports ready', async () => {
    const verdict = await probeWith(answeringAdapter(), { deadlineAt: Date.now() - 1 });
    expect(verdict.state).toBe('deadline-exceeded');
  });

  test('a backend error is reported as unreachable, not as a passed probe', async () => {
    const adapter = answeringAdapter({
      run: () => ({
        ok: false,
        reason: 'backend-unavailable',
        detail: 'connection refused',
        queueMs: 0,
        inferenceMs: 1,
      }),
    });
    const verdict = await probeWith(adapter);
    expect(verdict.state).toBe('unreachable');
  });

  test('a probe context larger than the backend bound is refused, never truncated', async () => {
    const adapter = answeringAdapter({
      capability: { maxContextBytes: 8 },
    });
    const verdict = await probeWith(adapter);
    expect(verdict.state).toBe('oversize');
    expect(verdict.reason).toContain('8');
  });

  test('a probe policy that does not bind is reported, not silently skipped', async () => {
    const verdict = await probeWith(answeringAdapter(), {
      probe: {
        policy: {
          task: 'probe',
          // A disabled policy must never be treated as an implicit yes.
          enabled: false,
        },
      },
    });
    expect(verdict.state).toBe('sample-rejected');
    expect(verdict.schemaReasons?.[0]?.code).toBe('semantic-opt-in-required');
  });

  test('a probe schema the compiler rejects is reported by code and path', async () => {
    const verdict = await probeWith(answeringAdapter(), {
      probe: {
        schema: Type.Object({
          freeText: Type.String(),
          items: Type.Array(Type.Literal('a')),
        }) as unknown as Record<string, unknown>,
      },
    });
    expect(verdict.state).toBe('sample-rejected');
    expect(verdict.schemaReasons?.length).toBeGreaterThan(0);
  });
});

describe('the probe itself carries no player content', () => {
  test('the default probe schema is a closed two-option discriminator', async () => {
    let captured: DecisionRequest | undefined;
    await probeWith(
      answeringAdapter({
        run: (request) => {
          captured = request;
          return {
            ok: true,
            answers: [
              {
                questionKey: request.unit.questions[0]?.key ?? '',
                optionKey: request.unit.questions[0]?.options?.find(
                  (option) => option.value === 'proceed',
                )?.key,
              },
            ],
            inferenceMs: 1,
            queueMs: 0,
          };
        },
      }),
    );
    expect(captured?.unit.questions).toHaveLength(1);
    expect(captured?.unit.questions[0]?.key).toMatch(/^verdict__[a-f0-9]+$/);
    expect(
      captured?.plan.questions.find((question) => question.key === captured?.unit.questions[0]?.key)
        ?.path,
    ).toEqual(['verdict']);
    expect(captured?.unit.questions[0]?.options?.map((option) => option.value)).toEqual([
      'halt',
      'proceed',
    ]);
    expect(captured?.unit.state).toBe(PROBE_CONTEXT);
  });
});

describe('setup guidance', () => {
  test('every not-ready state produces at least one actionable step', async () => {
    const states: DecisionReadinessVerdict[] = [
      { state: 'ready', reason: 'ok' },
      { state: 'unsupported-runtime', reason: 'runtime too old' },
      { state: 'model-missing', reason: 'not installed' },
      { state: 'capability-missing', reason: 'no scoring capability' },
      { state: 'incompatible-dialect', reason: 'wrong dialect' },
      { state: 'oversize', reason: 'too big' },
      { state: 'sample-rejected', reason: 'illegal value' },
      { state: 'unreachable', reason: 'no route' },
      { state: 'unauthorized', reason: 'HTTP 401' },
      { state: 'deadline-exceeded', reason: 'out of time' },
      { state: 'cancelled', reason: 'cancelled' },
    ];
    for (const verdict of states) {
      expect(describeDecisionReadiness(verdict).length).toBeGreaterThan(0);
    }
  });

  test('an old runtime is never silently upgraded by the guidance', async () => {
    const steps = describeDecisionReadiness({
      state: 'unsupported-runtime',
      reason: 'runtime 0.34.3 is older than the 0.35.0 floor',
    });
    expect(steps.map((step) => step.id)).toContain('decision.setup.noAutoUpgrade');
  });

  test('a ready verdict names the checkpoint that actually answered', async () => {
    const steps = describeDecisionReadiness({
      state: 'ready',
      reason: 'ok',
      observed: { checkpoint: 'nimble:latest' },
    });
    expect(steps[0]?.detail).toContain('nimble:latest');
  });
});

describe('credential redaction', () => {
  test('a URL embedded in an adapter reason is redacted, not just a bare endpoint', async () => {
    // Adapter reasons are free text written at the transport layer, and they
    // quote the URL they failed against. Redacting only a whole-string endpoint
    // would miss every one of them.
    const verdict = await probeWith(
      notReadyAdapter('HTTP 401 for http://user:hunter2@127.0.0.1:11434/v1/systemone?key=abc'),
    );
    expect(verdict.reason).not.toContain('hunter2');
    expect(verdict.reason).not.toContain('abc');
    expect(verdict.capability?.notReadyReason).not.toContain('hunter2');
  });

  test('userinfo never survives into text a user sees', () => {
    const redacted = redactEndpoint('http://user:sup3rsecret@127.0.0.1:11434/v1/systemone');
    expect(redacted).not.toContain('sup3rsecret');
    expect(redacted).not.toContain('user');
    expect(redacted).toContain('127.0.0.1:11434');
  });

  test('a query string is dropped', () => {
    expect(redactEndpoint('http://127.0.0.1:11434/v1/models?key=abc123')).not.toContain('abc123');
  });

  test('a non-URL survives without throwing', () => {
    expect(redactEndpoint('not a url?with=query')).toBe('not a url');
  });

  test('a clean loopback endpoint is preserved verbatim', () => {
    expect(redactEndpoint('http://127.0.0.1:11434/v1/systemone')).toBe(
      'http://127.0.0.1:11434/v1/systemone',
    );
  });

  test('every URL in a reason string is redacted, not only the first', () => {
    const redacted = redactReason(
      'failed at http://a:one@host:1/x and again at http://b:two@host:2/y',
    );
    expect(redacted).not.toContain('one');
    expect(redacted).not.toContain('two');
    expect(redacted).toContain('host:1');
    expect(redacted).toContain('host:2');
  });
});

describe('the probe never contacts a backend the caller did not supply', () => {
  test('an injected transport is used exclusively', async () => {
    const endpoints = {
      version: 'http://configured.test/version',
      models: 'http://configured.test/models',
      decision: 'http://configured.test/decision',
    };
    const seen: string[] = [];
    const transport: SystemOneTransport = {
      fetch: async (input) => {
        seen.push(input);
        const body =
          input === endpoints.version ? { version: '0.36.1' } : { models: [{ name: 'nimble' }] };
        return {
          status: input === endpoints.decision ? 503 : 200,
          text: async () => JSON.stringify(body),
        };
      },
    };
    const globalFetch = spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('unexpected global fetch');
    });
    try {
      const verdict = await probeWith(
        createSystemOneDecisionAdapter({
          runtime: 'ollama',
          endpoints,
          model: 'nimble',
          languages: ['en'],
          transport,
        }),
      );
      expect(verdict.state).not.toBe('ready');
      expect(new Set(seen)).toEqual(new Set(Object.values(endpoints)));
      expect(globalFetch).not.toHaveBeenCalled();
    } finally {
      globalFetch.mockRestore();
    }
  });
});
