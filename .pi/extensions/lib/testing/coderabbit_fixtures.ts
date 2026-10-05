// .pi/extensions/lib/testing/coderabbit_fixtures.ts

import type { CodeRabbitSnapshot } from '../coderabbit_evidence.ts';

export const REVIEW_HEAD = 'ddc66eaa8e930da9e245d9679ec4b2eb49e8936c';
export const OLD_REVIEW_HEAD = '1fa8b89c544909a9cce03ae2c3bfd03e92609792';
export const reviewedBody = (head = REVIEW_HEAD): string =>
  [
    `<!-- change_assessment_commit:"${head}" -->`,
    `<!-- final_review_risk_coverage:${JSON.stringify({ sourceCommitId: head, coveredCommitId: head, kind: 'reviewed' })} -->`,
    'Historical advisory: Review paused',
  ].join('\n');

export const incrementalReviewSnapshot = (): CodeRabbitSnapshot => ({
  number: 436,
  repository: 'BearlySleeping/aikami',
  head: REVIEW_HEAD,
  branch: 'feature',
  draft: false,
  reviews: [
    {
      id: 'old-review',
      login: 'coderabbitai[bot]',
      head: OLD_REVIEW_HEAD,
      state: 'COMMENTED',
      body: 'Actionable comments posted: 11',
      submittedAt: '2026-10-05T01:19:25Z',
    },
  ],
  statuses: [
    {
      id: 2,
      login: 'coderabbitai[bot]',
      context: 'CodeRabbit',
      state: 'success',
      description: 'Review completed',
      updatedAt: '2026-10-05T02:32:16Z',
    },
    {
      id: 1,
      login: 'coderabbitai[bot]',
      context: 'CodeRabbit',
      state: 'success',
      description: 'Review paused',
      updatedAt: '2026-10-05T02:10:09Z',
    },
  ],
  comments: [
    {
      id: 'sticky',
      login: 'coderabbitai[bot]',
      body: reviewedBody(),
      createdAt: '2026-10-05T01:09:45Z',
      updatedAt: '2026-10-05T02:33:43Z',
    },
  ],
  threads: [],
});

export const runningReviewSnapshot = (): CodeRabbitSnapshot => {
  const snapshot = incrementalReviewSnapshot();
  snapshot.statuses = [
    {
      id: 3,
      login: 'coderabbitai[bot]',
      context: 'CodeRabbit',
      state: 'pending',
      description: 'Review in progress',
      updatedAt: '2026-10-05T02:35:00Z',
    },
  ];
  return snapshot;
};

export const formalReviewSnapshot = (): CodeRabbitSnapshot => {
  const snapshot = incrementalReviewSnapshot();
  snapshot.statuses = [];
  snapshot.reviews = [
    {
      id: 'current-review',
      login: 'coderabbitai[bot]',
      head: REVIEW_HEAD,
      state: 'APPROVED',
      body: 'Actionable comments posted: 0',
      submittedAt: '2026-10-05T02:40:00Z',
    },
  ];
  return snapshot;
};

export const reviewThread = (id = 'thread') => ({
  id,
  login: 'coderabbitai[bot]',
  body: '_🟠 Major_\n\nFix this.',
  head: REVIEW_HEAD,
  path: 'file.ts',
  line: 3,
  updatedAt: '2026-10-05T02:30:00Z',
  resolved: false,
  outdated: false,
});
