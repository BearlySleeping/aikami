// scripts/src/lib/agents/subagents/publish.ts
//
// Post-run publication for WRITE subagents: commit + push the worktree, decide
// CodeRabbit handling from the real diff, open the PR, then (optionally) wait
// for the review and drive autofix. Every step records its outcome in
// state.json so the captain sees exactly how far it got.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openPullRequest, publishWorktree } from '../../herdr/worktree.ts';
import { runGit } from '../git_worktree.ts';
import { runAutofix, waitForReview } from './coderabbit.ts';
import { splitTitle } from './prompt.ts';
import { CODERABBIT_IGNORE, decideReview, parseNumstat } from './review_policy.ts';
import { patchState, runsRoot, writeText } from './store.ts';
import type { ReviewOutcome, SubagentSpec } from './types.ts';

type Report = (line: string) => void;

const ledgerPath = (repoRoot: string): string =>
  join(runsRoot(repoRoot), '.coderabbit-ledger.json');

const readLastReviewAt = (repoRoot: string): number | undefined => {
  const path = ledgerPath(repoRoot);
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const v = (JSON.parse(readFileSync(path, 'utf8')) as { lastReviewAt?: number }).lastReviewAt;
    return typeof v === 'number' ? v : undefined;
  } catch {
    return undefined;
  }
};

const recordReview = (repoRoot: string, at: number): void => {
  writeText(ledgerPath(repoRoot), JSON.stringify({ lastReviewAt: at }));
};

const hasChanges = (checkoutPath: string, base: string): boolean => {
  if (runGit('status --porcelain', { cwd: checkoutPath }).length > 0) {
    return true;
  }
  try {
    return (
      Number.parseInt(runGit(`rev-list --count origin/${base}..HEAD`, { cwd: checkoutPath }), 10) >
      0
    );
  } catch {
    return false;
  }
};

const cooldownMs = (): number | undefined => {
  const raw = Number.parseInt(process.env.SUBAGENT_REVIEW_COOLDOWN_MIN ?? '', 10);
  return Number.isFinite(raw) ? raw * 60_000 : undefined;
};

export const publishRun = async (options: {
  spec: SubagentSpec;
  checkoutPath: string;
  result: string;
  report: Report;
}): Promise<void> => {
  const { spec, checkoutPath, report } = options;
  const { repoRoot, id } = spec;

  if (!hasChanges(checkoutPath, spec.pr.base)) {
    report('No changes to publish — skipping PR');
    patchState(repoRoot, id, { activity: 'no changes — PR skipped' });
    return;
  }

  const { title: agentTitle, body: agentBody } = splitTitle(options.result);
  const title = spec.pr.title ?? agentTitle ?? `chore: ${spec.name}`;

  patchState(repoRoot, id, { status: 'publishing', activity: 'commit + push' });
  const { headBranch, headCommit } = await publishWorktree({
    checkoutPath,
    repoRoot,
    base: spec.pr.base,
    message: title,
    authorName: 'Pi Subagent',
    authorEmail: 'agent@pi.internal',
  });
  report(`Pushed ${headBranch} @ ${headCommit.slice(0, 7)}`);

  const files = parseNumstat(
    runGit(`diff --numstat origin/${spec.pr.base}...HEAD`, { cwd: checkoutPath }),
  );
  const decision = decideReview({
    mode: spec.pr.review,
    files,
    lastReviewAt: readLastReviewAt(repoRoot),
    now: Date.now(),
    cooldownMs: cooldownMs(),
  });
  report(`CodeRabbit: ${decision.review ? 'review' : 'skip'} — ${decision.reason}`);

  const body = [
    agentBody,
    '',
    '---',
    `🤖 Opened by pi subagent \`${id}\` (model \`${spec.model}\`).`,
    `CodeRabbit: ${decision.review ? 'review' : 'skipped'} — ${decision.reason}.`,
    ...(decision.review ? [] : ['', CODERABBIT_IGNORE]),
  ].join('\n');

  const openedAt = Date.now();
  const { prUrl, prNumber } = await openPullRequest({
    headBranch,
    base: spec.pr.base,
    title,
    body,
    draft: spec.pr.draft,
  });
  report(`PR #${prNumber}: ${prUrl}`);
  const review: ReviewOutcome = {
    decision: decision.review ? 'review' : 'skip',
    reason: decision.reason,
  };
  patchState(repoRoot, id, {
    pr: { url: prUrl, number: prNumber, headCommit },
    branch: headBranch,
    review,
    activity: `PR #${prNumber} opened`,
  });

  // Drafts are never auto-reviewed; waiting would only burn the timeout.
  if (!decision.review || spec.pr.draft) {
    return;
  }
  recordReview(repoRoot, openedAt);
  patchState(repoRoot, id, { status: 'reviewing', activity: 'waiting for CodeRabbit' });
  const reviewed = await waitForReview({
    pr: prNumber,
    since: openedAt,
    timeoutMs: spec.pr.reviewTimeoutMs,
    report,
  });
  Object.assign(review, { state: reviewed.state, findings: reviewed.findings });

  if (!spec.pr.autofix || !reviewed.state || reviewed.findings === 0) {
    review.autofix = 'skipped';
    patchState(repoRoot, id, { review });
    return;
  }
  patchState(repoRoot, id, { review: { ...review, autofix: 'requested' }, activity: 'autofix' });
  Object.assign(review, await runAutofix({ pr: prNumber, report }));
  if (review.autofix === 'committed') {
    // Keep the worktree in sync so the captain reads the fixed code.
    try {
      runGit(`pull --ff-only origin ${headBranch}`, { cwd: checkoutPath });
    } catch {
      report('⚠️ could not fast-forward worktree to the autofix commit');
    }
  }
  patchState(repoRoot, id, { review });
};
