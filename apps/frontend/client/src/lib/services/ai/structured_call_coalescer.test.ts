// apps/frontend/client/src/lib/services/ai/structured_call_coalescer.test.ts
//
// The layer between a caller's request and the reference-counted deduplicator
// (issue #382 P1).
//
// What is tested here is the part the deduplicator deliberately does NOT own:
// request identity, the shared work's deadline, and error identity. Those three
// are where a coalescing layer quietly breaks a caller.

import { describe, expect, mock, test } from 'bun:test';
import { createUnboundedAiDeadline } from './ai_request_deadline.ts';
import {
  createStructuredCallCoalescer,
  type StructuredCallIdentity,
} from './structured_call_coalescer.ts';

const identity = (overrides: Partial<StructuredCallIdentity> = {}): StructuredCallIdentity => ({
  task: 'agent-relationship',
  schemaName: 'RelationshipOutput',
  schema: { type: 'object', properties: { change: { type: 'string' } } },
  systemPrompt: 'You are a relationship analyst.',
  prompt: 'How did this interaction go?',
  model: undefined,
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

describe('createStructuredCallCoalescer', () => {
  test('identical concurrent calls share one provider call', async () => {
    const coalescer = createStructuredCallCoalescer();
    const gate = deferred<string>();
    const call = mock(async () => gate.promise);

    const first = coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call,
    });
    const second = coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call,
    });

    expect(call).toHaveBeenCalledTimes(1);
    expect(coalescer.coalescedCount).toBe(1);

    gate.resolve('answer');
    const [a, b] = await Promise.all([first, second]);
    expect(a.value).toBe('answer');
    expect(b.value).toBe('answer');
    expect(a.coalesced).toBe(false);
    expect(b.coalesced).toBe(true);
    expect(coalescer.inFlightCount).toBe(0);
  });

  test('the same prompt under a different schema is NOT coalesced', async () => {
    const coalescer = createStructuredCallCoalescer();
    const gate = deferred<string>();
    const call = mock(async () => gate.promise);

    const first = coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call,
    });
    const second = coalescer.run({
      identity: identity({ schemaName: 'OtherOutput' }),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call,
    });

    // Merging these would serve one request's answer to the other.
    expect(call).toHaveBeenCalledTimes(2);
    expect(coalescer.inFlightCount).toBe(2);

    gate.resolve('answer');
    await Promise.all([first, second]);
  });

  test('schema field order does not split one request into two', async () => {
    const coalescer = createStructuredCallCoalescer();
    const gate = deferred<string>();
    const call = mock(async () => gate.promise);

    const ordered = coalescer.run({
      identity: identity({
        schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } },
      }),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call,
    });
    const reordered = coalescer.run({
      identity: identity({
        schema: { properties: { b: { type: 'number' }, a: { type: 'string' } }, type: 'object' },
      }),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call,
    });

    // Key order is not semantic in JSON Schema, so these are the same question.
    expect(call).toHaveBeenCalledTimes(1);

    gate.resolve('answer');
    expect((await ordered).value).toBe('answer');
    expect((await reordered).value).toBe('answer');
  });

  test("the shared work's deadline is derived ONCE per attempt", async () => {
    const coalescer = createStructuredCallCoalescer();
    const gate = deferred<string>();
    const sharedDeadline = mock(() => createUnboundedAiDeadline());

    const first = coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline,
      call: async () => gate.promise,
    });
    const second = coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline,
      call: async () => gate.promise,
    });

    // 🔴 Twice would mean two clocks, and the second subscriber's clock could
    // outlive the shared attempt — or be cancelled out from under it.
    expect(sharedDeadline).toHaveBeenCalledTimes(1);

    gate.resolve('answer');
    await Promise.all([first, second]);
  });

  test('the shared deadline is disposed when the attempt settles', async () => {
    const coalescer = createStructuredCallCoalescer();
    const disposed: number[] = [];
    const gate = deferred<string>();
    const deadline = createUnboundedAiDeadline();
    const dispose = deadline.dispose.bind(deadline);
    deadline.dispose = () => {
      disposed.push(1);
      dispose();
    };

    const pending = coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline: () => deadline,
      call: async () => gate.promise,
    });

    expect(disposed).toHaveLength(0);
    gate.resolve('answer');
    await pending;
    // Leaking a timer per coalesced call would accumulate for the session.
    expect(disposed).toHaveLength(1);
  });

  test("a caller's own abort rejects only that caller", async () => {
    const coalescer = createStructuredCallCoalescer();
    const gate = deferred<string>();
    let sharedAborted = false;

    const quitter = new AbortController();
    const cancelled = coalescer.run({
      identity: identity(),
      signal: quitter.signal,
      sharedDeadline: createUnboundedAiDeadline,
      call: async (signal) => {
        signal.addEventListener('abort', () => {
          sharedAborted = true;
        });
        return gate.promise;
      },
    });
    const survivor = coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call: async () => gate.promise,
    });

    quitter.abort();
    await expect(cancelled).rejects.toThrow();
    // Somebody was still waiting, so the shared call is untouched.
    expect(sharedAborted).toBe(false);

    gate.resolve('answer');
    expect((await survivor).value).toBe('answer');
  });

  test("a cancelled call rejects with the caller's OWN reason", async () => {
    const coalescer = createStructuredCallCoalescer();
    const quitter = new AbortController();
    const reason = new Error('user navigated away');

    const pending = coalescer.run({
      identity: identity(),
      signal: quitter.signal,
      sharedDeadline: createUnboundedAiDeadline,
      call: () => new Promise<string>(() => {}),
    });

    quitter.abort(reason);

    // A synthesised `AbortError` would drop the reason the caller aborted with.
    await expect(pending).rejects.toBe(reason);
  });

  test("the attempt's own error reaches every subscriber", async () => {
    const coalescer = createStructuredCallCoalescer();
    const gate = deferred<string>();
    const failure = new Error('provider_unreachable');

    const first = coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call: async () => gate.promise,
    });
    const second = coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call: async () => gate.promise,
    });

    gate.reject(failure);
    // Both are observed together: asserting them one after the other would let
    // the second reject unobserved in between.
    const [a, b] = await Promise.allSettled([first, second]);
    // A substituted error would destroy the timeout-vs-refusal distinction every
    // consumer here acts on.
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
    expect(a.status === 'rejected' ? a.reason : undefined).toBe(failure);
    expect(b.status === 'rejected' ? b.reason : undefined).toBe(failure);
  });

  test('a settled request is not replayed — this coalesces, it does not cache', async () => {
    const coalescer = createStructuredCallCoalescer();
    const call = mock(async () => 'answer');

    await coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call,
    });
    await coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call,
    });

    // Reusing a settled answer across calls is a separate decision with separate
    // correctness requirements (state fingerprint, pack version, campaign scope).
    expect(call).toHaveBeenCalledTimes(2);
  });

  test('cancelAll resolves waiting callers rather than stranding them', async () => {
    const coalescer = createStructuredCallCoalescer();
    const pending = coalescer.run({
      identity: identity(),
      signal: new AbortController().signal,
      sharedDeadline: createUnboundedAiDeadline,
      call: () => new Promise<string>(() => {}),
    });

    coalescer.cancelAll();

    expect(coalescer.inFlightCount).toBe(0);
    await expect(pending).rejects.toThrow();
  });
});
