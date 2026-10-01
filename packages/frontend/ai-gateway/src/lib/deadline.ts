// packages/frontend/ai-gateway/src/lib/deadline.ts
//
// ONE absolute deadline for one logical text request, carried from the caller
// to the transport.
//
// The defect this exists to prevent (issue #382 P0). The adapter used to mint a
// FRESH `fetchTimeoutMs` timer inside `withRequestScope` for every single
// scope, and `AiTextGenerationOptions` carried no deadline at all. Two
// consequences, both measured:
//
//   - a dialogue turn whose logical budget is 120 s (`npc_dialogue_service`
//     `DEFAULT_DIALOGUE_TIMEOUT_MS`) was silently truncated at the adapter's
//     90 s watchdog, with no error and no span showing why;
//   - a combat turn whose logical budget is 4 s was OVER-served for 90 s,
//     because the transport had no way to learn the caller's budget existed.
//
// Raising the 90 s constant fixes neither. The problem is not that 90 is too
// small; it is that two layers each own a budget and neither can see the other.
// So the caller's ABSOLUTE INSTANT is the only logical budget, and every phase
// below DERIVES a window from what is left rather than allocating a new one.
//
// Three failure kinds are named, because they are three different facts and a
// caller must be able to degrade from each differently:
//
//   - `total_budget` — the caller's end-to-end budget ran out;
//   - `first_content` — a headers/first-visible-content watchdog fired;
//   - `idle` — the stream stalled after content had started flowing.
//
// The two watchdogs are INTENTIONALLY shorter than the total. They are a
// liveness guard, not an answer to a slow generation, and they must never be
// "fixed" by simply raising them.
//
// The clock is injectable so a test can exercise a request that lives for
// minutes without a wall-clock sleep.

import type { AiMode } from '@aikami/types';

/** Which bound stopped a request. Named separately on purpose. */
export type GatewayTimeoutKind = 'total_budget' | 'first_content' | 'idle';

/** Why a request stopped, or `undefined` while it is still live. */
export type GatewayStopReason = 'caller-abort' | 'total_budget' | 'watchdog' | 'phase';

/** Injectable timers, so deadline behaviour is testable without real time. */
export type GatewayTimer = { cancel(): void };

/** Injectable time source. Defaults to `Date.now` + `setTimeout`. */
export type GatewayClock = {
  now(): number;
  setTimer(callback: () => void, ms: number): GatewayTimer;
};

const systemClock: GatewayClock = {
  now: () => Date.now(),
  setTimer: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    return {
      cancel: () => {
        clearTimeout(handle);
      },
    };
  },
};

/**
 * The finite safety limit for a caller that supplies NO deadline.
 *
 * Deliberately kept at the historical 90 s rather than raised. A caller with a
 * real budget now passes it, so this only bounds direct adapter callers who
 * asked for nothing; a value large enough to "never fire in practice" would be
 * a limit that does not limit.
 */
export const GATEWAY_UNBOUNDED_WATCHDOG_MS = 90_000;

/** How long a phase may occupy before it is considered stalled. */
export type GatewayPhaseLimits = {
  /** Response headers, i.e. admission plus model load. */
  readonly headersMs: number;
  /** First VISIBLE content frame. Excludes thinking frames by construction. */
  readonly firstContentMs: number;
  /** Gap between visible content frames once the stream is flowing. */
  readonly idleMs: number;
};

/** One derived window: a phase signal plus the bound that ended it. */
export type GatewayPhaseWindow = {
  readonly signal: AbortSignal;
  /** Which bound stopped this phase, or `undefined` while it is live. */
  endedBy(): 'phase' | 'total_budget' | undefined;
  /** Releases the phase timer. Idempotent. */
  dispose(): void;
};

