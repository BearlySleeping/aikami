// apps/frontend/client/src/lib/services/ai/text_attempt_projection.ts
//
// Projects the gateway's per-attempt events onto the content-free shape the
// telemetry buffer holds.
//
// WHY A PROJECTION AND NOT A PASS-THROUGH
//
// `AiTransportAttemptEvent` and `TextAttemptObservation` deliberately describe
// different audiences. The transport event carries IDENTITY — `attemptId` and
// `requestId` — because inside the gateway those are what make "one provider
// bill, N subscribers" expressible. The telemetry shape deliberately drops
// them: a span already knows which logical request it belongs to, and a buffer
// that re-stated the identity would have two places to disagree about it.
//
// Dropping the identity here is also what keeps the accounting HONEST rather
// than merely correct. Every field below is optional, and an absent field means
// the runtime did not report that fact. Nothing is defaulted to zero: a zero
// cached-token count is a measurement, an absent one is an absence, and only the
// first may be summed into a saving.
//
// WHAT IS DELIBERATELY NOT HERE
//
//   - No cost. A cost needs a price table and a model id the runtime actually
//     reported; inventing either is how a dollar figure becomes a fiction.
//   - No cache "saving". `cachedTokens` is carried as the provider's own count
//     with its provenance, and nothing more.
//   - No deduplication. A repeated event for one attempt is not a second bill;
//     the gateway's per-request ordinal is what makes the ids unique, and a
//     duplicate would be a transport bug this layer should surface rather than
//     hide.
//
// Contract: issue #382 P0 ("accounting must separate logical requests from
// provider attempts"), reviewed against #418.

import type { AiTransportAttemptEvent } from '@aikami/frontend/ai-gateway';
import type { TextAttemptObservation } from '@aikami/types';

/**
 * One transport event, as the telemetry buffer holds it.
 *
 * Pure and total: it cannot fail, cannot reach the clock and cannot drop an
 * event. A partial attempt is still an attempt the provider billed, so the only
 * question this function answers is which fields were actually observed.
 */
const toAttemptObservation = (event: AiTransportAttemptEvent): TextAttemptObservation => ({
  kind: event.kind,
  transport: event.transport,
  ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
  ...(event.firstContentMs === undefined ? {} : { firstContentMs: event.firstContentMs }),
  ...(event.totalMs === undefined ? {} : { totalMs: event.totalMs }),
  ...(event.usage === undefined
    ? {}
    : {
        usage: {
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          ...(event.usage.cachedTokens === undefined
            ? {}
            : { cachedTokens: event.usage.cachedTokens }),
          // `'unknown'` is a real, recorded value: the runtime did not supply
          // the counter. Preserved verbatim so a provider that reports no cache
          // information is distinguishable from one that measured zero reuse.
          ...(event.usage.cachedSource === undefined
            ? {}
            : { cachedSource: event.usage.cachedSource }),
          ...(event.usage.partial === undefined ? {} : { partial: event.usage.partial }),
        },
      }),
  ...(event.doneReason === undefined ? {} : { doneReason: event.doneReason }),
  ...(event.truncated === undefined ? {} : { truncated: event.truncated }),
});

/**
 * Collects attempt events into the array a span carries.
 *
 * A sink rather than a bare callback so the CALLER owns the array and decides
 * who may read it. That decision is the whole accounting argument: the
 * initiator of a coalesced attempt keeps the events, and every subscriber gets
 * an empty list, because they shared one bill rather than one each.
 */
export const createAttemptSink = (): {
  /** Pass this to the gateway as `onAttempt`. */
  readonly record: (event: AiTransportAttemptEvent) => void;
  /** The events so far, in dispatch order. */
  readonly attempts: readonly TextAttemptObservation[];
  /** A stable copy, for handing to the recorder after the call settles. */
  snapshot(): readonly TextAttemptObservation[];
} => {
  const collected: TextAttemptObservation[] = [];
  return {
    record: (event) => {
      collected.push(toAttemptObservation(event));
    },
    get attempts(): readonly TextAttemptObservation[] {
      return collected;
    },
    snapshot: () => [...collected],
  };
};

/** The shape `createAttemptSink` returns, for parameter typing. */
export type TextAttemptSink = ReturnType<typeof createAttemptSink>;
