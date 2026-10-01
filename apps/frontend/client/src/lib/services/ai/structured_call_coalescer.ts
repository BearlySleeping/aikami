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

import {
  canonicalSchemaFingerprint,
  UncanonicalizableSchemaError,
} from '@aikami/frontend/ai-gateway';
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
 * The identity of one coalescable structured call.
 *
 * Everything that changes WHAT is asked, WHERE it is asked, or WHO the answer
 * belongs to has to be in here. Anything missing is a field two genuinely
 * different requests can agree on, and agreeing on it means one of them is
 * served the other's answer.
 */
export type StructuredCallIdentity = {
  task: string | undefined;
  schemaName: string;
  schema: Record<string, unknown>;
  systemPrompt: string;
  prompt: string;
  model: string | undefined;
  /**
   * The effective route this call WILL take, captured once at admission.
   *
   * Prompt/schema identity alone is not enough. Two callers with byte-identical
   * prompts resolve to different providers, endpoints, models and generation
   * settings when the connection configuration differs between them, and the
   * shared attempt inherits the INITIATOR's route — so without this field a
   * settings change lets a request join an attempt aimed at the old route and
   * receive its answer.
   *
   * Content-free by construction: an origin, provider id, model and setting
   * values. Never a key, token or any secret. A caller that cannot name a route
   * must pass a value that differs from every other caller's, or bypass sharing.
   */
  effectiveRoute: string;
  /**
   * The partition this call's result belongs to — campaign, account, save slot.
   *
   * Prevents a result computed for one player's world from being handed to
   * another. `'unscoped'` is a real, shared value: callers that have no
   * partition to name coalesce only with other unscoped callers, which is the
   * pre-existing behaviour. A caller that KNOWS its partition must supply it;
   * it is not inferred, because guessing a campaign inside a pure package would
   * mean importing a campaign global.
   */
  scope: string;
};

/**
 * Canonical content identity for a schema, or `undefined` when it has none.
 *
 * The previous implementation was `JSON.stringify(schema, Object.keys(schema))`.
 * A replacer ARRAY is applied at every depth, and the array held only the
 * ROOT's top-level keys, so the entire schema body was discarded: any two object
 * schemas with the same top-level key set produced the same string, and callers
 * sharing a `schemaName` over different shapes were merged onto one provider
 * call. Reproduced with a differing nested enum, a differing nested `maxLength`
 * and an extra nested property — all three compared EQUAL, every one of them
 * canonicalising to `{"properties":{},"type":"object"}`.
 *
 * A schema with no canonical form (cyclic, or carrying a function/symbol/
 * bigint/non-finite number) is NOT given a shared fallback. It is reported as
 * unshareable so the caller can run it standalone: a shared placeholder would
 * make every unrepresentable request look identical, which is the one outcome
 * this key exists to prevent.
 */
const schemaFingerprint = (schema: Record<string, unknown>): string | undefined => {
  try {
    return canonicalSchemaFingerprint(schema);
  } catch (error: unknown) {
    if (error instanceof UncanonicalizableSchemaError) {
      return undefined;
    }
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Coalescer
// ---------------------------------------------------------------------------

/** Provider-reported token counts, or a character-count estimate standing in. */
export type StructuredCallUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
};

/**
 * What one coalesced structured call produced, in the shape the text service
 * consumes.
 *
 * Named here rather than declared inside the service because it IS the shared
 * attempt's payload: the value, whether this caller was the initiator, and the
 * accounting the initiator observed. A subscriber that was not the initiator
 * reports no usage of its own — its answer was paid for by another span, and
 * counting it again would double the figure.
 */
export type CoalescedStructuredResult = {
  structured?: unknown;
  coalesced: boolean;
  usage?: StructuredCallUsage;
};

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
  /**
   * Calls that ran WITHOUT sharing because their schema has no canonical
   * content identity.
   *
   * A correctness-preserving bypass, not a failure: these calls are correct,
   * they just cannot prove they are duplicates.
   */
  readonly unshareableCount: number;
};

/** Creates the coalescer. */
export const createStructuredCallCoalescer = (options?: {
  debug?: (label: string, detail: Record<string, unknown>) => void;
}): StructuredCallCoalescer => {
  const deduplicator: StructuredRequestDeduplicator = createStructuredRequestDeduplicator({
    ...(options?.debug === undefined ? {} : { debug: options.debug }),
  });
  let unshareable = 0;

  return {
    get inFlightCount(): number {
      return deduplicator.inFlightCount;
    },

    get coalescedCount(): number {
      return deduplicator.coalescedCount;
    },

    get unshareableCount(): number {
      return unshareable;
    },

    async run<T>(input: {
      identity: StructuredCallIdentity;
      signal: AbortSignal;
      sharedDeadline: () => AiRequestDeadline;
      call: (signal: AbortSignal, deadline: AiRequestDeadline) => Promise<T>;
    }): Promise<StructuredCallOutcome<T>> {
      const { identity, signal, sharedDeadline, call } = input;
      const fingerprint = schemaFingerprint(identity.schema);

      // No content identity ⇒ no proof of sameness ⇒ do not share. Running the
      // call alone costs one provider call; sharing without proof costs a
      // WRONG answer, which is not a trade this layer is allowed to make.
      if (fingerprint === undefined) {
        unshareable += 1;
        options?.debug?.('coalesce:unshareable-schema', { schemaName: identity.schemaName });
        const deadline = sharedDeadline();
        try {
          return { value: await call(signal, deadline), coalesced: false };
        } finally {
          deadline.dispose();
        }
      }

      const key: StructuredRequestKey = {
        task: identity.task,
        schemaName: identity.schemaName,
        schemaFingerprint: fingerprint,
        systemPrompt: identity.systemPrompt,
        prompt: identity.prompt,
        model: identity.model,
        effectiveRoute: identity.effectiveRoute,
        scope: identity.scope,
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
