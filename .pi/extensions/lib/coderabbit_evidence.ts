// .pi/extensions/lib/coderabbit_evidence.ts

/** GitHub-owned identity fields, never identities inferred from comment bodies. */
export const isCodeRabbit = (login: unknown): boolean =>
  login === 'coderabbitai' || login === 'coderabbitai[bot]';

/** External JSON is narrowed before any evidence is used. */
export const isReviewRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Normalized, fully paginated GitHub review evidence for one pinned head. */
export type CodeRabbitSnapshot = {
  number: number;
  repository: string;
  head: string;
  branch: string;
  draft: boolean;
  reviews: ReviewEvidence[];
  comments: CommentEvidence[];
  statuses: StatusEvidence[];
  threads: ThreadEvidence[];
};
/** Formal verdicts are kept separate from provider completion. */
export type ReviewEvidence = {
  id: string;
  login: string;
  head: string;
  state: string;
  body: string;
  submittedAt?: string;
};
/** Sticky comments carry updatedAt as well as body revisions. */
export type CommentEvidence = {
  id: string;
  login: string;
  body: string;
  createdAt: string;
  updatedAt: string;
};
/** Statuses come from the exact commit endpoint, not the combined green result. */
export type StatusEvidence = {
  id: number;
  login: string;
  context: string;
  state: string;
  description: string;
  updatedAt: string;
};
/** One finding per root review thread; bot replies are not additional findings. */
export type ThreadEvidence = {
  id: string;
  login: string;
  body: string;
  head: string;
  path: string;
  line?: number;
  updatedAt: string;
  resolved: boolean;
  outdated: boolean;
};
/** Completion never fabricates a GitHub approval or comment verdict. */
export type CodeRabbitLifecycle = {
  head: string;
  lifecycle: 'unknown' | 'running' | 'paused' | 'rate-limited' | 'completed' | 'skipped' | 'failed';
  source?: 'formal-review' | 'status-and-coverage';
  verdict?: string;
  completedAt?: string;
};

const timestamp = (value?: string): number => {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
};

// Provider-private markers are deliberately isolated. Missing, duplicated, changed,
// or malformed coverage must fail closed, even if the status is green.
const reviewedCoverage = (options: { body: string; head: string }): boolean => {
  const assessment = [...options.body.matchAll(/<!--\s*change_assessment_commit:(.*?)\s*-->/g)];
  const coverage = [...options.body.matchAll(/<!--\s*final_review_risk_coverage:(.*?)\s*-->/g)];
  if (assessment.length !== 1 || coverage.length !== 1) {
    return false;
  }
  try {
    const assessed: unknown = JSON.parse(assessment[0]?.[1] ?? '');
    const covered: unknown = JSON.parse(coverage[0]?.[1] ?? '');
    return (
      assessed === options.head &&
      isReviewRecord(covered) &&
      covered.sourceCommitId === options.head &&
      covered.coveredCommitId === options.head &&
      covered.kind === 'reviewed'
    );
  } catch {
    return false;
  }
};

const statusLifecycle = (status: StatusEvidence): CodeRabbitLifecycle['lifecycle'] => {
  const description = status.description.trim().toLowerCase();
  if (/rate.?limit|quota|usage limit/.test(description)) {
    return 'rate-limited';
  }
  if (description === 'review paused') {
    return 'paused';
  }
  if (/\bskipped\b/.test(description)) {
    return 'skipped';
  }
  if (status.state === 'error' || status.state === 'failure') {
    return 'failed';
  }
  if (status.state === 'pending') {
    return 'running';
  }
  return 'unknown';
};

const formalCompletion = (options: {
  head: string;
  review?: ReviewEvidence;
}): CodeRabbitLifecycle => {
  const base: CodeRabbitLifecycle = { head: options.head, lifecycle: 'unknown' };
  if (!options.review) {
    return base;
  }
  if (/review (?:was )?skipped/i.test(options.review.body)) {
    return { ...base, lifecycle: 'skipped' };
  }
  return {
    ...base,
    lifecycle: 'completed',
    source: 'formal-review',
    verdict: options.review.state,
    completedAt: options.review.submittedAt,
  };
};

const hasReviewedSummary = (options: {
  snapshot: CodeRabbitSnapshot;
  status: StatusEvidence;
}): boolean => {
  // Select the latest coverage-bearing summary before validating it: an older
  // valid sticky comment cannot hide a newer malformed/skipped provider revision.
  const summary = options.snapshot.comments
    .filter(
      (item) =>
        isCodeRabbit(item.login) &&
        /<!--\s*(?:change_assessment_commit|final_review_risk_coverage):/.test(item.body),
    )
    .sort((first, second) => timestamp(first.updatedAt) - timestamp(second.updatedAt))
    .at(-1);
  if (!summary) {
    return false;
  }
  return (
    Number.isFinite(timestamp(summary.updatedAt)) &&
    timestamp(summary.updatedAt) >= timestamp(options.status.updatedAt) &&
    !/<!--\s*(?:review_in_progress|in[_-]progress)/i.test(summary.body) &&
    reviewedCoverage({ body: summary.body, head: options.snapshot.head })
  );
};

