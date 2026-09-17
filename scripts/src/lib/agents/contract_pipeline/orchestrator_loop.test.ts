// scripts/src/lib/agents/contract_pipeline/orchestrator_loop.test.ts
//
// Assembled-loop scenarios (C-472 AC-1, brief P1).
//
// 🔴 These tests drive the REAL `runContractPipeline` controller end to end,
// through the same adapter seam production uses. They pre-stage worker result
// artifacts so `runStage` adopts them deterministically (the orphaned-result
// path) and the controller advances through its actual state machine — no
// live agents, no paid model calls, no Herdr.
//
// Why this file exists: the original orchestrator tests exercised helpers and
// fake-adapter methods; only two drove the controller. The brief asks for the
// assembled loop to be covered directly (success, failed validation, review
// edits, rejection, cancellation, interrupted resume, late results) so future
// controller extractions cannot silently skip a gate.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeHerdrAdapter } from './fake_adapter.ts';
import { writeManifest } from './manifest_store.ts';
import { runContractPipeline } from './orchestrator.ts';
import { writeStageResult } from './stage_result.ts';
import type {
  ContractStageResult,
  ContractWorkerRole,
  RunManifest,
  WorkerLaunchRequest,
} from './types.ts';

let repoRoot: string;
const PRIOR_GATE_SKIP = process.env.CONTRACT_SKIP_PREPUSH_GATE;

