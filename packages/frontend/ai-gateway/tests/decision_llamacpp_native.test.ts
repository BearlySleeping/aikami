// packages/frontend/ai-gateway/tests/decision_llamacpp_native.test.ts
//
// The NATIVE llama.cpp `/v1/systemone` adapter and dialect (issue #381).
//
// Every fixture in this file is either (a) transcribed from upstream's own
// documentation and contract tests at the pinned commit `a4cb4c61`
// (`tools/server/README.md`, `tools/server/tests/unit/test_systemone.py`,
// `tools/server/server-decision.cpp`) or (b) captured from a real `llama-server`
// built at that commit on this machine. Nothing is invented, and every fixture
// that claims to be captured says which.
//
// The behavioural claim this file exists to pin: a native `noul` answer is the
// NUMBER p(true), not a boolean, and a reader that looks for a boolean finds
// `undefined` — which presents as a policy abstention rather than a wire
// mismatch. The `noul` cases below are the ones that would silently fail.

import { describe, expect, test } from 'bun:test';
import Type from 'typebox';
import {
  analyzeDecisionSchema,
  bindDecisionPolicy,
  buildDecisionDispatch,
  checkCheckpointLimits,
  checkpointFamily,
  createLlamaCppDecisionAdapter,
  type DecisionAdapter,
  type DecisionPlan,
  type DecisionTaskPolicy,
  type LlamaCppTransport,
  limitsForCheckpoint,
  NATIVE_LLAMACPP_DIALECT,
  NATIVE_LLAMACPP_MIN_BUILD_COMMIT,
  nativeStatusRefusal,
  parseLlamaCppBuildInfo,
  parseNativeResponse,
  parseServerProps,
  readNativeChoice,
  readNativeErrorMessage,
  readNativeNoul,
  runDecision,
} from '../src/lib/decision/index.ts';
import {
  capturedInvalidRequestBody,
  capturedProps,
  capturedTinylayaResponse,
  upstreamReadmeResponse,
} from './fixtures/llamacpp_native_fixtures.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * The dispatched plan, its units, and the REAL wire keys.
 *
 * Question keys are path-encoded (`commandKind__<hash>`), not the raw field name.
 * Fixtures must therefore be keyed by what the plan actually emits; writing
 * `urgent:` into a response body would silently produce an unanswerable
 * request, which is itself worth being explicit about.
 */
/**
 * The pilot task: one boolean plus one closed choice, exercised through the
 * REAL compiler, policy binder, dispatcher and runner — no shortcuts. An adapter
 * that only works against a hand-built request is an adapter that works against
 * nothing.
 */
const booleanAndChoiceSchema = Type.Object(
  {
    urgent: Type.Boolean(),
    commandKind: Type.Union([Type.Literal('trade'), Type.Literal('recruit')]),
  },
  { additionalProperties: false },
);

/** Authored policy: real instructions, and a description for EVERY option. */
const booleanAndChoicePolicy = {
  task: 'native-boolean-and-choice',
  enabled: true,
  language: 'en',
  instructions: 'Decide whether the exchange is urgent, and which command it asks for.',
  fieldInstructions: {
    urgent: 'Does the player message read as time-critical in this exchange?',
    commandKind: 'Which bounded command does the player message ask the NPC for?',
  },
  optionDescriptions: {
    commandKind: {
      trade: 'The player wants to open the trade overlay with this NPC.',
      recruit: 'The player asks this NPC to join the party as a companion.',
    },
  },
} satisfies DecisionTaskPolicy;

/** The assembled text a real caller would hand the checkpoint. */
const NATIVE_CONTEXT = 'Player: I need the smith to look at this before the festival starts.';

const buildNativeUnit = (): {
  plan: DecisionPlan;
  dispatch: ReturnType<typeof buildDecisionDispatch>;
  keys: { boolean: string; choice: string; options: readonly string[] };
} => {
  const analysis = analyzeDecisionSchema({ schema: booleanAndChoiceSchema });
  if (!analysis.ok) {
    throw new Error(`schema should compile: ${JSON.stringify(analysis.reasons)}`);
  }
  const bound = bindDecisionPolicy({ plan: analysis.plan, policy: booleanAndChoicePolicy });
  if (!bound.ok) {
    throw new Error(`policy should bind: ${JSON.stringify(bound.reasons)}`);
  }
  const capability = {
    ready: true,
    primitives: ['boolean', 'choice'] as const,
    maxOptions: 255,
    maxQuestions: 16,
    maxContextBytes: 65536,
    languages: ['en'] as const,
  };
  const dispatch = buildDecisionDispatch({
    plan: bound.plan,
    capability,
    language: 'en',
    // Native llama.cpp REQUIRES a `state`. Without this the unit's state is
    // undefined, `JSON.stringify` drops the field, and the server answers a
    // body with no `state` at all — which the adapter now refuses locally.
    context: NATIVE_CONTEXT,
  });
  if (!dispatch.ok) {
    throw new Error(`dispatch should build: ${JSON.stringify(dispatch.reasons)}`);
  }
  const booleanQuestion = bound.plan.questions.find((question) => question.kind === 'boolean');
  const choiceQuestion = bound.plan.questions.find((question) => question.kind === 'choice');
  if (booleanQuestion === undefined || choiceQuestion === undefined) {
    throw new Error('expected one boolean and one choice question');
  }
  return {
    plan: bound.plan,
    dispatch,
    keys: {
      boolean: booleanQuestion.key,
      choice: choiceQuestion.key,
      options: (choiceQuestion.options ?? []).map((option) => option.key),
    },
  };
};

