// apps/frontend/client/src/lib/views/combat/combat_run_scoped_timer.test.ts
//
// Review F9: no stale timer may mutate a REPLACEMENT run.
//
// The mandatory regression from the repair brief:
//   1. finish encounter A;
//   2. before its delayed callback executes, start encounter B;
//   3. fire A's callback;
//   4. encounter B must remain untouched.
//
// The guard is checked at FIRE time, not only at cancel time, because a callback
// already queued in the event loop would otherwise slip through.

import { describe, expect, it } from 'bun:test';
import type { EncounterRunIdentity } from '../../services/game/combat_ai_lifecycle';
import { createEncounterRunTracker } from '../../services/game/combat_ai_lifecycle';
import { createRunScopedTimer } from './combat_run_scoped_timer.ts';

/** A deterministic scheduler: nothing fires until the test says so. */
const createManualClock = () => {
  const queued: Array<{ fire: () => void; delayMs: number; cancelled: boolean }> = [];
  return {
    schedule: (fire: () => void, delayMs: number) => {
      const entry = { fire, delayMs, cancelled: false };
      queued.push(entry);
      // The handle is the entry itself; `clear` marks it cancelled.
      return entry as unknown as ReturnType<typeof setTimeout>;
    },
    clear: (handle: ReturnType<typeof setTimeout>) => {
      (handle as unknown as { cancelled: boolean }).cancelled = true;
    },
    /**
     * Fires every non-cancelled callback that was queued BEFORE this tick.
     *
     * The queue is snapshotted so a callback scheduled from inside another
     * callback lands on a LATER tick — otherwise a nested schedule would fire in
     * the same tick and the test could not observe the run ending in between.
     */
    run: () => {
      for (const entry of [...queued]) {
        if (!entry.cancelled) {
          entry.fire();
        }
      }
    },
    /** Number of callbacks that are still scheduled (not cancelled). */
    live: () => queued.filter((entry) => !entry.cancelled).length,
    queued,
  };
};

describe('review F9: a stale run callback cannot mutate the replacement run', () => {
  it("encounter A's delayed callback is inert once encounter B is current", () => {
    const clock = createManualClock();
    const runs = createEncounterRunTracker();
    const timer = createRunScopedTimer({
      isCurrent: (identity) => runs.isCurrent(identity),
      schedule: clock.schedule,
      clear: clock.clear,
    });

    // Encounter A.
    const runA: EncounterRunIdentity = runs.begin('emberwatch/proof');
    let mutated = 'untouched';
    timer.schedule({ identity: runA, delayMs: 400, fire: () => (mutated = 'A') });
    expect(timer.pendingCount()).toBe(1);

    // Encounter A ends; encounter B starts BEFORE A's callback fires.
    runs.end();
    runs.begin('emberwatch/proof');

    clock.run();

    expect(mutated).toBe('untouched');
    expect(timer.pendingCount()).toBe(0);
  });

  it('the current run callback still fires normally', () => {
    const clock = createManualClock();
    const runs = createEncounterRunTracker();
    const timer = createRunScopedTimer({
      isCurrent: (identity) => runs.isCurrent(identity),
      schedule: clock.schedule,
      clear: clock.clear,
    });

    const runA = runs.begin('emberwatch/proof');
    let fired = false;
    timer.schedule({ identity: runA, delayMs: 400, fire: () => (fired = true) });

    clock.run();
    expect(fired).toBe(true);
  });

  it('a callback scheduled with no active run still fires (nothing to invalidate)', () => {
    // An out-of-combat dice roll belongs to no encounter, so there is no run to
    // replace it. Only a REPLACED run invalidates a callback.
    const clock = createManualClock();
    const runs = createEncounterRunTracker();
    const timer = createRunScopedTimer({
      isCurrent: (identity) => runs.isCurrent(identity),
      schedule: clock.schedule,
      clear: clock.clear,
    });

    let fired = false;
    timer.schedule({ identity: undefined, delayMs: 400, fire: () => (fired = true) });
    expect(timer.pendingCount()).toBe(1);

    clock.run();
    expect(fired).toBe(true);
  });

  it('a same-id retry is a DIFFERENT run and invalidates the old callback', () => {
    // The authored encounter id recurs on retry, so the guard must be the run
    // GENERATION, not the id.
    const clock = createManualClock();
    const runs = createEncounterRunTracker();
    const timer = createRunScopedTimer({
      isCurrent: (identity) => runs.isCurrent(identity),
      schedule: clock.schedule,
      clear: clock.clear,
    });

    const first = runs.begin('emberwatch/proof');
    let firedFrom = '';
    timer.schedule({ identity: first, delayMs: 10, fire: () => (firedFrom = 'first') });

    // Same authored id, new attempt.
    runs.begin('emberwatch/proof');
    clock.run();

    expect(firedFrom).toBe('');
  });

  it('clearAll cancels every pending callback', () => {
    const clock = createManualClock();
    const runs = createEncounterRunTracker();
    const timer = createRunScopedTimer({
      isCurrent: (identity) => runs.isCurrent(identity),
      schedule: clock.schedule,
      clear: clock.clear,
    });

    const run = runs.begin('emberwatch/proof');
    let fired = 0;
    timer.schedule({ identity: run, delayMs: 100, fire: () => (fired += 1) });
    timer.schedule({ identity: run, delayMs: 200, fire: () => (fired += 1) });
    expect(timer.pendingCount()).toBe(2);

    timer.clearAll();
    expect(timer.pendingCount()).toBe(0);
    clock.run();
    expect(fired).toBe(0);
  });

  it('a cancelled handle is never fired by the clock', () => {
    const clock = createManualClock();
    const runs = createEncounterRunTracker();
    const timer = createRunScopedTimer({
      isCurrent: (identity) => runs.isCurrent(identity),
      schedule: clock.schedule,
      clear: clock.clear,
    });

    const run = runs.begin('emberwatch/proof');
    let fired = 0;
    timer.schedule({ identity: run, delayMs: 100, fire: () => (fired += 1) });
    timer.schedule({ identity: run, delayMs: 200, fire: () => (fired += 1) });

    // Cancel only the first by clearing everything, then re-scheduling one.
    timer.clearAll();
    timer.schedule({ identity: run, delayMs: 300, fire: () => (fired += 1) });
    expect(clock.live()).toBe(1);

    clock.run();
    expect(fired).toBe(1);
  });

  it('a nested schedule is itself run-scoped', () => {
    // The dice reveal schedules a second callback from inside the first; both
    // must be invalidated when the run ends.
    const clock = createManualClock();
    const runs = createEncounterRunTracker();
    const timer = createRunScopedTimer({
      isCurrent: (identity) => runs.isCurrent(identity),
      schedule: clock.schedule,
      clear: clock.clear,
    });

    const runA = runs.begin('emberwatch/proof');
    const order: string[] = [];
    timer.schedule({
      identity: runA,
      delayMs: 1500,
      fire: () => {
        order.push('reveal');
        timer.schedule({ identity: runA, delayMs: 1500, fire: () => order.push('clear') });
      },
    });

    // The reveal fires while A is current.
    clock.run();
    expect(order).toEqual(['reveal']);

    // A ends before the nested clear fires.
    runs.end();
    clock.run();
    expect(order).toEqual(['reveal']);
  });
});
