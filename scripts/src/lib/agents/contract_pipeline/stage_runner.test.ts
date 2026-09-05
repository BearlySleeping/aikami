// scripts/src/lib/agents/contract_pipeline/stage_runner.test.ts
//
// Regression cover for the retry safeguard's adoption rule. See the RETRY
// SAFEGUARD comment in stage_runner.ts for the two situations it must tell
// apart; run-mssulnwd-C-390 is the incident that proved it could not.
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { writeStageResult } from './stage_result.ts';
import { runStage } from './stage_runner.ts';
import type { ContractStageResult, WorkerLaunchRequest } from './types.ts';

const RUN_ID = 'run-test-C-999';

let runDirectory: string;
let repoRoot: string;

beforeEach(() => {
  runDirectory = mkdtempSync(join(tmpdir(), 'stage-runner-'));
  // Tests run with cwd=scripts/; the role prompts live in the repo's .pi/prompts.
  repoRoot = dirname(process.cwd());
});

afterEach(() => {
  rmSync(runDirectory, { recursive: true, force: true });
});

const resultFor = (
  attempt: number,
  status: ContractStageResult['status'],
): ContractStageResult => ({
  runId: RUN_ID,
  stage: 'implementer',
  attempt,
  status,
  summary: `implementer attempt ${attempt}`,
  findings: [],
  filesTouched: [],
  evidence: [],
  contractHash: 'abc',
  diffHash: 'def',
});

const seed = (attempt: number, status: ContractStageResult['status']): void => {
  writeStageResult({
    resultPath: join(runDirectory, 'stages', `implement-${attempt}.json`),
    result: resultFor(attempt, status),
  });
};

/** Runs a stage whose worker writes `workerResult` as soon as it launches. */
const run = async (options: {
  attempt: number;
  previousAttemptRecordedStatus?: ContractStageResult['status'];
  workerResult?: ContractStageResult['status'];
}) => {
  const launched: WorkerLaunchRequest[] = [];
  const outcome = await runStage({
    repoRoot,
    runDirectory,
    runId: RUN_ID,
    stage: 'implement',
    attempt: options.attempt,
    contractPath: 'docs/contracts/C-999-test.md',
    idleTimeoutMs: 60_000,
    hardTimeoutMs: 60_000,
    pollIntervalMs: 5,
    previousAttemptRecordedStatus: options.previousAttemptRecordedStatus,
    launchWorker: async (request) => {
      launched.push(request);
      // Stand in for a worker that completes immediately.
      writeStageResult({
        resultPath: request.resultPath,
        result: {
          ...resultFor(options.attempt, options.workerResult ?? 'passed'),
          generation: request.generation,
        },
      });
      return { paneId: 'pane-test' };
    },
    checkAgentWorking: async () => true,
  });
  return { outcome, launched };
};

