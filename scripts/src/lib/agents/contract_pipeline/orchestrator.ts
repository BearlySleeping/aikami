// scripts/src/lib/agents/contract_pipeline/orchestrator.ts
// biome-ignore-all lint/style/useNamingConvention: pipeline stage identifiers are persisted domain values
import { execFileSync, execSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { findWorkspace, herdrJson } from '../../herdr/session.ts';
import {
  commitAll,
  provisionGitWorktree,
  pushBranch,
  remoteBranchExists,
  runGit,
} from '../git_worktree.ts';
import { resolveContract } from './contract_resolver.ts';
import { readContractStatus, updateContractStatus } from './contract_status.ts';
import { captureGitState, currentCommit } from './git_state.ts';
import { ContractHerdrAdapter, type ContractHerdrAdapterInterface } from './herdr_adapter.ts';
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
import { loadReviewPrompt } from './prompt_loader.ts';
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
import { PIPELINE_BASE_BRANCH, STATUS_TO_START_STAGE } from './types.ts';

const STAGE_TIMEOUTS: Record<string, number> = {
  write_contract: 20 * 60 * 1000,
  critique: 15 * 60 * 1000,
  implement: 120 * 60 * 1000,
  verify: 45 * 60 * 1000,
};
const WORKER_STAGES: readonly ContractPipelineStage[] = [
  'write_contract',
  'critique',
  'implement',
  'verify',
];

const sleep = async (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const TERMINAL_STAGES: readonly ContractPipelineStage[] = ['pr_created', 'merged'];

/** Find the newest incomplete run for a contract. */
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
    if (m && !TERMINAL_STAGES.includes(m.currentStage)) {
      return rid;
    }
  }
  return undefined;
};

/** Build implementer feedback from prior verifier results (for retries). */
const verifierFeedback = (options: {
  manifest: RunManifest;
  attempt: number;
}): string | undefined => {
  if (options.attempt <= 1) {
    return undefined;
  }

  // Include previous implementer context + verifier findings.
  const prevImpl = [...options.manifest.attempts]
    .reverse()
    .find((candidate) => candidate.role === 'implementer' && candidate.result);
  const prevVerify = [...options.manifest.attempts]
    .reverse()
    .find((candidate) => candidate.role === 'verifier' && candidate.result);

  if (!prevVerify?.result) {
    return undefined;
  }

  const parts = [prevVerify.result.summary];
  parts.push(...prevVerify.result.findings.map((item) => `- ${item}`));

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
    if (!existsSync(options.contractPath) && status === 'draft') {
      console.warn(
        `⚠️  Contract file missing at ${options.contractPath} — implementer passed but status check skipped.`,
      );
      return options.result;
    }
    return {
      ...options.result,
      status: 'blocked',
      summary: `Implementer ended with contract status ${status}; expected implemented.`,
      findings: [...options.result.findings, 'Implementation report/status handoff is incomplete.'],
    };
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

const waitForReviewDecision = async (options: {
  path: string;
  runId: string;
}): Promise<ContractReviewDecision> => {
  while (true) {
    const decision = readReviewDecision(options.path, options.runId);
    if (decision) {
      return decision;
    }
    await sleep(1_000);
  }
};

// ── Reconciliation (post-accept) ─────────────────────────────

/**
 * Reconcile the isolated Git Worktree: commit all changes, push the branch,
 * return head branch info for PR creation. The worktree is NOT deleted — it
 * persists until the user merges or explicitly cleans up.
 */
const reconcileWorkspace = (options: {
  manifest: RunManifest;
  repoRoot: string;
  baseBranch?: string;
}): ReconciliationResult => {
  // Find workspace path — the implementer/verifier ran there.
  const workspaceRunName = options.manifest.runId;
  const { workspacePath, branchName } = provisionGitWorktree({
    repoRoot: options.repoRoot,
    name: workspaceRunName,
    baseRevision: options.baseBranch ?? PIPELINE_BASE_BRANCH,
  });

  // Restore provisioning artifacts from the base branch.
  for (const fp of ['.envrc', '.pi/settings.json']) {
    try {
      runGit(`checkout HEAD -- '${fp}'`, { cwd: workspacePath });
    } catch {}
  }

  const runToken = options.manifest.runId.replace(/^run-/, '').split('-')[0];
  const baseBranchName = `contract-task-${options.manifest.contractId.toLowerCase()}-${runToken}`;
  const baseBranch = options.baseBranch ?? PIPELINE_BASE_BRANCH;

  // Check for collision, append token if needed.
  let headBranch = baseBranchName;
  if (remoteBranchExists({ branchName: baseBranchName, repoRoot: options.repoRoot })) {
    const token = Date.now().toString(36).slice(-6);
    headBranch = `${baseBranchName}-${token}`;
  }

  // If the worktree is on a different branch, rename it.
  if (branchName !== headBranch) {
    try {
      runGit(`branch -m ${branchName} ${headBranch}`, { cwd: workspacePath });
    } catch {
      // Branch rename may fail — use the existing branch name.
      headBranch = branchName;
    }
  }

  // Finalize: commit all changes, then push.
  const finalMsg = `Feat: Contract ${options.manifest.contractId} (run ${options.manifest.runId})`;
  const finalCommit = commitAll({
    cwd: workspacePath,
    message: finalMsg,
    authorName: 'Pi Agent',
    authorEmail: 'agent@pi.internal',
  });

  pushBranch({ cwd: workspacePath, branchName: headBranch });

  const prTitle = `Contract ${options.manifest.contractId} — Automated Resolution`;
  const prBody = [
    `## Automated PR`,
    '',
    `- **Contract ID:** \`${options.manifest.contractId}\``,
    `- **Commit:** \`${finalCommit}\``,
    `- **Branch:** \`${headBranch}\``,
    `- **Pipeline Run:** \`${options.manifest.runId}\``,
    '',
    `Generated by Pi Contract Pipeline.`,
  ].join('\n');

  return {
    changeId: finalCommit,
    bookmarkName: headBranch,
    headBranch,
    baseBranch,
    prTitle,
    prBody,
  };
};

/**
 * Create a GitHub PR from the reconciled bookmark.
 * Returns the PR URL or throws.
 */
const createGitHubPr = (options: {
  headBranch: string;
  baseBranch: string;
  title: string;
  body: string;
  repoRoot: string;
  draft?: boolean;
}): string => {
  const args = [
    'pr',
    'create',
    '--head',
    options.headBranch,
    '--base',
    options.baseBranch,
    '--title',
    options.title,
    '--body',
    options.body,
  ];
  if (options.draft) {
    args.push('--draft');
  }
  const result = execFileSync('gh', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    cwd: options.repoRoot,
    timeout: 30000,
  }).trim();

  // Extract PR URL from gh output.
  const urlMatch = result.match(/https:\/\/github\.com\/[^\s]+/);
  return urlMatch?.[0] ?? result;
};

