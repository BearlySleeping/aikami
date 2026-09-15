// apps/backend/local-stack/stack/generation/job_store.ts
//
// C-519: the host-owned durable store for runs, jobs, leases and blobs.
//
// 🔴 Host-only by design. `@aikami/local-ai` stays portable (no fs, no pid, no
// clock); everything that needs the real filesystem, process identity or
// atomic replacement lives here and consumes the portable schemas.
//
// The store is deliberately filesystem-first:
//
//   <runs-dir>/
//     <runId>/run.json                 the durable run record
//     <runId>/run.lock.json            the immutable run lock
//     <runId>/jobs/<jobId>.json        one durable job record
//     <runId>/jobs/by-request/<key>.json   request-key → jobId index
//     <runId>/blobs/<sha256><ext>      content-addressed raw/prepared bytes
//     <runId>/staged/<category>/...    namespaced staging (never the legacy root)
//     <runId>/candidates.fragment.json C-518-shaped candidate records
//     staging/manifest.json            merged AssetManifest fragment
//     staging/hashes.json              merged AssetHashesFile fragment
//     leases/<resource>.json           one lease per physical resource group
//
// Exclusive locks use OS advisory `flock` ownership held by an open file
// descriptor, so process death releases authority without stale-path deletion.
// Every fragment is written to a temp file and `rename`d into place, so a
// process killed mid-write leaves the previous fragment intact.
//
// Contract: C-519 Durable asset jobs and batch execution

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { sha256Hex } from '@aikami/local-ai';
import {
  GenerationJobRecordSchema,
  GenerationLeaseSchema,
  GenerationRunLockSchema,
  GenerationRunRecordSchema,
} from '@aikami/schemas';
import type {
  GenerationJobRecord,
  GenerationLease,
  GenerationRunLock,
  GenerationRunRecord,
} from '@aikami/types';
import { Value } from 'typebox/value';
import { tryAcquireFlock } from './flock.ts';

/** Every path the store owns for one run. */
export type GenerationStorePaths = {
  readonly runsDir: string;
  readonly runId: string;
  readonly runDir: string;
  readonly runRecordPath: string;
  readonly runLockPath: string;
  readonly jobsDir: string;
  readonly requestIndexDir: string;
  readonly blobsDir: string;
  readonly stagedDir: string;
  readonly candidatesPath: string;
  readonly stagingDir: string;
  readonly stagingManifestPath: string;
  readonly stagingHashesPath: string;
  readonly leasesDir: string;
};

/** Derives the store layout for one run. */
export const generationStorePaths = (options: {
  runsDir: string;
  runId: string;
}): GenerationStorePaths => {
  const runDir = join(options.runsDir, options.runId);
  const stagingDir = join(options.runsDir, 'staging');
  return {
    runsDir: options.runsDir,
    runId: options.runId,
    runDir,
    runRecordPath: join(runDir, 'run.json'),
    runLockPath: join(runDir, 'run.lock.json'),
    jobsDir: join(runDir, 'jobs'),
    requestIndexDir: join(runDir, 'jobs', 'by-request'),
    blobsDir: join(runDir, 'blobs'),
    stagedDir: join(runDir, 'staged'),
    candidatesPath: join(runDir, 'candidates.fragment.json'),
    stagingDir,
    stagingManifestPath: join(stagingDir, 'manifest.json'),
    stagingHashesPath: join(stagingDir, 'hashes.json'),
    leasesDir: join(options.runsDir, 'leases'),
  };
};

/** The request-key index path for a key (encoded — keys contain separators). */
const requestIndexPath = (paths: GenerationStorePaths, requestKey: string): string =>
  join(paths.requestIndexDir, `${encodeURIComponent(requestKey)}.json`);

/**
 * True when the process that wrote a lock/lease file is still alive.
 *
 * `EPERM` counts as *alive*: the process exists but belongs to another user.
 * Treating it as dead would let a second runner steal a live lease — the
 * exact failure the lease exists to prevent.
 */
export const isProcessAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM';
  }
};

/** An exclusive, cross-process lock backed by an OS advisory file lock. */
export type ExclusiveLock = {
  readonly path: string;
  readonly release: () => void;
};

