// .pi/extensions/lib/review_polling.test.ts

import { describe, expect, test } from 'bun:test';
import { pollReviewState } from './review_polling.ts';

const approved = {
  success: true,
  code: 0,
  text: '',
  json: {
    headRefOid: 'head',
    isDraft: false,
    reviews: [
      {
        author: { login: 'coderabbitai' },
        commit: { oid: 'head' },
        state: 'APPROVED',
        submittedAt: '2026-10-04T00:00:00Z',
      },
    ],
  },
};

describe('review polling evidence', () => {
  test('retries failed CLI reads and accepts the recovered current-head review', async () => {
    let calls = 0;
    const reports: string[] = [];
    await expect(
      pollReviewState({
        pr: '1',
        intervalMs: 1,
        report: (line) => reports.push(line),
        query: async () => (++calls < 3 ? { success: false, code: 1, text: 'HTTP 502' } : approved),
      }),
    ).resolves.toBe('APPROVED');
    expect(calls).toBe(3);
    expect(reports).toHaveLength(2);
  });

  test('never queries after cancellation', async () => {
    let calls = 0;
    await expect(
      pollReviewState({
        pr: '1',
        signal: AbortSignal.abort(),
        query: async () => {
          calls++;
          return approved;
        },
      }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });

  test('cancellation during a query cannot report approval', async () => {
    const controller = new AbortController();
    await expect(
      pollReviewState({
        pr: '1',
        signal: controller.signal,
        query: async () => {
          controller.abort();
          return approved;
        },
      }),
    ).rejects.toThrow();
  });

  test('cancellation interrupts a long retry delay', async () => {
    const controller = new AbortController();
    let calls = 0;
    const result = pollReviewState({
      pr: '1',
      signal: controller.signal,
      intervalMs: 60_000,
      query: async () => {
        calls++;
        return { success: false, code: 1, text: 'offline' };
      },
    });
    setTimeout(() => controller.abort(), 5);
    await expect(result).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test('persistent CLI failures time out without review evidence', async () => {
    await expect(
      pollReviewState({
        pr: '1',
        deadline: Date.now() + 20,
        intervalMs: 1,
        query: async () => ({ success: false, code: 1, text: 'offline' }),
      }),
    ).rejects.toThrow();
  });

  test('malformed successful responses still fail closed', async () => {
    await expect(
      pollReviewState({ pr: '1', query: async () => ({ ...approved, json: {} }) }),
    ).rejects.toThrow('missing or malformed');
  });
});
