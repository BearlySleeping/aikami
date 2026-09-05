// scripts/src/lib/agents/contract_pipeline/orchestrator.test.ts
//
// Scenario-based lifecycle tests using fake adapters (C-472).
// Tests the orchestrator's pure functions and validates that the
// adapter injection seam works for deterministic testing.

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeHerdrAdapter } from './fake_adapter.ts';
import { writeManifest } from './manifest_store.ts';
import {
  prePushGateForRevision,
  ReviewAbandonedError,
  runContractPipeline,
  verifierFeedback,
} from './orchestrator.ts';
import * as stateMachine from './state_machine.ts';
import type { ContractStageResult, RunManifest } from './types.ts';

// ── Helpers ─────────────────────────────────────────────────

const baseManifest = (overrides: Partial<RunManifest> = {}): RunManifest => ({
  version: 3,
  runId: 'run-test-C-472',
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
  ...overrides,
});

const verifyResult = (
  status: ContractStageResult['status'] = 'changes_requested',
): ContractStageResult => ({
  runId: 'run-test-C-472',
  stage: 'verifier',
  attempt: 1,
  status,
  summary: 'Verifier found issues.',
  findings: ['Missing error handling in login flow'],
  filesTouched: [],
  evidence: [],
  contractHash: 'h1',
  diffHash: 'h2',
});

// ── prePushGateForRevision ────────────────────────────────────

describe('prePushGateForRevision', () => {
  it('returns gate diagnostics when revision matches', () => {
    const manifest = baseManifest({
      prePushValidation: {
        ok: true,
        output: 'All checks passed',
        checkedAt: new Date().toISOString(),
        revision: 'abc123',
      },
    });
    const result = prePushGateForRevision({ manifest, revision: 'abc123' });
    expect(result).toBeDefined();
    expect(result?.ok).toBe(true);
    expect(result?.output).toBe('All checks passed');
  });

  it('returns undefined when no validation record exists', () => {
    const manifest = baseManifest();
    const result = prePushGateForRevision({ manifest, revision: 'abc123' });
    expect(result).toBeUndefined();
  });

  it('returns undefined when revision is unknown', () => {
    const manifest = baseManifest({
      prePushValidation: {
        ok: true,
        output: 'All checks passed',
        checkedAt: new Date().toISOString(),
        revision: 'abc123',
      },
    });
    const result = prePushGateForRevision({ manifest, revision: 'unknown' });
    expect(result).toBeUndefined();
  });

  it('returns undefined when revision does not match', () => {
    const manifest = baseManifest({
      prePushValidation: {
        ok: true,
        output: 'All checks passed',
        checkedAt: new Date().toISOString(),
        revision: 'abc123',
      },
    });
    const result = prePushGateForRevision({ manifest, revision: 'def456' });
    expect(result).toBeUndefined();
  });

  it('returns gate failure diagnostics when gate failed', () => {
    const manifest = baseManifest({
      prePushValidation: {
        ok: false,
        output: 'TypeScript errors found',
        checkedAt: new Date().toISOString(),
        revision: 'abc123',
      },
    });
    const result = prePushGateForRevision({ manifest, revision: 'abc123' });
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
    expect(result?.output).toBe('TypeScript errors found');
  });
});

// ── verifierFeedback (extended scenarios) ──────────────────────

