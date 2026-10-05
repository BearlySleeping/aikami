// .pi/extensions/lib/coderabbit_wait.test.ts

import { describe, expect, test } from 'bun:test';
import { waitForCodeRabbit } from './coderabbit_wait.ts';
import {
  incrementalReviewSnapshot,
  OLD_REVIEW_HEAD,
  reviewThread,
  runningReviewSnapshot,
} from './testing/coderabbit_fixtures.ts';

const clock = () => {
  let time = 0;
  return {
    now: () => time,
    sleep: async (milliseconds: number) => {
      time += milliseconds;
    },
  };
};

describe('bounded revision-based CodeRabbit waits', () => {
  test('sticky edit completes PR436 despite unchanged comment count', async () => {
    let calls = 0;
    const result = await waitForCodeRabbit({
      timeoutMs: 100,
      intervalMs: 1,
      ...clock(),
      readSnapshot: async () =>
        ++calls === 1 ? runningReviewSnapshot() : incrementalReviewSnapshot(),
    });
    expect(result.reason).toBe('completed');
    expect(calls).toBe(2);
  });
  test('human chatter and bot acknowledgement do not terminate a wait', async () => {
    const snapshot = runningReviewSnapshot();
    let calls = 0;
    const result = await waitForCodeRabbit({
      timeoutMs: 3,
      intervalMs: 1,
      ...clock(),
      returnOnFindings: true,
      readSnapshot: async () => {
        calls++;
        snapshot.comments.push({
          id: String(calls),
          login: calls === 2 ? 'coderabbitai[bot]' : 'human',
          body: 'Review requested!',
          createdAt: '2026-10-05T03:00:00Z',
          updatedAt: '2026-10-05T03:00:00Z',
        });
        return snapshot;
      },
    });
    expect(result.reason).toBe('timeout');
    expect(calls).toBe(3);
  });
  test('only new or edited CURRENT actionable threads terminate an activity wait', async () => {
    let calls = 0;
    const result = await waitForCodeRabbit({
      timeoutMs: 10,
      intervalMs: 1,
      ...clock(),
      returnOnFindings: true,
      readSnapshot: async () => {
        const snapshot = runningReviewSnapshot();
        snapshot.threads = [{ ...reviewThread('old'), head: OLD_REVIEW_HEAD }];
        if (++calls > 1) {
          snapshot.threads.push(reviewThread('new'));
        }
        return snapshot;
      },
    });
    expect(result.reason).toBe('findings');
    if (result.reason !== 'timeout') {
      expect(result.findings.actionableCount).toBe(1);
    }
  });
  test('head changes invalidate the wait instead of accepting another head', async () => {
    let calls = 0;
    await expect(
      waitForCodeRabbit({
        timeoutMs: 10,
        intervalMs: 1,
        ...clock(),
        readSnapshot: async () => {
          if (++calls === 1) {
            return runningReviewSnapshot();
          }
          return { ...incrementalReviewSnapshot(), head: OLD_REVIEW_HEAD };
        },
      }),
    ).rejects.toThrow('head changed');
  });
  test('repeated paused/rate-limited evidence cannot extend the hard deadline', async () => {
    let calls = 0;
    const snapshot = runningReviewSnapshot();
    const status = snapshot.statuses[0];
    if (!status) {
      throw new Error('fixture');
    }
    status.state = 'success';
    status.description = 'Review paused';
    const result = await waitForCodeRabbit({
      timeoutMs: 10,
      intervalMs: 6,
      ...clock(),
      readSnapshot: async () => {
        calls++;
        return snapshot;
      },
    });
    expect(result.reason).toBe('timeout');
    expect(calls).toBe(2);
  });
  test('query errors retry within the deadline, never yield zero clean findings', async () => {
    const timing = clock();
    await expect(
      waitForCodeRabbit({
        timeoutMs: 3,
        intervalMs: 1,
        ...timing,
        readSnapshot: async () => {
          throw new Error('HTTP 502');
        },
      }),
    ).rejects.toThrow('unavailable');
    let calls = 0;
    const result = await waitForCodeRabbit({
      timeoutMs: 10,
      intervalMs: 1,
      ...clock(),
      readSnapshot: async () => {
        if (++calls === 1) {
          throw new Error('HTTP 502');
        }
        return incrementalReviewSnapshot();
      },
    });
    expect(result.reason).toBe('completed');
  });
  test('old completion predating the detached request cannot finish it', async () => {
    const result = await waitForCodeRabbit({
      timeoutMs: 3,
      intervalMs: 1,
      since: Date.parse('2026-10-05T04:00:00Z'),
      ...clock(),
      readSnapshot: async () => incrementalReviewSnapshot(),
    });
    expect(result.reason).toBe('timeout');
  });
  test('cancellation before/during a query and during sleep is not completion', async () => {
    await expect(
      waitForCodeRabbit({
        timeoutMs: 10,
        intervalMs: 1,
        signal: AbortSignal.abort(),
        readSnapshot: async () => incrementalReviewSnapshot(),
      }),
    ).rejects.toThrow();
    const controller = new AbortController();
    await expect(
      waitForCodeRabbit({
        timeoutMs: 10,
        intervalMs: 1,
        signal: controller.signal,
        readSnapshot: async () => {
          controller.abort();
          return incrementalReviewSnapshot();
        },
      }),
    ).rejects.toThrow();
    const sleeping = new AbortController();
    const result = waitForCodeRabbit({
      timeoutMs: 60_000,
      intervalMs: 60_000,
      signal: sleeping.signal,
      readSnapshot: async () => runningReviewSnapshot(),
    });
    setTimeout(() => sleeping.abort(), 5);
    await expect(result).rejects.toThrow();
  });
  test.each([
    { timeoutMs: 0, intervalMs: 1 },
    { timeoutMs: Number.POSITIVE_INFINITY, intervalMs: 1 },
    { timeoutMs: 10, intervalMs: 0 },
  ])('rejects invalid budgets %#', async (options) => {
    await expect(
      waitForCodeRabbit({ ...options, readSnapshot: async () => incrementalReviewSnapshot() }),
    ).rejects.toThrow('requires');
  });
});
