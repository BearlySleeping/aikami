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
import { assertManagedWorktreeTarget, expectedOwnershipForCheckout } from './worktree_teardown.ts';

const withTempRoot = (run: (root: string) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'aikami-worktree-teardown-'));
  try {
    run(root);
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
};

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
