// scripts/src/lib/agents/contract_pipeline/implement_guard.test.ts
//
// Covers the C-457 zero-diff guard: an implementer `passed` with no observable
// change must become `blocked`, and — just as important — the cases that only
// LOOK empty must survive untouched.
import { describe, expect, it } from 'bun:test';
import {
  guardEmptyImplementation,
  implementationProducedWork,
  settleEmptyImplementation,
} from './implement_guard.ts';
import type { ContractStageResult, GitStateSnapshot } from './types.ts';

const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const snapshot = (files: Record<string, string>, fingerprint: string): GitStateSnapshot => ({
  files,
  fingerprint,
});

/** The exact shape C-457's implementer wrote, minus the run-specific ids. */
const passedResult = (overrides: Partial<ContractStageResult> = {}): ContractStageResult => ({
  runId: 'run-test-C-457',
  stage: 'implementer',
  attempt: 1,
  status: 'passed',
  summary: 'Starting C-457 GM Prompt Assembly Upgrade implementation',
  findings: ['Workspace clean, dependencies checked'],
  filesTouched: [],
  evidence: [],
  contractHash: 'abc',
  diffHash: EMPTY_SHA,
  ...overrides,
});

describe('implementationProducedWork', () => {
  it('is false when the tree is unchanged and HEAD has not moved', () => {
    expect(
      implementationProducedWork({
        before: snapshot({}, EMPTY_SHA),
        after: snapshot({}, EMPTY_SHA),
        headBefore: '6610f8fd',
        headAfter: '6610f8fd',
      }),
    ).toBe(false);
  });

  it('is true when the working tree changed', () => {
    expect(
      implementationProducedWork({
        before: snapshot({}, EMPTY_SHA),
        after: snapshot({ 'src/a.ts': 'hash-a' }, 'fingerprint-b'),
        headBefore: '6610f8fd',
        headAfter: '6610f8fd',
      }),
    ).toBe(true);
  });

  // 🔴 The trap a tree-only check falls into: implementers routinely commit
  // their own work, which leaves the tree clean and the fingerprint identical
  // to the pre-stage snapshot. That is a COMPLETE implementation, not an
  // empty one.
  it('is true when the agent committed its own work, leaving a clean tree', () => {
    expect(
      implementationProducedWork({
        before: snapshot({}, EMPTY_SHA),
        after: snapshot({}, EMPTY_SHA),
        headBefore: '6610f8fd',
        headAfter: 'a1b2c3d4',
      }),
    ).toBe(true);
  });

  // Fails OPEN: a broken `git rev-parse` is not evidence the agent idled.
  it('is true when HEAD could not be resolved on either side', () => {
    expect(
      implementationProducedWork({
        before: snapshot({}, EMPTY_SHA),
        after: snapshot({}, EMPTY_SHA),
        headBefore: 'unknown',
        headAfter: 'unknown',
      }),
    ).toBe(true);
  });
});

describe('guardEmptyImplementation', () => {
  it('overrides the C-457 zero-diff `passed` to blocked', () => {
    const guarded = guardEmptyImplementation({
      result: passedResult(),
      before: snapshot({}, EMPTY_SHA),
      after: snapshot({}, EMPTY_SHA),
      headBefore: '6610f8fd',
      headAfter: '6610f8fd',
    });
    expect(guarded.status).toBe('blocked');
    expect(guarded.summary).toContain('byte-for-byte unchanged');
    // The worker's own claim is preserved for the review captain to read.
    expect(guarded.summary).toContain('Starting C-457');
    expect(guarded.findings.length).toBeGreaterThan(passedResult().findings.length);
  });

  it('trips on the observed diff even when the worker self-reports files it did not touch', () => {
    // The whole point of reading git rather than the result artifact: a
    // worker claiming filesTouched/diffHash it cannot substantiate is still
    // caught.
    const guarded = guardEmptyImplementation({
      result: passedResult({
        filesTouched: ['apps/frontend/client/src/lib/services/gm/gm_prompt_service.svelte.ts'],
        diffHash: 'a-plausible-looking-but-fabricated-hash',
      }),
      before: snapshot({}, EMPTY_SHA),
      after: snapshot({}, EMPTY_SHA),
      headBefore: '6610f8fd',
      headAfter: '6610f8fd',
    });
    expect(guarded.status).toBe('blocked');
  });

  it('leaves a real implementation untouched', () => {
    const result = passedResult({ filesTouched: ['src/a.ts'], diffHash: 'real-hash' });
    const guarded = guardEmptyImplementation({
      result,
      before: snapshot({}, EMPTY_SHA),
      after: snapshot({ 'src/a.ts': 'hash-a' }, 'fingerprint-b'),
      headBefore: '6610f8fd',
      headAfter: '6610f8fd',
    });
    expect(guarded).toBe(result);
  });

  it('leaves a self-committed implementation untouched', () => {
    const result = passedResult({ filesTouched: ['src/a.ts'] });
    const guarded = guardEmptyImplementation({
      result,
      before: snapshot({}, EMPTY_SHA),
      after: snapshot({}, EMPTY_SHA),
      headBefore: '6610f8fd',
      headAfter: 'a1b2c3d4',
    });
    expect(guarded).toBe(result);
  });

  it.each(['blocked', 'failed', 'changes_requested'] as const)(
    'does not touch a non-passed `%s` verdict',
    (status) => {
      const result = passedResult({ status });
      const guarded = guardEmptyImplementation({
        result,
        before: snapshot({}, EMPTY_SHA),
        after: snapshot({}, EMPTY_SHA),
        headBefore: '6610f8fd',
        headAfter: '6610f8fd',
      });
      expect(guarded).toBe(result);
    },
  );
});

