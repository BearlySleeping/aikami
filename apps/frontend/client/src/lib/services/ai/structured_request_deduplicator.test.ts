// apps/frontend/client/src/lib/services/ai/structured_request_deduplicator.test.ts
//
// In-flight coalescing (issue #382 P1 "In-flight deduplication").
//
// The property under test is the one that made naive deduplication unsafe to
// ship: cancelling one consumer must never cancel work another consumer is
// still waiting for. Everything else follows from that.

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { StructuredRequestKey } from './structured_request_deduplicator.ts';
import { createStructuredRequestDeduplicator } from './structured_request_deduplicator.ts';

const key = (overrides: Partial<StructuredRequestKey> = {}): StructuredRequestKey => ({
  task: 'agent-relationship',
  schemaName: 'RelationshipOutput',
  schemaFingerprint: 'sha:abc',
  systemPrompt: 'You are a relationship analyst.',
  prompt: 'How did this interaction go?',
  model: undefined,
  // The shared attempt runs the INITIATOR's route and lives inside the
  // INITIATOR's partition, so both are part of the key. See the route/scope
  // block in `structured_call_coalescer.test.ts` for the behavioural gates.
  effectiveRoute: 'cap=text|mode=byok|provider=test|origin=in-process|rev=1',
  scope: 'campaign_a',
  ...overrides,
});

/** A promise plus the handles a test needs to settle it on demand. */
const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} => {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('request identity', () => {
  test('distinguishes requests whose fields differ only at a boundary', async () => {
    // Plain concatenation would make these two identical, and one request's
    // prompt would be answered with another request's schema. Observed through
    // the public surface: two subscribers either share an attempt or do not.
    const run = mock(async () => 'answer');
    const deduplicator = createStructuredRequestDeduplicator();
    const held = deferred<string>();
    const holdRun = mock(() => held.promise);

    const left = deduplicator.run({
      key: key({ schemaName: 'ab', schemaFingerprint: 'c' }),
      run: holdRun,
    });
    const right = deduplicator.run({
      key: key({ schemaName: 'a', schemaFingerprint: 'bc' }),
      run: holdRun,
    });

    // Two distinct attempts — the boundary was not forgeable.
    expect(deduplicator.inFlightCount).toBe(2);
    expect(holdRun).toHaveBeenCalledTimes(2);

    held.resolve('answer');
    expect((await left).value).toBe('answer');
    expect((await right).value).toBe('answer');
    expect(run).not.toHaveBeenCalled();
  });

  test('a missing task and an empty task are the same request', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const held = deferred<string>();
    const run = mock(() => held.promise);

    const first = deduplicator.run({ key: key({ task: undefined }), run });
    const second = deduplicator.run({ key: key({ task: '' }), run });

    // Same request, so one attempt and one call.
    expect(deduplicator.inFlightCount).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);

    held.resolve('answer');
    expect((await first).value).toBe('answer');
    expect((await second).value).toBe('answer');
  });

  test('a different schema fingerprint is a different request', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const held = deferred<string>();
    const run = mock(() => held.promise);

    const first = deduplicator.run({ key: key({ schemaFingerprint: 'sha:abc' }), run });
    const second = deduplicator.run({ key: key({ schemaFingerprint: 'sha:def' }), run });

    // The same prompt under a different schema is a different question, and
    // merging them would serve one request's answer to the other.
    expect(deduplicator.inFlightCount).toBe(2);

    held.resolve('answer');
    await Promise.all([first, second]);
  });
});

