// scripts/src/lib/herdr/worktree_teardown.test.ts
//
// The rmSync fallback in removeWorktree is the one place the herdr lifecycle
// deletes a directory recursively. These tests pin the guard that stands
// between it and the two ways it could destroy the wrong thing: being pointed
// at the repo root, and being pointed at a plain directory that is not a
// managed git worktree at all.

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OFFSETTABLE_PORTS } from '@aikami/constants';
import type { InstanceRecord, ProcessInspector } from './instance_registry.ts';
import {
  assertManagedWorktreeTarget,
  CONTRACT_TEARDOWN_PORTS,
  expectedOwnershipForCheckout,
  recordsAreForeign,
} from './worktree_teardown.ts';

const withTempRoot = (run: (root: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'aikami-worktree-teardown-'));
  try {
    run(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
};

// 🔴 The sweep is the belt-and-braces that frees a contract's ports when a
// server outlived its pane. A port missing from it keeps holding `base +
// offset` and blocks the NEXT contract on the same offset. Deriving the
// expectation from OFFSETTABLE_PORTS means a newly offsettable service cannot
// be forgotten here the way `hub-worker` was.
describe('CONTRACT_TEARDOWN_PORTS', () => {
  it('covers every offsettable emulator port', () => {
    const missing = Object.entries(OFFSETTABLE_PORTS)
      .filter(([, port]) => !CONTRACT_TEARDOWN_PORTS.includes(port))
      .map(([name]) => name);

    expect(missing).toEqual([]);
  });

  it('includes hub-worker, whose listeners are otherwise never swept', () => {
    expect(CONTRACT_TEARDOWN_PORTS).toContain(OFFSETTABLE_PORTS.hubWorker);
  });
});

describe('assertManagedWorktreeTarget', () => {
  it('refuses the repo root — rmSync there would delete the entire repository', () => {
    withTempRoot((root) => {
      expect(() => assertManagedWorktreeTarget(root, root)).toThrow(/equals the repo root/);
    });
  });

  it('refuses a plain directory that is not a managed git worktree', () => {
    withTempRoot((root) => {
      const repoRoot = join(root, 'repo');
      const plain = join(root, 'not-a-worktree');
      mkdirSync(repoRoot);
      mkdirSync(plain);
      expect(() => assertManagedWorktreeTarget(plain, repoRoot)).toThrow(/\.git marker/);
    });
  });

  it('refuses a directory whose .git is a DIRECTORY (a repo root, not a linked worktree)', () => {
    withTempRoot((root) => {
      const repoRoot = join(root, 'repo');
      const nested = join(root, 'nested-repo');
      mkdirSync(repoRoot);
      mkdirSync(join(nested, '.git'), { recursive: true });
      expect(() => assertManagedWorktreeTarget(nested, repoRoot)).toThrow(/\.git marker/);
    });
  });

  it('accepts a linked worktree carrying a .git file marker', () => {
    withTempRoot((root) => {
      const repoRoot = join(root, 'repo');
      const linked = join(root, 'contract-task-c-1-token');
      mkdirSync(repoRoot);
      mkdirSync(linked);
      writeFileSync(join(linked, '.git'), 'gitdir: /somewhere/.git/worktrees/x\n');
      expect(() => assertManagedWorktreeTarget(linked, repoRoot)).not.toThrow();
    });
  });
});

describe('expectedOwnershipForCheckout', () => {
  it('derives the exact run identity encoded in the worktree slug', () => {
    expect(
      expectedOwnershipForCheckout('/home/u/.herdr/worktrees/aikami/contract-task-c-516-mtz2k7km'),
    ).toEqual({
      runId: 'run-mtz2k7km-C-516',
      checkout: '/home/u/.herdr/worktrees/aikami/contract-task-c-516-mtz2k7km',
    });
  });

  it('falls back to the contract id for a path without a run token', () => {
    expect(expectedOwnershipForCheckout('/tmp/contract-task-C-516')).toEqual({
      runId: 'C-516',
      checkout: '/tmp/contract-task-C-516',
    });
  });

  it('ignores the ambient pipeline run — cleanup must use the checkout being torn down', () => {
    const saved = process.env.CONTRACT_PIPELINE_RUN_ID;
    try {
      // A controller running contract B cleaning up contract A's worktree must
      // look for A's record, never B's.
      process.env.CONTRACT_PIPELINE_RUN_ID = 'run-bbbbbbbb-C-999';
      expect(expectedOwnershipForCheckout('/tmp/contract-task-c-516-mtz2k7km').runId).toBe(
        'run-mtz2k7km-C-516',
      );
    } finally {
      if (saved === undefined) {
        delete process.env.CONTRACT_PIPELINE_RUN_ID;
      } else {
        process.env.CONTRACT_PIPELINE_RUN_ID = saved;
      }
    }
  });

  it('still pins the checkout when the path carries no contract identity', () => {
    expect(expectedOwnershipForCheckout('/tmp/task-something')).toEqual({
      runId: undefined,
      checkout: '/tmp/task-something',
    });
  });
});

// 🔴 The contract workspace label is contract-scoped, so two runs of one
// contract share it. Teardown must not close another run's verified service
// tabs — but it must still close a service nobody recorded, or the removal
// fails with a live server writing into the checkout.
describe('recordsAreForeign', () => {
  const RECORD_START = 1_000;
  const record = (overrides: Partial<InstanceRecord> = {}): InstanceRecord => ({
    service: 'client',
    scope: 'run',
    runId: 'run-mtz2k7km-C-516',
    checkout: '/checkout-a',
    pid: 4242,
    pidStartTimeMs: RECORD_START,
    port: 5173,
    startedAt: 'now',
    ...overrides,
  });

  const inspector = (startTimeMs: number | undefined): ProcessInspector => ({
    startTimeMs: async () => startTimeMs,
    cwd: async () => '/checkout-a',
  });

  const expected = { runId: 'run-mtz2k7km-C-516', checkout: '/checkout-a' };

  it('treats a verified record for another checkout as foreign', async () => {
    expect(
      await recordsAreForeign({
        pids: [4242],
        records: [record({ checkout: '/checkout-b' })],
        inspector: inspector(RECORD_START),
        expected,
      }),
    ).toBe(true);
  });

  it('treats a verified record for another run as foreign', async () => {
    expect(
      await recordsAreForeign({
        pids: [4242],
        records: [record({ runId: 'run-other-C-516' })],
        inspector: inspector(RECORD_START),
        expected,
      }),
    ).toBe(true);
  });

  it("does not treat this checkout's own verified record as foreign", async () => {
    expect(
      await recordsAreForeign({
        pids: [4242],
        records: [record()],
        inspector: inspector(RECORD_START),
        expected,
      }),
    ).toBe(false);
  });

  // A stale record whose PID has since been reused must not make our own live
  // server look foreign — that would leave it running and fail the removal.
  it('does not treat a stale (PID-reused) record as foreign', async () => {
    expect(
      await recordsAreForeign({
        pids: [4242],
        records: [record({ checkout: '/checkout-b' })],
        inspector: inspector(RECORD_START + 900_000),
        expected,
      }),
    ).toBe(false);
  });

  it('is not foreign when nothing is recorded (a hand-started service)', async () => {
    expect(
      await recordsAreForeign({
        pids: [4242],
        records: [],
        inspector: inspector(RECORD_START),
        expected,
      }),
    ).toBe(false);
  });

  // 🔴 Two records can exist for one PID (one per service, from different
  // eras). `verifyOwnership` compares the live start time against only the
  // candidate it selects, and `readInstanceRecords` returns filesystem order —
  // so a STALE record listed first must not shadow the live foreign one.
  it('finds a live foreign record even when a stale record for the same PID comes first', async () => {
    const staleForeign = record({
      checkout: '/checkout-b',
      pidStartTimeMs: RECORD_START - 500_000,
    });
    const liveForeign = record({ checkout: '/checkout-b', pidStartTimeMs: RECORD_START });

    expect(
      await recordsAreForeign({
        pids: [4242],
        records: [staleForeign, liveForeign],
        inspector: inspector(RECORD_START),
        expected,
      }),
    ).toBe(true);
  });

  it('finds a live foreign record when the stale record is for our own checkout', async () => {
    const staleOwn = record({ checkout: '/checkout-a', pidStartTimeMs: RECORD_START - 500_000 });
    const liveForeign = record({ checkout: '/checkout-b', pidStartTimeMs: RECORD_START });

    expect(
      await recordsAreForeign({
        pids: [4242],
        records: [staleOwn, liveForeign],
        inspector: inspector(RECORD_START),
        expected,
      }),
    ).toBe(true);
  });
});
