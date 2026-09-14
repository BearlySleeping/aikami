// apps/frontend/client/src/lib/services/game/combat_ai_lifecycle.test.ts
//
// C-526 lifecycle repair: the shared request-lifecycle primitives.
//
//   - ONE time budget, so a retry cannot restart the soft window;
//   - a soft timeout never clears the only abort path while the provider call
//     is still running;
//   - cancelling one batch member releases only that member, and the shared
//     transport is aborted when the LAST member releases;
//   - terminal results are cached in a bounded LRU, not an unbounded map;
//   - encounter-run identity distinguishes a retry of the same authored id.
//
// Contract: C-526 AC-3, AC-5, AC-11 (lifecycle repair)

import { describe, expect, it } from 'bun:test';
import {
  attemptWindowMs,
  createBoundedResultCache,
  createEncounterRunTracker,
  createProviderTransport,
  createTimeBudget,
  raceSoftDeadline,
} from './combat_ai_lifecycle';

const settle = async (ms = 5): Promise<void> => {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

describe('createTimeBudget / attemptWindowMs', () => {
  it('caps every attempt window by what is left of the group budget', () => {
    const budget = createTimeBudget({ startedAt: 1000, hardDeadlineMs: 4000 });
    expect(budget.deadlineAt).toBe(5000);
    expect(attemptWindowMs({ softDeadlineMs: 1500, budget, now: 1000 })).toBe(1500);
    // Late in the budget the soft window shrinks rather than restarting.
    expect(attemptWindowMs({ softDeadlineMs: 1500, budget, now: 4000 })).toBe(1000);
    expect(attemptWindowMs({ softDeadlineMs: 1500, budget, now: 5000 })).toBe(0);
    expect(budget.expired(4999)).toBe(false);
    expect(budget.expired(5000)).toBe(true);
    expect(budget.remainingMs(9000)).toBe(0);
  });
});

describe('createProviderTransport', () => {
  it('aborts the shared call only when the LAST member releases', () => {
    const transport = createProviderTransport({ id: 't1' });
    transport.retain('a');
    transport.retain('b');
    expect(transport.release('a')).toBe(false);
    expect(transport.aborted).toBe(false);
    expect(transport.memberIds()).toEqual(['b']);
    expect(transport.release('b')).toBe(true);
    expect(transport.aborted).toBe(true);
  });

  it('arms a hard-abort deadline that clears on settle', async () => {
    const transport = createProviderTransport({ id: 't2' });
    let fired = 0;
    transport.armHardAbort(5, () => {
      fired += 1;
    });
    transport.settle();
    await settle(20);
    expect(fired).toBe(0);
    expect(transport.aborted).toBe(false);
  });

  it('aborts when the armed hard deadline fires', async () => {
    const transport = createProviderTransport({ id: 't3' });
    let fired = 0;
    transport.armHardAbort(5, () => {
      fired += 1;
    });
    await settle(20);
    expect(fired).toBe(1);
    expect(transport.aborted).toBe(true);
  });
});

describe('raceSoftDeadline', () => {
  it('returns the value when the provider answers in time', async () => {
    const transport = createProviderTransport({ id: 't4' });
    const outcome = await raceSoftDeadline({
      transport,
      softDeadlineMs: 100,
      call: async () => 42,
    });
    expect(outcome).toEqual({ kind: 'value', value: 42 });
  });

  it('reports a soft timeout while leaving the caller in control of cleanup', async () => {
    const transport = createProviderTransport({ id: 't5' });
    const outcome = await raceSoftDeadline({
      transport,
      softDeadlineMs: 5,
      call: () => new Promise(() => {}),
    });
    expect(outcome.kind).toBe('soft_timeout');
    // The call itself is still outstanding until the caller aborts it.
    expect(transport.aborted).toBe(false);
    transport.abort();
    expect(transport.aborted).toBe(true);
  });

  it('classifies a provider rejection as retryable, and an abort as terminal', async () => {
    const rejecting = createProviderTransport({ id: 't6' });
    expect(
      (
        await raceSoftDeadline({
          transport: rejecting,
          softDeadlineMs: 50,
          call: async () => {
            throw new Error('nope');
          },
        })
      ).kind,
    ).toBe('rejected');

    const aborting = createProviderTransport({ id: 't7' });
    const pending = raceSoftDeadline({
      transport: aborting,
      softDeadlineMs: 1000,
      call: () => new Promise(() => {}),
    });
    aborting.abort();
    expect((await pending).kind).toBe('aborted');
  });

  it('does not start a call against an already-aborted transport', async () => {
    const transport = createProviderTransport({ id: 't8' });
    transport.abort();
    let started = false;
    const outcome = await raceSoftDeadline({
      transport,
      softDeadlineMs: 50,
      call: async () => {
        started = true;
        return 1;
      },
    });
    expect(outcome.kind).toBe('aborted');
    expect(started).toBe(false);
  });
});

describe('createBoundedResultCache', () => {
  it('evicts the least recently used entry once at capacity', () => {
    const cache = createBoundedResultCache<string, number>({ maxEntries: 2 });
    cache.set('a', 1);
    cache.set('b', 2);
    // Touching `a` makes `b` the oldest.
    expect(cache.get('a')).toBe(1);
    cache.set('c', 3);
    expect(cache.has('b')).toBe(false);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });
});

describe('createEncounterRunTracker', () => {
  it('treats a retry of the same authored encounter id as a different run', () => {
    const tracker = createEncounterRunTracker();
    const first = tracker.begin('emberwatch/proof_encounter');
    expect(tracker.isCurrent(first)).toBe(true);
    // A retry reuses the authored id: revision equality alone cannot detect it.
    const second = tracker.begin('emberwatch/proof_encounter');
    expect(second.encounterId).toBe(first.encounterId);
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(tracker.isCurrent(first)).toBe(false);
    expect(tracker.isCurrent(second)).toBe(true);
  });

  it('invalidates every identity once the run ends', () => {
    const tracker = createEncounterRunTracker();
    const run = tracker.begin('enc');
    tracker.end();
    expect(tracker.current()).toBeUndefined();
    expect(tracker.isCurrent(run)).toBe(false);
  });
});
