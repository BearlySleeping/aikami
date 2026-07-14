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
 * Feedback from prior stages is sent as a user message (not system prompt)
 * so that DeepSeek's prefix cache stays valid across retries.
 */
export const runStage = async (options: {
  repoRoot: string;
  runDirectory: string;
  runId: string;
  stage: ContractPipelineStage;
  attempt: number;
  contractPath: string;
  timeoutMs: number;
  pollIntervalMs?: number;
  /** Raw feedback from prior stage. Sent as user message, not injected into system prompt. */
  feedback?: string;
  launchWorker: (request: WorkerLaunchRequest) => Promise<{ paneId: string }>;
  /** Check whether the agent in the worker pane is actively working. Only working time counts toward the timeout. */
  checkAgentWorking?: (paneId: string) => Promise<boolean>;
}): Promise<StageRunOutcome> => {
  const role = roleForStage(options.stage);
  const resultPath = join(
    options.runDirectory,
    'stages',
    `${options.stage}-${options.attempt}.json`,
  );
  if (existsSync(resultPath)) {
    unlinkSync(resultPath);
  }

  // System prompt is static — no feedback injected.
  const prompt = loadRolePrompt({
    role,
    contractPath: options.contractPath,
    repoRoot: options.repoRoot,
  });

  // Feedback goes as a user message so the system prompt prefix cache stays valid.
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
  let activeMs = 0;
  let idleChecks = 0;
  while (activeMs < options.timeoutMs) {
    const result = readStageResult({
      resultPath,
      runId: options.runId,
      role,
      attempt: options.attempt,
    });
    if (result) {
      return { result, paneId };
    }
    await sleep(pollIntervalMs);

    // Only count time toward the timeout when the agent is actively working.
    if (options.checkAgentWorking) {
      try {
        const isWorking = await options.checkAgentWorking(paneId);
        if (isWorking) {
          activeMs += pollIntervalMs;
          idleChecks = 0;
        } else {
          idleChecks += 1;
          // After 120 idle polls (~60s), nudge the agent to complete.
          if (idleChecks === 120) {
            console.warn(`⚠️  ${role} idle for ~60s — nudging to complete.`);
            idleChecks = 0;
            // We can't re-send text here (different pane context), but we count
            // idle time toward timeout to eventually force failure.
          }
        }
      } catch {
        activeMs += pollIntervalMs;
      }
    } else {
      activeMs += pollIntervalMs;
    }
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
