// scripts/src/lib/agents/contract_pipeline/stage_result.ts
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ContractStageResult, ContractWorkerRole, StageUsage } from './types.ts';

const WORKER_ROLES: readonly ContractWorkerRole[] = ['writer', 'critic', 'implementer', 'verifier'];
const RESULT_STATUSES = ['passed', 'changes_requested', 'blocked', 'failed'] as const;
const HALT_SOURCES = ['cost_guard', 'hard_timeout'] as const;

/**
 * True when a supervisor (cost guard / hard timeout) wrote this result on the
 * worker's behalf, so it is a provisional guess rather than the worker's own
 * verdict. See the `haltedBy` doc comment in types.ts.
 */
export const isGuardHalt = (result: ContractStageResult): boolean => result.haltedBy !== undefined;

/** Validate an unknown value as a stage result for an exact attempt. */
export const validateStageResult = (options: {
  value: unknown;
  runId: string;
  role: ContractWorkerRole;
  attempt: number;
}): ContractStageResult | undefined => {
  if (typeof options.value !== 'object' || options.value === undefined) {
    return undefined;
  }
  const value = options.value as Partial<ContractStageResult>;
  if (
    value.runId !== options.runId ||
    value.stage !== options.role ||
    value.attempt !== options.attempt ||
    !WORKER_ROLES.includes(value.stage) ||
    typeof value.status !== 'string' ||
    !RESULT_STATUSES.includes(value.status as (typeof RESULT_STATUSES)[number]) ||
    typeof value.summary !== 'string' ||
    !Array.isArray(value.findings) ||
    !value.findings.every((item) => typeof item === 'string') ||
    !Array.isArray(value.filesTouched) ||
    !value.filesTouched.every((item) => typeof item === 'string') ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every((item) => typeof item === 'string') ||
    typeof value.contractHash !== 'string' ||
    typeof value.diffHash !== 'string' ||
    // Optional, but when present it must be one of the known supervisors —
    // an unrecognised value would silently make a real worker result look
    // provisional (or vice versa) to runStage's settle window.
    (value.haltedBy !== undefined &&
      !HALT_SOURCES.includes(value.haltedBy as (typeof HALT_SOURCES)[number]))
  ) {
    return undefined;
  }
  return value as ContractStageResult;
};

/** Atomically write a validated stage result. */
export const writeStageResult = (options: {
  resultPath: string;
  result: ContractStageResult;
}): void => {
  mkdirSync(dirname(options.resultPath), { recursive: true });
  const temporaryPath = `${options.resultPath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(options.result, undefined, 2));
  renameSync(temporaryPath, options.resultPath);
};

/** Read a result artifact only when it matches the exact run attempt. */
export const readStageResult = (options: {
  resultPath: string;
  runId: string;
  role: ContractWorkerRole;
  attempt: number;
}): ContractStageResult | undefined => {
  if (!existsSync(options.resultPath)) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(readFileSync(options.resultPath, 'utf-8'));
    return validateStageResult({
      value,
      runId: options.runId,
      role: options.role,
      attempt: options.attempt,
    });
  } catch {
    return undefined;
  }
};

/** Read worker usage written after the Pi process exits. */
export const readStageUsage = (usagePath: string): StageUsage | undefined => {
  if (!existsSync(usagePath)) {
    return undefined;
  }
  try {
    const value = JSON.parse(readFileSync(usagePath, 'utf-8')) as Partial<StageUsage>;
    if (
      typeof value.model !== 'string' ||
      typeof value.turns !== 'number' ||
      typeof value.inputTokens !== 'number' ||
      typeof value.outputTokens !== 'number' ||
      typeof value.cacheReadTokens !== 'number' ||
      typeof value.cacheWriteTokens !== 'number' ||
      typeof value.totalTokens !== 'number' ||
      typeof value.cost !== 'number'
    ) {
      return undefined;
    }
    return value as StageUsage;
  } catch {
    return undefined;
  }
};
