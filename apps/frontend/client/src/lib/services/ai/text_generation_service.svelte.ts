// apps/frontend/client/src/lib/services/ai/text_generation_service.svelte.ts
//
// Unified text generation service. Public interface (streamChat,
// extractStructure, cancelAll) is unchanged — internals delegate to the
// AI Provider Gateway (C-320). Provider routing, model selection, API keys,
// SSE streaming, and structured extraction are resolved once at the gateway
// boundary; no provider/endpoint conditionals remain here.
//
// Two disciplines this layer owns, both established by issue #382:
//
//   1. POLICY BEFORE SPEND. The effective routing is resolved BEFORE any
//      opportunistic local execution. Previously the local-first helper ran
//      first and did not receive the caller's explicit model override, so a
//      caller that had deliberately pinned a model could still have its request
//      served by a different on-device bundle, and a task whose connection
//      routed to the cloud could still pay a cold local load first. An explicit
//      override, and any routing that is not local, now skip the local attempt.
//
//   2. ONE DEADLINE PER REQUEST. The local attempt, the gateway call and every
//      fallback between them draw from one absolute deadline
//      (`ai_request_deadline.ts`) instead of each minting its own timeout. A
//      cold local load can therefore never consume the budget the configured
//      gateway path still needs.
//
// Contract: C-080, C-111, C-320, issue #382 P0

import {
  estimateTextTokens,
  TEXT_TASK_PRESETS,
  type TextTask,
  textTaskBudgetMs,
} from '@aikami/constants';
import {
  isAiGatewayError,
  sanitizeJsonResponse,
  validateAgainstSchema,
} from '@aikami/frontend/ai-gateway';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type { AiModeResolution } from '@aikami/types';
import type { TextChatMessage } from '$types';
import { aiGatewayService } from './ai_gateway_service.svelte.ts';
import {
  type AiRequestDeadline,
  createAiRequestDeadline,
  createUnboundedAiDeadline,
} from './ai_request_deadline.ts';
import { localTaskPoolService } from './local_task_pool_service.svelte.ts';
import { resolveLocalFirstPolicy } from './text_local_first_policy.ts';
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
    /**
     * Absolute epoch ms by which the whole request must finish. When set, the
     * caller's budget is adopted rather than a new one minted — see
     * {@link AiRequestDeadline}.
     */
    deadlineAt?: number;
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
    /**
     * Absolute epoch ms by which the whole request must finish. A caller with
     * its own budget (a combat turn, a dialogue turn) passes it so the local
     * attempt and the gateway call share ONE clock instead of each restarting
     * one. When omitted, the task preset's `budgetMs` applies; a task with no
     * budget is unbounded.
     */
    deadlineAt?: number;
    /**
     * Correlates this call with the turn that caused it. Purely diagnostic —
     * it never changes behaviour — but it is what makes a turn's agent calls,
     * retries and fallbacks one traceable line.
     */
    requestId?: string;
    /** The turn this call belongs to, when it is a nested/child call. */
    parentRequestId?: string;
  }): Promise<unknown>;

  /** Aborts all active stream connections. */
  cancelAll(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Ceiling on the opportunistic local attempt, before the shared deadline trims
 * it. A micro-task that has not answered inside this is worse than a cloud
 * answer, so the local path is a bonus, never the critical path.
 */
const LOCAL_FIRST_TIMEOUT_MS = 5_000;

/**
 * Rethrows a pre-aborted caller's cancellation reason.
 *
 * A call whose signal is already aborted must not reach routing, the local
 * engine or the provider at all — and it must not report a timeout, because
 * nobody waited.
 */
const throwIfAlreadyAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted !== true) {
    return;
  }
  if (signal.reason !== undefined) {
    throw signal.reason;
  }
  const error = new Error('Aborted');
  error.name = 'AbortError';
  throw error;
};

/**
 * How long a local engine that just failed is skipped, tracked PER BACKEND so
 * one dead engine cannot suppress a healthy alternative.
 */
