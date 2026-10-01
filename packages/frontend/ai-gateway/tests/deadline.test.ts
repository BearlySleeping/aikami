// packages/frontend/ai-gateway/tests/deadline.test.ts
//
// The ONE budget for one logical text request (issue #382 P0).
//
// The regression this suite exists for: `withRequestScope` used to mint a fresh
// 90-second timer per request scope, and the call surface had no deadline field
// at all. So `npc_dialogue_service`'s 120 s logical budget was cut at 90 s with
// no error and no span explaining why, and a 4 s combat budget was served for
// 90 s because the transport could not see it.
//
// Every timing assertion below runs on an injected clock. A test that slept for
// 95 s to prove the watchdog was not firing would be a test nobody runs, and it
// would prove nothing extra — the point is which clock each bound is measured
// against, and that is exactly what an injected clock makes observable.

import { describe, expect, test } from 'bun:test';
import {
  createGatewayDeadline,
  createUnboundedGatewayDeadline,
  describeTimeout,
  type GatewayClock,
  type GatewayTimer,
} from '../src/index.ts';

/** A clock the test advances by hand. No timers, no sleeps, no flakiness. */
const fakeClock = (
  startAt = 1_000,
): GatewayClock & { advance(ms: number): void; pending: number } => {
  let current = startAt;
  const timers: Array<{ at: number; callback: () => void; live: boolean }> = [];
  return {
    now: () => current,
    setTimer(callback: () => void, ms: number): GatewayTimer {
      expect(ms).toBeLessThanOrEqual(2_147_483_647);
      const entry = { at: current + ms, callback, live: true };
      timers.push(entry);
      return {
        cancel: () => {
          entry.live = false;
        },
      };
    },
    advance(ms: number): void {
      const target = current + ms;
      // Fire in due order, so a timer scheduled by a timer is still honoured.
      for (;;) {
        const due = timers
          .filter((entry) => entry.live && entry.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (due === undefined) {
          break;
        }
        current = due.at;
        due.live = false;
        due.callback();
      }
      current = target;
    },
    get pending(): number {
      return timers.filter((entry) => entry.live).length;
    },
  };
};

const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

describe('gateway deadline — the caller budget is the only budget', () => {
  test('adopts a caller deadline verbatim, including one already in the past', () => {
    const clock = fakeClock();
    // The caller may already have spent part of its budget acquiring a
    // snapshot; re-minting a fresh one here is precisely the restart this
    // exists to prevent.
    const deadline = createGatewayDeadline({ deadlineAt: 5_000, clock });
    expect(deadline.bounded).toBe(true);
    expect(deadline.deadlineAt).toBe(5_000);
    expect(deadline.remainingMs()).toBe(4_000);

    const expired = createGatewayDeadline({ deadlineAt: 900, clock });
    // An exhausted budget stays observable as expired. Silently replacing it
    // with a default would turn "no time left" into "start again".
    expect(expired.expired()).toBe(true);
    expect(expired.remainingMs()).toBe(0);
    expect(expired.windowMs(1_000)).toBeUndefined();
  });

  test('honours a budget LONGER than the 90s watchdog', async () => {
    const clock = fakeClock();
    // The exact case the old code got wrong: dialogue declares 120 s, the old
    // per-scope timer cut it at 90 s.
    const deadline = createGatewayDeadline({ deadlineAt: 1_000 + 120_000, clock });

    clock.advance(119_000);
    await settle();
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.stopReason()).toBeUndefined();

    clock.advance(2_000);
    await settle();
    expect(deadline.stopReason()).toBe('total_budget');
    expect(deadline.timeoutKind()).toBe('total_budget');
  });

  test('cuts a SHORT budget at its own instant, not at the watchdog', async () => {
    const clock = fakeClock();
    // A 4 s combat budget must not be served for 90 s.
    const deadline = createGatewayDeadline({ deadlineAt: 1_000 + 4_000, clock });

    clock.advance(3_999);
    await settle();
    expect(deadline.signal.aborted).toBe(false);

    clock.advance(2);
    await settle();
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.timeoutKind()).toBe('total_budget');
  });

  test('falls back to a finite watchdog when the caller supplies no deadline', async () => {
    const clock = fakeClock();
    const deadline = createGatewayDeadline({ clock });

    expect(deadline.bounded).toBe(false);
    clock.advance(89_999);
    await settle();
    expect(deadline.signal.aborted).toBe(false);

    clock.advance(2);
    await settle();
    // A direct adapter caller still gets a bound. A limit large enough never to
    // fire is not a limit.
    expect(deadline.stopReason()).toBe('total_budget');
  });
});

