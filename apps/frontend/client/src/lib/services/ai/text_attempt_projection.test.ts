// apps/frontend/client/src/lib/services/ai/text_attempt_projection.test.ts
//
// The projection from transport attempt events to the telemetry shape
// (issue #382 P0).
//
// The load-bearing property is NEGATIVE: an absent fact must stay absent. Every
// field on the projection is optional, and the temptation at exactly this layer
// is to default one to zero — a cached-token count of 0 instead of
// `cachedSource: 'unknown'`, a total duration of 0 instead of "still in
// flight". A zero is a MEASUREMENT. Reporting it where nobody measured is how
// "the provider reused no cache" becomes a claim the provider never made, and
// how a truncated generation becomes a cheap one.

import { describe, expect, test } from 'bun:test';
import type { AiTransportAttemptEvent } from '@aikami/frontend/ai-gateway';
import { createAttemptSink } from './text_attempt_projection.ts';

const event = (overrides: Partial<AiTransportAttemptEvent> = {}): AiTransportAttemptEvent => ({
  attemptId: 'req#1',
  requestId: 'req',
  provider: 'ollama',
  model: 'ornith-1.5:9b',
  mode: 'offline',
  kind: 'structured',
  transport: 'buffered-json',
  startedAt: 1_000,
  ...overrides,
});

/**
 * One projected event, through the sink.
 *
 * The projection itself is not exported: a helper used only by its own test is
 * not used, and every property asserted below is observable on what the sink
 * collects — which is the only thing the telemetry ever sees.
 */
const project = (overrides: Partial<AiTransportAttemptEvent> = {}) => {
  const sink = createAttemptSink();
  sink.record(event(overrides));
  const collected = sink.attempts[0];
  if (collected === undefined) {
    throw new Error('expected the sink to collect one attempt');
  }
  return collected;
};

describe('toAttemptObservation', () => {
  test('drops identity — the span already knows which request it belongs to', () => {
    const projected = project(event({ attemptId: 'req#7', requestId: 'req' }));
    // Two places to disagree about identity is two places to be wrong. The
    // transport owns it; the buffer does not restate it.
    expect(projected).not.toHaveProperty('attemptId');
    expect(projected).not.toHaveProperty('requestId');
  });

  test('carries every observed fact', () => {
    const projected = project(
      event({
        outcome: 'completed',
        firstContentMs: 120,
        totalMs: 900,
        doneReason: 'stop',
        truncated: false,
        usage: {
          inputTokens: 120,
          outputTokens: 30,
          cachedTokens: 64,
          cachedSource: 'provider',
          source: 'provider',
        },
      }),
    );
    expect(projected).toEqual({
      kind: 'structured',
      transport: 'buffered-json',
      outcome: 'completed',
      firstContentMs: 120,
      totalMs: 900,
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        cachedTokens: 64,
        cachedSource: 'provider',
      },
      doneReason: 'stop',
      truncated: false,
    });
  });

  test('an IN-FLIGHT attempt has no outcome, no usage and no duration', () => {
    const projected = project(event());
    // The provider has been billed for this one already. It simply has not
    // finished, and "has not finished" is not zero.
    expect(projected.outcome).toBeUndefined();
    expect(projected.usage).toBeUndefined();
    expect(projected.totalMs).toBeUndefined();
    expect(projected.firstContentMs).toBeUndefined();
  });

  test("a runtime with no cache counter stays 'unknown', never 0", () => {
    const projected = project(
      event({
        usage: { inputTokens: 10, outputTokens: 5, cachedSource: 'unknown', source: 'provider' },
      }),
    );
    expect(projected.usage?.cachedTokens).toBeUndefined();
    expect(projected.usage?.cachedSource).toBe('unknown');
  });

  test('a MEASURED zero cache hit is preserved as a zero', () => {
    const projected = project(
      event({
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cachedTokens: 0,
          cachedSource: 'provider',
          source: 'provider',
        },
      }),
    );
    // The distinction the whole type exists for: a provider that said "zero" and
    // a provider that said nothing are different facts and must not collapse.
    expect(projected.usage?.cachedTokens).toBe(0);
    expect(projected.usage?.cachedSource).toBe('provider');
  });

  test('a PARTIAL usage keeps its partial flag', () => {
    const projected = project(
      event({
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          source: 'provider',
          partial: true,
        },
      }),
    );
    expect(projected.usage?.partial).toBe(true);
  });

  test('a buffered shape with no content time does not gain one', () => {
    const projected = project(event({ transport: 'buffered-json' }));
    // There was no first content to measure. Inventing a zero here is what
    // would let a buffered completion be published as a time-to-first-token.
    expect(projected.firstContentMs).toBeUndefined();
    expect(projected.transport).toBe('buffered-json');
  });
});

describe('createAttemptSink', () => {
  test('collects every attempt, in dispatch order, including the discarded ones', () => {
    const sink = createAttemptSink();
    sink.record(event({ attemptId: 'req#1', outcome: 'invalid' }));
    sink.record(event({ attemptId: 'req#2', outcome: 'empty' }));
    sink.record(event({ attemptId: 'req#3', outcome: 'completed' }));
    expect(sink.attempts.map((entry) => entry.outcome)).toEqual(['invalid', 'empty', 'completed']);
    // A caller that records only the survivor reports one bill where the
    // provider issued three. The discarded two are the reason this sink exists.
    expect(sink.snapshot()).toHaveLength(3);
  });

  test('an untouched sink is empty, and stays empty', () => {
    const sink = createAttemptSink();
    expect(sink.attempts).toEqual([]);
    // A coalesced SUBSCRIBER owns a sink nothing ever wrote to. That empty list
    // is the honest answer: this caller dispatched nothing, and the attempt it
    // rode on belongs to somebody else's span.
    expect(sink.snapshot()).toEqual([]);
  });

  test('snapshot is a copy — later attempts cannot rewrite a recorded span', () => {
    const sink = createAttemptSink();
    sink.record(event({ outcome: 'completed' }));
    const snapshot = sink.snapshot();
    sink.record(event({ outcome: 'error' }));
    expect(snapshot).toHaveLength(1);
    expect(sink.attempts).toHaveLength(2);
  });
});
