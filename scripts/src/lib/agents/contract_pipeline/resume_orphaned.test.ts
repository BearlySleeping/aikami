// scripts/src/lib/agents/contract_pipeline/resume_orphaned.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyRun, MAX_AUTO_RESUMES, ORPHAN_WINDOW_MS, scanRepo } from './resume_orphaned.ts';
import type { ContractPipelineStage, RunManifest } from './types.ts';

const RUNS_DIR = '.pi/contract-runs';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'resume-orphaned-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

const manifestFor = (options: {
  runId: string;
  contractId: string;
  stage: ContractPipelineStage;
}): RunManifest =>
  ({
    version: 3,
    runId: options.runId,
    contractId: options.contractId,
    contractPath: `docs/contracts/${options.contractId}.md`,
    baseCommit: 'abc',
    baselineFingerprint: 'fp',
    startTime: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    currentStage: options.stage,
    verifyLoops: 0,
    attempts: [],
    usage: {},
    autofixCycles: 0,
  }) as RunManifest;

/** Write a run directory plus, optionally, a lock with a chosen heartbeat age. */
const seed = (options: {
  runId: string;
  contractId: string;
  stage: ContractPipelineStage;
  lock?: { pid: number; heartbeatAgeMs: number; runId?: string };
  autoResumes?: number;
}): RunManifest => {
  const manifest = manifestFor(options);
  const directory = join(cwd, RUNS_DIR, options.runId);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest));

  if (options.autoResumes !== undefined) {
    writeFileSync(
      join(directory, 'auto-resume.json'),
      JSON.stringify({ count: options.autoResumes, lastAt: new Date().toISOString() }),
    );
  }

  if (options.lock) {
    const lockPath = join(
      cwd,
      RUNS_DIR,
      `lock_${options.contractId.replace(/[^A-Za-z0-9]/g, '-')}.json`,
    );
    writeFileSync(
      lockPath,
      JSON.stringify({
        pid: options.lock.pid,
        contractId: options.contractId,
        runId: options.lock.runId ?? options.runId,
        createdAt: new Date().toISOString(),
      }),
    );
    const when = new Date(Date.now() - options.lock.heartbeatAgeMs);
    utimesSync(lockPath, when, when);
  }
  return manifest;
};

/** A pid that is certainly dead: kernels never allocate 0 to a user process. */
const DEAD_PID = 2_147_483_646;

describe('classifyRun', () => {
  it('resumes a run whose orchestrator just died', () => {
    const manifest = seed({
      runId: 'run-a-C-1',
      contractId: 'C-1',
      stage: 'implement',
      lock: { pid: DEAD_PID, heartbeatAgeMs: 5_000 },
    });
    expect(classifyRun({ manifest, cwd }).verdict).toBe('resume');
  });

  it('refuses a run abandoned days ago — the nine-stale-locks case', () => {
    const manifest = seed({
      runId: 'run-b-C-2',
      contractId: 'C-2',
      stage: 'review',
      lock: { pid: DEAD_PID, heartbeatAgeMs: 2 * 24 * 60 * 60 * 1000 },
    });
    expect(classifyRun({ manifest, cwd }).verdict).toBe('stale');
  });

  it('treats the window boundary as stale, not resumable', () => {
    const manifest = seed({
      runId: 'run-c-C-3',
      contractId: 'C-3',
      stage: 'implement',
      lock: { pid: DEAD_PID, heartbeatAgeMs: ORPHAN_WINDOW_MS + 1_000 },
    });
    expect(classifyRun({ manifest, cwd }).verdict).toBe('stale');
  });

  it('never touches a run whose orchestrator is alive', () => {
    const manifest = seed({
      runId: 'run-d-C-4',
      contractId: 'C-4',
      stage: 'implement',
      lock: { pid: process.pid, heartbeatAgeMs: 1_000 },
    });
    expect(classifyRun({ manifest, cwd }).verdict).toBe('live');
  });

  it.each(['blocked', 'pr_created', 'merged'] as ContractPipelineStage[])(
    'never resumes a terminal run (%s), even with a fresh heartbeat',
    (stage) => {
      const manifest = seed({
        runId: `run-e-${stage}-C-5`,
        contractId: `C-5${stage}`,
        stage,
        lock: { pid: DEAD_PID, heartbeatAgeMs: 1_000 },
      });
      expect(classifyRun({ manifest, cwd }).verdict).toBe('terminal');
    },
  );

  it('leaves a cleanly released run alone (no lock)', () => {
    const manifest = seed({ runId: 'run-f-C-6', contractId: 'C-6', stage: 'implement' });
    expect(classifyRun({ manifest, cwd }).verdict).toBe('no_lock');
  });

  it('ignores a lock belonging to a different run of the same contract', () => {
    const manifest = seed({
      runId: 'run-g-C-7',
      contractId: 'C-7',
      stage: 'implement',
      lock: { pid: DEAD_PID, heartbeatAgeMs: 1_000, runId: 'run-other-C-7' },
    });
    expect(classifyRun({ manifest, cwd }).verdict).toBe('no_lock');
  });

  it('stops resuming a run that keeps dying', () => {
    const manifest = seed({
      runId: 'run-h-C-8',
      contractId: 'C-8',
      stage: 'implement',
      lock: { pid: DEAD_PID, heartbeatAgeMs: 1_000 },
      autoResumes: MAX_AUTO_RESUMES,
    });
    expect(classifyRun({ manifest, cwd }).verdict).toBe('exhausted');
  });

  it('lets a long-healthy run earn its attempts back', () => {
    const runId = 'run-i-C-9';
    seed({
      runId,
      contractId: 'C-9',
      stage: 'implement',
      lock: { pid: DEAD_PID, heartbeatAgeMs: 1_000 },
    });
    // An exhausted counter from two hours ago is past RESUME_COUNTER_TTL_MS.
    writeFileSync(
      join(cwd, RUNS_DIR, runId, 'auto-resume.json'),
      JSON.stringify({
        count: MAX_AUTO_RESUMES,
        lastAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      }),
    );
    const manifest = manifestFor({ runId, contractId: 'C-9', stage: 'implement' });
    expect(classifyRun({ manifest, cwd }).verdict).toBe('resume');
  });
});

describe('scanRepo', () => {
  it('returns nothing when the repo has never run a pipeline', () => {
    expect(scanRepo({ cwd })).toEqual([]);
  });

  it('classifies every run and ignores non-run directories', () => {
    seed({
      runId: 'run-x-C-10',
      contractId: 'C-10',
      stage: 'implement',
      lock: { pid: DEAD_PID, heartbeatAgeMs: 2_000 },
    });
    seed({ runId: 'run-y-C-11', contractId: 'C-11', stage: 'merged' });
    mkdirSync(join(cwd, RUNS_DIR, 'not-a-run'), { recursive: true });

    const verdicts = Object.fromEntries(scanRepo({ cwd }).map((c) => [c.runId, c.verdict]));
    expect(verdicts).toEqual({ 'run-x-C-10': 'resume', 'run-y-C-11': 'terminal' });
  });
});
