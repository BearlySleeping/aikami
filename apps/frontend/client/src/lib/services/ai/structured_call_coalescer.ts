// apps/frontend/client/src/lib/services/ai/structured_call_coalescer.ts
//
// Runs ONE structured call through the configured route, merging identical
// requests that are in flight at the same time (issue #382 P1).
//
// This is the layer between a caller's request and the reference-counted
// deduplicator. It owns three things the deduplicator deliberately does not:
//
//   - REQUEST IDENTITY, including the schema fingerprint. The same prompt under
//     a different schema is a different question, and merging them would serve
//     one request's answer to the other.
//   - THE SHARED WORK'S DEADLINE. Derived from the task alone, never from an
//     initiating subscriber. Reusing one subscriber's deadline would let that
//     subscriber leaving cancel the work everybody else is waiting for —
//     reintroducing, inside the deduplicator's own caller, the exact failure the
//     reference counting exists to prevent.
//   - ERROR IDENTITY. Every subscriber receives the attempt's ORIGINAL error, so
//     a caller can still tell a timeout from a cancellation from a provider
//     refusal. All three take different paths in every consumer here.
//
// Contract: issue #382 P1 "In-flight deduplication"

import type { AiRequestDeadline } from './ai_request_deadline.ts';
import {
  createStructuredRequestDeduplicator,
  type StructuredRequestDeduplicator,
  type StructuredRequestKey,
} from './structured_request_deduplicator.ts';

// ---------------------------------------------------------------------------
// Schema identity
// ---------------------------------------------------------------------------

/**
 * A short, stable identity for a schema, for coalescing only.
 *
 * Two structured requests are the same request only if their schemas match, and
 * schemas are objects — so identity has to be derived from content. Key order is
 * normalised because it is not semantic in JSON Schema: two callers describing
 * the same schema with the fields in a different order ARE issuing the same
 * request and must coalesce.
 *
 * A schema that cannot be serialised is given a unique fingerprint rather than a
 * shared one. An empty or constant fallback would make every unserialisable
 * request look identical, which is the one outcome this key exists to prevent.
 */
const fingerprintSchema = (schema: Record<string, unknown>): string => {
  try {
    return JSON.stringify(schema, Object.keys(schema).sort());
  } catch {
    return `unserializable:${Math.random()}`;
  }
};

/** The identity of one coalescable structured call. */
export type StructuredCallIdentity = {
  task: string | undefined;
  schemaName: string;
  schema: Record<string, unknown>;
  systemPrompt: string;
  prompt: string;
  model: string | undefined;
};

// ---------------------------------------------------------------------------
// Coalescer
// ---------------------------------------------------------------------------

/** What a coalesced call produced. */
export type StructuredCallOutcome<T> = {
  /** The coalesced call's own value, in its own type. */
  value: T;
  /** Whether this caller joined an already-running attempt. */
  coalesced: boolean;
};

/** Runs structured calls, merging identical concurrent ones. */
export type StructuredCallCoalescer = {
  /**
   * Runs `call` unless an identical request is already in flight.
   *
   * `sharedDeadline` is invoked ONCE per attempt — not once per caller — so the
   * shared work has one clock that outlives any individual subscriber.
   */
  run<T>(options: {
    identity: StructuredCallIdentity;
    /** The CALLER's signal: cancelling it cancels only this caller. */
    signal: AbortSignal;
    sharedDeadline: () => AiRequestDeadline;
    call: (signal: AbortSignal, deadline: AiRequestDeadline) => Promise<T>;
  }): Promise<StructuredCallOutcome<T>>;
  /** Attempts currently in flight. */
  readonly inFlightCount: number;
  /** Callers served by an already-running attempt. */
  readonly coalescedCount: number;
  /** Aborts every attempt and resolves every waiter. */
  cancelAll(): void;
};

/** Creates the coalescer. */
export const createStructuredCallCoalescer = (options?: {
  debug?: (label: string, detail: Record<string, unknown>) => void;
}): StructuredCallCoalescer => {
  const deduplicator: StructuredRequestDeduplicator = createStructuredRequestDeduplicator({
    ...(options?.debug === undefined ? {} : { debug: options.debug }),
  });

  return {
    get inFlightCount(): number {
      return deduplicator.inFlightCount;
    },

    get coalescedCount(): number {
      return deduplicator.coalescedCount;
    },

    async run<T>(input: {
      identity: StructuredCallIdentity;
      signal: AbortSignal;
      sharedDeadline: () => AiRequestDeadline;
      call: (signal: AbortSignal, deadline: AiRequestDeadline) => Promise<T>;
    }): Promise<StructuredCallOutcome<T>> {
      const { identity, signal, sharedDeadline, call } = input;
      const key: StructuredRequestKey = {
        task: identity.task,
        schemaName: identity.schemaName,
        schemaFingerprint: fingerprintSchema(identity.schema),
        systemPrompt: identity.systemPrompt,
        prompt: identity.prompt,
        model: identity.model,
      };

      const outcome = await deduplicator.run({
        key,
        signal,
        run: async (sharedSignal) => {
          const deadline = sharedDeadline();
          try {
            return await call(sharedSignal, deadline);
          } finally {
            // Disposed when the ATTEMPT settles, not when any one caller returns.
            deadline.dispose();
          }
        },
      });

      if (outcome.cancelled) {
        // This caller left on its own terms. Reject rather than resolve: a
        // cancelled call must not look like an empty-but-valid extraction.
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw outcome.cancelledReason ?? error;
      }
      if (outcome.failed || outcome.value === undefined) {
        // Rethrow the attempt's OWN error so the caller's error handling — and
        // its ability to distinguish timeout from refusal — survives.
        throw outcome.error ?? new Error('Coalesced structured request produced no result');
      }
      return { value: outcome.value, coalesced: outcome.coalesced };
    },

    cancelAll(): void {
      deduplicator.cancelAll();
    },
  };
};