describe('verifierFeedback extended', () => {
  it('includes the review captain details when present on change', () => {
    const manifest = baseManifest({
      attempts: [
        {
          stage: 'verify' as const,
          role: 'verifier' as const,
          attempt: 1,
          paneId: 'pane-v',
          startTime: new Date().toISOString(),
          result: verifyResult(),
        },
      ],
      reviewDecision: {
        runId: 'run-test-C-472',
        decision: 'change',
        summary: 'Fix the login redirect loop.',
        details: 'AskClaude traced it to middleware.ts:42.',
        diffHash: 'h3',
        contractChanged: false,
        createdAt: new Date().toISOString(),
      },
    });
    const feedback = verifierFeedback({ manifest, attempt: 2 });
    expect(feedback).toContain('Fix the login redirect loop.');
    expect(feedback).toContain('AskClaude traced it to middleware.ts:42.');
  });

  it('returns undefined on first attempt regardless of manifest state', () => {
    const manifest = baseManifest({
      attempts: [
        {
          stage: 'verify' as const,
          role: 'verifier' as const,
          attempt: 1,
          paneId: 'pane-v',
          startTime: new Date().toISOString(),
          result: verifyResult(),
        },
      ],
    });
    expect(verifierFeedback({ manifest, attempt: 1 })).toBeUndefined();
  });

  it('includes previous implementer summary when available', () => {
    const manifest = baseManifest({
      attempts: [
        {
          stage: 'implement' as const,
          role: 'implementer' as const,
          attempt: 1,
          paneId: 'pane-i',
          startTime: new Date().toISOString(),
          result: {
            runId: 'run-test-C-472',
            stage: 'implementer',
            attempt: 1,
            status: 'changes_requested' as const,
            summary: 'Partial implementation of login flow',
            findings: ['Missing redirect handler'],
            filesTouched: ['src/routes/login/+page.svelte'],
            evidence: [],
            contractHash: 'h1',
            diffHash: 'h2',
          },
        },
        {
          stage: 'verify' as const,
          role: 'verifier' as const,
          attempt: 1,
          paneId: 'pane-v',
          startTime: new Date().toISOString(),
          result: verifyResult(),
        },
      ],
    });
    const feedback = verifierFeedback({ manifest, attempt: 2 });
    expect(feedback).toContain('Previous implementer summary');
    expect(feedback).toContain('Partial implementation of login flow');
  });
});

// ── ReviewAbandonedError ─────────────────────────────────────

describe('ReviewAbandonedError', () => {
  it('creates an error with the correct name and message', () => {
    const err = new ReviewAbandonedError('Review tab was closed.');
    expect(err.name).toBe('ReviewAbandonedError');
    expect(err.message).toBe('Review tab was closed.');
    expect(err).toBeInstanceOf(Error);
  });
});

// ── Fake-adapter scenario tests ──────────────────────────────

