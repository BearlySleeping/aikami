// apps/e2e/scripts/ai_envelope_thinking_probe.ts
//
// Issue #382 follow-up: does reasoning-token volume explain the C-401 call-2
// deadline failures, and can it be turned off on the route the client uses?
//
// The envelope schema was reduced in #414 (narrative echo removed) and the
// extraction path still failed every measured call at its 6 000 ms deadline.
// The P1 run records `aborted` with no token counts, because a request that is
// cut off never receives a body — so the wire log CANNOT show what the model
// spent those tokens on. This probe asks the provider directly.
//
// It reproduces the production request EXACTLY — same schemas, same prompts,
// same `maxTokens`, same no-`format` reality of the local route — and varies
// one thing at a time:
//
//   1. the extraction schema as shipped, reasoning left at the model default;
//   2. the legacy envelope schema as shipped before #414, same default;
//   3. the shipped extraction schema with the reasoning channel disabled.
//
// Measurement apparatus, not product code. It talks to the provider directly
// and touches no client, service or routing path. Run it before theorising
// about call 2 again; the answer decides whether the next step is a schema
// change (already done), a budget change (already ruled out) or a reasoning
// control (this probe's whole point).
//
//   bun run --cwd apps/e2e probe:ai-envelope-thinking

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NpcDialogueAiEnvelopeSchema, NpcDialogueExtractionSchema } from '@aikami/schemas';

/** The provider the client is configured against, by default. */
const ENDPOINT = process.env.AIKAMI_PROBE_ENDPOINT ?? 'http://127.0.0.1:11434';
const MODEL = process.env.AIKAMI_PROBE_MODEL ?? 'ornith-1.5:9b';
/** The `envelope` task's `maxTokens`, and its 6 000 ms budget. */
const MAX_TOKENS = 800;
const BUDGET_MS = 6_000;

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const OUT_DIR = join(REPO_ROOT, '.evidence', '382-baseline', 'envelope-thinking');

/** Stand-in for one streamed call-1 narrative, as the elder produced it. */
const NARRATIVE =
  '"Greetings, traveler. Our village has need of your aid. The ward stone at the mill has ' +
  'faded, and if it fades fully the Crimson Covenant will find us. I have prepared a writ ' +
  'of passage and a task that only someone with a steady hand should take."';

const PERSONA =
  'Elder Thalia is the keeper of the ward records in Emberwatch. Voice: warm but measured. ' +
  'Manner: unhurried, deliberate, rarely raises her voice.';

const ALLOWED_ACTIONS = 'trade, offerQuest, skillCheck';

/** The call-2 system prompt, as `buildDialogueExtractionSystemPrompt` emits it. */
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
 * The gateway's own schema wrapper.
 *
 * Copied verbatim from `generateStructured` in
 * `text_adapter_openai_compatible.ts`, because the wrapper is a material part
 * of the prompt: it is the largest single block in the request, and a probe
 * that omitted it would not be measuring production.
 */
const schemaInstruction = (schema: Record<string, unknown>): string =>
  [
    'You are a structured data extraction tool.',
    'Your response MUST be valid JSON that conforms to the following JSON Schema:',
    '```json',
    JSON.stringify(schema, null, 2),
    '```',
    'Respond ONLY with the JSON object. No markdown fences, no explanations.',
    'Do not include any properties not defined in the schema.',
  ].join('\n');

type ProbeResult = {
  readonly label: string;
  readonly surface: 'native' | 'openai-compatible';
  readonly wallMs: number;
  readonly withinBudget: boolean;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningChars: number;
  readonly answerChars: number;
  readonly answer: string;
  readonly reasoningHead: string;
};

