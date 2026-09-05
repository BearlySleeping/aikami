// scripts/src/lib/agents/contract_pipeline/ownership.test.ts
//
// Tests for C-470: Fence pipeline ownership, contract allocation and stage results.
// Covers AC-1 through AC-4.
//
// Uses temporary directories and real filesystem operations (no mocking).
// Never touches the live .pi/contract-runs store.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acquireLock,
  advanceLockGeneration,
  pruneStaleReservations,
  readLockMetadata,
  releaseLock,
  releaseReservation,
  reserveContractId,
} from './manifest_store.ts';
import { readStageResult, validateStageResult, writeStageResult } from './stage_result.ts';
import type { ContractStageResult, ContractWorkerRole } from './types.ts';

const RUNS_DIR = '.pi/contract-runs';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'ownership-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

// ── Helpers ───────────────────────────────────────────────────

/** A pid that is certainly dead: kernels never allocate 0 to a user process. */
const DEAD_PID = 2_147_483_646;

/** Write a lock file with the given metadata and heartbeat age. */
const seedLock = (options: {
  contractId: string;
  runId: string;
  pid: number;
  heartbeatAgeMs: number;
  generation?: number;
}): void => {
  const lockDir = join(cwd, RUNS_DIR);
  mkdirSync(lockDir, { recursive: true });
  const lockPath = join(lockDir, `lock_${options.contractId.replace(/[^A-Za-z0-9]/g, '-')}.json`);
  writeFileSync(
    lockPath,
    JSON.stringify({
      pid: options.pid,
      contractId: options.contractId,
      runId: options.runId,
      createdAt: new Date().toISOString(),
      generation: options.generation,
    }),
  );
  const when = new Date(Date.now() - options.heartbeatAgeMs);
  utimesSync(lockPath, when, when);
};

/** Write a manifest file. */
const seedManifest = (options: {
  runId: string;
  contractId: string;
  stage: string;
  lastUpdatedAgeMs: number;
}): void => {
  const dir = join(cwd, RUNS_DIR, options.runId);
  mkdirSync(dir, { recursive: true });
  const lastUpdated = new Date(Date.now() - options.lastUpdatedAgeMs).toISOString();
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({
      version: 3,
      runId: options.runId,
      contractId: options.contractId,
      contractPath: `docs/contracts/${options.contractId}.md`,
      baseCommit: 'abc',
      baselineFingerprint: 'fp',
      startTime: new Date().toISOString(),
      lastUpdated,
      currentStage: options.stage,
      verifyLoops: 0,
      attempts: [],
      usage: {},
      autofixCycles: 0,
    }),
  );
};

/** Write a reservation with a controlled owner and age. */
const seedReservation = (options: { contractId: string; pid: number; ageMs: number }): string => {
  const reservationsDir = join(cwd, RUNS_DIR, 'reservations');
  mkdirSync(reservationsDir, { recursive: true });
  const path = join(reservationsDir, `reserve-${options.contractId}.json`);
  writeFileSync(
    path,
    JSON.stringify({
      contractId: options.contractId,
      pid: options.pid,
      createdAt: new Date(Date.now() - options.ageMs).toISOString(),
    }),
  );
  return path;
};

// ── AC-1: A healthy owner cannot be evicted by age ────────────