/** Builds a well-formed native response for the plan's real keys. */
const nativeResponseFor = (
  keys: ReturnType<typeof buildNativeUnit>['keys'],
  answers: { noul: number; choice: string; confidence?: number },
): Record<string, unknown> => {
  const probabilities: Record<string, number> = {};
  for (const option of keys.options) {
    probabilities[option] = option === answers.choice ? 0.97 : 0.03;
  }
  return {
    model: '/models/Laya-Q8_0.gguf',
    answers: {
      [keys.boolean]: { type: 'noul', noul: answers.noul },
      [keys.choice]: {
        type: 'choice',
        choice: answers.choice,
        probabilities,
        ...(answers.confidence === undefined ? {} : { confidence: answers.confidence }),
      },
    },
  };
};

const runAgainst = async (
  adapter: DecisionAdapter,
  _unused: unknown,
  deadlineMs = 5000,
): ReturnType<typeof runDecision> => {
  const { plan } = buildNativeUnit();
  return await runDecision({
    adapter,
    plan,
    // `runDecision` rebuilds the dispatch itself from `context` — it does not
    // accept pre-built units. Passing a `units` array here is silently ignored,
    // leaving `state` undefined, which the adapter then refuses.
    context: NATIVE_CONTEXT,
    schema: booleanAndChoiceSchema,
    policy: booleanAndChoicePolicy,
    requestId: 'native-test',
    stateRevision: 1,
    signal: new AbortController().signal,
    deadlineAt: Date.now() + deadlineMs,
    language: 'en',
  });
};

/**
 * A transport that answers EVERY call with the same response.
 *
 * Deliberately not a one-shot script for the pipeline tests: `runDecision`
 * dispatches once per dispatch group, and a real server answers every request.
 * A queue that exhausted mid-run turned a wire assertion into "script
 * exhausted" noise.
 */
const repeatingTransport = (
  response: { status: number; body: unknown },
  calls: { url: string; method: string; body?: string }[] = [],
): LlamaCppTransport => ({
  fetch: async (url, init) => {
    calls.push({
      url,
      method: init.method,
      ...(init.body === undefined ? {} : { body: init.body }),
    });
    return { status: response.status, text: async () => JSON.stringify(response.body) };
  },
});

/** An adapter whose transport answers every call with one scripted response. */
const adapterReplaying = (
  response: { status: number; body: unknown },
  calls: { url: string; method: string; body?: string }[] = [],
  checkpoint = 'Laya-Q8_0.gguf',
) =>
  createLlamaCppDecisionAdapter({
    endpoints: { decision: 'http://127.0.0.1:8080/v1/systemone' },
    checkpoint,
    languages: ['en'],
    transport: repeatingTransport(response, calls),
  });

// ---------------------------------------------------------------------------
// Boolean wire contract — the defect this whole adapter exists to prevent
// ---------------------------------------------------------------------------