/** The one shared budget for a logical text request. */
export type GatewayDeadline = {
  /** Absolute epoch ms. `Infinity` when the caller supplied no budget. */
  readonly deadlineAt: number;
  /** Whether the caller supplied a real end-to-end budget. */
  readonly bounded: boolean;
  /** Aborts on caller cancellation or when the total budget runs out. */
  readonly signal: AbortSignal;
  /** Milliseconds left on the total budget; `Infinity` when unbounded. */
  remainingMs(): number;
  /** Whether the total budget has already passed. */
  expired(): boolean;
  /**
   * The width a phase may still take, or `undefined` when nothing may start.
   *
   * Always the MINIMUM of the caller's own request and what is left. Returning
   * `undefined` rather than a zero is deliberate: starting work that is
   * guaranteed to be discarded is exactly the waste #382 is about.
   */
  windowMs(requestedMs: number): number | undefined;
  /**
   * Derives a phase window: a signal that fires after `requestedMs`, or when
   * the TOTAL budget runs out, whichever comes first.
   */
  phaseWindow(requestedMs: number): GatewayPhaseWindow;
  /** Why the request stopped, or `undefined` while it is still live. */
  stopReason(): GatewayStopReason | undefined;
  /** The failure kind to report when the request ended on a timeout. */
  timeoutKind(): GatewayTimeoutKind | undefined;
  /** Clears the total timer. Idempotent, and never aborts. */
  dispose(): void;
};

/** Knobs a caller (or a test) supplies when building a deadline. */
export type GatewayDeadlineOptions = {
  /** Absolute epoch ms. Adopted verbatim; the caller may have spent part of it. */
  deadlineAt?: number;
  /** The caller's own cancellation signal. */
  callerSignal?: AbortSignal;
  /** Safety limit used only when `deadlineAt` is absent. */
  watchdogMs?: number;
  clock?: GatewayClock;
};

/**
 * Creates the deadline for one logical text request.
 *
 * A caller-supplied `deadlineAt` is adopted VERBATIM, even if it is already in
 * the past — an exhausted budget must be observable as an expired budget rather
 * than quietly replaced by a fresh default.
 */
