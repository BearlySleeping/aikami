// .pi/extensions/lib/review_merge.test.ts

import { describe, expect, test } from 'bun:test';
import type { GhResult } from './gh.ts';
import { mergeReviewedHead } from './review_merge.ts';

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
        queryChecks: async () => passingChecks,
        mergeHead: async () => ({ success: false, code: 1, text: 'head changed' }),
      }),
    ).rejects.toThrow('head changed');
    expect(reports.some((line) => line.includes('✅ Merged'))).toBe(false);
  });
});