describe('gateway deadline — phases draw the budget down', () => {
  test('a phase window is the MINIMUM of its own request and what is left', () => {
    const clock = fakeClock();
    const deadline = createGatewayDeadline({ deadlineAt: 1_000 + 10_000, clock });

    // Plenty of budget: the phase gets what it asked for.
    const roomy = deadline.phaseWindow(5_000);
    expect(roomy.signal.aborted).toBe(false);
    roomy.dispose();

    clock.advance(8_000);
    // Little budget left: the phase is clamped, and the caller learns that.
    const tight = deadline.phaseWindow(5_000);
    clock.advance(2_001);
    expect(tight.endedBy()).toBe('total_budget');
    expect(tight.signal.aborted).toBe(true);
    tight.dispose();
  });

  test('a phase with its own watchdog reports `phase`, not `total_budget`', async () => {
    const clock = fakeClock();
    const deadline = createGatewayDeadline({ deadlineAt: 1_000 + 600_000, clock });

    // The first-content watchdog is INTENTIONALLY shorter than the total. That
    // is a liveness guard, and it must be distinguishable from the budget
    // running out — a caller degrades from them differently.
    const phase = deadline.phaseWindow(15_000);
    clock.advance(15_001);

    expect(phase.endedBy()).toBe('phase');
    expect(phase.signal.aborted).toBe(true);
    // The request itself is still live: there is budget left.
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.stopReason()).toBeUndefined();
    phase.dispose();
    await settle();
  });

  test('a phase that starts after the budget is gone never runs', () => {
    const clock = fakeClock();
    const deadline = createGatewayDeadline({ deadlineAt: 1_000, clock });
    clock.advance(10);

    // Pre-aborted rather than zero-width: starting work that is guaranteed to
    // be discarded is exactly the waste this prevents.
    const phase = deadline.phaseWindow(5_000);
    expect(phase.signal.aborted).toBe(true);
    expect(phase.endedBy()).toBe('total_budget');
    phase.dispose();
  });

  test('dispose releases the total timer and does NOT abort', async () => {
    const clock = fakeClock();
    const deadline = createGatewayDeadline({ deadlineAt: 1_000 + 1_000, clock });
    expect(clock.pending).toBe(1);

    deadline.dispose();
    expect(clock.pending).toBe(0);
    // A settled request's signal must stay un-aborted, so a late observer sees
    // the truth rather than a disposal artefact.
    expect(deadline.signal.aborted).toBe(false);

    clock.advance(5_000);
    await settle();
    expect(deadline.signal.aborted).toBe(false);
  });

  test('an already-aborted caller signal is adopted, not waited out', () => {
    const clock = fakeClock();
    const controller = new AbortController();
    controller.abort(new Error('user left'));

    const deadline = createGatewayDeadline({
      deadlineAt: 1_000 + 10_000,
      callerSignal: controller.signal,
      clock,
    });
    // A cancellation is not a timeout, and reporting it as one would make a
    // user navigating away look like a slow provider.
    expect(deadline.stopReason()).toBe('caller-abort');
    expect(deadline.timeoutKind()).toBeUndefined();
    deadline.dispose();
  });

  test('a caller abort mid-request stops it and is not a timeout', async () => {
    const clock = fakeClock();
    const controller = new AbortController();
    const deadline = createGatewayDeadline({
      deadlineAt: 1_000 + 600_000,
      callerSignal: controller.signal,
      clock,
    });

    controller.abort(new Error('cancelled'));
    await settle();
    expect(deadline.stopReason()).toBe('caller-abort');
    expect(deadline.timeoutKind()).toBeUndefined();
    deadline.dispose();
  });
});

describe('gateway deadline — unbounded callers', () => {
  test('an unbounded deadline never manufactures a timeout', async () => {
    const clock = fakeClock();
    const deadline = createUnboundedGatewayDeadline();

    clock.advance(10 * 60_000);
    await settle();
    // Background work's bound is the campaign, not a stopwatch.
    expect(deadline.signal.aborted).toBe(false);
    expect(deadline.remainingMs()).toBe(Number.POSITIVE_INFINITY);
    expect(deadline.windowMs(1_000_000)).toBe(1_000_000);
    deadline.dispose();
  });

  test('an unbounded deadline still observes a caller cancellation', () => {
    const controller = new AbortController();
    const deadline = createUnboundedGatewayDeadline(controller.signal);
    controller.abort();
    expect(deadline.stopReason()).toBe('caller-abort');
    deadline.dispose();
  });
});

describe('timeout descriptions are distinguishable', () => {
  test('each failure kind reads differently', () => {
    const kinds = ['total_budget', 'first_content', 'idle'] as const;
    const messages = kinds.map((kind) =>
      describeTimeout({ kind, mode: 'offline', provider: 'ollama' }),
    );
    // A reader — or a log parser — must be able to tell the three apart from
    // the message alone, because the normalised code is a single `timeout`.
    expect(new Set(messages).size).toBe(3);
    expect(messages[0]).toContain('total request budget exhausted');
    expect(messages[1]).toContain('no visible content');
    expect(messages[2]).toContain('stalled');
  });
});

test('long total and phase timers re-arm until their actual target, then dispose', () => {
  const maximum = 2_147_483_647;
  const clock = fakeClock(0);
  const deadline = createGatewayDeadline({ deadlineAt: maximum + 200, clock });
  const phase = deadline.phaseWindow(maximum + 100);
  clock.advance(maximum);
  expect(deadline.signal.aborted).toBe(false);
  expect(phase.signal.aborted).toBe(false);
  expect(clock.pending).toBe(2);
  clock.advance(100);
  expect(phase.endedBy()).toBe('phase');
  expect(deadline.signal.aborted).toBe(false);
  clock.advance(100);
  expect(deadline.timeoutKind()).toBe('total_budget');
  phase.dispose();
  deadline.dispose();
  expect(clock.pending).toBe(0);

  const disposable = createGatewayDeadline({ deadlineAt: clock.now() + maximum + 200, clock });
  const disposablePhase = disposable.phaseWindow(maximum + 100);
  clock.advance(maximum);
  disposablePhase.dispose();
  disposable.dispose();
  expect(clock.pending).toBe(0);
  clock.advance(200);
  expect(disposable.signal.aborted).toBe(false);
  expect(disposablePhase.signal.aborted).toBe(false);
});