export const createGatewayDeadline = (options?: GatewayDeadlineOptions): GatewayDeadline => {
  const clock = options?.clock ?? systemClock;
  const callerSignal = options?.callerSignal;
  const now = clock.now;

  const bounded = options?.deadlineAt !== undefined && Number.isFinite(options.deadlineAt);
  const watchdogMs = Math.max(0, options?.watchdogMs ?? GATEWAY_UNBOUNDED_WATCHDOG_MS);
  const effectiveAt = bounded
    ? (options?.deadlineAt as number)
    : /* istanbul ignore next -- only reachable with a non-finite explicit value */ now() +
      watchdogMs;

  const controller = new AbortController();
  let reason: GatewayStopReason | undefined;
  let kind: GatewayTimeoutKind | undefined;
  let disposed = false;
  let unlink: (() => void) | undefined;

  const stop = (nextReason: GatewayStopReason, nextKind?: GatewayTimeoutKind): void => {
    if (reason !== undefined) {
      return;
    }
    reason = nextReason;
    kind = nextKind;
    controller.abort(new Error(`Request stopped: ${nextReason}`));
  };

  // No timer at all for a genuinely unbounded request. `setTimeout(Infinity)`
  // overflows to ~1 ms in Node and Bun, which would turn "never times out" into
  // "times out immediately" — the worst possible reading of the intent.
  const totalTimer: GatewayTimer =
    bounded || Number.isFinite(watchdogMs)
      ? clock.setTimer(
          () => {
            stop('total_budget', 'total_budget');
          },
          Math.max(0, effectiveAt - now()),
        )
      : { cancel: () => {} };

  if (callerSignal) {
    if (callerSignal.aborted) {
      stop('caller-abort');
    } else {
      const onAbort = (): void => {
        stop('caller-abort');
      };
      callerSignal.addEventListener('abort', onAbort, { once: true });
      unlink = () => {
        callerSignal.removeEventListener('abort', onAbort);
      };
    }
  }

  return {
    deadlineAt: effectiveAt,
    bounded,
    signal: controller.signal,
    remainingMs: () => (bounded ? Math.max(0, effectiveAt - now()) : Number.POSITIVE_INFINITY),
    expired: () => bounded && now() >= effectiveAt,
    windowMs(requestedMs: number) {
      const request = Math.max(0, requestedMs);
      if (!bounded) {
        return request;
      }
      const remaining = Math.max(0, effectiveAt - now());
      if (remaining <= 0) {
        return undefined;
      }
      return Math.min(request, remaining);
    },
    phaseWindow(requestedMs: number): GatewayPhaseWindow {
      const phaseController = new AbortController();
      const window = this.windowMs(requestedMs);
      if (window === undefined) {
        // The total budget is already gone. A pre-aborted phase signal is the
        // honest encoding: no work may start, and nothing may be started by a
        // caller that ignores the flag.
        phaseController.abort(new Error('Total budget exhausted before phase started'));
        return {
          signal: phaseController.signal,
          endedBy: () => 'total_budget',
          dispose: () => {},
        };
      }
      let ended: 'phase' | 'total_budget' | undefined;
      const onTotal = (): void => {
        // First bound wins. When the phase is clamped to exactly the remaining
        // budget both timers are due at the same instant, and letting the phase
        // timer overwrite this would report a budget exhaustion as a liveness
        // stall — two facts a caller acts on in opposite ways.
        if (ended !== undefined) {
          return;
        }
        ended = 'total_budget';
        phaseController.abort(new Error('Total budget exhausted'));
      };
      const timer = clock.setTimer(() => {
        if (ended !== undefined) {
          return;
        }
        ended = 'phase';
        phaseController.abort(new Error(`Phase watchdog fired after ${requestedMs} ms`));
      }, window);
      if (controller.signal.aborted) {
        ended = 'total_budget';
        phaseController.abort(controller.signal.reason);
      } else {
        controller.signal.addEventListener('abort', onTotal, { once: true });
      }
      return {
        signal: phaseController.signal,
        endedBy: () => ended,
        dispose: () => {
          timer.cancel();
          controller.signal.removeEventListener('abort', onTotal);
        },
      };
    },
    stopReason: () => reason,
    timeoutKind: () => kind,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      totalTimer.cancel();
      unlink?.();
    },
  };
};

/**
 * A deadline that only reports caller cancellation.
 *
 * For a caller that genuinely has no end-to-end budget (background work whose
 * bound is the campaign, not a stopwatch). Distinct from passing a very large
 * `deadlineAt`, which would install a real timer and turn a background request
 * into a foreground one.
 */
export const createUnboundedGatewayDeadline = (callerSignal?: AbortSignal): GatewayDeadline =>
  createGatewayDeadline({ callerSignal, watchdogMs: Number.POSITIVE_INFINITY });

/** Default phase limits, matching the historical constants. */
export const DEFAULT_GATEWAY_PHASE_LIMITS: GatewayPhaseLimits = {
  headersMs: 90_000,
  firstContentMs: 15_000,
  idleMs: 5_000,
};

/**
 * The message a timeout failure reports.
 *
 * Carries the kind and the mode in the text because the normalised gateway
 * vocabulary has a single `timeout` code; two callers reading only the message
 * still need to tell a stalled stream from an exhausted budget.
 */
export const describeTimeout = (options: {
  kind: GatewayTimeoutKind;
  mode: AiMode;
  provider: string;
  elapsedMs?: number;
}): string => {
  const { kind, mode, provider, elapsedMs } = options;
  const where = `[${mode}/${provider}]`;
  switch (kind) {
    case 'total_budget':
      return `${where} total request budget exhausted${elapsedMs === undefined ? '' : ` after ${elapsedMs} ms`}`;
    case 'first_content':
      return `${where} no visible content after the headers arrived`;
    case 'idle':
      return `${where} content stream stalled`;
  }
};
