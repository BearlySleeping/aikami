// scripts/src/lib/herdr/worktree_identity.test.ts
//
// Repo identity — which repository a path belongs to, and whether two paths
// are the same one.
//
// The wrong-repository incident this pins: `herdr worktree create` resolved
// against the server's currently FOCUSED workspace instead of the requested
// repo, and returned a completely well-formed response — workspace id, tab,
// pane, checkout path — for a worktree of a SIBLING project. Nothing
// downstream could tell, so the agent bootstrapped and worked in a repository
// the user never named. Passing `--cwd` makes herdr resolve correctly; these
// predicates are what make the answer checkable rather than assumed.

import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  checkoutRepoRootOrUndefined,
  isWorktreeOfRepo,
  sameRepoPath,
  worktreeRepoRoot,
} from './worktree_identity.ts';

describe('sameRepoPath', () => {
  it('treats a trailing separator as the same checkout', () => {
    const base = mkdtempSync(join(tmpdir(), 'aikami-samerepo-'));
    try {
      expect(sameRepoPath(base, `${base}/`)).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('resolves a symlinked spelling to the same checkout', () => {
    const base = mkdtempSync(join(tmpdir(), 'aikami-samerepo-link-'));
    const real = join(base, 'real');
    const link = join(base, 'link');
    mkdirSync(real, { recursive: true });
    try {
      symlinkSync(real, link, 'dir');
      expect(sameRepoPath(real, link)).toBe(true);
    } catch {
      // Windows without Developer Mode cannot create directory symlinks —
      // the junction fallback in bootstrapWorktree covers that case, and this
      // assertion adds nothing there.
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('still separates two sibling checkouts', () => {
    // The regression itself: `starter` and `aikami` are siblings under the
    // same parent, so a prefix/contains comparison would call them equal.
    expect(sameRepoPath('/repos/passion/starter', '/repos/passion/aikami')).toBe(false);
    expect(sameRepoPath('/repos/passion/aikami', '/repos/passion/aikami-2')).toBe(false);
  });
});

describe('checkoutRepoRootOrUndefined', () => {
  /** A main checkout plus one linked worktree registered under its .git. */
  const makeRepoPair = () => {
    const base = mkdtempSync(join(tmpdir(), 'aikami-worktree-identity-'));
    const repoRoot = join(base, 'repo');
    const worktreePath = join(base, 'wt');
    const gitDir = join(repoRoot, '.git');
    mkdirSync(join(gitDir, 'worktrees', 'wt'), { recursive: true });
    mkdirSync(repoRoot, { recursive: true });
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(worktreePath, '.git'), `gitdir: ${join(gitDir, 'worktrees', 'wt')}\n`);
    return { base, repoRoot, worktreePath };
  };

  it('resolves a linked worktree back to the MAIN checkout', () => {
    const { base, repoRoot, worktreePath } = makeRepoPair();
    try {
      expect(checkoutRepoRootOrUndefined(worktreePath)).toBe(repoRoot);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('returns undefined for a path that is not a checkout at all', () => {
    const base = mkdtempSync(join(tmpdir(), 'aikami-worktree-identity-none-'));
    try {
      expect(checkoutRepoRootOrUndefined(join(base, 'nope'))).toBeUndefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('isWorktreeOfRepo', () => {
  /** Two independent repos, each with one linked worktree. */
  const makeTwoRepos = () => {
    const base = mkdtempSync(join(tmpdir(), 'aikami-wrong-repo-'));
    const make = (name: string) => {
      const repoRoot = join(base, name);
      const worktreePath = join(base, `${name}-wt`);
      mkdirSync(join(repoRoot, '.git', 'worktrees', 'wt'), { recursive: true });
      mkdirSync(repoRoot, { recursive: true });
      mkdirSync(worktreePath, { recursive: true });
      writeFileSync(
        join(worktreePath, '.git'),
        `gitdir: ${join(repoRoot, '.git', 'worktrees', 'wt')}\n`,
      );
      return { repoRoot, worktreePath };
    };
    const aikami = make('aikami');
    const starter = make('starter');
    return { base, aikami, starter };
  };

  it('accepts a checkout of the requested repo', () => {
    const { base, aikami } = makeTwoRepos();
    try {
      expect(
        isWorktreeOfRepo({
          checkoutPath: aikami.worktreePath,
          requestedRepoRoot: aikami.repoRoot,
        }),
      ).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a checkout of a SIBLING repo — the wrong-repository bug', () => {
    // The regression: herdr reported a complete, plausible worktree — but of
    // `starter`, not the `aikami` the caller asked for. Accepting it is how an
    // agent ends up editing a repository the user never named.
    const { base, aikami, starter } = makeTwoRepos();
    try {
      expect(
        isWorktreeOfRepo({
          checkoutPath: starter.worktreePath,
          requestedRepoRoot: aikami.repoRoot,
        }),
      ).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("rejects on herdr's declared repo_root even when the checkout agrees", () => {
    // Defence in depth: herdr saying one thing while the checkout says another
    // is itself the signal, so a mismatch on EITHER source fails the check.
    const { base, aikami } = makeTwoRepos();
    try {
      expect(
        isWorktreeOfRepo({
          checkoutPath: aikami.worktreePath,
          requestedRepoRoot: aikami.repoRoot,
          declaredRepoRoot: '/somewhere/else',
        }),
      ).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('does not treat an unresolvable checkout as a mismatch', () => {
    // Unknown is not the same as wrong: a path herdr reported but that no
    // longer resolves must not be reported as a wrong-repo failure.
    const base = mkdtempSync(join(tmpdir(), 'aikami-wrong-repo-none-'));
    try {
      expect(
        isWorktreeOfRepo({
          checkoutPath: join(base, 'gone'),
          requestedRepoRoot: join(base, 'repo'),
        }),
      ).toBe(true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('worktreeRepoRoot', () => {
  it('returns the main checkout for a linked worktree', () => {
    const base = mkdtempSync(join(tmpdir(), 'aikami-wtrepo-root-'));
    const repoRoot = join(base, 'repo');
    const worktreePath = join(base, 'wt');
    mkdirSync(join(repoRoot, '.git', 'worktrees', 'wt'), { recursive: true });
    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(
      join(worktreePath, '.git'),
      `gitdir: ${join(repoRoot, '.git', 'worktrees', 'wt')}\n`,
    );
    try {
      expect(worktreeRepoRoot(worktreePath)).toBe(repoRoot);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('throws rather than guessing for a path that is not a checkout', () => {
    const base = mkdtempSync(join(tmpdir(), 'aikami-wtrepo-root-none-'));
    try {
      expect(() => worktreeRepoRoot(join(base, 'nope'))).toThrow(/Cannot determine repo root/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
