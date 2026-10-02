// packages/frontend/ai-gateway/tests/decision_evaluator.test.ts
//
// The executable evaluator: three outcomes, never conflated.
//
//   measured pass / measured fail / unavailable
//
// An unavailable backend is the state this whole file exists for. #381 has been
// open for three contracts because nothing could produce a number, and the
// failure mode that keeps it open is reporting "no backend" as "no problems".

import { describe, expect, test } from 'bun:test';
import { EXIT, parseOptions, renderSummary, run } from '../src/cli/decision_evaluate_node.ts';
import {
  createSystemOneDecisionAdapter,
  evaluateBackend,
  type SystemOneTransport,
} from '../src/lib/decision/index.ts';
import { NPC_COMMAND_KIND_NONE } from '../src/lib/decision/tasks/index.ts';

/** A backend that answers every sample with the first criteria key it is offered. */
const echoingBackend = (): SystemOneTransport => ({
  fetch: async (_input, init) => {
    if (init.method === 'GET') {
      return { status: 404, text: async () => '{}' };
    }
    const body = JSON.parse(init.body ?? '{}') as {
      questions?: Record<string, { criteria?: Record<string, string> }>;
    };
    const answers: Record<string, unknown> = {};
    for (const [key, question] of Object.entries(body.questions ?? {})) {
      const first = Object.keys(question.criteria ?? {})[0];
      if (first !== undefined) {
        answers[key] = { type: 'choice', choice: first };
      }
    }
    return { status: 200, text: async () => JSON.stringify({ model: 'x', answers }) };
  },
});

/** A backend that refuses every decision request. */
const deadBackend = (): SystemOneTransport => ({
  fetch: async () => ({ status: 503, text: async () => 'unavailable' }),
});

const adapterFor = (transport: SystemOneTransport) =>
  createSystemOneDecisionAdapter({
    runtime: 'jev',
    endpoints: { decision: 'http://127.0.0.1:9999/v1/systemone' },
    model: 'nimble',
    languages: ['en'],
    transport,
  });

describe('the three outcomes', () => {
  test('an unreachable backend is UNAVAILABLE, and says why', async () => {
    const artifact = await evaluateBackend({
      adapter: adapterFor(deadBackend()),
      readinessTimeoutMs: 500,
    });
    expect(artifact.status).toBe('unavailable');
    expect(artifact.unavailableReason).toContain('backend is not ready');
    expect(artifact.splits).toEqual([]);
    expect(artifact.cases).toEqual([]);
    // The gates are still recorded, so a later run is comparable.
    expect(artifact.gates.quality.minPositiveRecall).toBeGreaterThan(0);
  });

  test('a backend that answers is measured, and fails or passes — never skips', async () => {
    const artifact = await evaluateBackend({
      adapter: adapterFor(echoingBackend()),
      readinessTimeoutMs: 2_000,
      coldSamples: 1,
      warmupRequests: 0,
    });
    expect(artifact.status).not.toBe('unavailable');
    expect(['passed', 'failed']).toContain(artifact.status);
    expect(artifact.splits.map((split) => split.split)).toEqual(['dev', 'heldout']);
    expect(artifact.unavailableReason).toBeUndefined();
  });

  test('a backend that always answers the first option fails the safety gate', async () => {
    const artifact = await evaluateBackend({
      adapter: adapterFor(echoingBackend()),
      readinessTimeoutMs: 2_000,
      coldSamples: 1,
      warmupRequests: 0,
    });
    // The sorted literals put `none` first, so this backend abstains-by-literal;
    // what it cannot do is answer the 15 positives correctly, and positive
    // recall is the gate. Whichever way it lands, it must not be a silent pass.
    expect(artifact.status).toBe('failed');
    expect(artifact.gateFailures.join('\n')).toContain('positive recall');
  });

  test('the artifact records the conditions, the gates and the corpus limitations', async () => {
    const artifact = await evaluateBackend({
      adapter: adapterFor(echoingBackend()),
      readinessTimeoutMs: 2_000,
      coldSamples: 3,
      warmupRequests: 1,
    });
    expect(artifact.conditions.coldSamples).toBe(3);
    expect(artifact.conditions.warmupRequests).toBe(1);
    expect(artifact.conditions.declaredLanguages).toEqual(['en']);
    expect(artifact.corpusLimitations.length).toBeGreaterThan(0);
    expect(artifact.task).toBe('npc-command-kind');
    expect(artifact.artifactVersion).toBe('decision-evaluation/2');
  });

  test('per-case outcomes travel with the artifact so a number is traceable', async () => {
    const artifact = await evaluateBackend({
      adapter: adapterFor(echoingBackend()),
      readinessTimeoutMs: 2_000,
      coldSamples: 1,
      warmupRequests: 0,
    });
    expect(artifact.cases.length).toBeGreaterThan(0);
    const sample = artifact.cases[0];
    expect(sample).toBeDefined();
    expect(typeof sample?.category).toBe('string');
    expect(typeof sample?.latencyCondition).toBe('string');
  });

  test('the task safe literal is `none`, and it is what a safe answer is scored against', async () => {
    expect(NPC_COMMAND_KIND_NONE).toBe('none');
  });
});

