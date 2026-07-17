// apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts
//
// Unified text generation service. Public interface (streamChat,
// extractStructure, cancelAll) is unchanged — internals delegate to the
// AI Provider Gateway (C-320). Provider routing, model selection, API keys,
// SSE streaming, and structured extraction are resolved once at the gateway
// boundary; no provider/endpoint conditionals remain here.
//
// Contract: C-080, C-111, C-320

import { isAiGatewayError } from '@aikami/frontend/ai-gateway';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { AiModeResolution } from '@aikami/types';
import { aiGatewayService } from '$lib/services/ai/ai_gateway_service.svelte.ts';

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

  // ── Private: diagnostics globals (legacy debug hooks) ─────────────────

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
  private _linkController(signal?: AbortSignal): { controller: AbortController; cleanup: () => void } {
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

  // ── streamChat ────────────────────────────────────────────────────────

  async streamChat(options: {
    messages: TextChatMessage[];
    onChunk: (text: string) => void;
    signal?: AbortSignal;
    model?: string;
  }): Promise<void> {
    const { messages, onChunk, signal, model } = options;

    if (signal?.aborted) {
      return;
    }

    const { controller: abortController, cleanup } = this._linkController(signal);
    this._incrementStreamCount();

    try {
      await aiGatewayService.generateText({
        messages,
        onChunk,
        model,
        signal: abortController.signal,
        onResolve: (resolution) => this._exposeRouting(resolution),
      });
      this.info('streamChat:complete');
    } catch (error: unknown) {
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
  }): Promise<unknown> {
    const { schema, schemaName, prompt, systemPrompt, signal, model } = options;

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
        signal: abortController.signal,
        onResolve: (resolution) => this._exposeRouting(resolution),
      });

      this.debug('extractStructure:done', { schemaName });
      return result.structured;
    } catch (error: unknown) {
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
