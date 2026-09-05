// scripts/src/lib/agents/contract_pipeline/manifest_store.ts
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { playError } from './alarm.ts';
import { type ContractPipelineStage, isTerminalStage, type RunManifest } from './types.ts';

const RUNS_DIR = '.pi/contract-runs';
const _lockCleanups = new Map<
  string,
  {
    cleanup: () => void;
    signalCleanup: () => void;
    terminationCleanup: () => void;
    heartbeat: ReturnType<typeof setInterval>;
  }
>();

/**
 * How often a live orchestrator touches its lock file.
 *
 * The lock's mtime is the pipeline's liveness signal: a leaked lock (pid dead,
 * file still there) is the signature of EVERY hard kill, and a herdr restart
 * SIGHUPs its panes — a signal `acquireLock` deliberately does not trap,
 * because trapping it would mean releasing the lock on the one event we most
 * want a trace of. So a stale lock cannot, by itself, tell "orphaned thirty
 * seconds ago" from "abandoned two days ago", and `lastUpdated` cannot either
 * — writeManifest only runs on stage transitions, so a run sitting in
 * `implement` looks identical to one nobody has touched since Tuesday.
 *
 * The mtime closes that gap, and it is what makes auto-resume safe to run
 * unattended: see resume_orphaned.ts, which refuses to resume anything whose
 * heartbeat is older than a few minutes. Without it a scan of this repo today
 * would have relaunched nine review-stage runs, the oldest two days old, all
 * at once.
 */
export const LOCK_HEARTBEAT_MS = 30_000;

