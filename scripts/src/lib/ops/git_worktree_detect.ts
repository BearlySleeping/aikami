// scripts/src/lib/ops/git_worktree_detect.ts
//
// "Am I in a linked git worktree?" — asked by every git hook in this repo,
// for the same underlying reason: a worktree's commit must not carry files
// that belong to the main checkout.
//
//   * ops/pre_commit.ts skips the knowledge:sync block, which would otherwise
//     stage the skip-worktree'd contract file into the agent's commit.
//   * ops/sync_workspace.ts skips `moon sync`, whose tsconfig and project
//     sync artifacts would be swept into a contract-pipeline commit by
//     `commitAll`'s `git add -A`.
//
// 🔴 Deliberately a module of its own rather than an export from either
// caller: sync_workspace.ts runs `main()` at import time (it is a CLI
// entrypoint, `bun run sync-workspace`), so importing the helper from there
// would trigger a `moon sync` as a side effect of asking a question.
//
// 🔴 No `Bun.*` and no `import.meta` here — this module sits in the import
// graph reachable from `.pi/extensions/*`, which pi loads under Node. See
// scripts/src/lib/env/runtime_boundary.test.ts.
import { execSync } from 'node:child_process';

/**
 * True in any linked git worktree — the contract pipeline's or a developer's.
 *
 * `--git-dir` differs from `--git-common-dir` only in a linked worktree, so
 * this detects the condition from git itself rather than trusting a
 * caller-set environment variable.
 *
 * 🔴 Fails conservative: if git cannot answer, assume worktree — i.e. take
 * the branch that does NOT mutate shared files. A wrong "no" writes foreign
 * files into a pipeline commit; a wrong "yes" merely skips a nicety.
 */
export const isLinkedWorktree = (cwd: string = process.cwd()): boolean => {
  try {
    const gitDir = execSync('git rev-parse --absolute-git-dir', {
      encoding: 'utf8',
      cwd,
    }).trim();
    const commonDir = execSync('git rev-parse --path-format=absolute --git-common-dir', {
      encoding: 'utf8',
      cwd,
    }).trim();
    return gitDir !== commonDir;
  } catch {
    return true;
  }
};
