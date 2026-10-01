// packages/frontend/ai-gateway/src/lib/text_structured.ts
//
// Structured extraction: schema-constrained where the provider can be, and a
// system-prompt rescue where it cannot.
//
// The shape of the policy, and why:
//
//   - BUFFERED always. The result is parsed as one value, so streaming it
//     changes no player-visible latency while adding a failure mode on providers
//     that reject `stream:true` with a schema constraint.
//   - The ORIGINAL TypeBox validation stays authoritative. A native `format`
//     constraint shapes the decoder; it does not replace the contract, and a
//     provider can honour the shape and still fail it.
//   - Capability is a POLICY, not a probe. Ollama answers 200 to fields it does
//     not understand, so a runtime either supports native `format` or ignores
//     it, and the response cannot tell you which. That is why the capability is
//     declared and why an undeclared capability takes the fallback path.
//   - NO RETRY STORM. A shape rejection buys exactly ONE differently-shaped
//     attempt. Broadening that to every 400 would turn a genuine
//     malformed-request bug into a silent retry against a paid provider.
//
// Contract: issue #382

import type { AiChatMessage, AiModeResolution } from '@aikami/types';
import type { GatewayDeadline } from './deadline.ts';
import type { AiAttemptOutcome, AiTextGenerationResult } from './gateway_types.ts';
import {
  buildNativeFormat,
  isSchemaShapeRejection,
  type NativeFormatCapability,
} from './native_format.ts';
import { combineNativeUsage } from './native_usage.ts';
import type { ReasoningControl } from './reasoning_control.ts';
import {
  type createSchemaCompiler,
  sanitizeJsonResponse,
  validateAgainstSchema,
} from './structured.ts';
import { buildBody, readJsonCompletion } from './text_body.ts';
import { EMPTY_RETRY_BACKOFF_MS } from './text_constants.ts';
import type { AttemptDraft, AttemptHook } from './text_outcome.ts';

/** How a structured attempt ended. */
export type StructuredOutcome =
  | { kind: 'shape-rejected'; status: number }
  | { kind: 'non-json' }
  | { kind: 'ok' };

/** What the structured path needs from the adapter that owns it. */
export type StructuredDeps = {
  compiler: ReturnType<typeof createSchemaCompiler>;
  supportsStructuredOutput?: (provider: string) => boolean;
  supportsNativeFormat?: NativeFormatCapability;
  onEvent?: (event: string, data?: Record<string, unknown>) => void;
  getReasoningControl: (provider: string) => ReasoningControl | undefined;
  nativeOptionsEnabled: boolean;
  nativeStructuredFormatEnabled: boolean;
  now: () => number;
  post: (options: {
    resolution: AiModeResolution;
    body: Record<string, unknown>;
    deadline: GatewayDeadline;
  }) => Promise<Response>;
  waitWithBackoff: (options: {
    ms: number;
    deadline: GatewayDeadline;
    resolution: AiModeResolution;
  }) => Promise<void>;
  generatePlain: (options: {
    resolution: AiModeResolution;
    messages: AiChatMessage[];
    deadline: GatewayDeadline;
    onAttempt?: AttemptHook;
  }) => Promise<AiTextGenerationResult>;
};

const applyStructuredShape = (options2: {
  resolution: AiModeResolution;
  body: Record<string, unknown>;
  compiledSchema: Record<string, unknown>;
  schemaName: string;
  native: boolean;
  nativeStructuredFormatEnabled: boolean;
  supportsStructuredOutput?: (provider: string) => boolean;
  supportsNativeFormat?: NativeFormatCapability;
  onEvent?: (event: string, data?: Record<string, unknown>) => void;
}): void => {
  const { resolution, body, compiledSchema, schemaName, native } = options2;
  if (options2.supportsStructuredOutput?.(resolution.provider) === true) {
    body.response_format = {
      type: 'json_schema',
      // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
      json_schema: { name: schemaName, schema: compiledSchema },
    };
    return;
  }
  if (!native) {
    return;
  }
  if (options2.nativeStructuredFormatEnabled === false) {
    options2.onEvent?.('native-format-unavailable', {
      provider: resolution.provider,
      reason: 'capability-not-declared',
    });
    return;
  }
  const format = buildNativeFormat({
    provider: resolution.provider,
    compiledSchema,
    supportsNativeFormat: options2.supportsNativeFormat,
  });
  if (format.constrained) {
    Object.assign(body, format.body);
    return;
  }
  // Absent means "not declared", which is treated as unsupported: because
  // Ollama answers 200 to fields it ignores, guessing the other way would
  // produce unconstrained prose that then fails validation.
  options2.onEvent?.('native-format-unavailable', {
    provider: resolution.provider,
    reason: format.reason,
  });
};

/** The messages a structured request sends, with the schema instruction. */

const buildStructuredMessages = (
  messages: readonly AiChatMessage[],
  compiledSchema: Record<string, unknown>,
): AiChatMessage[] => {
  const instruction = [
    'You are a structured data extraction tool.',
    'Your response MUST be valid JSON that conforms to the following JSON Schema:',
    '```json',
    JSON.stringify(compiledSchema, null, 2),
    '```',
    'Respond ONLY with the JSON object. No markdown fences, no explanations.',
    'Do not include any properties not defined in the schema.',
  ].join('\n');
  // Inserted before the final user message, preserving any caller-provided
  // system prompt ordering.
  return [
    ...messages.slice(0, -1),
    { role: 'system', content: instruction },
    ...messages.slice(-1),
  ];
};

/**
 * Structured extraction with a native schema constraint and a system-prompt
 * fallback.
 *
 * Module-level for the same reason as the narrative path: eleven
 * collaborators, and a closure is the wrong shape for that.
 */