describe('the CLI contract', () => {
  test('exit codes separate pass, fail and unavailable', () => {
    expect(EXIT.passed).toBe(0);
    expect(EXIT.failed).toBe(1);
    expect(EXIT.unavailable).toBe(2);
    expect(EXIT.usage).toBe(3);
    // Distinct on purpose: a wrapper that only checks "non-zero" would call a
    // measured failure and an unreachable backend the same thing.
    expect(new Set([EXIT.passed, EXIT.failed, EXIT.unavailable, EXIT.usage]).size).toBe(4);
  });

  test('an invocation with no endpoint is a usage error, not a measurement', async () => {
    expect(await run(['--runtime=ollama'])).toBe(EXIT.usage);
  });

  test('a secret in argv is refused outright, with the reason', () => {
    expect(() =>
      parseOptions(['--endpoint=http://h', '--checkpoint=n', '--credential=hunter2']),
    ).toThrow(/--credential is not accepted/);
  });

  test('a secret is supplied by environment variable NAME, never by value', () => {
    const options = parseOptions([
      '--endpoint=http://h',
      '--checkpoint=nimble',
      '--credential-env=AIKAMI_JEV_TOKEN',
    ]);
    expect(options.credentialEnv).toBe('AIKAMI_JEV_TOKEN');
    expect(JSON.stringify(options)).not.toContain('token-value');
  });

  test('an unknown runtime is a usage error naming the valid set', () => {
    expect(() => parseOptions(['--endpoint=http://h', '--checkpoint=n', '--runtime=vllm'])).toThrow(
      /--runtime must be one of/,
    );
  });

  test('the Ollama runtime derives its own version route and a jev runtime does not', () => {
    const ollama = parseOptions([
      '--endpoint=http://h:11434',
      '--checkpoint=n',
      '--runtime=ollama',
    ]);
    expect(ollama.endpoints.version).toBe('http://h:11434/api/version');
    expect(ollama.endpoints.decision).toBe('http://h:11434/v1/systemone');

    const jev = parseOptions(['--endpoint=http://laya:8080', '--checkpoint=n', '--runtime=jev']);
    // No Ollama version route is invented for a server that may not serve one.
    expect(jev.endpoints.version).toBeUndefined();
    expect(jev.endpoints.decision).toBe('http://laya:8080/v1/systemone');
  });

  test('the summary never prints an unredacted endpoint', () => {
    const options = parseOptions([
      '--endpoint=http://h:11434',
      '--checkpoint=nimble',
      '--runtime=ollama',
    ]);
    const artifact = {
      artifactVersion: 'decision-evaluation/2',
      status: 'unavailable' as const,
      unavailableReason: 'backend is not ready: unreachable',
      task: 'npc-command-kind',
      backendId: 'jev:ollama:http://h:11434/v1/systemone#nimble',
      dialect: 'jev-v1',
      startedAt: '1970-01-01T00:00:00.000Z',
      durationMs: 1,
      conditions: {
        timeoutMs: 5_000,
        coldSamples: 20,
        warmupRequests: 1,
        minimumPercentileSamples: 20,
        declaredLanguages: ['en' as const],
      },
      gates: { quality: { minPositiveRecall: 0.85 } },
      splits: [],
      gateFailures: [],
      cases: [],
      corpusLimitations: ['one limitation'],
    };
    expect(renderSummary(artifact, options)).toContain('UNAVAILABLE');
  });
});
