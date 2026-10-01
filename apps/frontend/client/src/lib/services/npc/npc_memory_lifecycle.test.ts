// apps/frontend/client/src/lib/services/npc/npc_memory_lifecycle.test.ts
//
// Generation-scoped background work for NPC memory (issue #382).
//
// EVERY TIMING ASSERTION HERE IS VIRTUAL CLOCK. No real sleeps, no
// `setTimeout(…, 91_000)`. The defects this module exists to fix are all about
// what happens across MINUTES of queued delay — a conversation that is
// superseded while its digest waits behind another, an opener that was
// generated against a world state that has since changed — and none of them
// can be observed by waiting for them.

import { describe, expect, mock, test } from 'bun:test';
import type { PublishedNpcMemoryDiagnostics } from './npc_memory_diagnostics.ts';
import { publishNpcMemoryBackgroundDiagnostics } from './npc_memory_diagnostics.ts';

/** Reads the published snapshot the way the measurement harness would. */
const readPublished = (): PublishedNpcMemoryDiagnostics | undefined =>
  (globalThis as Record<string, unknown>).__npc_memory_background_diagnostics as
    | PublishedNpcMemoryDiagnostics
    | undefined;

import {
  createNpcMemoryLifecycle,
  type NpcBackgroundContext,
  type NpcBackgroundOutcome,
} from './npc_memory_lifecycle.ts';

/** A clock the test moves by hand. */
const virtualClock = (start = 1_000_000): { now: () => number; advance: (ms: number) => void } => {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
};

/** A call the test settles when it chooses to. */
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

/** Yields to the microtask queue so queued units can reach their gates. */
const settle = (): Promise<void> => Promise.resolve().then(() => undefined);

describe('NpcMemoryLifecycle — obsolete work', () => {
  test('work queued under a retired generation makes ZERO provider calls', async () => {
    const lifecycle = createNpcMemoryLifecycle();
    // The blocker occupies the per-NPC chain so the unit under test is still
    // QUEUED — not running — when the generation is retired.
    const blocker = deferred<void>();
    const run = mock(async (_context: NpcBackgroundContext) => 'applied' as const);

    const first = lifecycle.enqueue({
      npcId: 'ivo',
      kind: 'digest',
      run: async () => {
        await blocker.promise;
        return 'applied';
      },
    });
    const queued = lifecycle.enqueue({ npcId: 'ivo', kind: 'digest', run });

    await settle();
    // 91 seconds of queued delay: the conversation is long superseded by now.
    lifecycle.invalidate();
    blocker.resolve();
    await Promise.all([first, queued]);

    expect(run).not.toHaveBeenCalled();
    expect(lifecycle.snapshot().supersededBeforeDispatch).toBe(1);
    expect(lifecycle.snapshot().applied).toBe(1);
  });

  test('a running unit cannot apply after its generation is retired', async () => {
    const lifecycle = createNpcMemoryLifecycle();
    const gate = deferred<NpcBackgroundOutcome>();
    let applied = false;

    const pending = lifecycle.enqueue({
      npcId: 'mira',
      kind: 'digest',
      run: async (context) => {
        await gate.promise;
        // The apply-time check: a unit that already paid for its call must
        // still be refused when the state it targeted is gone.
        applied = !context.isStale();
        return 'applied';
      },
    });

    await settle();
    lifecycle.invalidate();
    gate.resolve('applied');
    await pending;

    expect(applied).toBe(false);
    expect(lifecycle.snapshot().applied).toBe(1);
  });

  test('a running unit is signalled so its provider call can be aborted', async () => {
    const lifecycle = createNpcMemoryLifecycle();
    let observed: AbortSignal | undefined;

    const pending = lifecycle.enqueue({
      npcId: 'ivo',
      kind: 'digest',
      run: async (context) => {
        observed = context.signal;
        await new Promise((resolve) => context.signal.addEventListener('abort', resolve));
        return 'cancelled';
      },
    });

    await settle();
    expect(observed?.aborted).toBe(false);
    lifecycle.invalidate();
    await pending;

    expect(observed?.aborted).toBe(true);
    expect(lifecycle.snapshot().cancelled).toBe(1);
  });

  test('an old unit’s cleanup cannot remove a NEWER unit’s bookkeeping', async () => {
    const lifecycle = createNpcMemoryLifecycle();
    const slow = deferred<void>();
    const seen: number[] = [];

    const first = lifecycle.enqueue({
      npcId: 'ivo',
      kind: 'digest',
      run: async () => {
        await slow.promise;
        seen.push(lifecycle.snapshot().pending);
        return 'applied';
      },
    });
    // Queued behind `first` on the same NPC, so its cleanup runs after.
    const second = lifecycle.enqueue({
      npcId: 'ivo',
      kind: 'digest',
      run: async () => 'applied',
    });

    await settle();
    slow.resolve();
    await Promise.all([first, second]);

    // `first` observed 2 pending units, i.e. `second` was still tracked when
    // `first` finished. A cleanup keyed by NPC id alone would have dropped
    // `second` from the map and left it untracked / un-drainable.
    expect(seen).toEqual([2]);
    expect(lifecycle.snapshot().pending).toBe(0);
    await lifecycle.drain();
  });

  test('dispose drains and leaves nothing pending', async () => {
    const lifecycle = createNpcMemoryLifecycle();
    lifecycle.invalidate();
    void lifecycle.enqueue({ npcId: 'ivo', kind: 'digest', run: async () => 'applied' });
    void lifecycle.enqueue({ npcId: 'mira', kind: 'refresh', run: async () => 'applied' });
    await lifecycle.drain();
    expect(lifecycle.snapshot().pending).toBe(0);
  });
});

