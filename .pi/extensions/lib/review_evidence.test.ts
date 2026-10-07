// .pi/extensions/lib/review_evidence.test.ts

import { describe, expect, test } from 'bun:test';
import type { GhResult } from './gh.ts';
import {
  currentCodeRabbitReviewState,
  describeAutofixOutcome,
  haveChecksPassed,
  parseActionableCount,
  readReadyPrSnapshot,
  summarizeCheckCompletion,
} from './review_evidence.ts';

const checks = (options: { code: number; buckets: string[] }): GhResult => ({
  success: true,
  code: options.code,
  text: 'structured check output',
  json: options.buckets.map((bucket) => ({ bucket })),
});

const review = (options: {
  state: string;
  head?: string;
  body?: string;
  submittedAt?: string;
}) => ({
  author: { login: 'coderabbitai[bot]' },
  state: options.state,
  submittedAt: options.submittedAt ?? '2026-10-04T12:00:00Z',
  commit: { oid: options.head ?? 'current-head' },
  body: options.body ?? 'Review completed',
});

const state = (reviews: unknown[]) =>
  currentCodeRabbitReviewState({ headRefOid: 'current-head', isDraft: false, reviews });

describe('CI check completion evidence', () => {
  test('exit 8 with pending checks remains pending, never completed', () => {
    expect(summarizeCheckCompletion(checks({ code: 8, buckets: ['pass', 'pending'] }))).toEqual({
      pendingCount: 1,
    });
  });

  test('completed failures are complete but are not evidence of passing CI', () => {
    expect(summarizeCheckCompletion(checks({ code: 1, buckets: ['pass', 'fail'] }))).toEqual({
      pendingCount: 0,
    });
  });

  test('successful completed checks have no pending work', () => {
    expect(summarizeCheckCompletion(checks({ code: 0, buckets: ['pass', 'skipping'] }))).toEqual({
      pendingCount: 0,
    });
  });

  test.each([
    { success: false, code: 1, text: 'permission denied' },
    { success: false, code: null, text: 'cancelled' },
    { success: true, code: 1, text: 'no checks reported', json: [] },
    { success: true, code: 0, text: 'not JSON' },
    { success: true, code: 0, text: '{}', json: {} },
    { success: true, code: 0, text: '[{}]', json: [{}] },
    { success: true, code: 0, text: 'unknown bucket', json: [{ bucket: 'unknown' }] },
    checks({ code: 8, buckets: ['pass'] }),
  ])('rejects missing, malformed or inconsistent evidence %#', (result) => {
    expect(() => summarizeCheckCompletion(result)).toThrow('Cannot establish CI check completion');
  });
});

describe('PR metadata boundary before review side effects', () => {
  const snapshot = {
    headRefOid: 'current-head',
    headRefName: 'feature',
    isDraft: false,
    reviews: [],
  };
  test('accepts a valid ready PR before its first review', async () => {
    expect(
      await readReadyPrSnapshot({
        pr: '123',
        readSnapshot: async () => ({ success: true, code: 0, text: '', json: snapshot }),
      }),
    ).toEqual({ headRefOid: 'current-head', headRefName: 'feature' });
  });
  test.each([
    { ...snapshot, isDraft: true },
    { ...snapshot, isDraft: undefined },
    { ...snapshot, headRefOid: undefined },
    { ...snapshot, headRefName: undefined },
    { ...snapshot, reviews: undefined },
    undefined,
  ])('rejects draft or malformed metadata %#', async (json) => {
    await expect(
      readReadyPrSnapshot({
        pr: '123',
        readSnapshot: async () => ({ success: true, code: 0, text: '', json }),
      }),
    ).rejects.toThrow();
  });
});

describe('autofix outcome reporting', () => {
  test('rate-limited, skipped and unknown outcomes cannot claim a clean review', () => {
    expect(describeAutofixOutcome({ rateLimited: true, skipped: false })).toContain('rate-limited');
    expect(describeAutofixOutcome({ rateLimited: false, skipped: true })).toContain(
      'not clean-review evidence',
    );
    expect(describeAutofixOutcome({ rateLimited: false, skipped: false })).toContain('Unknown');
  });
});

describe('merge evidence', () => {
  test('completed but failing, cancelled, pending or entirely skipped CI cannot authorize merge', () => {
    for (const buckets of [['fail'], ['cancel'], ['pending'], ['skipping'], ['pass', 'fail']]) {
      expect(haveChecksPassed(checks({ code: 1, buckets }))).toBe(false);
    }
    expect(haveChecksPassed(checks({ code: 0, buckets: ['pass', 'skipping'] }))).toBe(true);
  });

  test('missing findings summary is unknown, never zero', () => {
    expect(parseActionableCount('Autofix skipped')).toBeUndefined();
    expect(parseActionableCount('Actionable comments posted: 0')).toBe(0);
    expect(parseActionableCount('Actionable comments posted: **25**')).toBe(25);
  });
});

describe('current CodeRabbit review state', () => {
  test('accepts a completed current-head review', () => {
    expect(state([review({ state: 'COMMENTED' })])).toBe('COMMENTED');
    expect(state([review({ state: 'APPROVED' })])).toBe('APPROVED');
  });

  test('does not reuse approval for an older head', () => {
    expect(state([review({ state: 'APPROVED', head: 'old-head' })])).toBe('');
  });

  test('newer pending or dismissed reviews supersede older completion', () => {
    expect(state([review({ state: 'APPROVED' }), review({ state: 'PENDING' })])).toBe('');
    expect(state([review({ state: 'COMMENTED' }), review({ state: 'DISMISSED' })])).toBe('');
  });

  test('selects by submission time instead of API array order', () => {
    expect(
      state([
        review({ state: 'COMMENTED', submittedAt: '2026-10-04T13:00:00Z' }),
        review({ state: 'APPROVED', head: 'old-head', submittedAt: '2026-10-04T12:00:00Z' }),
      ]),
    ).toBe('COMMENTED');
  });

  test('an undated pending review supersedes completed review evidence', () => {
    expect(
      state([
        { ...review({ state: 'PENDING' }), submittedAt: undefined },
        review({ state: 'APPROVED' }),
      ]),
    ).toBe('');
  });

  test('other reviewers cannot supersede CodeRabbit evidence', () => {
    expect(
      state([
        review({ state: 'COMMENTED' }),
        { ...review({ state: 'APPROVED' }), author: { login: 'human-reviewer' } },
      ]),
    ).toBe('COMMENTED');
  });

  test('draft and skipped reviews are not completion evidence', () => {
    expect(
      currentCodeRabbitReviewState({
        headRefOid: 'current-head',
        isDraft: true,
        reviews: [review({ state: 'COMMENTED' })],
      }),
    ).toBe('');
    expect(() => state([review({ state: 'COMMENTED', body: 'Review skipped: draft PR' })])).toThrow(
      'skipped the current-head review',
    );
    expect(
      state([review({ state: 'COMMENTED', head: 'old-head', body: 'Review skipped: draft PR' })]),
    ).toBe('');
  });

  test('missing commit or malformed data is not review evidence', () => {
    expect(state([{ state: 'APPROVED', author: { login: 'coderabbitai' } }])).toBe('');
    expect(state([])).toBe('');
    expect(() => currentCodeRabbitReviewState(undefined)).toThrow('malformed PR snapshot');
  });
});
