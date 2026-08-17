// scripts/src/lib/agents/contract_pipeline/orchestrator.ts
// biome-ignore-all lint/style/useNamingConvention: pipeline stage identifiers are persisted domain values
import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findWorkspace } from '../../herdr/session.ts';
import {
  publishWorktree,
  removeWorktree,
  WORKTREE_SKIP_WORKTREE_PATHS,
} from '../../herdr/worktree.ts';
import {
  formatInfraNotesForPrompt,
  readInfraIssuesForRun,
  reportInfraIssue,
  setActiveInfraRun,
  summarizeInfraIssues,
} from '../../ops/infra_report.ts';
import { commitAll, pushBranch, remoteBranchExists, runGit } from '../git_worktree.ts';
import { playError } from './alarm.ts';
import { resolveContract } from './contract_resolver.ts';
import { readContractStatus, withUpdatedStatus } from './contract_status.ts';
import {
  commitContractContent,
  currentBranch,
  isolateContractInWorktree,
  pullContractFromWorktree,
} from './contract_sync.ts';
import { captureGitState, currentCommit } from './git_state.ts';
import {
  buildWorkspaceLabel,
  ContractHerdrAdapter,
  type ContractHerdrAdapterInterface,
  ghTokenFilePath,
} from './herdr_adapter.ts';
import {
  acquireLock,
  createManifest,
  pipelineLog,
  readManifest,
  releaseLock,
  runDirectory,
  writeManifest,
} from './manifest_store.ts';
import { validatePostconditions } from './postconditions.ts';
import { loadReviewPrompt, type ReviewProfile } from './prompt_loader.ts';
import { chimeOnFirstResponse } from './review_alarm.ts';
import { roleForStage, runStage } from './stage_runner.ts';
import { MAX_VERIFY_LOOPS, resolveNextStage, transition } from './state_machine.ts';
import type {
  ContractPipelineStage,
  ContractReviewDecision,
  ContractStageResult,
  ReconciliationResult,
  ReviewDecision,
  RunManifest,
} from './types.ts';
import {
  isTerminalStage,
  MAX_AUTOFIX_CYCLES,
  PIPELINE_BASE_BRANCH,
  STATUS_TO_START_STAGE,
} from './types.ts';

/** Hard wall-clock caps — only hit when herdr is unreachable. Working agents never killed. */
const STAGE_HARD_CAPS: Record<string, number> = {
  write_contract: 2 * 60 * 60 * 1000,
  critique: 90 * 60 * 1000,
  implement: 12 * 60 * 60 * 1000,
  verify: 6 * 60 * 60 * 1000,
};
const IDLE_TIMEOUT_MS: number =
  Number(process.env.CONTRACT_STAGE_IDLE_TIMEOUT_MS) || 10 * 60 * 1000;

const WORKER_STAGES: readonly ContractPipelineStage[] = [
  'write_contract',
  'critique',
  'implement',
  'verify',
];

const sleep = async (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Run `gh` with an argv array and return trimmed stdout.
 *
 * 🔴 execFileSync, never execSync with an interpolated/quoted string. On
 * Windows, execSync shells out through cmd.exe, where a single quote is a
 * literal character rather than quoting — every hand-written `'${url}'`
 * this file used to write leaked its quote characters straight into `gh`'s
 * argv (F-02 in the rig audit). That silently broke the PR lookup and made
 * the orchestrator misdiagnose the failure as "no PR found" instead of a
 * shell-quoting bug. execFileSync never invokes a shell, so this closes the
 * whole class rather than one call site.
 */
const ghExec = (args: string[], options: { cwd: string; timeoutMs?: number }): string =>
  execFileSync('gh', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: options.cwd,
    timeout: options.timeoutMs ?? 15_000,
    // Windows: hide the cmd.exe console window (no-op on POSIX).
    windowsHide: true,
  }).trim();

const findPreviousRuns = (options: { contractId: string; cwd: string }): string | undefined => {
  const d = join(options.cwd, '.pi/contract-runs');
  if (!existsSync(d)) {
    return undefined;
  }
  const sid = options.contractId.replace(/[^A-Za-z0-9]/g, '-');
  for (const rid of readdirSync(d)
    .filter((e) => e.startsWith('run-') && e.endsWith(`-${sid}`))
    .sort()
    .reverse()) {
    const m = readManifest({ runId: rid, cwd: options.cwd });
    if (m && !isTerminalStage(m.currentStage)) {
      return rid;
    }
  }
  return undefined;
};

export const verifierFeedback = (options: {
  manifest: RunManifest;
  attempt: number;
}): string | undefined => {
  if (options.attempt <= 1) {
    return undefined;
  }
  const prevImpl = [...options.manifest.attempts]
    .reverse()
    .find((c) => c.role === 'implementer' && c.result);
  const prevVerify = [...options.manifest.attempts]
    .reverse()
    .find((c) => c.role === 'verifier' && c.result);
  // 🔴 If this implement attempt was triggered by a review captain bouncing
  // the run back with `change` — from fallback recovery OR from a live
  // human-in-the-loop review session — its diagnosis (often the product of
  // consulting AskClaude/Opus for a second opinion) is the most current,
  // most specific signal available — more specific than the stale verifier
  // findings that already exhausted the loop once. Without this,
  // `contract_review_decision`'s `summary`/`details` were written to the
  // manifest and then never read again — the captain's diagnosis was
  // discarded and the implementer re-ran blind on the same old findings.
  const reviewChange = options.manifest.reviewDecision?.decision === 'change';
  const reviewFeedback = reviewChange ? options.manifest.reviewDecision?.summary : undefined;
  const reviewDetails = reviewChange ? options.manifest.reviewDecision?.details : undefined;
  if (!prevVerify?.result && !reviewFeedback) {
    return undefined;
  }
  const parts: string[] = [];
  if (reviewFeedback) {
    parts.push('## Review Captain diagnosis', reviewFeedback, '');
    if (reviewDetails) {
      parts.push('### Additional context from the review captain', reviewDetails, '');
    }
  }
  if (prevVerify?.result) {
    parts.push(prevVerify.result.summary);
    parts.push(...prevVerify.result.findings.map((item) => `- ${item}`));
  }
  if (prevImpl?.result) {
    parts.push(
      '',
      'Previous implementer summary:',
      prevImpl.result.summary,
      'Continue from where the previous attempt left off. Do NOT redo already-completed work.',
    );
  }
  return parts.join('\n');
};

const resultForPostconditionFailure = (options: {
  original: ContractStageResult;
  unauthorizedPaths: string[];
}): ContractStageResult => ({
  ...options.original,
  status: 'blocked',
  summary: `Role boundary violation: ${options.unauthorizedPaths.length} unauthorized path(s).`,
  findings: [
    ...options.original.findings,
    `Unauthorized mutations: ${options.unauthorizedPaths.join(', ')}`,
  ],
  filesTouched: [...new Set([...options.original.filesTouched, ...options.unauthorizedPaths])],
});

const enforceStageStatus = (options: {
  stage: ContractPipelineStage;
  result: ContractStageResult;
  contractPath: string;
}): ContractStageResult => {
  if (options.result.status !== 'passed') {
    return options.result;
  }
  const status = readContractStatus(options.contractPath);
  if (options.stage === 'write_contract' && status !== 'draft') {
    return {
      ...options.result,
      status: 'blocked',
      summary: `Writer ended with contract status ${status}; expected draft.`,
      findings: [...options.result.findings, 'Writer crossed the contract lifecycle boundary.'],
    };
  }
  if (options.stage === 'implement' && status !== 'implemented') {
    // Skip — implementer/verifier don't update the main contract.
    // Status is tracked in the run manifest, not the contract file.
    return options.result;
  }
  return options.result;
};

const readReviewDecision = (path: string, runId: string): ContractReviewDecision | undefined => {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ContractReviewDecision>;
    const validDecisions: ReviewDecision[] = ['approve', 'merge', 'change', 'reject'];
    if (
      value.runId !== runId ||
      typeof value.decision !== 'string' ||
      !validDecisions.includes(value.decision) ||
      typeof value.summary !== 'string' ||
      (value.details !== undefined && typeof value.details !== 'string') ||
      typeof value.diffHash !== 'string' ||
      typeof value.contractChanged !== 'boolean' ||
      typeof value.createdAt !== 'string'
    ) {
      return undefined;
    }
    return value as ContractReviewDecision;
  } catch {
    return undefined;
  }
};

/**
 * Thrown when the review pane is closed without recording a decision.
 * Distinct from a 'reject' decision: abandonment must NOT close the PR —
 * the run transitions to blocked with a resume hint instead.
 */