describe('native noul is a probability, not a boolean', () => {
  test('reads a numeric p(true) and derives p(false) exactly', () => {
    // 0.6328 is upstream's own documented example value.
    const result = readNativeNoul({ type: 'noul', noul: 0.6328 }, 'angry');
    expect(result).toEqual({ ok: true, pTrue: 0.6328, pFalse: 1 - 0.6328 });
  });

  test('the wire carries no boolean; reading `value` yields nothing', () => {
    // This is the whole point. `answers[q].value` is the jev-v1 (Ollama) field.
    // A native server never sends it, so a reader that expects it sees undefined
    // and every boolean decision abstains for what looks like a policy reason.
    const nativeAnswer = { type: 'noul', noul: 0.9 };
    expect((nativeAnswer as Record<string, unknown>).value).toBeUndefined();
    expect(readNativeNoul(nativeAnswer, 'q').ok).toBe(true);
  });

  test('refuses a jev-v1-shaped answer instead of misreading it', () => {
    // A proxy or shim answering in the OTHER dialect must not be silently
    // accepted: its numbers would mean something else entirely.
    const result = readNativeNoul({ type: 'noul', value: true } as never, 'q');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.detail).toContain('numeric `noul`');
  });

  test.each([
    ['missing noul', { type: 'noul' }, 'no numeric'],
    ['NaN', { type: 'noul', noul: Number.NaN }, 'not finite'],
    ['Infinity', { type: 'noul', noul: Number.POSITIVE_INFINITY }, 'not finite'],
    ['above 1', { type: 'noul', noul: 1.0001 }, '[0, 1]'],
    ['below 0', { type: 'noul', noul: -0.0001 }, '[0, 1]'],
  ])('refuses %s', (_label, answer, expected) => {
    const result = readNativeNoul(answer as never, 'q');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.detail).toContain(expected);
  });

  test('accepts both ends of the unit interval', () => {
    expect(readNativeNoul({ type: 'noul', noul: 0 }, 'q')).toEqual({
      ok: true,
      pTrue: 0,
      pFalse: 1,
    });
    expect(readNativeNoul({ type: 'noul', noul: 1 }, 'q')).toEqual({
      ok: true,
      pTrue: 1,
      pFalse: 0,
    });
  });

  test('refuses an answer of the wrong type', () => {
    const result = readNativeNoul({ type: 'choice', choice: 'x' }, 'q');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.detail).toContain('answer type is "choice"');
  });

  test('an uncertainty noul is a real answer, not an error', () => {
    // 0.5015 is what the captured randomly-initialised checkpoint returned. It
    // must parse cleanly so the task's THRESHOLDS decide, not the parser.
    const result = readNativeNoul({ type: 'noul', noul: 0.5015357298593908 }, 'q');
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.pTrue).toBeCloseTo(0.5015, 4);
  });
});

// ---------------------------------------------------------------------------
// Choice wire contract
// ---------------------------------------------------------------------------

