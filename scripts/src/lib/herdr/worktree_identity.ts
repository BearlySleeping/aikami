// scripts/src/lib/herdr/worktree_identity.ts
//
// Repo identity for herdr worktrees: which repository does a path belong to,
// and do two paths denote the same one.
//
// Why this is its own module (it was carved out of worktree.ts, which sits on
// a size waiver): identity is the invariant every worktree operation rests on,
// and it has exactly one consumer shape — compare what herdr did against what
// we asked for. Keeping it separate makes that check readable at the call site
// and gives it a home for its own tests, instead of burying the rules in a
// 1300-line lifecycle module.
//
// The bug this exists to prevent: `herdr worktree create` resolves against the
// server's currently FOCUSED workspace when the caller gives it no explicit
// repo, and its answer is not self-verifying. A resolution that lands on a
// sibling checkout returns a completely well-formed response — workspace id,
// tab, pane, checkout path — for a worktree of the WRONG repository, so the
// agent goes on to bootstrap and edit a project the user never named. Passing
// `--cwd` makes herdr resolve correctly; comparing what comes back is what
// makes that guarantee checkable rather than assumed.

import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runGit } from '../agents/git_worktree.ts';

/** Root checkout directory of the MAIN repo for a worktree (from .git file). */
export const worktreeRepoRoot = (checkoutPath: string): string => {
  try {
    const gitFile = readFileSync(join(checkoutPath, '.git'), 'utf-8').trim();
    const m = gitFile.match(/^gitdir:\s*(.+)$/m);
    if (m?.[1]) {
      const gitDir = resolve(m[1].trim());
      // <repo>/.git/worktrees/<name> → repo root is everything before
      // "/.git/worktrees/". Fall back to walking up 3 levels for other
      // layouts (<repo>/.git/worktrees/name → ../../.. → <repo>).
      const idx = gitDir.indexOf('/.git/worktrees/');
      if (idx !== -1) {
        return gitDir.slice(0, idx);
      }
      return resolve(gitDir, '../../..');
    }
  } catch {
    // Not a linked worktree — fall back to rev-parse.
  }
  try {
    return runGit('rev-parse --show-toplevel', { cwd: checkoutPath });
  } catch {
    throw new Error(`Cannot determine repo root for ${checkoutPath}`);
  }
};

/**
 * True when two paths denote the same checkout on disk.
 *
 * `realpathSync.native` on both sides so a symlinked or trailing-slash spelling
 * cannot read as a different repo, and a case-insensitive compare on Windows
 * (`C:\Repo` and `c:\repo` are the same directory there). Falls back to
 * `resolve` for a path that does not exist yet — a repo identity check must
 * still be able to say "these differ" rather than throwing.
 */
export const sameRepoPath = (a: string, b: string): boolean => {
  const canonical = (p: string): string => {
    try {
      return realpathSync.native(p);
    } catch {
      return resolve(p);
    }
  };
  const left = canonical(a);
  const right = canonical(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
};

/**
 * The repo a checkout belongs to, or undefined when it cannot be determined.
 *
 * The non-throwing counterpart to {@link worktreeRepoRoot}, for post-condition
 * checks on a path herdr just reported: an unresolvable path is "unknown", not
 * a crash, and the caller decides whether unknown is acceptable.
 */
export const checkoutRepoRootOrUndefined = (checkoutPath: string): string | undefined => {
  try {
    return worktreeRepoRoot(checkoutPath);
  } catch {
    return undefined;
  }
};

/**
 * Whether a worktree herdr just created belongs to the repo we asked for.
 *
 * Two independent sources of truth, because either alone can be absent or
 * wrong: herdr's own declared `repo_root`, and the gitdir the checkout's
 * `.git` file actually points at. The latter is authoritative — it is what git
 * itself will act on. A path whose repo cannot be resolved is not treated as a
 * mismatch (unknown ≠ wrong); it is simply not evidence either way.
 */
export const isWorktreeOfRepo = (options: {
  checkoutPath: string;
  /** `repo_root` as herdr declared it, when the response carried one. */
  declaredRepoRoot?: string;
  /** The repo the caller requested. */
  requestedRepoRoot: string;
}): boolean => {
  const { checkoutPath, declaredRepoRoot, requestedRepoRoot } = options;
  const actualRepoRoot = checkoutRepoRootOrUndefined(checkoutPath);
  return !(
    (declaredRepoRoot !== undefined && !sameRepoPath(declaredRepoRoot, requestedRepoRoot)) ||
    (actualRepoRoot !== undefined && !sameRepoPath(actualRepoRoot, requestedRepoRoot))
  );
};
