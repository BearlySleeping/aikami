// scripts/src/lib/agents/contract_pipeline/herdr_adapter.test.ts
//
// Tests for Herdr adapter transport capabilities and workspace label
// construction (C-472 AC-3, AC-4).
//
// The adapter's core I/O methods (launchWorker, startReview, etc.) require
// a live Herdr server. This test covers the pure, testable functions and
// verifies the adapter interface contract through the FakeHerdrAdapter.

import { describe, expect, it } from 'bun:test';
import { FakeHerdrAdapter } from './fake_adapter.ts';
import { buildWorkspaceLabel, ghTokenFilePath } from './herdr_adapter.ts';

// ── Pure functions ──────────────────────────────────────────

describe('ghTokenFilePath', () => {
  it('constructs the token path from repoRoot and runId', () => {
    const path = ghTokenFilePath({ repoRoot: '/home/user/repo', runId: 'run-test-abc' });
    expect(path).toBe('/home/user/repo/.pi/contract-runs/run-test-abc/gh-token');
  });
});

describe('buildWorkspaceLabel', () => {
  it('uses aikami-{mode} for root mode', () => {
    // In tests, AIKAMI_MODE resolves to 'emulator'.
    const label = buildWorkspaceLabel({ contractId: 'C-999', rootMode: true });
    expect(label).toMatch(/^aikami-/);
  });

  it('uses contract-specific prefix for worktree mode', () => {
    const label = buildWorkspaceLabel({ contractId: 'C-999' });
    expect(label).toContain('C-999');
    expect(label).toMatch(/^aikami-contract-/);
  });

  it('uses contract-specific prefix when rootMode is false', () => {
    const label = buildWorkspaceLabel({ contractId: 'C-472', rootMode: false });
    expect(label).toContain('C-472');
  });
});

// ── Adapter interface contract ──────────────────────────────

describe('ContractHerdrAdapterInterface structural contract', () => {
  it('FakeHerdrAdapter satisfies the interface structurally', () => {
    // TypeScript structural typing: if this compiles, the interface is satisfied.
    const adapter: import('./types.ts').ContractHerdrAdapterInterface = new FakeHerdrAdapter();
    expect(adapter).toBeDefined();
    expect(typeof adapter.initialize).toBe('function');
    expect(typeof adapter.getWorkspaceId).toBe('function');
    expect(typeof adapter.getWorkspacePath).toBe('function');
    expect(typeof adapter.getWorktreeBranch).toBe('function');
    expect(typeof adapter.launchWorker).toBe('function');
    expect(typeof adapter.isWorkerActive).toBe('function');
    expect(typeof adapter.nudgeWorker).toBe('function');
    expect(typeof adapter.isPaneAlive).toBe('function');
    expect(typeof adapter.startReview).toBe('function');
    expect(typeof adapter.sendReviewMessage).toBe('function');
    expect(typeof adapter.getAgentStatus).toBe('function');
    expect(typeof adapter.readPaneText).toBe('function');
  });
});

// ── Transport capability scenarios ──────────────────────────

describe('transport capability: agent status polling', () => {
  it('detects a working agent from status', () => {
    const adapter = new FakeHerdrAdapter({
      initialState: { status: 'working', paneText: null },
    });
    // Working means the agent is mid-response — NOT safe to interrupt.
    // This is verified via canSendToReviewPane in review_pane.test.ts.
    expect(adapter.getAgentStatus('pane-1')).resolves.toBe('working');
  });

  it('detects an idle agent from status', () => {
    const adapter = new FakeHerdrAdapter({
      initialState: { status: 'idle', paneText: '' },
    });
    expect(adapter.getAgentStatus('pane-1')).resolves.toBe('idle');
  });

  it('detects a blocked agent from status', () => {
    const adapter = new FakeHerdrAdapter({
      initialState: { status: 'blocked', paneText: null },
    });
    expect(adapter.getAgentStatus('pane-1')).resolves.toBe('blocked');
  });

  it('detects a done agent from status', () => {
    const adapter = new FakeHerdrAdapter({
      initialState: { status: 'done', paneText: null },
    });
    expect(adapter.getAgentStatus('pane-1')).resolves.toBe('done');
  });

  it('reports unknown when status cannot be determined', () => {
    const adapter = new FakeHerdrAdapter({
      initialState: { status: 'unknown', paneText: null },
    });
    expect(adapter.getAgentStatus('pane-1')).resolves.toBe('unknown');
  });
});