/**
 * Acquires an exclusive lock, waiting up to `timeoutMs` for a live owner.
 *
 * The kernel owns lock lifetime through the open file descriptor. Process
 * death closes it automatically, so recovery never deletes or replaces a
 * pathname another process may have acquired.
 *
 * @throws Error when the lock is held by a live process for the whole timeout.
 */
export const acquireExclusiveLock = (options: {
  path: string;
  timeoutMs?: number;
  pollMs?: number;
}): ExclusiveLock => {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const pollMs = options.pollMs ?? 20;
  const deadline = Date.now() + timeoutMs;
  mkdirSync(dirname(options.path), { recursive: true });

  for (;;) {
    const handle = tryAcquireFlock(options.path, {
      body: JSON.stringify({ pid: process.pid, at: Date.now() }),
    });
    if (handle !== undefined) {
      return {
        path: options.path,
        release: () => {
          handle.release();
        },
      };
    }

    if (Date.now() > deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for the exclusive lock ${options.path}`,
      );
    }
    Bun.sleepSync(pollMs);
  }
};

/** Runs `action` while holding an exclusive lock. */
export const withExclusiveLock = async <T>(
  options: { path: string; timeoutMs?: number },
  action: () => Promise<T> | T,
): Promise<T> => {
  const lock = acquireExclusiveLock(options);
  try {
    return await action();
  } finally {
    lock.release();
  }
};

/** Reads JSON, returning undefined when the file is absent. */
export const readJsonIfPresent = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
};

/**
 * Writes JSON atomically: a sibling temp file, then a `rename`.
 *
 * A process killed mid-write therefore leaves the previous document intact —
 * a torn fragment can never be observed by the next reader.
 */
export const writeJsonAtomic = (path: string, value: unknown): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
};

/** Writes bytes atomically (temp file + rename). */
export const writeBytesAtomic = (path: string, bytes: Uint8Array): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Math.random().toString(16).slice(2)}`;
  writeFileSync(temporary, bytes);
  renameSync(temporary, path);
};

/** The validated read of one job record. */
export type JobRecordRead = {
  readonly record?: GenerationJobRecord;
  readonly path: string;
  readonly error?: string;
};

/** Reads and validates a job record; an unreadable record is reported, not deleted. */
export const readJobRecord = (path: string): JobRecordRead => {
  const raw = readJsonIfPresent<unknown>(path);
  if (raw === undefined) {
    return { path, error: 'missing' };
  }
  if (!Value.Check(GenerationJobRecordSchema, raw)) {
    const first = [...Value.Errors(GenerationJobRecordSchema, raw)][0];
    return {
      path,
      error: `record does not match the job schema (${first?.instancePath || '/'}: ${first?.message ?? 'unknown'})`,
    };
  }
  return { record: raw, path };
};

/**
 * Serializes a job-record read/transition/write sequence across processes.
 *
 * Callers receive the latest durable record while holding the lock, so a
 * cancellation cannot be overwritten by an earlier in-memory snapshot.
 */
export const withJobRecordLock = <T>(
  options: { paths: GenerationStorePaths; jobId: string; timeoutMs?: number },
  action: (current: GenerationJobRecord | undefined) => T,
): T => {
  const recordPath = join(options.paths.jobsDir, `${options.jobId}.json`);
  const lock = acquireExclusiveLock({
    path: `${recordPath}.lock`,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  try {
    return action(readJobRecord(recordPath).record);
  } finally {
    lock.release();
  }
};

/** Every job record in the run. */
export const listJobRecords = (paths: GenerationStorePaths): readonly JobRecordRead[] => {
  if (!existsSync(paths.jobsDir)) {
    return [];
  }
  return readdirSync(paths.jobsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJobRecord(join(paths.jobsDir, name)));
};

/** The job records that parsed cleanly. */
export const listParsedJobs = (paths: GenerationStorePaths): readonly GenerationJobRecord[] =>
  listJobRecords(paths)
    .map((read) => read.record)
    .filter((record): record is GenerationJobRecord => record !== undefined);

/** Persists one job record. */
export const writeJobRecord = (paths: GenerationStorePaths, record: GenerationJobRecord): void => {
  writeJsonAtomic(join(paths.jobsDir, `${record.jobId}.json`), record);
  writeJsonAtomic(requestIndexPath(paths, record.requestKey), { jobId: record.jobId });
};

/** Finds a job by its client request key. */
export const findJobByRequestKey = (
  paths: GenerationStorePaths,
  requestKey: string,
): GenerationJobRecord | undefined => {
  const index = readJsonIfPresent<{ jobId?: string }>(requestIndexPath(paths, requestKey));
  if (index?.jobId === undefined) {
    return undefined;
  }
  return readJobRecord(join(paths.jobsDir, `${index.jobId}.json`)).record;
};

/** Finds every job whose effective spec hash matches. */
export const findJobsBySpecHash = (
  paths: GenerationStorePaths,
  effectiveSpecHash: string,
): readonly GenerationJobRecord[] =>
  listParsedJobs(paths).filter((record) => record.effectiveSpecHash === effectiveSpecHash);

/** The current run record, if the run exists. */
export const readRunRecord = (paths: GenerationStorePaths): GenerationRunRecord | undefined => {
  const raw = readJsonIfPresent<unknown>(paths.runRecordPath);
  if (raw === undefined || !Value.Check(GenerationRunRecordSchema, raw)) {
    return undefined;
  }
  return raw;
};

/**
 * Creates the run record once.
 *
 * Re-entering the same run (a second `--run`, or `--resume`) reuses the record
 * instead of resetting it — the run is the durable container, not a scratch file.
 */
export const ensureRun = (options: {
  paths: GenerationStorePaths;
  record: GenerationRunRecord;
}): { created: boolean; record: GenerationRunRecord } => {
  const existing = readRunRecord(options.paths);
  if (existing) {
    return { created: false, record: existing };
  }
  writeJsonAtomic(options.paths.runRecordPath, options.record);
  return { created: true, record: options.record };
};

/** Updates the mutable half of the run record. */
export const updateRunRecord = (
  paths: GenerationStorePaths,
  patch: Partial<GenerationRunRecord>,
): GenerationRunRecord | undefined => {
  const existing = readRunRecord(paths);
  if (!existing) {
    return undefined;
  }
  const updated: GenerationRunRecord = { ...existing, ...patch };
  writeJsonAtomic(paths.runRecordPath, updated);
  return updated;
};

/** The result of writing the run lock. */
export type RunLockWrite = {
  readonly written: boolean;
  readonly lock: GenerationRunLock;
  /** Present when the store already holds a *different* lock. */
  readonly conflict?: { readonly existing: GenerationRunLock };
};

/**
 * Writes the run lock once and refuses to overwrite a differing one.
 *
 * The lock is the run's identity: silently replacing it would let a run start
 * against provider/reference versions that were never reviewed.
 */
export const writeRunLockImmutable = (options: {
  paths: GenerationStorePaths;
  lock: GenerationRunLock;
}): RunLockWrite => {
  const raw = readJsonIfPresent<unknown>(options.paths.runLockPath);
  if (raw === undefined) {
    writeJsonAtomic(options.paths.runLockPath, options.lock);
    return { written: true, lock: options.lock };
  }
  if (!Value.Check(GenerationRunLockSchema, raw)) {
    return {
      written: false,
      lock: options.lock,
      conflict: {
        existing: {
          ...options.lock,
          references: [],
          providers: [],
        },
      },
    };
  }
  const existing = raw;
  // `createdAt` is when the lock was first written, not part of what it pins:
  // a later invocation of the same run must match it, not collide with it.
  const { createdAt: _existingAt, ...existingPinned } = existing;
  const { createdAt: _incomingAt, ...incomingPinned } = options.lock;
  if (JSON.stringify(existingPinned) === JSON.stringify(incomingPinned)) {
    return { written: false, lock: existing };
  }
  return { written: false, lock: existing, conflict: { existing } };
};

/** The run lock, when one was written. */
export const readRunLock = (paths: GenerationStorePaths): GenerationRunLock | undefined => {
  const raw = readJsonIfPresent<unknown>(paths.runLockPath);
  return raw !== undefined && Value.Check(GenerationRunLockSchema, raw) ? raw : undefined;
};

/** The resource group a plan item's dispatch occupies. */
export const resourceGroupForEngine = (engineId: string | undefined): string =>
  engineId === 'ace-step' ? 'gpu:audio' : 'gpu:image';

/** The lease path for a resource group. */
export const leasePath = (paths: GenerationStorePaths, resourceGroup: string): string =>
  join(paths.leasesDir, `${resourceGroup.replace(/[^a-z0-9]+/gi, '_')}.json`);

/** One lease acquisition attempt. */
export type LeaseAcquisition =
  | { readonly kind: 'acquired'; readonly lease: GenerationLease; readonly path: string }
  | { readonly kind: 'held'; readonly lease: GenerationLease; readonly path: string };

/**
 * Acquires the lease for one physical resource group.
 *
 * A live owner always wins — even past `expiresAt`. The expiry is advisory and
 * only used to describe the lease; *liveness* of the owning process is what
 * decides whether a lease is stale, because a crashed generation must not
 * silently hand the GPU to a second process while the first may still be
 * computing.
 */
export const acquireLease = (options: {
  paths: GenerationStorePaths;
  resourceGroup: string;
  owner: string;
  ttlMs: number;
  now: Date;
}): LeaseAcquisition => {
  const path = leasePath(options.paths, options.resourceGroup);
  mkdirSync(options.paths.leasesDir, { recursive: true });

  const existingRaw = readJsonIfPresent<unknown>(path);
  if (existingRaw !== undefined && Value.Check(GenerationLeaseSchema, existingRaw)) {
    const existing = existingRaw;
    if (isProcessAlive(existing.pid) && existing.owner !== options.owner) {
      return { kind: 'held', lease: existing, path };
    }
  }

  const lease: GenerationLease = {
    resourceGroup: options.resourceGroup,
    owner: options.owner,
    pid: process.pid,
    leaseId: `${options.resourceGroup}-${process.pid}-${options.now.getTime()}`,
    acquiredAt: options.now.toISOString(),
    expiresAt: new Date(options.now.getTime() + options.ttlMs).toISOString(),
  };
  writeJsonAtomic(path, lease);
  return { kind: 'acquired', lease, path };
};

/**
 * Releases a lease.
 *
 * Only the holder (same owner tag and pid) may release it — a losing process
 * must never free a lease it never held.
 */
export const releaseLease = (options: {
  paths: GenerationStorePaths;
  resourceGroup: string;
  owner: string;
}): boolean => {
  const path = leasePath(options.paths, options.resourceGroup);
  const existing = readJsonIfPresent<unknown>(path);
  if (existing === undefined || !Value.Check(GenerationLeaseSchema, existing)) {
    return false;
  }
  if (existing.owner !== options.owner || existing.pid !== process.pid) {
    return false;
  }
  unlinkSync(path);
  return true;
};

/** Every lease record currently present, valid or not. */
export const listLeases = (paths: GenerationStorePaths): readonly GenerationLease[] => {
  if (!existsSync(paths.leasesDir)) {
    return [];
  }
  return readdirSync(paths.leasesDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readJsonIfPresent<unknown>(join(paths.leasesDir, name)))
    .filter((raw): raw is unknown => raw !== undefined)
    .filter((raw): raw is GenerationLease => Value.Check(GenerationLeaseSchema, raw));
};

/** The leases whose owning process is still alive. */
export const listLiveLeases = (paths: GenerationStorePaths): readonly GenerationLease[] =>
  listLeases(paths).filter((lease) => isProcessAlive(lease.pid));

/** A content-addressed blob write. */
export type BlobWrite = {
  readonly sha256: string;
  readonly path: string;
  readonly bytes: number;
};

/** Writes bytes into the content-addressed blob store. */
export const writeBlob = (options: {
  paths: GenerationStorePaths;
  sha256: string;
  ext: string;
  bytes: Uint8Array;
}): BlobWrite => {
  const path = join(options.paths.blobsDir, `${options.sha256}${options.ext}`);
  if (!existsSync(path)) {
    writeBytesAtomic(path, options.bytes);
  }
  return { sha256: options.sha256, path, bytes: options.bytes.byteLength };
};

/**
 * Reads a blob and verifies it against the expected hash.
 *
 * This is the "verify existing bytes" half of recovery: restored bytes that do
 * not hash to the recorded digest are *not* reused, and the caller falls back
 * to a fresh dispatch rather than trusting a mismatch.
 */
export const readVerifiedBlob = async (
  path: string,
  expectedSha256: string,
): Promise<Uint8Array | undefined> => {
  if (!existsSync(path)) {
    return undefined;
  }
  const bytes = new Uint8Array(readFileSync(path));
  if (bytes.byteLength === 0) {
    return undefined;
  }
  return (await sha256Hex(bytes)) === expectedSha256 ? bytes : undefined;
};