describe('runContractPipeline with FakeHerdrAdapter', () => {
  let tmpDir: string;
  let adapter: FakeHerdrAdapter;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'orchestrator-scenario-'));
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@test.invalid'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
    mkdirSync(join(tmpDir, 'docs', 'contracts'), { recursive: true });
    writeFileSync(
      join(tmpDir, 'docs', 'contracts', 'C-999-test.md'),
      ['---', 'id: C-999', 'status: draft', '---', '', '| **Status** | draft |', ''].join('\n'),
    );
    execFileSync('git', ['add', '-A'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'initial contract'], { cwd: tmpDir });
    adapter = new FakeHerdrAdapter({ workspacePath: tmpDir });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('runs the pipeline through adapterFactory and applies the stage transition', async () => {
    let factoryCalled = false;
    let transitionInput: Parameters<typeof stateMachine.resolveNextStage>[0] | undefined;
    const runId = 'run-test-C-472-adapter';
    const contractPath = join(tmpDir, 'docs', 'contracts', 'C-999-test.md');
    const pipelineAdapter = new FakeHerdrAdapter({ workspacePath: '' });
    writeManifest({
      cwd: tmpDir,
      manifest: baseManifest({
        runId,
        contractPath,
        currentStage: 'implement',
        verifyLoops: 1,
        blockedEscalations: 1,
        skipAuthoring: true,
        rootMode: true,
      }),
    });

    const factory = (options: { repoRoot: string; runId: string; contractId: string }) => {
      factoryCalled = true;
      expect(options).toEqual({ repoRoot: tmpDir, runId, contractId: 'C-999' });
      return pipelineAdapter;
    };
    const resolveNextStage = stateMachine.resolveNextStage;
    const transitionSpy = spyOn(stateMachine, 'resolveNextStage').mockImplementation((options) => {
      transitionInput = options;
      return resolveNextStage(options);
    });

    const result = await runContractPipeline({
      repoRoot: tmpDir,
      resumeRunId: runId,
      skipAuthoring: true,
      rootMode: true,
      adapterFactory: factory,
    }).finally(() => transitionSpy.mockRestore());

    expect(factoryCalled).toBe(true);
    expect(result.workspaceId).toBe('fake-ws');
    expect(result.pipelinePaneId).toBe('fake-pipeline');
    expect(pipelineAdapter.launchedWorkers).toHaveLength(0);
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.stage).toBe('implement');
    const attemptResult = result.attempts[0]?.result;
    expect(attemptResult?.status).toBe('blocked');
    if (!attemptResult) {
      throw new Error('Expected the pipeline to record the stage result.');
    }
    expect(transitionInput).toBeDefined();
    if (!transitionInput) {
      throw new Error('Expected the pipeline to resolve a stage transition.');
    }
    expect(transitionInput.currentStage).toBe('implement');
    expect(transitionInput.verdict).toBe(attemptResult);
    expect(transitionInput.verifyLoops).toBe(1);
    expect(transitionInput.blockedEscalations).toBe(1);
    expect(result.verifyLoops).toBe(1);
    expect(result.blockedEscalations).toBe(1);
    expect(result.currentStage).toBe('blocked');
  });

  it('FakeHerdrAdapter returns controllable values through its interface', async () => {
    const initResult = await adapter.initialize();
    expect(initResult.workspaceId).toBe('fake-ws');
    expect(initResult.pipelinePaneId).toBe('fake-pipeline');

    expect(adapter.getWorkspaceId()).toBe('fake-ws');
    expect(adapter.getWorkspacePath()).toBe(tmpDir);
    expect(adapter.getWorktreeBranch()).toBe('contract-task-fake');

    // Default state: idle, worker active, pane alive
    expect(await adapter.isWorkerActive('pane-1')).toBe(true);
    expect(await adapter.isPaneAlive('pane-1')).toBe(true);
    expect(await adapter.getAgentStatus('pane-1')).toBe('idle');

    // Controllable state changes
    adapter.setWorkerActive(false);
    expect(await adapter.isWorkerActive('pane-1')).toBe(false);

    adapter.setPaneAlive(false);
    expect(await adapter.isPaneAlive('pane-1')).toBe(false);

    adapter.setAgentState({ status: 'working', paneText: 'working...' });
    expect(await adapter.getAgentStatus('pane-1')).toBe('working');
  });

  it('FakeHerdrAdapter records launched workers and nudges', async () => {
    const launchResult = await adapter.launchWorker({
      runId: 'test',
      resultPath: '/tmp/result.json',
      delivery: 'direct_prompt',
      prompt: 'Implement the login feature',
      contractPath: 'docs/contracts/C-999.md',
      role: 'implementer',
      stage: 'implement',
      attempt: 1,
    });
    expect(launchResult.paneId).toBe('fake-worker-1');

    await adapter.nudgeWorker({ paneId: 'fake-worker-1', message: 'Please complete' });
    expect(adapter.nudges).toHaveLength(1);
    expect(adapter.nudges[0].paneId).toBe('fake-worker-1');
    expect(adapter.nudges[0].message).toBe('Please complete');
  });

  it('FakeHerdrAdapter records review messages and startReview calls', async () => {
    const reviewResult = await adapter.startReview({
      prompt: 'Review this PR',
      contractPath: 'docs/contracts/C-999.md',
      reviewDecisionPath: '/tmp/decision.json',
    });
    expect(reviewResult.taskDelivered).toBe(true);
    expect(adapter.reviewStarted).toBe(true);
    expect(adapter.reviewPrompt).toBe('Review this PR');
    expect(adapter.reviewBlocked).toBe(false);

    await adapter.sendReviewMessage({
      paneId: 'fake-review-pane',
      message: 'Please review the changes',
    });
    expect(adapter.reviewMessages).toHaveLength(1);
    expect(adapter.reviewMessages[0].message).toBe('Please review the changes');
  });

  it('FakeHerdrAdapter startReview records blockedReview flag', async () => {
    await adapter.startReview({
      prompt: 'Fix these issues',
      contractPath: 'docs/contracts/C-999.md',
      reviewDecisionPath: '/tmp/decision.json',
      blockedReview: true,
    });
    expect(adapter.reviewBlocked).toBe(true);
  });

  it('FakeHerdrAdapter readPaneText returns controllable text', async () => {
    expect(await adapter.readPaneText('pane-1')).toBe('');

    adapter.setAgentState({ status: 'idle', paneText: 'Hello, world' });
    expect(await adapter.readPaneText('pane-1')).toBe('Hello, world');
  });
});
