// scripts/src/lib/agents/contract_pipeline/manifest_store.ts
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ContractPipelineStage, RunManifest } from './types.ts';

const RUNS_DIR = '.pi/contract-runs';
const _lockCleanups = new Map<
  string,
  { cleanup: () => void; signalCleanup: () => void; terminationCleanup: () => void }
>();

type LockMetadata = {
  pid: number;
  contractId: string;
  runId: string;
  createdAt: string;
};

const buildLockPath = (options: { contractId: string; cwd: string }): string =>
  join(options.cwd, RUNS_DIR, `lock_${options.contractId.replace(/[^A-Za-z0-9]/g, '-')}.json`);

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readLock = (path: string): LockMetadata | undefined => {
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LockMetadata>;
    if (typeof value.pid !== 'number' || typeof value.contractId !== 'string') {
      return undefined;
    }
    return {
      pid: value.pid,
      contractId: value.contractId,
      runId: typeof value.runId === 'string' ? value.runId : '',
      createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
    };
  } catch {
    return undefined;
  }
};

const removeFile = (path: string): void => {
  try {
    unlinkSync(path);
  } catch {
    // Already removed.
  }
};

/** Check if a lock's workspace is still alive. Called before breaking a stale lock. */
type WorkspaceAliveCheck = (runId: string) => Promise<boolean>;

/** Acquire an atomic, process-owned lock for one contract. */
export const acquireLock = async (options: {
  contractId: string;
  runId: string;
  cwd: string;
  checkWorkspaceAlive?: WorkspaceAliveCheck;
}): Promise<void> => {
  const path = buildLockPath(options);
  mkdirSync(join(options.cwd, RUNS_DIR), { recursive: true });

  const metadata: LockMetadata = {
    pid: process.pid,
    contractId: options.contractId,
    runId: options.runId,
    createdAt: new Date().toISOString(),
  };

  const create = (): void => {
    const descriptor = openSync(path, 'wx');
    try {
      writeFileSync(descriptor, JSON.stringify(metadata, undefined, 2));
    } finally {
      closeSync(descriptor);
    }
  };

  const breakStaleLock = async (): Promise<void> => {
    const existing = readLock(path);
    if (!existing || !isProcessAlive(existing.pid)) {
      removeFile(path);
      return;
    }

    // Process is alive — check if its herdr workspace still exists.
    if (options.checkWorkspaceAlive && existing.runId) {
      const workspaceAlive = await options.checkWorkspaceAlive(existing.runId);
      if (!workspaceAlive) {
        // Workspace was killed but process lingered — break the lock.
        removeFile(path);
        return;
      }
    }

    throw new Error(
      `Pipeline already running for ${options.contractId} (PID ${existing.pid}, run ${existing.runId}).`,
    );
  };

  try {
    create();
  } catch {
    await breakStaleLock();
    try {
      create();
    } catch {
      throw new Error(`Unable to acquire pipeline lock for ${options.contractId}.`);
    }
  }

  const cleanup = (): void => removeFile(path);
  const signalCleanup = (): void => {
    cleanup();
    process.exit(130);
  };
  const terminationCleanup = (): void => {
    cleanup();
    process.exit(143);
  };

  _lockCleanups.set(path, { cleanup, signalCleanup, terminationCleanup });
  process.once('exit', cleanup);
  process.once('SIGINT', signalCleanup);
  process.once('SIGTERM', terminationCleanup);
};

/** Read the current lock metadata without acquiring. Returns undefined if no lock or invalid. */
export const readLockMetadata = (options: {
  contractId: string;
  cwd: string;
}): LockMetadata | undefined => {
  const path = buildLockPath(options);
  return readLock(path);
};

/** Release a previously acquired contract lock. */
export const releaseLock = (options: { contractId: string; cwd: string }): void => {
  const path = buildLockPath(options);
  const handlers = _lockCleanups.get(path);
  if (handlers) {
    process.removeListener('exit', handlers.cleanup);
    process.removeListener('SIGINT', handlers.signalCleanup);
    process.removeListener('SIGTERM', handlers.terminationCleanup);
    _lockCleanups.delete(path);
  }
  removeFile(path);
};

const isPipelineStage = (value: unknown): value is ContractPipelineStage =>
  typeof value === 'string' &&
  [
    'prepare',
    'write_contract',
    'critique',
    'implement',
    'verify',
    'review',
    'accepted',
    'blocked',
  ].includes(value);

const isManifest = (value: unknown, expectedRunId: string): value is RunManifest => {
  if (typeof value !== 'object' || value === undefined) {
    return false;
  }
  const manifest = value as Partial<RunManifest>;
  return (
    manifest.version === 3 &&
    manifest.runId === expectedRunId &&
    typeof manifest.contractId === 'string' &&
    typeof manifest.contractPath === 'string' &&
    typeof manifest.baseCommit === 'string' &&
    typeof manifest.baselineFingerprint === 'string' &&
    isPipelineStage(manifest.currentStage) &&
    typeof manifest.criticLoops === 'number' &&
    typeof manifest.verifyLoops === 'number' &&
    Array.isArray(manifest.attempts) &&
    typeof manifest.usage === 'object' &&
    manifest.usage !== undefined
  );
};

/** Atomically write a v3 manifest. */
export const writeManifest = (options: { manifest: RunManifest; cwd: string }): void => {
  options.manifest.lastUpdated = new Date().toISOString();
  const directory = join(options.cwd, RUNS_DIR, options.manifest.runId);
  mkdirSync(directory, { recursive: true });
  const filePath = join(directory, 'manifest.json');
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(options.manifest, undefined, 2));
  renameSync(temporaryPath, filePath);
};

/** Read and validate a v3 manifest. Legacy or corrupt manifests return undefined. */
export const readManifest = (options: { runId: string; cwd: string }): RunManifest | undefined => {
  const filePath = join(options.cwd, RUNS_DIR, options.runId, 'manifest.json');
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'));
    return isManifest(parsed, options.runId) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/** Create a fresh v3 manifest. */
export const createManifest = (options: {
  contractId: string;
  contractPath: string;
  baseCommit: string;
  baselineFingerprint: string;
  startStage: ContractPipelineStage;
}): RunManifest => {
  const timestamp = new Date().toISOString();
  return {
    version: 3,
    runId: `run-${Date.now().toString(36)}-${options.contractId.replace(/[^A-Za-z0-9]/g, '-')}`,
    contractId: options.contractId,
    contractPath: options.contractPath,
    baseCommit: options.baseCommit,
    baselineFingerprint: options.baselineFingerprint,
    startTime: timestamp,
    lastUpdated: timestamp,
    currentStage: options.startStage,
    criticLoops: 0,
    verifyLoops: 0,
    attempts: [],
    usage: {},
  };
};

/** Return the run directory. */
export const runDirectory = (options: { runId: string; cwd: string }): string =>
  join(options.cwd, RUNS_DIR, options.runId);

/** Return the pipeline log path. */
export const logPath = (options: { runId: string; cwd: string }): string =>
  join(runDirectory(options), 'pipeline.log');

/** Append a timestamped line to the pipeline log. */
export const pipelineLog = (options: { runId: string; cwd: string; message: string }): void => {
  const path = logPath(options);
  mkdirSync(runDirectory(options), { recursive: true });
  writeFileSync(path, `[${new Date().toISOString()}] ${options.message}\n`, { flag: 'a' });
};

/** Return the stage result directory for one run. */
export const stageResultDir = (runDirectoryPath: string): string =>
  join(runDirectoryPath, 'stages');
