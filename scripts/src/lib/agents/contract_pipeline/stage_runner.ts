// scripts/src/lib/agents/contract_pipeline/stage_runner.ts
// biome-ignore-all lint/style/useNamingConvention: pipeline stage identifiers are persisted domain values
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { loadRolePrompt } from './prompt_loader.ts';
import { readStageResult, readStageUsage, writeStageResult } from './stage_result.ts';
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

/** Return the worker role for a model-driven stage. */
export const roleForStage = (stage: ContractPipelineStage): ContractWorkerRole => {
  const role = STAGE_ROLES[stage as keyof typeof STAGE_ROLES];
  if (!role) {
    throw new Error(`Stage ${stage} does not have a worker role.`);
  }
  return role;
};

/** Run one worker stage and accept only its exact structured result artifact. */
export const runStage = async (options: {
  repoRoot: string;
  runDirectory: string;
  runId: string;
  stage: ContractPipelineStage;
  attempt: number;
  contractPath: string;
  timeoutMs: number;
  pollIntervalMs?: number;
  feedback?: string;
  launchWorker: (request: WorkerLaunchRequest) => Promise<{ paneId: string }>;
}): Promise<StageRunOutcome> => {
  const role = roleForStage(options.stage);
  const resultPath = join(
    options.runDirectory,
    'stages',
    `${options.stage}-${options.attempt}.json`,
  );
  const usagePath = join(
    options.runDirectory,
    'stages',
    `${options.stage}-${options.attempt}.usage.json`,
  );
  if (existsSync(resultPath)) {
    unlinkSync(resultPath);
  }
  if (existsSync(usagePath)) {
    unlinkSync(usagePath);
  }

  const prompt = loadRolePrompt({
    role,
    contractPath: options.contractPath,
    repoRoot: options.repoRoot,
    feedback: options.feedback,
  });
  const { paneId } = await options.launchWorker({
    runId: options.runId,
    resultPath,
    usagePath,
    delivery: 'direct_prompt',
    prompt,
    contractPath: options.contractPath,
    role,
    stage: options.stage,
    attempt: options.attempt,
  });

  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const result = readStageResult({
      resultPath,
      runId: options.runId,
      role,
      attempt: options.attempt,
    });
    if (result) {
      const usageDeadline = Date.now() + 500;
      let usage = readStageUsage(usagePath);
      while (!usage && Date.now() < usageDeadline) {
        await sleep(100);
        usage = readStageUsage(usagePath);
      }
      return { result, paneId, usage };
    }
    await sleep(pollIntervalMs);
  }

  const blockedResult: ContractStageResult = {
    runId: options.runId,
    stage: role,
    attempt: options.attempt,
    status: 'blocked',
    summary: 'Stage timed out without a schema-valid completion artifact.',
    findings: ['No exact contract_stage_complete result was produced before timeout.'],
    filesTouched: [],
    evidence: [],
    contractHash: '',
    diffHash: '',
  };
  writeStageResult({ resultPath, result: blockedResult });
  return { result: blockedResult, paneId };
};
