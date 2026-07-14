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
import { resolveNextStage, transition } from './state_machine.ts';
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

// ── Main orchestrator ─────────────────────────────────────────

/** Execute one contract pipeline run. */
export const runContractPipeline = async (options: {
  repoRoot: string;
  target?: string;
  resumeRunId?: string;
  fresh?: boolean;
  dryRun?: boolean;
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

            // Reconcile workspace → push branch → create draft PR for review.
            const reconciliation = reconcileWorkspace({
              manifest,
              repoRoot: options.repoRoot,
              baseBranch: PIPELINE_BASE_BRANCH,
            });
            manifest.reconciliation = reconciliation;
            const prUrl = createGitHubPr({
              headBranch: reconciliation.headBranch,
              baseBranch: reconciliation.baseBranch,
              title: reconciliation.prTitle,
              body: reconciliation.prBody,
              repoRoot: options.repoRoot,
              draft: true,
            });
            manifest.prUrl = prUrl;
            pipelineLog({
              runId: manifest.runId,
              cwd: options.repoRoot,
              message: `Draft PR created: ${prUrl}`,
            });
            console.log(`\n📦 Draft PR: ${prUrl}\n`);
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
        manifest.verifyLoops = next.verifyLoops;
        manifest = transition({ manifest, next: next.next });
        if (manifest.currentStage === 'blocked') {
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
        const reviewPath = join(
          runDirectory({ runId: manifest.runId, cwd: options.repoRoot }),
          'review',
          'decision.json',
        );
        if (existsSync(reviewPath)) {
          unlinkSync(reviewPath);
        }
        if (!manifest.reviewPaneId) {
          manifest.reviewPaneId = await adapter.startReview({
            prompt: loadReviewPrompt({
              repoRoot: options.repoRoot,
              contractPath: manifest.contractPath,
              runId: manifest.runId,
            }),
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

        const prUrl = manifest.prUrl;
        if (!prUrl) {
          throw new Error('PR URL not found in manifest — review requires a PR.');
        }

        if (decision.decision === 'approve') {
          // Mark draft PR as ready. gh pr ready may not exist in older gh CLI
          // versions — the PR remains valid regardless.
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
          execSync(`gh pr close ${prUrl}`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options.repoRoot,
            timeout: 15000,
          });
          pipelineLog({
            runId: manifest.runId,
            cwd: options.repoRoot,
            message: `PR closed (changes requested): ${prUrl}`,
          });
          delete manifest.prUrl;
          delete manifest.verificationFingerprint;
          delete manifest.verificationContractHash;
          updateContractStatus({ contractPath: manifest.contractPath, status: 'implemented' });
          manifest = transition({ manifest, next: 'implement' });
          await adapter.sendReviewMessage({
            paneId: reviewPaneId,
            message: 'Changes requested. Closed PR — starting fresh implementer run.',
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
    return manifest;
  } finally {
    releaseLock({ contractId: manifest.contractId, cwd: options.repoRoot });
  }
};