describe('NpcMemoryLifecycle — bounds and outcomes', () => {
  test('pending REFRESH work is bounded globally and overload is explicit', async () => {
    const lifecycle = createNpcMemoryLifecycle({ maxPendingRefreshes: 2 });
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const run = mock(async (context: { index: number }) => {
      await gates[context.index].promise;
      return 'applied' as const;
    });

    const units = [0, 1, 2].map((index) =>
      lifecycle.enqueue({
        npcId: `npc_${index}`,
        kind: 'refresh',
        run: () => run({ index }),
      }),
    );
    await settle();

    // Three NPCs, room for two: the third is DROPPED with an explicit outcome
    // rather than queued behind an unbounded backlog. An opener is
    // replaceable, so a dropped refresh costs a greeting, never a fact.
    expect(lifecycle.snapshot().overloaded).toBe(1);
    expect(lifecycle.snapshot().pending).toBe(2);
    for (const gate of gates) {
      gate.resolve();
    }
    await Promise.all(units);
    expect(lifecycle.snapshot().pending).toBe(0);
  });

  test('a DIGEST is never dropped for being late', async () => {
    const lifecycle = createNpcMemoryLifecycle({ maxPendingRefreshes: 1 });
    const gate = deferred<void>();
    // Saturate the refresh budget...
    const refresh = lifecycle.enqueue({
      npcId: 'npc_a',
      kind: 'refresh',
      run: async () => {
        await gate.promise;
        return 'applied';
      },
    });
    // ...and a digest must still be accepted and dispatched. It carries
    // durable notes and promises; dropping it would lose player content.
    const digest = lifecycle.enqueue({ npcId: 'ivo', kind: 'digest', run: async () => 'applied' });
    await settle();
    gate.resolve();
    await Promise.all([refresh, digest]);

    expect(lifecycle.snapshot().overloaded).toBe(0);
    expect(lifecycle.snapshot().applied).toBe(2);
  });

  test('every terminal state is reported distinctly — discarded is not success', async () => {
    const onEvent = mock((_event: unknown) => {});
    const lifecycle = createNpcMemoryLifecycle({ onEvent });
    const outcomes = await Promise.all([
      lifecycle.enqueue({ npcId: 'a', kind: 'digest', run: async () => 'applied' }),
      lifecycle.enqueue({ npcId: 'b', kind: 'digest', run: async () => 'failed' }),
      lifecycle.enqueue({
        npcId: 'c',
        kind: 'digest',
        run: async () => 'invalidated-after-completion',
      }),
      lifecycle.enqueue({
        npcId: 'd',
        kind: 'digest',
        run: async () => 'superseded-before-dispatch',
      }),
    ]);
    expect(outcomes).toHaveLength(4);

    const snapshot = lifecycle.snapshot();
    expect(snapshot.applied).toBe(1);
    expect(snapshot.failed).toBe(1);
    expect(snapshot.invalidatedAfterCompletion).toBe(1);
    expect(snapshot.supersededBeforeDispatch).toBe(1);
    // A run that never happened must not be counted as a request.
    expect(snapshot.requested).toBe(4);
    expect(onEvent).toHaveBeenCalled();
  });

  test('a throwing unit is contained and counted, and the chain continues', async () => {
    const onError = mock((_detail: unknown) => {});
    const lifecycle = createNpcMemoryLifecycle({ onError });
    await Promise.all([
      lifecycle.enqueue({
        npcId: 'ivo',
        kind: 'digest',
        run: async () => {
          throw new Error('provider_unreachable');
        },
      }),
      lifecycle.enqueue({ npcId: 'ivo', kind: 'digest', run: async () => 'applied' }),
    ]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(lifecycle.snapshot().failed).toBe(1);
    // The chain did not break: the follower still ran.
    expect(lifecycle.snapshot().applied).toBe(1);
  });
});

describe('NpcMemoryLifecycle — virtual-time ageing', () => {
  test('pending high-water mark and oldest pending age are measured on the injected clock', async () => {
    const clock = virtualClock();
    const lifecycle = createNpcMemoryLifecycle({ now: clock.now });
    const gate = deferred<void>();

    const running = lifecycle.enqueue({
      npcId: 'ivo',
      kind: 'digest',
      run: async () => {
        await gate.promise;
        return 'applied';
      },
    });
    const queued = lifecycle.enqueue({
      npcId: 'mira',
      kind: 'refresh',
      run: async () => 'applied',
    });
    await settle();

    expect(lifecycle.snapshot().pendingHighWaterMark).toBe(2);

    // 91 seconds of virtual time, no real waiting.
    clock.advance(91_000);
    expect(lifecycle.snapshot().oldestPendingAgeMs).toBe(91_000);

    gate.resolve();
    await Promise.all([running, queued]);
    expect(lifecycle.snapshot().oldestPendingAgeMs).toBe(0);
  });

  test('an event carries the age of its unit, not of the newest one', async () => {
    const clock = virtualClock();
    const events: { npcId: string; ageMs: number }[] = [];
    const lifecycle = createNpcMemoryLifecycle({
      now: clock.now,
      onEvent: (event) => {
        if (event.outcome === 'applied') {
          events.push({ npcId: event.npcId, ageMs: event.ageMs });
        }
      },
    });

    const gate = deferred<void>();
    const first = lifecycle.enqueue({
      npcId: 'ivo',
      kind: 'digest',
      run: async () => {
        await gate.promise;
        return 'applied';
      },
    });
    clock.advance(30_000);
    const second = lifecycle.enqueue({
      npcId: 'ivo',
      kind: 'digest',
      run: async () => 'applied',
    });
    await settle();
    clock.advance(61_000);
    gate.resolve();
    await Promise.all([first, second]);

    // FIFO on one NPC: `first` waited for both advances, `second` for the
    // second one only.
    expect(events).toEqual([
      { npcId: 'ivo', ageMs: 91_000 },
      { npcId: 'ivo', ageMs: 61_000 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Diagnostics surface
//
// The published snapshot is what makes "obsolete queued work made ZERO provider
// calls" falsifiable from outside the service. A discard folded into `applied`
// would make that claim untestable, so each terminal state is its own field.
// ---------------------------------------------------------------------------

describe('NpcMemoryDiagnostics — publication', () => {
  test('every transition publishes a snapshot with that outcome as its own field', async () => {
    const lifecycle = createNpcMemoryLifecycle();
    publishNpcMemoryBackgroundDiagnostics(lifecycle.snapshot());
    const blocker = deferred<void>();
    const running = lifecycle.enqueue({
      npcId: 'ivo',
      kind: 'digest',
      run: async () => {
        await blocker.promise;
        return 'applied';
      },
    });
    const queued = lifecycle.enqueue({ npcId: 'ivo', kind: 'digest', run: async () => 'failed' });
    await settle();
    publishNpcMemoryBackgroundDiagnostics(lifecycle.snapshot());
    const inFlight = readPublished();
    expect(inFlight?.pending).toBe(2);

    blocker.resolve();
    await Promise.all([running, queued]);
    publishNpcMemoryBackgroundDiagnostics(lifecycle.snapshot());

    const final = readPublished();
    expect(final?.applied).toBe(1);
    expect(final?.failed).toBe(1);
    expect(final?.pending).toBe(0);
    // The snapshot is content-free: no NPC id, no prompt, no conversation text.
    expect(Object.keys(final ?? {}).sort()).toEqual([
      'applied',
      'cancelled',
      'failed',
      'generation',
      'invalidatedAfterCompletion',
      'oldestPendingAgeMs',
      'overloaded',
      'pending',
      'pendingHighWaterMark',
      'requested',
      'supersededBeforeDispatch',
    ]);
  });
});
