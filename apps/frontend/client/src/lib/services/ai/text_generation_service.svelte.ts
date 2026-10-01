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

import { TEXT_TASK_PRESETS, type TextTask } from '@aikami/constants';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services/base';
import type { AiModeResolution } from '@aikami/types';
import type { TextChatMessage } from '$types';
import { aiGatewayService } from './ai_gateway_service.svelte.ts';
import type { AiRequestDeadline } from './ai_request_deadline.ts';
import { createLocalFirstRoute, type LocalFirstRoute } from './local_first_route.ts';
import { localTaskPoolService } from './local_task_pool_service.svelte.ts';
import type { StructuredCallCoalescer } from './structured_call_coalescer.ts';
import { createStructuredCallCoalescer } from './structured_call_coalescer.ts';
import { resolveLocalFirstPolicy } from './text_local_first_policy.ts';
import {
  type AdmissionObservation,
  createServiceInferenceAdmission,
  type ServiceInferenceAdmission,
  type TextAdmissionLease,
} from './text_request_admission.ts';
import {
  createRequestDeadline,
  isDeadlineExceeded,
  isRequestCancellation,
  throwIfAlreadyAborted,
  throwIfPastDeadline,
} from './text_request_lifetime.ts';
import {
  decrementActiveTextRequests,
  incrementActiveTextRequests,
  publishResolvedTextRouting,
  resetActiveTextRequests,
} from './text_service_diagnostics.ts';
import { recordTextCall, type TextCallObservation } from './text_telemetry_recorder.ts';

/** Provider-reported token counts, or a character-count estimate standing in. */
type TextUsage = { inputTokens: number; outputTokens: number; cachedTokens?: number };

