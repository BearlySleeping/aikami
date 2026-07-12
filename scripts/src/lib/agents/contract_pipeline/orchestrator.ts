// scripts/src/lib/agents/contract_pipeline/orchestrator.ts
// biome-ignore-all lint/style/useNamingConvention: pipeline stage identifiers are persisted domain values
import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findWorkspace } from '../../herdr/session.ts';
import { resolveContract } from './contract_resolver.ts';
import { readContractStatus, updateContractStatus } from './contract_status.ts';
import { captureGitState, changedPaths, contentHash, currentCommit } from './git_state.ts';
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
  RunManifest,
} from './types.ts';
import { STATUS_TO_START_STAGE } from './types.ts';

const STAGE_TIMEOUTS: Record<string, number> = {
  write_contract: 20 * 60 * 1000,
  critique: 15 * 60 * 1000,
  implement: 60 * 60 * 1000,
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

const feedbackForStage = (options: {
  manifest: RunManifest;
  stage: ContractPipelineStage;
}): string | undefined => {
  const sourceRole = options.stage === 'write_contract' ? 'critic' : 'verifier';
  if (options.stage !== 'write_contract' && options.stage !== 'implement') {
    return undefined;
  }
  const attempt = [...options.manifest.attempts]
    .reverse()
    .find((candidate) => candidate.role === sourceRole && candidate.result);
  if (!attempt?.result) {
    return undefined;
  }
  return [attempt.result.summary, ...attempt.result.findings.map((item) => `- ${item}`)].join('\n');
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
    if (
      value.runId !== runId ||
      typeof value.decision !== 'string' ||
      !['approve', 'changes_applied', 'reject', 'blocked'].includes(value.decision) ||
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
  } else {
    if (!options.target) {
      throw new Error('A contract ID or path is required for a new run.');
    }
    const dirtyPaths = changedPaths(options.repoRoot).filter(
      (path) => !path.startsWith('docs/') && path !== 'flake.lock',
    );
    if (dirtyPaths.length > 0 && !options.allowDirty) {
      throw new Error(
        `Contract pipeline requires a clean worktree. Dirty paths:\n${dirtyPaths.map((path) => `- ${path}`).join('\n')}`,
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
        // Workspace is contract-based: aikami-contract-{contractId}
        const wsId = await findWorkspace(buildWorkspaceLabel(manifest.contractId));
        return wsId !== null;
      } catch {
        // Herdr not reachable — assume workspace is dead.
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

    while (manifest.currentStage !== 'accepted' && manifest.currentStage !== 'blocked') {
      if (WORKER_STAGES.includes(manifest.currentStage)) {
        const stage = manifest.currentStage;
        const role = roleForStage(stage);
        const attempt = manifest.attempts.filter((entry) => entry.stage === stage).length + 1;
        const before = captureGitState(options.repoRoot);
        const startTime = new Date().toISOString();
        const outcome = await runStage({
          repoRoot: options.repoRoot,
          runDirectory: runDirectory({ runId: manifest.runId, cwd: options.repoRoot }),
          runId: manifest.runId,
          stage,
          attempt,
          contractPath: manifest.contractPath,
          timeoutMs: STAGE_TIMEOUTS[stage] ?? 30 * 60 * 1000,
          feedback: feedbackForStage({ manifest, stage }),
          launchWorker: (request) => adapter.launchWorker(request),
        });
        const after = captureGitState(options.repoRoot);

        // After writer succeeds, discover the actual contract file.
        // The resolver uses a placeholder path; contract_generate creates the real file.
        if (stage === 'write_contract' && outcome.result.status === 'passed') {
          const contractsDirectory = resolve(options.repoRoot, 'docs/contracts');
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

        const postconditions = validatePostconditions({
          role,
          contractPath: manifest.contractPath,
          repoRoot: options.repoRoot,
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

        if (stage === 'critique' && result.status === 'passed') {
          updateContractStatus({ contractPath: manifest.contractPath, status: 'approved' });
        }
        if (stage === 'verify') {
          if (result.status === 'passed') {
            updateContractStatus({ contractPath: manifest.contractPath, status: 'verified' });
            manifest.verificationFingerprint = captureGitState(options.repoRoot).fingerprint;
            manifest.verificationContractHash = contentHash(manifest.contractPath);
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
          criticLoops: manifest.criticLoops,
          verifyLoops: manifest.verifyLoops,
        });
        manifest.criticLoops = next.criticLoops;
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
        if (decision.decision === 'approve') {
          const currentFingerprint = captureGitState(options.repoRoot).fingerprint;
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
          manifest = transition({ manifest, next: 'accepted' });
        } else if (decision.decision === 'changes_applied') {
          delete manifest.verificationFingerprint;
          delete manifest.verificationContractHash;
          const nextStage = stageAfterReviewChanges(decision.contractChanged);
          if (nextStage === 'critique') {
            updateContractStatus({ contractPath: manifest.contractPath, status: 'draft' });
            manifest = transition({ manifest, next: nextStage });
            await adapter.sendReviewMessage({
              paneId: reviewPaneId,
              message:
                'Contract content changed. The orchestrator is starting a fresh contract critique before implementation verification.',
            });
          } else {
            updateContractStatus({ contractPath: manifest.contractPath, status: 'implemented' });
            manifest = transition({ manifest, next: nextStage });
            await adapter.sendReviewMessage({
              paneId: reviewPaneId,
              message:
                'Code changes recorded. The orchestrator is starting a fresh independent verifier.',
            });
          }
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
