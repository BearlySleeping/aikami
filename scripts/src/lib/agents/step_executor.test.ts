// scripts/src/lib/agents/step_executor.test.ts
/**
 * Tests for the swarm pipeline state machine decision logic.
 *
 * Exercises the real, exported decideReviewOutcome function (not a copy).
 * Includes a disk-driven test for the handleoff-freshness / unlink-before-dispatch
 * behavior that prevents stale reads.
 */

import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SwarmHandoff } from '@aikami/types';
import type { HerdrSocketClient } from '../herdr/socket_client';
import type { AgentScratchpad } from './agent_scratchpad';
// Import the real, exported functions (not replicas)
import { decideReviewOutcome, detectResumeState, waitForHandoff } from './step_executor';
import type { PipelineState, SwarmState } from './types';

// ── Test helpers ────────────────────────────────────────────

const makeHandoff = (overrides: Partial<SwarmHandoff>): SwarmHandoff => ({
  taskId: 'C-TEST',
  role: 'review',
  status: 'approved',
  complexity: 'standard',
  domain: 'fullstack',
  requiresDocs: false,
  filesTouched: [],
  nextCommands: [],
  summary: '',
  ...overrides,
});

// Minimal StateContext fake for pure-decision tests
const fakeState = (): SwarmState => ({
  lastUpdated: new Date().toISOString(),
  activeTaskId: 'C-TEST',
  workspaceId: null,
  agents: {
    architect: { tabId: '', paneId: '', status: 'idle', lastHash: null },
    coder: { tabId: '', paneId: '', status: 'idle', lastHash: null },
    qa: { tabId: '', paneId: '', status: 'idle', lastHash: null },
    docs: { tabId: '', paneId: '', status: 'idle', lastHash: null },
    git: { tabId: '', paneId: '', status: 'idle', lastHash: null },
    review: { tabId: '', paneId: '', status: 'idle', lastHash: null },
  },
});

const fakeScratchpad = () =>
  ({
    upsertHeartbeat: () => {},
  }) as unknown as AgentScratchpad;

const fakeSocketClient = () =>
  ({
    paneRun: async () => {},
    paneRead: async () => '',
    showNotification: async () => {},
  }) as unknown as HerdrSocketClient;

type TestCtx = Parameters<typeof decideReviewOutcome>[0];

// Isolated cwd so decideReviewOutcome's feedback-file writes don't pollute /tmp
const ctxTmpDir = join('/tmp', `swarm-ctx-test-${Date.now()}`);

let ctxId = 0;
const makeCtx = (overrides: Partial<TestCtx> = {}): TestCtx => ({
  taskId: `C-TEST-${ctxId++}`,
  cwd: ctxTmpDir,
  state: fakeState(),
  socketClient: fakeSocketClient(),
  scratchpad: fakeScratchpad(),
  contractPath: 'docs/contracts/C-TEST.md',
  tier: 'flash',
  skipReview: false,
  feedbackHistory: [],
  iteration: 0,
  agentStartTimes: {},
  agentDurations: {},
  ...overrides,
});

// ── Unit tests: decideReviewOutcome (pure decision) ─────────

describe('decideReviewOutcome', () => {
  afterAll(() => {
    try {
      rmSync(ctxTmpDir, { recursive: true });
    } catch {
      /* ok */
    }
  });

  it('approved → git', () => {
    const handoff = makeHandoff({ status: 'approved' });
    expect(decideReviewOutcome(makeCtx(), handoff)).toBe('git');
  });

  it('rejected → done', () => {
    const handoff = makeHandoff({ status: 'rejected' });
    expect(decideReviewOutcome(makeCtx(), handoff)).toBe('done');
  });

  it('feedback → coder (iteration 0, cap 3)', () => {
    const ctx = makeCtx();
    const handoff = makeHandoff({ status: 'feedback', summary: 'Fix the bug' });
    const result = decideReviewOutcome(ctx, handoff);
    expect(result).toBe('coder');
    expect(ctx.iteration).toBe(1);
    expect(ctx.feedbackHistory).toHaveLength(1);
  });

  it('feedback → coder (iteration 2, cap 3)', () => {
    const ctx = makeCtx({ iteration: 2 });
    const handoff = makeHandoff({ status: 'feedback', summary: 'One more fix' });
    const result = decideReviewOutcome(ctx, handoff);
    expect(result).toBe('coder');
    expect(ctx.iteration).toBe(3);
  });

  it('feedback → done (iteration 3, cap reached → escalate)', () => {
    const ctx = makeCtx({
      iteration: 3,
      feedbackHistory: [
        { iteration: 1, feedback: 'fix 1', timestamp: '' },
        { iteration: 2, feedback: 'fix 2', timestamp: '' },
        { iteration: 3, feedback: 'fix 3', timestamp: '' },
      ],
    });
    const handoff = makeHandoff({ status: 'feedback', summary: 'Still broken' });
    const result = decideReviewOutcome(ctx, handoff);
    expect(result).toBe('done');
  });

  it('feedback → done (iteration 4, beyond cap)', () => {
    const ctx = makeCtx({ iteration: 4 });
    const handoff = makeHandoff({ status: 'feedback' });
    expect(decideReviewOutcome(ctx, handoff)).toBe('done');
  });

  it('unknown status → done (safe default)', () => {
    const handoff = makeHandoff({ status: 'success' as SwarmHandoff['status'] });
    expect(decideReviewOutcome(makeCtx(), handoff)).toBe('done');
  });

  it('awaiting_approval → done (should not reach here — handled earlier)', () => {
    const handoff = makeHandoff({ status: 'awaiting_approval' });
    expect(decideReviewOutcome(makeCtx(), handoff)).toBe('done');
  });

  it('context is not mutated on approved', () => {
    const ctx = makeCtx({
      iteration: 2,
      feedbackHistory: [{ iteration: 1, feedback: 'old', timestamp: '' }],
    });
    const handoff = makeHandoff({ status: 'approved' });
    expect(decideReviewOutcome(ctx, handoff)).toBe('git');
    expect(ctx.iteration).toBe(2);
    expect(ctx.feedbackHistory).toHaveLength(1);
  });

  it('context is not mutated on rejected', () => {
    const ctx = makeCtx({ iteration: 2 });
    const handoff = makeHandoff({ status: 'rejected' });
    expect(decideReviewOutcome(ctx, handoff)).toBe('done');
    expect(ctx.iteration).toBe(2);
  });
});

