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
import { playError } from './alarm.ts';
import { type ContractPipelineStage, isTerminalStage, type RunManifest } from './types.ts';

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

    // Process is alive — check if its run is in a terminal state.
    // A blocked/merged/completed run no longer needs the lock.
    if (existing.runId) {
      const manifestPath = join(options.cwd, RUNS_DIR, existing.runId, 'manifest.json');
      try {
        const raw = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
          currentStage?: string;
          lastUpdated?: string;
        };
        if (raw.currentStage && isTerminalStage(raw.currentStage as ContractPipelineStage)) {
          // Run is in a terminal state — orphaned lock. Break it.
          console.log(
            `🔓 Breaking stale lock for ${existing.contractId} (run ${existing.runId} at ${raw.currentStage}).`,
          );
          removeFile(path);
          return;
        }
        // Check if manifest hasn't been updated in 2+ hours — hung orchestrator
        if (raw.lastUpdated) {
          const lastUpdate = new Date(raw.lastUpdated).getTime();
          const staleMsThreshold = 2 * 60 * 60 * 1000; // 2 hours
          if (Date.now() - lastUpdate > staleMsThreshold) {
            console.log(
              `🔓 Breaking stale lock for ${existing.contractId} (run ${existing.runId} — last update ${Math.round((Date.now() - lastUpdate) / 1000 / 60)} min ago).`,
            );
            removeFile(path);
            return;
          }
        }
      } catch {
        // Manifest unreadable — fall through to workspace check.
      }
    }

    // Check if its herdr workspace still exists.
    if (options.checkWorkspaceAlive && existing.runId) {
      const workspaceAlive = await options.checkWorkspaceAlive(existing.runId);
      if (!workspaceAlive) {
        // Workspace was killed but process lingered — break the lock.
        removeFile(path);
        return;
      }
    }

    throw new Error(
      `Pipeline already running for ${options.contractId} (PID ${existing.pid}, run ${existing.runId}).\n` +
        `  Kill it: kill ${existing.pid}\n` +
        `  Then re-run your command.`,
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
  // 🔴 Without this logging, a SIGINT/SIGTERM (pane closed, session restart,
  // manual kill, OOM) unlocks and exits totally silently — pipeline.log just
  // stops mid-stage with zero trace, and the only way to notice is staring at
  // a stalled tab. Log + chime BEFORE exit so the failure is loud and the
  // resume path is obvious. Best-effort: logging/audio must never block exit.
  const announceInterruption = (signal: string, code: number): void => {
    try {
      pipelineLog({
        runId: options.runId,
        cwd: options.cwd,
        message: `⚠️  Pipeline process received ${signal} and exited (code ${code}) — lock released. Resume with: bun run contract --resume ${options.runId}`,
      });
      playError();
    } catch {
      // Never let logging/audio failure block process exit.
    }
  };
  const signalCleanup = (): void => {
    cleanup();
    announceInterruption('SIGINT', 130);
    process.exit(130);
  };
  const terminationCleanup = (): void => {
    cleanup();
    announceInterruption('SIGTERM', 143);
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
    'reconciling',
    'blocked',
    'pr_created',
    'merged',
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

/** Read and validate a v3 manifest. Corrupt manifests return undefined. */
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
  skipAuthoring?: boolean;
  critique?: boolean;
  rootMode?: boolean;
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
    verifyLoops: 0,
    attempts: [],
    usage: {},
    autofixCycles: 0,
    skipAuthoring: options.skipAuthoring,
    critique: options.critique,
    rootMode: options.rootMode,
  };
};

/** Return the run directory. */
export const runDirectory = (options: { runId: string; cwd: string }): string =>
  join(options.cwd, RUNS_DIR, options.runId);

/** Return the pipeline log path. */
export const logPath = (options: { runId: string; cwd: string }): string =>
  join(runDirectory(options), 'pipeline.log');

/** Append a timestamped line to the pipeline log. */
/**
 * Mirror this process's stdout/stderr into the run log, on top of whatever it
 * already prints to its terminal.
 *
 * The orchestrator's own console output used to exist ONLY in its hosting
 * herdr pane, while `pipeline.log` held just the `pipelineLog` milestones —
 * which is why the workspace needed two tabs to show one pipeline (a
 * `launcher` tab for the live process, a `pipeline` tab tailing the file).
 * Now that the process's pane IS the `pipeline` tab, the file has to carry
 * everything instead, or closing the workspace would take the only copy of
 * the run's output with it.
 *
 * Idempotent — a second call on the same process is a no-op, so a resume path
 * that re-enters the orchestrator cannot stack wrappers and double-write.
 */
let teeInstalled = false;
export const teePipelineLog = (options: { runId: string; cwd: string }): void => {
  if (teeInstalled) {
    return;
  }
  teeInstalled = true;
  const path = logPath(options);
  mkdirSync(runDirectory(options), { recursive: true });
  for (const stream of [process.stdout, process.stderr]) {
    const original = stream.write.bind(stream);
    type WriteArgs = Parameters<typeof original>;
    stream.write = ((...args: WriteArgs): boolean => {
      const [chunk] = args;
      try {
        writeFileSync(path, typeof chunk === 'string' ? chunk : Buffer.from(chunk), { flag: 'a' });
      } catch {
        // Never let logging break the pipeline — the terminal copy still goes
        // out below.
      }
      return original(...args);
    }) as typeof stream.write;
  }
};

export const pipelineLog = (options: { runId: string; cwd: string; message: string }): void => {
  const path = logPath(options);
  mkdirSync(runDirectory(options), { recursive: true });
  writeFileSync(path, `[${new Date().toISOString()}] ${options.message}\n`, { flag: 'a' });
};

/** Return the stage result directory for one run. */
export const stageResultDir = (runDirectoryPath: string): string =>
  join(runDirectoryPath, 'stages');