export class ReviewAbandonedError extends Error {
  constructor(summary: string) {
    super(summary);
    this.name = 'ReviewAbandonedError';
  }
}

const waitForReviewDecision = async (options: {
  path: string;
  runId: string;
  /** Polled periodically; return true when the review pane is gone (tab
   *  closed without a decision). Lets the orchestrator stop waiting instead
   *  of spinning forever at 1 Hz holding the contract lock. */
  isPaneAlive?: () => Promise<boolean>;
}): Promise<ContractReviewDecision> => {
  let poll = 0;
  while (true) {
    const d = readReviewDecision(options.path, options.runId);
    if (d) {
      return d;
    }
    poll += 1;
    if (options.isPaneAlive && poll % 30 === 0) {
      const alive = await options.isPaneAlive().catch(() => true);
      if (!alive) {
        // Abandoned review: the tab was closed without a decision. Throw a
        // dedicated signal instead of fabricating a 'reject' decision — a
        // fabricated reject would close the PR in the normal/blocked review
        // paths. The call site transitions to blocked without touching GitHub.
        throw new ReviewAbandonedError(
          'The review tab was closed without a decision. Resume with `bun run contract ' +
            `--resume ${options.runId}\` — the branch and worktree are preserved.`,
        );
      }
    }
    await sleep(1_000);
  }
};

// ── Reconciliation ───────────────────────────────────────────

/**
 * Publish the run's branch for PR creation.
 *
 * Worktree mode: the herdr-native worktree (created by the adapter at
 * initialize time, at ~/.herdr/worktrees/<repo>/<slug>) already carries the
 * `contract-task-{id}-{token}` branch with all implementer/verifier commits.
 * publishWorktree commits remaining changes and pushes — no re-provisioning,
 * no branch rename, no base-restore dance (skip-worktree handles that).
 *
 * Root mode: unchanged — commit + push the root contract branch directly.
 */
const reconcileWorkspace = async (options: {
  manifest: RunManifest;
  repoRoot: string;
  baseBranch?: string;
  rootMode?: boolean;
}): Promise<ReconciliationResult> => {
  const b = options.baseBranch ?? PIPELINE_BASE_BRANCH;
  const rootMode = options.rootMode ?? false;

  if (!rootMode) {
    const checkoutPath = options.manifest.worktreeCheckoutPath;
    if (!checkoutPath || !existsSync(checkoutPath)) {
      throw new Error(
        `Cannot reconcile: worktree checkout missing for ${options.manifest.runId} ` +
          `(path: ${checkoutPath ?? 'unset'}). ` +
          'Resume the run to recover the worktree, or use --root mode.',
      );
    }
    const { headBranch, headCommit } = await publishWorktree({
      checkoutPath,
      repoRoot: options.repoRoot,
      base: b,
      message: `Feat: Contract ${options.manifest.contractId} (run ${options.manifest.runId})`,
      authorName: 'Pi Agent',
      authorEmail: 'agent@pi.internal',
    });
    // publishWorktree may rename the branch on a remote collision — persist
    // the published name so recovery and cleanup use one value.
    options.manifest.worktreeBranch = headBranch;
    return {
      changeId: headCommit,
      bookmarkName: headBranch,
      headBranch,
      baseBranch: b,
      prTitle: `Contract ${options.manifest.contractId}`,
      prBody: '',
    };
  }

  // Root mode: no worktree — the implementation lives in the repo root on
  // the contract branch (e.g. contract/C-372). Commit remaining changes and
  // push that branch directly.
  const workspacePath = options.repoRoot;
  let headBranch: string;
  try {
    headBranch = runGit('rev-parse --abbrev-ref HEAD', { cwd: workspacePath });
  } catch {
    headBranch = `contract/${options.manifest.contractId}`;
  }

  const finalMsg = `Feat: Contract ${options.manifest.contractId} (run ${options.manifest.runId})`;
  const finalCommit = commitAll({
    cwd: workspacePath,
    message: finalMsg,
    authorName: 'Pi Agent',
    authorEmail: 'agent@pi.internal',
    protectedPaths: WORKTREE_SKIP_WORKTREE_PATHS,
  });
  pushBranch({ cwd: workspacePath, branchName: headBranch });

  return {
    changeId: finalCommit,
    bookmarkName: headBranch,
    headBranch,
    baseBranch: b,
    prTitle: `Contract ${options.manifest.contractId}`,
    prBody: '',
  };
};

// ── Blocked summary ─────────────────────────────────────────

const severityIcon = (finding: string): string => {
  const u = finding.toUpperCase();
  if (u.includes('CRITICAL')) {
    return '🔴';
  }
  if (u.includes('MODERATE')) {
    return '🟡';
  }
  return '⚪';
};

const formatBlockedSummary = (manifest: RunManifest): string => {
  const lines: string[] = [];
  const hr = '═══════════════════════════════════════════════════════════';
  lines.push('', hr, `🚫 PIPELINE BLOCKED — ${manifest.contractId}`, hr, '');
  const lastVerifyPassed = [...manifest.attempts]
    .reverse()
    .find((a) => a.stage === 'verify' && a.result?.status === 'passed');
  const lastVerifyLoopHit =
    manifest.verifyLoops >= MAX_VERIFY_LOOPS &&
    manifest.attempts.filter((a) => a.stage === 'verify').length >= MAX_VERIFY_LOOPS;
  if (lastVerifyPassed && !lastVerifyLoopHit) {
    lines.push('Reason: Verification passed, but a post-verify step failed.');
    if (manifest.blockedReason) {
      lines.push(`Details: ${manifest.blockedReason}`);
    }
  } else if (lastVerifyLoopHit) {
    lines.push(
      `Reason: Max verify→implement bounces reached (${manifest.verifyLoops}/${MAX_VERIFY_LOOPS}).`,
    );
  } else if (manifest.blockedReason) {
    lines.push(`Reason: ${manifest.blockedReason}`);
  } else {
    lines.push('Reason: Pipeline blocked — no reason recorded.');
  }
  lines.push('');
  const lastVerify = [...manifest.attempts]
    .reverse()
    .find((a) => a.stage === 'verify' && a.result?.findings?.length);
  if (lastVerify?.result?.findings?.length) {
    lines.push('Last verifier findings:');
    for (const f of lastVerify.result.findings) {
      lines.push(`  ${severityIcon(f)} ${f}`);
    }
    lines.push('');
  }
  const impl = manifest.attempts.filter(
    (a) => a.stage === 'implement' && a.result?.filesTouched?.length,
  );
  if (impl.length > 0) {
    const all = [...new Set(impl.flatMap((a) => a.result?.filesTouched ?? []))].sort();
    lines.push('Files needing fixes:');
    for (const f of all.slice(0, 10)) {
      lines.push(`  📄 ${f}`);
    }
    if (all.length > 10) {
      lines.push(`  ... and ${all.length - 10} more`);
    }
    lines.push('');
  }
  lines.push(
    'Next steps:',
    `  1. Fix the issues above manually in the codebase`,
    `  2. Run:  bun contract ${manifest.contractId} --fresh`,
    `  3. Or reset the contract status to 'implemented' and re-run without --fresh`,
    '',
    hr,
    '',
  );
  return lines.join('\n');
};

/**
 * Pick the review profile for a blocked run.
 *
 * 🔴 Single source of truth: this used to be computed twice (once for the
 * `ReviewProfile` passed to `loadReviewPrompt`, once more via a differently
 * -shaped boolean check to pick which header string to bolt on afterward),
 * and the two could in theory disagree. One function, one decision.
 */
const blockedReviewProfile = (manifest: RunManifest): ReviewProfile => {
  const isLoopExhaustion =
    manifest.verifyLoops >= MAX_VERIFY_LOOPS &&
    manifest.attempts.filter((a) => a.stage === 'verify').length >= MAX_VERIFY_LOOPS;
  if (isLoopExhaustion) {
    return 'fallback_recovery';
  }
  const lastVerifyPassed = [...manifest.attempts]
    .reverse()
    .some((a) => a.stage === 'verify' && a.result?.status === 'passed');
  return lastVerifyPassed ? 'post_verify_failure' : 'fallback_recovery';
};

