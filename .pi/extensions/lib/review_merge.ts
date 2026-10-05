// .pi/extensions/lib/review_merge.ts

import {
  type CodeRabbitSnapshot,
  codeRabbitFindings,
  codeRabbitLifecycle,
} from './coderabbit_evidence.ts';
import { type GhResult, runGh } from './gh.ts';
import { haveChecksPassed } from './review_evidence.ts';

/** Merge only on fresh approval, known-zero findings, passing CI and a pinned head. */
export const mergeReviewedHead = async (options: {
  requested?: boolean;
  actionableCount?: number;
  pr: string;
  head: string;
  signal?: AbortSignal;
  report: (line: string) => void;
  readReviewState: () => Promise<string>;
  /** Approval, lifecycle, head and findings must come from one final validated snapshot. */
  readDisposition: () => Promise<CodeRabbitSnapshot>;
  /** Callers must supply exact-SHA CI; moving-PR checks cannot authorize merge. */
  queryChecks: () => Promise<GhResult>;
  mergeHead?: (args: string[]) => Promise<GhResult>;
}): Promise<boolean> => {
  if (!options.requested || options.actionableCount !== 0 || options.signal?.aborted) {
    return false;
  }
  if ((await options.readReviewState()) !== 'APPROVED') {
    return false;
  }
  if (!haveChecksPassed(await options.queryChecks()) || options.signal?.aborted) {
    options.report('⚠️ CI is not passing; merge was not attempted.');
    return false;
  }
  if ((await options.readReviewState()) !== 'APPROVED' || options.signal?.aborted) {
    return false;
  }
  const finalSnapshot = await options.readDisposition();
  if (
    finalSnapshot.draft ||
    finalSnapshot.head !== options.head ||
    codeRabbitLifecycle(finalSnapshot).verdict !== 'APPROVED' ||
    codeRabbitFindings(finalSnapshot).unresolvedCount !== 0
  ) {
    options.report('⚠️ Approval, head or unresolved findings changed; merge was not attempted.');
    return false;
  }
  options.signal?.throwIfAborted();
  options.report('🚀 Current review approved and CI passed — merging pinned head...');
  const mergeHead = options.mergeHead ?? ((args) => runGh(args, { signal: options.signal }));
  const result = await mergeHead([
    'pr',
    'merge',
    options.pr,
    '--squash',
    '--delete-branch',
    '--match-head-commit',
    options.head,
  ]);
  if (!result.success) {
    throw new Error(`Merge was not confirmed: ${result.text}`);
  }
  options.report(`✅ Merged PR #${options.pr}`);
  return true;
};
