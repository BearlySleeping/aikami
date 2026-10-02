// packages/frontend/ai-gateway/src/lib/decision/tasks/chat_model_baseline_adapter.ts
//
// The EXISTING LLM PATH, measured through the same decision pipeline
// (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// What this is for
// ---------------------------------------------------------------------------
//
// The comparison this lane has to make is three-way: deterministic, the
// decision checkpoint, and the path production uses today. Without a third arm
// every number here is only "the checkpoint versus nothing", and "is the
// existing path already fine?" goes unanswered.
//
// So this adapter takes the SAME compiled plan, the SAME per-case candidate
// set, the SAME corpus and the SAME scorer, and changes exactly one thing: the
// inference mechanism. A chat model is asked the identical question and must
// return the identical value.
//
// ---------------------------------------------------------------------------
// The asymmetry that matters, and it is not a thumb on the scale
// ---------------------------------------------------------------------------
//
// A `/v1/systemone` checkpoint returns `probabilities` per option — its own
// distribution over the options it was shown. A chat completion returns no such
// thing. `runDecision`'s documented behaviour is that a MISSING probability is
// ACCEPTED, because inventing a threshold failure out of an absent number would
// be fabricating a measurement.
//
// The consequence is the finding, not a defect in this file: the LLM path
// cannot be selectively accepted at all. Every turn it answers is accepted, and
// the only defence against a wrong answer is the schema and the domain
// validator. That asymmetry is reported, not smoothed over.

import type {
  DecisionAdapter,
  DecisionAdapterResponse,
  DecisionRequest,
} from '../adapters/types.ts';
import type { DecisionAnswer, DecisionCapability, DecisionLiteral } from '../types.ts';
import { DEFAULT_DECISION_LIMITS } from '../types.ts';

/** Options for {@link createChatModelDecisionAdapter}. */
export type ChatModelDecisionAdapterOptions = {
  /** OpenAI-compatible base, e.g. `http://127.0.0.1:11434/v1`. */
  readonly baseUrl: string;
  /** The chat checkpoint, reported verbatim. */
  readonly model: string;
  /** Sent verbatim in the report so the arm is identifiable. */
  readonly label?: string;
  readonly maxContextBytes?: number;
  readonly transport?: typeof fetch;
  readonly languages?: readonly ('en' | 'multi')[];
};

/** Builds the prompt body for one dispatch unit. */
const buildPrompt = (request: DecisionRequest): string => {
  const { unit } = request;
  const lines: string[] = ['[CONTEXT]', unit.state, '', '[QUESTIONS]'];
  for (const question of unit.questions) {
    lines.push(`- ${question.instructions}`);
    if (question.options) {
      for (const option of question.options) {
        lines.push(`  * ${option.value}: ${option.description ?? option.key}`);
      }
    }
    if (question.combinationOptions) {
      for (const option of question.combinationOptions) {
        lines.push(`  * ${option.label}`);
      }
    }
  }
  lines.push(
    '',
    'Answer with JSON only, matching the requested schema. Choose nothing if no option fits.',
  );
  return lines.join('\n');
};

/** Finds the option key for a returned literal, or undefined when it is not on offer. */
const keyForLiteral = (
  questions: DecisionRequest['unit']['questions'],
  literal: DecisionLiteral,
): string | undefined => {
  for (const question of questions) {
    for (const option of question.options ?? []) {
      if (option.value === literal) {
        return option.key;
      }
    }
  }
  return undefined;
};

/** What a capability probe found, before it is projected into a DecisionCapability. */
type ProbeOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string; readonly state: 'unauthorized' | 'unreachable' };

/**
 * Proves the endpoint answers.
 *
 * A listening socket and a listed model are not a test; one tiny completion is.
 * Same rule the readiness probe uses.
 */