const buildBlockedReviewPrompt = (options: { manifest: RunManifest; repoRoot: string }): string => {
  const r = options.manifest.reconciliation;
  const profile = blockedReviewProfile(options.manifest);

  const basePrompt = loadReviewPrompt({
    repoRoot: options.repoRoot,
    contractPath: options.manifest.contractPath,
    runId: options.manifest.runId,
    prUrl: undefined,
    // 🔴 Reconciliation never ran (or threw) on either blocked path — fall
    // back to the worktree's own checked-out branch so the injected profile
    // prompt can tell the captain (and findPrUrl() can later discover) the
    // branch it should push/PR from while fixing the block itself.
    headBranch: r?.headBranch ?? options.manifest.worktreeBranch,
    baseBranch: r?.baseBranch,
    profile,
  });
  const summary = formatBlockedSummary(options.manifest);
  return [basePrompt, summary].join('\n');
};

// ── Merge helpers ────────────────────────────────────────────

const syncMainOnMerge = (repoRoot: string): void => {
  const branch = currentBranch(repoRoot);
  if (branch !== 'main' && branch !== 'master') {
    // Root mode (`--root`) leaves the checkout on contract/C-XXX after a
    // merge. Never surprise the user by switching their main working tree
    // — print the exact commands instead of silently doing nothing.
    console.log(
      `\nℹ️  Skipped main sync — repo is on \`${branch ?? 'a detached HEAD'}\` (not main).`,
    );
    console.log('   After the merge, sync manually:');
    console.log('     git checkout main && git pull --ff-only origin main\n');
    return;
  }

  // 🔴 `git pull --ff-only` ABORTS when a locally-modified file would be
  // overwritten by the merge. Detect that up front and name the paths — the
  // old code let the pull throw into a generic warn, so the user only found
  // out when their own `git pull` failed minutes later with no context.
  let dirty = '';
  try {
    dirty = execSync('git status --porcelain --untracked-files=no', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: repoRoot,
      timeout: 10_000,
      // Windows: hide the cmd.exe console window (no-op on POSIX).
      windowsHide: true,
    }).trim();
  } catch {
    // status failed — fall through and let the pull report the real problem.
  }

  if (dirty) {
    console.log('\n⚠️  Skipped main sync — the root checkout has uncommitted changes:\n');
    for (const line of dirty.split('\n').slice(0, 10)) {
      console.log(`     ${line}`);
    }
    console.log('\n   `git pull --ff-only` would abort on these. Commit or stash, then:');
    console.log('     git pull --ff-only origin main\n');
    return;
  }

  try {
    execSync('git pull --ff-only origin main', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: repoRoot,
      timeout: 30000,
      // Windows: hide the cmd.exe console window (no-op on POSIX).
      windowsHide: true,
    });
    console.log('\n📥 Pulled latest main\n');
  } catch (e: unknown) {
    console.warn(
      `⚠️  Could not sync main: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`,
    );
    console.warn('   Sync manually: git pull --ff-only origin main\n');
  }
};

/**
 * Remove the run's worktree + branch on terminal exits where auto-clean
 * applies (merged, or blocked/pr_created with no live review pane).
 */