// ── PipelineState transitions ───────────────────────────────

describe('PipelineState transitions', () => {
  it('normal path: architect → coder → qa → review-approved → git → done', () => {
    const sequence: PipelineState[] = ['architect', 'coder', 'qa', 'review', 'git', 'done'];
    const stateOrder: Record<PipelineState, number> = {
      architect: 0,
      coder: 1,
      qa: 2,
      review: 3,
      docs: 4,
      git: 5,
      done: 6,
    };
    for (let i = 1; i < sequence.length; i++) {
      expect(stateOrder[sequence[i]]).toBeGreaterThan(stateOrder[sequence[i - 1]]);
    }
  });

  it('feedback loop: review-feedback → coder → qa → review', () => {
    const sequence: PipelineState[] = [
      'architect',
      'coder',
      'qa',
      'review',
      'coder',
      'qa',
      'review',
      'git',
      'done',
    ];
    const validPairs = new Set([
      'architect→coder',
      'coder→qa',
      'qa→review',
      'review→git',
      'git→done',
      'review→coder',
      'review→done',
    ]);
    for (let i = 1; i < sequence.length; i++) {
      expect(validPairs.has(`${sequence[i - 1]}→${sequence[i]}`)).toBe(true);
    }
  });
});

// ── Integration tests: waitForHandoff (the REAL function) ────

describe('waitForHandoff', () => {
  const tmpDir = join('/tmp', `swarm-test-${Date.now()}`);
  const outputsDir = join(tmpDir, '.pi/swarm/outputs');
  const taskId = 'C-TEST-FRESH';

  const handoffFile = (role: string) => join(outputsDir, `${taskId}_${role}_handoff.json`);

  function writeHandoffFile(role: string, status: string) {
    mkdirSync(outputsDir, { recursive: true });
    writeFileSync(
      handoffFile(role),
      JSON.stringify({
        taskId,
        role,
        status,
        complexity: 'standard',
        domain: 'fullstack',
        requiresDocs: false,
        filesTouched: [],
        nextCommands: [],
        summary: `Status: ${status}`,
      }),
    );
  }

  beforeEach(() => {
    // Clean slate per test
    try {
      unlinkSync(handoffFile('review'));
    } catch {
      /* ok */
    }
    mkdirSync(outputsDir, { recursive: true });
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true });
    } catch {
      /* ok */
    }
  });

  it('returns existing handoff immediately when predicate passes', async () => {
    writeHandoffFile('review', 'approved');
    const h = await waitForHandoff(taskId, 'review', tmpDir, 1_000);
    expect(h?.status).toBe('approved');
  });

  it('returns null on timeout when no handoff is written', async () => {
    const h = await waitForHandoff(taskId, 'review', tmpDir, 300);
    expect(h).toBeNull();
  });

  it('Bug A regression: stale terminal handoff satisfies predicate instantly — unlink prevents it', async () => {
    // A stale 'feedback' handoff from iteration 1 is on disk.
    writeHandoffFile('review', 'feedback');

    // WITHOUT unlink: waitForHandoff returns the stale decision instantly.
    const stale = await waitForHandoff(
      taskId,
      'review',
      tmpDir,
      300,
      (h) => h.status !== 'awaiting_approval',
    );
    expect(stale?.status).toBe('feedback'); // ← this is the bug runReview had

    // WITH unlink-before-dispatch (what runReview now does): stale read is impossible.
    unlinkSync(handoffFile('review'));
    const fresh = await waitForHandoff(
      taskId,
      'review',
      tmpDir,
      300,
      (h) => h.status !== 'awaiting_approval',
    );
    expect(fresh).toBeNull(); // nothing fresh written → must NOT reuse stale decision
  });

  it('predicate skips awaiting_approval and resolves on terminal write', async () => {
    writeHandoffFile('review', 'awaiting_approval');

    // Simulate the user approving 400ms later (gate rewrites the handoff)
    setTimeout(() => writeHandoffFile('review', 'approved'), 400);

    const h = await waitForHandoff(
      taskId,
      'review',
      tmpDir,
      5_000,
      (candidate) => candidate.status !== 'awaiting_approval',
    );
    expect(h?.status).toBe('approved');
  });

  it('two-phase wait: gate-up (any status) then terminal (predicate)', async () => {
    // Phase 1: gate writes awaiting_approval shortly after dispatch
    setTimeout(() => writeHandoffFile('review', 'awaiting_approval'), 200);
    const gateUp = await waitForHandoff(taskId, 'review', tmpDir, 5_000);
    expect(gateUp?.status).toBe('awaiting_approval');

    // Phase 2: user types feedback
    setTimeout(() => writeHandoffFile('review', 'feedback'), 200);
    const terminal = await waitForHandoff(
      taskId,
      'review',
      tmpDir,
      5_000,
      (h) => h.status !== 'awaiting_approval',
    );
    expect(terminal?.status).toBe('feedback');
  });
});