describe('runStage retry safeguard', () => {
  it('adopts a late worker result the orchestrator never consumed', async () => {
    // Attempt 1 hard-timed-out (recorded `blocked`), then the worker finished
    // and overwrote the file with a real pass. Re-running would discard it.
    seed(1, 'passed');
    const { outcome, launched } = await run({
      attempt: 2,
      previousAttemptRecordedStatus: 'blocked',
    });
    expect(outcome.paneId).toBe('recovered-prev');
    expect(outcome.result.status).toBe('passed');
    expect(launched).toHaveLength(0);
  });

  it('re-runs the worker when the previous pass was already consumed', async () => {
    // 🔴 C-390: verifier asked for changes after implement-N passed, so this
    // is a deliberate new round. Adopting here copied the old result forward
    // and the implementer never ran.
    seed(1, 'passed');
    const { outcome, launched } = await run({
      attempt: 2,
      previousAttemptRecordedStatus: 'passed',
    });
    expect(launched).toHaveLength(1);
    expect(outcome.paneId).toBe('pane-test');
    expect(outcome.result.attempt).toBe(2);
  });

  it('does not copy the previous result forward on a new round', async () => {
    seed(1, 'passed');
    const { outcome } = await run({
      attempt: 2,
      previousAttemptRecordedStatus: 'passed',
      workerResult: 'changes_requested',
    });
    // The real worker's verdict wins — not attempt 1's stale `passed`.
    expect(outcome.result.status).toBe('changes_requested');
  });

  it('still adopts an orphaned result for the SAME attempt', async () => {
    // Orchestrator crashed after the worker wrote its result but before
    // recording it. The attempt number did not advance.
    seed(2, 'passed');
    const { outcome, launched } = await run({
      attempt: 2,
      previousAttemptRecordedStatus: 'passed',
    });
    expect(outcome.paneId).toBe('recovered');
    expect(launched).toHaveLength(0);
  });

  it('ignores a previous attempt that did not pass', async () => {
    seed(1, 'changes_requested');
    const { launched } = await run({ attempt: 2, previousAttemptRecordedStatus: 'blocked' });
    expect(launched).toHaveLength(1);
  });

  it('launches normally on the first attempt', async () => {
    const { launched, outcome } = await run({ attempt: 1 });
    expect(launched).toHaveLength(1);
    expect(outcome.result.status).toBe('passed');
  });

  it('adopts the pane ID returned by a relaunch for the next health check', async () => {
    // A relaunch spawns a NEW pane. The next checkAgentWorking must poll
    // that replacement ID — polling the dead pane would make every relaunch
    // look like another crash.
    const checkedPaneIds: string[] = [];
    const launchGenerations: Array<number | undefined> = [];
    let launches = 0;
    let replacementChecks = 0;
    const outcome = await runStage({
      repoRoot,
      runDirectory,
      runId: RUN_ID,
      stage: 'implement',
      attempt: 1,
      contractPath: 'docs/contracts/C-999-test.md',
      idleTimeoutMs: 60_000,
      hardTimeoutMs: 60_000,
      pollIntervalMs: 5,
      generation: 10,
      advanceGeneration: () => 11,
      launchWorker: async (request) => {
        launches += 1;
        launchGenerations.push(request.generation);
        if (launches === 1) {
          return { paneId: 'pane-original' };
        }
        // Relaunch: new pane, same result path. Do NOT write the result
        // yet — the test asserts the next health check uses this ID.
        return { paneId: 'pane-relaunched' };
      },
      checkAgentWorking: async (paneId) => {
        checkedPaneIds.push(paneId);
        if (paneId === 'pane-relaunched') {
          replacementChecks += 1;
          // A late predecessor result must not satisfy the replacement.
          writeStageResult({
            resultPath: join(runDirectory, 'stages', 'implement-1.json'),
            result: {
              ...resultFor(1, 'passed'),
              generation: replacementChecks === 1 ? 10 : 11,
            },
          });
          return true;
        }
        // Original worker is dead — drives idleMs past DEAD_CHECK_GRACE_MS
        // so the in-loop relaunch fires.
        return false;
      },
    });
    expect(launches).toBe(2);
    expect(launchGenerations).toEqual([10, 11]);
    expect(replacementChecks).toBe(2);
    expect(checkedPaneIds).toContain('pane-original');
    // The health check AFTER the relaunch must use the replacement pane ID.
    expect(checkedPaneIds).toContain('pane-relaunched');
    expect(checkedPaneIds.indexOf('pane-relaunched')).toBeGreaterThan(
      checkedPaneIds.indexOf('pane-original'),
    );
    expect(outcome.paneId).toBe('pane-relaunched');
    expect(outcome.result.status).toBe('passed');
    // The in-loop relaunch only fires after DEAD_CHECK_GRACE_MS (5s) of
    // confirmed non-working — longer than bun's default 5s per-test timeout.
  }, 30_000);
});