const cleanupRunWorktree = async (options: {
  adapter: ContractHerdrAdapterInterface;
  manifest: RunManifest;
  repoRoot: string;
}): Promise<void> => {
  const wsPath = options.adapter.getWorkspacePath();
  if (!wsPath) {
    return;
  }
  const branchName = options.manifest.reconciliation?.headBranch;
  // 🔴 `pr_created` leaves an OPEN PR — deleting its head branch closes the
  // PR on GitHub. `blocked` may still hold the implementer's pushed work for
  // recovery (the blocked summary tells the user to fix issues manually).
  // Only delete the remote branch when no PR remains and the work is merged.
  const keepRemoteBranch =
    options.manifest.currentStage === 'pr_created' || options.manifest.currentStage === 'blocked';
  try {
    await removeWorktree({
      checkoutPath: wsPath,
      repoRoot: options.repoRoot,
      branch: keepRemoteBranch ? undefined : branchName,
      deleteRemoteBranch: !keepRemoteBranch,
    });
    console.log(
      `\n🧹 Worktree cleaned${keepRemoteBranch ? ' (remote branch kept)' : ''}: ${branchName ?? 'unknown'}\n`,
    );
  } catch (e: unknown) {
    console.warn(`⚠️  Cleanup failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
  }
};

/**
 * Terminal-exit workspace handling — the single funnel for EVERY way the
 * pipeline ends (merged / pr_created / blocked / crash catch-path).
 *
 * 🔴 Default: KEEP the pipeline workspace alive so the user can read the
 * summary and, for `blocked`, actually act on it (inspect the worktree,
 * fix things, `--resume`). The pane is left exactly as the agent last left
 * it — no completion message is injected (that would cost a full agent
 * turn just to produce a throwaway "ok" reply; the user already sees the
 * outcome from the agent's own last message, e.g. `contract_review_decision`'s
 * result). The user closes the tab manually and cleans up with
 * `bun run workspace:cleanup`. Auto-clean only when nobody can plausibly
 * still be looking at this workspace:
 *   - CONTRACT_PIPELINE_AUTO_CLEANUP=1         → always clean (escape hatch)
 *   - pure YOLO (autofix cycles not exhausted) → clean (no human in the loop)
 *   - merged/pr_created with no live review pane → clean (the PR is the
 *     artifact of record; nothing left to see in the workspace itself)
 *
 * 🔴 `blocked` is ALWAYS kept alive, even when no review pane was ever
 * created — e.g. a Phase 0 preflight failure blocks before `review` even
 * starts. A blocked run is exactly the case where a human is most likely to
 * want to look inside the worktree, and auto-deleting it out from under
 * them (previously: any block-before-review nuked the checkout within
 * seconds of appearing) was the cause of the "workspace randomly
 * disappeared" reports on C-378/C-379. Blocked-but-abandoned workspaces are
 * cleaned up later via `bun run workspace:cleanup`, same as any other
 * preserved run.
 */
const finalizeWorkspace = async (options: {
  adapter: ContractHerdrAdapterInterface;
  manifest: RunManifest;
  repoRoot: string;
  yolo?: boolean;
}): Promise<void> => {
  const { manifest } = options;
  const stage = manifest.currentStage;
  const reviewPaneAlive =
    manifest.reviewPaneId !== undefined &&
    (await options.adapter.isPaneAlive(manifest.reviewPaneId).catch(() => false));
  const pureYolo = options.yolo === true && manifest.autofixCycles < MAX_AUTOFIX_CYCLES;
  const keepAlive =
    process.env.CONTRACT_PIPELINE_AUTO_CLEANUP !== '1' &&
    !pureYolo &&
    (stage === 'blocked' || reviewPaneAlive);

  if (keepAlive) {
    const wsPath = options.adapter.getWorkspacePath();
    const tabDescription = reviewPaneAlive ? 'review tab' : 'pipeline tab';
    console.log(`\n🧘 Workspace preserved — the ${tabDescription} stays open for you.`);
    console.log(`   Read the final summary in the ${tabDescription}, then close it when done.`);
    if (wsPath) {
      console.log(
        `   Manual cleanup: bun run workspace:cleanup${stage === 'merged' ? ' --pr-merged' : ''}\n`,
      );
    } else {
      // Root mode: no worktree — the contract branch stays checked out.
      console.log(
        `   When done, switch back to main: git checkout main && git pull --ff-only origin main\n`,
      );
    }
    pipelineLog({
      runId: manifest.runId,
      cwd: options.repoRoot,
      message: `Pipeline terminal at ${stage}. Workspace preserved. Manual cleanup required.`,
    });
    return;
  }

  // Every non-keepAlive terminal stage funnels through cleanupRunWorktree,
  // which decides remote-branch deletion from the manifest stage.
  await cleanupRunWorktree({ adapter: options.adapter, manifest, repoRoot: options.repoRoot });
};

// ── Main orchestrator ─────────────────────────────────────────

export const runContractPipeline = async (options: {
  repoRoot: string;
  target?: string;
  resumeRunId?: string;
  fresh?: boolean;
  dryRun?: boolean;
  ready?: boolean;
  yolo?: boolean;
  /** When true, the writer stage runs in interactive TUI mode so the user
   *  can chat directly with the writer pi session. */
  interactiveWriter?: boolean;
  /** When true, skip the contract-authoring stages (writer + critique) and
   *  start at implementation (or later, per the contract's status). Used
   *  when the contract already exists and is passed by path or bare C-XXX. */
  skipAuthoring?: boolean;
  /** When true, a `skipAuthoring` run starts at `critique` instead of
   *  `implement`, so a hand-authored contract gets a critic pass before any
   *  code is written. No effect without `skipAuthoring` (the normal writer
   *  flow already runs critique after `write_contract`). */
  critique?: boolean;
  /** When true, use the standard aikami-{mode} herdr workspace and
   *  skip git worktree provisioning. All stages run from the repo root. */
  rootMode?: boolean;
  onReady?: (manifest: RunManifest) => void;
  adapterFactory?: (opts: {
    repoRoot: string;
    runId: string;
    contractId: string;
  }) => ContractHerdrAdapterInterface;
}): Promise<RunManifest> => {
  let resumeRunId = options.resumeRunId;
  if (!resumeRunId && options.target && !options.fresh) {
    const c = resolveContract({ target: options.target, repoRoot: options.repoRoot });
    const f = findPreviousRuns({ contractId: c.id, cwd: options.repoRoot });
    if (f) {
      console.log(`Found incomplete run for ${c.id} - resuming ${f}.`);
      console.log('   (use --fresh to start over)');
      resumeRunId = f;
    }
  }

  let manifest: RunManifest;
  if (resumeRunId) {
    const resumed = readManifest({ runId: resumeRunId, cwd: options.repoRoot });
    if (!resumed) {
      throw new Error(`Run ${resumeRunId} is not a valid v3 manifest.`);
    }
    manifest = resumed;
    manifest.blockedReason = undefined;

    const cs = readContractStatus(manifest.contractPath);
    let contractStage = STATUS_TO_START_STAGE[cs] ?? 'write_contract';
    // Path-sourced contracts skip authoring — a draft contract resumes at
    // implementation, not back to the writer. Use the persisted skipAuthoring
    // decision from the manifest so a draft path-sourced run resumed by run ID
    // without a target remains at implement instead of being reset to write_contract.
    const skipAuthoring = options.skipAuthoring ?? manifest.skipAuthoring;
    // `--critique` keeps the critic pass for a hand-authored contract: the
    // writer is still skipped, but the run enters at `critique` instead of
    // jumping straight to `implement`. The lastCompleted scan below advances
    // past it once critique has passed, so this only affects a fresh entry.
    // When the user supplies an explicit override (true or false), persist it
    // to support older manifests that may not have this field.
    const critique = options.critique ?? manifest.critique;
    // Persist any CLI overrides to the manifest for older manifests or changed options
    let manifestChanged = false;
    if (options.skipAuthoring !== undefined && options.skipAuthoring !== manifest.skipAuthoring) {
      manifest.skipAuthoring = options.skipAuthoring;
      manifestChanged = true;
    }
    if (options.critique !== undefined && options.critique !== manifest.critique) {
      manifest.critique = options.critique;
      manifestChanged = true;
    }
    if (manifestChanged) {
      writeManifest({ manifest, cwd: options.repoRoot });
    }
    if (skipAuthoring && contractStage === 'write_contract') {
      contractStage = critique ? 'critique' : 'implement';
    }
    const stageOrder: ContractPipelineStage[] = [
      'write_contract',
      'critique',
      'implement',
      'verify',
    ];
    const stageAfter: Partial<Record<ContractPipelineStage, ContractPipelineStage>> = {
      write_contract: 'critique',
      critique: 'implement',
      implement: 'verify',
      verify: 'review',
    };
    const lastCompleted = manifest.attempts
      .filter((a) => a.result?.status === 'passed')
      .reduce<ContractPipelineStage | null>((l, a) => {
        const ai = stageOrder.indexOf(a.stage);
        const li = l ? stageOrder.indexOf(l) : -1;
        return ai > li ? a.stage : l;
      }, null);
    const resumeStage = lastCompleted
      ? (stageAfter[lastCompleted] ??
        manifest.attempts[manifest.attempts.length - 1]?.stage ??
        contractStage)
      : contractStage;
    if (resumeStage !== manifest.currentStage) {
      pipelineLog({
        runId: manifest.runId,
        cwd: options.repoRoot,
        message: `Resuming: contract status ${cs} → stage ${resumeStage} (was ${manifest.currentStage}).`,
      });
      manifest.currentStage = resumeStage;
      writeManifest({ manifest, cwd: options.repoRoot });
    }
  } else {
    if (!options.target) {
      throw new Error('A contract ID or path is required for a new run.');
    }
    const contract = resolveContract({ target: options.target, repoRoot: options.repoRoot });
    const baseStart = STATUS_TO_START_STAGE[contract.status] ?? 'write_contract';
    // Path-sourced contracts (existing contract by path or bare C-XXX) skip
    // the authoring stages — draft contracts start at implementation.
    const startStage =
      options.skipAuthoring && baseStart === 'write_contract'
        ? options.critique
          ? 'critique'
          : 'implement'
        : baseStart;
    manifest = createManifest({
      contractId: contract.id,
      contractPath: contract.path,
      baseCommit: currentCommit(options.repoRoot),
      baselineFingerprint: captureGitState(options.repoRoot).fingerprint,
      startStage,
      skipAuthoring: options.skipAuthoring,
      critique: options.critique,
      rootMode: options.rootMode,
    });
    writeManifest({ manifest, cwd: options.repoRoot });
  }
  // Effective root mode: an explicit CLI flag wins; otherwise resume the
  // persisted mode from the manifest so `bun run contract --resume <run-id>`
  // keeps the original --root/--worktree decision.
  const rootMode = options.rootMode ?? manifest.rootMode ?? false;
  // 🔴 Stamp every degradation event recorded from this point on with this
  // run's id (helpers in session/worktree/git_worktree have no run context
  // of their own). The review prompt's infra notes are filtered to this run,
  // so historical gh/worktree/herdr failures from PREVIOUS runs are excluded
  // — only what THIS run worked around is reported.
  setActiveInfraRun(manifest.runId);
  if (options.dryRun) {
    return manifest;
  }

  // Workspace label MUST match ContractHerdrAdapter's — root mode uses the
  // standard aikami-{mode} workspace, worktree mode uses aikami-contract-{id}.
  // A mismatch would make checkWorkspaceAlive always return false in root
  // mode, breaking the lock on a live pipeline.
  const buildWsLabel = (cid: string): string => buildWorkspaceLabel({ contractId: cid, rootMode });
  await acquireLock({
    contractId: manifest.contractId,
    runId: manifest.runId,
    cwd: options.repoRoot,
    checkWorkspaceAlive: async () => {
      try {
        return (await findWorkspace(buildWsLabel(manifest.contractId))) !== null;
      } catch {
        return false;
      }
    },
  });

  const adapter =
    options.adapterFactory?.({
      repoRoot: options.repoRoot,
      runId: manifest.runId,
      contractId: manifest.contractId,
    }) ??
    new ContractHerdrAdapter({
      repoRoot: options.repoRoot,
      runId: manifest.runId,
      contractId: manifest.contractId,
      interactiveWriter: options.interactiveWriter,
      rootMode,
    });

  try {
    pipelineLog({
      runId: manifest.runId,
      cwd: options.repoRoot,
      message: `Initializing Herdr for ${manifest.contractId}.`,
    });
    const ws = await adapter.initialize();
    manifest.workspaceId = ws.workspaceId;
    manifest.pipelinePaneId = ws.pipelinePaneId;
    if (!rootMode) {
      // Persist herdr-native worktree state so resume-after-crash can
      // recover the checkout without re-deriving paths.
      manifest.worktreeWorkspaceId = ws.workspaceId;
      manifest.worktreeCheckoutPath = adapter.getWorkspacePath() || undefined;
      manifest.worktreeBranch = adapter.getWorktreeBranch() || undefined;
    }
    writeManifest({ manifest, cwd: options.repoRoot });
    options.onReady?.(manifest);
    pipelineLog({
      runId: manifest.runId,
      cwd: options.repoRoot,
      message: `Pipeline started at ${manifest.currentStage} for ${manifest.contractId}.`,
    });

    while (
      manifest.currentStage !== 'pr_created' &&
      manifest.currentStage !== 'merged' &&
      manifest.currentStage !== 'blocked'
    ) {
      if (WORKER_STAGES.includes(manifest.currentStage)) {
        const stage = manifest.currentStage;
        const role = roleForStage(stage);
        const attempt = manifest.attempts.filter((e) => e.stage === stage).length + 1;
        const startTime = new Date().toISOString();
        const wPath = adapter.getWorkspacePath();

        // ── Contract isolation — BEFORE the agent runs, for EVERY stage ──
        // Seed the worktree with the root's contract and (re-)apply
        // skip-worktree so the file can never enter the PR diff.
        //
        // Must not be gated on the critique stage: `--source path` runs (a
        // hand-authored contract) skip both authoring stages, so a
        // critique-only gate left those runs unisolated — the implementer's
        // Execution Report rode the PR branch and the root checkout was left
        // dirty, conflicting on the next `git pull` after the merge.
        //
        // Must run BEFORE runStage: the implementer's very first act is to
        // read and append to the contract, and the post-stage `commitAll`
        // (`add -A`) would stage it if the bit were not already set.
        //
        // Idempotent, and re-applied per stage because a checkout/reset
        // inside the worktree clears the skip-worktree bit.
        if (wPath) {
          const isolated = isolateContractInWorktree({
            repoRoot: options.repoRoot,
            worktreePath: wPath,
            contractPath: manifest.contractPath,
          });
          if (!isolated.ok) {
            console.warn(`⚠️  ${isolated.message}`);
          }
        }

        const cwdForGit =
          wPath && (stage === 'implement' || stage === 'verify') ? wPath : options.repoRoot;
        const before = captureGitState(cwdForGit);
        const feedback =
          stage === 'implement' ? verifierFeedback({ manifest, attempt }) : undefined;
        // 🔴 Consume the review captain's `change` decision exactly once, as
        // feedback for THIS implement attempt. `manifest.reviewDecision` is
        // never cleared by `transition()` — left alone, the NEXT time the
        // pipeline reaches `review` (after this implement→verify round
        // trip), `decision = manifest.reviewDecision ?? await
        // waitForReviewDecision(...)` would immediately replay this SAME
        // stale decision instead of waiting for a fresh one from the
        // captain, silently bouncing back to implement forever without ever
        // pausing for a real review.
        if (stage === 'implement' && manifest.reviewDecision?.decision === 'change') {
          manifest.reviewDecision = undefined;
          // 🔴 The review captain's pane persists across the whole run — it is
          // never re-spawned for a second round. Without resetting these two
          // guard flags here, the review-stage handler below finds
          // `reviewPaneId` still set and `reviewTaskDelivered` still `true`
          // from the FIRST round, so it takes the silent "already tasked"
          // reattach branch and never actually tells the captain new commits
          // are ready — it sits idle forever after its one decision (C-418).
          // Resetting them re-arms the retask path for this new round.
          manifest.reviewTaskDelivered = false;
          manifest.reviewResumeNudgedAt = undefined;
        }

        const interactiveStage =
          !!options.interactiveWriter && stage === 'write_contract' && attempt === 1;
        const outcome = await runStage({
          repoRoot: options.repoRoot,
          runDirectory: runDirectory({ runId: manifest.runId, cwd: options.repoRoot }),
          runId: manifest.runId,
          stage,
          attempt,
          contractPath: manifest.contractPath,
          // The interactive writer legitimately sits idle while waiting for the
          // user to describe their feature — don't nudge it or time it out
          // early. Only the hard wall-clock cap bounds the wait.
          idleTimeoutMs: interactiveStage
            ? (STAGE_HARD_CAPS.write_contract ?? IDLE_TIMEOUT_MS)
            : IDLE_TIMEOUT_MS,
          hardTimeoutMs: STAGE_HARD_CAPS[stage] ?? 8 * 60 * 60 * 1000,
          feedback,
          // Lets runStage tell a late-finishing worker (adopt) apart from a
          // deliberate new round after verifier/review feedback (must re-run).
          // See the RETRY SAFEGUARD comment in stage_runner.ts.
          previousAttemptRecordedStatus: manifest.attempts.find(
            (a) => a.stage === stage && a.attempt === attempt - 1,
          )?.result?.status,
          interactiveWriter: interactiveStage,
          launchWorker: (req) => adapter.launchWorker(req),
          checkAgentWorking: (pid) => adapter.isWorkerActive(pid),
          nudgeWorker: interactiveStage ? undefined : (opts) => adapter.nudgeWorker(opts),
        });
        const after = captureGitState(cwdForGit);

        // Direct-draft placeholder rename: the writer creates the real contract
        // at docs/contracts/C-XXX-<slug>.md. Discover it, drop the stale
        // placeholder, and point the manifest at the real file BEFORE syncing
        // to the worktree (so implementers read the real contract).
        if (stage === 'write_contract' && outcome.result.status === 'passed') {
          const cd = resolve(options.repoRoot, 'docs/contracts');
          if (existsSync(cd)) {
            const discovered = readdirSync(cd).find(
              (f) =>
                f.startsWith(`${manifest.contractId}-`) &&
                f.endsWith('.md') &&
                f !== `${manifest.contractId}.md`,
            );
            if (discovered) {
              manifest.contractPath = join(cd, discovered);
              const placeholderPath = join(cd, `${manifest.contractId}.md`);
              if (placeholderPath !== manifest.contractPath && existsSync(placeholderPath)) {
                try {
                  unlinkSync(placeholderPath);
                } catch {}
              }
            }
          }
        }
        // The writer may have renamed the contract (placeholder → real slug),
        // so re-isolate the new path before the next stage reads it.
        if (wPath && stage === 'write_contract' && outcome.result.status === 'passed') {
          isolateContractInWorktree({
            repoRoot: options.repoRoot,
            worktreePath: wPath,
            contractPath: manifest.contractPath,
          });
        }

        // Postcondition validation — catches agents crossing role boundaries.
        // Set CONTRACT_SKIP_POSTCONDITIONS=1 to bypass (e.g. uncommitted local changes
        // in main repo falsely attributed to writer/critic agents).
        const skipPc = process.env.CONTRACT_SKIP_POSTCONDITIONS === '1';
        const pc = skipPc
          ? { passed: true, unauthorizedPaths: [] as string[] }
          : validatePostconditions({
              role,
              contractPath: manifest.contractPath,
              repoRoot: options.repoRoot,
              workspacePath: wPath,
              before,
              after,
            });
        let result = pc.passed
          ? outcome.result
          : resultForPostconditionFailure({
              original: outcome.result,
              unauthorizedPaths: pc.unauthorizedPaths,
            });

        if (stage === 'implement' && result.status === 'passed') {
          // Status is tracked in run manifest only — don't touch main contract.
          // Commit implementer changes. In worktree mode they land on the
          // worktree branch; in root mode on the current root branch
          // (contract/C-XXX). The verifier runs next and expects a clean git
          // state — untracked implementation files would otherwise be flagged
          // as missing.
          const commitCwd = wPath || (rootMode ? options.repoRoot : '');
          if (commitCwd) {
            try {
              commitAll({
                cwd: commitCwd,
                message: `Feat: Contract ${manifest.contractId} — implementation`,
                authorName: 'Pi Agent',
                authorEmail: 'agent@pi.internal',
                protectedPaths: WORKTREE_SKIP_WORKTREE_PATHS,
              });
              pipelineLog({
                runId: manifest.runId,
                cwd: options.repoRoot,
                message: 'Implementer changes committed.',
              });
            } catch (commitErr: unknown) {
              const msg = commitErr instanceof Error ? commitErr.message : String(commitErr);
              console.warn(
                `⚠️  Implementer commit failed (non-fatal — reconcile will retry): ${msg.slice(0, 200)}`,
              );
            }
          }
        }
        result = enforceStageStatus({ stage, result, contractPath: manifest.contractPath });

        manifest.attempts.push({
          stage,
          role,
          attempt,
          paneId: outcome.paneId,
          startTime,
          endTime: new Date().toISOString(),
          result,
        });
        if (stage === 'critique' && result.status === 'passed') {
          // Compute the approved content and commit it straight to main —
          // deliberately not `updateContractStatus` (a raw write to
          // manifest.contractPath) followed by a separate commit step. That
          // two-step left a window where the stamped file sat, uncommitted,
          // on whatever branch repoRoot happened to have checked out — the
          // same class of bug pullContractFromWorktree used to have. See
          // contract_sync.ts's `commitContractContent`.
          try {
            const currentContent = readFileSync(manifest.contractPath, 'utf-8');
            const approvedContent = withUpdatedStatus(currentContent, 'approved');
            const approved = commitContractContent({
              repoRoot: options.repoRoot,
              contractPath: manifest.contractPath,
              content: approvedContent,
              message: `docs(contracts): approve ${manifest.contractId}`,
            });
            pipelineLog({
              runId: manifest.runId,
              cwd: options.repoRoot,
              message: approved.message,
            });
            if (!approved.ok) {
              console.warn(`⚠️  ${approved.message}`);
            }
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            console.warn(`⚠️  Could not stamp contract approved: ${msg.slice(0, 200)}`);
          }
        }

        // ── Contract ownership: the contract lives on main, never in a PR ──
        // Implementer/verifier agents append their Execution Report and AC
        // evidence to the contract inside the worktree, where the file is
        // skip-worktree'd (see isolateContractInWorktree above). Carry that
        // edit back to root and push it to main on its own commit, so the PR
        // diff stays code-only and `git pull` after a merge never conflicts
        // on the contract file.
        if (wPath && (stage === 'implement' || stage === 'verify') && result.status === 'passed') {
          const pulled = pullContractFromWorktree({
            repoRoot: options.repoRoot,
            worktreePath: wPath,
            contractPath: manifest.contractPath,
            contractId: manifest.contractId,
            stage,
          });
          pipelineLog({ runId: manifest.runId, cwd: options.repoRoot, message: pulled.message });
          if (!pulled.ok) {
            console.warn(`⚠️  ${pulled.message}`);
          }
        }

        if (stage === 'verify') {
          if (result.status === 'passed') {
            // Status is tracked in run manifest only — don't touch main contract.
            manifest.verificationFingerprint = after.fingerprint;
            manifest.verificationContractHash = '';
            if (manifest.reconciliation?.headBranch) {
              try {
                const wsCwd = adapter.getWorkspacePath() || options.repoRoot;
                try {
                  commitAll({
                    cwd: wsCwd,
                    message: `Feat: Contract ${manifest.contractId} — revision`,
                    authorName: 'Pi Agent',
                    authorEmail: 'agent@pi.internal',
                    protectedPaths: WORKTREE_SKIP_WORKTREE_PATHS,
                  });
                } catch {}
                pushBranch({ cwd: wsCwd, branchName: manifest.reconciliation.headBranch });
                pipelineLog({
                  runId: manifest.runId,
                  cwd: options.repoRoot,
                  message: `Branch updated: ${manifest.reconciliation.headBranch}`,
                });
                console.log(`\n🔄 Branch updated: ${manifest.reconciliation.headBranch}\n`);
              } catch (e: unknown) {
                const m = e instanceof Error ? e.message : String(e);
                manifest.blockedReason = `Branch push failed: ${m.slice(0, 400)}.`;
                manifest = transition({ manifest, next: 'review' });
                writeManifest({ manifest, cwd: options.repoRoot });
                continue;
              }
            } else {
              try {
                manifest.reconciliation = await reconcileWorkspace({
                  manifest,
                  repoRoot: options.repoRoot,
                  baseBranch: PIPELINE_BASE_BRANCH,
                  rootMode,
                });
                pipelineLog({
                  runId: manifest.runId,
                  cwd: options.repoRoot,
                  message: `Branch pushed: ${manifest.reconciliation.headBranch} (no PR — review captain creates it)`,
                });
                console.log(`\n📤 Branch pushed: ${manifest.reconciliation.headBranch}\n`);
              } catch (e: unknown) {
                const m = e instanceof Error ? e.message : String(e);
                manifest.blockedReason = `Reconciliation failed: ${m.slice(0, 400)}.`;
                manifest = transition({ manifest, next: 'review' });
                writeManifest({ manifest, cwd: options.repoRoot });
                continue;
              }
            }
          } else if (result.status === 'changes_requested') {
            // Status is tracked in run manifest only — don't touch main contract.
          }
        }

        const next = resolveNextStage({
          currentStage: stage,
          verdict: result,
          verifyLoops: manifest.verifyLoops,
        });
        const exhausted =
          stage === 'verify' &&
          result.status === 'changes_requested' &&
          next.verifyLoops >= MAX_VERIFY_LOOPS;
        manifest.verifyLoops = next.verifyLoops;

        // 🔴 When verifier loop is exhausted, always go to review — never block.
        // - YOLO: force reconcile + YOLO review (Captain creates PR, autofix, merges).
        // - Non-YOLO: review with blockedReason (Captain sees findings, can fix easy
        //   issues, create draft PR, or ask the user).
        if (exhausted) {
          if (options.yolo) {
            // Force reconciliation: commit + push the branch so a PR can be created.
            if (!manifest.reconciliation?.headBranch) {
              try {
                manifest.reconciliation = await reconcileWorkspace({
                  manifest,
                  repoRoot: options.repoRoot,
                  baseBranch: PIPELINE_BASE_BRANCH,
                  rootMode,
                });
                console.log(`\n🚀 YOLO: Branch pushed (verifier findings → CodeRabbit).\n`);
              } catch (e: unknown) {
                const m = e instanceof Error ? e.message : String(e);
                manifest.blockedReason = `YOLO reconciliation failed: ${m.slice(0, 400)}.`;
                manifest = transition({ manifest, next: 'blocked' });
                writeManifest({ manifest, cwd: options.repoRoot });
                continue;
              }
            }
            // YOLO: no blockedReason — captain operates normally.
          } else {
            // Non-YOLO: set blockedReason so captain gets the verifier findings.
            manifest.blockedReason = result.summary;
          }
          manifest = transition({ manifest, next: 'review' });
        } else {
          manifest = transition({ manifest, next: next.next });
          if (manifest.currentStage === 'blocked') {
            manifest.blockedReason = result.summary;
          }
        }
        writeManifest({ manifest, cwd: options.repoRoot });
        pipelineLog({
          runId: manifest.runId,
          cwd: options.repoRoot,
          message: `${stage}-${attempt}: ${result.status} -> ${manifest.currentStage}`,
        });
        continue;
      }

      if (manifest.currentStage === 'review') {
        const isBlockedReview = !!manifest.blockedReason;
        // 🔴 Blocked reviews (verify-loop exhaustion, post-verify reconcile
        // failure) reach `review` WITHOUT `manifest.reconciliation` ever
        // being set — reconcile either never ran or threw. Fall back to the
        // worktree's own checked-out branch (set at initialize time) so
        // findPrUrl() below can still discover a PR that the review captain
        // pushes and creates by hand while fixing the block itself.
        const headBranch = manifest.reconciliation?.headBranch ?? manifest.worktreeBranch;
        const baseBranch = manifest.reconciliation?.baseBranch ?? PIPELINE_BASE_BRANCH;
        const reviewPath = join(
          runDirectory({ runId: manifest.runId, cwd: options.repoRoot }),
          'review',
          'decision.json',
        );
        // Read any decision left behind by a crashed orchestrator BEFORE
        // clearing the file — the file may be the only copy (crash between
        // the captain recording the decision and writeManifest persisting it
        // to the run manifest). Process it immediately; do NOT nudge the
        // captain first (the nudge would kick it into redoing work the
        // orchestrator is about to consume).
        const existingDecision = readReviewDecision(reviewPath, manifest.runId);
        if (existsSync(reviewPath)) {
          unlinkSync(reviewPath);
        }

        // Set when a review pane is spawned below; cancelled once the decision
        // lands so the detached poller stops shelling out to herdr.
        let chime: { cancel: () => void } | undefined;

        // Reconnect to a live pane — either a genuine process resume, or the
        // pipeline looping back here after a `change` decision sent work to
        // the implementer/verifier and a new round is starting. Only when no
        // decision is pending.
        //
        // 🔴 Reattaching is SILENT by default. On a true resume the captain
        // does not need to be told the orchestrator is back: it was given
        // `reviewDecisionPath` in its original prompt and the orchestrator
        // simply polls that file, so a resume changes nothing on the
        // captain's side. The nudge that used to be sent here unconditionally
        // carried no information and cost a user their half-typed message
        // (C-390 — see review_pane.ts).
        //
        // Two cases genuinely need a message, and both are recorded via
        // `reviewTaskDelivered`, not guessed: (1) a captain that never
        // received its task at all (`_sendTaskText` bailed before the
        // crash), and (2) a NEW review round — `reviewTaskDelivered` is
        // deliberately reset to `false` where the `change` decision is
        // consumed (see the implement-stage block above), so this looks
        // identical to case 1 and reuses the same retask path instead of
        // silently reattaching to a captain that already spent its one
        // decision and is idling with nothing left to do (C-418). Either
        // way the send is gated on an empty composer and capped at one
        // attempt per round.
        if (!existingDecision && manifest.reviewPaneId) {
          const alive = await adapter.isPaneAlive(manifest.reviewPaneId).catch(() => false);
          if (!alive) {
            manifest.reviewPaneId = undefined;
            writeManifest({ manifest, cwd: options.repoRoot });
          } else if (manifest.reviewDecision === undefined) {
            const needsTask = manifest.reviewTaskDelivered === false;
            const alreadyNudged = manifest.reviewResumeNudgedAt !== undefined;
            if (needsTask && !alreadyNudged) {
              // Recorded BEFORE the send: a crash between send and persist
              // must not license a second injection on the next resume.
              manifest.reviewResumeNudgedAt = new Date().toISOString();
              writeManifest({ manifest, cwd: options.repoRoot });
              const delivered = await adapter.sendReviewMessage({
                paneId: manifest.reviewPaneId,
                message: `Review contract run ${manifest.runId}. If the implementer addressed a prior change request, new commits are ready — review them now. Present the verified status from the manifest. Do NOT re-run tests. Your LAST action MUST call contract_review_decision.`,
              });
              manifest.reviewTaskDelivered = delivered;
              writeManifest({ manifest, cwd: options.repoRoot });
              pipelineLog({
                runId: manifest.runId,
                cwd: options.repoRoot,
                message: `Review pane re-tasked (delivered=${delivered}).`,
              });
            } else {
              console.log(
                `🔗 Reattached to review pane ${manifest.reviewPaneId} — waiting for the decision (no message sent).`,
              );
              pipelineLog({
                runId: manifest.runId,
                cwd: options.repoRoot,
                message: 'Reattached to live review pane (silent — captain already tasked).',
              });
            }
          }
        }
        if (existingDecision) {
          manifest.reviewDecision = existingDecision;
          console.log(`📋 Processing existing review decision: ${existingDecision.decision}`);
          // Fall through to the decision processing block below.
        } else if (!manifest.reviewPaneId) {
          const isYolo = options.yolo && manifest.autofixCycles < MAX_AUTOFIX_CYCLES;
          const wasYoloDegraded = options.yolo && manifest.autofixCycles >= MAX_AUTOFIX_CYCLES;

          if (wasYoloDegraded) {
            console.log(
              `\n🛑 YOLO DEGRADED: ${manifest.autofixCycles} autofix cycles exhausted (max: ${MAX_AUTOFIX_CYCLES}).`,
            );
            console.log(
              '   Switching to manual review. If a PR exists, it will be converted to Draft.\n',
            );

            // Convert PR to draft if it exists
            const degradedPrUrl = manifest.prUrl;
            if (degradedPrUrl) {
              try {
                ghExec(['pr', 'ready', '--undo', degradedPrUrl], { cwd: options.repoRoot });
                console.log(`📝 PR converted to Draft: ${degradedPrUrl}\n`);
              } catch {
                // PR may already be a draft or not found.
              }
            }

            pipelineLog({
              runId: manifest.runId,
              cwd: options.repoRoot,
              message: `🛑 PIPELINE BLOCKED — YOLO degraded after ${manifest.autofixCycles} autofix cycles. Waiting for human intervention.`,
            });
          }

          const basePrompt = isBlockedReview
            ? buildBlockedReviewPrompt({ manifest, repoRoot: options.repoRoot })
            : loadReviewPrompt({
                repoRoot: options.repoRoot,
                contractPath: manifest.contractPath,
                runId: manifest.runId,
                prUrl: undefined,
                headBranch,
                baseBranch,
                // Measured, never inferred: a blocked review reaches here with
                // `headBranch` falling back to the local worktree branch, which
                // reconciliation never pushed. Telling the captain it is pushed
                // sends it chasing a branch that isn't on origin (C-390).
                branchPushed: headBranch
                  ? remoteBranchExists({ branchName: headBranch, repoRoot: options.repoRoot })
                  : false,
                profile: isYolo ? 'yolo' : 'ready',
                autofixCycle: manifest.autofixCycles + 1,
                maxAutofixCycles: MAX_AUTOFIX_CYCLES,
              });
          // Read-only "report, don't fix" notes for whatever the pipeline
          // silently worked around during this run — see infra_report.ts.
          // Appended to BOTH the blocked and ready/yolo review prompts, once,
          // here — the single point every review-captain launch passes
          // through, regardless of profile.
          const infraNotes = formatInfraNotesForPrompt(
            summarizeInfraIssues(readInfraIssuesForRun(options.repoRoot, manifest.runId)),
          );
          const prompt = infraNotes ? `${basePrompt}\n${infraNotes}` : basePrompt;
          const started = await adapter.startReview({
            prompt,
            contractPath: manifest.contractPath,
            reviewDecisionPath: reviewPath,
            yolo: isYolo,
            // Blocked reviews (post-verify-failure, fallback-recovery) get a
            // recovery-specific initial task (diagnose → recover or hand off,
            // ending in contract_review_decision) and run from the worktree
            // — the implementation branch only exists there, not the repo
            // root. Passed explicitly, never inferred from yolo.
            blockedReview: isBlockedReview,
            useWorktreeCwd: isYolo || isBlockedReview,
          });
          manifest.reviewPaneId = started.paneId;
          manifest.reviewTaskDelivered = started.taskDelivered;
          manifest.reviewResumeNudgedAt = undefined;
          writeManifest({ manifest, cwd: options.repoRoot });

          // 🔔 Chime when the captain FINISHES its first response, not when
          // the pane spawns. Spawn-time was minutes too early — pi was still
          // booting, so the alarm called the user to a pane with nothing on
          // it. Detached: the orchestrator blocks in waitForReviewDecision
          // immediately below, so this can never be awaited.
          //
          // YOLO reviews are autonomous (create PR → autofix → merge without
          // the user), so they get no chime — only a pane that wants a human
          // should ring one.
          if (!isYolo) {
            const chimePaneId = started.paneId;
            chime = chimeOnFirstResponse({
              getStatus: () => adapter.getAgentStatus(chimePaneId),
              isPaneAlive: () => adapter.isPaneAlive(chimePaneId).catch(() => true),
              onOutcome: (outcome) => {
                pipelineLog({
                  runId: manifest.runId,
                  cwd: options.repoRoot,
                  message: `Review first response: ${outcome}.`,
                });
              },
            });
          }
        }

        let decision: ContractReviewDecision;
        try {
          decision =
            manifest.reviewDecision ??
            (await waitForReviewDecision({
              path: reviewPath,
              runId: manifest.runId,
              isPaneAlive: manifest.reviewPaneId
                ? () => adapter.isPaneAlive(manifest.reviewPaneId as string).catch(() => true)
                : undefined,
            }));
        } catch (e: unknown) {
          if (e instanceof ReviewAbandonedError) {
            // Tab closed without a decision — do NOT fabricate a 'reject'
            // (that would close the PR). Transition to blocked with a resume
            // hint; the branch and worktree stay intact for `--resume`.
            console.log(`\n🛑 Review abandoned (tab closed): ${e.message}\n`);
            manifest.blockedReason = e.message;
            manifest = transition({ manifest, next: 'blocked' });
            writeManifest({ manifest, cwd: options.repoRoot });
            continue;
          }
          throw e;
        } finally {
          // Runs on the `continue` above too. The captain has either answered
          // or vanished; either way nobody needs the chime now, and leaving
          // the poller running would spawn a herdr probe every 1.5s for the
          // remainder of its 20-minute timeout.
          chime?.cancel();
        }
        manifest.reviewDecision = decision;
        if (!manifest.reviewPaneId) {
          throw new Error('Review pane was not initialized.');
        }

        const findPrUrl = (): string | undefined => {
          if (manifest.prUrl) {
            return manifest.prUrl;
          }
          if (!headBranch) {
            return undefined;
          }
          try {
            const r = ghExec(
              [
                'pr',
                'list',
                '--head',
                headBranch,
                '--state',
                'open',
                '--json',
                'url',
                '--jq',
                '.[0].url',
              ],
              { cwd: options.repoRoot, timeoutMs: 10_000 },
            );
            if (r) {
              manifest.prUrl = r;
            }
            return r || undefined;
          } catch (err: unknown) {
            // 🔴 This exact catch is F-02 from the rig audit: it used to
            // swallow a Windows shell-quoting bug and let the orchestrator
            // report "No PR found" instead of the real cause. The quoting
            // bug is fixed (ghExec uses execFileSync), but `gh` can still
            // fail for other reasons (rate limit, auth, network) — report
            // those instead of going silent again.
            reportInfraIssue({
              component: 'gh_pr_lookup',
              operation: 'gh pr list --head <branch>',
              error: err,
              context: { headBranch },
              runId: manifest.runId,
              cwd: options.repoRoot,
            });
            return undefined;
          }
        };

        if (isBlockedReview) {
          if (decision.decision === 'approve' || decision.decision === 'merge') {
            const prUrl = findPrUrl();
            if (!prUrl) {
              console.error('❌ No PR found — review captain should have created one.');
              manifest = transition({ manifest, next: 'blocked' });
              writeManifest({ manifest, cwd: options.repoRoot });
              continue;
            }
            if (decision.decision === 'approve') {
              try {
                ghExec(['pr', 'ready', prUrl], { cwd: options.repoRoot });
              } catch {}
              console.log(`\n✅ PR ready: ${prUrl}\n`);
              manifest = transition({ manifest, next: 'pr_created' });
            } else {
              // In YOLO mode, Captain already merged via gh_merge_pr.
              // Orchestrator just syncs main; workspace handling is deferred
              // to finalizeWorkspace after the loop.
              if (options.yolo) {
                syncMainOnMerge(options.repoRoot);
                manifest = transition({ manifest, next: 'merged' });
                console.log(`\n🚀 PR merged: ${prUrl}\n`);
              } else {
                try {
                  ghExec(['pr', 'ready', prUrl], { cwd: options.repoRoot });
                } catch {}
                execFileSync('gh', ['pr', 'merge', prUrl, '--squash'], {
                  encoding: 'utf-8',
                  stdio: ['pipe', 'pipe', 'pipe'],
                  cwd: options.repoRoot,
                  timeout: 60000,
                  // Windows: hide the console window (no-op on POSIX).
                  windowsHide: true,
                });
                syncMainOnMerge(options.repoRoot);
                manifest = transition({ manifest, next: 'merged' });
                console.log(`\n🚀 PR merged: ${prUrl}\n`);
              }
            }
          } else if (decision.decision === 'change') {
            console.log('\n🔄 Retrying — back to implementer.\n');
            manifest.verifyLoops = 0;
            manifest.blockedReason = undefined;
            // 🔴 Circuit breaker: Track autofix cycles for YOLO degradation
            if (options.yolo) {
              manifest.autofixCycles += 1;
              pipelineLog({
                runId: manifest.runId,
                cwd: options.repoRoot,
                message: `Autofix cycle ${manifest.autofixCycles}/${MAX_AUTOFIX_CYCLES} — YOLO.`,
              });
            }
            delete manifest.verificationFingerprint;
            delete manifest.verificationContractHash;
            // Status tracked in run manifest — don't touch main contract.
            manifest = transition({ manifest, next: 'implement' });
          } else {
            const prUrl = findPrUrl();
            if (prUrl) {
              try {
                ghExec(['pr', 'close', prUrl], { cwd: options.repoRoot });
              } catch {}
            }
            manifest.blockedReason = decision.summary;
            manifest = transition({ manifest, next: 'blocked' });
          }
          writeManifest({ manifest, cwd: options.repoRoot });
          continue;
        }

        // Normal review
        const prUrl = findPrUrl();
        if (!prUrl) {
          throw new Error(
            `No PR found for branch ${headBranch ?? 'unknown'}. The review captain should have created a PR with gh_create_pr.`,
          );
        }
        if (decision.decision === 'approve') {
          try {
            ghExec(['pr', 'ready', prUrl], { cwd: options.repoRoot });
          } catch {}
          console.log(`\n✅ PR ready for review: ${prUrl}\n`);
          manifest = transition({ manifest, next: 'pr_created' });
        } else if (decision.decision === 'merge') {
          // In YOLO mode, the Captain already executed the merge via gh_merge_pr.
          // The orchestrator just syncs main; workspace handling is deferred
          // to finalizeWorkspace after the loop.
          if (options.yolo) {
            console.log('\n🚀 YOLO: Captain merged — syncing main.\n');
            syncMainOnMerge(options.repoRoot);
            manifest = transition({ manifest, next: 'merged' });
            pipelineLog({
              runId: manifest.runId,
              cwd: options.repoRoot,
              message: `PR merged by Captain: ${prUrl}`,
            });
            console.log(`\n🚀 PR merged: ${prUrl}\n`);
          } else {
            // Non-YOLO: orchestrator handles the merge.
            try {
              ghExec(['pr', 'ready', prUrl], { cwd: options.repoRoot });
            } catch {}
            execFileSync('gh', ['pr', 'merge', prUrl, '--squash'], {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              cwd: options.repoRoot,
              timeout: 60000,
              // Windows: hide the console window (no-op on POSIX).
              windowsHide: true,
            });
            syncMainOnMerge(options.repoRoot);
            manifest = transition({ manifest, next: 'merged' });
            pipelineLog({
              runId: manifest.runId,
              cwd: options.repoRoot,
              message: `PR merged: ${prUrl}`,
            });
            console.log(`\n🚀 PR merged: ${prUrl}\n`);
          }
        } else if (decision.decision === 'change') {
          pipelineLog({
            runId: manifest.runId,
            cwd: options.repoRoot,
            message: `PR kept open for revision: ${prUrl}`,
          });
          // 🔴 Circuit breaker: Track autofix cycles for YOLO degradation
          if (options.yolo) {
            manifest.autofixCycles += 1;
            pipelineLog({
              runId: manifest.runId,
              cwd: options.repoRoot,
              message: `Autofix cycle ${manifest.autofixCycles}/${MAX_AUTOFIX_CYCLES} — YOLO.`,
            });
          }
          delete manifest.verificationFingerprint;
          delete manifest.verificationContractHash;
          // Status tracked in run manifest — don't touch main contract.
          manifest = transition({ manifest, next: 'implement' });
        } else {
          ghExec(['pr', 'close', prUrl], { cwd: options.repoRoot });
          manifest.blockedReason = decision.summary;
          manifest = transition({ manifest, next: 'blocked' });
        }
        writeManifest({ manifest, cwd: options.repoRoot });
        continue;
      }

      manifest.blockedReason = `Unexpected stage: ${manifest.currentStage}`;
      manifest = transition({ manifest, next: 'blocked' });
      writeManifest({ manifest, cwd: options.repoRoot });
    }

    pipelineLog({
      runId: manifest.runId,
      cwd: options.repoRoot,
      message: `Pipeline finished at ${manifest.currentStage}.`,
    });
    if (manifest.currentStage === 'blocked') {
      const s = formatBlockedSummary(manifest);
      pipelineLog({ runId: manifest.runId, cwd: options.repoRoot, message: s });
      console.log(s);
      const infraNotes = formatInfraNotesForPrompt(
        summarizeInfraIssues(readInfraIssuesForRun(options.repoRoot, manifest.runId)),
      );
      if (infraNotes) {
        console.log(infraNotes);
      }
    }

    // Terminal workspace handling — one funnel for merged / pr_created /
    // blocked / crash. Default keeps the workspace alive (review tab stays
    // open with a completion notification); auto-clean applies only when no
    // human is reading the tab (pure YOLO, early crash before review, or
    // CONTRACT_PIPELINE_AUTO_CLEANUP=1).
    await finalizeWorkspace({ adapter, manifest, repoRoot: options.repoRoot, yolo: options.yolo });

    return manifest;
  } catch (e: unknown) {
    // 🔴 Infrastructure failures (herdr hiccup, git error, gh failure) must
    // not vanish silently. Without this catch, an exception left the manifest
    // at a non-terminal stage, the launcher never saw a ready file, and the
    // next `bun run contract` resumed the same broken state forever (the
    // C-375 crash loop — three byte-identical failures). Record the failure
    // as a terminal `blocked` state so findPreviousRuns skips it, attempt
    // worktree cleanup, then rethrow so the launcher surfaces the real error.
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n❌ Pipeline crashed: ${msg}`);
    playError();
    try {
      manifest.blockedReason = `Infrastructure failure: ${msg.slice(0, 1500)}`;
      manifest = transition({ manifest, next: 'blocked' });
      writeManifest({ manifest, cwd: options.repoRoot });
      pipelineLog({
        runId: manifest.runId,
        cwd: options.repoRoot,
        message: `Pipeline blocked after infrastructure failure: ${msg.slice(0, 300)}`,
      });
    } catch (persistErr: unknown) {
      console.warn(
        `⚠️  Could not persist blocked state: ${persistErr instanceof Error ? persistErr.message : String(persistErr)}`,
      );
    }
    try {
      await finalizeWorkspace({
        adapter,
        manifest,
        repoRoot: options.repoRoot,
        yolo: options.yolo,
      });
    } catch (finalizeErr: unknown) {
      console.warn(
        `⚠️  Workspace finalization failed: ${finalizeErr instanceof Error ? finalizeErr.message : String(finalizeErr)}`,
      );
    }
    throw e;
  } finally {
    // 🔴 F-05: the gh-token file has no reason to outlive the run — delete
    // it on every exit path (success, blocked, crash), not just the happy
    // one. `mode: 0o600` at write time only restricts it on POSIX; deleting
    // it promptly matters more on Windows, where that mode bit is a no-op.
    try {
      const tokenPath = ghTokenFilePath({ repoRoot: options.repoRoot, runId: manifest.runId });
      if (existsSync(tokenPath)) {
        unlinkSync(tokenPath);
      }
    } catch {
      // Best-effort — a leftover token file is a hygiene issue, not one
      // worth failing pipeline teardown over.
    }
    releaseLock({ contractId: manifest.contractId, cwd: options.repoRoot });
  }
};
