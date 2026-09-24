// scripts/src/lib/agents/subagents/review_policy.ts
//
// Should CodeRabbit review a subagent's PR? Pure decision function — the
// supervisor feeds it the diff and the review ledger; tests feed it fixtures.
//
// 🔴 The decision must be made BEFORE the PR is opened: .coderabbit.yaml has
// `auto_review.enabled: true` for PRs into main, so "skip" is implemented by
// putting `@coderabbitai ignore` in the PR body at creation time. Deciding
// afterwards would already have spent a review.

import type { ReviewMode } from './types.ts';

export type DiffFile = { path: string; added: number; removed: number };

export type ReviewPolicyInput = {
  mode: ReviewMode;
  files: DiffFile[];
  /** Epoch ms of the last CodeRabbit review a subagent requested (ledger). */
  lastReviewAt?: number;
  now: number;
  cooldownMs?: number;
  maxFiles?: number;
  minLines?: number;
};

export type ReviewDecision = { review: boolean; reason: string };

export const DEFAULT_COOLDOWN_MS = 60 * 60_000;
export const DEFAULT_MAX_FILES = 100;
export const DEFAULT_MIN_LINES = 20;

const LOW_SIGNAL = [
  /\.(md|mdx|txt)$/i,
  /(^|\/)bun\.lock$/,
  /\.lockb?$/,
  /(^|\/)(dist|build|generated|\.svelte-kit)\//,
  /\.snap$/,
];

const isLowSignal = (path: string): boolean => LOW_SIGNAL.some((re) => re.test(path));

export const decideReview = (input: ReviewPolicyInput): ReviewDecision => {
  if (input.mode === 'never') {
    return { review: false, reason: 'review disabled (review: never)' };
  }
  if (input.mode === 'always') {
    return { review: true, reason: 'review forced (review: always)' };
  }

  const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES;
  const minLines = input.minLines ?? DEFAULT_MIN_LINES;
  const cooldownMs = input.cooldownMs ?? DEFAULT_COOLDOWN_MS;

  if (input.files.length === 0) {
    return { review: false, reason: 'empty diff' };
  }
  if (input.files.length > maxFiles) {
    return {
      review: false,
      reason: `${input.files.length} files changed (> ${maxFiles}) — sweep-sized diffs get shallow reviews; rely on CI`,
    };
  }
  const substantive = input.files.filter((f) => !isLowSignal(f.path));
  if (substantive.length === 0) {
    return { review: false, reason: 'docs/lockfile/generated-only change' };
  }
  const lines = substantive.reduce((sum, f) => sum + f.added + f.removed, 0);
  if (lines < minLines) {
    return { review: false, reason: `trivial change (${lines} substantive lines < ${minLines})` };
  }
  if (input.lastReviewAt !== undefined && input.now - input.lastReviewAt < cooldownMs) {
    const mins = Math.ceil((cooldownMs - (input.now - input.lastReviewAt)) / 60_000);
    return {
      review: false,
      reason: `review cooldown — last subagent review ${Math.floor((input.now - input.lastReviewAt) / 60_000)} min ago (${mins} min left)`,
    };
  }
  return {
    review: true,
    reason: `${substantive.length} files / ${lines} substantive lines`,
  };
};

/** Parse `git diff --numstat` output. Binary files report `-` counts. */
export const parseNumstat = (text: string): DiffFile[] =>
  text
    .split('\n')
    .map((line) => line.split('\t'))
    .filter((cols) => cols.length >= 3 && cols[2])
    .map((cols) => ({
      path: cols[2] ?? '',
      added: Number.parseInt(cols[0] ?? '0', 10) || 0,
      removed: Number.parseInt(cols[1] ?? '0', 10) || 0,
    }));

/** Marker CodeRabbit honours in a PR description to skip the review. */
export const CODERABBIT_IGNORE = '@coderabbitai ignore';