describe('runStage guard-halt settle window', () => {
  /** Result a supervisor writes on the worker's behalf. */
  const guardResult = (attempt: number): ContractStageResult => ({
    ...resultFor(attempt, 'blocked'),
    summary: 'Loop detected: the same turn repeated 10 times.',
    findings: ['Agent repeated an identical turn 10 times without progressing.'],
    haltedBy: 'cost_guard',
  });

  it("adopts the worker's own verdict when it lands inside the window", async () => {
    // 🔴 C-442: the cost guard wrote `blocked` at 13:57:10 and the very same
    // verifier session wrote `passed` over it at 13:58. The orchestrator had
    // already gone terminal on the guess.
    const resultPath = join(runDirectory, 'stages', 'implement-1.json');
    const outcome = await runStage({
      repoRoot,
      runDirectory,
      runId: RUN_ID,
      stage: 'implement',
      attempt: 1,
      contractPath: 'docs/contracts/C-999-test.md',
      idleTimeoutMs: 60_000,
      hardTimeoutMs: 60_000,
      pollIntervalMs: 5,
      guardSettleMs: 2_000,
      launchWorker: async () => {
        // Guard trips first…
        writeStageResult({ resultPath, result: guardResult(1) });
        // …and the worker finishes anyway, a beat later.
        setTimeout(() => {
          writeStageResult({ resultPath, result: resultFor(1, 'passed') });
        }, 200);
        return { paneId: 'pane-test' };
      },
      checkAgentWorking: async () => true,
    });
    expect(outcome.result.status).toBe('passed');
    expect(outcome.result.haltedBy).toBeUndefined();
  });

  it('lets the halt stand when no worker verdict arrives', async () => {
    const resultPath = join(runDirectory, 'stages', 'implement-1.json');
    const outcome = await runStage({
      repoRoot,
      runDirectory,
      runId: RUN_ID,
      stage: 'implement',
      attempt: 1,
      contractPath: 'docs/contracts/C-999-test.md',
      idleTimeoutMs: 60_000,
      hardTimeoutMs: 60_000,
      pollIntervalMs: 5,
      guardSettleMs: 300,
      launchWorker: async () => {
        writeStageResult({ resultPath, result: guardResult(1) });
        return { paneId: 'pane-test' };
      },
      checkAgentWorking: async () => true,
    });
    expect(outcome.result.status).toBe('blocked');
    expect(outcome.result.haltedBy).toBe('cost_guard');
  });

  it('does not stall a normal worker result', async () => {
    const started = Date.now();
    const { outcome } = await run({ attempt: 1 });
    expect(outcome.result.status).toBe('passed');
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

// ── C-472 AC-2: Recovery scenarios ──────────────────────────

describe('runStage recovery: process exit without result', () => {
  it('returns blocked when hard timeout fires and no result was written', async () => {
    // Worker exits without ever writing contract_stage_complete.
    // The hard timeout produces 'blocked', not 'failed'.
    const outcome = await runStage({
      repoRoot,
      runDirectory,
      runId: RUN_ID,
      stage: 'implement',
      attempt: 1,
      contractPath: 'docs/contracts/C-999-test.md',
      idleTimeoutMs: 60_000,
      hardTimeoutMs: 100,
      pollIntervalMs: 5,
      launchWorker: async () => ({ paneId: 'pane-no-result' }),
      checkAgentWorking: async () => true,
    });
    expect(outcome.result.status).toBe('blocked');
    expect(outcome.result.summary).toContain('timeout');
  });

  it('adopts the result produced by a relaunched dead worker', async () => {
    let launches = 0;
    let relaunchResult: ContractStageResult | undefined;
    const outcome = await runStage({
      repoRoot,
      runDirectory,
      runId: RUN_ID,
      stage: 'implement',
      attempt: 1,
      contractPath: 'docs/contracts/C-999-test.md',
      idleTimeoutMs: 10,
      hardTimeoutMs: 10_000,
      pollIntervalMs: 5,
      launchWorker: async (request) => {
        launches += 1;
        if (launches === 2) {
          relaunchResult = {
            ...resultFor(1, 'passed'),
            generation: request.generation,
          };
          writeStageResult({ resultPath: request.resultPath, result: relaunchResult });
        }
        return { paneId: launches === 1 ? 'pane-dead' : 'pane-relaunched' };
      },
      checkAgentWorking: async () => false,
    });

    expect(launches).toBe(2);
    expect(relaunchResult).toBeDefined();
    expect(outcome.paneId).toBe('pane-relaunched');
    if (!relaunchResult) {
      throw new Error('Expected the relaunched worker to produce a result.');
    }
    expect(outcome.result).toEqual(relaunchResult);
  });
});

describe('runStage recovery: generation fencing prevents duplicate adoption', () => {
  it('rejects a stale result from a predecessor generation', async () => {
    // Worker 1 (generation 10) wrote a result, was replaced.
    // Worker 2 (generation 11) is the current worker.
    // Worker 1's late result must NOT be adopted.
    const resultPath = join(runDirectory, 'stages', 'implement-1.json');
    const outcome = await runStage({
      repoRoot,
      runDirectory,
      runId: RUN_ID,
      stage: 'implement',
      attempt: 1,
      contractPath: 'docs/contracts/C-999-test.md',
      idleTimeoutMs: 60_000,
      hardTimeoutMs: 100,
      pollIntervalMs: 5,
      generation: 11,
      advanceGeneration: () => 12,
      launchWorker: async () => {
        // Write a result with the OLD generation (predecessor)
        writeStageResult({
          resultPath,
          result: { ...resultFor(1, 'passed'), generation: 10 },
        });
        return { paneId: 'pane-test' };
      },
      checkAgentWorking: async () => true,
    });
    // Result with generation 10 should be fenced out — minGeneration is 11
    expect(outcome.result.status).toBe('blocked');
  });

  it('adopts a result with matching generation', async () => {
    const resultPath = join(runDirectory, 'stages', 'implement-1.json');
    const outcome = await runStage({
      repoRoot,
      runDirectory,
      runId: RUN_ID,
      stage: 'implement',
      attempt: 1,
      contractPath: 'docs/contracts/C-999-test.md',
      idleTimeoutMs: 60_000,
      hardTimeoutMs: 60_000,
      pollIntervalMs: 5,
      generation: 5,
      launchWorker: async () => {
        // Write a result with matching generation
        writeStageResult({
          resultPath,
          result: { ...resultFor(1, 'passed'), generation: 5 },
        });
        return { paneId: 'pane-test' };
      },
      checkAgentWorking: async () => true,
    });
    expect(outcome.result.status).toBe('passed');
  });
});

describe('runStage recovery: duplicate event after crash', () => {
  it('recovers from an orchestrator crash mid-attempt', async () => {
    // Orchestrator crashed after launching the worker but before recording
    // the result. The worker finished and wrote its result. The new
    // orchestrator starts the same attempt again and finds the orphaned result.
    seed(1, 'passed');
    const { outcome, launched } = await run({
      attempt: 1,
    });
    expect(outcome.paneId).toBe('recovered');
    expect(outcome.result.status).toBe('passed');
    expect(launched).toHaveLength(0);
  });
});
