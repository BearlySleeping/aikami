// .pi/extensions/lib/review_pinned_checks.test.ts

import { expect, test } from 'bun:test';
import { haveChecksPassed } from './review_evidence.ts';
import { pinnedCheckEvidence } from './review_pinned_checks.ts';
import { REVIEW_HEAD } from './testing/coderabbit_fixtures.ts';

const run = (conclusion: string, head = REVIEW_HEAD, id = 1) => ({
  id,
  name: 'validate',
  head_sha: head,
  status: 'completed',
  conclusion,
});
const page = (runs: ReturnType<typeof run>[], total = runs.length) => ({
  check_runs: runs,
  total_count: total,
});

test('CI is bound to the exact reviewed head and all pages are checked', () => {
  expect(
    haveChecksPassed(
      pinnedCheckEvidence({ head: REVIEW_HEAD, runs: [page([run('success')])], statuses: [[]] }),
    ),
  ).toBe(true);
  expect(
    haveChecksPassed(
      pinnedCheckEvidence({
        head: REVIEW_HEAD,
        runs: [page([run('success')], 2), page([run('failure', REVIEW_HEAD, 2)], 2)],
        statuses: [[]],
      }),
    ),
  ).toBe(false);
  expect(() =>
    pinnedCheckEvidence({
      head: REVIEW_HEAD,
      runs: [page([run('success', 'wrong-head')])],
      statuses: [[]],
    }),
  ).toThrow('mismatched');
});
test('CodeRabbit alone cannot substitute for executed CI', () => {
  const result = pinnedCheckEvidence({
    head: REVIEW_HEAD,
    runs: [page([{ ...run('success'), name: 'CodeRabbit' }])],
    statuses: [
      [{ id: 1, context: 'CodeRabbit', state: 'success', updated_at: '2026-10-05T02:00:00Z' }],
    ],
  });
  expect(() => haveChecksPassed(result)).toThrow('no checks');
});
test('latest status wins; failure/pending/malformed data never passes CI', () => {
  const statuses = [
    [
      { id: 1, context: 'CI', state: 'success', updated_at: '2026-10-05T02:00:00Z' },
      { id: 2, context: 'CI', state: 'pending', updated_at: '2026-10-05T03:00:00Z' },
    ],
  ];
  expect(
    haveChecksPassed(
      pinnedCheckEvidence({ head: REVIEW_HEAD, runs: [page([run('success')])], statuses }),
    ),
  ).toBe(false);
  expect(() => pinnedCheckEvidence({ head: REVIEW_HEAD, runs: undefined, statuses })).toThrow(
    'Missing',
  );
});
test.each([
  { runs: [page([run('success')], 2)], error: 'Incomplete' },
  { runs: [page([run('success')], 2), page([run('success')], 2)], error: 'Duplicated' },
  {
    runs: [page([run('success')], 2), page([run('success', REVIEW_HEAD, 2)], 3)],
    error: 'total changed',
  },
  { runs: [{ check_runs: [run('success')] }], error: 'total count' },
])('rejects truncated, duplicated, inconsistent or missing check totals %#', ({ runs, error }) => {
  expect(() => pinnedCheckEvidence({ head: REVIEW_HEAD, runs, statuses: [[]] })).toThrow(error);
});
