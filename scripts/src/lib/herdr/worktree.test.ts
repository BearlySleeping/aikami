// scripts/src/lib/herdr/worktree.test.ts
//
// Pins the worktree dependency-tree post-condition. Until C-476, the Windows
// node_modules seeding workaround in bootstrapWorktree ran on every platform:
// it builds a deliberately partial tree (`.bun`, `.bin`, `@aikami/*`) and never
// links ordinary top-level deps. Fresh POSIX worktrees therefore had no
// `@types/bun` or `@types/node`, `tsc` could not resolve `types: ["bun"]`, and
// pre-push validation died with TS2688 — after implementer AND verifier had
// both already passed, because nothing between bootstrap and push ever checked
// the tree was complete. missingWorktreeDeps is that check.

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { missingWorktreeDeps } from './worktree.ts';

/** Build a root/worktree pair with the given top-level node_modules entries. */
const makeFixture = (rootEntries: string[], worktreeEntries: string[]) => {
  const base = mkdtempSync(join(tmpdir(), 'aikami-worktree-test-'));
  const repoRoot = join(base, 'root');
  const checkoutPath = join(base, 'worktree');
  for (const [dir, entries] of [
    [repoRoot, rootEntries],
    [checkoutPath, worktreeEntries],
  ] as const) {
    mkdirSync(join(dir, 'node_modules'), { recursive: true });
    for (const entry of entries) {
      mkdirSync(join(dir, 'node_modules', entry), { recursive: true });
    }
  }
  return { base, repoRoot, checkoutPath };
};

describe('missingWorktreeDeps', () => {
  it('flags the exact tree the Windows seeding path leaves on POSIX', () => {
    // The regression itself: seeding creates only .bun/.bin/@aikami, so every
    // real dependency is absent.
    const { base, repoRoot, checkoutPath } = makeFixture(
      ['.bun', '.bin', '@aikami', '@types', 'typescript', '@biomejs'],
      ['.bun', '.bin', '@aikami'],
    );
    try {
      expect(missingWorktreeDeps({ checkoutPath, repoRoot }).sort()).toEqual([
        '@biomejs',
        '@types',
        'typescript',
      ]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('reports nothing for a completed bun install', () => {
    const { base, repoRoot, checkoutPath } = makeFixture(
      ['.bun', '@aikami', '@types', 'typescript'],
      ['.bun', '@aikami', '@types', 'typescript'],
    );
    try {
      expect(missingWorktreeDeps({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('ignores @aikami — worktrees point it at their own source dirs', () => {
    const { base, repoRoot, checkoutPath } = makeFixture(['@aikami', 'typescript'], ['typescript']);
    try {
      expect(missingWorktreeDeps({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('ignores dotted cache and shim dirs', () => {
    // .bun/.bin/.cache are caches and shims, not deps — a worktree that links
    // rather than copies them must not be reported as broken.
    const { base, repoRoot, checkoutPath } = makeFixture(
      ['.bun', '.bin', '.cache', 'typescript'],
      ['typescript'],
    );
    try {
      expect(missingWorktreeDeps({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('counts a file entry as present', () => {
    // Root's node_modules holds files (.yarn-integrity, .modules.yaml) beside
    // package dirs; presence is what matters, not the node type.
    const { base, repoRoot, checkoutPath } = makeFixture(['typescript'], []);
    try {
      writeFileSync(join(checkoutPath, 'node_modules', 'typescript'), '');
      expect(missingWorktreeDeps({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('returns empty when the root tree is absent rather than failing the run', () => {
    const { base, repoRoot, checkoutPath } = makeFixture([], []);
    try {
      rmSync(join(repoRoot, 'node_modules'), { recursive: true, force: true });
      expect(missingWorktreeDeps({ checkoutPath, repoRoot })).toEqual([]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
