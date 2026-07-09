// apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts
//
// Unified text generation service. Centralises all LLM text-generation
// workflows — SSE token streaming, history-aware chat, and TypeBox
// structural extraction — behind a single reactive gateway. Provider
// routing, model selection, and API keys are resolved dynamically from
// the central ConfigService.
//
// Contract: C-080, C-111

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { schemaCheck } from '@aikami/schemas';
import { configService } from '$lib/services/config/config_service.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Role of a chat message participant. */
export type ChatMessageRole = 'user' | 'assistant' | 'system';

/** A single chat message in an LLM conversation. */
export type TextChatMessage = {
  role: ChatMessageRole;
  content: string;
};

/** Provider routing information exposed via debug hook. */
type ResolvedRouting = {
  provider: string;
  model: string;
  endpoint: string;
};

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export type TextGenerationServiceOptions = BaseFrontendClassOptions;

export type TextGenerationServiceInterface = BaseFrontendClassInterface & {
  /**
   * Streams a chat completion from the configured text provider via
   * OpenRouter's chat completions SSE endpoint. Tokens are delivered
   * via `onChunk` as they arrive.
   *
   * Resolves when the stream completes, rejects on network or abort errors.
   */
  streamChat(options: {
    messages: TextChatMessage[];
    onChunk: (text: string) => void;
    signal?: AbortSignal;
    model?: string;
  }): Promise<void>;

  /**
   * Extracts a strictly-typed object from the LLM using a TypeBox schema
   * as a structural constraint. The schema is compiled into a standard
   * JSON Schema dictionary with `additionalProperties: false` enforced
   * and sent via OpenRouter's native `response_format: json_schema`.
   *
   * Falls back to system-prompt-based extraction when the provider does
   * not support native structured output.
   *
   * @returns The parsed and validated object matching the schema type.
   */
  extractStructure(options: {
    schema: Record<string, unknown>;
    schemaName: string;
    prompt: string;
    systemPrompt?: string;
    signal?: AbortSignal;
    model?: string;
  }): Promise<unknown>;

  /** Aborts all active stream connections. */
  cancelAll(): void;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Resolves the chat completions URL from routing info. */
function resolveChatUrl(routing: ResolvedRouting): string {
  if (routing.endpoint) {
    // Strip trailing slash then append /chat/completions
    const base = routing.endpoint.replace(/\/$/, '');
    return `${base}/chat/completions`;
  }
  // Default to OpenRouter
  return 'https://openrouter.ai/api/v1/chat/completions';
}

/** Chat completions URL for backwards-compatible fallback. */
const _OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** Timeout for the entire fetch+stream operation (90 seconds). */
const FETCH_TIMEOUT_MS = 90_000;

/** Maximum time to wait for the first SSE chunk (15 seconds). */
const FIRST_CHUNK_TIMEOUT_MS = 15_000;

/**
 * Timeout for individual SSE stream read operations after content has started
 * flowing. Kept short (5s) to prevent the text input from staying disabled
 * when OpenRouter delays the [DONE] signal after the last text chunk.
 */
const IDLE_TIMEOUT_MS = 5_000;

/** OpenRouter requires these headers for ranking/attribution on free models. */
const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://aikami.app',
  'X-Title': 'Aikami',
} as const;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class TextGenerationService
  extends BaseFrontendClass<TextGenerationServiceOptions>
  implements TextGenerationServiceInterface
{
  // ── Private state ─────────────────────────────────────────────────────

  private readonly _abortControllers = new Set<AbortController>();
  private _activeStreamCount = 0;
  private readonly _compiledSchemaCache = new Map<string, Record<string, unknown>>();

  // ── Private: Provider resolution ──────────────────────────────────────

  /**
   * Resolves the active provider configuration from ConfigService.
   *
   * Priority: explicit model param → configService.getActiveTextProvider().
   * Throws if no provider is configured.
   */
  private _resolveProvider(options: { explicitModel?: string }): ResolvedRouting {
    const { explicitModel } = options;
    const { state } = configService;

    // Explicit model override — look up its provider from the models array
    if (explicitModel) {
      const match = state.models.find((m) => m.model === explicitModel);
      if (match) {
        return {
          provider: match.provider || 'openrouter',
          model: match.model,
          endpoint: match.endpoint || '',
        };
      }
      // Model not found in config — use it verbatim with openrouter
      return { provider: 'openrouter', model: explicitModel, endpoint: '' };
    }

    // Delegate to ConfigService for the active text provider
    const resolved = configService.getActiveTextProvider();

    return {
      provider: resolved.provider,
      model: resolved.model,
      endpoint: resolved.endpoint,
    };
  }

  private _exposeRouting(routing: ResolvedRouting): void {
    const g = globalThis as Record<string, unknown>;
    g.__text_service_resolved_routing = routing;
  }

  private _incrementStreamCount(): void {
    this._activeStreamCount++;
    (globalThis as Record<string, unknown>).__text_service_active_stream_count =
      this._activeStreamCount;
  }

  private _decrementStreamCount(): void {
    this._activeStreamCount = Math.max(0, this._activeStreamCount - 1);
    (globalThis as Record<string, unknown>).__text_service_active_stream_count =
      this._activeStreamCount;
  }

  // ── Private: API key resolution ───────────────────────────────────────

  /** Reads the API key for the given provider from ConfigService. */
  private _getApiKey(provider: string): string | undefined {
    const keys = configService.state.text.apiKeys;
    return keys[provider as keyof typeof keys];
  }

  // ── streamChat ────────────────────────────────────────────────────────

  async streamChat(options: {
    messages: TextChatMessage[];
    onChunk: (text: string) => void;
    signal?: AbortSignal;
    model?: string;
  }): Promise<void> {
    const { messages, onChunk, signal, model: explicitModel } = options;

    const routing = this._resolveProvider({ explicitModel });
    this._exposeRouting(routing);

    const apiKey = this._getApiKey(routing.provider);

    const abortController = new AbortController();
    this._abortControllers.add(abortController);

    if (signal) {
      if (signal.aborted) {
        this._abortControllers.delete(abortController);
        return;
      }
      signal.addEventListener('abort', () => abortController.abort(signal.reason), { once: true });
    }

    this._incrementStreamCount();

    try {
      const lastMsg = messages[messages.length - 1];
      const userPrompt = lastMsg?.role === 'user' ? lastMsg.content : '';

      this.info('streamChat:fetching', {
        provider: routing.provider,
        model: routing.model,
        messageCount: messages.length,
        promptLength: userPrompt.length,
        hasApiKey: !!apiKey,
      });

      const timeoutId = setTimeout(
        () => abortController.abort(new Error('Fetch timed out')),
        FETCH_TIMEOUT_MS,
      );

      const body: Record<string, unknown> = {
        model: routing.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
      };

      const chatUrl = resolveChatUrl(routing);

      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // biome-ignore lint/style/useNamingConvention: HTTP header field name
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(routing.provider === 'openrouter' ? OPENROUTER_HEADERS : {}),
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.error('streamChat:fetch-failed', { status: response.status, errorText });
        throw new Error(`OpenRouter HTTP ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error(`No response body from ${chatUrl}`);
      }

      await this._readOpenRouterSSEStream({
        body: response.body,
        signal: abortController.signal,
        onChunk,
      });
      this.info('streamChat:complete', { chunkCount: undefined });
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        this.debug('streamChat:aborted');
        return;
      }
      this.error('streamChat:failed', error);
      throw error;
    } finally {
      this._abortControllers.delete(abortController);
      this._decrementStreamCount();
    }
  }

  // ── extractStructure ──────────────────────────────────────────────────

  async extractStructure(options: {
    schema: Record<string, unknown>;
    schemaName: string;
    prompt: string;
    systemPrompt?: string;
    signal?: AbortSignal;
    model?: string;
  }): Promise<unknown> {
    const { schema, schemaName, prompt, systemPrompt, signal, model: explicitModel } = options;

    const routing = this._resolveProvider({ explicitModel });
    this._exposeRouting(routing);

    const apiKey = this._getApiKey(routing.provider);

    const compiledSchema = this._compileSchemaToJson({ schema, schemaName });

    const abortController = new AbortController();
    this._abortControllers.add(abortController);

    if (signal) {
      if (signal.aborted) {
        this._abortControllers.delete(abortController);
        throw new Error('Aborted');
      }
      signal.addEventListener('abort', () => abortController.abort(signal.reason), { once: true });
    }

    this._incrementStreamCount();

    try {
      const messages: TextChatMessage[] = [];

      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }

      const schemaInstruction = [
        'You are a structured data extraction tool.',
        'Your response MUST be valid JSON that conforms to the following JSON Schema:',
        '```json',
        JSON.stringify(compiledSchema, null, 2),
        '```',
        'Respond ONLY with the JSON object. No markdown fences, no explanations.',
        'Do not include any properties not defined in the schema.',
      ].join('\n');

      messages.push({ role: 'system', content: schemaInstruction });
      messages.push({ role: 'user', content: prompt });

      this.info('extractStructure:fetching', {
        provider: routing.provider,
        model: routing.model,
        schemaName,
        promptLength: prompt.length,
        hasApiKey: !!apiKey,
      });

      const body: Record<string, unknown> = {
        model: routing.model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        stream: true,
        // biome-ignore lint/style/useNamingConvention: OpenAI API contract field names
        response_format: {
          type: 'json_schema',
          // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
          json_schema: {
            name: schemaName,
            schema: compiledSchema,
            strict: true,
          },
        },
      };

      const chatUrl = resolveChatUrl(routing);

      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // biome-ignore lint/style/useNamingConvention: HTTP header field name
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...(routing.provider === 'openrouter' ? OPENROUTER_HEADERS : {}),
        },
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        this.error('extractStructure:fetch-failed', { status: response.status, errorText });

        // If the provider rejected structured output, fall back to
        // system-prompt approach via streamChat
        if (response.status === 400) {
          this.info('extractStructure:falling-back-to-system-prompt');
          const accumulated = await this._extractViaSystemPrompt({
            messages,
            signal: abortController.signal,
            model: explicitModel,
          });
          const cleaned = this._sanitizeJsonResponse(accumulated);
          const parsed = JSON.parse(cleaned);
          this._validateAgainstSchema({ schema, parsed, schemaName });
          return parsed;
        }

        throw new Error(`OpenRouter HTTP ${response.status}: ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body from OpenRouter');
      }

      let accumulated = '';
      await this._readOpenRouterSSEStream({
        body: response.body,
        signal: abortController.signal,
        onChunk: (text: string) => {
          accumulated += text;
        },
      });

      const cleaned = this._sanitizeJsonResponse(accumulated);
      const parsed = JSON.parse(cleaned);

      this._validateAgainstSchema({ schema, parsed, schemaName });

      this.debug('extractStructure:done', {
        schemaName,
        outputLength: accumulated.length,
      });

      return parsed;
    } catch (error: unknown) {
      if ((error as Error).name === 'AbortError') {
        this.debug('extractStructure:aborted');
        throw error;
      }
      this.error('extractStructure:failed', error);
      throw error;
    } finally {
      this._abortControllers.delete(abortController);
      this._decrementStreamCount();
    }
  }

  // ── cancelAll ─────────────────────────────────────────────────────────

  cancelAll(): void {
    this.debug('cancelAll', { count: this._abortControllers.size });
    for (const controller of this._abortControllers) {
      controller.abort();
    }
    this._abortControllers.clear();
    this._activeStreamCount = 0;
    (globalThis as Record<string, unknown>).__text_service_active_stream_count = 0;
  }

  // ── Private: OpenRouter SSE stream reader ─────────────────────────────

  /**
   * Reads an OpenRouter chat completions SSE response stream.
   *
   * Each line is `data: {"id":"...","choices":[{"delta":{"content":"token"}}]}`.
   * The stream ends with `data: [DONE]`.
   */
  private async _readOpenRouterSSEStream(options: {
    body: ReadableStream<Uint8Array>;
    signal: AbortSignal;
    onChunk: (text: string) => void;
  }): Promise<void> {
    const { body, signal, onChunk } = options;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let chunkCount = 0;
    let isFirstChunk = true;
    let hasReceivedContent = false;

    try {
      while (true) {
        if (signal.aborted) {
          return;
        }

        const timeout = isFirstChunk
          ? FIRST_CHUNK_TIMEOUT_MS
          : hasReceivedContent
            ? IDLE_TIMEOUT_MS
            : FIRST_CHUNK_TIMEOUT_MS;
        const result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Stream read timed out')), timeout),
          ),
        ]);
        isFirstChunk = false;
        const { value, done } = result;
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.length === 0) {
            continue;
          }

          // Skip non-data lines
          if (!trimmed.startsWith('data: ')) {
            continue;
          }

          const data = trimmed.slice(6);

          // End of stream signal
          if (data === '[DONE]') {
            this.debug('_readOpenRouterSSEStream:done', { chunkCount });
            return;
          }

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: { content?: string };
                // biome-ignore lint/style/useNamingConvention: OpenAI API contract field name
                finish_reason?: string | null;
              }>;
            };

            const choice = parsed.choices?.[0];
            if (!choice) {
              continue;
            }

            const token = choice.delta?.content;
            if (token) {
              hasReceivedContent = true;
              onChunk(token);
              chunkCount++;
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Private: System prompt fallback for extractStructure ──────────────

  /**
   * Extracts structured data via the system-prompt approach. Used as a
   * fallback when the provider rejects `response_format: json_schema`.
   */
  private async _extractViaSystemPrompt(options: {
    messages: TextChatMessage[];
    signal: AbortSignal;
    model?: string;
  }): Promise<string> {
    const { messages, signal, model } = options;

    let accumulated = '';
    await this.streamChat({
      messages,
      signal,
      model,
      onChunk: (text: string) => {
        accumulated += text;
      },
    });

    return accumulated;
  }

  // ── Private: Post-validation ──────────────────────────────────────────

  /**
   * Validates the parsed output against the original TypeBox schema.
   * Logs a warning if validation fails but does not throw — the caller
   * receives whatever the LLM returned.
   */
  private _validateAgainstSchema(options: {
    schema: Record<string, unknown>;
    parsed: unknown;
    schemaName: string;
  }): void {
    const { schema, parsed, schemaName } = options;

    const isValid = schemaCheck(schema, parsed);
    if (!isValid) {
      this.warn('extractStructure:validation-failed', {
        schemaName,
        received: typeof parsed,
      });
      return;
    }

    this.debug('extractStructure:validation-passed', { schemaName });
  }

  // ── Private: Schema compilation ───────────────────────────────────────

  /**
   * Compiles a TypeBox TSchema into a strict JSON Schema dictionary
   * with `additionalProperties: false` enforced at every object level.
   */
  private _compileSchemaToJson(options: {
    schema: Record<string, unknown>;
    schemaName: string;
  }): Record<string, unknown> {
    const { schema, schemaName } = options;

    const cached = this._compiledSchemaCache.get(schemaName);
    if (cached) {
      (globalThis as Record<string, unknown>).__text_service_compiled_schema_cache_size =
        this._compiledSchemaCache.size;
      return cached;
    }

    const raw = this._enforceStrictSchema(JSON.parse(JSON.stringify(schema)));
    const compiled = raw as Record<string, unknown>;

    compiled.additionalProperties = false;

    this._compiledSchemaCache.set(schemaName, compiled);

    (globalThis as Record<string, unknown>).__text_service_compiled_schema_cache_size =
      this._compiledSchemaCache.size;

    return compiled;
  }

  /**
   * Recursively enforces `additionalProperties: false` on every object
   * schema node in the JSON Schema tree.
   */
  private _enforceStrictSchema(node: unknown): unknown {
    if (node === null || typeof node !== 'object') {
      return node;
    }

    const obj = node as Record<string, unknown>;

    if (obj.type === 'object' || obj.properties !== undefined) {
      obj.additionalProperties = false;

      if (obj.properties && typeof obj.properties === 'object') {
        for (const key of Object.keys(obj.properties as Record<string, unknown>)) {
          (obj.properties as Record<string, unknown>)[key] = this._enforceStrictSchema(
            (obj.properties as Record<string, unknown>)[key],
          );
        }
      }
    }

    if (obj.type === 'array' && obj.items) {
      if (Array.isArray(obj.items)) {
        obj.items = (obj.items as unknown[]).map((item) => this._enforceStrictSchema(item));
      } else {
        obj.items = this._enforceStrictSchema(obj.items);
      }
    }

    for (const combinator of ['allOf', 'anyOf', 'oneOf']) {
      if (Array.isArray(obj[combinator])) {
        obj[combinator] = (obj[combinator] as unknown[]).map((item) =>
          this._enforceStrictSchema(item),
        );
      }
    }

    return obj;
  }

  /**
   * Strips markdown fences and extracts the first JSON object from a string
   * that may contain explanatory text.
   */
  private _sanitizeJsonResponse(raw: string): string {
    let text = raw.trim();

    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    const objectStart = text.indexOf('{');
    const arrayStart = text.indexOf('[');

    let startIndex = objectStart;
    if (objectStart === -1 || (arrayStart !== -1 && arrayStart < objectStart)) {
      startIndex = arrayStart;
    }

    if (startIndex === -1) {
      throw new Error('No JSON object found in response');
    }

    text = text.slice(startIndex);

    let depth = 0;
    const opener = text[0];
    const closer = opener === '{' ? '}' : ']';
    let inString = false;
    let escapeNext = false;
    let endIndex = -1;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (ch === '\\') {
        escapeNext = true;
        continue;
      }

      if (ch === '"') {
        inString = !inString;
        continue;
      }

      if (inString) {
        continue;
      }

      if (ch === opener) {
        depth++;
      } else if (ch === closer) {
        depth--;
        if (depth === 0) {
          endIndex = i + 1;
          break;
        }
      }
    }

    if (endIndex === -1) {
      throw new Error('Unbalanced JSON in response');
    }

    return text.slice(0, endIndex);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async dispose(): Promise<void> {
    this.cancelAll();
    await super.dispose();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const textGenerationService: TextGenerationServiceInterface = TextGenerationService.create({
  className: 'TextGenerationService',
});
