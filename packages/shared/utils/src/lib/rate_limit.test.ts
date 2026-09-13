// packages/shared/utils/src/lib/rate_limit.test.ts
//
// C-513: the sliding-window limiter the community-publish routes meter against.
//
// A window (not a bare cooldown) is the point: an account must be able to spend
// its whole budget — concurrent reserves, a failed upload retried — and only
// the call past the budget is refused.

import { describe, expect, test } from 'bun:test';
import { tryReserveWindow } from './rate_limit.ts';

/** Unique per test so the module-level state cannot leak between cases. */
const freshKey = (label: string): string => `rate-limit-test:${label}:${crypto.randomUUID()}`;

describe('tryReserveWindow', () => {
  test('allows exactly maxHits calls, then refuses', () => {
    const key = freshKey('budget');
    const options = { maxHits: 3, windowMs: 60_000 };

    expect(tryReserveWindow(key, options)).toBe(true);
    expect(tryReserveWindow(key, options)).toBe(true);
    expect(tryReserveWindow(key, options)).toBe(true);
    expect(tryReserveWindow(key, options)).toBe(false);
    expect(tryReserveWindow(key, options)).toBe(false);
  });

  test('distinct keys have independent budgets', () => {
    const options = { maxHits: 1, windowMs: 60_000 };
    const first = freshKey('independent-a');
    const second = freshKey('independent-b');

    expect(tryReserveWindow(first, options)).toBe(true);
    expect(tryReserveWindow(first, options)).toBe(false);
    // The exhausted key does not affect its neighbour.
    expect(tryReserveWindow(second, options)).toBe(true);
  });

  test('capacity returns once the oldest hits age out of the window', async () => {
    const key = freshKey('slide');
    const options = { maxHits: 1, windowMs: 40 };

    expect(tryReserveWindow(key, options)).toBe(true);
    expect(tryReserveWindow(key, options)).toBe(false);

    await Bun.sleep(60);

    expect(tryReserveWindow(key, options)).toBe(true);
  });

  test('refused calls do not push the window forward', async () => {
    const key = freshKey('no-extension');
    const options = { maxHits: 1, windowMs: 40 };

    expect(tryReserveWindow(key, options)).toBe(true);
    // Hammer the limiter past its window; a rejected call must not count as a
    // new hit, or a persistent caller could starve itself forever.
    const deadline = Date.now() + 120;
    let allowedAgain = false;
    while (Date.now() < deadline) {
      if (tryReserveWindow(key, options)) {
        allowedAgain = true;
        break;
      }
      await Bun.sleep(5);
    }
    expect(allowedAgain).toBe(true);
  });

  test('a burst up to the budget is never split by timing', () => {
    // The retry/duplicate-submit case the window exists for: two calls in the
    // same tick must both succeed when the budget has room.
    const key = freshKey('burst');
    const options = { maxHits: 2, windowMs: 60_000 };
    expect([tryReserveWindow(key, options), tryReserveWindow(key, options)]).toEqual([true, true]);
  });
});
