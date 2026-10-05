// .pi/extensions/lib/review_pinned_checks.ts

import { isReviewRecord } from './coderabbit_evidence.ts';
import { type GhResult, runGh } from './gh.ts';

type CheckEvidence = { name: string; bucket: string };
type CommitStatus = { id: number; context: string; updatedAt: number; state: string };

const bucketForCheck = (check: Record<string, unknown>): string => {
  if (typeof check.status !== 'string') {
    throw new Error('Malformed pinned CI check status');
  }
  if (check.status !== 'completed') {
    return 'pending';
  }
  if (check.conclusion === 'success') {
    return 'pass';
  }
  if (check.conclusion === 'skipped' || check.conclusion === 'neutral') {
    return 'skipping';
  }
  if (typeof check.conclusion !== 'string') {
    throw new Error('Malformed pinned CI check conclusion');
  }
  return 'fail';
};

const evidenceId = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new Error('Malformed pinned CI evidence ID');
  }
  return value;
};

const parseRunPage = (value: unknown) => {
  if (
    !isReviewRecord(value) ||
    !Array.isArray(value.check_runs) ||
    typeof value.total_count !== 'number' ||
    !Number.isSafeInteger(value.total_count) ||
    value.total_count < 0
  ) {
    throw new Error('Malformed pinned CI check runs or total count');
  }
  return { runs: value.check_runs, total: value.total_count };
};

const parseCheck = (options: { value: unknown; head: string }) => {
  const run = options.value;
  if (!isReviewRecord(run) || run.head_sha !== options.head || typeof run.name !== 'string') {
    throw new Error('Missing or mismatched pinned CI head');
  }
  return { id: evidenceId(run.id), name: run.name, bucket: bucketForCheck(run) };
};

const checkRunEvidence = (options: { pages: unknown[]; head: string }): CheckEvidence[] => {
  const seen = new Set<number>();
  let total: number | undefined;
  const checks: CheckEvidence[] = [];
  for (const rawPage of options.pages) {
    const page = parseRunPage(rawPage);
    total ??= page.total;
    if (total !== page.total) {
      throw new Error('Pinned CI total changed during pagination; retry');
    }
    for (const rawRun of page.runs) {
      const run = parseCheck({ value: rawRun, head: options.head });
      if (seen.has(run.id)) {
        throw new Error('Duplicated pinned CI check-run page');
      }
      seen.add(run.id);
      if (!/coderabbit/i.test(run.name)) {
        checks.push({ name: run.name, bucket: run.bucket });
      }
    }
  }
  if (total === undefined || seen.size !== total) {
    throw new Error('Incomplete pinned CI pagination; findings cannot authorize merge');
  }
  return checks;
};

const parseStatus = (value: unknown): CommitStatus => {
  if (
    !isReviewRecord(value) ||
    typeof value.context !== 'string' ||
    typeof value.updated_at !== 'string' ||
    !Number.isFinite(Date.parse(value.updated_at)) ||
    typeof value.state !== 'string' ||
    !['pending', 'success', 'failure', 'error'].includes(value.state)
  ) {
    throw new Error('Malformed pinned CI status');
  }
  return {
    id: evidenceId(value.id),
    context: value.context,
    updatedAt: Date.parse(value.updated_at),
    state: value.state,
  };
};

const latestStatuses = (pages: unknown[]): CommitStatus[] => {
  const latest = new Map<string, CommitStatus>();
  const seen = new Set<number>();
  for (const page of pages) {
    if (!Array.isArray(page)) {
      throw new Error('Malformed pinned CI status page');
    }
    for (const value of page) {
      const status = parseStatus(value);
      if (seen.has(status.id)) {
        throw new Error('Duplicated pinned CI status page');
      }
      seen.add(status.id);
      const previous = latest.get(status.context);
      if (
        !previous ||
        status.updatedAt > previous.updatedAt ||
        (status.updatedAt === previous.updatedAt && status.id > previous.id)
      ) {
        latest.set(status.context, status);
      }
    }
  }
  return [...latest.values()];
};

const statusBuckets: Record<string, string> = {
  pending: 'pending',
  success: 'pass',
  failure: 'fail',
  error: 'fail',
};

/** Validate advertised totals and unique IDs before accepting any page as passing CI. */
export const pinnedCheckEvidence = (options: {
  runs: unknown;
  statuses: unknown;
  head: string;
}): GhResult => {
  if (!Array.isArray(options.runs) || !Array.isArray(options.statuses)) {
    throw new Error('Missing pinned CI evidence');
  }
  const checks = checkRunEvidence({ pages: options.runs, head: options.head });
  const statuses = latestStatuses(options.statuses)
    .filter((status) => !/coderabbit/i.test(status.context))
    .map((status) => ({ name: status.context, bucket: statusBuckets[status.state] ?? 'fail' }));
  return { success: true, code: 0, text: '', json: [...checks, ...statuses] };
};

/** Merge gates read check runs and statuses from the pinned SHA, never the moving PR head. */
export const queryPinnedChecks = async (options: {
  repository: string;
  head: string;
  signal?: AbortSignal;
}): Promise<GhResult> => {
  const [runs, statuses] = await Promise.all([
    runGh(
      [
        'api',
        `repos/${options.repository}/commits/${options.head}/check-runs?per_page=100&filter=latest`,
        '--paginate',
        '--slurp',
      ],
      { signal: options.signal, parseJson: true },
    ),
    runGh(
      [
        'api',
        `repos/${options.repository}/commits/${options.head}/statuses?per_page=100`,
        '--paginate',
        '--slurp',
      ],
      { signal: options.signal, parseJson: true },
    ),
  ]);
  options.signal?.throwIfAborted();
  if (!runs.success || !statuses.success) {
    throw new Error(`Cannot establish pinned CI: ${runs.text || statuses.text}`);
  }
  return pinnedCheckEvidence({ runs: runs.json, statuses: statuses.json, head: options.head });
};