/** What one configured-route structured call produced. */
type CoalescedStructuredResult = {
  structured?: unknown;
  coalesced: boolean;
  usage?: TextUsage;
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

class TextGenerationService
  extends BaseFrontendClass<TextGenerationServiceOptions>
  implements TextGenerationServiceInterface
{
  // ── Private state ─────────────────────────────────────────────────────

  private readonly _abortControllers = new Set<AbortController>();
  /** The opportunistic on-device attempt and its per-route cooldowns. */
  private readonly _localFirst: LocalFirstRoute = createLocalFirstRoute();
  /**
   * Coalesces identical structured requests that are in flight at the same time.
   *
   * Two subscribers to the same request are the same work: the provider sees one
   * call, the latency budget is spent once, and each subscriber still gets its
   * own answer and its own cancellation. It is deliberately NOT a result cache —
   * an entry is dropped the moment its attempt settles.
   */
  private readonly _coalescer: StructuredCallCoalescer = createStructuredCallCoalescer({
    debug: (label, detail) => this.debug(label, detail),
  });
  /**
   * Priority-aware admission for expensive inference (issue #382).
   *
   * Owned HERE rather than in a new global scheduler because this service
   * already owns every fact admission needs: the logical request's lifetime,
   * caller abort linkage, the ONE absolute deadline, the local-first vs gateway
   * decision, the coalescer and the telemetry. A separate service would have to
   * be told all of it, and would be told it incorrectly the first time one of
   * those changed.
   */
  private readonly _admission: ServiceInferenceAdmission = createServiceInferenceAdmission();

  // ── Private: diagnostics ────────────────────────────────────────────

  private _exposeRouting(resolution: AiModeResolution): void {
    publishResolvedTextRouting(resolution);
  }

  private _incrementStreamCount(): void {
    incrementActiveTextRequests();
  }

  private _decrementStreamCount(): void {
    decrementActiveTextRequests();
  }

  /**
   * Reserves the contended resource.
   *
   * The returned lease is released by the CALLER, in a `finally`: a lease that
   * leaked on a throw would close the domain to background work for the rest of
   * the session, which is indistinguishable from "background is being starved".
   */
  private async _admit(options: {
    routing: AiModeResolution;
    task?: TextTask;
    signal: AbortSignal;
    onAdmit?: (observation: AdmissionObservation) => void;
  }) {
    return await this._admission.acquire(options);
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

  /**
   * The configured-route half of a structured request.
   *
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
    routing: AiModeResolution;
    onResolve: (resolution: AiModeResolution) => void;
    onAdmit?: (observation: AdmissionObservation) => void;
  }): Promise<{
    structured?: unknown;
    usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
  }> {
    const {
      schema,
      schemaName,
      prompt,
      systemPrompt,
      model,
      task,
      signal,
      deadline,
      routing,
      onResolve,
      onAdmit,
    } = options;
    const messages: TextChatMessage[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });

    if (deadline.expired()) {
      throw new DOMException('Request deadline exceeded', 'AbortError');
    }
    // 🔴 ADMISSION GOES HERE, not at `extractStructure` and not at the
    // coalescer's edge.
    //
    // Inside the coalescer: two identical concurrent subscribers become ONE
    // shared attempt, which then queues ONCE. Putting the gate outside it
    // would serialize the two subscribers and turn "one provider call" back
    // into "call A completes, then call B" — silently disabling #411's
    // deduplication for the exact simultaneous case it exists to handle.
    //
    // Before the provider call: this is the shared, expensive, contended work.
    // The local-first attempt is deliberately NOT gated — it is a different
    // resource (a distinct provider id, hence a distinct contention domain)
    // and is free and near-instant, so queueing it would delay a player for
    // nothing.
    const lease = await this._admit({
      routing,
      ...(task === undefined ? {} : { task }),
      signal: AbortSignal.any([signal, deadline.signal]),
      ...(onAdmit === undefined ? {} : { onAdmit }),
    });
    try {
      // The quiet window may have spent the budget; re-check before paying for
      // an answer nobody can still receive.
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
    } finally {
      lease.release();
    }
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
    const deadline = createRequestDeadline({ deadlineAt, task, signal });

    const start = performance.now();
    const startedAt = new Date().toISOString();
    let resolution: AiModeResolution | undefined;
    let ttftMs: number | undefined;
    let completionChars = 0;
    const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
    // Resolved BEFORE the call so the contention domain is known up front. An
    // interactive stream is never gated, but it must be VISIBLE to the gate —
    // this is the lane that keeps background summarization off the provider
    // while the player is reading.
    const routing = this._resolveRouting({ model, task, endpoint });
    let lease: TextAdmissionLease | undefined;

    try {
      if (deadline.expired()) {
        throw new DOMException('Request deadline exceeded', 'AbortError');
      }
      lease = await this._admit({
        routing,
        ...(task === undefined ? {} : { task }),
        signal: AbortSignal.any([abortController.signal, deadline.signal]),
      });
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
      recordTextCall({
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
        // Interactive work is admitted immediately, so this is a real
        // measurement of zero rather than an absent one.
        ...(lease === undefined ? {} : { queueMs: lease.queueMs, queueDepth: lease.queueDepth }),
        ...(result.usage === undefined ? {} : { usage: result.usage }),
      });
    } catch (error: unknown) {
      recordTextCall({
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
        ...(lease === undefined ? {} : { queueMs: lease.queueMs, queueDepth: lease.queueDepth }),
      });
      if (isRequestCancellation(error)) {
        this.debug('streamChat:aborted');
        if (isDeadlineExceeded(deadline)) {
          throw error;
        }
        return;
      }
      this.error('streamChat:failed', error);
      throw error;
    } finally {
      lease?.release();
      cleanup();
      this._abortControllers.delete(abortController);
      this._decrementStreamCount();
      deadline.dispose();
    }
  }

  /**
   * The configured-route half of a structured request, with identical concurrent
   * calls merged onto one provider call.
   *
   * The local attempt deliberately stays OUTSIDE this: a local answer is free
   * and near-instant, so paying for it twice costs nothing, and keeping it
   * per-caller preserves each caller's own deadline. The provider call is the
   * expensive half, so that is the half worth sharing.
   */
  private async _runCoalescedStructured(options: {
    schema: Record<string, unknown>;
    schemaName: string;
    prompt: string;
    systemPrompt?: string;
    model?: string;
    task?: TextTask;
    signal: AbortSignal;
    deadline: AiRequestDeadline;
    routing: AiModeResolution;
    onResolve: (resolution: AiModeResolution) => void;
    onAdmit?: (observation: AdmissionObservation) => void;
  }): Promise<CoalescedStructuredResult> {
    const {
      schema,
      schemaName,
      prompt,
      systemPrompt,
      model,
      task,
      signal,
      routing,
      onResolve,
      onAdmit,
    } = options;
    // 🔴 The shared work inherits the initiator's ABSOLUTE deadline, including
    // time already spent on the local attempt. Deriving a fresh one from the
    // task would silently hand the shared call a whole new budget, so the total
    // wall-clock cost of a request would grow with every coalesced subscriber.
    // Only the SIGNAL stays per-caller: inheriting that would let one
    // subscriber's cancellation kill the work everyone else is waiting for,
    // which is the exact failure the reference counting exists to prevent.
    const inheritedDeadlineAt = Number.isFinite(options.deadline.deadlineAt)
      ? options.deadline.deadlineAt
      : undefined;
    const outcome = await this._coalescer.run<Omit<CoalescedStructuredResult, 'coalesced'>>({
      identity: {
        task,
        schemaName,
        schema,
        systemPrompt: systemPrompt ?? '',
        prompt,
        model,
      },
      signal,
      sharedDeadline: () => createRequestDeadline({ deadlineAt: inheritedDeadlineAt, task }),
      call: (sharedSignal, sharedDeadline) =>
        this._generateStructured({
          schema,
          schemaName,
          prompt,
          systemPrompt,
          model,
          task,
          signal: sharedSignal,
          deadline: sharedDeadline,
          // Identical requests resolve identically, so the initiator's routing
          // IS the shared work's routing — there is no ambiguity here for a
          // second implementation to get wrong.
          routing,
          onResolve,
          ...(onAdmit === undefined ? {} : { onAdmit }),
        }),
    });
    return {
      structured: outcome.value.structured,
      coalesced: outcome.coalesced,
      ...(outcome.value.usage === undefined ? {} : { usage: outcome.value.usage }),
    };
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

    // 🔴 ONE logical start, captured BEFORE any work is done.
    //
    // `recordTextCall` derives `totalMs` as `performance.now() - start`. Reading
    // `start` AFTER an await made every structured call report its duration as
    // ~0 ms — envelope, summarization, agent micro-tasks, the untasked calls:
    // all of them measured as instantaneous, because the clock was read once
    // the clock had already finished running. #416 caught it because a 4 s
    // provider call was being logged as 0.
    //
    // It is taken here, ahead of controller linking, deadline construction,
    // routing resolution, admission, the local-first attempt, the coalesced
    // provider call and every fallback — because ALL of those are the call's
    // critical path. Success, local-first success, provider success and failure
    // all report against this one value; a second clock per outcome would let
    // one of them drift back to zero without anything noticing.
    const start = performance.now();

    const { controller: abortController, cleanup } = this._linkController(signal);
    this._incrementStreamCount();
    const deadline = createRequestDeadline({ deadlineAt, task, signal });

    const startedAt = new Date().toISOString();
    let resolution: AiModeResolution | undefined;
    let localAttempted = false;
    let fallback = false;
    // Set only when THIS call was actually admitted. A coalesced subscriber
    // never runs `_generateStructured`, so it records nothing here — which is
    // the honest answer: it did not itself measure a queue, and borrowing the
    // initiator's number would attribute someone else's wait to it.
    let admission: AdmissionObservation | undefined;
    const onAdmit = (observation: AdmissionObservation): void => {
      admission = observation;
    };
    // One span builder for both outcomes: the success and failure paths differ
    // only in the last few fields, and spelling the whole shape out twice is how
    // a field silently ends up recorded on one path and not the other.
    const span = (
      extra: Omit<TextCallObservation, 'startedAt' | 'promptChars'>,
    ): TextCallObservation => ({
      ...extra,
      startedAt,
      promptChars: prompt.length + (systemPrompt?.length ?? 0),
      deadline,
      task,
      ...(requestId === undefined ? {} : { requestId }),
      ...(parentRequestId === undefined ? {} : { parentRequestId }),
    });

    try {
      throwIfPastDeadline(deadline);

      // ── Resolve policy BEFORE spending anything ─────────────────────
      //
      // The local attempt is opportunistic, so it may only run when the
      // configured routing permits it: no explicit override, and a route that is
      // actually local. Resolving first is what makes an explicit model override
      // authoritative instead of advisory.
      const routing = this._resolveRouting({ model, task });
      resolution = routing;

      const localResult = await this._localFirst.tryStructured({
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
        recordTextCall(
          span({
            start,
            // A local answer names no provider, so the recorded route says so
            // rather than borrowing the routing that merely permitted it.
            resolution: { ...routing, mode: 'offline', provider: 'local-tasks', model: '' },
            streamed: false,
            completionChars: JSON.stringify(localResult).length,
            ok: true,
          }),
        );
        return localResult;
      }

      // The local window may have consumed the whole budget; re-check before
      // spending a provider call on an answer nobody is waiting for.
      throwIfPastDeadline(deadline);
      throwIfAlreadyAborted(abortController.signal);
      fallback = localAttempted;

      const result = await this._runCoalescedStructured({
        schema,
        schemaName,
        prompt,
        systemPrompt,
        model,
        task,
        signal: abortController.signal,
        deadline,
        routing,
        onResolve: (resolved) => {
          resolution = resolved;
        },
        onAdmit,
      });

      this.debug('extractStructure:done', { schemaName, coalesced: result.coalesced });
      recordTextCall(
        span({
          start,
          resolution,
          streamed: false,
          // A structured call can legitimately produce no object; that is a
          // recorded outcome, not a crash.
          completionChars:
            result.structured === undefined ? 0 : JSON.stringify(result.structured).length,
          ok: true,
          fallback,
          cacheLayer: result.coalesced ? 'in-flight-dedup' : 'none',
          // Queue wait is part of the critical path and is already inside
          // `totalMs`; recorded again so it is visible on its own.
          ...(admission === undefined
            ? {}
            : { queueMs: admission.queueMs, queueDepth: admission.queueDepth }),
          // A coalesced span was PAID FOR by another span. Counting its tokens
          // again would double the figure, which is the opposite of the point.
          ...(result.coalesced || result.usage === undefined ? {} : { usage: result.usage }),
        }),
      );
      return result.structured;
    } catch (error: unknown) {
      recordTextCall(
        span({
          start,
          resolution,
          streamed: false,
          completionChars: 0,
          ok: false,
          fallback,
          error,
          // A request cancelled or expired WHILE QUEUED is recorded with the
          // queue wait it actually incurred. Reporting nothing here would
          // erase the difference between "never got a provider call" and
          // "failed on the provider", which is the distinction this slice
          // exists to make measurable.
          ...(admission === undefined
            ? {}
            : { queueMs: admission.queueMs, queueDepth: admission.queueDepth }),
        }),
      );
      if (isRequestCancellation(error)) {
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
    // Admission FIRST: queued requests are rejected before the controllers are
    // aborted, so no queued work can be admitted by a window that happens to
    // fire between the two, and nothing is left holding a slot afterwards.
    this._admission.cancelAll();
    for (const controller of this._abortControllers) {
      controller.abort();
    }
    this._abortControllers.clear();
    resetActiveTextRequests();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  override async dispose(): Promise<void> {
    this.cancelAll();
    this._coalescer.cancelAll();
    this._admission.cancelAll();
    this._localFirst.clearAll();
    await super.dispose();
  }

  /**
   * Resolves the routing a gateway call WOULD use, without dispatching it.
   *
   * Reading it from the gateway rather than re-deriving it is the point: a
   * second implementation of task-role routing here would eventually disagree
   * with the dispatch path, and the disagreement would be invisible.
   */
  private _resolveRouting(options: {
    model?: string;
    task?: TextTask;
    endpoint?: string;
  }): AiModeResolution {
    try {
      return aiGatewayService.resolveText({
        ...(options.model === undefined ? {} : { model: options.model }),
        ...(options.task === undefined ? {} : { task: options.task }),
        ...(options.endpoint === undefined ? {} : { endpoint: options.endpoint }),
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
