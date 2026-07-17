// scripts/src/lib/agents/contract_pipeline/orchestrator.ts
// biome-ignore-all lint/style/useNamingConvention: pipeline stage identifiers are persisted domain values
import { execSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { findWorkspace } from '../../herdr/session.ts';
import {
  commitAll,
  provisionGitWorktree,
  pushBranch,
  remoteBranchExists,
  removeWorktree,
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

const TERMINAL_STAGES: readonly ContractPipelineStage[] = ['pr_created', 'merged'];

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

const verifierFeedback = (options: {
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
    const d = readReviewDecision(options.path, options.runId);
    if (d) {
      return d;
    }
    await sleep(1_000);
  }
};

// ── Reconciliation ───────────────────────────────────────────

const reconcileWorkspace = (options: {
  manifest: RunManifest;
  repoRoot: string;
  baseBranch?: string;
}): ReconciliationResult => {
  const workspaceRunName = options.manifest.runId;
  const { workspacePath, branchName } = provisionGitWorktree({
    repoRoot: options.repoRoot,
    name: workspaceRunName,
    baseRevision: options.baseBranch ?? PIPELINE_BASE_BRANCH,
  });

  // Restore .envrc / .pi/settings.json from base (origin/main), not HEAD.
  const b = options.baseBranch ?? PIPELINE_BASE_BRANCH;
  let resolvedBase: string | undefined;
  try {
    resolvedBase = runGit(`rev-parse --verify origin/${b}`, { cwd: options.repoRoot });
  } catch {
    try {
      resolvedBase = runGit(`rev-parse --verify ${b}`, { cwd: options.repoRoot });
    } catch {}
  }
  if (resolvedBase) {
    for (const fp of [
      '.envrc',
      '.pi/settings.json',
      'docs/contracts/PROGRESS.md',
      'docs/contracts/PROMOTION.md',
    ]) {
      try {
        runGit(`restore --source=${resolvedBase} -- '${fp}'`, { cwd: workspacePath });
      } catch {}
    }
  }

  const runToken = options.manifest.runId.replace(/^run-/, '').split('-')[0];
  const baseBranchName = `contract-task-${options.manifest.contractId.toLowerCase()}-${runToken}`;
  let headBranch = baseBranchName;
  if (remoteBranchExists({ branchName: baseBranchName, repoRoot: options.repoRoot })) {
    headBranch = `${baseBranchName}-${Date.now().toString(36).slice(-6)}`;
  }
  if (branchName !== headBranch) {
    try {
      runGit(`branch -m ${branchName} ${headBranch}`, { cwd: workspacePath });
    } catch {
      headBranch = branchName;
    }
  }

  const finalMsg = `Feat: Contract ${options.manifest.contractId} (run ${options.manifest.runId})`;
  const finalCommit = commitAll({
    cwd: workspacePath,
    message: finalMsg,
    authorName: 'Pi Agent',
    authorEmail: 'agent@pi.internal',
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

const buildBlockedReviewPrompt = (options: { manifest: RunManifest; repoRoot: string }): string => {
  const r = options.manifest.reconciliation;
  const basePrompt = loadReviewPrompt({
    repoRoot: options.repoRoot,
    contractPath: options.manifest.contractPath,
    runId: options.manifest.runId,
    prUrl: undefined,
    headBranch: r?.headBranch,
    baseBranch: r?.baseBranch,
  });
  const summary = formatBlockedSummary(options.manifest);
  const lastVerifyPassed = [...options.manifest.attempts]
    .reverse()
    .find((a) => a.stage === 'verify' && a.result?.status === 'passed');
  const isLoopExhaustion =
    options.manifest.verifyLoops >= MAX_VERIFY_LOOPS &&
    options.manifest.attempts.filter((a) => a.stage === 'verify').length >= MAX_VERIFY_LOOPS;

  if (lastVerifyPassed && !isLoopExhaustion) {
    return [
      basePrompt,
      '',
      '## ⚠️ POST-VERIFY FAILURE — Review Captain',
      '',
      '**Verification PASSED.** All tests are green, the code is ready.',
      '',
      '**🔴 CRITICAL: No PR exists.** The branch is pushed but PR creation failed.',
      'The base prompt above shows the branch and compare URL.',
      'Do NOT claim a PR exists.',
      '',
      '### Verifier findings (all passed)',
      summary,
      '',
      '### Decision shortcuts',
      '- "fix" or "retry" → `change` (retries reconciliation — only works if gh auth is fixed)',
      '- "reject" or "abandon" → `reject` (exit with summary)',
      '',
      '🔴 Your LAST action must call `contract_review_decision`.',
    ].join('\n');
  }
  return [
    basePrompt,
    '',
    '## ⚠️ BLOCKED PIPELINE — Review Captain Override',
    '',
    'This pipeline is **blocked** — the verifier found issues the implementer',
    'could not resolve within the bounce limit.',
    '',
    '### What happened',
    summary,
    '',
    '### Your options',
    '',
    '**1. Create a PR anyway** — `contract_review_decision` with `approve` or `merge`',
    '   - `approve`: Create a ready PR (draft=false). CodeRabbit reviews immediately.',
    '   - `merge`: Create a PR and auto-merge with squash.',
    '',
    '**2. Retry the implementer** — `contract_review_decision` with `change`',
    '',
    '**3. Abandon** — `contract_review_decision` with `reject`',
    '',
    '### Decision shortcuts',
    '- "approve" or "create PR" → `approve`',
    '- "merge" or "send it" → `merge`',
    '- "fix" or "retry" → `change`',
    '- "reject" or "abandon" → `reject`',
    '',
    '🔴 Your LAST action must call `contract_review_decision`.',
  ].join('\n');
};

// ── Merge helpers ────────────────────────────────────────────

const syncMainOnMerge = (repoRoot: string): void => {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: repoRoot,
      timeout: 5000,
    }).trim();
    if (branch === 'main' || branch === 'master') {
      execSync('git pull --ff-only origin main', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: repoRoot,
        timeout: 30000,
      });
      console.log('\n📥 Pulled latest main\n');
    }
  } catch (e: unknown) {
    console.warn(
      `⚠️  Could not sync main: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
    );
  }
};

const cleanupAfterMerge = (repoRoot: string, workspacePath: string, branchName: string): void => {
  try {
    removeWorktree({ workspacePath, repoRoot, branchName, deleteRemoteBranch: false });
    console.log(`\n🧹 Worktree cleaned: ${branchName}\n`);
  } catch (e: unknown) {
    console.warn(
      `⚠️  Worktree cleanup failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
    );
  }
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
    const contractStage = STATUS_TO_START_STAGE[cs] ?? 'write_contract';
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
    manifest = createManifest({
      contractId: contract.id,
      contractPath: contract.path,
      baseCommit: currentCommit(options.repoRoot),
      baselineFingerprint: captureGitState(options.repoRoot).fingerprint,
      startStage: STATUS_TO_START_STAGE[contract.status] ?? 'write_contract',
    });
    writeManifest({ manifest, cwd: options.repoRoot });
  }
  if (options.dryRun) {
    return manifest;
  }

  const buildWsLabel = (cid: string): string => `aikami-contract-${cid}`;
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
        const cwdForGit =
          wPath && (stage === 'implement' || stage === 'verify') ? wPath : options.repoRoot;
        const before = captureGitState(cwdForGit);
        const feedback =
          stage === 'implement' ? verifierFeedback({ manifest, attempt }) : undefined;

        const outcome = await runStage({
          repoRoot: options.repoRoot,
          runDirectory: runDirectory({ runId: manifest.runId, cwd: options.repoRoot }),
          runId: manifest.runId,
          stage,
          attempt,
          contractPath: manifest.contractPath,
          idleTimeoutMs: IDLE_TIMEOUT_MS,
          hardTimeoutMs: STAGE_HARD_CAPS[stage] ?? 8 * 60 * 60 * 1000,
          feedback,
          launchWorker: (req) => adapter.launchWorker(req),
          checkAgentWorking: (pid) => adapter.isWorkerActive(pid),
          nudgeWorker: (opts) => adapter.nudgeWorker(opts),
        });
        const after = captureGitState(cwdForGit);

        if (
          wPath &&
          (stage === 'write_contract' || stage === 'critique') &&
          existsSync(manifest.contractPath)
        ) {
          const wcp = join(wPath, relative(options.repoRoot, manifest.contractPath));
          try {
            mkdirSync(dirname(wcp), { recursive: true });
            copyFileSync(manifest.contractPath, wcp);
          } catch {}
        }
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
            }
          }
        }

        const pc = validatePostconditions({
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
          // Commit implementer changes to the worktree branch.
          // The verifier runs next and expects a clean git state — untracked
          // implementation files would otherwise be flagged as missing.
          if (wPath) {
            try {
              commitAll({
                cwd: wPath,
                message: `Feat: Contract ${manifest.contractId} — implementation`,
                authorName: 'Pi Agent',
                authorEmail: 'agent@pi.internal',
              });
              pipelineLog({
                runId: manifest.runId,
                cwd: options.repoRoot,
                message: 'Implementer changes committed to worktree.',
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
          updateContractStatus({ contractPath: manifest.contractPath, status: 'approved' });
          // Commit the approved contract to the worktree branch.
          // This gives the PR a base commit with the contract file so the
          // implementer's execution report and status updates are incremental
          // diffs instead of a full-file addition — no merge conflicts.
          if (wPath && existsSync(manifest.contractPath)) {
            try {
              const wcp = join(wPath, relative(options.repoRoot, manifest.contractPath));
              mkdirSync(dirname(wcp), { recursive: true });
              copyFileSync(manifest.contractPath, wcp);
              commitAll({
                cwd: wPath,
                message: `docs(contracts): approve ${manifest.contractId}`,
                authorName: 'Pi Agent',
                authorEmail: 'agent@pi.internal',
              });
              pipelineLog({
                runId: manifest.runId,
                cwd: options.repoRoot,
                message: 'Approved contract committed to worktree branch.',
              });
            } catch (commitErr: unknown) {
              const msg = commitErr instanceof Error ? commitErr.message : String(commitErr);
              console.warn(`⚠️  Contract commit failed (non-fatal): ${msg.slice(0, 200)}`);
            }
          }
          // Also commit + push the approved contract to main.
          // After this, worktrees branching from main have the contract.
          // Implementer/verifier changes stay in the worktree → PR → main.
          try {
            const contractRelPath = relative(options.repoRoot, manifest.contractPath);
            runGit(`add -- '${contractRelPath}'`, { cwd: options.repoRoot });
            runGit(`commit -m "docs(contracts): approve ${manifest.contractId}"`, {
              cwd: options.repoRoot,
              env: {
                CONTRACT_PIPELINE_WORKTREE: '1',
                GIT_AUTHOR_NAME: 'Pi Agent',
                GIT_AUTHOR_EMAIL: 'agent@pi.internal',
                GIT_COMMITTER_NAME: 'Pi Agent',
                GIT_COMMITTER_EMAIL: 'agent@pi.internal',
              },
            });
            runGit('push origin main', { cwd: options.repoRoot });
            pipelineLog({
              runId: manifest.runId,
              cwd: options.repoRoot,
              message: 'Approved contract pushed to main.',
            });
          } catch (pushErr: unknown) {
            const msg = pushErr instanceof Error ? pushErr.message : String(pushErr);
            console.warn(`⚠️  Push contract to main failed (non-fatal): ${msg.slice(0, 200)}`);
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
                manifest.reconciliation = reconcileWorkspace({
                  manifest,
                  repoRoot: options.repoRoot,
                  baseBranch: PIPELINE_BASE_BRANCH,
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
        manifest = transition({ manifest, next: next.next });
        if (exhausted) {
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
        const headBranch = manifest.reconciliation?.headBranch;
        const baseBranch = manifest.reconciliation?.baseBranch ?? PIPELINE_BASE_BRANCH;
        const reviewPath = join(
          runDirectory({ runId: manifest.runId, cwd: options.repoRoot }),
          'review',
          'decision.json',
        );
        if (existsSync(reviewPath)) {
          unlinkSync(reviewPath);
        }

        // Reconnect to live pane on resume.
        if (manifest.reviewPaneId) {
          const alive = await adapter.isPaneAlive(manifest.reviewPaneId).catch(() => false);
          if (alive) {
            if (manifest.reviewDecision === undefined) {
              await adapter.sendReviewMessage({
                paneId: manifest.reviewPaneId,
                message: `Pipeline resumed. Your session was preserved — continue from where you left off. Branch \`${headBranch ?? 'unknown'}\` is still pushed.`,
              });
            }
          } else {
            manifest.reviewPaneId = undefined;
            writeManifest({ manifest, cwd: options.repoRoot });
          }
        }
        if (!manifest.reviewPaneId) {
          const prompt = isBlockedReview
            ? buildBlockedReviewPrompt({ manifest, repoRoot: options.repoRoot })
            : loadReviewPrompt({
                repoRoot: options.repoRoot,
                contractPath: manifest.contractPath,
                runId: manifest.runId,
                prUrl: undefined,
                headBranch,
                baseBranch,
                ready: options.ready,
                yolo: options.yolo,
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
            const r = execSync(
              `gh pr list --head '${headBranch}' --state open --json url --jq '.[0].url'`,
              {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: options.repoRoot,
                timeout: 10000,
              },
            ).trim();
            if (r) {
              manifest.prUrl = r;
            }
            return r || undefined;
          } catch {
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
                execSync(`gh pr ready ${prUrl}`, {
                  encoding: 'utf-8',
                  stdio: ['pipe', 'pipe', 'pipe'],
                  cwd: options.repoRoot,
                  timeout: 15000,
                });
              } catch {}
              console.log(`\n✅ PR ready: ${prUrl}\n`);
              manifest = transition({ manifest, next: 'pr_created' });
            } else {
              try {
                execSync(`gh pr ready ${prUrl}`, {
                  encoding: 'utf-8',
                  stdio: ['pipe', 'pipe', 'pipe'],
                  cwd: options.repoRoot,
                  timeout: 15000,
                });
              } catch {}
              execSync(`gh pr merge ${prUrl} --squash --delete-branch`, {
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: options.repoRoot,
                timeout: 60000,
              });
              syncMainOnMerge(options.repoRoot);
              if (headBranch && adapter.getWorkspacePath()) {
                cleanupAfterMerge(options.repoRoot, adapter.getWorkspacePath(), headBranch);
              }
              manifest = transition({ manifest, next: 'merged' });
              console.log(`\n🚀 Merged + cleaned: ${prUrl}\n`);
            }
          } else if (decision.decision === 'change') {
            console.log('\n🔄 Retrying — back to implementer.\n');
            manifest.verifyLoops = 0;
            manifest.blockedReason = undefined;
            delete manifest.verificationFingerprint;
            delete manifest.verificationContractHash;
            // Status tracked in run manifest — don't touch main contract.
            manifest = transition({ manifest, next: 'implement' });
          } else {
            const prUrl = findPrUrl();
            if (prUrl) {
              try {
                execSync(`gh pr close ${prUrl}`, {
                  encoding: 'utf-8',
                  stdio: ['pipe', 'pipe', 'pipe'],
                  cwd: options.repoRoot,
                  timeout: 15000,
                });
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
            execSync(`gh pr ready ${prUrl}`, {
              encoding: 'utf-8',
              stdio: ['pipe', 'pipe', 'pipe'],
              cwd: options.repoRoot,
              timeout: 15000,
            });
          } catch {}
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
          } catch {}

          // YOLO: the review captain already waited for CodeRabbit and applied
          // autofixes. Merge immediately — no orchestrator-side polling needed.
          if (options.yolo) {
            console.log('\n🚀 YOLO: auto-merging (captain handled CodeRabbit).\n');
          }

          execSync(`gh pr merge ${prUrl} --squash --delete-branch`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options.repoRoot,
            timeout: 60000,
          });
          syncMainOnMerge(options.repoRoot);
          if (headBranch && adapter.getWorkspacePath()) {
            cleanupAfterMerge(options.repoRoot, adapter.getWorkspacePath(), headBranch);
          }
          manifest = transition({ manifest, next: 'merged' });
          pipelineLog({
            runId: manifest.runId,
            cwd: options.repoRoot,
            message: `PR merged: ${prUrl}`,
          });
          console.log(`\n🚀 Merged + cleaned: ${prUrl}\n`);
        } else if (decision.decision === 'change') {
          pipelineLog({
            runId: manifest.runId,
            cwd: options.repoRoot,
            message: `PR kept open for revision: ${prUrl}`,
          });
          delete manifest.verificationFingerprint;
          delete manifest.verificationContractHash;
          // Status tracked in run manifest — don't touch main contract.
          manifest = transition({ manifest, next: 'implement' });
        } else {
          execSync(`gh pr close ${prUrl}`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: options.repoRoot,
            timeout: 15000,
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
    if (manifest.currentStage === 'blocked') {
      const s = formatBlockedSummary(manifest);
      pipelineLog({ runId: manifest.runId, cwd: options.repoRoot, message: s });
      console.log(s);
    }
    return manifest;
  } finally {
    releaseLock({ contractId: manifest.contractId, cwd: options.repoRoot });
  }
};
