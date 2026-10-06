// .pi/extensions/lib/review_merge.test.ts

import { describe, expect, test } from 'bun:test';
import type { GhResult } from './gh.ts';
import { mergeReviewedHead } from './review_merge.ts';
import {
  formalReviewSnapshot,
  incrementalReviewSnapshot,
  reviewThread,
  runningReviewSnapshot,
} from './testing/coderabbit_fixtures.ts';

const approvedSnapshot = () => {
  const snapshot = formalReviewSnapshot();
  snapshot.head = 'expected-head';
  for (const review of snapshot.reviews) {
    review.head = snapshot.head;
  }
  return snapshot;
};

const finalSnapshotFor = (change: string) => {
  const snapshot = approvedSnapshot();
  const changes: Record<string, (value: ReturnType<typeof approvedSnapshot>) => void> = {
    running: (value) => {
      value.statuses = runningReviewSnapshot().statuses;
      for (const review of value.reviews) {
        review.submittedAt = '2026-10-05T02:00:00Z';
      }
    },
    dismissed: (value) => {
      for (const review of value.reviews) {
        review.state = 'DISMISSED';
      }
    },
    findings: (value) => {
      value.threads.push({ ...reviewThread(), head: value.head });
    },
    'head-changed': (value) => {
      value.head = 'other-head';
    },
    draft: (value) => {
      value.draft = true;
    },
    'completion-only': (value) => {
      Object.assign(value, incrementalReviewSnapshot());
    },
  };
  changes[change]?.(snapshot);
  return snapshot;
};

const passingChecks: GhResult = { success: true, code: 0, text: '', json: [{ bucket: 'pass' }] };
const noReport = () => {};

const attempt = async (options: {
  requested?: boolean;
  actionableCount?: number;
  review?: string;
  checks?: GhResult;
}) => {
  const merges: string[][] = [];
  const merged = await mergeReviewedHead({
    ...options,
    pr: '123',
    head: 'expected-head',
    report: noReport,
    readReviewState: async () => options.review ?? 'APPROVED',
    queryChecks: async () => options.checks ?? passingChecks,
    readDisposition: async () => approvedSnapshot(),
    mergeHead: async (args) => {
      merges.push(args);
      return { success: true, code: 0, text: '' };
    },
  });
  return { merged, merges };
};

describe('current-head merge safeguards', () => {
  test('positive control uses pinned head and actual successful exit, not stdout presence', async () => {
    const result = await attempt({ requested: true, actionableCount: 0 });
    expect(result.merged).toBe(true);
    expect(result.merges).toEqual([
      ['pr', 'merge', '123', '--squash', '--delete-branch', '--match-head-commit', 'expected-head'],
    ]);
  });

  test.each([
    { requested: false, actionableCount: 0 },
    { requested: true },
    { requested: true, actionableCount: 1 },
    { requested: true, actionableCount: 0, review: 'COMMENTED' },
    { requested: true, actionableCount: 0, review: 'DISMISSED' },
    {
      requested: true,
      actionableCount: 0,
      checks: { ...passingChecks, code: 1, json: [{ bucket: 'fail' }] },
    },
    {
      requested: true,
      actionableCount: 0,
      checks: { ...passingChecks, code: 8, json: [{ bucket: 'pending' }] },
    },
  ])('never attempts a merge without all evidence %#', async (options) => {
    const result = await attempt(options);
    expect(result.merged).toBe(false);
    expect(result.merges).toHaveLength(0);
  });

  test('approval withdrawn while CI is queried prevents merge', async () => {
    let reviews = 0;
    let merges = 0;
    expect(
      await mergeReviewedHead({
        requested: true,
        actionableCount: 0,
        pr: '123',
        head: 'expected-head',
        report: noReport,
        readReviewState: async () => (++reviews === 1 ? 'APPROVED' : 'DISMISSED'),
        readDisposition: async () => approvedSnapshot(),
        queryChecks: async () => passingChecks,
        mergeHead: async () => {
          merges++;
          return { success: true, code: 0, text: '' };
        },
      }),
    ).toBe(false);
    expect(reviews).toBe(2);
    expect(merges).toBe(0);
  });

  test.each(['running', 'dismissed', 'findings', 'head-changed', 'draft', 'completion-only'])(
    'final combined snapshot rejects %s even after previous approval and zero findings',
    async (change) => {
      const snapshot = finalSnapshotFor(change);
      let merges = 0;
      expect(
        await mergeReviewedHead({
          requested: true,
          actionableCount: 0,
          pr: '123',
          head: change === 'completion-only' ? snapshot.head : 'expected-head',
          report: noReport,
          readReviewState: async () => 'APPROVED',
          readDisposition: async () => snapshot,
          queryChecks: async () => passingChecks,
          mergeHead: async () => {
            merges++;
            return { success: true, code: 0, text: '' };
          },
        }),
      ).toBe(false);
      expect(merges).toBe(0);
    },
  );
  test('a failed merge command is never reported as merged', async () => {
    const reports: string[] = [];
    await expect(
      mergeReviewedHead({
        requested: true,
        actionableCount: 0,
        pr: '123',
        head: 'expected-head',
        report: (line) => reports.push(line),
        readReviewState: async () => 'APPROVED',
        readDisposition: async () => approvedSnapshot(),
        queryChecks: async () => passingChecks,
        mergeHead: async () => ({ success: false, code: 1, text: 'head changed' }),
      }),
    ).rejects.toThrow('head changed');
    expect(reports.some((line) => line.includes('✅ Merged'))).toBe(false);
  });
});