const post = async (path: string, body: Record<string, unknown>) => {
  const response = await fetch(`${ENDPOINT}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as Record<string, unknown>;
};

/** One native `/api/chat` call, which is the only surface that reports thinking. */
const probeNative = async (
  label: string,
  schema: Record<string, unknown>,
  disableThinking: boolean,
): Promise<ProbeResult> => {
  const startedAt = Date.now();
  const body = await post('/api/chat', {
    model: MODEL,
    messages: [
      { role: 'system', content: extractionPrompt },
      { role: 'system', content: schemaInstruction(schema) },
      { role: 'user', content: NARRATIVE },
    ],
    // Production sends `stream: false` for every structured request, and sends
    // NO `format`: the gateway only sets `response_format` for providers
    // flagged as supporting it, and documents that Ollama ignores it. So the
    // model is asked for JSON and must be trusted to comply.
    stream: false,
    ...(disableThinking ? { think: false } : {}),
    options: { num_predict: MAX_TOKENS, temperature: 0.3 },
  });
  const wallMs = Date.now() - startedAt;
  const message = (body.message ?? {}) as { content?: string; thinking?: string };
  const answer = message.content ?? '';
  const reasoning = message.thinking ?? '';
  return {
    label,
    surface: 'native',
    wallMs,
    withinBudget: wallMs <= BUDGET_MS,
    promptTokens: Number(body.prompt_eval_count ?? 0),
    completionTokens: Number(body.eval_count ?? 0),
    reasoningChars: reasoning.length,
    answerChars: answer.length,
    answer: answer.slice(0, 400),
    reasoningHead: reasoning.slice(0, 300),
  };
};

/**
 * The surface the client actually uses.
 *
 * Recorded because a fix that only works on `/api/chat` is not a fix: the
 * gateway talks to Ollama through `/v1`. If `think: false` is accepted but
 * ignored here, the next step is not "send `think: false`" — it is finding a
 * control that this route honours.
 */
const probeOpenAiCompatible = async (disableThinking: boolean): Promise<ProbeResult> => {
  const startedAt = Date.now();
  const body = await post('/v1/chat/completions', {
    model: MODEL,
    messages: [
      { role: 'system', content: extractionPrompt },
      { role: 'system', content: schemaInstruction(extraction) },
      { role: 'user', content: NARRATIVE },
    ],
    stream: false,
    ...(disableThinking ? { think: false } : {}),
    max_tokens: MAX_TOKENS,
    temperature: 0.3,
  });
  const wallMs = Date.now() - startedAt;
  const choices = (body.choices ?? []) as ReadonlyArray<{
    message?: { content?: string; reasoning_content?: string };
  }>;
  const message = choices[0]?.message ?? {};
  const answer = message.content ?? '';
  const usage = (body.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
  return {
    label: disableThinking ? 'extraction via /v1, think:false' : 'extraction via /v1, default',
    surface: 'openai-compatible',
    wallMs,
    withinBudget: wallMs <= BUDGET_MS,
    promptTokens: Number(usage.prompt_tokens ?? 0),
    // `/v1` does not separate reasoning tokens, so reasoning is counted as
    // completion tokens. Stated rather than hidden: this surface cannot say
    // how the completion tokens were spent.
    completionTokens: Number(usage.completion_tokens ?? 0),
    reasoningChars: (message.reasoning_content ?? '').length,
    answerChars: answer.length,
    answer: answer.slice(0, 400),
    reasoningHead: (message.reasoning_content ?? '').slice(0, 300),
  };
};

/**
 * The two schemas, as plain records.
 *
 * The probe serialises them into a prompt and compares them on the wire, so the
 * TypeBox wrapper type is irrelevant here; a narrowing convert states that once
 * instead of asserting through `unknown` at each call site.
 */
const asSchemaRecord = (schema: unknown): Record<string, unknown> =>
  typeof schema === 'object' && schema !== null
    ? (schema as Record<string, unknown>)
    : ({} as Record<string, unknown>);

const extraction = asSchemaRecord(NpcDialogueExtractionSchema);
const legacy = asSchemaRecord(NpcDialogueAiEnvelopeSchema);

const results: ProbeResult[] = [];
results.push(await probeNative('extraction schema (as shipped, #414)', extraction, false));
results.push(await probeNative('legacy envelope (pre-#414)', legacy, false));
results.push(await probeNative('extraction schema, think:false', extraction, true));
results.push(await probeOpenAiCompatible(false));
results.push(await probeOpenAiCompatible(true));

for (const result of results) {
  console.log(`\n===== ${result.label} =====`);
  console.log(`surface          ${result.surface}`);
  console.log(
    `wall             ${result.wallMs} ms  (budget ${BUDGET_MS} ms → ${result.withinBudget ? 'WITHIN' : 'OVER'})`,
  );
  console.log(`prompt tokens    ${result.promptTokens}`);
  console.log(`completion       ${result.completionTokens} tokens (cap ${MAX_TOKENS})`);
  console.log(`reasoning chars  ${result.reasoningChars}`);
  console.log(`answer chars     ${result.answerChars}`);
  console.log(`answer           ${JSON.stringify(result.answer.slice(0, 200))}`);
}

mkdirSync(OUT_DIR, { recursive: true });
const report = {
  measuredAt: new Date().toISOString(),
  endpoint: ENDPOINT,
  model: MODEL,
  maxTokens: MAX_TOKENS,
  budgetMs: BUDGET_MS,
  results,
};
writeFileSync(join(OUT_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nWrote ${join(OUT_DIR, 'report.json')}`);