// ── Blocked summary ─────────────────────────────────────────

const severityIcon = (finding: string): string => {
  const upper = finding.toUpperCase();
  if (upper.includes('CRITICAL')) {
    return '🔴';
  }
  if (upper.includes('MODERATE')) {
    return '🟡';
  }
  return '⚪';
};

/**
 * Produce a human-readable blocked summary from the manifest.
 * Determines the block reason category and formats findings + next steps.
 */
const formatBlockedSummary = (manifest: RunManifest): string => {
  const lines: string[] = [];
  const hr = '═══════════════════════════════════════════════════════════';

  lines.push('');
  lines.push(hr);
  lines.push(`🚫 PIPELINE BLOCKED — ${manifest.contractId}`);
  lines.push(hr);
  lines.push('');

  // Categorize the block reason.
  const lastVerifyPassed = [...manifest.attempts]
    .reverse()
    .find((a) => a.stage === 'verify' && a.result?.status === 'passed');

  const lastVerifyLoopHit =
    manifest.verifyLoops >= MAX_VERIFY_LOOPS &&
    manifest.attempts.filter((a) => a.stage === 'verify').length >= MAX_VERIFY_LOOPS;

  if (lastVerifyPassed && !lastVerifyLoopHit) {
    // Verify passed but something after failed (e.g. reconciliation)
    lines.push('Reason: Verification passed, but a post-verify step failed.');
    if (manifest.blockedReason) {
      lines.push(`Details: ${manifest.blockedReason}`);
    }
  } else if (lastVerifyLoopHit) {
    lines.push(
      `Reason: Max verify→implement bounces reached (${manifest.verifyLoops}/${MAX_VERIFY_LOOPS}).`,
    );
    lines.push(
      'The verifier found issues the implementer could not resolve within the bounce limit.',
    );
  } else if (manifest.blockedReason) {
    lines.push(`Reason: ${manifest.blockedReason}`);
  } else {
    lines.push('Reason: Pipeline blocked — no reason recorded.');
  }

  lines.push('');

  // Collect findings from the LAST verifier result.
  const lastVerify = [...manifest.attempts]
    .reverse()
    .find((a) => a.stage === 'verify' && a.result?.findings?.length);

  if (lastVerify?.result?.findings?.length) {
    lines.push('Last verifier findings:');
    for (const finding of lastVerify.result.findings) {
      const icon = severityIcon(finding);
      lines.push(`  ${icon} ${finding}`);
    }
    lines.push('');
  }

  // Collect all implemented files touched by implementer.
  const implementerAttempts = manifest.attempts.filter(
    (a) => a.stage === 'implement' && a.result?.filesTouched?.length,
  );
  if (implementerAttempts.length > 0) {
    const allFiles = [
      ...new Set(implementerAttempts.flatMap((a) => a.result?.filesTouched ?? [])),
    ].sort();
    lines.push('Files needing fixes:');
    for (const f of allFiles.slice(0, 10)) {
      lines.push(`  📄 ${f}`);
    }
    if (allFiles.length > 10) {
      lines.push(`  ... and ${allFiles.length - 10} more`);
    }
    lines.push('');
  }

  // Next steps.
  lines.push('Next steps:');
  lines.push(`  1. Fix the issues above manually in the codebase`);
  lines.push(`  2. Run:  bun contract ${manifest.contractId} --fresh`);
  lines.push(`  3. Or reset the contract status to 'implemented' and re-run without --fresh`);
  lines.push('');
  lines.push(hr);
  lines.push('');

  return lines.join('\n');
};