beforeEach(() => {
  // The pre-push gate shells out to `bun moon`, which is unavailable/slow in a
  // unit-test sandbox. Skipping it leaves the recorded verdict untouched, so it
  // cannot green anything — these tests exercise the CONTROLLER's transitions,
  // not the validation toolchain (covered by pre_push_gate.test.ts).
  process.env.CONTRACT_SKIP_PREPUSH_GATE = '1';
  repoRoot = mkdtempSync(join(tmpdir(), 'orchestrator-loop-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'test@test.invalid'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repoRoot });
  mkdirSync(join(repoRoot, 'docs', 'contracts'), { recursive: true });
  writeFileSync(
    join(repoRoot, 'docs', 'contracts', 'C-999-test.md'),
    ['---', 'id: C-999', 'status: approved', '---', '', '| **Status** | approved |', ''].join('\n'),
  );
  // A real checkout always carries the role prompts; `loadRolePrompt` throws
  // without them, and a stage that legitimately relaunches needs them present.
  mkdirSync(join(repoRoot, '.pi', 'prompts'), { recursive: true });
  for (const prompt of [
    'contract-implement.md',
    'contract-verify.md',
    'contract-create.md',
    'contract-critique.md',
  ]) {
    writeFileSync(join(repoRoot, '.pi', 'prompts', prompt), `# ${prompt}\n`);
  }
  execFileSync('git', ['add', '-A'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-m', 'initial contract'], { cwd: repoRoot });
});

afterEach(() => {
  if (PRIOR_GATE_SKIP === undefined) {
    delete process.env.CONTRACT_SKIP_PREPUSH_GATE;
  } else {
    process.env.CONTRACT_SKIP_PREPUSH_GATE = PRIOR_GATE_SKIP;
  }
  rmSync(repoRoot, { recursive: true, force: true });
});

const baseManifest = (overrides: Partial<RunManifest> = {}): RunManifest => ({
  version: 3,
  runId: 'run-loop-C-999',
  contractId: 'C-999',
  contractPath: 'docs/contracts/C-999-test.md',
  baseCommit: 'abc123',
  baselineFingerprint: 'fp1',
  startTime: new Date().toISOString(),
  lastUpdated: new Date().toISOString(),
  currentStage: 'implement',
  verifyLoops: 0,
  attempts: [],
  usage: {},
  autofixCycles: 0,
  skipAuthoring: true,
  rootMode: true,
  // The review stage consumes a pre-staged decision at entry; a pane id must
  // exist so the controller does not throw "Review pane was not initialized".
  reviewPaneId: 'fake-review-pane',
  ...overrides,
});

const runDir = (runId: string): string => join(repoRoot, '.pi', 'contract-runs', runId);

/** Map a worker role to the stage name used in result filenames. */
const STAGE_FOR_ROLE = {
  writer: 'write_contract',
  critic: 'critique',
  implementer: 'implement',
  verifier: 'verify',
} as const;

/** Write a stage result the orchestrator will adopt as an orphan. */
const stageResult = (options: {
  runId: string;
  role: ContractWorkerRole;
  attempt: number;
  status: ContractStageResult['status'];
  summary?: string;
  haltedBy?: ContractStageResult['haltedBy'];
}): void => {
  const stagesDir = join(runDir(options.runId), 'stages');
  mkdirSync(stagesDir, { recursive: true });
  // 🔴 The filename uses the STAGE name (implement-1.json), not the role
  // (implementer-1.json) — runStage builds it from options.stage.
  const stage = STAGE_FOR_ROLE[options.role];
  writeStageResult({
    resultPath: join(stagesDir, `${stage}-${options.attempt}.json`),
    result: {
      runId: options.runId,
      stage: options.role,
      attempt: options.attempt,
      generation: 1,
      status: options.status,
      summary: options.summary ?? `${options.role} ${options.status}`,
      findings: [],
      filesTouched: [],
      evidence: [],
      contractHash: 'h1',
      diffHash: 'h2',
      ...(options.haltedBy ? { haltedBy: options.haltedBy } : {}),
    },
  });
};

/** Pre-stage a review decision so the review stage consumes it at entry. */
const reviewDecision = (
  runId: string,
  decision: 'approve' | 'merge' | 'change' | 'reject',
  summary: string,
): void => {
  const dir = join(runDir(runId), 'review');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'decision.json'),
    JSON.stringify({
      runId,
      decision,
      summary,
      diffHash: 'h',
      contractChanged: false,
      createdAt: new Date().toISOString(),
    }),
  );
};

const runPipeline = (options: {
  runId: string;
  adapter: FakeHerdrAdapter;
  yolo?: boolean;
}): Promise<RunManifest> =>
  runContractPipeline({
    repoRoot,
    resumeRunId: options.runId,
    skipAuthoring: true,
    rootMode: true,
    yolo: options.yolo,
    adapterFactory: () => options.adapter,
  });

/**
 * A result writer that answers every launched stage from a scripted plan.
 * Keys are `${stage}-${attempt}`; an absent key falls back to `defaultStatus`.
 */
const planWriter =
  (
    plan: Record<string, ContractStageResult['status']>,
    defaultStatus: ContractStageResult['status'] = 'passed',
  ) =>
  (request: WorkerLaunchRequest): void => {
    const status =
      plan[`${request.stage}-${request.attempt}`] ?? plan[request.stage] ?? defaultStatus;
    writeStageResult({
      resultPath: request.resultPath,
      result: {
        runId: request.runId,
        stage: request.role,
        attempt: request.attempt,
        // 🔴 Mirror the launch's generation. The orchestrator fences every
        // result to the current lock generation (1 for a fresh run); omitting
        // it makes the result look like generation 0 and it is silently
        // rejected, so the stage waits until its hard timeout.
        generation: request.generation,
        status,
        summary: `${request.role} ${status}`,
        findings: [],
        filesTouched: [],
        evidence: [],
        contractHash: 'h1',
        diffHash: 'h2',
      },
    });
  };

describe('assembled loop — adoption and resume', () => {
  it('adopts an orphaned implement result without relaunching the implementer', async () => {
    const runId = 'run-loop-adopt';
    // A writer that would let any later stage advance. If the controller wrongly
    // re-launched the implementer, its launch would be recorded below.
    const adapter = new FakeHerdrAdapter({
      workspacePath: repoRoot,
      resultWriter: planWriter({}),
    });
    writeManifest({ cwd: repoRoot, manifest: baseManifest({ runId }) });
    // Implement already finished (as after an orchestrator crash)…
    stageResult({ runId, role: 'implementer', attempt: 1, status: 'changes_requested' });
    // …and the verifier's verdict is pre-staged as passed so the loop reaches review.
    stageResult({ runId, role: 'verifier', attempt: 1, status: 'passed' });
    reviewDecision(runId, 'reject', 'Handed back to the user.');

    const result = await runPipeline({ runId, adapter });

    // 🔴 The orphaned implement-1 result was adopted — the controller did NOT
    // launch a fresh implementer for it (which would burn a live model call).
    expect(adapter.launchedWorkers.some((w) => w.stage === 'implement' && w.attempt === 1)).toBe(
      false,
    );
    expect(
      result.attempts.some(
        (a) => a.stage === 'implement' && a.result?.status === 'changes_requested',
      ),
    ).toBe(true);
    expect(result.reviewDecision?.decision).toBe('reject');
    expect(result.currentStage).toBe('blocked');
    expect(result.blockedReason).toBe('Handed back to the user.');
  }, 30_000);
});

describe('assembled loop — failed validation', () => {
  it('routes a repeatedly-failing verifier to review instead of looping forever', async () => {
    const runId = 'run-loop-failed-verify';
    // Every implement passes; the verifier always asks for changes → the
    // verify bounce budget is spent and the controller must escalate.
    const adapter = new FakeHerdrAdapter({
      workspacePath: repoRoot,
      resultWriter: planWriter({ verify: 'changes_requested' }),
    });
    writeManifest({ cwd: repoRoot, manifest: baseManifest({ runId }) });
    // Pre-staged review decision so the review stage completes immediately.
    reviewDecision(runId, 'reject', 'Verifier never passed.');

    const result = await runPipeline({ runId, adapter });

    // The loop was bounded: it reached review rather than spinning.
    expect(result.attempts.some((a) => a.stage === 'verify')).toBe(true);
    expect(result.currentStage).toBe('blocked');
    expect(result.reviewDecision?.decision).toBe('reject');
  }, 30_000);
});

describe('assembled loop — gate enforcement at controller boundaries', () => {
  it('escalates a blocked worker verdict to the captain instead of ending silently', async () => {
    const runId = 'run-loop-blocked-escalation';
    const adapter = new FakeHerdrAdapter({
      workspacePath: repoRoot,
      resultWriter: planWriter({ 'implement-1': 'blocked' }),
    });
    writeManifest({
      cwd: repoRoot,
      manifest: baseManifest({
        runId,
        blockedEscalations: 0,
        blockedEscalationRounds: 0,
      }),
    });
    // The escalation reaches review; a pre-staged reject lets it terminate.
    reviewDecision(runId, 'reject', 'Blocked, handing back.');

    const result = await runPipeline({ runId, adapter });

    expect(result.blockedEscalationRounds).toBeGreaterThanOrEqual(1);
    expect(result.reviewDecision).toBeDefined();
  }, 30_000);
});

describe('assembled loop — interrupted resume and late results', () => {
  it('resumes an interrupted run, preserving recorded attempts', async () => {
    const runId = 'run-loop-resume';
    const adapter = new FakeHerdrAdapter({
      workspacePath: repoRoot,
      resultWriter: planWriter({}),
    });
    // The run crashed mid-implement; the manifest already holds attempt 1.
    writeManifest({
      cwd: repoRoot,
      manifest: baseManifest({
        runId,
        attempts: [
          {
            stage: 'implement',
            role: 'implementer',
            attempt: 1,
            paneId: 'old-pane',
            startTime: new Date().toISOString(),
            result: {
              runId,
              stage: 'implementer',
              attempt: 1,
              status: 'passed',
              summary: 'earlier implement',
              findings: [],
              filesTouched: [],
              evidence: [],
              contractHash: 'h',
              diffHash: 'd',
            },
          },
        ],
        currentStage: 'implement',
      }),
    });
    // Verifier passes; review rejects so the run terminates deterministically.
    stageResult({ runId, role: 'verifier', attempt: 1, status: 'passed' });
    reviewDecision(runId, 'reject', 'Resumed and stopped.');

    const result = await runPipeline({ runId, adapter });

    // The prior attempt survived the resume…
    expect(result.attempts.some((a) => a.stage === 'implement' && a.attempt === 1)).toBe(true);
    // …and the controller advanced to review and consumed the decision.
    expect(result.reviewDecision?.decision).toBe('reject');
    expect(result.currentStage).toBe('blocked');
  }, 30_000);
});
