// apps/e2e/scripts/ai_envelope_thinking_probe.ts
//
// Issue #382 follow-up: what is the C-401 call-2 budget spent on, and can the
// reasoning channel be turned off ON THE ROUTE THE CLIENT USES?
//
// The envelope schema was reduced in #414 (narrative echo removed) and the
// extraction path still failed every measured production call at its 6 000 ms
// deadline. The wire log cannot answer why: a request cut off at its deadline
// receives no body, so it reports `aborted` and no token counts. This probe
// asks the provider directly.
//
// It reproduces the production request: the same schema, compiled by the SAME
// compiler the adapter uses, the same call-2 prompt, the same narrative, and
// the same body the adapter actually sends. That last part is the point of this
// revision, and two earlier claims were wrong because of it:
//
//   - The adapter routes `provider === 'ollama'` to NATIVE `/api/chat`
//     (`resolveChatUrl` in `text_adapter_openai_compatible.ts`), not to `/v1`.
//     Every wire call captured in #413 and #414 went to `/api/chat`. The
//     `/v1/chat/completions` surface in this file is measured anyway, because
//     it is the route the earlier report wrongly assumed and the claim has to
//     be settled either way — but it is NOT the production dialogue route.
//   - `buildGenerationParams` returns `{}` for Ollama, so the production
//     `/api/chat` body carries NO `options`: no `num_predict`, no
//     `temperature`. The earlier probe sent `num_predict: 800`, which put a
//     token cap on production that production does not have, and sent
//     `temperature: 0.3`, which production also never sends. Both changed the
//     sampling and therefore the reasoning length being measured.
//
// Every variant is repeated (`--reps`) because a single sample cannot
// distinguish a reliable control from one lucky call: with reasoning enabled
// this model's output length varies by more than 3x between identical calls.
//
//   bun run --cwd apps/e2e probe:ai-envelope-thinking
//   bun run --cwd apps/e2e probe:ai-envelope-thinking -- --reps 5

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NpcDialogueAiEnvelopeSchema, NpcDialogueExtractionSchema } from '@aikami/schemas';
import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

/** The provider the client is configured against, by default. */
const ENDPOINT = process.env.AIKAMI_PROBE_ENDPOINT ?? 'http://127.0.0.1:11434';
const MODEL = process.env.AIKAMI_PROBE_MODEL ?? 'ornith-1.5:9b';
/** The `envelope` task's `budgetMs`. Production sends no `num_predict`. */
const BUDGET_MS = 6_000;
const REPS = Number(process.env.AIKAMI_PROBE_REPS ?? readRepsFlag() ?? 3);
/**
 * Restricts the run to variants whose label contains this substring, so the
 * two decisive controls can be repeated many times without paying for the
 * slow ones.
 */
const ONLY = process.env.AIKAMI_PROBE_ONLY;
/** `/v1` needs a ceiling; production's native body has none. */
const V1_MAX_TOKENS = 800;

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const OUT_DIR = join(REPO_ROOT, '.evidence', '382-baseline', 'envelope-thinking');