const probeChatEndpoint = async (
  fetchImpl: typeof fetch,
  root: string,
  model: string,
  signal: AbortSignal,
): Promise<ProbeOutcome> => {
  try {
    const response = await fetchImpl(`${root}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with the single word: ready' }],
        // biome-ignore lint/style/useNamingConvention: verbatim OpenAI wire field name
        max_tokens: 4,
        stream: false,
      }),
      signal,
    });
    if (response.ok) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `chat endpoint answered ${response.status}`,
      state: response.status === 401 || response.status === 403 ? 'unauthorized' : 'unreachable',
    };
  } catch (error) {
    return {
      ok: false,
      reason: `chat endpoint unreachable: ${String(error)}`,
      state: 'unreachable',
    };
  }
};

/** Projects a probe outcome into the capability shape every adapter returns. */
const capabilityFrom = (options: {
  backendId: string;
  languages: readonly ('en' | 'multi')[];
  maxContextBytes: number;
  checkpoint: string;
  outcome: ProbeOutcome;
}): DecisionCapability => ({
  backendId: options.backendId,
  dialect: 'openai-chat',
  ready: options.outcome.ok,
  ...(options.outcome.ok
    ? {}
    : { notReadyReason: options.outcome.reason, notReadyState: options.outcome.state }),
  primitives: ['choice', 'boolean', 'combination'],
  maxOptions: DEFAULT_DECISION_LIMITS.maxOptions,
  maxQuestions: DEFAULT_DECISION_LIMITS.maxQuestions,
  maxContextBytes: options.maxContextBytes,
  languages: options.languages,
  checkpoint: options.checkpoint,
  resourceId: options.outcome.ok ? 'chat-model' : undefined,
});

/** The one-property JSON schema constraining the chat model to the offered options. */
const answerSchemaFor = (unit: DecisionRequest['unit']): Record<string, unknown> => ({
  type: 'object',
  properties: {
    actionId: {
      type: 'string',
      enum: (unit.questions[0]?.options ?? []).map((option) => String(option.value)),
    },
  },
  required: ['actionId'],
  additionalProperties: false,
});

/** Reads `actionId` out of a chat completion body. */
const readActionId = (
  body: unknown,
):
  | { readonly ok: true; readonly literal: string }
  | { readonly ok: false; readonly detail: string } => {
  const content =
    (body as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ??
    '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, detail: 'chat completion was not JSON' };
  }
  const literal = (parsed as { actionId?: unknown }).actionId;
  return typeof literal === 'string'
    ? { ok: true, literal }
    : { ok: false, detail: 'chat completion had no actionId' };
};

/** Why a transport error is what it is, given what the request's own state says. */
const transportReason = (
  signal: AbortSignal,
  deadlineAt: number,
): 'cancelled' | 'deadline-exceeded' | 'backend-unavailable' => {
  if (signal.aborted) {
    return 'cancelled';
  }
  return Date.now() >= deadlineAt ? 'deadline-exceeded' : 'backend-unavailable';
};

/**
 * Maps a returned literal onto option keys for every dispatched question.
 *
 * A literal the turn did not offer becomes `__unmatched__`, a key
 * reconstruction refuses — so the scorer's abstention path handles it rather
 * than an unknown literal being mapped onto a real option.
 */
const answersFor = (unit: DecisionRequest['unit'], literal: string): DecisionAnswer[] =>
  unit.questions.map((question) => ({
    questionKey: question.key,
    optionKey: keyForLiteral(unit.questions, literal) ?? '__unmatched__',
  }));

/** The request body for one completion, schema-constrained to the offered options. */
const completionBody = (options: {
  readonly model: string;
  readonly prompt: string;
  readonly unit: DecisionRequest['unit'];
}): Record<string, unknown> => ({
  model: options.model,
  messages: [{ role: 'user', content: options.prompt }],
  // biome-ignore lint/style/useNamingConvention: verbatim OpenAI wire field name
  response_format: {
    type: 'json_schema',
    // biome-ignore lint/style/useNamingConvention: verbatim OpenAI wire field name
    json_schema: {
      name: 'npc_action_selection',
      schema: answerSchemaFor(options.unit),
      strict: true,
    },
  },
  temperature: 0,
  stream: false,
});

/** Maps a non-ok HTTP status onto an adapter failure reason, or undefined for ok. */
const refusalFor = (status: number): 'backend-unavailable' | 'unauthorized' | undefined => {
  if (status === 401 || status === 403) {
    return 'unauthorized';
  }
  return status >= 200 && status < 300 ? undefined : 'backend-unavailable';
};

/** A failure return, with the elapsed times every arm reports. */
const failure = (
  reason:
    | 'backend-unavailable'
    | 'invalid-response'
    | 'deadline-exceeded'
    | 'cancelled'
    | 'unauthorized',
  detail: string,
  queueMs: number,
  inferenceMs: number,
) => ({ ok: false as const, reason, detail, queueMs, inferenceMs });

/**
 * An adapter backed by an OpenAI-compatible chat endpoint.
 *
 * Deliberately reports NO `probabilities` and NO `confidence`. A chat model has
 * no calibrated per-option distribution to report, and fabricating one from a
 * logit or a self-reported score would be inventing the very number the
 * selective-acceptance policy depends on.
 */
export const createChatModelDecisionAdapter = (
  options: ChatModelDecisionAdapterOptions,
): DecisionAdapter => {
  const doFetch = options.transport ?? globalThis.fetch;
  const root = options.baseUrl.replace(/\/+$/, '');
  const backendId = `chat-llm:${options.model}//${root.replace(/^https?:\/\//, '')}`;
  const languages = options.languages ?? ['en'];
  const maxContextBytes = options.maxContextBytes ?? DEFAULT_DECISION_LIMITS.maxContextBytes;

  return {
    backendId,
    dialect: 'openai-chat',

    async capability(probe): Promise<DecisionCapability> {
      const outcome = await probeChatEndpoint(
        doFetch,
        root,
        options.model,
        probe?.signal ?? new AbortController().signal,
      );
      return capabilityFrom({
        backendId,
        languages,
        maxContextBytes,
        checkpoint: options.model,
        outcome,
      });
    },

    async run(request: DecisionRequest): Promise<DecisionAdapterResponse> {
      const { unit, signal, deadlineAt } = request;
      const queueStarted = Date.now();
      if (signal.aborted) {
        return failure('cancelled', 'aborted before dispatch', 0, 0);
      }
      if (Date.now() >= deadlineAt) {
        return failure('deadline-exceeded', 'deadline already spent', 0, 0);
      }

      const inferenceStarted = Date.now();
      const elapsed = (): readonly [number, number] => [
        inferenceStarted - queueStarted,
        Date.now() - inferenceStarted,
      ];

      try {
        const response = await doFetch(`${root}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(
            completionBody({ model: options.model, prompt: buildPrompt(request), unit }),
          ),
          signal,
        });

        const refused = refusalFor(response.status);
        if (refused !== undefined) {
          return failure(refused, `chat endpoint answered ${response.status}`, ...elapsed());
        }

        const parsed = readActionId(await response.json());
        if (!parsed.ok) {
          return failure('invalid-response', parsed.detail, ...elapsed());
        }

        return {
          ok: true,
          answers: answersFor(unit, parsed.literal),
          queueMs: elapsed()[0],
          inferenceMs: elapsed()[1],
          checkpoint: options.model,
          runtime: 'openai-chat',
        };
      } catch (error) {
        return failure(transportReason(signal, deadlineAt), String(error), ...elapsed());
      }
    },
  };
};