describe('transport capability: worker lifecycle', () => {
  it('launches a worker and returns a pane ID', async () => {
    const adapter = new FakeHerdrAdapter();
    const result = await adapter.launchWorker({
      runId: 'test',
      resultPath: '/tmp/r.json',
      delivery: 'direct_prompt',
      prompt: 'Do the work',
      contractPath: 'docs/contracts/C-999.md',
      role: 'implementer',
      stage: 'implement',
      attempt: 1,
    });
    expect(result.paneId).toBe('fake-worker-1');
    expect(adapter.launchedWorkers).toHaveLength(1);
  });

  it('tracks multiple worker launches with sequential IDs', async () => {
    const adapter = new FakeHerdrAdapter();
    await adapter.launchWorker({
      runId: 'test',
      resultPath: '/tmp/r1.json',
      delivery: 'direct_prompt',
      prompt: 'First',
      contractPath: 'docs/contracts/C-999.md',
      role: 'implementer',
      stage: 'implement',
      attempt: 1,
    });
    await adapter.launchWorker({
      runId: 'test',
      resultPath: '/tmp/r2.json',
      delivery: 'direct_prompt',
      prompt: 'Second',
      contractPath: 'docs/contracts/C-999.md',
      role: 'verifier',
      stage: 'verify',
      attempt: 1,
    });
    expect(adapter.launchedWorkers).toHaveLength(2);
    expect(adapter.workerPaneIds).toEqual(['fake-worker-1', 'fake-worker-2']);
  });

  it('reports worker activity state correctly', async () => {
    const adapter = new FakeHerdrAdapter({ workerActive: true });
    expect(await adapter.isWorkerActive('fake-worker-1')).toBe(true);

    adapter.setWorkerActive(false);
    expect(await adapter.isWorkerActive('fake-worker-1')).toBe(false);
  });

  it('records nudges sent to workers', async () => {
    const adapter = new FakeHerdrAdapter();
    await adapter.nudgeWorker({ paneId: 'fake-worker-1', message: 'Please complete stage' });
    expect(adapter.nudges).toHaveLength(1);
    expect(adapter.nudges[0].message).toBe('Please complete stage');
  });
});

describe('transport capability: pane lifecycle', () => {
  it('reports pane alive state', async () => {
    const adapter = new FakeHerdrAdapter({ paneAlive: true });
    expect(await adapter.isPaneAlive('pane-1')).toBe(true);

    adapter.setPaneAlive(false);
    expect(await adapter.isPaneAlive('pane-1')).toBe(false);
  });

  it('reads pane text content', async () => {
    const adapter = new FakeHerdrAdapter({
      initialState: { status: 'idle', paneText: 'Terminal output' },
    });
    expect(await adapter.readPaneText('pane-1')).toBe('Terminal output');
  });

  it('returns null for failed pane reads', async () => {
    // The real adapter returns null when the pane read fails.
    // The fake simulates this through its controllable state.
    const adapter = new FakeHerdrAdapter({
      initialState: { status: 'idle', paneText: null },
    });
    expect(await adapter.readPaneText('pane-1')).toBeNull();
  });
});

describe('transport capability: review interaction', () => {
  it('starts a review and records the prompt', async () => {
    const adapter = new FakeHerdrAdapter();
    const result = await adapter.startReview({
      prompt: 'Review this PR for C-472',
      contractPath: 'docs/contracts/C-472.md',
      reviewDecisionPath: '/tmp/decision.json',
    });
    expect(result.ok).toBe(true);
    expect(adapter.reviewStarted).toBe(true);
    expect(adapter.reviewPrompt).toContain('C-472');
  });

  it('sends review messages to the review pane', async () => {
    const adapter = new FakeHerdrAdapter();
    const sent = await adapter.sendReviewMessage({
      paneId: 'review-pane',
      message: 'Your review is needed',
    });
    expect(sent).toBe(true);
    expect(adapter.reviewMessages).toHaveLength(1);
    expect(adapter.reviewMessages[0].paneId).toBe('review-pane');
  });

  it('distinguishes blocked reviews from normal reviews', async () => {
    const adapter = new FakeHerdrAdapter();

    // Normal review
    await adapter.startReview({
      prompt: 'Normal review',
      contractPath: 'docs/contracts/C-472.md',
      reviewDecisionPath: '/tmp/normal.json',
      blockedReview: false,
    });
    expect(adapter.reviewBlocked).toBe(false);

    // Blocked review (verify loop exhaustion, reconcile failure)
    await adapter.startReview({
      prompt: 'Blocked review - fix these issues',
      contractPath: 'docs/contracts/C-472.md',
      reviewDecisionPath: '/tmp/blocked.json',
      blockedReview: true,
    });
    expect(adapter.reviewBlocked).toBe(true);
  });
});