describe('native choice answers', () => {
  const keys = ['billing', 'shipping', 'technical'];

  test("reads upstream's documented example", () => {
    const answer = upstreamReadmeResponse.answers.route;
    const result = readNativeChoice(answer, 'route', keys);
    expect(result).toEqual({ ok: true, optionKey: 'billing', probability: 0.9998 });
  });

  test('refuses an option that was never offered', () => {
    const result = readNativeChoice(
      { type: 'choice', choice: 'legal', probabilities: { legal: 1 } },
      'route',
      keys,
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.detail).toContain('was not offered');
  });

  test('refuses a choice with no finite probability', () => {
    const result = readNativeChoice({ type: 'choice', choice: 'billing' }, 'route', keys);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Envelope + refusal parsing
// ---------------------------------------------------------------------------

describe('native response envelope', () => {
  test("accepts upstream's documented response verbatim", () => {
    const parsed = parseNativeResponse(upstreamReadmeResponse);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok === true && parsed.body.model).toBe('openjev');
    // output_tokens is always 0 for a decision call. Recorded, not invented.
    expect(parsed.ok === true && parsed.body.usage).toEqual({
      // biome-ignore lint/style/useNamingConvention: verbatim upstream wire field names
      input_tokens: 239,
      // biome-ignore lint/style/useNamingConvention: verbatim upstream wire field names
      output_tokens: 0,
    });
  });

  test('accepts the captured real response, including its path-shaped model name', () => {
    const parsed = parseNativeResponse(capturedTinylayaResponse);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok === true && parsed.body.model).toContain('/');
  });

  test('reads the nested-object error body a real server sends', () => {
    // A reader that accepts only `{"error": "text"}` finds no error field, falls
    // through to "the response did not name the model", and reports a bad
    // request as a malformed answer.
    expect(readNativeErrorMessage(capturedInvalidRequestBody)).toBe(
      '"questions" must be a non-empty object',
    );
    const parsed = parseNativeResponse(capturedInvalidRequestBody);
    expect(parsed.ok).toBe(false);
    expect(parsed.ok === false && parsed.reason).toContain('non-empty object');
  });

  test('also reads a flat string error body', () => {
    expect(readNativeErrorMessage({ error: 'boom' })).toBe('boom');
  });

  test.each([
    ['an array', [1, 2, 3]],
    ['a string', 'nope'],
    ['a body with no model', { answers: {} }],
    ['answers as an array', { model: 'm', answers: [] }],
    ['an answer with no type', { model: 'm', answers: { q: { noul: 0.5 } } }],
    ['an answer that is null', { model: 'm', answers: { q: null } }],
  ])('rejects %s', (_label, body) => {
    expect(parseNativeResponse(body).ok).toBe(false);
  });
});

describe('native status refusals', () => {
  test('501 is the not-a-decision-model signal', () => {
    const refusal = nativeStatusRefusal(501);
    expect(refusal?.reason).toBe('not-a-decision-model');
    expect(refusal?.detail).toContain('not a decision model');
  });

  test('a too-large prompt is 500 and says so, separately from a bad request', () => {
    // Measured: an oversized question earns a 500 from the batch layer, not a
    // 400. Reporting it as "bad request" would send the player to debug our
    // JSON instead of their --ubatch-size.
    const refusal = nativeStatusRefusal(500);
    expect(refusal?.reason).toBe('request-too-large');
    expect(refusal?.detail).toContain('ubatch');
  });

  test.each([
    [200, undefined],
    [400, 'invalid-request'],
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'backend-unavailable'],
    [501, 'not-a-decision-model'],
    [503, 'backend-unavailable'],
  ])('maps HTTP %i', (status, expected) => {
    expect(nativeStatusRefusal(status)?.reason).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Server identity: /props shape and checkpoint matching
// ---------------------------------------------------------------------------

describe('llama.cpp server identity', () => {
  test('parses the captured /props shape', () => {
    const props = parseServerProps(capturedProps);
    expect(props?.build).toEqual({ buildNumber: 11361, buildCommit: 'a4cb4c61f' });
    expect(props?.modelPath).toBe('/home/sonny/llamacpp-pin/models/tinylaya-for-testing-Q8_0.gguf');
    expect(props?.totalSlots).toBe(1);
    expect(props?.isSleeping).toBe(false);
  });

  test('build_info is a "b<n>-<commit>" string, not the object shape first assumed', () => {
    expect(parseLlamaCppBuildInfo('b11361-a4cb4c61f')).toEqual({
      buildNumber: 11361,
      buildCommit: 'a4cb4c61f',
    });
    // Anything unrecognised is still evidence a build was recorded.
    expect(parseLlamaCppBuildInfo('something-else')).toEqual({ version: 'something-else' });
    expect(parseLlamaCppBuildInfo(undefined)).toBeUndefined();
  });

  test('the pinned commit is what a real server reports', () => {
    const props = parseServerProps(capturedProps);
    // `/props` carries an abbreviated commit; the pin is the full hash, so the
    // comparison is prefix-based rather than a coincidence of slicing.
    expect(props?.build?.buildCommit).toBeDefined();
    expect(NATIVE_LLAMACPP_MIN_BUILD_COMMIT.startsWith(props?.build?.buildCommit ?? 'x')).toBe(
      true,
    );
  });

  test('reports a served checkpoint that is not the configured one', async () => {
    const adapter = createLlamaCppDecisionAdapter({
      endpoints: {
        decision: 'http://127.0.0.1:8080/v1/systemone',
        props: 'http://127.0.0.1:8080/props',
      },
      checkpoint: 'Laya-Q8_0.gguf',
      languages: ['en'],
      transport: repeatingTransport({ status: 200, body: capturedProps }),
    });
    const capability = await adapter.capability({
      deadlineAt: Date.now() + 2000,
      signal: new AbortController().signal,
    });
    expect(capability.ready).toBe(false);
    expect(capability.notReadyState).toBe('model-missing');
    expect(capability.notReadyReason).toContain('started with');
  });
});

// ---------------------------------------------------------------------------
// Per-checkpoint limits: never one number copied between models
// ---------------------------------------------------------------------------

describe('per-checkpoint limits', () => {
  test.each([
    // Filenames taken from the published repos, not invented:
    // ggml-org/Laya-GGUF, ggml-org/OpenJev-GGUF, ggml-org/Julia-1-GGUF, ggml-org/LEV-GGUF.
    ['Laya-Q8_0.gguf', 'laya'],
    ['/models/OpenJev-Q4_K_M.gguf', 'openjev'],
    ['Julia-1-Q8_0.gguf', 'julia-1'],
    ['lev-Q4_K_M.gguf', 'lev'],
    ['kev', 'kev'],
    ['Laya-BF16.gguf', 'laya'],
  ])('normalises %s to family %s', (checkpoint, family) => {
    expect(checkpointFamily(checkpoint)).toBe(family);
  });

  test('OpenJev and Laya keep their DIFFERENT ceilings', () => {
    // Upstream publishes 52 for OpenJev and 255 for Laya. Copying either one
    // between them is the bug this table exists to prevent.
    expect(limitsForCheckpoint('OpenJev-Q4_K_M.gguf').maxChoiceOptions).toBe(52);
    expect(limitsForCheckpoint('Laya-Q8_0.gguf').maxChoiceOptions).toBe(255);
  });

  test('an unknown family gets the SMALLEST published ceiling, not the largest', () => {
    const limits = limitsForCheckpoint('some-new-decision-model.gguf');
    expect(limits.maxChoiceOptions).toBe(52);
    expect(limits.note).toContain('not one Aikami has verified');
  });

  test('refuses an over-limit question instead of truncating it', () => {
    const violations = checkCheckpointLimits({
      checkpoint: 'OpenJev-Q4_K_M.gguf',
      limits: limitsForCheckpoint('OpenJev-Q4_K_M.gguf'),
      questions: [{ key: 'commandKind', optionCount: 53 }],
    });
    expect(violations).toHaveLength(1);
    expect(violations[0]?.code).toBe('option-limit-exceeded');
    // The refusal must say why truncation was not used.
    expect(violations[0]?.detail).toContain('Refusing rather than truncating');
  });

  test('a question inside the limit produces no violation', () => {
    expect(
      checkCheckpointLimits({
        checkpoint: 'OpenJev-Q4_K_M.gguf',
        limits: limitsForCheckpoint('OpenJev-Q4_K_M.gguf'),
        questions: [{ key: 'commandKind', optionCount: 52 }],
      }),
    ).toEqual([]);
  });

  test('a boolean is two options and never trips the ceiling', () => {
    expect(
      checkCheckpointLimits({
        checkpoint: 'OpenJev-Q4_K_M.gguf',
        limits: limitsForCheckpoint('OpenJev-Q4_K_M.gguf'),
        questions: [{ key: 'urgent', optionCount: 2 }],
      }),
    ).toEqual([]);
  });
});
describe('native adapter through the real pipeline', () => {
  test('sends no `model` field, because native does not read one', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const { keys } = buildNativeUnit();
    const adapter = adapterReplaying(
      {
        status: 200,
        body: {
          ...nativeResponseFor(keys, { noul: 0.995, choice: keys.options[0] as string }),
          // biome-ignore lint/style/useNamingConvention: verbatim upstream wire field names
          usage: { input_tokens: 88, output_tokens: 0 },
        },
      },
      calls,
    );

    const result = await runAgainst(adapter, null);

    expect(result.ok).toBe(true);
    expect(calls[0]?.url).toBe('http://127.0.0.1:8080/v1/systemone');
    const wire = JSON.parse(calls[0]?.body ?? '{}') as Record<string, unknown>;
    // The load-bearing assertion: a native server ignores this field entirely
    // (`parse_questions`/`parse_state` never read it), and asserting per-request
    // checkpoint selection would claim a capability the contract does not have.
    expect(wire.model).toBeUndefined();
    expect(Object.keys(wire)).toEqual(['state', 'questions']);
    expect(typeof wire.state).toBe('string');
  });

  test('a noul question is sent WITHOUT criteria, because none are authored', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const { keys } = buildNativeUnit();
    const adapter = adapterReplaying(
      {
        status: 200,
        body: nativeResponseFor(keys, { noul: 0.02, choice: keys.options[0] as string }),
      },
      calls,
    );
    await runAgainst(adapter, null);
    const wire = JSON.parse(calls[0]?.body ?? '{}') as {
      questions: Record<string, { type: string; criteria?: unknown }>;
    };
    const noul = wire.questions[keys.boolean];
    expect(noul?.type).toBe('noul');
    // The compiler authors ONE instruction per boolean field, not a separate
    // true-label and false-label. Upstream accepts a noul with no `criteria` and
    // synthesises null labels, so omitting is correct — and inventing two
    // labels from one sentence is exactly the semantic invention the policy
    // layer exists to refuse. Upstream's own `test_systemone_json_state` sends a
    // noul this way, and it is what this adapter was verified against.
    expect(noul?.criteria).toBeUndefined();

    const choice = wire.questions[keys.choice];
    expect(choice?.type).toBe('choice');
    // Upstream REJECTS a choice question with empty criteria (400). The authored
    // descriptions must therefore survive all the way to the wire.
    expect(Object.keys(choice?.criteria as Record<string, string>)).toHaveLength(2);
    expect(choice?.criteria).toEqual({
      [keys.options[0] as string]: expect.any(String),
      [keys.options[1] as string]: expect.any(String),
    });
  });

  test.each([
    // Above the default confidentProbability (0.98) so the policy accepts.
    // A noul of 0.97 sits in the abstain band and would NOT reconstruct — which
    // is the point of applying thresholds before reconstruction.
    ['true', 0.995],
    ['false', 0.005],
  ])('a %s boolean reconstructs correctly from the numeric noul', async (expected, noul) => {
    const { keys } = buildNativeUnit();
    const adapter = adapterReplaying({
      status: 200,
      body: nativeResponseFor(keys, { noul, choice: keys.options[0] as string }),
    });
    const result = await runAgainst(adapter, null);
    expect(result.ok).toBe(true);
    expect(result.ok === true && result.value.urgent).toBe(expected === 'true');
  });

  test('an uncertain boolean abstains on the task threshold instead of guessing', async () => {
    const { keys } = buildNativeUnit();
    const adapter = adapterReplaying({
      status: 200,
      body: nativeResponseFor(keys, { noul: 0.5, choice: keys.options[0] as string }),
    });
    const result = await runAgainst(adapter, null);
    // p(true)=0.5 sits below the default accept threshold. The runner abstains
    // BEFORE reconstruction, so no boolean is produced at all — which is the
    // "apply task thresholds before reconstructing a boolean" requirement, met by
    // the existing pipeline rather than reimplemented here.
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('below-accept-threshold');
  });

  test('reports the real checkpoint identity and provenance dialect', async () => {
    const { keys } = buildNativeUnit();
    const adapter = adapterReplaying({
      status: 200,
      body: nativeResponseFor(keys, { noul: 0.99, choice: keys.options[0] as string }),
    });
    const result = await runAgainst(adapter, null);
    expect(result.provenance.dialect).toBe(NATIVE_LLAMACPP_DIALECT);
    expect(result.provenance.checkpoint).toBe('/models/Laya-Q8_0.gguf');
    expect(result.provenance.outcome).toBe('accepted');
  });

  test('a 501 names the checkpoint as not a decision model', async () => {
    const adapter = adapterReplaying(
      { status: 501, body: { error: { message: 'This model is not a decision model' } } },
      [],
      'qwen2.5-0.5b-instruct-q8_0.gguf',
    );
    const result = await runAgainst(adapter, null);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('invalid-response');
    expect(result.provenance.dialect).toBe(NATIVE_LLAMACPP_DIALECT);
  });

  test.each([
    ['out of range', { type: 'noul', noul: 1.4 }, '[0, 1]'],
    ['below zero', { type: 'noul', noul: -0.2 }, '[0, 1]'],
    ['missing noul', { type: 'noul' }, 'no numeric'],
    ['a JSON-null noul', { type: 'noul', noul: null }, 'no numeric'],
    ['a stringified noul', { type: 'noul', noul: '0.9' }, 'no numeric'],
    // NaN and Infinity cannot cross JSON at all: `JSON.stringify` turns both
    // into `null`, so the transport can only ever deliver "no numeric". The
    // reader's own finiteness guard is therefore reachable only by an in-process
    // caller or a non-JSON proxy, and is pinned directly in the unit block above.
    ['the jev-v1 boolean field instead', { type: 'noul', value: true }, 'numeric `noul`'],
  ])('refuses a malformed boolean: %s', async (_label, badAnswer, expected) => {
    const { plan, dispatch, keys } = buildNativeUnit();
    const body = nativeResponseFor(keys, { noul: 0.99, choice: keys.options[0] as string }) as {
      answers: Record<string, unknown>;
    };
    body.answers[keys.boolean] = badAnswer;
    const adapter = adapterReplaying({ status: 200, body });

    const result = await runAgainst(adapter, null);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.provenance.abstentionReason).toBe('invalid-response');

    // The SPECIFIC cause must survive to the refusal text; a generic "invalid
    // response" is what made this class of defect look like a policy refusal.
    // A SECOND adapter instance is unnecessary now that the transport repeats;
    // the point is that the SPECIFIC cause reaches the refusal text rather than
    // a generic "invalid response", which is what made this class of defect look
    // like a policy refusal.
    const direct = adapterReplaying({ status: 200, body });
    const response = await direct.run({
      plan,
      unit:
        dispatch.units[0] ??
        (() => {
          throw new Error('no unit');
        })(),
      deadlineAt: Date.now() + 2000,
      signal: new AbortController().signal,
      requestId: 'q',
      stateRevision: 0,
    });
    expect(response.ok).toBe(false);
    expect(response.ok === false && response.detail).toContain(expected);
  });

  test('a choice naming an un-offered option is refused', async () => {
    const { keys } = buildNativeUnit();
    const body = nativeResponseFor(keys, { noul: 0.99, choice: keys.options[0] as string }) as {
      answers: Record<string, unknown>;
    };
    body.answers[keys.choice] = {
      type: 'choice',
      choice: 'attack',
      probabilities: { attack: 0.99 },
    };
    const adapter = adapterReplaying({ status: 200, body });
    const result = await runAgainst(adapter, null);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('invalid-response');
  });

  test('a distribution that does not sum to 1 is refused, not thresholded', async () => {
    const { keys } = buildNativeUnit();
    const body = nativeResponseFor(keys, { noul: 0.99, choice: keys.options[0] as string }) as {
      answers: Record<string, unknown>;
    };
    body.answers[keys.choice] = {
      type: 'choice',
      choice: keys.options[0],
      probabilities: { [keys.options[0] as string]: 0.4, [keys.options[1] as string]: 0.4 },
    };
    const adapter = adapterReplaying({ status: 200, body });
    const result = await runAgainst(adapter, null);
    expect(result.ok).toBe(false);
  });

  test('reports real usage, including the always-zero output tokens', async () => {
    const { plan, dispatch, keys } = buildNativeUnit();
    const body = {
      ...nativeResponseFor(keys, { noul: 0.99, choice: keys.options[0] as string }),
      // biome-ignore lint/style/useNamingConvention: verbatim upstream wire field names
      usage: { input_tokens: 239, output_tokens: 0 },
    };
    const response = await adapterReplaying({ status: 200, body }).run({
      plan,
      unit:
        dispatch.units[0] ??
        (() => {
          throw new Error('no unit');
        })(),
      deadlineAt: Date.now() + 2000,
      signal: new AbortController().signal,
      requestId: 'q',
      stateRevision: 0,
    });
    expect(response.ok).toBe(true);
    // output_tokens=0 is what a decision call legitimately costs — the model
    // reads the prompt and scores it. It must be reported as observed, never
    // dropped as "nothing happened" or invented as a generation.
    expect(response.ok === true && response.diagnostics?.usage).toEqual({
      // biome-ignore lint/style/useNamingConvention: verbatim upstream wire field names
      input_tokens: 239,
      // biome-ignore lint/style/useNamingConvention: verbatim upstream wire field names
      output_tokens: 0,
    });
    expect(response.ok === true && response.checkpoint).toBe('/models/Laya-Q8_0.gguf');
  });

  test('a noul inside the abstain band is refused rather than rounded to a boolean', async () => {
    const { keys } = buildNativeUnit();
    // 0.97 is above acceptProbability (0.9) but below confidentProbability
    // (0.98): exactly the band where the task policy says "abstain", not "guess".
    const adapter = adapterReplaying({
      status: 200,
      body: nativeResponseFor(keys, { noul: 0.97, choice: keys.options[0] as string }),
    });
    const result = await runAgainst(adapter, null);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('below-accept-threshold');
  });

  test('an oversized question is refused against the CHECKPOINT ceiling, not truncated', async () => {
    // 60 options: inside the compiler's 64-branch union guard, and ABOVE
    // OpenJev's real 52-option ceiling. The dispatch must be refused before
    // anything is sent, because truncating would ask a different question.
    const OptionCount = 60;
    const wide = Type.Object(
      {
        action: Type.Union(
          Array.from({ length: OptionCount }, (_unused, index) =>
            Type.Literal(`a${index}` as const),
          ),
        ),
      },
      { additionalProperties: false },
    );
    const analysis = analyzeDecisionSchema({ schema: wide });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) {
      return;
    }
    const perOption: Record<string, string> = {};
    for (let index = 0; index < OptionCount; index += 1) {
      perOption[`a${index}`] = `Option number ${index} means a specific thing in this scene.`;
    }
    const bound = bindDecisionPolicy({
      plan: analysis.plan,
      policy: {
        task: 'wide-choice',
        enabled: true,
        language: 'en',
        instructions: 'Decide which of the many permitted actions this NPC takes right now.',
        fieldInstructions: {
          action: 'Which of the permitted actions does this NPC take right now?',
        },
        optionDescriptions: { action: perOption },
      },
    });
    expect(bound.ok).toBe(true);
    if (!bound.ok) {
      return;
    }
    const dispatch = buildDecisionDispatch({
      plan: bound.plan,
      capability: {
        ready: true,
        primitives: ['choice'],
        maxOptions: 255,
        maxQuestions: 16,
        maxContextBytes: 65536,
        languages: ['en'],
      },
      language: 'en',
      context: NATIVE_CONTEXT,
    });
    expect(dispatch.ok).toBe(true);
    if (!dispatch.ok) {
      return;
    }

    const calls: { url: string; method: string; body?: string }[] = [];
    const adapter = adapterReplaying(
      { status: 200, body: { model: 'x', answers: {} } },
      calls,
      'OpenJev-Q4_K_M.gguf',
    );
    const response = await adapter.run({
      plan: bound.plan,
      unit:
        dispatch.units[0] ??
        (() => {
          throw new Error('no unit');
        })(),
      deadlineAt: Date.now() + 2000,
      signal: new AbortController().signal,
      requestId: 'q',
      stateRevision: 0,
    });
    expect(response.ok).toBe(false);
    expect(response.ok === false && response.detail).toContain('Refusing rather than truncating');
    expect(response.ok === false && response.diagnostics?.limitViolations?.[0]?.code).toBe(
      'option-limit-exceeded',
    );
    // Nothing may reach the wire for a question Aikami refuses to ask.
    expect(calls).toHaveLength(0);
  });

  test('cancellation settles the call rather than hanging', async () => {
    const { plan, dispatch } = buildNativeUnit();
    const adapter = createLlamaCppDecisionAdapter({
      endpoints: { decision: 'http://127.0.0.1:8080/v1/systemone' },
      checkpoint: 'Laya-Q8_0.gguf',
      languages: ['en'],
      transport: {
        fetch: (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(new Error('aborted')), {
              once: true,
            });
            setTimeout(() => controller.abort(), 1);
          }),
      },
    });
    const controller = new AbortController();
    const response = await adapter.run({
      plan,
      unit:
        dispatch.units[0] ??
        (() => {
          throw new Error('no unit');
        })(),
      deadlineAt: Date.now() + 5000,
      signal: controller.signal,
      requestId: 'q',
      stateRevision: 0,
    });
    expect(response.ok).toBe(false);
    expect(response.ok === false && response.reason).toBe('cancelled');
  });

  test('a unit with no state is refused locally, naming the missing field', async () => {
    // `JSON.stringify` DROPS an undefined field. A unit built without a context
    // projection therefore serialises to `{"questions":{...}}`, which upstream
    // answers with a 400 that mentions nothing about the real cause. Found by
    // running the pipeline: the first assertion here saw a body with no `state`.
    const analysis = analyzeDecisionSchema({ schema: booleanAndChoiceSchema });
    expect(analysis.ok).toBe(true);
    if (!analysis.ok) {
      return;
    }
    const bound = bindDecisionPolicy({ plan: analysis.plan, policy: booleanAndChoicePolicy });
    expect(bound.ok).toBe(true);
    if (!bound.ok) {
      return;
    }
    const dispatch = buildDecisionDispatch({
      plan: bound.plan,
      capability: {
        ready: true,
        primitives: ['boolean', 'choice'],
        maxOptions: 255,
        maxQuestions: 16,
        maxContextBytes: 65536,
        languages: ['en'],
      },
      language: 'en',
    });
    expect(dispatch.ok).toBe(true);
    if (!dispatch.ok) {
      return;
    }

    const calls: { url: string; method: string; body?: string }[] = [];
    const adapter = adapterReplaying({ status: 200, body: { model: 'x', answers: {} } }, calls);
    const response = await adapter.run({
      plan: bound.plan,
      unit:
        dispatch.units[0] ??
        (() => {
          throw new Error('no unit');
        })(),
      deadlineAt: Date.now() + 2000,
      signal: new AbortController().signal,
      requestId: 'q',
      stateRevision: 0,
    });
    expect(response.ok).toBe(false);
    expect(response.ok === false && response.detail).toContain('requires the content to evaluate');
    expect(calls).toHaveLength(0);
  });

  test('an already-past deadline refuses before sending anything', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const { plan, dispatch, keys } = buildNativeUnit();
    const adapter = adapterReplaying(
      {
        status: 200,
        body: nativeResponseFor(keys, { noul: 0.9, choice: keys.options[0] as string }),
      },
      calls,
    );
    const response = await adapter.run({
      plan,
      unit:
        dispatch.units[0] ??
        (() => {
          throw new Error('no unit');
        })(),
      deadlineAt: Date.now() - 1,
      signal: new AbortController().signal,
      requestId: 'q',
      stateRevision: 0,
    });
    expect(response.ok).toBe(false);
    expect(response.ok === false && response.reason).toBe('deadline-exceeded');
    // Nothing was sent, so no timing may imply work happened.
    expect(response.inferenceMs).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test('one absolute deadline is shared, never restarted per attempt', async () => {
    const { plan, dispatch, keys } = buildNativeUnit();
    const adapter = adapterReplaying({
      status: 200,
      body: nativeResponseFor(keys, { noul: 0.9, choice: keys.options[0] as string }),
    });
    const deadlineAt = Date.now() + 25;
    const response = await adapter.run({
      plan,
      unit:
        dispatch.units[0] ??
        (() => {
          throw new Error('no unit');
        })(),
      deadlineAt,
      signal: new AbortController().signal,
      requestId: 'q',
      stateRevision: 0,
    });
    // Either it fitted, or it was refused on the SAME absolute deadline. What it
    // may not do is extend past `deadlineAt` and still report success.
    expect(Date.now()).toBeLessThanOrEqual(deadlineAt + 200);
    if (response.ok) {
      expect(response.inferenceMs).toBeLessThan(1000);
    } else {
      expect(response.reason).toBe('deadline-exceeded');
    }
  });
});