/**
 * Build a review prompt for a blocked pipeline run.
 * Extends the base review captain prompt with blockage context:
 * what went wrong, verifier findings, files to fix, and decision options.
 */
const buildBlockedReviewPrompt = (options: { manifest: RunManifest; repoRoot: string }): string => {
  const basePrompt = loadReviewPrompt({
    repoRoot: options.repoRoot,
    contractPath: options.manifest.contractPath,
    runId: options.manifest.runId,
  });

  const summary = formatBlockedSummary(options.manifest);

  // Determine the block category
  const lastVerifyPassed = [...options.manifest.attempts]
    .reverse()
    .find((a) => a.stage === 'verify' && a.result?.status === 'passed');
  const isLoopExhaustion =
    options.manifest.verifyLoops >= MAX_VERIFY_LOOPS &&
    options.manifest.attempts.filter((a) => a.stage === 'verify').length >= MAX_VERIFY_LOOPS;

  // ── Post-verify failure (e.g. gh auth missing, PR creation failed) ──
  if (lastVerifyPassed && !isLoopExhaustion) {
    const reconciliation = options.manifest.reconciliation;
    const branchInfo = reconciliation?.headBranch
      ? `\nBranch: \`${reconciliation.headBranch}\`\nCommit: \`${reconciliation.changeId ?? 'unknown'}\``
      : '';

    return [
      basePrompt,
      '',
      '## ⚠️ POST-VERIFY FAILURE — Review Captain',
      '',
      '**Verification PASSED.** All tests are green, the code is ready.',
      '',
      '**🔴 CRITICAL: No PR exists.** The manifest has `reconciliation` metadata',
      '(branch, title, body) but `prUrl` is NOT set — the PR was never created.',
      '`gh` is not authenticated in this environment.',
      'Do NOT tell the user a PR exists. There is no PR.',
      '',
      '### Status',
      summary,
      '',
      '### What to do',
      '',
      '1. The branch is already pushed to origin:',
      branchInfo,
      '',
      '2. Tell the user to create the PR manually:',
      '   ```bash',
      `   gh pr create --head ${reconciliation?.headBranch ?? '<branch>'} --base ${reconciliation?.baseBranch ?? 'main'} --draft`,
      '   ```',
      '   Or open: https://github.com/BearlySleeping/aikami/compare/main...<branch>',
      '',
      '3. OR the user can fix gh auth and call `contract_review_decision` with `change`',
      '   to retry reconciliation.',
      '',
      '### Decision shortcuts',
      '- `/fix` or "retry" → `change` (retries reconciliation — only works if gh auth is fixed)',
      '- `/reject` or "abandon" → `reject` (exit with summary)',
      '',
      '🔴 Your LAST action must call `contract_review_decision`.',
    ].join('\n');
  }

  // ── Verify-loop-exhaustion blocked review ──
  return [
    basePrompt,
    '',
    '## ⚠️ BLOCKED PIPELINE — Review Captain Override',
    '',
    'This pipeline is **blocked** — the verifier found issues the implementer',
    'could not resolve within the bounce limit. The automated pipeline cannot',
    'continue on its own. You are the human decision point.',
    '',
    '### What happened',
    summary,
    '',
    '### Your options',
    '',
    '**1. Create a PR anyway** — `contract_review_decision` with `approve` or `merge`',
    '   - `approve`: Create a draft PR. CodeRabbit will review and may fix issues.',
    '     A human can then merge when ready.',
    '   - `merge`: Create a PR and auto-merge with squash. Use this only if the',
    '     issues are acceptable for the current phase.',
    '',
    '**2. Retry the implementer** — `contract_review_decision` with `change`',
    '   - Resets the verify loop counter to 0 and returns to the implementer.',
    '   - The implementer gets another chance with the verifier feedback.',
    '   - If the implementer fails again, you will come back to this screen.',
    '',
    '**3. Abandon** — `contract_review_decision` with `reject`',
    '   - Stays blocked. Closes any existing PR. Pipeline exits with summary.',
    '   - You can fix issues manually and run `bun contract <id> --fresh` later.',
    '',
    '### Decision shortcuts',
    '- "/approve" or "create PR" → `approve`',
    '- "/merge" or "send it" → `merge`',
    '- "/fix" or "retry" → `change`',
    '- "/reject" or "abandon" → `reject`',
    '',
    '🔴 Your LAST action must call `contract_review_decision` — the pipeline',
    'polls for this artifact. Without it, the pipeline blocks forever.',
  ].join('\n');
};