export const generateStructured = async (options2: {
  resolution: AiModeResolution;
  messages: AiChatMessage[];
  schema: Record<string, unknown>;
  schemaName: string;
  deadline: GatewayDeadline;
  deps: StructuredDeps;
  onChunk?: (text: string) => void;
  onAttempt?: AttemptHook;
}): Promise<AiTextGenerationResult> => {
  const { resolution, messages, schema, schemaName, deadline, deps, onChunk, onAttempt } = options2;
  const { compiler, onEvent, post, waitWithBackoff, now } = deps;
  const compiledSchema = compiler.compile({ schema, schemaName });
  const structuredMessages = buildStructuredMessages(messages, compiledSchema);

  const body = buildBody({
    resolution,
    messages: structuredMessages,
    // Buffered, deliberately: a schema-constrained object is parsed as a whole
    // anyway, and streaming it adds a failure mode on providers that reject
    // stream:true with a schema constraint.
    stream: false,
    nativeOptionsEnabled: deps.nativeOptionsEnabled,
    getReasoningControl: deps.getReasoningControl,
    ...(onEvent === undefined ? {} : { onEvent }),
  });
  applyStructuredShape({
    resolution,
    body,
    compiledSchema,
    schemaName,
    native: resolution.provider === 'ollama',
    nativeStructuredFormatEnabled: deps.nativeStructuredFormatEnabled,
    supportsStructuredOutput: deps.supportsStructuredOutput,
    supportsNativeFormat: deps.supportsNativeFormat,
    ...(onEvent === undefined ? {} : { onEvent }),
  });

  const state: { text: string; usage: AiTextGenerationResult['usage'] } = {
    text: '',
    usage: undefined,
  };
  const deliver = (text: string): void => {
    state.text += text;
    onChunk?.(text);
  };
  const parse = (): AiTextGenerationResult => {
    const parsed = JSON.parse(sanitizeJsonResponse(state.text));
    if (!validateAgainstSchema({ schema, parsed })) {
      // The ORIGINAL TypeBox validation stays authoritative. A native `format`
      // constraint shapes the decoder; it does not replace the contract, and a
      // provider can honour the shape and still fail it.
      onEvent?.('validation-failed', { schemaName });
    }
    return state.usage === undefined
      ? { text: state.text, structured: parsed }
      : { text: state.text, structured: parsed, usage: state.usage };
  };

  /** One dispatched structured attempt, with its own accounting. */
  const attemptOnce = async (): Promise<StructuredOutcome> => {
    state.text = '';
    // Cleared per attempt on purpose. An empty first attempt and a successful
    // retry are two provider bills; carrying the first attempt's counters into
    // the second would attribute the discarded attempt's spend to the surviving
    // one — and report a total that belongs to neither.
    state.usage = undefined;
    const startedAt = now();
    const attemptDraft: AttemptDraft = {
      kind: 'structured',
      transport: 'buffered-json',
      startedAt,
    };
    const settle = (
      attemptOutcome: AiAttemptOutcome,
      reported?: AiTextGenerationResult['usage'],
    ): void => {
      onAttempt?.({
        ...attemptDraft,
        outcome: attemptOutcome,
        totalMs: now() - startedAt,
        ...(reported === undefined ? {} : { usage: reported }),
      });
    };

    const response = await post({ resolution, body, deadline });
    if (!response.ok) {
      onEvent?.('fetch-failed', { status: response.status });
      if (isSchemaShapeRejection(response.status)) {
        // The provider billed this attempt even though it produced nothing
        // usable, so it is reported before the fallback is dispatched.
        settle('unsupported');
        return { kind: 'shape-rejected', status: response.status };
      }
      // A server error is not something a differently-shaped request fixes.
      settle('error');
      throw new Error(
        `Provider HTTP ${response.status}: ${await response.text().catch(() => 'Unknown error')}`,
      );
    }

    const read = await readJsonCompletion(response);
    if (read.kind === 'aborted') {
      settle('cancelled');
      throw read.error;
    }
    if (read.kind === 'non-json') {
      settle('invalid');
      return { kind: 'non-json' };
    }
    state.usage = read.usage;
    deliver(read.text);
    settle(state.text.trim().length === 0 ? 'empty' : 'completed', read.usage);
    return { kind: 'ok' };
  };

  /** Rescues a structured attempt with ONE plain-prose completion. */
  const plainFallback = async (reason: string): Promise<AiTextGenerationResult> => {
    onEvent?.('structured-fallback', { reason });
    const discarded = state.usage;
    const fallback = await deps.generatePlain({
      resolution,
      messages: structuredMessages,
      deadline,
      onAttempt,
    });
    // BOTH attempts spent tokens. Keeping only the survivor's numbers
    // under-reports real spend by whatever the discarded one cost.
    state.usage = combineNativeUsage({ first: discarded, second: fallback.usage });
    state.text = fallback.text;
    return parse();
  };

  const outcome = await attemptOnce();
  if (outcome.kind !== 'ok') {
    return await plainFallback(outcome.kind);
  }
  // C-499 AC-2: an empty 200 body is transient for some local/BYOK providers.
  // Retry ONCE, and only while the shared budget still has room for it.
  if (state.text.trim().length === 0) {
    onEvent?.('empty-retry', { attempt: 1 });
    await waitWithBackoff({ ms: EMPTY_RETRY_BACKOFF_MS, deadline, resolution });
    const retry = await attemptOnce();
    if (retry.kind !== 'ok') {
      return await plainFallback(retry.kind);
    }
  }
  try {
    return parse();
  } catch (parseError) {
    // A 200 whose body was not valid JSON for our schema. Validation, not the
    // provider's shape, decided that — so the fallback is a single
    // differently-shaped attempt, never a retry storm.
    return await plainFallback(String(parseError));
  }
};
