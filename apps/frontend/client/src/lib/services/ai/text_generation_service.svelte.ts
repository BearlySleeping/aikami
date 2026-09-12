// apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts
//
// Unified text generation service. Public interface (streamChat,
// extractStructure, cancelAll) is unchanged — internals delegate to the
// AI Provider Gateway (C-320). Provider routing, model selection, API keys,
// SSE streaming, and structured extraction are resolved once at the gateway
// boundary; no provider/endpoint conditionals remain here.
//
// Contract: C-080, C-111, C-320

import { estimateTextTokens, type TextTask } from '@aikami/constants';
import { isAiGatewayError } from '@aikami/frontend/ai-gateway';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type { AiModeResolution } from '@aikami/types';
import type { TextChatMessage } from '$types';
import { aiGatewayService } from './ai_gateway_service.svelte.ts';
import { textTelemetryService } from './text_telemetry_service.svelte.ts';

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export type TextGenerationServiceOptions = BaseFrontendClassOptions;

export type TextGenerationServiceInterface = BaseFrontendClassInterface & {
  /**
   * Streams a chat completion from the configured text provider via
   * the provider's chat completions SSE endpoint. Tokens are delivered
   * via `onChunk` as they arrive.
   *
   * Resolves when the stream completes, rejects on network or abort errors.
   */
  streamChat(options: {
    messages: TextChatMessage[];
    onChunk: (text: string) => void;
    signal?: AbortSignal;
    model?: string;
    endpoint?: string;
    /** Task type — drives role routing and the per-task generation preset. */
    task?: TextTask;
  }): Promise<void>;

  /**
   * Extracts a strictly-typed object from the LLM using a TypeBox schema
   * as a structural constraint. The schema is compiled into a standard
   * JSON Schema dictionary with `additionalProperties: false` enforced
   * and sent via the provider's native `response_format: json_schema`.
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
    /** Task type — drives role routing and the per-task generation preset. */
    task?: TextTask;
  }): Promise<unknown>;

  /** Aborts all active stream connections. */
  cancelAll(): void;
};

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

  // ── Private: diagnostics globals ─────────────────────────────────────

  private _exposeRouting(resolution: AiModeResolution): void {
    const g = globalThis as Record<string, unknown>;
    g.__text_service_resolved_routing = {
      provider: resolution.provider,
      model: resolution.model ?? '',
      endpoint: resolution.endpoint ?? '',
    };
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

  /** Registers a per-call controller linked to the caller's signal. */
  private _linkController(signal?: AbortSignal): {
    controller: AbortController;
    cleanup: () => void;
  } {
    const abortController = new AbortController();
    this._abortControllers.add(abortController);
    let cleanup = () => {};
    if (signal) {
      if (signal.aborted) {
        abortController.abort(signal.reason);
      } else {
        const handler = () => abortController.abort(signal.reason);
        signal.addEventListener('abort', handler, { once: true });
        cleanup = () => signal.removeEventListener('abort', handler);
      }
    }
    return { controller: abortController, cleanup };
  }

  /** Whether the error represents cancellation (typed or raw AbortError). */
  private _isCancellation(error: unknown): boolean {
    if (isAiGatewayError(error)) {
      return error.code === 'cancelled';
    }
    return (error as Error)?.name === 'AbortError';
  }

  /** Records one completed call into the rolling telemetry buffer. */
  private _recordSpan(options: {
    start: number;
    resolution?: AiModeResolution;
    task?: TextTask;
    streamed: boolean;
    ttftMs?: number;
    promptChars: number;
    completionChars: number;
    ok: boolean;
    error?: unknown;
  }): void {
    const { start, resolution, task, streamed, ttftMs, promptChars, completionChars, ok, error } =
      options;
    let errorCode: string | undefined;
    if (isAiGatewayError(error)) {
      errorCode = error.code;
    } else if (error) {
      errorCode = 'error';
    }
    textTelemetryService.record({
      task,
      provider: resolution?.provider ?? 'unknown',
      model: resolution?.model ?? '',
      mode: resolution?.mode ?? 'unknown',
      streamed,
      ttftMs,
      totalMs: Math.round(performance.now() - start),
      promptTokens: estimateTextTokens(promptChars),
      completionTokens: estimateTextTokens(completionChars),
      ok,
      errorCode,
    });
  }

  // ── streamChat ────────────────────────────────────────────────────────

  async streamChat(options: {
    messages: TextChatMessage[];
    onChunk: (text: string) => void;
    signal?: AbortSignal;
    model?: string;
    endpoint?: string;
    task?: TextTask;
  }): Promise<void> {
    const { messages, onChunk, signal, model, endpoint, task } = options;

    if (signal?.aborted) {
      return;
    }

    const { controller: abortController, cleanup } = this._linkController(signal);
    this._incrementStreamCount();

    const start = performance.now();
    let resolution: AiModeResolution | undefined;
    let ttftMs: number | undefined;
    let completionChars = 0;
    const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);

    try {
      await aiGatewayService.generateText({
        messages,
        onChunk: (chunk) => {
          if (ttftMs === undefined) {
            ttftMs = Math.round(performance.now() - start);
          }
          completionChars += chunk.length;
          onChunk(chunk);
        },
        model,
        endpoint,
        task,
        signal: abortController.signal,
        onResolve: (resolved) => {
          resolution = resolved;
          this._exposeRouting(resolved);
        },
      });
      this.info('streamChat:complete');
      this._recordSpan({
        start,
        resolution,
        task,
        streamed: true,
        ttftMs,
        promptChars,
        completionChars,
        ok: true,
      });
    } catch (error: unknown) {
      this._recordSpan({
        start,
        resolution,
        task,
        streamed: true,
        ttftMs,
        promptChars,
        completionChars,
        ok: false,
        error,
      });
      if (this._isCancellation(error)) {
        this.debug('streamChat:aborted');
        return;
      }
      this.error('streamChat:failed', error);
      throw error;
    } finally {
      cleanup();
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
    task?: TextTask;
  }): Promise<unknown> {
    const { schema, schemaName, prompt, systemPrompt, signal, model, task } = options;

    if (signal?.aborted) {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      if (signal.reason !== undefined) {
        throw signal.reason;
      }
      throw error;
    }

    const { controller: abortController, cleanup } = this._linkController(signal);
    this._incrementStreamCount();

    const start = performance.now();
    let resolution: AiModeResolution | undefined;
    const promptChars = prompt.length + (systemPrompt?.length ?? 0);

    try {
      const messages: TextChatMessage[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: prompt });

      const result = await aiGatewayService.generateText({
        messages,
        schema,
        schemaName,
        model,
        task,
        signal: abortController.signal,
        onResolve: (resolved) => {
          resolution = resolved;
          this._exposeRouting(resolved);
        },
      });

      this.debug('extractStructure:done', { schemaName });
      this._recordSpan({
        start,
        resolution,
        task,
        streamed: false,
        promptChars,
        completionChars:
          result.structured === undefined ? 0 : JSON.stringify(result.structured).length,
        ok: true,
      });
      return result.structured;
    } catch (error: unknown) {
      this._recordSpan({
        start,
        resolution,
        task,
        streamed: false,
        promptChars,
        completionChars: 0,
        ok: false,
        error,
      });
      if (this._isCancellation(error)) {
        this.debug('extractStructure:aborted');
        throw error;
      }
      this.error('extractStructure:failed', error);
      throw error;
    } finally {
      cleanup();
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