/** Repeats per variant, overridable so a long run needs no code change. */
function readRepsFlag(): number | undefined {
  const index = process.argv.indexOf('--reps');
  const raw = index >= 0 ? process.argv[index + 1] : undefined;
  const parsed = raw === undefined ? Number.NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/** Stand-in for one streamed call-1 narrative, as the elder produced it. */
const NARRATIVE =
  '"Greetings, traveler. Our village has need of your aid. The ward stone at the mill has ' +
  'faded, and if it fades fully the Crimson Covenant will find us. I have prepared a writ ' +
  'of passage and a task that only someone with a steady hand should take."';

const PERSONA =
  'Elder Thalia is the keeper of the ward records in Emberwatch. Voice: warm but measured. ' +
  'Manner: unhurried, deliberate, rarely raises her voice.';

const ALLOWED_ACTIONS = 'trade, offerQuest, skillCheck';

/** The call-2 system prompt, verbatim from `buildDialogueExtractionSystemPrompt`. */
const extractionPrompt = [
  '[NPC CONTEXT]',
  PERSONA,
  'You are Elder Thalia, staying in character.',
  '',
  '[EXTRACTION]',
  'The narrative below was ALREADY spoken to the player, verbatim.',
  'Do not rewrite, summarize, quote, continue or return it.',
  '',
  'Return only the state-changing metadata for that narrative:',
  '- "command": optional, one of the allowed actions below.',
  '- "choices": optional array of at most 4 player options, each with "id",',
  '  "label", and optionally "command" or "nextDialogueKey".',
  '',
  'Return no other fields, and no prose outside the JSON.',
  `Allowed actions: ${ALLOWED_ACTIONS}.`,
  'Omit both fields when the narrative implies neither a command nor a choice.',
].join('\n');

/**
 * The pre-#414 call-2 prompt, from the service's own former
 * `_buildExtractionSystemPrompt`, verbatim.
 *
 * Required, not optional: the legacy row is only a baseline if it is sent the
 * prompt the legacy schema was actually used with. That prompt ends by telling
 * the model to reproduce the narrative, which the shipped prompt explicitly
 * forbids — so pairing the legacy schema with the shipped prompt measures a
 * request that never existed and makes the two schemas incomparable.
 */
const legacyPrompt = [
  '[NPC CONTEXT]',
  PERSONA,
  'You are Elder Thalia, staying in character.',
  '',
  '[EXTRACTION]',
  'You are given an NPC narrative that was just spoken to the player.',
  'Extract the structured dialogue envelope from it:',
  '"narrative" (string, required),',
  'optionally "command" (one of the allowed actions),',
  'and optionally "choices" (array of player options, at most 4).',
  'Each choice has "id", "label", and optionally "command" or "nextDialogueKey".',
  `Allowed actions: ${ALLOWED_ACTIONS}.`,
  'Do not invent new narrative — reuse the given narrative verbatim.',
].join('\n');

/**
 * The gateway's own schema wrapper, verbatim from `generateStructured` in
 * `text_adapter_openai_compatible.ts`.
 *
 * The schema is serialised raw, exactly as the gateway's `generateStructured`
 * would after `createSchemaCompiler().compile(...)`. That is not an
 * approximation: for `NpcDialogueExtractionSchema` the compiler's
 * `enforceStrictSchema` is a no-op, and the two strings are byte-identical
 * (8 671 chars, ~2 233 prompt tokens). Re-verify with:
 *
 *   createSchemaCompiler().compile({schema, schemaName}) vs NpcDialogueExtractionSchema
 *
 * If that ever stops holding, the probe must import the real compiler rather
 * than keep a hand-copied notion of "what the adapter sends" — the prompt is
 * the largest single block in the request, so a divergence here would quietly
 * measure a different request than the one that fails.
 */
const schemaInstruction = (schema: TSchema): string =>
  [
    'You are a structured data extraction tool.',
    'Your response MUST be valid JSON that conforms to the following JSON Schema:',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
    'Respond ONLY with the JSON object. No markdown fences, no explanations.',
    'Do not include any properties not defined in the schema.',
  ].join('\n');

const extractionInstruction = schemaInstruction(NpcDialogueExtractionSchema);
const legacyInstruction = schemaInstruction(NpcDialogueAiEnvelopeSchema);

type ProbeResult = {
  readonly label: string;
  readonly surface: 'native' | 'openai-compatible' | 'error';
  readonly control: string;
  readonly wallMs: number;
  readonly withinBudget: boolean;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningChars: number;
  readonly answerChars: number;
  /**
   * Whether the answer parses as JSON AND satisfies the schema it was asked
   * for.
   *
   * Recorded separately from `withinBudget` on purpose: the two answer
   * different questions, and conflating them is how a fast wrong answer gets
   * reported as a success. `null` means "no answer to validate" — a request cut
   * off at its deadline produced nothing, which is not the same as producing
   * something bad.
   */
  readonly answerValid: boolean | null;
  /** Why the answer failed, for the same reason. */
  readonly answerProblem?: string;
  /** The COMPLETE answer, untruncated, so the artifact can be re-validated. */
  readonly answer: string;
  readonly reasoningHead: string;
  /** Every key the provider's message object carried, for shape discovery. */
  readonly messageKeys: string[];
};

/**
 * Parses the model's answer and checks it against the schema it was asked for.
 *
 * Markdown fences are stripped first because the gateway's `sanitizeJsonResponse`
 * tolerates them and the model emits them unprompted; a fence is a formatting
 * habit, not a schema violation, and recording it as one would misattribute the
 * failure.
 *
 * `null` means "there was no answer to validate", which is what a request cut
 * off at its deadline produces. That is reported as its own state rather than
 * folded into either true or false.
 */
const validateAnswer = (
  raw: string,
  schema: TSchema,
): { valid: boolean | null; problem?: string } => {
  if (raw.trim().length === 0) {
    return { valid: null, problem: 'no answer' };
  }
  const unfenced = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch (error) {
    return { valid: false, problem: `unparseable: ${String(error).slice(0, 120)}` };
  }
  try {
    return Value.Check(schema, parsed)
      ? { valid: true }
      : { valid: false, problem: 'parsed but does not satisfy the schema' };
  } catch (error) {
    // A schema the checker cannot handle is a failure, never a silent pass.
    return { valid: false, problem: `validator threw: ${String(error).slice(0, 120)}` };
  }
};

const post = async (path: string, body: Record<string, unknown>, timeoutMs: number) => {
  const response = await fetch(`${ENDPOINT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as Record<string, unknown>;
};

/** One native `/api/chat` call — THE production route for the Ollama provider. */
const probeNative = async (options: {
  label: string;
  control: string;
  prompt: string;
  instruction: string;
  schema: TSchema;
  extra?: Record<string, unknown>;
}): Promise<ProbeResult> => {
  const { label, control, prompt, instruction, schema, extra } = options;
  const startedAt = Date.now();
  const body = await post(
    '/api/chat',
    {
      model: MODEL,
      messages: [
        { role: 'system', content: prompt },
        { role: 'system', content: instruction },
        { role: 'user', content: NARRATIVE },
      ],
      stream: false,
      ...extra,
    },
    120_000,
  );
  const wallMs = Date.now() - startedAt;
  const message = (body.message ?? {}) as { content?: string; thinking?: string };
  const answer = message.content ?? '';
  const reasoning = message.thinking ?? '';
  const verdict = validateAnswer(answer, schema);
  return {
    label,
    surface: 'native',
    control,
    wallMs,
    withinBudget: wallMs <= BUDGET_MS,
    promptTokens: Number(body.prompt_eval_count ?? 0),
    completionTokens: Number(body.eval_count ?? 0),
    reasoningChars: reasoning.length,
    answerChars: answer.length,
    answerValid: verdict.valid,
    answerProblem: verdict.problem,
    // The full answer, not a prefix: the artifact has to be re-validatable by
    // whoever reads it next, and a truncated body cannot be checked.
    answer,
    reasoningHead: reasoning.slice(0, 300),
    messageKeys: Object.keys(message),
  };
};

/**
 * The OpenAI-compatible surface.
 *
 * Measured because the previous report treated it as the production route. It
 * is not: `resolveChatUrl` sends the `ollama` provider to `/api/chat`. It is
 * still worth settling, because `/v1` is what a BYOK OpenAI-compatible provider
 * uses, and because the reasoning-control question differs per surface.
 */
const probeOpenAiCompatible = async (options: {
  label: string;
  control: string;
  extra: Record<string, unknown>;
}): Promise<ProbeResult> => {
  const { label, control, extra } = options;
  const startedAt = Date.now();
  const body = await post(
    '/v1/chat/completions',
    {
      model: MODEL,
      messages: [
        { role: 'system', content: extractionPrompt },
        { role: 'system', content: extractionInstruction },
        { role: 'user', content: NARRATIVE },
      ],
      stream: false,
      max_tokens: V1_MAX_TOKENS,
      temperature: 0.3,
      ...extra,
    },
    120_000,
  );
  const wallMs = Date.now() - startedAt;
  const choices = (body.choices ?? []) as ReadonlyArray<{
    message?: { content?: string; reasoning_content?: string; reasoning?: string };
  }>;
  const message = choices[0]?.message ?? {};
  const answer = message.content ?? '';
  const reasoning = message.reasoning_content ?? message.reasoning ?? '';
  const usage = (body.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
  const verdict = validateAnswer(answer, NpcDialogueExtractionSchema);
  return {
    label,
    surface: 'openai-compatible',
    control,
    wallMs,
    withinBudget: wallMs <= BUDGET_MS,
    promptTokens: Number(usage.prompt_tokens ?? 0),
    // `/v1` does not separate reasoning tokens, so reasoning is counted as
    // completion tokens. Stated rather than hidden: this surface cannot say
    // how the completion tokens were spent.
    completionTokens: Number(usage.completion_tokens ?? 0),
    reasoningChars: reasoning.length,
    answerChars: answer.length,
    answerValid: verdict.valid,
    answerProblem: verdict.problem,
    answer,
    reasoningHead: reasoning.slice(0, 300),
    messageKeys: Object.keys(message),
  };
};

type Variant = {
  readonly label: string;
  readonly control: string;
  run: () => Promise<ProbeResult>;
};

const VARIANTS: Variant[] = [
  {
    // The true production control: the exact body the adapter sends.
    label: '/api/chat PRODUCTION body (no control)',
    control: 'none',
    run: () =>
      probeNative({
        label: '/api/chat PRODUCTION body (no control)',
        control: 'none',
        prompt: extractionPrompt,
        instruction: extractionInstruction,
        schema: NpcDialogueExtractionSchema,
      }),
  },
  {
    label: '/api/chat + think:false',
    control: 'think:false',
    run: () =>
      probeNative({
        label: '/api/chat + think:false',
        control: 'think:false',
        prompt: extractionPrompt,
        instruction: extractionInstruction,
        schema: NpcDialogueExtractionSchema,
        extra: { think: false },
      }),
  },
  {
    label: '/api/chat PRODUCTION body + reasoning_effort:none',
    control: 'reasoning_effort:none',
    run: () =>
      probeNative({
        label: '/api/chat PRODUCTION body + reasoning_effort:none',
        control: 'reasoning_effort:none',
        prompt: extractionPrompt,
        instruction: extractionInstruction,
        schema: NpcDialogueExtractionSchema,
        extra: { reasoning_effort: 'none' },
      }),
  },
  {
    label: '/api/chat legacy envelope prompt (pre-#414 baseline)',
    control: 'none',
    run: () =>
      probeNative({
        label: '/api/chat legacy envelope prompt (pre-#414 baseline)',
        control: 'none',
        prompt: legacyPrompt,
        instruction: legacyInstruction,
        schema: NpcDialogueAiEnvelopeSchema,
      }),
  },
  {
    label: '/v1 default',
    control: 'none',
    run: () => probeOpenAiCompatible({ label: '/v1 default', control: 'none', extra: {} }),
  },
  {
    label: '/v1 + think:false',
    control: 'think:false',
    run: () =>
      probeOpenAiCompatible({
        label: '/v1 + think:false',
        control: 'think:false',
        extra: { think: false },
      }),
  },
  {
    label: '/v1 + reasoning_effort:none',
    control: 'reasoning_effort:none',
    run: () =>
      probeOpenAiCompatible({
        label: '/v1 + reasoning_effort:none',
        control: 'reasoning_effort:none',
        extra: { reasoning_effort: 'none' },
      }),
  },
  {
    label: '/v1 + reasoning_effort:minimal',
    control: 'reasoning_effort:minimal',
    run: () =>
      probeOpenAiCompatible({
        label: '/v1 + reasoning_effort:minimal',
        control: 'reasoning_effort:minimal',
        extra: { reasoning_effort: 'minimal' },
      }),
  },
  {
    label: '/v1 + chat_template_kwargs.enable_thinking=false',
    control: 'chat_template_kwargs',
    run: () =>
      probeOpenAiCompatible({
        label: '/v1 + chat_template_kwargs.enable_thinking=false',
        control: 'chat_template_kwargs',
        extra: { chat_template_kwargs: { enable_thinking: false } },
      }),
  },
];

const results: ProbeResult[] = [];
for (const variant of VARIANTS.filter((v) => ONLY === undefined || v.label.includes(ONLY))) {
  for (let rep = 1; rep <= REPS; rep += 1) {
    let result: ProbeResult;
    try {
      result = await variant.run();
    } catch (error) {
      console.log(`\n===== ${variant.label} [rep ${rep}] =====`);
      console.log(`ERROR ${String(error).slice(0, 300)}`);
      results.push({
        label: variant.label,
        surface: 'error',
        control: variant.control,
        wallMs: 0,
        withinBudget: false,
        promptTokens: 0,
        completionTokens: 0,
        reasoningChars: 0,
        answerChars: 0,
        answerValid: null,
        answerProblem: `transport error: ${String(error).slice(0, 160)}`,
        answer: '',
        reasoningHead: '',
        messageKeys: [],
      });
      continue;
    }
    results.push(result);
    console.log(`\n===== ${result.label} [rep ${rep}/${REPS}] =====`);
    console.log(`surface          ${result.surface}`);
    console.log(
      `wall             ${result.wallMs} ms  (budget ${BUDGET_MS} ms → ${result.withinBudget ? 'WITHIN' : 'OVER'})`,
    );
    console.log(
      `answer valid     ${result.answerValid}${result.answerProblem ? ` (${result.answerProblem})` : ''}`,
    );
    console.log(`prompt tokens    ${result.promptTokens}`);
    console.log(`completion       ${result.completionTokens} tokens`);
    console.log(`reasoning chars  ${result.reasoningChars}`);
    console.log(`answer chars     ${result.answerChars}`);
    console.log(`message keys     ${result.messageKeys.join(', ')}`);
    console.log(`answer           ${JSON.stringify(result.answer.slice(0, 200))}`);
  }
}

/** Median, because this model's run-to-run spread is the whole problem. */
const median = (values: number[]): number => {
  if (values.length === 0) {
    return Number.NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const summary = VARIANTS.filter((v) => results.some((r) => r.label === v.label)).map((variant) => {
  const rows = results.filter((r) => r.label === variant.label);
  return {
    label: variant.label,
    surface: rows[0]?.surface,
    control: variant.control,
    n: rows.length,
    withinBudget: rows.filter((r) => r.withinBudget).length,
    valid: rows.filter((r) => r.answerValid === true).length,
    noAnswer: rows.filter((r) => r.answerValid === null).length,
    malformed: rows.filter((r) => r.answerValid === false).length,
    medianWallMs: median(rows.map((r) => r.wallMs)),
    maxWallMs: rows.length > 0 ? Math.max(...rows.map((r) => r.wallMs)) : Number.NaN,
    medianCompletionTokens: median(rows.map((r) => r.completionTokens)),
    maxReasoningChars:
      rows.length > 0 ? Math.max(...rows.map((r) => r.reasoningChars)) : Number.NaN,
  };
});

console.log('\n\n================ SUMMARY ================');
console.log(
  [
    'control'.padEnd(24),
    'n'.padStart(2),
    'ok'.padStart(3),
    'valid'.padStart(6),
    'none'.padStart(5),
    'bad'.padStart(4),
    'medMs'.padStart(7),
    'maxMs'.padStart(7),
    'medTok'.padStart(6),
    'reasChars'.padStart(9),
  ].join(' '),
);
for (const row of summary) {
  console.log(
    [
      row.label.slice(0, 24).padEnd(24),
      String(row.n).padStart(2),
      String(row.withinBudget).padStart(3),
      String(row.valid).padStart(6),
      String(row.noAnswer).padStart(5),
      String(row.malformed).padStart(4),
      String(row.medianWallMs).padStart(7),
      String(row.maxWallMs).padStart(7),
      String(row.medianCompletionTokens).padStart(6),
      String(row.maxReasoningChars).padStart(9),
    ].join(' '),
  );
}

mkdirSync(OUT_DIR, { recursive: true });
const report = {
  measuredAt: new Date().toISOString(),
  endpoint: ENDPOINT,
  model: MODEL,
  budgetMs: BUDGET_MS,
  v1MaxTokens: V1_MAX_TOKENS,
  reps: REPS,
  productionRoute: '/api/chat (resolveChatUrl: provider === "ollama")',
  summary,
  results,
};
writeFileSync(join(OUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nWrote ${join(OUT_DIR, 'report.json')}`);
