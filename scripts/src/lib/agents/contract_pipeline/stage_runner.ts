// scripts/src/lib/agents/contract_pipeline/stage_runner.ts
// biome-ignore-all lint/style/useNamingConvention: pipeline stage identifiers are persisted domain values
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { feedbackMessage, loadRolePrompt } from './prompt_loader.ts';
import { readStageResult, writeStageResult } from './stage_result.ts';
import type {
  ContractPipelineStage,
  ContractStageResult,
  ContractWorkerRole,
  StageRunOutcome,
  WorkerLaunchRequest,
} from './types.ts';

const STAGE_ROLES = {
  write_contract: 'writer',
  critique: 'critic',
  implement: 'implementer',
  verify: 'verifier',
} as const satisfies Partial<Record<ContractPipelineStage, ContractWorkerRole>>;

const sleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

/** Continuous idle time before the worker gets a nudge to call contract_stage_complete. */
const NUDGE_AFTER_IDLE_MS = 2 * 60 * 1000;
/** Maximum nudges before allowing continuous idle to reach the idle timeout. */
const MAX_NUDGES = 3;

/** Return the worker role for a model-driven stage. */
export const roleForStage = (stage: ContractPipelineStage): ContractWorkerRole => {
  const role = STAGE_ROLES[stage as keyof typeof STAGE_ROLES];
  if (!role) {
    throw new Error(`Stage ${stage} does not have a worker role.`);
  }
  return role;
};

/**
 * Run one worker stage and accept only its exact structured result artifact.
 *
 * Timeout model:
 * - While the agent is actively working (herdr agent_status === 'working'),
 *   NO timeout accrues — an actively working pi session is never killed.
 * - Continuous idle time triggers nudges, then blocks after `idleTimeoutMs`.
 * - `hardTimeoutMs` is a generous wall-clock safety net for cases where
 *   the agent status is unobservable (herdr unreachable → assumed working).
 */
export const runStage = async (options: {
  repoRoot: string;
  runDirectory: string;
  runId: string;
  stage: ContractPipelineStage;
  attempt: number;
  contractPath: string;
  idleTimeoutMs: number;
  hardTimeoutMs: number;
  pollIntervalMs?: number;
  feedback?: string;
  launchWorker: (request: WorkerLaunchRequest) => Promise<{ paneId: string }>;
  checkAgentWorking?: (paneId: string) => Promise<boolean>;
  nudgeWorker?: (opts: { paneId: string; message: string }) => Promise<void>;
}): Promise<StageRunOutcome> => {
  const role = roleForStage(options.stage);
  const resultPath = join(
    options.runDirectory,
    'stages',
    `${options.stage}-${options.attempt}.json`,
  );

  const orphaned = readStageResult({
    resultPath,
    runId: options.runId,
    role,
    attempt: options.attempt,
  });
  if (orphaned) {
    console.log(`♻️  Adopting completed ${role} result from prior run (${orphaned.status}).`);
    return { result: orphaned, paneId: 'recovered' };
  }
  if (existsSync(resultPath)) {
    unlinkSync(resultPath);
  }

  const prompt = loadRolePrompt({
    role,
    contractPath: options.contractPath,
    repoRoot: options.repoRoot,
  });
  const userMessage = options.feedback?.trim()
    ? feedbackMessage({ role, feedback: options.feedback })
    : undefined;

  const { paneId } = await options.launchWorker({
    runId: options.runId,
    resultPath,
    delivery: 'direct_prompt',
    prompt,
    contractPath: options.contractPath,
    role,
    stage: options.stage,
    attempt: options.attempt,
    userMessage,
  });

  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const startedAt = Date.now();
  let idleMs = 0;
  let nudgesSent = 0;

  while (true) {
    const result = readStageResult({
      resultPath,
      runId: options.runId,
      role,
      attempt: options.attempt,
    });
    if (result) {
      return { result, paneId };
    }

    if (Date.now() - startedAt >= options.hardTimeoutMs) {
      break;
    }

    await sleep(pollIntervalMs);

    let isWorking = true;
    if (options.checkAgentWorking) {
      isWorking = await options.checkAgentWorking(paneId).catch(() => true);
    }
    if (isWorking) {
      idleMs = 0;
      continue;
    }

    idleMs += pollIntervalMs;
    if (idleMs >= NUDGE_AFTER_IDLE_MS && nudgesSent < MAX_NUDGES && options.nudgeWorker) {
      nudgesSent += 1;
      idleMs = 0;
      console.warn(
        `⚠️  ${role} idle for ~${Math.round(NUDGE_AFTER_IDLE_MS / 1000)}s — nudging (${nudgesSent}/${MAX_NUDGES}).`,
      );
      await options
        .nudgeWorker({
          paneId,
          message: `You finished a turn without calling contract_stage_complete. If your ${role} stage work is done, call contract_stage_complete NOW with your final status. If work remains, continue it. Do not ask questions — if stuck, complete with status blocked.`,
        })
        .catch(() => {});
      continue;
    }
    if (idleMs >= options.idleTimeoutMs) {
      break;
    }
  }

  // Final re-read — close race between last poll and blocked write.
  const lastChance = readStageResult({
    resultPath,
    runId: options.runId,
    role,
    attempt: options.attempt,
  });
  if (lastChance) {
    return { result: lastChance, paneId };
  }

  const blockedResult: ContractStageResult = {
    runId: options.runId,
    stage: role,
    attempt: options.attempt,
    status: 'blocked',
    summary: `Worker went idle for ${Math.round(options.idleTimeoutMs / 60_000)} min after ${nudgesSent} nudge(s) without a schema-valid completion artifact.`,
    findings: ['No exact contract_stage_complete result was produced before timeout.'],
    filesTouched: [],
    evidence: [],
    contractHash: '',
    diffHash: '',
  };
  writeStageResult({ resultPath, result: blockedResult });
  return { result: blockedResult, paneId };
};