describe('createStructuredRequestDeduplicator', () => {
  /** Aborts observed on the ATTEMPT's signal, across a single test. */
  let attemptAborts: number[] = [];

  beforeEach(() => {
    attemptAborts = [];
  });

  test('two identical concurrent requests run ONE provider call', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const gate = deferred<{ ok: boolean }>();
    const run = mock(() => gate.promise);

    const first = deduplicator.run({ key: key(), run });
    const second = deduplicator.run({ key: key(), run });

    // Both are attached to the same attempt before it settles.
    expect(deduplicator.inFlightCount).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);

    gate.resolve({ ok: true });
    const [a, b] = await Promise.all([first, second]);

    expect(a.value).toEqual({ ok: true });
    expect(b.value).toEqual({ ok: true });
    expect(b.coalesced).toBe(true);
    expect(a.coalesced).toBe(false);
    expect(b.subscriberCount).toBe(2);
    expect(deduplicator.coalescedCount).toBe(1);
    expect(deduplicator.inFlightCount).toBe(0);
  });

  test('a different prompt is a different request and is not coalesced', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const run = mock(async () => ({ ok: true }));

    await deduplicator.run({ key: key({ prompt: 'first' }), run });
    await deduplicator.run({ key: key({ prompt: 'second' }), run });

    expect(run).toHaveBeenCalledTimes(2);
    expect(deduplicator.coalescedCount).toBe(0);
  });

  test('a settled request is not replayed — this coalesces, it does not cache', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const run = mock(async () => ({ ok: true }));

    await deduplicator.run({ key: key(), run });
    await deduplicator.run({ key: key(), run });

    // Persisting the answer across calls is a separate decision with separate
    // correctness requirements; this must not smuggle it in.
    expect(run).toHaveBeenCalledTimes(2);
    expect(deduplicator.inFlightCount).toBe(0);
  });

  test('cancelling ONE consumer leaves the other consumer served', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const gate = deferred<{ ok: boolean }>();
    // The attempt's signal is what the provider call observes, so this is the
    // real wiring, not a stand-in for it.
    const run = mock((signal: AbortSignal) => {
      signal.addEventListener('abort', () => attemptAborts.push(1));
      return gate.promise;
    });

    const quitter = new AbortController();
    const cancelled = deduplicator.run({ key: key(), signal: quitter.signal, run });
    const survivor = deduplicator.run({ key: key(), run });

    quitter.abort();
    const cancelledResult = await cancelled;

    expect(cancelledResult.cancelled).toBe(true);
    // The shared call must NOT have been aborted: somebody still wants it.
    expect(attemptAborts).toHaveLength(0);

    gate.resolve({ ok: true });
    const survivorResult = await survivor;
    expect(survivorResult.value).toEqual({ ok: true });
    expect(survivorResult.cancelled).toBe(false);
  });

  test('a consumer is never served after it has already settled', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const gate = deferred<{ ok: boolean }>();
    const run = () => gate.promise;

    const quitter = new AbortController();
    const pending = deduplicator.run({ key: key(), signal: quitter.signal, run });

    // Resolve the attempt, THEN cancel: a late abort must not overwrite the
    // answer this consumer already received.
    gate.resolve({ ok: true });
    const settled = await pending;
    expect(settled.value).toEqual({ ok: true });

    quitter.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The abort happened after the value was delivered and changed nothing.
    expect(deduplicator.inFlightCount).toBe(0);
  });

  test('a settled attempt is not aborted by its last consumer leaving', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const gate = deferred<{ ok: boolean }>();
    const run = mock((signal: AbortSignal) => {
      signal.addEventListener('abort', () => attemptAborts.push(1));
      return gate.promise;
    });

    const pending = deduplicator.run({ key: key(), run });
    gate.resolve({ ok: true });
    expect((await pending).value).toEqual({ ok: true });

    // The call already produced its answer. Aborting its signal afterwards
    // would misreport a COMPLETED call as cancelled to anything still holding
    // the signal — including a downstream teardown that reports on it.
    expect(attemptAborts).toHaveLength(0);
  });

  test('cancelling the LAST consumer aborts the shared call', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const gate = deferred<{ ok: boolean }>();
    const run = mock((signal: AbortSignal) => {
      signal.addEventListener('abort', () => attemptAborts.push(1));
      return gate.promise;
    });

    const controller = new AbortController();
    const pending = deduplicator.run({ key: key(), signal: controller.signal, run });
    expect(deduplicator.inFlightCount).toBe(1);

    controller.abort();
    const result = await pending;

    expect(result.cancelled).toBe(true);
    // Nobody can consume the answer, so the provider call is not left running.
    expect(attemptAborts).toHaveLength(1);
    expect(deduplicator.inFlightCount).toBe(0);
  });

  test('a pre-cancelled consumer never starts work', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const run = mock(async () => ({ ok: true }));
    const controller = new AbortController();
    controller.abort();

    const result = await deduplicator.run({ key: key(), signal: controller.signal, run });

    expect(result.cancelled).toBe(true);
    expect(run).not.toHaveBeenCalled();
    expect(deduplicator.inFlightCount).toBe(0);
  });

  test('a failed attempt fails every consumer, and is not left in flight', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const gate = deferred<{ ok: boolean }>();
    const run = mock(() => gate.promise);

    const first = deduplicator.run({ key: key(), run });
    const second = deduplicator.run({ key: key(), run });

    gate.reject(new Error('provider_unreachable'));
    const [a, b] = await Promise.all([first, second]);

    expect(a.failed).toBe(true);
    expect(b.failed).toBe(true);
    expect(a.value).toBeUndefined();
    // A failure must not be remembered as a success for the next caller.
    expect(deduplicator.inFlightCount).toBe(0);
  });

  test('a later identical request after a failure starts fresh', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const failing = mock(async () => {
      throw new Error('boom');
    });

    const first = await deduplicator.run({ key: key(), run: failing });
    expect(first.failed).toBe(true);

    const succeeding = mock(async () => ({ ok: true }));
    const second = await deduplicator.run({ key: key(), run: succeeding });

    expect(succeeding).toHaveBeenCalledTimes(1);
    expect(second.value).toEqual({ ok: true });
  });

  test('cancelAll aborts every attempt and empties the map', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const run = mock((signal: AbortSignal) => {
      signal.addEventListener('abort', () => attemptAborts.push(1));
      // Never settles on its own: only the abort ends it.
      return new Promise<{ ok: boolean }>(() => {});
    });

    const a = deduplicator.run({ key: key({ prompt: 'a' }), run });
    const b = deduplicator.run({ key: key({ prompt: 'b' }), run });
    expect(deduplicator.inFlightCount).toBe(2);

    deduplicator.cancelAll();

    // One abort per distinct attempt — the shared calls are torn down, not the
    // subscribers.
    expect(attemptAborts).toHaveLength(2);
    expect(deduplicator.inFlightCount).toBe(0);
    // The consumers resolve rather than hanging on an attempt nobody owns.
    const results = await Promise.all([a, b]);
    for (const result of results) {
      expect(result.cancelled).toBe(true);
    }
  });

  test('reset clears counters without disturbing live attempts', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const gate = deferred<{ ok: boolean }>();
    const run = () => gate.promise;

    const first = deduplicator.run({ key: key(), run });
    const second = deduplicator.run({ key: key(), run });
    expect(deduplicator.coalescedCount).toBe(1);

    deduplicator.reset();
    expect(deduplicator.coalescedCount).toBe(0);
    expect(deduplicator.inFlightCount).toBe(1);

    gate.resolve({ ok: true });
    const [a, b] = await Promise.all([first, second]);
    expect(a.value).toEqual({ ok: true });
    expect(b.value).toEqual({ ok: true });
  });

  test('many simultaneous identical requests still make exactly one call', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const gate = deferred<string>();
    const run = mock(() => gate.promise);

    const all = Array.from({ length: 12 }, () => deduplicator.run({ key: key(), run }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(deduplicator.coalescedCount).toBe(11);

    gate.resolve('answer');
    const results = await Promise.all(all);
    for (const result of results) {
      expect(result.value).toBe('answer');
    }
    expect(deduplicator.inFlightCount).toBe(0);
  });

  test('a distinct request issued while one is in flight still runs', async () => {
    const deduplicator = createStructuredRequestDeduplicator();
    const gate = deferred<string>();
    const other = deferred<string>();
    const run = mock((prompt: string) => (prompt === 'held' ? gate.promise : other.promise));

    const held = deduplicator.run({ key: key({ prompt: 'held' }), run: () => run('held') });
    const distinct = deduplicator.run({
      key: key({ prompt: 'distinct' }),
      run: () => run('distinct'),
    });

    expect(deduplicator.inFlightCount).toBe(2);
    other.resolve('other');
    expect((await distinct).value).toBe('other');

    gate.resolve('held');
    expect((await held).value).toBe('held');
    expect(deduplicator.inFlightCount).toBe(0);
  });
});