// ── Resume detection ───────────────────────────────────────

describe('detectResumeState', () => {
  const tmpDir = join('/tmp', `swarm-resume-test-${Date.now()}`);
  const outputsDir = join(tmpDir, '.pi/swarm/outputs');
  const plansDir = join(tmpDir, '.pi/swarm/plans');
  const taskId = 'C-RESUME';

  function writeRole(role: string, status: string, complexity = 'standard') {
    mkdirSync(outputsDir, { recursive: true });
    writeFileSync(
      join(outputsDir, `${taskId}_${role}_handoff.json`),
      JSON.stringify({
        taskId,
        role,
        status,
        complexity,
        domain: 'fullstack',
        requiresDocs: false,
        filesTouched: [],
        nextCommands: [],
        summary: `${role}: ${status}`,
      }),
    );
  }

  function writePlan() {
    mkdirSync(plansDir, { recursive: true });
    writeFileSync(join(plansDir, `architect_plan_${taskId}.md`), '# Plan\ncontent here');
  }

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(outputsDir, { recursive: true });
    mkdirSync(plansDir, { recursive: true });
  });

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('empty disk → architect', () => {
    expect(detectResumeState(taskId, tmpDir).start).toBe('architect');
  });

  it('architect handoff without plan file → architect (plan is required)', () => {
    writeRole('architect', 'success');
    expect(detectResumeState(taskId, tmpDir).start).toBe('architect');
  });

  it('architect done (handoff + plan) → coder — the C-235 crash scenario', () => {
    writeRole('architect', 'success');
    writePlan();
    const plan = detectResumeState(taskId, tmpDir);
    expect(plan.start).toBe('coder');
    expect(plan.completed).toEqual(['architect']);
  });

  it('architect + coder done → qa', () => {
    writeRole('architect', 'success');
    writePlan();
    writeRole('coder', 'success');
    expect(detectResumeState(taskId, tmpDir).start).toBe('qa');
  });

  it('trivial complexity skips qa → review', () => {
    writeRole('architect', 'success', 'trivial');
    writePlan();
    writeRole('coder', 'success');
    expect(detectResumeState(taskId, tmpDir).start).toBe('review');
  });

  it('qa done → review', () => {
    writeRole('architect', 'success');
    writePlan();
    writeRole('coder', 'success');
    writeRole('qa', 'success');
    expect(detectResumeState(taskId, tmpDir).start).toBe('review');
  });

  it('stale feedback review → review (re-prompt, not blind re-code)', () => {
    writeRole('architect', 'success');
    writePlan();
    writeRole('coder', 'success');
    writeRole('qa', 'success');
    writeRole('review', 'feedback');
    expect(detectResumeState(taskId, tmpDir).start).toBe('review');
  });

  it('review approved but no git → git (commit pending)', () => {
    writeRole('architect', 'success');
    writePlan();
    writeRole('coder', 'success');
    writeRole('qa', 'success');
    writeRole('review', 'approved');
    const plan = detectResumeState(taskId, tmpDir);
    expect(plan.start).toBe('git');
  });

  it('review approved + git success → done (never double-commit)', () => {
    writeRole('architect', 'success');
    writePlan();
    writeRole('coder', 'success');
    writeRole('qa', 'success');
    writeRole('review', 'approved');
    writeRole('git', 'success');
    expect(detectResumeState(taskId, tmpDir).start).toBe('done');
  });

  it('review approved + git failed → git (retry commit)', () => {
    writeRole('architect', 'success');
    writePlan();
    writeRole('coder', 'success');
    writeRole('qa', 'success');
    writeRole('review', 'approved');
    writeRole('git', 'failed');
    expect(detectResumeState(taskId, tmpDir).start).toBe('git');
  });
});