describe('AC-1: A healthy owner cannot be evicted by age', () => {
  it('allows lock acquisition when no lock exists', async () => {
    await acquireLock({ contractId: 'C-TEST-1', runId: 'run-test-C-TEST-1', cwd });
    const lock = readLockMetadata({ contractId: 'C-TEST-1', cwd });
    expect(lock).toBeDefined();
    expect(lock?.pid).toBe(process.pid);
    expect(lock?.runId).toBe('run-test-C-TEST-1');
    expect(lock?.generation).toBe(1);
    // Cleanup
    releaseLock({ contractId: 'C-TEST-1', cwd });
  });

  it('persists replacement generations for the next lock owner', async () => {
    await acquireLock({ contractId: 'C-TEST-GEN', runId: 'run-test-C-TEST-GEN', cwd });
    expect(advanceLockGeneration({ contractId: 'C-TEST-GEN', cwd })).toBe(2);
    expect(readLockMetadata({ contractId: 'C-TEST-GEN', cwd })?.generation).toBe(2);
    releaseLock({ contractId: 'C-TEST-GEN', cwd });
  });

  it('refuses acquisition when the lock is held by a live process with a fresh heartbeat', async () => {
    // Create a lock with a live PID (our own) and a very fresh heartbeat.
    seedLock({
      contractId: 'C-TEST-2',
      runId: 'run-other-C-TEST-2',
      pid: process.pid,
      heartbeatAgeMs: 1_000, // 1 second ago — very fresh
    });
    // Also seed an old manifest to tempt the lastUpdated check.
    seedManifest({
      runId: 'run-other-C-TEST-2',
      contractId: 'C-TEST-2',
      stage: 'implement',
      lastUpdatedAgeMs: 4 * 60 * 60 * 1000, // 4 hours old
    });

    // Should throw because the heartbeat is fresh — the owner is alive.
    let workspaceChecks = 0;
    await expect(
      acquireLock({
        contractId: 'C-TEST-2',
        runId: 'run-new-C-TEST-2',
        cwd,
        checkWorkspaceAlive: async () => {
          workspaceChecks += 1;
          return false;
        },
      }),
    ).rejects.toThrow('Pipeline already running');
    expect(workspaceChecks).toBe(0);
    expect(readLockMetadata({ contractId: 'C-TEST-2', cwd })?.runId).toBe('run-other-C-TEST-2');
  });

  it('breaks a stale lock from a dead process, even with a recent lastUpdated', async () => {
    // Dead PID + fresh heartbeat (impossible in practice, but tests the path).
    seedLock({
      contractId: 'C-TEST-3',
      runId: 'run-dead-C-TEST-3',
      pid: DEAD_PID,
      heartbeatAgeMs: 1_000,
      generation: 7,
    });
    seedManifest({
      runId: 'run-dead-C-TEST-3',
      contractId: 'C-TEST-3',
      stage: 'implement',
      lastUpdatedAgeMs: 1_000, // Fresh lastUpdated
    });

    // Dead PID takes priority — should break lock and acquire.
    await acquireLock({ contractId: 'C-TEST-3', runId: 'run-new-C-TEST-3', cwd });
    const lock = readLockMetadata({ contractId: 'C-TEST-3', cwd });
    expect(lock).toBeDefined();
    expect(lock?.runId).toBe('run-new-C-TEST-3');
    expect(lock?.generation).toBe(8);
    releaseLock({ contractId: 'C-TEST-3', cwd });
  });

  it('breaks a stale lock with old heartbeat and old lastUpdated (the 2h+ case)', async () => {
    // Dead PID + very old heartbeat + old lastUpdated.
    seedLock({
      contractId: 'C-TEST-4',
      runId: 'run-stale-C-TEST-4',
      pid: DEAD_PID,
      heartbeatAgeMs: 4 * 60 * 60 * 1000, // 4 hours
    });
    seedManifest({
      runId: 'run-stale-C-TEST-4',
      contractId: 'C-TEST-4',
      stage: 'implement',
      lastUpdatedAgeMs: 4 * 60 * 60 * 1000, // 4 hours
    });

    await acquireLock({ contractId: 'C-TEST-4', runId: 'run-new-C-TEST-4', cwd });
    const lock = readLockMetadata({ contractId: 'C-TEST-4', cwd });
    expect(lock?.runId).toBe('run-new-C-TEST-4');
    releaseLock({ contractId: 'C-TEST-4', cwd });
  });

  it('does NOT break a lock with fresh heartbeat but old lastUpdated (the C-470 fix)', async () => {
    // Live PID + fresh heartbeat + old lastUpdated (the exact C-470 AC-1 scenario).
    // The heartbeat check runs BEFORE the lastUpdated check, so a live
    // heartbeating process is never evicted by manifest age.
    seedLock({
      contractId: 'C-TEST-5',
      runId: 'run-live-C-TEST-5',
      pid: process.pid,
      heartbeatAgeMs: 10_000, // 10 seconds — fresh heartbeat
    });
    seedManifest({
      runId: 'run-live-C-TEST-5',
      contractId: 'C-TEST-5',
      stage: 'implement',
      lastUpdatedAgeMs: 4 * 60 * 60 * 1000, // 4 hours — stale
    });

    await expect(
      acquireLock({ contractId: 'C-TEST-5', runId: 'run-new-C-TEST-5', cwd }),
    ).rejects.toThrow('Pipeline already running');
  });
});

