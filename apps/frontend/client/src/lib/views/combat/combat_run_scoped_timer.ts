// apps/frontend/client/src/lib/views/combat/combat_run_scoped_timer.ts
//
// Run-scoped delayed callbacks for the combat surface (review F9/F-B).
//
// The invariant: no stale timer, provider response, reaction timeout or
// settlement callback may mutate a REPLACEMENT run. A delayed callback that
// captures only "the combat surface" is not enough — an encounter ends, another
// starts, and the old callback fires into the new fight.
//
// A callback is therefore scheduled WITH the run identity that was current at
// scheduling time, and it becomes inert the moment that identity stops being
// current. The guard is checked at FIRE time, not only at cancel time, so a
// callback already queued in the event loop cannot slip through.
//
// The identity is the client's `EncounterRunIdentity` (authored encounter id +
// generation) because these are presentation callbacks. Mechanical callbacks
// (commands, reactions) are bound to the ENGINE's `encounterRunId` through the
// command-admission envelope instead.

import type { EncounterRunIdentity } from '../../services/game/combat_ai_lifecycle';

/** Schedules and cancels delayed callbacks bound to an encounter run. */
export type RunScopedTimer = {
  /**
   * Schedules `fire` for the CURRENT run.
   *
   * A callback scheduled while no run is active never fires: there is no run it
   * could belong to.
   */
  schedule(options: {
    /** The run that was current when the callback was scheduled. */
    identity: EncounterRunIdentity | undefined;
    delayMs: number;
    fire: () => void;
  }): void;
  /** Cancels every pending callback (surface disposal). */
  clearAll(): void;
  /** How many callbacks are still pending — for tests and diagnostics. */
  pendingCount(): number;
};

/**
 * Creates the guard.
 *
 * `isCurrent` is injected so the same helper serves the ViewModel's tracker and
 * any test double without reaching into either.
 *
 * The predicate is deliberately "fire unless a DIFFERENT run replaced this one",
 * not "fire only if a run is current": a callback scheduled outside any
 * encounter (an out-of-combat dice roll) belongs to no run and has nothing to
 * invalidate, while a callback from a REPLACED run must never fire.
 */
export const createRunScopedTimer = (options: {
  isCurrent(identity: EncounterRunIdentity | undefined): boolean;
  /** Injectable scheduler so tests need no real clock. */
  schedule?: (fire: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clear?: (handle: ReturnType<typeof setTimeout>) => void;
}): RunScopedTimer => {
  const scheduleFn = options.schedule ?? ((fire, delayMs) => setTimeout(fire, delayMs));
  const clearFn = options.clear ?? ((handle) => clearTimeout(handle));
  const pending = new Set<ReturnType<typeof setTimeout>>();

  const belongsToCurrentRun = (identity: EncounterRunIdentity | undefined): boolean =>
    identity === undefined || options.isCurrent(identity);

  return {
    schedule: ({ identity, delayMs, fire }) => {
      if (!belongsToCurrentRun(identity)) {
        return;
      }
      const handle = scheduleFn(() => {
        pending.delete(handle);
        // Re-checked at FIRE time: the run may have been REPLACED between
        // scheduling and firing, which is exactly the case a cancel-only guard
        // misses.
        if (!belongsToCurrentRun(identity)) {
          return;
        }
        fire();
      }, delayMs);
      pending.add(handle);
    },
    clearAll: () => {
      for (const handle of pending) {
        clearFn(handle);
      }
      pending.clear();
    },
    pendingCount: () => pending.size,
  };
};