// ── Main orchestrator ─────────────────────────────────────────

/** Execute one contract pipeline run. */
export const runContractPipeline = async (options: {
  repoRoot: string;
  target?: string;
  resumeRunId?: string;
  fresh?: boolean;
  dryRun?: boolean;
  ready?: boolean;
  onReady?: (manifest: RunManifest) => void;
  adapterFactory?: (options: {
    repoRoot: string;
    runId: string;
    contractId: string;
  }) => ContractHerdrAdapterInterface;
}): Promise<RunManifest> => {
  // Auto-resume
  let resumeRunId = options.resumeRunId;
  if (!resumeRunId && options.target && !options.fresh) {
    const c = resolveContract({ target: options.target, repoRoot: options.repoRoot });
    const f = findPreviousRuns({ contractId: c.id, cwd: options.repoRoot });
    if (f) {
      console.log(`♻️  Found incomplete run for ${c.id} — resuming ${f}.`);
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
    delete manifest.reviewPaneId;
    delete manifest.blockedReason;

    const contractStatus = readContractStatus(manifest.contractPath);
    const contractStage = STATUS_TO_START_STAGE[contractStatus] ?? 'write_contract';

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
    const lastAttempted = manifest.attempts[manifest.attempts.length - 1]?.stage;
    const resumeStage = lastCompleted
      ? (stageAfter[lastCompleted] ?? lastAttempted ?? contractStage)
      : contractStage;
    if (resumeStage !== manifest.currentStage) {
      pipelineLog({
        runId: manifest.runId,
        cwd: options.repoRoot,
        message: `Resuming: contract status ${contractStatus} → stage ${resumeStage} (was ${manifest.currentStage}).`,
      });
      manifest.currentStage = resumeStage;
      writeManifest({ manifest, cwd: options.repoRoot });
    }
  } else {
    if (!options.target) {
      throw new Error('A contract ID or path is required for a new run.');
    }
    // No dirty-worktree guardrail — Git Worktrees isolate all stage mutations.
    const contract = resolveContract({ target: options.target, repoRoot: options.repoRoot });
    const baseline = captureGitState(options.repoRoot);
    manifest = createManifest({
      contractId: contract.id,
      contractPath: contract.path,
      baseCommit: currentCommit(options.repoRoot),
      baselineFingerprint: baseline.fingerprint,
      startStage: STATUS_TO_START_STAGE[contract.status] ?? 'write_contract',
    });
    writeManifest({ manifest, cwd: options.repoRoot });
  }

  if (options.dryRun) {
    return manifest;
  }

  const buildWorkspaceLabel = (contractId: string): string => `aikami-contract-${contractId}`;

  await acquireLock({
    contractId: manifest.contractId,
    runId: manifest.runId,
    cwd: options.repoRoot,
    checkWorkspaceAlive: async (_runId: string) => {
      try {
        const wsId = await findWorkspace(buildWorkspaceLabel(manifest.contractId));
        return wsId !== null;
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
    });

  try {
    pipelineLog({
      runId: manifest.runId,
      cwd: options.repoRoot,
      message: `Initializing Herdr for ${manifest.contractId}.`,
    });
    const workspace = await adapter.initialize();
    manifest.workspaceId = workspace.workspaceId;
    manifest.pipelinePaneId = workspace.pipelinePaneId;
    writeManifest({ manifest, cwd: options.repoRoot });
    options.onReady?.(manifest);
    pipelineLog({
      runId: manifest.runId,
      cwd: options.repoRoot,
      message: `Pipeline started at ${manifest.currentStage} for ${manifest.contractId}.`,
    });

    // ── Main loop ────────────────────────────────────────────

    while (
      manifest.currentStage !== 'pr_created' &&
      manifest.currentStage !== 'merged' &&
      manifest.currentStage !== 'blocked'
    ) {
      if (WORKER_STAGES.includes(manifest.currentStage)) {
        const stage = manifest.currentStage;
        const role = roleForStage(stage);
        const attempt = manifest.attempts.filter((entry) => entry.stage === stage).length + 1;
        const startTime = new Date().toISOString();

        // Capture git state BEFORE. For implementer/verifier, this should
        // be in the workspace. For writer/critic (root), use the repo root.
        const workspacePath = adapter.getWorkspacePath();
        const cwdForGit =
          workspacePath && (stage === 'implement' || stage === 'verify')
            ? workspacePath
            : options.repoRoot;
        const before = captureGitState(cwdForGit);

        // Feedback: only implementer retries get prior verifier feedback.
        const feedback =
          stage === 'implement' ? verifierFeedback({ manifest, attempt }) : undefined;

        const outcome = await runStage({
          repoRoot: options.repoRoot,
          runDirectory: runDirectory({ runId: manifest.runId, cwd: options.repoRoot }),
          runId: manifest.runId,
          stage,
          attempt,
          contractPath: manifest.contractPath,
          timeoutMs: STAGE_TIMEOUTS[stage] ?? 30 * 60 * 1000,
          feedback,
          launchWorker: (request) => adapter.launchWorker(request),
          checkAgentWorking: async (paneId: string) => {
            try {
              const panes = await herdrJson<{
                result: { panes: Array<{ pane_id: string; agent_status?: string }> };
              }>(['pane', 'list', '--workspace', adapter.getWorkspaceId()]);
              const pane = panes?.result?.panes.find((p) => p.pane_id === paneId);
              // Treat herdr-unreachable/null as "assume working" so the clock advances.
              return panes ? pane?.agent_status === 'working' : true;
            } catch {
              return true;
            }
          },
        });
        const after = captureGitState(cwdForGit);

        // Sync contract back from workspace (docs/ is gitignored — git won't propagate).
        if (
          workspacePath &&
          (stage === 'implement' || stage === 'verify') &&
          existsSync(manifest.contractPath)
        ) {
          const wcp = join(workspacePath, relative(options.repoRoot, manifest.contractPath));
          if (existsSync(wcp)) {
            copyFileSync(wcp, manifest.contractPath);
          }
        }

        // After writer succeeds, discover the actual contract file.
        // The resolver uses a placeholder path; contract_generate creates the real file.
        if (stage === 'write_contract' && outcome.result.status === 'passed') {
          const contractsDirectory = resolve(options.repoRoot, 'docs/contracts');
          if (existsSync(contractsDirectory)) {
            const discovered = readdirSync(contractsDirectory).find(
              (file) =>
                file.startsWith(`${manifest.contractId}-`) &&
                file.endsWith('.md') &&
                file !== `${manifest.contractId}.md`,
            );
            if (discovered) {
              manifest.contractPath = join(contractsDirectory, discovered);
            }
          }
        }

        // Postconditions: validate role-specific file boundaries.
        const postconditions = validatePostconditions({
          role,
          contractPath: manifest.contractPath,
          repoRoot: options.repoRoot,
          workspacePath,
          before,
          after,
        });
        let result = postconditions.passed
          ? outcome.result
          : resultForPostconditionFailure({
              original: outcome.result,
              unauthorizedPaths: postconditions.unauthorizedPaths,
            });

        // Update contract status BEFORE enforceStageStatus so the guardrail passes.
        if (stage === 'implement' && result.status === 'passed') {
          updateContractStatus({ contractPath: manifest.contractPath, status: 'implemented' });
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

        // Stage lifecycle status updates.
        if (stage === 'critique' && result.status === 'passed') {
          updateContractStatus({ contractPath: manifest.contractPath, status: 'approved' });
        }
        if (stage === 'verify') {
          if (result.status === 'passed') {
            updateContractStatus({ contractPath: manifest.contractPath, status: 'verified' });
            // Fingerprint from workspace for verification gate.
            manifest.verificationFingerprint = after.fingerprint;
            manifest.verificationContractHash = '';

            // Reconcile workspace → push branch → create or update PR.
            if (manifest.prUrl && manifest.reconciliation?.headBranch) {
              // PR already exists — push updates to same branch (PR auto-updates, CodeRabbit re-reviews incrementally).
              try {
                const headBranch = manifest.reconciliation.headBranch;
                const wsCwd = adapter.getWorkspacePath() || options.repoRoot;
                try {
                  commitAll({
                    cwd: wsCwd,
                    message: `Feat: Contract ${manifest.contractId} — revision`,
                    authorName: 'Pi Agent',
                    authorEmail: 'agent@pi.internal',
                  });
                } catch {
                  // No new changes to commit.
                }
                pushBranch({ cwd: wsCwd, branchName: headBranch });
                pipelineLog({
                  runId: manifest.runId,
                  cwd: options.repoRoot,
                  message: `PR updated: ${manifest.prUrl}`,
                });
                console.log(`\n🔄 PR updated: ${manifest.prUrl}\n`);
              } catch (pushErr: unknown) {
                const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
                pipelineLog({
                  runId: manifest.runId,
                  cwd: options.repoRoot,
                  message: `PR update failed: ${msg.slice(0, 300)}`,
                });
                console.error(`\n❌ PR update failed: ${msg}\n`);
                // Go to review session — the user can decide how to handle it.
                manifest.blockedReason =
                  `PR update failed for ${manifest.prUrl}: ${msg.slice(0, 400)}. ` +
                  `The branch may need manual push or the PR may need to be recreated.`;
                manifest = transition({ manifest, next: 'review' });
                writeManifest({ manifest, cwd: options.repoRoot });
                continue;
              }
            } else {
              // First verify pass — reconcile + create PR.
              let reconciliation: ReconciliationResult | undefined;
              try {
                reconciliation = reconcileWorkspace({
                  manifest,
                  repoRoot: options.repoRoot,
                  baseBranch: PIPELINE_BASE_BRANCH,
                });
                manifest.reconciliation = reconciliation;
              } catch (reconcileErr: unknown) {
                const msg =
                  reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr);
                pipelineLog({
                  runId: manifest.runId,
                  cwd: options.repoRoot,
                  message: `Reconciliation failed: ${msg.slice(0, 300)}`,
                });
                console.error(`\n❌ Reconciliation failed: ${msg}\n`);
                manifest.blockedReason =
                  `Reconciliation failed after verify passed: ${msg.slice(0, 400)}. ` +
                  `The branch may not have been pushed — check the workspace.`;
                manifest = transition({ manifest, next: 'review' });
                writeManifest({ manifest, cwd: options.repoRoot });
                continue;
              }

              // Reconciliation succeeded — now create the PR.
              try {
                const draft = !options.ready;
                const prUrl = createGitHubPr({
                  headBranch: reconciliation.headBranch,
                  baseBranch: reconciliation.baseBranch,
                  title: reconciliation.prTitle,
                  body: reconciliation.prBody,
                  repoRoot: options.repoRoot,
                  draft,
                });
                manifest.prUrl = prUrl;
                pipelineLog({
                  runId: manifest.runId,
                  cwd: options.repoRoot,
                  message: `Draft PR created: ${prUrl}`,
                });
                console.log(`\n📦 Draft PR: ${prUrl}\n`);
              } catch (prErr: unknown) {
                const msg = prErr instanceof Error ? prErr.message : String(prErr);
                pipelineLog({
                  runId: manifest.runId,
                  cwd: options.repoRoot,
                  message: `PR creation failed: ${msg.slice(0, 300)}`,
                });
                console.error(`\n❌ PR creation failed: ${msg}\n`);
                // Branch is pushed, reconciliation has the branch info
                manifest.blockedReason =
                  `PR creation failed after verify passed: ${msg.slice(0, 400)}. ` +
                  `Branch \`${reconciliation.headBranch}\` is pushed — create the PR manually.`;
                manifest = transition({ manifest, next: 'review' });
                writeManifest({ manifest, cwd: options.repoRoot });
                continue;
              }
            }
          } else if (result.status === 'changes_requested') {
            updateContractStatus({
              contractPath: manifest.contractPath,
              status: 'verification_failed',
            });
          }
        }

        const next = resolveNextStage({
          currentStage: stage,
          verdict: result,
          verifyLoops: manifest.verifyLoops,
        });
        const verifyLoopsExhausted =
          stage === 'verify' &&
          result.status === 'changes_requested' &&
          next.verifyLoops >= MAX_VERIFY_LOOPS;

        manifest.verifyLoops = next.verifyLoops;
        manifest = transition({ manifest, next: next.next });
        // Record blocked reason when verify loops are exhausted — the review
        // handler detects this to present a blocked-review session.
        if (verifyLoopsExhausted) {
          manifest.blockedReason = result.summary;
        } else if (manifest.currentStage === 'blocked') {
          manifest.blockedReason = result.summary;
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

        const reviewPath = join(
          runDirectory({ runId: manifest.runId, cwd: options.repoRoot }),
          'review',
          'decision.json',
        );
        if (existsSync(reviewPath)) {
          unlinkSync(reviewPath);
        }
        if (!manifest.reviewPaneId) {
          const prompt = isBlockedReview
            ? buildBlockedReviewPrompt({ manifest, repoRoot: options.repoRoot })
            : loadReviewPrompt({
                repoRoot: options.repoRoot,
                contractPath: manifest.contractPath,
                runId: manifest.runId,
              });
          manifest.reviewPaneId = await adapter.startReview({
            prompt,
            contractPath: manifest.contractPath,
            reviewDecisionPath: reviewPath,
          });
          writeManifest({ manifest, cwd: options.repoRoot });
        }

        const decision = await waitForReviewDecision({ path: reviewPath, runId: manifest.runId });
        manifest.reviewDecision = decision;
        const reviewPaneId = manifest.reviewPaneId;
        if (!reviewPaneId) {
          throw new Error('Review pane was not initialized.');
        }

        // ── Blocked review: no PR yet, user decides how to handle the impasse ──
        if (isBlockedReview) {
          if (decision.decision === 'approve' || decision.decision === 'merge') {
            // Create a PR even though the pipeline is blocked.
            // CodeRabbit may resolve the issues, or a human can review.
            const reconciliation = reconcileWorkspace({
              manifest,
              repoRoot: options.repoRoot,
              baseBranch: PIPELINE_BASE_BRANCH,
            });
            manifest.reconciliation = reconciliation;
            const draft = decision.decision === 'approve' ? !options.ready : false;
            const prUrl = createGitHubPr({
              headBranch: reconciliation.headBranch,
              baseBranch: reconciliation.baseBranch,
              title: `${reconciliation.prTitle} (blocked — review needed)`,
              body: reconciliation.prBody,
              repoRoot: options.repoRoot,
              draft,
            });
            manifest.prUrl = prUrl;

            if (decision.decision === 'approve') {
              if (!draft) {
                try {
                  execSync(`gh pr ready ${prUrl}`, {
                    encoding: 'utf-8',
                    stdio: ['pipe', 'pipe', 'pipe'],
                    cwd: options.repoRoot,
                    timeout: 15000,
                  });
                } catch {
                  // Non-fatal.
                }
              }
              pipelineLog({
                runId: manifest.runId,
                cwd: options.repoRoot,
                message: `Draft PR created (blocked review): ${prUrl}`,
              });
              console.log(`\n📦 Draft PR (blocked): ${prUrl}\n`);
              manifest = transition({ manifest, next: 'pr_created' });
            } else {
              // merge
              try {
                execSync(`gh pr ready ${prUrl}`, {
                  encoding: 'utf-8',
                  stdio: ['pipe', 'pipe', 'pipe'],
                  cwd: options.repoRoot,
                  timeout: 15000,
                });
              } catch {
                // Draft — still attempt merge.
              }
              execSync(`gh pr merge ${prUrl} --squash --auto --delete-branch`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: options.repoRoot,
                timeout: 30000,
              });
              manifest = transition({ manifest, next: 'merged' });
              pipelineLog({
                runId: manifest.runId,
                cwd: options.repoRoot,
                message: `PR auto-merge queued (blocked review): ${prUrl}`,
              });
              console.log(`\n🚀 PR auto-merge queued (blocked): ${prUrl}\n`);
            }
          } else if (decision.decision === 'change') {
            // User wants to retry — reset the verify loop counter and go back
            // to implementer for a fresh attempt.
            pipelineLog({
              runId: manifest.runId,
              cwd: options.repoRoot,
              message: `Blocked review: retrying — resetting verify loops, returning to implement.`,
            });
            console.log('\n🔄 Retrying — back to implementer.\n');
            manifest.verifyLoops = 0;
            delete manifest.blockedReason;
            delete manifest.verificationFingerprint;
            delete manifest.verificationContractHash;
            updateContractStatus({ contractPath: manifest.contractPath, status: 'implemented' });
            manifest = transition({ manifest, next: 'implement' });
          } else {
            // reject — stay blocked, exit with summary.
            if (manifest.reconciliation?.headBranch) {
              try {
                execSync(`gh pr close ${manifest.prUrl}`, {
                  encoding: 'utf-8',
                  stdio: ['pipe', 'pipe', 'pipe'],
                  cwd: options.repoRoot,
                  timeout: 15000,
                });
              } catch {
                // PR may have already been closed.
              }
            }
            pipelineLog({
              runId: manifest.runId,
              cwd: options.repoRoot,
              message: `Blocked review rejected: ${decision.summary}`,
            });
            manifest.blockedReason = decision.summary;
            manifest = transition({ manifest, next: 'blocked' });
          }
          writeManifest({ manifest, cwd: options.repoRoot });
          continue;
        }

        // ── Normal (post-verify) review ──────────────────────
        const prUrl = manifest.prUrl;
        if (!prUrl) {
          throw new Error('PR URL not found in manifest — review requires a PR.');
        }

        if (decision.decision === 'approve') {
          try {
            execSync(`gh pr ready ${prUrl}`, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              cwd: options.repoRoot,
              timeout: 15000,
            });
          } catch {
            // Non-fatal — user can mark ready manually in GitHub UI.
          }
          pipelineLog({
            runId: manifest.runId,
            cwd: options.repoRoot,
            message: `PR marked ready: ${prUrl}`,
          });
          console.log(`\n✅ PR ready for review: ${prUrl}\n`);
          manifest = transition({ manifest, next: 'pr_created' });
        } else if (decision.decision === 'merge') {
          try {
            execSync(`gh pr ready ${prUrl}`, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              cwd: options.repoRoot,
              timeout: 15000,
            });
          } catch {
            // Draft PR — fall through to merge attempt.
          }
          execSync(`gh pr merge ${prUrl} --squash --auto --delete-branch`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options.repoRoot,
            timeout: 30000,
          });
          manifest = transition({ manifest, next: 'merged' });
          pipelineLog({
            runId: manifest.runId,
            cwd: options.repoRoot,
            message: `PR auto-merge queued: ${prUrl}`,
          });
          console.log(`\n🚀 PR auto-merge queued: ${prUrl}\n`);
        } else if (decision.decision === 'change') {
          pipelineLog({
            runId: manifest.runId,
            cwd: options.repoRoot,
            message: `PR kept open for revision: ${prUrl}`,
          });
          delete manifest.verificationFingerprint;
          delete manifest.verificationContractHash;
          updateContractStatus({ contractPath: manifest.contractPath, status: 'implemented' });
          manifest = transition({ manifest, next: 'implement' });
          await adapter.sendReviewMessage({
            paneId: reviewPaneId,
            message: `Changes requested. PR ${prUrl} stays open — implementer will push to the same branch.`,
          });
        } else {
          execSync(`gh pr close ${prUrl}`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options.repoRoot,
            timeout: 15000,
          });
          pipelineLog({
            runId: manifest.runId,
            cwd: options.repoRoot,
            message: `PR closed (rejected): ${prUrl}`,
          });
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

    // ── Blocked summary ──────────────────────────────────────
    if (manifest.currentStage === 'blocked') {
      const summary = formatBlockedSummary(manifest);
      // Write full summary to pipeline log (appears in pipeline tail tab).
      pipelineLog({
        runId: manifest.runId,
        cwd: options.repoRoot,
        message: summary,
      });
      // Print to stdout for non-herdr runs.
      console.log(summary);
    }

    return manifest;
  } finally {
    releaseLock({ contractId: manifest.contractId, cwd: options.repoRoot });
  }
};
