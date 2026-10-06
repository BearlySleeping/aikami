// apps/frontend/client/src/lib/services/ai/ai_request_deadline.ts
//
// ONE absolute deadline for one logical text request.
//
// The defect this exists to prevent (issue #382 P0): every layer that can spend
// time on a request used to mint its own timeout. A local-first attempt started
// a fresh 5 s clock, then the gateway path started its own, and a combat turn
// that the engine abandons at 1.5 s could still be paying for both. Deadlines
// restarted at each layer, so the wall-clock cost of a "fast" fallback was
// routinely several times the budget the player is waiting on.
//
// A deadline here is a single absolute instant. Layers DERIVE a window from what
// is left (`windowMs`) instead of allocating a new budget, so queueing, model
// load, retry and fallback all draw down the same clock and the request always
// terminates at the same instant.
//
// Contract: issue #382 P0 "Unify routing, deadlines and fallback".

/** Why a request stopped early. */
export type AiDeadlineStopReason = 'caller-abort' | 'deadline';

/**
 * Fallback ceiling for a bounded request that names no budget of its own.
 *
 * Internal rather than exported: the real budgets live on the task presets
 * (`textTaskBudgetMs`), and an exported constant nobody reads is a second place
 * for a deadline to be configured from. This is the floor for a caller who
 * explicitly asked for a bounded deadline without saying how long.
 */
const DEFAULT_BUDGET_MS = 20_000;

/**
 * One shared, absolute end-to-end budget.
 *
 * `signal` aborts at the deadline and whenever the caller's own signal aborts,
 * so a single downstream abort covers queueing, loading, generation and every
 * layer in between. `stopReason` distinguishes the two: a caller abort is a
 * cancellation the user asked for, while a deadline is a timeout the caller must
 * degrade from — a materially different thing to report and to cache.
 */
export type AiRequestDeadline = {
  /** Absolute epoch ms at which the whole request must be finished. */
  readonly deadlineAt: number;
  /** Signal that aborts at the deadline or on caller cancellation. */
  readonly signal: AbortSignal;
  /** Milliseconds left, never negative. */
  remainingMs(now?: number): number;
  /** Whether the deadline has passed. */
  expired(now?: number): boolean;
  /**
   * Whether a window of `requestedMs` can still start, and how wide it may be.
   *
   * A layer asks for the window it wants and receives the smaller of that and
   * what is left. `undefined` means "do not start another attempt" — the
   * alternative is starting work that is guaranteed to be discarded.
   */
  windowMs(requestedMs: number, now?: number): number | undefined;
  /** Why the request stopped, or `undefined` while it is still live. */
  stopReason(): AiDeadlineStopReason | undefined;
  /** Clears the deadline timer. Safe to call more than once. */
  dispose(): void;
};

/**
 * Creates one shared deadline.
 *
 * `startedAt` defaults to now so a caller that already spent time acquiring a
 * snapshot can pass its own start and be charged for that time — otherwise the
 * budget would restart exactly where it must not.
 */
export const createAiRequestDeadline = (options?: {
  startedAt?: number;
  hardDeadlineMs?: number;
  callerSignal?: AbortSignal;
}): AiRequestDeadline => {
  const startedAt = options?.startedAt ?? Date.now();
  const hardDeadlineMs = Math.max(0, options?.hardDeadlineMs ?? DEFAULT_BUDGET_MS);
  const deadlineAt = startedAt + hardDeadlineMs;
  const callerSignal = options?.callerSignal;

  const controller = new AbortController();
  let reason: AiDeadlineStopReason | undefined;

  const timer = setTimeout(
    () => {
      reason = 'deadline';
      controller.abort();
    },
    Math.max(1, deadlineAt - Date.now()),
  );

  if (callerSignal) {
    if (callerSignal.aborted) {
      reason = 'caller-abort';
      controller.abort(callerSignal.reason);
    } else {
      const onAbort = (): void => {
        reason = 'caller-abort';
        controller.abort(callerSignal.reason);
      };
      callerSignal.addEventListener('abort', onAbort, { once: true });
      controller.signal.addEventListener(
        'abort',
        () => callerSignal.removeEventListener('abort', onAbort),
        { once: true },
      );
    }
  }

  const now = (at?: number): number => at ?? Date.now();
  let disposed = false;

  return {
    deadlineAt,
    signal: controller.signal,
    remainingMs: (at) => Math.max(0, deadlineAt - now(at)),
    expired: (at) => now(at) >= deadlineAt,
    windowMs(requestedMs, at) {
      const remaining = Math.max(0, deadlineAt - now(at));
      if (remaining <= 0) {
        return undefined;
      }
      return Math.min(Math.max(0, requestedMs), remaining);
    },
    stopReason: () => reason,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      clearTimeout(timer);
    },
  };
};

/**
 * A deadline that never fires.
 *
 * For work whose bound is the encounter's or the campaign's lifetime rather
 * than a player's attention span (background agents). It is still a real
 * `AiRequestDeadline`, so the same code path serves both, but it never
 * manufactures a timeout the caller did not ask for.
 */
export const createUnboundedAiDeadline = (callerSignal?: AbortSignal): AiRequestDeadline => {
  const controller = new AbortController();
  let reason: AiDeadlineStopReason | undefined;
  let unlink: (() => void) | undefined;
  if (callerSignal) {
    if (callerSignal.aborted) {
      reason = 'caller-abort';
      controller.abort(callerSignal.reason);
    } else {
      const onAbort = (): void => {
        reason = 'caller-abort';
        controller.abort(callerSignal.reason);
      };
      callerSignal.addEventListener('abort', onAbort, { once: true });
      unlink = () => callerSignal.removeEventListener('abort', onAbort);
    }
  }
  const unbounded: number = Number.POSITIVE_INFINITY;
  return {
    deadlineAt: unbounded,
    signal: controller.signal,
    remainingMs: () => Number.POSITIVE_INFINITY,
    expired: () => false,
    windowMs: (requestedMs) => Math.max(0, requestedMs),
    stopReason: () => reason,
    // There is no timer to clear, and disposing must NOT abort: a settled
    // request's signal has to stay un-aborted so a late observer (or a reuse of
    // the signal by diagnostics) sees the truth rather than a disposal artefact.
    dispose() {
      unlink?.();
    },
  };
};