describe('settleEmptyImplementation', () => {
  const clean = { after: snapshot({}, EMPTY_SHA), headAfter: '6610f8fd' };
  const worked = {
    after: snapshot({ 'src/gm_prompt_service.svelte.ts': 'hash-a' }, 'fingerprint-b'),
    headAfter: '6610f8fd',
  };

  // 🔴 The actual C-457 shape: the worker called contract_stage_complete
  // mid-flight and the implementation landed in the worktree afterwards.
  // Blocking on the instantaneous zero diff would have discarded live work.
  it('adopts work that lands during the settle window while the worker is alive', async () => {
    const result = passedResult();
    let polls = 0;
    const settled = await settleEmptyImplementation({
      result,
      before: snapshot({}, EMPTY_SHA),
      headBefore: '6610f8fd',
      captureAfter: () => {
        polls += 1;
        return polls > 2 ? worked : clean;
      },
      isWorkerActive: async () => true,
      settleMs: 500,
      pollMs: 10,
    });
    expect(settled).toBe(result);
    expect(settled.status).toBe('passed');
  });

  it('blocks immediately when the worker is already gone and nothing changed', async () => {
    const start = Date.now();
    const settled = await settleEmptyImplementation({
      result: passedResult(),
      before: snapshot({}, EMPTY_SHA),
      headBefore: '6610f8fd',
      captureAfter: () => clean,
      isWorkerActive: async () => false,
      settleMs: 60_000,
      pollMs: 10,
    });
    expect(settled.status).toBe('blocked');
    // Must not sit out the full window on a worker that has finished.
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it('stops waiting as soon as a live worker exits without producing work', async () => {
    let alive = true;
    const start = Date.now();
    const settled = await settleEmptyImplementation({
      result: passedResult(),
      before: snapshot({}, EMPTY_SHA),
      headBefore: '6610f8fd',
      captureAfter: () => clean,
      isWorkerActive: async () => {
        const was = alive;
        alive = false;
        return was;
      },
      settleMs: 60_000,
      pollMs: 10,
    });
    expect(settled.status).toBe('blocked');
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it('blocks when the window expires with the worktree still unchanged', async () => {
    const settled = await settleEmptyImplementation({
      result: passedResult(),
      before: snapshot({}, EMPTY_SHA),
      headBefore: '6610f8fd',
      captureAfter: () => clean,
      isWorkerActive: async () => true,
      settleMs: 100,
      pollMs: 10,
    });
    expect(settled.status).toBe('blocked');
    expect(settled.summary).toContain('byte-for-byte unchanged');
  });

  it('returns instantly, without waiting, when work is already present', async () => {
    const result = passedResult({ filesTouched: ['src/a.ts'] });
    let activeChecks = 0;
    const settled = await settleEmptyImplementation({
      result,
      before: snapshot({}, EMPTY_SHA),
      headBefore: '6610f8fd',
      captureAfter: () => worked,
      isWorkerActive: async () => {
        activeChecks += 1;
        return true;
      },
      settleMs: 60_000,
    });
    expect(settled).toBe(result);
    expect(activeChecks).toBe(0);
  });

  it('does not wait on a non-passed verdict', async () => {
    const result = passedResult({ status: 'blocked' });
    const settled = await settleEmptyImplementation({
      result,
      before: snapshot({}, EMPTY_SHA),
      headBefore: '6610f8fd',
      captureAfter: () => clean,
      isWorkerActive: async () => true,
      settleMs: 60_000,
    });
    expect(settled).toBe(result);
  });
});
