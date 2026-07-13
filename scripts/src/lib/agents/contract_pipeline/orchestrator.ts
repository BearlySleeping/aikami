// scripts/src/lib/agents/contract_pipeline/orchestrator.ts
// biome-ignore-all lint/style/useNamingConvention: pipeline stage identifiers are persisted domain values
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findWorkspace, herdrJson } from '../../herdr/session.ts';
import { provisionJjWorkspace, runJj } from '../jj.ts';
import { resolveContract } from './contract_resolver.ts';
import { readContractStatus, updateContractStatus } from './contract_status.ts';
import { captureGitState, changedPaths, currentCommit } from './git_state.ts';
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
import { isFingerprintCurrent, stageAfterReviewChanges } from './review_gate.ts';
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
import { STATUS_TO_START_STAGE } from './types.ts';

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

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Find previous run IDs for a contract, sorted newest first. */
const findPreviousRuns = (options: { contractId: string; cwd: string }): string[] => {
  const runsDirectory = join(options.cwd, '.pi/contract-runs');
  if (!existsSync(runsDirectory)) {
    return [];
  }
  const safeId = options.contractId.replace(/[^A-Za-z0-9]/g, '-');
  return readdirSync(runsDirectory)
    .filter((entry) => entry.startsWith('run-') && entry.endsWith(safeId))
    .sort()
    .reverse();
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
    const validDecisions: ReviewDecision[] = [
      'approve',
      'approve_pr',
      'approve_merge',
      'changes_applied',
      'reject',
      'blocked',
    ];
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
 * Reconcile the isolated jj workspace: push change as a bookmark, return
 * head branch info for PR creation. The workspace is NOT deleted — it
 * persists until the user merges or explicitly cleans up.
 */
const reconcileWorkspace = (options: {
  manifest: RunManifest;
  repoRoot: string;
  baseBranch?: string;
}): ReconciliationResult => {
  // Find workspace path from attempts — the implementer/verifier ran there.
  const workspaceRunName = `run-${options.manifest.runId}`;
  const { workspacePath, changeId } = provisionJjWorkspace({
    repoRoot: options.repoRoot,
    name: workspaceRunName,
    baseRevision: options.baseBranch ?? 'dev',
  });

  const baseBookmark = `contract-task-${options.manifest.contractId.toLowerCase()}-${options.manifest.runId.slice(-8)}`;
  const baseBranch = options.baseBranch ?? 'dev';

  // Check for collision, append token if needed.
  let bookmarkName = baseBookmark;
  try {
    const remoteCheck = execSync(`git ls-remote --heads origin refs/heads/${baseBookmark}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.repoRoot,
      timeout: 10000,
    }).trim();
    if (remoteCheck) {
      const token = Date.now().toString(36).slice(-6);
      bookmarkName = `${baseBookmark}-${token}`;
    }
  } catch {
    // Can't check — proceed.
  }

  // Finalize description, create bookmark, push — via the shared jj lib
  // (correct identity quoting + git-lock retry).
  const finalMsg = `Feat: Contract ${options.manifest.contractId} (run ${options.manifest.runId})`;
  runJj(`describe -m "${finalMsg}"`, { cwd: workspacePath });
  runJj(`bookmark create ${bookmarkName} -r @`, { cwd: workspacePath });
  runJj(`git push --remote origin -b ${bookmarkName}`, { cwd: workspacePath });

  const prTitle = `Contract ${options.manifest.contractId} — Automated Resolution`;
  const prBody = [
    `## Automated PR`,
    '',
    `- **Contract ID:** \`${options.manifest.contractId}\``,
    `- **Change ID:** \`${changeId}\``,
    `- **Bookmark:** \`${bookmarkName}\``,
    `- **Pipeline Run:** \`${options.manifest.runId}\``,
    '',
    `Generated by Pi Contract Pipeline.`,
  ].join('\n');

  return {
    changeId,
    bookmarkName,
    headBranch: bookmarkName,
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
}): string => {
  const gh = (args: string[]): string =>
    execSync(`gh ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: options.repoRoot,
      timeout: 30000,
    }).trim();

  const result = gh([
    'pr',
    'create',
    '--head',
    options.headBranch,
    '--base',
    options.baseBranch,
    '--title',
    `"${options.title}"`,
    '--body',
    `"${options.body}"`,
  ]);

  // Extract PR URL from gh output.
  const urlMatch = result.match(/https:\/\/github\.com\/[^\s]+/);
  return urlMatch?.[0] ?? result;
};

/**
 * Execute the full accept pipeline: reconcile → create PR → optionally merge.
 */
const executeAcceptPipeline = async (options: {
  manifest: RunManifest;
  repoRoot: string;
  decision: ContractReviewDecision;
}): Promise<RunManifest> => {
  let manifest = { ...options.manifest };

  const reconciliation = reconcileWorkspace({
    manifest,
    repoRoot: options.repoRoot,
    baseBranch: 'dev',
  });
  manifest = transition({ manifest, next: 'reconciling' });
  manifest.reconciliation = reconciliation;
  writeManifest({ manifest, cwd: options.repoRoot });
  pipelineLog({
    runId: manifest.runId,
    cwd: options.repoRoot,
    message: `Reconciled workspace → bookmark ${reconciliation.bookmarkName}.`,
  });

  if (options.decision.decision === 'approve_pr' || options.decision.decision === 'approve_merge') {
    const prUrl = createGitHubPr({
      headBranch: reconciliation.headBranch,
      baseBranch: reconciliation.baseBranch,
      title: reconciliation.prTitle,
      body: reconciliation.prBody ?? '',
      repoRoot: options.repoRoot,
    });
    manifest = transition({ manifest, next: 'pr_created' });
    manifest.reconciliation = { ...reconciliation, prUrl };
    writeManifest({ manifest, cwd: options.repoRoot });
    pipelineLog({
      runId: manifest.runId,
      cwd: options.repoRoot,
      message: `PR created: ${prUrl}`,
    });
    console.log(`\n🔗 PR created: ${prUrl}\n`);

    if (options.decision.decision === 'approve_merge') {
      // Auto-merge via squash.
      execSync(`gh pr merge ${prUrl} --squash --auto --delete-branch`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: options.repoRoot,
        timeout: 30000,
      });
      manifest = transition({ manifest, next: 'merged' });
      manifest.reconciliation = {
        ...manifest.reconciliation,
        prUrl,
        merged: true,
      } as ReconciliationResult;
      writeManifest({ manifest, cwd: options.repoRoot });
      pipelineLog({
        runId: manifest.runId,
        cwd: options.repoRoot,
        message: `PR merged (auto-merge enabled).`,
      });
      console.log(`\n🚀 PR auto-merge queued. jj_sync dev to update your local bookmark.\n`);
    }
  }

  return manifest;
};

// ── Main orchestrator ─────────────────────────────────────────

/** Execute one contract pipeline run. */
export const runContractPipeline = async (options: {
  repoRoot: string;
  target?: string;
  resumeRunId?: string;
  allowDirty?: boolean;
  dryRun?: boolean;
  onReady?: (manifest: RunManifest) => void;
  adapterFactory?: (options: {
    repoRoot: string;
    runId: string;
    contractId: string;
  }) => ContractHerdrAdapterInterface;
}): Promise<RunManifest> => {
  let manifest: RunManifest;
  if (options.resumeRunId) {
    const resumed = readManifest({ runId: options.resumeRunId, cwd: options.repoRoot });
    if (!resumed) {
      throw new Error(`Run ${options.resumeRunId} is not a valid v3 manifest.`);
    }
    manifest = resumed;
    delete manifest.reviewPaneId;

    const contractStatus = readContractStatus(manifest.contractPath);
    const contractStage = STATUS_TO_START_STAGE[contractStatus] ?? 'write_contract';

    const stageOrder: ContractPipelineStage[] = [
      'write_contract',
      'critique',
      'implement',
      'verify',
    ];
    const lastCompleted = manifest.attempts
      .filter((a) => a.result?.status === 'passed')
      .reduce<ContractPipelineStage | null>((latest, a) => {
        const aIdx = stageOrder.indexOf(a.stage);
        const lIdx = latest ? stageOrder.indexOf(latest) : -1;
        return aIdx > lIdx ? a.stage : latest;
      }, null);
    const lastAttempted = manifest.attempts[manifest.attempts.length - 1]?.stage;
    const resumeStage = lastCompleted
      ? (stageOrder[stageOrder.indexOf(lastCompleted) + 1] ?? lastAttempted ?? contractStage)
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
    const dirtyPaths = changedPaths(options.repoRoot).filter(
      (path) => !path.startsWith('docs/') && path !== 'flake.lock',
    );
    if (dirtyPaths.length > 0 && !options.allowDirty) {
      const contractId = (options.target ?? '').toUpperCase();
      const previousRuns = findPreviousRuns({ contractId, cwd: options.repoRoot });
      const resumeHint =
        previousRuns.length > 0
          ? `\n\n💡 A previous pipeline run exists for ${contractId}. Resume it:\n   bun contract --resume ${previousRuns[0]}`
          : '\n\n💡 No previous run found. Use --allow-dirty to proceed, or commit/stash changes.';
      const pathList = dirtyPaths
        .slice(0, 10)
        .map((path) => `   - ${path}`)
        .join('\n');
      const truncated = dirtyPaths.length > 10 ? `\n   ... and ${dirtyPaths.length - 10} more` : '';
      throw new Error(
        `Worktree is dirty (${dirtyPaths.length} changed files):\n${pathList}${truncated}${resumeHint}`,
      );
    }
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
      manifest.currentStage !== 'accepted' &&
      manifest.currentStage !== 'reconciling' &&
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

        if (
          decision.decision === 'approve' ||
          decision.decision === 'approve_pr' ||
          decision.decision === 'approve_merge'
        ) {
          const workspacePath = adapter.getWorkspacePath();
          const cwdForFingerprint = workspacePath || options.repoRoot;
          const currentFingerprint = captureGitState(cwdForFingerprint).fingerprint;

          if (
            !isFingerprintCurrent({
              storedFingerprint: manifest.verificationFingerprint,
              currentFingerprint,
            })
          ) {
            await adapter.sendReviewMessage({
              paneId: reviewPaneId,
              message:
                'Approval rejected: code changed after verification. Request re-verification.',
            });
            continue;
          }

          // Execute accept pipeline (may reconcile, create PR, merge).
          manifest = await executeAcceptPipeline({
            manifest,
            repoRoot: options.repoRoot,
            decision,
          });
          writeManifest({ manifest, cwd: options.repoRoot });

          // Show the final status.
          const prUrl = manifest.reconciliation?.prUrl;
          const merged = manifest.reconciliation?.merged;
          if (merged) {
            console.log(`\n🚀 Pipeline complete — ${manifest.contractId} merged.\n`);
          } else if (prUrl) {
            console.log(`\n📦 Pipeline complete — PR ready: ${prUrl}\n`);
          } else {
            console.log(`\n✅ Pipeline complete — ${manifest.contractId} accepted.\n`);
          }
        } else if (decision.decision === 'changes_applied') {
          delete manifest.verificationFingerprint;
          delete manifest.verificationContractHash;
          const nextStage = stageAfterReviewChanges(decision.contractChanged);
          if (nextStage === 'critique') {
            updateContractStatus({ contractPath: manifest.contractPath, status: 'draft' });
          } else {
            updateContractStatus({ contractPath: manifest.contractPath, status: 'implemented' });
          }
          manifest = transition({ manifest, next: nextStage });
          await adapter.sendReviewMessage({
            paneId: reviewPaneId,
            message:
              nextStage === 'verify'
                ? 'Code changes recorded. Starting fresh independent verifier.'
                : 'Contract changes recorded. Starting fresh critique.',
          });
        } else {
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
