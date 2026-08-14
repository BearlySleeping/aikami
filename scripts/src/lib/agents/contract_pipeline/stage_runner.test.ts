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
        result: resultFor(options.attempt, options.workerResult ?? 'passed'),
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
});
