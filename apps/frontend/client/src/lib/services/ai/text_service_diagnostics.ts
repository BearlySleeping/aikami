// apps/frontend/client/src/lib/services/ai/text_service_diagnostics.ts
//
// The text service's content-free `globalThis` diagnostics surface.
//
// These globals are read by the #382 measurement harness (`ai_baseline_bench.ts`)
// and by dev tooling, from OUTSIDE the service and outside any import graph it
// controls. That is why they live on `globalThis` at all — and it is why they
// are collected here instead of being scattered through the service: a global
// has no type, no owner and no discoverability, so every inline assignment is
// one more invisible way for a producer and a consumer to disagree.
//
// Three surfaces, deliberately kept SEPARATE:
//
//   - the resolved routing of the last dispatched call;
//   - how many logical requests the service is managing;
//   - how many requests are actually running per contention domain.
//
// The third is NOT the second. A request WAITING for admission is not
// provider-in-flight, and folding it into the stream count would let a queued
// request look like running work — hiding precisely the effect admission
// introduces.
//
// Everything published here is metadata: counts, provider ids and endpoints.
// No prompt text, no completion text, no credentials, ever.
//
// Contract: issue #382

/** Publishes the routing the gateway resolved for the last dispatched call. */
export const publishResolvedTextRouting = (resolution: {
  provider: string;
  model?: string;
  endpoint?: string;
}): void => {
  (globalThis as Record<string, unknown>).__text_service_resolved_routing = {
    provider: resolution.provider,
    model: resolution.model ?? '',
    endpoint: resolution.endpoint ?? '',
  };
};

/** Increments the count of logical requests the service is managing. */
export const incrementActiveTextRequests = (): void => {
  const key = '__text_service_active_stream_count';
  const globals = globalThis as Record<string, unknown>;
  globals[key] = ((globals[key] as number | undefined) ?? 0) + 1;
};

/**
 * Decrements the count of logical requests the service is managing.
 *
 * Floored at zero: a decrement below zero would be a torn-down counter that a
 * later reader would report as a negative count of active work.
 */
export const decrementActiveTextRequests = (): void => {
  const key = '__text_service_active_stream_count';
  const globals = globalThis as Record<string, unknown>;
  globals[key] = Math.max(0, ((globals[key] as number | undefined) ?? 0) - 1);
};

/** Resets the count after `cancelAll`, when nothing is being managed. */
export const resetActiveTextRequests = (): void => {
  (globalThis as Record<string, unknown>).__text_service_active_stream_count = 0;
};
