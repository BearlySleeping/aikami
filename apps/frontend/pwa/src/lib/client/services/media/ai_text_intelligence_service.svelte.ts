// apps/frontend/pwa/src/lib/client/services/media/ai_text_intelligence_service.svelte.ts
//
// Unified text & structural intelligence service.
// Centralises all LLM text-generation workflows — SSE token streaming,
// history-aware chat, and TypeBox structural extraction — behind a
// single reactive gateway. Provider routing, model selection, and API
// keys are resolved dynamically from the central ConfigService.
//
// Contract: C-080

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { configService } from '$lib/client/services/config/config_service.svelte.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Role of a chat message participant. */
export type ChatMessageRole = 'user' | 'assistant' | 'system';

/** A single chat message in a conversation. */
export type UnifiedChatMessage = {
  role: ChatMessageRole;
  content: string;
};

/** Options for {@link AiTextIntelligenceService.streamChat}. */
export type ChatStreamingOptions = {
  /** Called with each incoming text token. */
  onChunk: (text: string) => void;
  /** AbortSignal to cancel the stream. */
  signal?: AbortSignal;
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

export type AiTextIntelligenceServiceOptions = BaseFrontendClassOptions;

export type AiTextIntelligenceServiceInterface = BaseFrontendClassInterface & {
  /**
   * Streams a chat completion from the configured text provider.
   * Tokens are delivered via `onChunk` as they arrive over SSE.
   *
   * Resolves when the stream completes, rejects on network or abort errors.
   */
  streamChat(options: {
    messages: UnifiedChatMessage[];
    onChunk: (text: string) => void;
    signal?: AbortSignal;
    model?: string;
  }): Promise<void>;

  /**
   * Extracts a strictly-typed object from the LLM using a TypeBox schema
   * as a structural constraint. The schema is compiled into a standard
   * JSON Schema dictionary with `additionalProperties: false` enforced.
   *
   * @returns The parsed and validated object matching the schema type.
   */
  extractStructure<TSchema extends Record<string, unknown>>(options: {
    schema: TSchema;
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

/** Timeout for the entire fetch+stream operation (90 seconds). */
// TODO(C-107): Re-enable when streamChat is wired to microservice
const _FETCH_TIMEOUT_MS = 90_000;

/** Timeout for individual SSE stream read operations (30 seconds). */
// TODO(C-107): Re-enable when _readSSEStream is re-enabled
const _READ_TIMEOUT_MS = 30_000;

/** Maximum time to wait for the first SSE chunk (15 seconds). */
// TODO(C-107): Re-enable when _readSSEStream is re-enabled
const _FIRST_CHUNK_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class AiTextIntelligenceService
  extends BaseFrontendClass<AiTextIntelligenceServiceOptions>
  implements AiTextIntelligenceServiceInterface
{
  // ── Private state ─────────────────────────────────────────────────────

  private readonly _abortControllers = new Set<AbortController>();
  private _activeStreamCount = 0;
  private readonly _compiledSchemaCache = new Map<string, Record<string, unknown>>();

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Resolves the active provider configuration from ConfigService.
   *
   * Priority: explicit model param → configService.preferredModel →
   * first model in configService.state.models with a provider →
   * hardcoded default.
   */
  private _resolveProvider(options: { explicitModel?: string }): ResolvedRouting {
    const { explicitModel } = options;
    const { state } = configService;

    // Determine the model
    let model = explicitModel || state.preferredModel || '';
    let provider = 'openrouter';
    let endpoint = '';

    // If we have a model, find its provider from the models array
    if (model && state.models.length > 0) {
      const match = state.models.find((m) => m.model === model);
      if (match) {
        provider = match.provider || 'openrouter';
        endpoint = match.endpoint || '';
      }
    }

    // Fallback: take the first model config
    if (!model && state.models.length > 0) {
      model = state.models[0].model;
      provider = state.models[0].provider || 'openrouter';
      endpoint = state.models[0].endpoint || '';
    }

    // Absolute fallback
    if (!model) {
      model = 'liquid/lfm-2.5-1.2b-instruct:free';
      provider = 'openrouter';
    }

    return { provider, model, endpoint };
  }

  /** Updates the debug hook with current routing info. */
  private _exposeRouting(routing: ResolvedRouting): void {
    const g = globalThis as Record<string, unknown>;
    g.__ai_service_resolved_routing = routing;
  }

  /** Increments the active stream count and updates the debug hook. */
  private _incrementStreamCount(): void {
    this._activeStreamCount++;
    (globalThis as Record<string, unknown>).__ai_service_active_stream_count =
      this._activeStreamCount;
  }

  /** Decrements the active stream count and updates the debug hook. */
  private _decrementStreamCount(): void {
    this._activeStreamCount = Math.max(0, this._activeStreamCount - 1);
    (globalThis as Record<string, unknown>).__ai_service_active_stream_count =
      this._activeStreamCount;
  }

  // ── streamChat ────────────────────────────────────────────────────────

  async streamChat(options: {
    messages: UnifiedChatMessage[];
    onChunk: (text: string) => void;
    signal?: AbortSignal;
    model?: string;
  }): Promise<void> {
    // TODO(C-107): Re-enable when streamChat is wired to microservice
    const { messages, onChunk: _onChunk, signal, model: explicitModel } = options;

    const routing = this._resolveProvider({ explicitModel });
    this._exposeRouting(routing);

    const abortController = new AbortController();
    this._abortControllers.add(abortController);

    // Forward external abort signal
    if (signal) {
      if (signal.aborted) {
        this._abortControllers.delete(abortController);
        return;
      }
      signal.addEventListener('abort', () => abortController.abort(signal.reason), { once: true });
    }

    this._incrementStreamCount();

    try {
      // Build the request body
      const lastMsg = messages[messages.length - 1];
      const prompt = lastMsg?.role === 'user' ? lastMsg.content : '';
      const systemMsg = messages.find((m) => m.role === 'system');

      const body: Record<string, unknown> = {
        prompt,
        provider: routing.provider,
        model: routing.model,
        messages,
      };

      if (systemMsg) {
        body.systemPrompt = systemMsg.content;
      }

      if (routing.endpoint) {
        body.endpoint = routing.endpoint;
      }

      this.info('streamChat:fetching', {
        provider: routing.provider,
        model: routing.model,
        endpoint: routing.endpoint || '(default)',
        messageCount: messages.length,
        promptLength: prompt.length,
      });

      // Fetch with timeout (commented pending C-107)
      // const timeoutId = setTimeout(
      //   () => abortController.abort(new Error('Fetch timed out')),
      //   FETCH_TIMEOUT_MS,
      // );

      // TODO(C-107): Wire to microservice/firebase — the /api/text +server.ts route
      // was deleted for Tauri SPA enforcement (C-102). Stream chat must be re-routed
      // to a Firebase Function or Python microservice.
      //
      // const response = await fetch('/api/text', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify(body),
      //   signal: abortController.signal,
      // });
      //
      // clearTimeout(timeoutId);
      //
      // if (!response.ok) {
      //   const errorText = await response.text().catch(() => 'Unknown error');
      //   this.error('streamChat:fetch-failed', { status: response.status, errorText });
      //   throw new Error(`HTTP ${response.status}: ${errorText}`);
      // }
      //
      // if (!response.body) {
      //   throw new Error('No response body');
      // }
      //
      // await this._readSSEStream({
      //   body: response.body,
      //   signal: abortController.signal,
      //   onChunk,
      // });

      throw new Error('streamChat is temporarily disabled — pending C-107 microservice migration');
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

  async extractStructure<TSchema extends Record<string, unknown>>(options: {
    schema: TSchema;
    schemaName: string;
    prompt: string;
    systemPrompt?: string;
    signal?: AbortSignal;
    model?: string;
  }): Promise<unknown> {
    const { schema, schemaName, prompt, systemPrompt, signal, model: explicitModel } = options;

    const routing = this._resolveProvider({ explicitModel });
    this._exposeRouting(routing);

    // Compile TypeBox schema to strict JSON Schema
    const jsonSchema = this._compileSchemaToJson({ schema, schemaName });

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
      // Build extraction prompt with JSON schema constraint
      const extractionMessages: UnifiedChatMessage[] = [];

      if (systemPrompt) {
        extractionMessages.push({ role: 'system', content: systemPrompt });
      }

      // Append the JSON schema as a strict output constraint
      const schemaInstruction = [
        'You are a structured data extraction tool.',
        'Your response MUST be valid JSON that conforms to the following JSON Schema:',
        '```json',
        JSON.stringify(jsonSchema, null, 2),
        '```',
        'Respond ONLY with the JSON object. No markdown fences, no explanations.',
        'Do not include any properties not defined in the schema.',
      ].join('\n');

      extractionMessages.push({ role: 'system', content: schemaInstruction });
      extractionMessages.push({ role: 'user', content: prompt });

      const body: Record<string, unknown> = {
        prompt,
        provider: routing.provider,
        model: routing.model,
        messages: extractionMessages,
      };

      if (systemPrompt) {
        body.systemPrompt = systemPrompt;
      }

      if (routing.endpoint) {
        body.endpoint = routing.endpoint;
      }

      this.info('extractStructure:fetching', {
        provider: routing.provider,
        model: routing.model,
        schemaName,
        promptLength: prompt.length,
      });

      let accumulated = '';

      await this.streamChat({
        messages: extractionMessages,
        signal: abortController.signal,
        model: explicitModel,
        onChunk: (text: string) => {
          accumulated += text;
        },
      });

      // Parse the accumulated response as JSON
      const cleaned = this._sanitizeJsonResponse(accumulated);
      const parsed = JSON.parse(cleaned);

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
    (globalThis as Record<string, unknown>).__ai_service_active_stream_count = 0;
  }

  // ── Private: SSE stream reader ────────────────────────────────────────

  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: TODO(C-107) will re-enable
  private async _readSSEStream_disabled(options: {
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

    try {
      while (true) {
        if (signal.aborted) {
          return;
        }

        const timeout = isFirstChunk ? _FIRST_CHUNK_TIMEOUT_MS : _READ_TIMEOUT_MS;
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
          if (!line.startsWith('data: ')) {
            continue;
          }

          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            this.debug('_readSSEStream:received-DONE', { chunkCount });
            return;
          }

          try {
            const chunk = JSON.parse(data) as { text?: string };
            if (chunk.text) {
              onChunk(chunk.text);
              chunkCount++;
            }
          } catch {
            // Skip invalid JSON lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ── Private: Schema compilation ───────────────────────────────────────

  /**
   * Compiles a TypeBox TSchema into a strict JSON Schema dictionary
   * with `additionalProperties: false` enforced at every object level.
   *
   * TypeBox v1.x schemas are plain JSON Schema objects so we can
   * manipulate them directly.
   */
  private _compileSchemaToJson(options: {
    schema: Record<string, unknown>;
    schemaName: string;
  }): Record<string, unknown> {
    const { schema, schemaName } = options;

    // Check the cache
    const cached = this._compiledSchemaCache.get(schemaName);
    if (cached) {
      (globalThis as Record<string, unknown>).__ai_service_compiled_schema_cache_size =
        this._compiledSchemaCache.size;
      return cached;
    }

    // Deep clone and enforce strict constraints
    const raw = this._enforceStrictSchema(JSON.parse(JSON.stringify(schema)));
    const compiled = raw as Record<string, unknown>;

    // Top-level strict constraints
    compiled.additionalProperties = false;

    this._compiledSchemaCache.set(schemaName, compiled);

    (globalThis as Record<string, unknown>).__ai_service_compiled_schema_cache_size =
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

    // Only add additionalProperties: false to object types
    if (obj.type === 'object' || obj.properties !== undefined) {
      obj.additionalProperties = false;

      // Recurse into properties
      if (obj.properties && typeof obj.properties === 'object') {
        for (const key of Object.keys(obj.properties as Record<string, unknown>)) {
          (obj.properties as Record<string, unknown>)[key] = this._enforceStrictSchema(
            (obj.properties as Record<string, unknown>)[key],
          );
        }
      }
    }

    // Recurse into array items
    if (obj.type === 'array' && obj.items) {
      if (Array.isArray(obj.items)) {
        obj.items = (obj.items as unknown[]).map((item) => this._enforceStrictSchema(item));
      } else {
        obj.items = this._enforceStrictSchema(obj.items);
      }
    }

    // Recurse into allOf / anyOf / oneOf
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

    // Strip markdown code fences
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      text = fenceMatch[1].trim();
    }

    // Find the first { or [ and extract from there
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

    // Extract balanced braces/brackets
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

export const aiTextIntelligenceService: AiTextIntelligenceServiceInterface =
  AiTextIntelligenceService.create({
    className: 'AiTextIntelligenceService',
  });