const LOCAL_COOLDOWN_MS = 60_000;

class TextGenerationService
  extends BaseFrontendClass<TextGenerationServiceOptions>
  implements TextGenerationServiceInterface
{
  // ── Private state ─────────────────────────────────────────────────────

  private readonly _abortControllers = new Set<AbortController>();
  private _activeStreamCount = 0;
  /**
   * Per-backend cooldown. Keyed by the resolved route so a local HTTP engine
   * that is down never suppresses the in-browser worker, and a cloud cooldown
   * never suppresses local execution.
   */
  private readonly _localCooldownUntil = new Map<string, number>();

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

  /** Whether a route is inside its cooldown after a local failure. */
  private _inCooldown(routeKey: string): boolean {
    return Date.now() < (this._localCooldownUntil.get(routeKey) ?? 0);
  }

  /** Cools one route down without touching any other route. */
  private _coolDown(routeKey: string): void {
    this._localCooldownUntil.set(routeKey, Date.now() + LOCAL_COOLDOWN_MS);
  }

  /** Clears one route's cooldown after a confirmed local success. */
  private _clearCooldown(routeKey: string): void {
    this._localCooldownUntil.delete(routeKey);
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

  /**
   * Builds the ONE deadline for a logical request.
   *
   * A caller-supplied `deadlineAt` is adopted verbatim so a combat turn's
   * budget is not silently replaced by a task default. Otherwise the task
   * preset's budget applies, and a task with no budget is deliberately
   * unbounded — background work's deadline is the campaign, not a stopwatch.
   */
  private _deadlineFor(options: {
    deadlineAt?: number;
    task?: TextTask;
    signal?: AbortSignal;
  }): AiRequestDeadline {
    if (options.deadlineAt !== undefined) {
      const startedAt = Date.now();
      return createAiRequestDeadline({
        startedAt,
        hardDeadlineMs: Math.max(0, options.deadlineAt - startedAt),
        ...(options.signal === undefined ? {} : { callerSignal: options.signal }),
      });
    }
    const budgetMs = textTaskBudgetMs(options.task);
    if (budgetMs === undefined) {
      return createUnboundedAiDeadline(options.signal);
    }
    return createAiRequestDeadline({
      hardDeadlineMs: budgetMs,
      ...(options.signal === undefined ? {} : { callerSignal: options.signal }),
    });
  }

  /** Recognizes expiry even before the deadline timer has had a turn to fire. */
  private _deadlineExceeded(deadline?: AiRequestDeadline): boolean {
    return (
      deadline?.stopReason() === 'deadline' ||
      (deadline?.stopReason() !== 'caller-abort' && deadline?.expired() === true)
    );
  }

  /** Records one completed call into the rolling telemetry buffer. */
  private _recordSpan(options: {
    start: number;
    startedAt: string;
    resolution?: AiModeResolution;
    task?: TextTask;
    streamed: boolean;
    ttftMs?: number;
    promptChars: number;
    completionChars: number;
    ok: boolean;
    error?: unknown;
    requestId?: string;
    parentRequestId?: string;
    deadline?: AiRequestDeadline;
    fallback?: boolean;
    usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
  }): void {
    const {
      start,
      startedAt,
      resolution,
      task,
      streamed,
      ttftMs,
      promptChars,
      completionChars,
      ok,
      error,
      requestId,
      parentRequestId,
      deadline,
      fallback,
      usage,
    } = options;
    let errorCode: string | undefined;
    if (isAiGatewayError(error)) {
      errorCode = error.code;
    } else if (error) {
      errorCode = this._isCancellation(error) ? 'cancelled' : 'error';
    }
    textTelemetryService.record({
      task,
      provider: resolution?.provider ?? 'unknown',
      model: resolution?.model ?? '',
      mode: resolution?.mode ?? 'unknown',
      streamed,
      ttftMs,
      totalMs: Math.round(performance.now() - start),
      promptTokens: usage?.inputTokens ?? estimateTextTokens(promptChars),
      completionTokens: usage?.outputTokens ?? estimateTextTokens(completionChars),
      // The provenance of the counts above. A provider-reported figure and a
      // character-count estimate are both useful, but only one of them is a
      // bill — so the span records which one it is holding.
      tokenSource: usage === undefined ? 'estimated' : 'provider',
      ...(usage?.cachedTokens === undefined ? {} : { cachedTokens: usage.cachedTokens }),
      startedAt,
      ok,
      ...(errorCode === undefined ? {} : { errorCode }),
      ...(requestId === undefined ? {} : { requestId }),
      ...(parentRequestId === undefined ? {} : { parentRequestId }),
      fallback,
      deadlineExceeded: this._deadlineExceeded(deadline),
      ...(deadline === undefined ? {} : { deadlineRemainingMs: deadline.remainingMs() }),
    });
  }

  /**
   * Attempts a local-first structured extraction for tasks whose preset sets
   * `localFirst`. Returns undefined when policy forbids it, the local route is
   * cooling down, the engine cannot serve the requested model, the window is
   * already spent, or the local output is not valid JSON — the caller then falls
   * back to the gateway.
   *
   * The window is derived from the shared deadline, so the attempt can never
   * outlive the budget the gateway path still needs.
   */
  private async _tryLocalStructured(options: {
    prompt: string;
    systemPrompt?: string;
    schema: Record<string, unknown>;
    task?: TextTask;
    signal: AbortSignal;
    deadline: AiRequestDeadline;
    resolution: AiModeResolution;
    allowLocal: boolean;
    onAttempt: () => void;
  }): Promise<unknown | undefined> {
    const { prompt, systemPrompt, schema, task, signal, deadline, resolution, allowLocal } =
      options;
    const preset = task === undefined ? undefined : TEXT_TASK_PRESETS[task];
    const routeKey = `${resolution.provider}|${resolution.model ?? ''}|local-tasks`;
    if (!allowLocal || preset?.localFirst !== true || this._inCooldown(routeKey)) {
      return undefined;
    }
    // Readiness is per model: a served-model list that omits the model this
    // route would generate with is not proof the engine can serve it.
    if (!localTaskPoolService.canServeLocal(resolution.model)) {
      return undefined;
    }
    const window = deadline.windowMs(LOCAL_FIRST_TIMEOUT_MS);
    if (window === undefined) {
      return undefined;
    }

    options.onAttempt();
    const controller = new AbortController();
    let localTimedOut = false;
    const timeoutId = setTimeout(() => {
      localTimedOut = true;
      controller.abort();
    }, window);
    const onExternalAbort = (): void => controller.abort(signal.reason);
    signal.addEventListener('abort', onExternalAbort, { once: true });
    const onDeadlineAbort = (): void => controller.abort(deadline.signal.reason);
    deadline.signal.addEventListener('abort', onDeadlineAbort, { once: true });
    if (signal.aborted) {
      onExternalAbort();
    } else if (deadline.signal.aborted) {
      onDeadlineAbort();
    }

    try {
      await localTaskPoolService.pool.ensureLoaded(controller.signal);
      const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;
      const result = await localTaskPoolService.pool.submit(
        {
          type: 'text',
          payload: {
            prompt: fullPrompt,
            maxTokens: preset.maxTokens,
            temperature: preset.temperature,
          },
        },
        controller.signal,
      );
      const parsed: unknown = JSON.parse(sanitizeJsonResponse(result.output));
      if (!validateAgainstSchema({ schema, parsed })) {
        // Structurally wrong local output — cool down and use the gateway.
        this._coolDown(routeKey);
        return undefined;
      }
      this._clearCooldown(routeKey);
      return parsed;
    } catch {
      // Caller cancellation and exhausted time windows do not prove an engine failure.
      if (!signal.aborted && !deadline.signal.aborted && !deadline.expired() && !localTimedOut) {
        this._coolDown(routeKey);
      }
      return undefined;
    } finally {
      clearTimeout(timeoutId);
      signal.removeEventListener('abort', onExternalAbort);
      deadline.signal.removeEventListener('abort', onDeadlineAbort);
    }
  }

  /**
   * The configured-route half of a structured request.
   *
   * Split out of `extractStructure` so the caller's control flow reads as the
   * two decisions it actually is — "may I go local?" and "what does the
   * configured route say?" — rather than as one long branch.
   */
  private async _generateStructured(options: {
    schema: Record<string, unknown>;
    schemaName: string;
    prompt: string;
    systemPrompt?: string;
    model?: string;
    task?: TextTask;
    signal: AbortSignal;
    deadline: AiRequestDeadline;
    onResolve: (resolution: AiModeResolution) => void;
  }): Promise<{
    structured?: unknown;
    usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
  }> {
    const { schema, schemaName, prompt, systemPrompt, model, task, signal, deadline, onResolve } =
      options;
    const messages: TextChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    if (deadline.expired()) {
      throw new DOMException('Request deadline exceeded', 'AbortError');
    }
    const result = await aiGatewayService.generateText({
      messages,
      schema,
      schemaName,
      model,
      task,
      // ONE clock: the call cannot outlive the budget the caller handed down.
      signal: AbortSignal.any([signal, deadline.signal]),
      onResolve: (resolved) => {
        onResolve(resolved);
        this._exposeRouting(resolved);
      },
    });
    return {
      ...(result.structured === undefined ? {} : { structured: result.structured }),
      ...(result.usage === undefined ? {} : { usage: result.usage }),
    };
  }

  // ── streamChat ────────────────────────────────────────────────────────

  async streamChat(options: {
    messages: TextChatMessage[];
    onChunk: (text: string) => void;
    signal?: AbortSignal;
    model?: string;
    endpoint?: string;
    task?: TextTask;
    deadlineAt?: number;
  }): Promise<void> {
    const { messages, onChunk, signal, model, endpoint, task, deadlineAt } = options;

    if (signal?.aborted) {
      return;
    }

    const { controller: abortController, cleanup } = this._linkController(signal);
    this._incrementStreamCount();
    const deadline = this._deadlineFor({ deadlineAt, task, signal });

    const start = performance.now();
    const startedAt = new Date().toISOString();
    let resolution: AiModeResolution | undefined;
    let ttftMs: number | undefined;
    let completionChars = 0;
    const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);

    try {
      if (deadline.expired()) {
        throw new DOMException('Request deadline exceeded', 'AbortError');
      }
      const result = await aiGatewayService.generateText({
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
        // ONE clock: the gateway call cannot outlive the caller's budget.
        signal: AbortSignal.any([abortController.signal, deadline.signal]),
        onResolve: (resolved) => {
          resolution = resolved;
          this._exposeRouting(resolved);
        },
      });
      this.info('streamChat:complete');
      this._recordSpan({
        start,
        startedAt,
        resolution,
        task,
        streamed: true,
        ttftMs,
        promptChars,
        completionChars,
        ok: true,
        deadline,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      });
    } catch (error: unknown) {
      this._recordSpan({
        start,
        startedAt,
        resolution,
        task,
        streamed: true,
        ttftMs,
        promptChars,
        completionChars,
        ok: false,
        error,
        deadline,
      });
      if (this._isCancellation(error)) {
        this.debug('streamChat:aborted');
        if (this._deadlineExceeded(deadline)) {
          throw error;
        }
        return;
      }
      this.error('streamChat:failed', error);
      throw error;
    } finally {
      cleanup();
      this._abortControllers.delete(abortController);
      this._decrementStreamCount();
      deadline.dispose();
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
    deadlineAt?: number;
    requestId?: string;
    parentRequestId?: string;
  }): Promise<unknown> {
    const {
      schema,
      schemaName,
      prompt,
      systemPrompt,
      signal,
      model,
      task,
      deadlineAt,
      requestId,
      parentRequestId,
    } = options;
    throwIfAlreadyAborted(signal);

    const { controller: abortController, cleanup } = this._linkController(signal);
    this._incrementStreamCount();
    const deadline = this._deadlineFor({ deadlineAt, task, signal });

    const start = performance.now();
    const startedAt = new Date().toISOString();
    let resolution: AiModeResolution | undefined;
    const promptChars = prompt.length + (systemPrompt?.length ?? 0);
    let localAttempted = false;
    let fallback = false;
    const shared = {
      start,
      startedAt,
      task,
      streamed: false,
      promptChars,
      deadline,
      ...(requestId === undefined ? {} : { requestId }),
      ...(parentRequestId === undefined ? {} : { parentRequestId }),
    };

    try {
      if (deadline.expired()) {
        throw new DOMException('Request deadline exceeded', 'AbortError');
      }
      // ── Resolve policy BEFORE spending anything ─────────────────────
      //
      // The local attempt is opportunistic, so it may only run when the
      // configured routing permits it: no explicit override, and a route that
      // is actually local. Resolving first is what makes an explicit model
      // override authoritative instead of advisory.
      const routing = this._resolveRouting({ model, task });
      resolution = routing;

      const localResult = await this._tryLocalStructured({
        prompt,
        systemPrompt,
        schema,
        task,
        signal: abortController.signal,
        deadline,
        resolution: routing,
        onAttempt: () => {
          localAttempted = true;
        },
        allowLocal: resolveLocalFirstPolicy({
          resolution: routing,
          preset: task === undefined ? undefined : TEXT_TASK_PRESETS[task],
          hasExplicitModel: model !== undefined && model.length > 0,
          readiness: localTaskPoolService.readiness,
        }).allowed,
      });
      if (localResult !== undefined) {
        this.debug('extractStructure:local-first', { schemaName, task });
        this._recordSpan({
          ...shared,
          resolution: { ...routing, mode: 'offline', provider: 'local-tasks', model: '' },
          completionChars: JSON.stringify(localResult).length,
          ok: true,
        });
        return localResult;
      }

      if (deadline.expired()) {
        throw new DOMException('Request deadline exceeded', 'AbortError');
      }
      throwIfAlreadyAborted(abortController.signal);
      fallback = localAttempted;
      const result = await this._generateStructured({
        schema,
        schemaName,
        prompt,
        systemPrompt,
        model,
        task,
        signal: abortController.signal,
        deadline,
        onResolve: (resolved) => {
          resolution = resolved;
        },
      });

      this.debug('extractStructure:done', { schemaName });
      this._recordSpan({
        ...shared,
        fallback,
        resolution,
        completionChars:
          result.structured === undefined ? 0 : JSON.stringify(result.structured).length,
        ok: true,
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      });
      return result.structured;
    } catch (error: unknown) {
      this._recordSpan({
        ...shared,
        fallback,
        resolution,
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
      deadline.dispose();
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
    this._localCooldownUntil.clear();
    await super.dispose();
  }

  /**
   * Resolves the routing a gateway call WOULD use, without dispatching it.
   *
   * Reading it from the gateway rather than re-deriving it is the point: a
   * second implementation of task-role routing here would eventually disagree
   * with the dispatch path, and the disagreement would be invisible.
   */
  private _resolveRouting(options: { model?: string; task?: TextTask }): AiModeResolution {
    try {
      return aiGatewayService.resolveText({
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.task === undefined ? {} : { task: options.task }),
      });
    } catch {
      // An unresolvable routing would fail the gateway call anyway; the local
      // attempt is skipped and the caller sees the gateway's own error.
      return { capability: 'text', mode: 'byok', provider: 'unknown', model: '' };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const textGenerationService: TextGenerationServiceInterface = TextGenerationService.create({
  className: 'TextGenerationService',
});
