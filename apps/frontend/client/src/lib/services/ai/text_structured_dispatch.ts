// apps/frontend/client/src/lib/services/ai/text_structured_dispatch.ts
//
// ONE structured request, through the coalescer, onto ONE provider call, on the
// caller's route and the caller's clock. (issue #382)
//
// WHY THIS IS SEPARATE FROM THE SERVICE
//
// The service owns the caller's LIFETIME (deadline, cancellation, telemetry
// span) and the local-first detour. Everything between "the request exists" and
// "the shared provider attempt has been dispatched" is this module, and it is
// three decisions that have to be made together or not at all:
//
//   1. IDENTITY — what makes two structured calls the same request. The route
//      the caller already resolved, the caller's campaign scope, and the
//      configuration revision it was resolved under.
//   2. SHARED CLOCK — the shared attempt inherits the INITIATOR's absolute
//      deadline, including time already spent on the local attempt. Deriving a
//      fresh one from the task would hand the shared call a whole new budget,
//      so the wall-clock cost of a request would grow with every subscriber.
//      The SIGNAL stays per-caller: inheriting it would let one subscriber's
//      cancellation kill the work everyone else is waiting for.
//   3. WHERE ADMISSION GOES — inside the coalescer, immediately before the
//      provider call, and nowhere else.
//
// That last one is the least obvious and the most fragile. Two identical
// concurrent subscribers become ONE shared attempt, which must then queue ONCE.
// A gate outside the coalescer would serialize the two subscribers and turn
// "one provider call" back into "call A completes, then call B" — silently
// disabling #411's deduplication for the exact simultaneous case it exists to
// handle. A gate inside the coalescer but outside the provider call would let N
// subscribers each hold a slot for the same work.
//
// The local-first attempt is deliberately NOT gated: it is a different resource
// (a distinct provider id, hence a distinct contention domain) and it is free
// and near-instant, so queueing it would delay a player for nothing.

import type { TextTask } from '@aikami/constants';
import type { AiModeResolution } from '@aikami/types';
import type { TextChatMessage } from '$types';
import type { AiRequestDeadline } from './ai_request_deadline.ts';
import type {
  CoalescedStructuredResult,
  StructuredCallCoalescer,
} from './structured_call_coalescer.ts';
import type { TextAttemptSink } from './text_attempt_projection.ts';
import { buildCoalescingIdentity } from './text_effective_route.ts';
import type { QueueExit, TextAdmissionLease } from './text_request_admission.ts';
import { createRequestDeadline } from './text_request_lifetime.ts';

/** The provider call this module is allowed to make. Injected by the service. */
export type StructuredGatewayCall = (input: {
  messages: TextChatMessage[];
  schema: Record<string, unknown>;
  schemaName: string;
  model: string | undefined;
  task: TextTask | undefined;
  signal: AbortSignal;
  /** The caller's absolute end-to-end instant, forwarded unchanged. */
  deadlineAt: number | undefined;
  /** The route this request was admitted and coalesced under. */
  route: AiModeResolution;
  routeRevision: string | undefined;
  /** One identity for the whole attempt, so a retry is not a second request. */
  requestId: string;
  onAttempt: (event: Parameters<TextAttemptSink['record']>[0]) => void;
  onResolve: (resolution: AiModeResolution) => void;
}) => Promise<{
  structured?: unknown;
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
}>;

/** What the dispatch needs from its host. */
export type StructuredDispatchHost = {
  coalescer: StructuredCallCoalescer;
  admit: (input: {
    routing: AiModeResolution;
    task?: TextTask;
    signal: AbortSignal;
    onQueueExit?: (observation: QueueExit) => void;
  }) => Promise<TextAdmissionLease>;
  generate: StructuredGatewayCall;
  /** Publishes a resolved route to the diagnostics surface. */
  exposeRouting: (resolution: AiModeResolution) => void;
};

/** One structured call, as the caller describes it. */
export type StructuredDispatchRequest = {
  schema: Record<string, unknown>;
  schemaName: string;
  prompt: string;
  systemPrompt?: string;
  model?: string;
  task?: TextTask;
  signal: AbortSignal;
  deadline: AiRequestDeadline;
  routing: AiModeResolution;
  scope: string | undefined;
  configRevision?: string;
  /**
   * Where the shared attempt's provider attempts are collected.
   *
   * OWNED BY THE CALLER, and that ownership is the accounting argument. The
   * sink is filled only by whichever caller actually dispatched, so the
   * initiator can read it on BOTH the success and the failure path — and a
   * subscriber, whose inner call never runs, sees an empty list rather than
   * somebody else's events.
   */
  attempts: TextAttemptSink;
  onResolve: (resolution: AiModeResolution) => void;
  onQueueExit?: (observation: QueueExit) => void;
};

/** Runs one structured request through coalescing, admission and dispatch. */
export type StructuredTextDispatch = {
  run(request: StructuredDispatchRequest): Promise<CoalescedStructuredResult>;
};

