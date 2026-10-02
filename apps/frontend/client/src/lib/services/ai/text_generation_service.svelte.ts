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
//      gateway path still needs. That absolute instant is then handed to the
//      gateway VERBATIM (`deadlineAt`), because a budget the transport cannot
//      see is a budget the transport re-invents — that is what kept a 120 s
//      dialogue turn on the adapter's 90 s watchdog.
//
//   3. ONE ROUTE PER REQUEST. Routing is resolved exactly once, and the
//      snapshot is what admission, the coalescing identity and dispatch all
//      use. Dispatch no longer re-resolves: a settings change between
//      admission and release used to send a request to a different endpoint,
//      under a different identity, into a different contention domain than the
//      three it had already been committed to. The snapshot travels to the
//      gateway as `route`, which dispatches it verbatim.
//
//   4. ONE BILL, COUNTED ONCE. Every gateway call installs an `onAttempt`
//      sink and carries a stable logical request id, so retries, structured
//      repairs and cancelled attempts are all recorded — once, on the span of
//      the request that actually paid for them. Coalesced subscribers record
//      no attempts and no usage, because their answer was paid for by
//      somebody else's span.
//
// Contract: C-080, C-111, C-320, issue #382 P0

import type { TextTask } from '@aikami/constants';
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
import { coalescedSpanFields, createStructuredCallCoalescer } from './structured_call_coalescer.ts';
import { createAttemptSink, type TextAttemptSink } from './text_attempt_projection.ts';
import {
  createServiceInferenceAdmission,
  type QueueExit,
  type ServiceInferenceAdmission,
  type TextAdmissionLease,
} from './text_request_admission.ts';
import {
  createRequestDeadline,
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
import {
  createStreamSpan,
  isSwallowedStreamFailure,
  type StreamObservation,
  type StreamSpan,
} from './text_stream_span.ts';
import {
  createStructuredTextDispatch,
  type StructuredTextDispatch,
} from './text_structured_dispatch.ts';
import {
  queueSpanFields,
  recordTextCall,
  type TextCallObservation,
} from './text_telemetry_recorder.ts';

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
    /**
     * Identity of this logical request, for diagnostics and accounting.
     *
     * Minted when omitted, because "one logical request" is a real quantity
     * that attempt accounting needs to be able to name: a request that was
     * retried, repaired or coalesced is still ONE request with ONE bill, and
     * an un-named request is indistinguishable from two.
     */
    requestId?: string;
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
    /**
     * The partition this result belongs to — campaign, account, save slot.
     * Coalescing never crosses it. Optional: a caller with no partition to name
     * coalesces only with other unscoped callers, so a caller that KNOWS its
     * campaign must pass it. Never inferred — see `text_effective_route.ts`.
     */
    scope?: string;
    /**
     * An opaque, non-secret connection-configuration revision, supplied by
     * whatever owns settings. Without one, the route fields the resolution
     * already carries are all there is — and those cannot see a credential
     * that changed while everything else stayed identical. Documented, not
     * guessed at.
     */
    /**
     * An opaque, non-secret connection-configuration revision.
     *
     * When omitted, the revision published by the gateway composition layer is
     * used — the same value every other caller would see, read live from the
     * configuration. It is never a credential and never a digest of one, so it
     * is safe in a coalescing key; see `text_route_revision.ts`.
     */
    configRevision?: string;
  }): Promise<unknown>;

  /** Aborts all active stream connections. */
  cancelAll(): void;
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------
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
  private readonly _coalescer = createStructuredCallCoalescer({
    debug: (label, detail) => this.debug(label, detail),
  });
  /**
   * The provider half of a structured request: identity, shared clock, admission
   * and dispatch. See `text_structured_dispatch.ts` for why those three belong
   * together and why the gate's position inside the coalescer is load-bearing.
   */
  /**
   * The provider dispatch and the span for a STREAMED call.
   *
   * See `text_stream_span.ts` for why the two travel together: every field the
   * span reports is something the dispatch observed on the way past.
   */
  private readonly _stream: StreamSpan = createStreamSpan({
    generate: (input) => aiGatewayService.generateText(input),
    exposeRouting: (resolution) => {
      this._exposeRouting(resolution);
    },
  });

  private readonly _dispatch: StructuredTextDispatch = createStructuredTextDispatch({
    coalescer: this._coalescer,
    admit: (input) => this._admission.acquire(input),
    generate: (input) => aiGatewayService.generateText(input),
    exposeRouting: (resolution) => {
      this._exposeRouting(resolution);
    },
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

  /**
   * Monotonic counter behind the minted logical-request ids.
   *
   * Only ever compared for equality, and only within one session — which is
   * exactly what a logical request id is for. Never persisted, never derived
   * from content, and never from a credential.
   */
  private _requestSequence = 0;

  /** The identity of one logical request, stable across every attempt it makes. */
  private _mintRequestId(supplied?: string): string {
    if (supplied !== undefined && supplied.length > 0) {
      return supplied;
    }
    this._requestSequence += 1;
    return `lg-${this._requestSequence}`;
  }

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
    onQueueExit?: (observation: QueueExit) => void;
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

  // ── streamChat ────────────────────────────────────────────────────────

  async streamChat(options: {
    messages: TextChatMessage[];
    onChunk: (text: string) => void;
    signal?: AbortSignal;
    model?: string;
    endpoint?: string;
    task?: TextTask;
    deadlineAt?: number;
    requestId?: string;
  }): Promise<void> {
    const { messages, onChunk, signal, model, endpoint, task, deadlineAt, requestId } = options;

    if (signal?.aborted) {
      return;
    }

    const { controller: abortController, cleanup } = this._linkController(signal);
    this._incrementStreamCount();
    const deadline = createRequestDeadline({ deadlineAt, task, signal });
    const logicalRequestId = this._mintRequestId(requestId);
    const attempts = createAttemptSink();

    const start = performance.now();
    const startedAt = new Date().toISOString();
    const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
    // Resolved BEFORE the call so the contention domain is known up front. An
    // interactive stream is never gated, but it must be VISIBLE to the gate —
    // this is the lane that keeps background summarization off the provider
    // while the player is reading.
    const routing = this._resolveRouting({ model, task, endpoint });
    let lease: TextAdmissionLease | undefined;
    // The whole observable state of this call, mutable, owned by the dispatch
    // and the span. Declared OUTSIDE the try so the failure path can read the
    // same values the success path does — a stream that failed after streaming
    // is the one whose first-content time most needs recording.
    const observation: StreamObservation = {
      start,
      startedAt,
      resolution: routing,
      task,
      ttftMs: undefined,
      promptChars,
      completionChars: 0,
      deadline,
      lease,
      requestId: logicalRequestId,
      attempts,
      dispatched: false,
    };

    try {
      if (deadline.expired()) {
        throw new DOMException('Request deadline exceeded', 'AbortError');
      }
      lease = await this._admit({
        routing,
        ...(task === undefined ? {} : { task }),
        signal: AbortSignal.any([abortController.signal, deadline.signal]),
      });
      observation.lease = lease;
      const usage = await this._stream.dispatch({
        request: {
          messages,
          onChunk,
          model,
          endpoint,
          task,
          route: routing,
          onFirstContent: () => {
            observation.ttftMs ??= Math.round(performance.now() - start);
          },
          onCharacters: (count) => {
            observation.completionChars += count;
          },
        },
        observation,
        signal: abortController.signal,
      });
      observation.dispatched = true;
      this.info('streamChat:complete');
      this._stream.recordSuccess(observation, usage);
    } catch (error: unknown) {
      this._stream.recordFailure(observation, error);
      if (isSwallowedStreamFailure(error, deadline)) {
        this.debug('streamChat:aborted');
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
    scope?: string;
    configRevision?: string;
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
      scope,
      configRevision: suppliedRevision,
    } = options;
    throwIfAlreadyAborted(signal);
    // Resolved ONCE, here, and read live. Every downstream consumer — admission,
    // the coalescing identity, dispatch — uses this exact value, so a settings
    // change mid-request cannot produce three different answers to "where does
    // this go". A caller that owns a stricter notion of configuration identity
    // (a vault epoch, a server-pushed revision) may supply one instead; the
    // default is the composition layer's, and neither is a secret.
    const configRevision = suppliedRevision ?? aiGatewayService.routeRevision();

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
    // Set when this call LEAVES the admission queue — admitted OR dropped. A
    // coalesced subscriber never runs `_generateStructured`, so it records
    // nothing here, which is the honest answer: it did not itself measure a
    // queue, and borrowing the initiator's number would attribute someone
    // else's wait to it.
    let admission: QueueExit | undefined;
    const onQueueExit = (observation: QueueExit): void => {
      admission = observation;
    };
    /**
     * Set the moment a provider attempt is dispatched.
     *
     * The difference between "this request failed" and "this request was never
     * sent" decides whether a span counts a bill. It is tracked from the
     * gateway call rather than inferred from the error, because the error of a
     * request that spent a real attempt looks exactly like the error of one
     * that never reached the provider.
     */
    let dispatched = false;
    // Owned here, not inside the coalescer, so the failure path below can read
    // the same list the success path does. An attempt that was dispatched and
    // then threw is the case an accounting boundary most often loses, and it is
    // precisely the one the provider billed.
    const attempts = createAttemptSink();
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
        ...(model === undefined ? {} : { explicitModel: model }),
        onAttempt: () => {
          localAttempted = true;
        },
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
            // Zero provider attempts, and not one attempt that happened to be
            // free. The two are different facts and a cost report needs the
            // second one to stay honest about hardware.
            dispatch: 'local',
          }),
        );
        return localResult;
      }

      // The local window may have consumed the whole budget; re-check before
      // spending a provider call on an answer nobody is waiting for.
      throwIfPastDeadline(deadline);
      throwIfAlreadyAborted(abortController.signal);
      fallback = localAttempted;

      const result = await this._dispatch.run({
        schema,
        schemaName,
        prompt,
        systemPrompt,
        model,
        task,
        signal: abortController.signal,
        deadline,
        routing,
        scope,
        configRevision,
        attempts,
        onResolve: (resolved) => {
          resolution = resolved;
          // The gateway resolved a route, which it only does on the way to an
          // adapter. From here the request is spent, whatever happens next.
          dispatched = true;
        },
        onQueueExit,
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
          ...coalescedSpanFields(result),
          ...queueSpanFields(admission),
        }),
      );
      return result.structured;
    } catch (error: unknown) {
      this._recordStructuredFailure({
        span,
        start,
        resolution,
        fallback,
        error,
        // No dispatch happened unless the gateway got as far as attempting
        // one. A request that died in routing, in the local attempt or in the
        // queue is SUPPRESSED work, and reporting it as a provider attempt
        // would invent a bill that nobody received.
        dispatched,
        // Recorded on the failure path too. The attempt that threw is the one
        // the provider billed, and a span that only carried attempts on
        // success would under-report every retry, every schema repair and
        // every cancellation — which is to say, all the interesting ones.
        attempts,
        // A request cancelled or expired WHILE QUEUED is recorded with the
        // queue wait it actually incurred. Reporting nothing here would erase
        // the difference between "never got a provider call" and "failed on
        // the provider", which is the distinction this slice exists to make
        // measurable.
        admission,
      });
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

  /**
   * Records a structured call that FAILED, and nothing else.
   *
   * Its own method so the two span shapes cannot drift: the success path and
   * the failure path differ in six fields, and spelling the whole thing out
   * twice is how a field ends up recorded on one and forgotten on the other —
   * which is exactly what happened to the attempt list before #382 consumed
   * `onAttempt` in production.
   */
  private _recordStructuredFailure(options: {
    span: (extra: Omit<TextCallObservation, 'startedAt' | 'promptChars'>) => TextCallObservation;
    start: number;
    resolution?: AiModeResolution;
    fallback: boolean;
    error: unknown;
    dispatched: boolean;
    attempts: TextAttemptSink;
    admission: QueueExit | undefined;
  }): void {
    const { span, start, resolution, fallback, error, dispatched, attempts, admission } = options;
    recordTextCall(
      span({
        start,
        resolution,
        streamed: false,
        completionChars: 0,
        ok: false,
        fallback,
        error,
        dispatch: dispatched ? 'provider' : 'suppressed',
        ...(attempts.attempts.length === 0 ? {} : { attempts: attempts.snapshot() }),
        ...queueSpanFields(admission),
      }),
    );
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
