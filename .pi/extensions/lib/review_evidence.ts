// .pi/extensions/lib/review_evidence.ts

import { type GhResult, runGh } from './gh.ts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const CHECK_BUCKETS = new Set(['pending', 'pass', 'fail', 'skipping', 'cancel']);
const COMPLETED_REVIEW_STATES = new Set(['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED']);

/** Unknown or missing CI evidence must never be interpreted as completed checks. */
export const summarizeCheckCompletion = (result: GhResult): { pendingCount: number } => {
  if (!result.success || !Array.isArray(result.json) || result.json.length === 0) {
    throw new Error(
      `Cannot establish CI check completion: ${result.text || result.stderr || 'no checks returned'}`,
    );
  }
  let pendingCount = 0;
  for (const check of result.json) {
    if (!isRecord(check) || typeof check.bucket !== 'string' || !CHECK_BUCKETS.has(check.bucket)) {
      throw new Error('Cannot establish CI check completion: malformed check evidence');
    }
    if (check.bucket === 'pending') {
      pendingCount++;
    }
  }
  if (result.code === 8 && pendingCount === 0) {
    throw new Error(
      'Cannot establish CI check completion: pending exit code without pending checks',
    );
  }
  return { pendingCount };
};

/** Read and validate PR metadata before any review/autofix side effect. */
export const readReadyPrSnapshot = async (options: {
  pr: string;
  signal?: AbortSignal;
  readSnapshot?: () => Promise<GhResult>;
}): Promise<{ headRefOid: string; headRefName: string }> => {
  const readSnapshot =
    options.readSnapshot ??
    (() =>
      runGh(['pr', 'view', options.pr, '--json', 'headRefOid,headRefName,isDraft,reviews'], {
        parseJson: true,
        signal: options.signal,
      }));
  const result = await readSnapshot();
  const value = result.json;
  if (!result.success || !isRecord(value) || typeof value.isDraft !== 'boolean') {
    throw new Error(
      `Cannot establish PR metadata: ${result.text || result.stderr || 'malformed snapshot'}`,
    );
  }
  if (value.isDraft) {
    throw new Error(
      `PR #${options.pr} is draft. Validate and promote it before requesting CodeRabbit review.`,
    );
  }
  currentCodeRabbitReviewState(value);
  if (
    typeof value.headRefOid !== 'string' ||
    typeof value.headRefName !== 'string' ||
    !value.headRefName
  ) {
    throw new Error('Cannot establish PR metadata: missing head or branch');
  }
  return { headRefOid: value.headRefOid, headRefName: value.headRefName };
};

/** An absent summary is unknown findings, not a clean review. */
export const parseActionableCount = (body: string): number | undefined => {
  const match = body.match(/Actionable comments posted:\s*(?:\*\*)?(\d+)/i);
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
};

/** Describe autofix outcome without turning skips or missing findings into approval. */
export const describeAutofixOutcome = (options: {
  rateLimited: boolean;
  skipped: boolean;
  actionableCount?: number;
}): string => {
  if (options.rateLimited) {
    return '⚠️ CodeRabbit is rate-limited — autofix could not run.';
  }
  if (options.skipped) {
    return 'No autofix changes applied; skipped autofix is not clean-review evidence.';
  }
  if (options.actionableCount === undefined) {
    return '⚠️ Unknown count of actionable comments — inspect findings manually.';
  }
  if (options.actionableCount > 0) {
    return `⚠️ ${options.actionableCount} actionable comments — inspect findings manually.`;
  }
  return 'No autofix changes applied; verify findings and CI before merging.';
};

/** Passing CI requires structured evidence, including at least one executed check. */
export const haveChecksPassed = (result: GhResult): boolean => {
  const { pendingCount } = summarizeCheckCompletion(result);
  if (pendingCount > 0 || !Array.isArray(result.json)) {
    return false;
  }
  return (
    result.json.some((check) => isRecord(check) && check.bucket === 'pass') &&
    result.json.every(
      (check) => isRecord(check) && (check.bucket === 'pass' || check.bucket === 'skipping'),
    )
  );
};

const reviewTimestamp = (value: unknown): number => {
  if (!isRecord(value) || typeof value.submittedAt !== 'string') {
    return Number.POSITIVE_INFINITY;
  }
  const timestamp = Date.parse(value.submittedAt);
  return Number.isFinite(timestamp) ? timestamp : Number.POSITIVE_INFINITY;
};

/** Only the newest CodeRabbit review of the current, non-draft head is evidence. */
export const currentCodeRabbitReviewState = (value: unknown): string => {
  if (
    !isRecord(value) ||
    typeof value.headRefOid !== 'string' ||
    value.headRefOid.length === 0 ||
    !Array.isArray(value.reviews)
  ) {
    throw new Error('Cannot establish CodeRabbit review state: missing or malformed PR snapshot');
  }
  if (value.isDraft === true) {
    return '';
  }
  const reviews = value.reviews.filter(
    (review) =>
      isRecord(review) &&
      isRecord(review.author) &&
      (review.author.login === 'coderabbitai' || review.author.login === 'coderabbitai[bot]'),
  );
  // Pending/undated reviews sort last and cannot authorize completion.
  reviews.sort((first, second) => reviewTimestamp(first) - reviewTimestamp(second));
  const latest: unknown = reviews.at(-1);
  if (
    !isRecord(latest) ||
    !Number.isFinite(reviewTimestamp(latest)) ||
    !isRecord(latest.commit) ||
    latest.commit.oid !== value.headRefOid ||
    typeof latest.state !== 'string' ||
    !COMPLETED_REVIEW_STATES.has(latest.state)
  ) {
    return '';
  }
  if (typeof latest.body === 'string' && /review (?:was )?skipped/i.test(latest.body)) {
    throw new Error(
      'CodeRabbit skipped the current-head review; inspect eligibility and request a real review before retrying.',
    );
  }
  return latest.state;
};