// ── AC-2: Old cleanup cannot damage a new owner ──────────────

describe('AC-2: Old cleanup cannot damage a new owner', () => {
  it('does not release a lock owned by a different process', () => {
    // Create a lock owned by another process (dead PID).
    seedLock({
      contractId: 'C-TEST-AC2',
      runId: 'run-other-C-TEST-AC2',
      pid: DEAD_PID,
      heartbeatAgeMs: 1_000,
    });

    // Our process calls releaseLock — should NOT remove the other's lock.
    releaseLock({ contractId: 'C-TEST-AC2', cwd });

    // The lock should still exist.
    const lock = readLockMetadata({ contractId: 'C-TEST-AC2', cwd });
    expect(lock).toBeDefined();
    expect(lock?.pid).toBe(DEAD_PID);
  });

  it('releases a lock owned by the current process', () => {
    // Acquire our own lock.
    mkdirSync(join(cwd, RUNS_DIR), { recursive: true });
    const lockPath = join(cwd, RUNS_DIR, `lock_C-TEST-AC2-own.json`);
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        contractId: 'C-TEST-AC2-own',
        runId: 'run-own-C-TEST-AC2-own',
        createdAt: new Date().toISOString(),
      }),
    );

    releaseLock({ contractId: 'C-TEST-AC2-own', cwd });

    // The lock should be gone.
    expect(existsSync(lockPath)).toBe(false);
  });
});

// ── AC-3: Late worker results are fenced ─────────────────────