/** Persisted owner metadata used to fence pipeline and worker generations. */
export type LockMetadata = {
  pid: number;
  contractId: string;
  runId: string;
  createdAt: string;
  /**
   * Monotonically increasing generation counter for this lock acquisition.
   * Each acquisition of the same contract by the same run increments the
   * generation, so a replacement worker can be distinguished from a late
   * result by its predecessor.
   *
   * Absent in legacy locks — normalized to generation 0 when read.
   */
  generation: number;
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
      generation:
        typeof value.generation === 'number' &&
        Number.isSafeInteger(value.generation) &&
        value.generation >= 0
          ? value.generation
          : 0,
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
}): Promise<LockMetadata> => {
  const path = buildLockPath(options);
  mkdirSync(join(options.cwd, RUNS_DIR), { recursive: true });

  const metadataForGeneration = (generation: number): LockMetadata => ({
    pid: process.pid,
    contractId: options.contractId,
    runId: options.runId,
    createdAt: new Date().toISOString(),
    generation,
  });
  let metadata = metadataForGeneration(1);

  const create = (): void => {
    const descriptor = openSync(path, 'wx');
    try {
      writeFileSync(descriptor, JSON.stringify(metadata, undefined, 2));
    } finally {
      closeSync(descriptor);
    }
  };

  const breakStaleLock = async (): Promise<LockMetadata | undefined> => {
    const existing = readLock(path);
    if (!existing || !isProcessAlive(existing.pid)) {
      removeFile(path);
      return existing;
    }

    // A fresh heartbeat is authoritative. Check it outside the manifest
    // parser so the running-owner error cannot be swallowed as a parse error.
    let heartbeatFresh = false;
    try {
      const lockMtimeMs = statSync(path).mtimeMs;
      heartbeatFresh = Date.now() - lockMtimeMs <= LOCK_HEARTBEAT_MS * 2;
    } catch {
      // statSync failed (lock already gone) — heartbeat is not fresh.
    }
    if (heartbeatFresh) {
      throw new Error(
        `Pipeline already running for ${options.contractId} (PID ${existing.pid}, run ${existing.runId}).\n` +
          `  Kill it: kill ${existing.pid}\n` +
          `  Then re-run your command.`,
      );
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
          return existing;
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
            return existing;
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
        return existing;
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
    const previous = await breakStaleLock();
    metadata = metadataForGeneration((previous?.generation ?? 0) + 1);
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

  // Touch the lock while we live, so a reader can date the death. `unref` so
  // the timer never holds the process open past its real work.
  const heartbeat = setInterval(() => {
    try {
      const now = new Date();
      utimesSync(path, now, now);
    } catch {
      // Lock removed underneath us (forced unlock, manual cleanup) — the
      // process is exiting anyway; never let a heartbeat throw into the loop.
    }
  }, LOCK_HEARTBEAT_MS);
  heartbeat.unref();

  _lockCleanups.set(path, { cleanup, signalCleanup, terminationCleanup, heartbeat });
  process.once('exit', cleanup);
  process.once('SIGINT', signalCleanup);
  process.once('SIGTERM', terminationCleanup);
  return metadata;
};

/**
 * Age of a contract lock's heartbeat, in milliseconds, or undefined when there
 * is no lock. See LOCK_HEARTBEAT_MS for why mtime and not `lastUpdated`.
 */
export const lockHeartbeatAgeMs = (options: {
  contractId: string;
  cwd: string;
}): number | undefined => {
  try {
    return Date.now() - statSync(buildLockPath(options)).mtimeMs;
  } catch {
    return undefined;
  }
};

/** Read the current lock metadata without acquiring. Returns undefined if no lock or invalid. */
export const readLockMetadata = (options: {
  contractId: string;
  cwd: string;
}): LockMetadata | undefined => {
  const path = buildLockPath(options);
  return readLock(path);
};

/** Advance the current owner's persisted generation before replacing a worker. */
export const advanceLockGeneration = (options: { contractId: string; cwd: string }): number => {
  const path = buildLockPath(options);
  const existing = readLock(path);
  if (!existing || existing.pid !== process.pid) {
    throw new Error(`Cannot advance pipeline lock generation for ${options.contractId}.`);
  }
  const updated: LockMetadata = { ...existing, generation: existing.generation + 1 };
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(updated, undefined, 2));
  renameSync(temporaryPath, path);
  return updated.generation;
};

/** Release a previously acquired contract lock. */
export const releaseLock = (options: { contractId: string; cwd: string }): void => {
  const path = buildLockPath(options);
  const handlers = _lockCleanups.get(path);
  if (handlers) {
    clearInterval(handlers.heartbeat);
    process.removeListener('exit', handlers.cleanup);
    process.removeListener('SIGINT', handlers.signalCleanup);
    process.removeListener('SIGTERM', handlers.terminationCleanup);
    _lockCleanups.delete(path);
  }

  // 🔴 Owner-conditional release: only remove the lock if it still belongs to
  // the current process. If a replacement owner took over (different PID),
  // this release must NOT delete the new owner's lock — see C-470 AC-2.
  const existing = readLock(path);
  if (existing && existing.pid !== process.pid) {
    // Another process now owns the lock — leave it alone.
    return;
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

/**
 * The directory where reservation files for exclusive ID allocation live.
 * These are small JSON files created atomically via `wx` open, deleted once
 * the reservation is consumed or abandoned.
 */
const RESERVATIONS_DIR = '.pi/contract-runs/reservations';
const RESERVATION_FILE_PATTERN = /^reserve-C-(\d+)\.json$/;

/** Maximum age of a reservation before it is considered stale and reclaimable. */
export const RESERVATION_STALE_MS = 10 * 60 * 1000; // 10 minutes

type ReservationMetadata = {
  contractId: string;
  pid: number;
  createdAt: string;
};

const readReservation = (path: string): ReservationMetadata | undefined => {
  try {
    const value = JSON.parse(readFileSync(path, 'utf-8')) as Partial<ReservationMetadata>;
    if (
      typeof value.contractId !== 'string' ||
      typeof value.pid !== 'number' ||
      typeof value.createdAt !== 'string'
    ) {
      return undefined;
    }
    return { contractId: value.contractId, pid: value.pid, createdAt: value.createdAt };
  } catch {
    return undefined;
  }
};

const isReservationStale = (reservation: ReservationMetadata, now: number): boolean => {
  const createdAt = new Date(reservation.createdAt).getTime();
  return (
    !isProcessAlive(reservation.pid) ||
    !Number.isFinite(createdAt) ||
    now - createdAt > RESERVATION_STALE_MS
  );
};

const isReservationFileExpired = (path: string, now: number): boolean => {
  try {
    return now - statSync(path).mtimeMs > RESERVATION_STALE_MS;
  } catch {
    return true;
  }
};

/**
 * Exclusively reserve a contract ID so concurrent pipeline instances each
 * receive a distinct ID and no existing draft is overwritten.
 *
 * Uses an atomic `wx` file create as the reservation primitive — exactly the
 * same pattern as lock files. The reservation holds a PID + timestamp so
 * stale reservations from dead processes can be cleaned up.
 *
 * Returns the reserved contract ID (e.g. "C-372"), or undefined when all
 * available IDs up to a reasonable ceiling are exhausted.
 */
export const reserveContractId = (options: {
  /** Directory containing existing contract files. */
  contractsDir: string;
  cwd: string;
  maxAttempts?: number;
}): string | undefined => {
  const reservationsDir = join(options.cwd, RESERVATIONS_DIR);
  mkdirSync(reservationsDir, { recursive: true });

  // Find the current max ID from existing contract files.
  const existingFiles: string[] = [];
  try {
    const entries = readdirSync(options.contractsDir);
    for (const f of entries) {
      if (/^C-\d+/.test(f) && f.endsWith('.md')) {
        existingFiles.push(f);
      }
    }
  } catch {
    // Directory doesn't exist yet — start from 0.
  }

  const maxExisting = existingFiles.reduce((max: number, f: string) => {
    const match = f.match(/^C-(\d+)/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  // Also scan existing reservation files to find the highest reserved ID.
  let maxReserved = maxExisting;
  try {
    const entries = readdirSync(reservationsDir);
    for (const f of entries) {
      const match = f.match(RESERVATION_FILE_PATTERN);
      if (!match) {
        continue;
      }
      const reservationPath = join(reservationsDir, f);
      const reservation = readReservation(reservationPath);
      const now = Date.now();
      if (!reservation) {
        // Another process may be between its exclusive create and metadata
        // write. A fresh unreadable file still owns the candidate.
        if (isReservationFileExpired(reservationPath, now)) {
          removeFile(reservationPath);
        } else {
          maxReserved = Math.max(maxReserved, Number(match[1]));
        }
        continue;
      }
      if (isReservationStale(reservation, now)) {
        removeFile(reservationPath);
        continue;
      }
      const id = Number(match[1]);
      if (id > maxReserved) {
        maxReserved = id;
      }
    }
  } catch {
    // Reservations directory doesn't exist yet.
  }

  // Try IDs from maxReserved + 1 upward until we successfully create a
  // reservation file or hit the ceiling.
  const maxAttempts = options.maxAttempts ?? 100;
  for (let offset = 1; offset <= maxAttempts; offset++) {
    const candidateId = `C-${maxReserved + offset}`;
    const reservationPath = join(reservationsDir, `reserve-${candidateId}.json`);

    try {
      const descriptor = openSync(reservationPath, 'wx');
      try {
        writeFileSync(
          descriptor,
          JSON.stringify({
            contractId: candidateId,
            pid: process.pid,
            createdAt: new Date().toISOString(),
          }),
        );
      } finally {
        closeSync(descriptor);
      }
      return candidateId;
    } catch {}
  }

  return undefined;
};

/**
 * Release a previously reserved contract ID so it can be reused.
 * Safe to call even if the reservation doesn't exist or belongs to another
 * process — in that case it's a no-op.
 */
export const releaseReservation = (options: { contractId: string; cwd: string }): void => {
  const reservationPath = join(options.cwd, RESERVATIONS_DIR, `reserve-${options.contractId}.json`);
  const reservation = readReservation(reservationPath);
  if (reservation?.pid === process.pid) {
    removeFile(reservationPath);
  }
};

/**
 * Clean up stale reservation files from dead processes.
 */
export const pruneStaleReservations = (options: { cwd: string }): void => {
  const reservationsDir = join(options.cwd, RESERVATIONS_DIR);
  try {
    const entries = readdirSync(reservationsDir);
    for (const f of entries) {
      if (!RESERVATION_FILE_PATTERN.test(f)) {
        continue;
      }
      const reservationPath = join(reservationsDir, f);
      const reservation = readReservation(reservationPath);
      const now = Date.now();
      if (
        (reservation && isReservationStale(reservation, now)) ||
        (!reservation && isReservationFileExpired(reservationPath, now))
      ) {
        removeFile(reservationPath);
      }
    }
  } catch {
    // Directory doesn't exist — nothing to clean.
  }
};