const statusCompletion = (options: {
  snapshot: CodeRabbitSnapshot;
  status: StatusEvidence;
  review?: ReviewEvidence;
}): CodeRabbitLifecycle => {
  const base: CodeRabbitLifecycle = { head: options.snapshot.head, lifecycle: 'unknown' };
  if (
    options.status.state !== 'success' ||
    options.status.description.trim().toLowerCase() !== 'review completed'
  ) {
    return { ...base, lifecycle: statusLifecycle(options.status) };
  }
  if (hasReviewedSummary(options)) {
    return {
      ...base,
      lifecycle: 'completed',
      source: 'status-and-coverage',
      // Preserve an actual same-head GitHub verdict; never borrow one from an old head.
      verdict: formalCompletion({ head: options.snapshot.head, review: options.review }).verdict,
      completedAt: options.status.updatedAt,
    };
  }
  // A matching formal review is independently valid; green status alone isn't.
  return formalCompletion({ head: options.snapshot.head, review: options.review });
};

const isCurrentReview = (options: { review: ReviewEvidence; head: string }): boolean =>
  isCodeRabbit(options.review.login) &&
  (options.review.head === options.head ||
    (options.review.head === '' && options.review.state === 'PENDING'));

/** Reduce current-head evidence conservatively, with newer statuses invalidating old reviews. */
export const codeRabbitLifecycle = (snapshot: CodeRabbitSnapshot): CodeRabbitLifecycle => {
  const base: CodeRabbitLifecycle = { head: snapshot.head, lifecycle: 'unknown' };
  if (snapshot.draft) {
    return base;
  }
  const review = snapshot.reviews
    .filter((item) => isCurrentReview({ review: item, head: snapshot.head }))
    .sort((first, second) => timestamp(first.submittedAt) - timestamp(second.submittedAt))
    .at(-1);
  const status = snapshot.statuses
    .filter((item) => isCodeRabbit(item.login) && item.context === 'CodeRabbit')
    .sort(
      (first, second) =>
        timestamp(first.updatedAt) - timestamp(second.updatedAt) || first.id - second.id,
    )
    .at(-1);
  const reviewTime = review ? timestamp(review.submittedAt) : 0;
  // An undated pending/dismissed review cannot authorize fallback completion.
  if (
    review &&
    (!Number.isFinite(reviewTime) ||
      !['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED'].includes(review.state))
  ) {
    return { ...base, lifecycle: review.state === 'PENDING' ? 'running' : 'unknown' };
  }
  if (
    review &&
    /review (?:was )?skipped/i.test(review.body) &&
    (!status || timestamp(status.updatedAt) <= reviewTime)
  ) {
    return { ...base, lifecycle: 'skipped' };
  }
  if (status && (!review || timestamp(status.updatedAt) >= reviewTime)) {
    return statusCompletion({ snapshot, status, review });
  }
  return formalCompletion({ head: snapshot.head, review });
};

/** Classify all bot threads without silently dropping unresolved old-head discussion. */
export const codeRabbitFindings = (snapshot: CodeRabbitSnapshot) => {
  const findings = snapshot.threads
    .filter((thread) => isCodeRabbit(thread.login))
    .map((thread) => {
      let disposition: 'current' | 'historical' | 'resolved' | 'outdated';
      if (thread.resolved) {
        disposition = 'resolved';
      } else if (thread.outdated || thread.line === undefined) {
        disposition = 'outdated';
      } else {
        disposition = thread.head === snapshot.head ? 'current' : 'historical';
      }
      return { ...thread, disposition };
    });
  const count = (disposition: string) =>
    findings.filter((finding) => finding.disposition === disposition).length;
  return {
    findings,
    actionableCount: count('current'),
    historicalCount: count('historical'),
    resolvedCount: count('resolved'),
    outdatedCount: count('outdated'),
    // Even an outdated unresolved thread still needs human disposition for merge.
    unresolvedCount: findings.filter((finding) => !finding.resolved).length,
  };
};

/** Versioned bot-only activity detects sticky edits, not unrelated human chatter. */
export const codeRabbitRevision = (snapshot: CodeRabbitSnapshot): string =>
  JSON.stringify({
    head: snapshot.head,
    draft: snapshot.draft,
    reviews: snapshot.reviews.filter((item) => isCodeRabbit(item.login)),
    comments: snapshot.comments.filter((item) => isCodeRabbit(item.login)),
    statuses: snapshot.statuses.filter(
      (item) => isCodeRabbit(item.login) && item.context === 'CodeRabbit',
    ),
    threads: snapshot.threads.filter((item) => isCodeRabbit(item.login)),
  });