describe('AC-3: Late worker results are fenced', () => {
  const RUN_ID = 'run-fence-test';
  const ROLE: ContractWorkerRole = 'implementer';
  const ATTEMPT = 1;

  /** Create a minimal result artifact with the given generation. */
  const createResult = (generation?: number): ContractStageResult => ({
    runId: RUN_ID,
    stage: ROLE,
    attempt: ATTEMPT,
    generation,
    status: 'passed',
    summary: 'Test result',
    findings: [],
    filesTouched: [],
    evidence: [],
    contractHash: 'abc',
    diffHash: 'def',
  });

  it('accepts a result with matching generation', () => {
    const result = createResult(1);
    const validated = validateStageResult({
      value: result,
      runId: RUN_ID,
      role: ROLE,
      attempt: ATTEMPT,
      minGeneration: 1,
    });
    expect(validated).toBeDefined();
    expect(validated?.status).toBe('passed');
  });

  it('rejects a result from a predecessor (lower generation)', () => {
    const result = createResult(0); // Predecessor's result
    const validated = validateStageResult({
      value: result,
      runId: RUN_ID,
      role: ROLE,
      attempt: ATTEMPT,
      minGeneration: 1, // Current worker's generation
    });
    // Result from generation 0 should be fenced when minGeneration is 1.
    expect(validated).toBeUndefined();
  });

  it('accepts legacy results without generation (treated as 0)', () => {
    const result = createResult(undefined); // Legacy — no generation field
    const validated = validateStageResult({
      value: result,
      runId: RUN_ID,
      role: ROLE,
      attempt: ATTEMPT,
      minGeneration: 0, // Accept generation 0
    });
    expect(validated).toBeDefined();
    expect(validated?.status).toBe('passed');
  });

  it('rejects a legacy result when generation fence is > 0', () => {
    const result = createResult(undefined); // Legacy — treated as 0
    const validated = validateStageResult({
      value: result,
      runId: RUN_ID,
      role: ROLE,
      attempt: ATTEMPT,
      minGeneration: 1, // Current worker expects generation >= 1
    });
    expect(validated).toBeUndefined();
  });

  it('accepts results with higher generation than minimum', () => {
    const result = createResult(5); // Higher generation
    const validated = validateStageResult({
      value: result,
      runId: RUN_ID,
      role: ROLE,
      attempt: ATTEMPT,
      minGeneration: 1,
    });
    expect(validated).toBeDefined();
  });

  it('rejects a malformed generation before applying the fence', () => {
    const validated = validateStageResult({
      value: { ...createResult(1), generation: 'not-a-number' },
      runId: RUN_ID,
      role: ROLE,
      attempt: ATTEMPT,
      minGeneration: 1,
    });
    expect(validated).toBeUndefined();
  });

  it('readStageResult respects generation fencing', () => {
    const stagesDir = join(cwd, RUNS_DIR, RUN_ID, 'stages');
    mkdirSync(stagesDir, { recursive: true });
    const resultPath = join(stagesDir, `${ROLE}-${ATTEMPT}.json`);

    // Write a result with generation 0 (predecessor).
    writeStageResult({ resultPath, result: createResult(0) });

    // Reading with minGeneration 1 should return nothing.
    const read = readStageResult({
      resultPath,
      runId: RUN_ID,
      role: ROLE,
      attempt: ATTEMPT,
      minGeneration: 1,
    });
    expect(read).toBeUndefined();

    // Reading with minGeneration 0 should find it.
    const readLegacy = readStageResult({
      resultPath,
      runId: RUN_ID,
      role: ROLE,
      attempt: ATTEMPT,
      minGeneration: 0,
    });
    expect(readLegacy).toBeDefined();
  });
});

// ── AC-4: Draft IDs are allocated exclusively ─────────────────