/** Flattens a system+user prompt into the adapter's message shape. */
const toMessages = (systemPrompt: string | undefined, prompt: string): TextChatMessage[] => {
  const messages: TextChatMessage[] = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });
  return messages;
};

/**
 * The failure a request that ran out of budget throws.
 *
 * An `AbortError`, not a provider error: nobody is waiting any more, and a
 * caller that cannot tell "the user cancelled" from "the budget ran out" will
 * report one as the other.
 */
const deadlinePast = (): Error => new DOMException('Request deadline exceeded', 'AbortError');

/**
 * The provider half of one shared attempt: admit, then dispatch on the route
 * the request was already committed to.
 */
const dispatchSharedAttempt = async (
  host: StructuredDispatchHost,
  request: StructuredDispatchRequest,
  shared: { signal: AbortSignal; deadline: AiRequestDeadline; requestId: string },
): Promise<{
  structured?: unknown;
  usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
}> => {
  const { schema, schemaName, prompt, systemPrompt, model, task, routing, configRevision } =
    request;
  const { signal, deadline, requestId } = shared;
  const linked = AbortSignal.any([signal, deadline.signal]);
  if (deadline.expired()) {
    throw deadlinePast();
  }
  const lease = await host.admit({
    routing,
    ...(task === undefined ? {} : { task }),
    signal: linked,
    ...(request.onQueueExit === undefined ? {} : { onQueueExit: request.onQueueExit }),
  });
  try {
    // The quiet window may have spent the budget; re-check before paying for
    // an answer nobody can still receive.
    if (deadline.expired()) {
      throw deadlinePast();
    }
    return await host.generate({
      messages: toMessages(systemPrompt, prompt),
      schema,
      schemaName,
      model,
      task,
      // ONE clock: the call cannot outlive the budget the caller handed down.
      // The ABSOLUTE instant travels with it, so the adapter adopts the
      // caller's budget rather than installing its own 90 s safety timer over
      // the top of a 120 s dialogue turn.
      deadlineAt: Number.isFinite(deadline.deadlineAt) ? deadline.deadlineAt : undefined,
      // 🔴 THE ROUTE THAT WAS ADMITTED, not one resolved again here. `model`,
      // the endpoint and `task` are all ignored by the gateway when a snapshot
      // is supplied — which is the point: a settings change between admission
      // and this line can no longer move the call to a different connection
      // than the one the contention domain and the coalescing identity were
      // computed from.
      route: routing,
      routeRevision: configRevision,
      // Every DISPATCHED attempt, including retries, schema-invalid responses
      // and cancelled work. The provider billed each of them.
      onAttempt: request.attempts.record,
      requestId,
      signal: linked,
      onResolve: (resolved) => {
        request.onResolve(resolved);
        host.exposeRouting(resolved);
      },
    });
  } finally {
    lease.release();
  }
};

/**
 * Creates the dispatch.
 *
 * The local attempt stays OUTSIDE this, in the service: a local answer is free
 * and near-instant, so paying for it twice costs nothing, and keeping it
 * per-caller preserves each caller's own deadline. The provider call is the
 * expensive half, so that is the half worth sharing.
 */
export const createStructuredTextDispatch = (
  host: StructuredDispatchHost,
): StructuredTextDispatch => ({
  async run(request: StructuredDispatchRequest): Promise<CoalescedStructuredResult> {
    const { schema, schemaName, prompt, systemPrompt, model, task, signal, routing } = request;
    // 🔴 The shared work inherits the initiator's ABSOLUTE deadline, including
    // time already spent on the local attempt.
    const inheritedDeadlineAt = Number.isFinite(request.deadline.deadlineAt)
      ? request.deadline.deadlineAt
      : undefined;
    const outcome = await host.coalescer.run<{
      structured?: unknown;
      usage?: { inputTokens: number; outputTokens: number; cachedTokens?: number };
    }>({
      identity: buildCoalescingIdentity({
        task,
        schemaName,
        schema,
        systemPrompt,
        prompt,
        model,
        routing,
        scope: request.scope,
        configRevision: request.configRevision,
      }),
      signal,
      sharedDeadline: () => createRequestDeadline({ deadlineAt: inheritedDeadlineAt, task }),
      // The shared work runs the INITIATOR's route, unconditionally. That is
      // the mechanism, not a safe assumption about identical requests — which
      // is why the initiator's resolved route is captured in the identity
      // above: a caller whose settings resolved elsewhere never becomes the
      // initiator of this attempt.
      call: (sharedSignal, sharedDeadline, sharedRequestId) =>
        dispatchSharedAttempt(host, request, {
          signal: sharedSignal,
          deadline: sharedDeadline,
          requestId: sharedRequestId,
        }),
    });
    return {
      structured: outcome.value.structured,
      coalesced: outcome.coalesced,
      requestId: outcome.requestId,
      // Absent for a subscriber: those events belong to the initiator's span.
      ...(outcome.coalesced ? {} : { attempts: request.attempts.snapshot() }),
      ...(outcome.value.usage === undefined ? {} : { usage: outcome.value.usage }),
    };
  },
});
