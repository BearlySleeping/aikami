// apps/frontend/client/src/lib/services/ai/ai_request_deadline.test.ts
//
// One absolute deadline per logical request (issue #382 P0).
//
// The property under test is the one that was broken: a layer must never be
// able to start work it cannot finish, and the total wall-clock cost of a request
// must equal its budget no matter how many layers it passes through.

import { describe, expect, test } from 'bun:test';
import { createAiRequestDeadline, createUnboundedAiDeadline } from './ai_request_deadline.ts';

describe('createAiRequestDeadline', () => {
  test('derives each layer window from what is left, never restarting the budget', () => {
    const startedAt = Date.now();
    const deadline = createAiRequestDeadline({ startedAt, hardDeadlineMs: 4_000 });

    // Layer 1 (model load) takes 1.5 s.
    const afterLoad = startedAt + 1_500;
    expect(deadline.windowMs(5_000, afterLoad)).toBe(2_500);

    // Layer 2 (the gateway call) only gets what layer 1 left — its own 5 s
    // request is capped, not granted.
    const afterCall = startedAt + 2_000;
    expect(deadline.windowMs(5_000, afterCall)).toBe(2_000);
  });

  test('refuses to open a window once the budget is spent', () => {
    const startedAt = Date.now();
    const deadline = createAiRequestDeadline({ startedAt, hardDeadlineMs: 1_000 });

    expect(deadline.windowMs(500, startedAt + 1_000)).toBeUndefined();
    expect(deadline.windowMs(500, startedAt + 5_000)).toBeUndefined();
    expect(deadline.expired(startedAt + 1_000)).toBe(true);
  });

  test('charges pre-deadline time spent before the deadline was created', () => {
    const startedAt = Date.now();
    const deadline = createAiRequestDeadline({ startedAt, hardDeadlineMs: 1_000 });

    // Snapshot acquisition already took 800 ms, so only 200 ms remain.
    expect(deadline.remainingMs(startedAt + 800)).toBe(200);
    expect(deadline.windowMs(1_000, startedAt + 800)).toBe(200);
  });

  test('aborts at the deadline and reports a timeout, not a cancellation', async () => {
    const deadline = createAiRequestDeadline({ hardDeadlineMs: 20 });
    expect(deadline.stopReason()).toBeUndefined();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.stopReason()).toBe('deadline');
    deadline.dispose();
  });

  test.each([950, 1_050])('aborts promptly when started %i ms ago', async (elapsed) => {
    const deadline = createAiRequestDeadline({
      startedAt: Date.now() - elapsed,
      hardDeadlineMs: 1_000,
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(deadline.signal.aborted).toBe(true);
      expect(deadline.stopReason()).toBe('deadline');
    } finally {
      deadline.dispose();
    }
  });

  test('propagates a caller abort and reports it as a cancellation', async () => {
    const caller = new AbortController();
    const deadline = createAiRequestDeadline({
      hardDeadlineMs: 5_000,
      callerSignal: caller.signal,
    });

    caller.abort();

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.stopReason()).toBe('caller-abort');
    // A cancellation is not a timeout: the budget is not thereby spent.
    expect(deadline.expired()).toBe(false);
    deadline.dispose();
  });

  test('is already aborted when the caller arrives pre-aborted', () => {
    const caller = new AbortController();
    caller.abort();

    const deadline = createAiRequestDeadline({ callerSignal: caller.signal });

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.stopReason()).toBe('caller-abort');
    deadline.dispose();
  });

  test('never returns a negative remaining window', () => {
    const startedAt = Date.now();
    const deadline = createAiRequestDeadline({ startedAt, hardDeadlineMs: 100 });
    expect(deadline.remainingMs(startedAt + 10_000)).toBe(0);
    deadline.dispose();
  });

  test('an explicit zero-length budget is honoured rather than defaulted', () => {
    const startedAt = Date.now();
    // A caller that asks for no time gets no time. Defaulting a zero here would
    // silently hand a spent budget a fresh 20 s.
    const deadline = createAiRequestDeadline({ startedAt, hardDeadlineMs: 0 });
    expect(deadline.remainingMs(startedAt)).toBe(0);
    expect(deadline.expired(startedAt)).toBe(true);
    deadline.dispose();
  });
});

describe('createUnboundedAiDeadline', () => {
  test('never expires and grants any window it is asked for', () => {
    const deadline = createUnboundedAiDeadline();

    expect(deadline.expired()).toBe(false);
    expect(deadline.windowMs(3_600_000)).toBe(3_600_000);
    expect(deadline.remainingMs()).toBe(Number.POSITIVE_INFINITY);
    expect(deadline.stopReason()).toBeUndefined();
  });

  test('still honours caller cancellation', () => {
    const caller = new AbortController();
    const deadline = createUnboundedAiDeadline(caller.signal);

    caller.abort();

    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.stopReason()).toBe('caller-abort');
  });
});
