// .pi/extensions/lib/coderabbit_snapshot.test.ts

import { describe, expect, test } from 'bun:test';
import {
  codeRabbitFindings,
  codeRabbitLifecycle,
  codeRabbitRevision,
} from './coderabbit_evidence.ts';
import { reviewFindingsReport } from './review_findings_report.ts';
import {
  formalReviewSnapshot,
  incrementalReviewSnapshot,
  OLD_REVIEW_HEAD,
  reviewedBody,
  reviewThread,
  runningReviewSnapshot,
} from './testing/coderabbit_fixtures.ts';

describe('head-specific multi-source CodeRabbit evidence', () => {
  test('PR436 completed incrementally with no new formal review or comment, not an approval', () => {
    const evidence = codeRabbitLifecycle(incrementalReviewSnapshot());
    expect(evidence.lifecycle).toBe('completed');
    expect(evidence.source).toBe('status-and-coverage');
    expect(evidence.verdict).toBeUndefined();
  });
  test('formal approval remains separate from completion', () => {
    expect(codeRabbitLifecycle(formalReviewSnapshot())).toMatchObject({
      lifecycle: 'completed',
      verdict: 'APPROVED',
      source: 'formal-review',
    });
  });
  test('provider completion preserves a real same-head formal verdict without fabricating one', () => {
    const snapshot = incrementalReviewSnapshot();
    snapshot.reviews = formalReviewSnapshot().reviews;
    for (const review of snapshot.reviews) {
      review.submittedAt = '2026-10-05T02:32:15Z';
    }
    expect(codeRabbitLifecycle(snapshot)).toMatchObject({
      lifecycle: 'completed',
      source: 'status-and-coverage',
      verdict: 'APPROVED',
    });
  });
  test('a newer malformed sticky summary cannot be hidden behind older valid coverage', () => {
    const snapshot = incrementalReviewSnapshot();
    snapshot.comments.push({
      id: 'new-sticky',
      login: 'coderabbitai[bot]',
      body: reviewedBody().replace('"reviewed"', '"skipped"'),
      createdAt: '2026-10-05T03:00:00Z',
      updatedAt: '2026-10-05T03:00:00Z',
    });
    expect(codeRabbitLifecycle(snapshot).lifecycle).not.toBe('completed');
  });
  test('a pending bot review with GitHub-null commit does not allow fallback completion', () => {
    const snapshot = incrementalReviewSnapshot();
    snapshot.reviews.push({
      id: 'pending',
      login: 'coderabbitai[bot]',
      head: '',
      state: 'PENDING',
      body: '',
      submittedAt: undefined,
    });
    expect(codeRabbitLifecycle(snapshot).lifecycle).toBe('running');
  });
  test.each(['Review paused', 'Review skipped', 'All checks passed', 'Review in progress'])(
    'green "%s" is not completion',
    (description) => {
      const snapshot = incrementalReviewSnapshot();
      snapshot.statuses = [
        {
          ...snapshot.statuses[0],
          id: 10,
          login: 'coderabbitai[bot]',
          context: 'CodeRabbit',
          state: 'success',
          description,
          updatedAt: '2026-10-05T03:00:00Z',
        },
      ];
      expect(codeRabbitLifecycle(snapshot).lifecycle).not.toBe('completed');
    },
  );
  test.each([
    '',
    reviewedBody(OLD_REVIEW_HEAD),
    'Review completed',
    '<!-- change_assessment_commit:invalid -->',
    reviewedBody().replace('"reviewed"', '"skipped"'),
    reviewedBody() + reviewedBody(),
    `${reviewedBody()}<!-- review_in_progress -->`,
    reviewedBody().replace('"coveredCommitId":', '"unknownField":'),
  ])('missing or malformed coverage fails closed %#', (body) => {
    const snapshot = incrementalReviewSnapshot();
    const summary = snapshot.comments[0];
    if (!summary) {
      throw new Error('fixture');
    }
    summary.body = body;
    expect(codeRabbitLifecycle(snapshot).lifecycle).not.toBe('completed');
  });
  test('bot-looking human coverage and statuses cannot authorize completion', () => {
    for (const target of ['comments', 'statuses'] as const) {
      const snapshot = incrementalReviewSnapshot();
      for (const item of snapshot[target]) {
        item.login = 'coderabbitai-impersonator';
      }
      expect(codeRabbitLifecycle(snapshot).lifecycle).not.toBe('completed');
    }
  });
  test('drafts, stale summaries and newer running cycles invalidate previous completion', () => {
    const draft = incrementalReviewSnapshot();
    draft.draft = true;
    expect(codeRabbitLifecycle(draft).lifecycle).toBe('unknown');
    expect(codeRabbitLifecycle(runningReviewSnapshot()).lifecycle).toBe('running');
    const stale = incrementalReviewSnapshot();
    stale.head = OLD_REVIEW_HEAD;
    // Old formal evidence predates the newer pending current-cycle status.
    stale.reviews = [];
    expect(codeRabbitLifecycle(stale).lifecycle).not.toBe('completed');
    const oldApproval = formalReviewSnapshot();
    oldApproval.statuses = runningReviewSnapshot().statuses;
    const approval = oldApproval.reviews[0];
    if (!approval) {
      throw new Error('fixture');
    }
    approval.submittedAt = '2026-10-05T02:00:00Z';
    expect(codeRabbitLifecycle(oldApproval).lifecycle).toBe('running');
  });
  test('pending or dismissed current reviews cannot be papered over by sticky completion', () => {
    for (const state of ['PENDING', 'DISMISSED']) {
      const snapshot = formalReviewSnapshot();
      const review = snapshot.reviews[0];
      if (!review) {
        throw new Error('fixture');
      }
      review.state = state;
      snapshot.comments = incrementalReviewSnapshot().comments;
      snapshot.statuses = incrementalReviewSnapshot().statuses;
      expect(codeRabbitLifecycle(snapshot).lifecycle).not.toBe('completed');
    }
  });
  test('a sticky edit changes activity without changing count; human activity does not', () => {
    const snapshot = incrementalReviewSnapshot();
    const before = codeRabbitRevision(snapshot);
    snapshot.comments.push({
      id: 'human',
      login: 'someone',
      body: 'Hi',
      createdAt: '2026-10-05T03:00:00Z',
      updatedAt: '2026-10-05T03:00:00Z',
    });
    expect(codeRabbitRevision(snapshot)).toBe(before);
    const summary = snapshot.comments[0];
    if (!summary) {
      throw new Error('fixture');
    }
    summary.body += '\nEdited';
    expect(codeRabbitRevision(snapshot)).not.toBe(before);
  });
});

describe('thread disposition, not historical comment counts', () => {
  test('preserves resolved, outdated and unresolved historical discussions separately', () => {
    const snapshot = incrementalReviewSnapshot();
    snapshot.threads = [
      reviewThread('current'),
      { ...reviewThread('historical'), head: OLD_REVIEW_HEAD },
      { ...reviewThread('resolved'), resolved: true },
      { ...reviewThread('outdated'), outdated: true },
      { ...reviewThread('null-line'), line: undefined },
      { ...reviewThread('human'), login: 'other' },
    ];
    expect(codeRabbitFindings(snapshot)).toMatchObject({
      actionableCount: 1,
      historicalCount: 1,
      resolvedCount: 1,
      outdatedCount: 2,
      unresolvedCount: 4,
    });
  });
  test.each([runningReviewSnapshot, incrementalReviewSnapshot])(
    'empty findings never claim a clean review %#',
    async (factory) => {
      const report = await reviewFindingsReport(factory());
      expect(report.content[0]?.text).toContain('not clean-review evidence');
      expect(report.content[0]?.text).toContain('Completion is not approval');
    },
  );
});