describe('AC-4: Draft IDs are allocated exclusively', () => {
  it('allocates the first ID when no contracts exist', () => {
    const contractsDir = join(cwd, 'docs/contracts');
    mkdirSync(contractsDir, { recursive: true });

    const id = reserveContractId({ contractsDir, cwd });
    expect(id).toBe('C-1');
    const reservationPath = join(cwd, RUNS_DIR, 'reservations', 'reserve-C-1.json');
    expect(existsSync(reservationPath)).toBe(true);
    expect(JSON.parse(readFileSync(reservationPath, 'utf-8')).pid).toBe(process.pid);
  });

  it('allocates the next ID after existing contracts', () => {
    const contractsDir = join(cwd, 'docs/contracts');
    mkdirSync(contractsDir, { recursive: true });
    // Create a contract file C-5
    writeFileSync(join(contractsDir, 'C-5-test.md'), '# Test');

    const id = reserveContractId({ contractsDir, cwd });
    expect(id).toBe('C-6');
  });

  it('allocates distinct IDs for concurrent reservations', () => {
    const contractsDir = join(cwd, 'docs/contracts');
    mkdirSync(contractsDir, { recursive: true });

    // Simulate two concurrent calls by creating a reservation file manually.
    const reservationsDir = join(cwd, RUNS_DIR, 'reservations');
    mkdirSync(reservationsDir, { recursive: true });

    // First reservation
    const id1 = reserveContractId({ contractsDir, cwd });
    expect(id1).toBe('C-1');

    // Second reservation — should get a different ID since the first
    // reservation is still held by our process.
    const id2 = reserveContractId({ contractsDir, cwd });
    // Our own PID means our previous reservation is still "alive",
    // so the next available ID should be C-2.
    expect(id2).toBe('C-2');
    expect(id2).not.toBe(id1);
  });

  it('does not reclaim a fresh reservation while its owner is writing metadata', () => {
    const contractsDir = join(cwd, 'docs/contracts');
    const reservationsDir = join(cwd, RUNS_DIR, 'reservations');
    mkdirSync(contractsDir, { recursive: true });
    mkdirSync(reservationsDir, { recursive: true });
    writeFileSync(join(reservationsDir, 'reserve-C-1.json'), '');

    expect(reserveContractId({ contractsDir, cwd })).toBe('C-2');
  });

  it('allocates distinct IDs to separate processes racing for the same candidate', async () => {
    const contractsDir = join(cwd, 'docs/contracts');
    mkdirSync(contractsDir, { recursive: true });
    const moduleUrl = new URL('./manifest_store.ts', import.meta.url).href;
    const startAt = Date.now() + 500;
    const source = `
      import { reserveContractId } from ${JSON.stringify(moduleUrl)};
      while (Date.now() < Number(process.env.RESERVATION_TEST_START)) {
        await Bun.sleep(10);
      }
      const id = reserveContractId({
        contractsDir: process.env.RESERVATION_TEST_CONTRACTS,
        cwd: process.env.RESERVATION_TEST_CWD,
      });
      process.stdout.write(id ?? 'undefined');
      await Bun.sleep(500);
    `;
    const spawnReservation = () =>
      Bun.spawn({
        cmd: [process.execPath, '--eval', source],
        cwd,
        env: {
          ...process.env,
          RESERVATION_TEST_START: String(startAt),
          RESERVATION_TEST_CONTRACTS: contractsDir,
          RESERVATION_TEST_CWD: cwd,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
    const children = [spawnReservation(), spawnReservation()];
    const ids = await Promise.all(
      children.map(async (child) => {
        const [output, errorOutput, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(errorOutput).toBe('');
        expect(exitCode).toBe(0);
        return output.trim();
      }),
    );
    expect(new Set(ids)).toEqual(new Set(['C-1', 'C-2']));
  });

  it('reclaims an expired reservation even when its PID is alive', () => {
    const contractsDir = join(cwd, 'docs/contracts');
    mkdirSync(contractsDir, { recursive: true });
    const stalePath = seedReservation({
      contractId: 'C-9',
      pid: process.pid,
      ageMs: 11 * 60 * 1000,
    });

    expect(reserveContractId({ contractsDir, cwd })).toBe('C-1');
    expect(existsSync(stalePath)).toBe(false);
  });

  it('prunes an expired reservation even when its PID is alive', () => {
    const stalePath = seedReservation({
      contractId: 'C-9',
      pid: process.pid,
      ageMs: 11 * 60 * 1000,
    });

    pruneStaleReservations({ cwd });
    expect(existsSync(stalePath)).toBe(false);
  });

  it('releases a reservation so the ID can be reused', () => {
    const contractsDir = join(cwd, 'docs/contracts');
    mkdirSync(contractsDir, { recursive: true });

    const id1 = reserveContractId({ contractsDir, cwd });
    expect(id1).toBe('C-1');
    if (!id1) {
      return;
    }

    releaseReservation({ contractId: id1, cwd });

    // After releasing, the reservation file is gone. The function starts
    // from maxExisting (0) + 1 = 1, finds no reservation for C-1, and
    // successfully creates a new one.
    const id2 = reserveContractId({ contractsDir, cwd });
    expect(id2).toBe('C-1');
  });

  it('returns undefined when IDs are exhausted (ceiling reached)', () => {
    const contractsDir = join(cwd, 'docs/contracts');
    mkdirSync(contractsDir, { recursive: true });

    // maxAttempts=1 means only try one ID.
    const id = reserveContractId({ contractsDir, cwd, maxAttempts: 0 });
    expect(id).toBeUndefined();
  });
});
