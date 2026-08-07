// scripts/src/lib/agents/git_worktree.ts
//
// Pure git primitives shared by the herdr-native worktree module
// (scripts/src/lib/herdr/worktree.ts — THE source of truth for worktree
// lifecycle), the contract pipeline orchestrator, and Pi extensions.
// Do not fork; keep low-level (no herdr calls here).
//
// 🔴 Worktree PROVISIONING (create/bootstrap/remove via herdr) moved to
//    scripts/src/lib/herdr/worktree.ts. The legacy provisionGitWorktree /
//    removeWorktree / WORKSPACES_DIR were deleted when the pipeline switched
//    to herdr-native worktrees — this file holds only git primitives now.

import { execSync } from 'node:child_process';

// ── Constants ────────────────────────────────────────────────

export const MAX_BRANCH_NAME_LENGTH = 80;

// ── Helpers ──────────────────────────────────────────────────

interface GitExecError extends Error {
  stderr?: string;
}

const isGitExecError = (err: unknown): err is GitExecError => err instanceof Error;

/**
 * Run a git command with retry on index.lock contention.
 *
 * Automatically retries on git index.lock contention (exponential
 * backoff: 100ms → 200ms → 400ms). Throws on any other failure.
 *
 * @param command  git subcommand and args (e.g. `"rev-parse HEAD"`)
 * @param options  cwd, env, timeoutMs (default: none — callers that can
 *                 stall, e.g. pushes, should pass an explicit bound)
 */
export const runGit = (
  command: string,
  options?: { cwd?: string; env?: Record<string, string>; timeoutMs?: number },
): string => {
  const cmd = `git ${command}`;

  const opts: {
    encoding: 'utf-8';
    stdio: ['pipe', 'pipe', 'pipe'];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
  } = {
    encoding: 'utf-8' as const,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
    cwd: options?.cwd,
  };
  if (options?.timeoutMs !== undefined) {
    opts.timeout = options.timeoutMs;
  }
  if (options?.env) {
    opts.env = { ...(process.env as Record<string, string>), ...options.env };
  }

  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return execSync(cmd, opts).trim();
    } catch (err: unknown) {
      lastError = err;
      const message = isGitExecError(err) ? (err.stderr ?? err.message) : String(err);

      if (/index\.lock/i.test(message) && attempt < maxRetries - 1) {
        const delay = 100 * 2 ** attempt;
        const start = Date.now();
        while (Date.now() - start < delay) {
          // Busy-wait for sub-second retry delays
        }
        continue;
      }

      throw new Error(`git ${command} failed: ${message}`);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`git ${command} failed after ${maxRetries} retries: ${message}`);
};

// ── Workspace utilities ──────────────────────────────────────

/** Sanitize a string for use as a git branch and worktree directory name. */
export const sanitizeBranchName = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BRANCH_NAME_LENGTH);

/** Get the HEAD commit hash in the given working directory. */
export const getGitHeadCommit = (cwd: string): string => {
  const output = runGit('rev-parse HEAD', { cwd });
  return output.trim();
};

/** Check whether a directory is inside a git repo. */
export const isGitRepo = (cwd?: string): boolean => {
  try {
    runGit('rev-parse --git-dir', { cwd });
    return true;
  } catch {
    return false;
  }
};

/**
 * Stage all changes and commit in the given worktree.
 * Returns the new HEAD commit hash.
 */
export const commitAll = (options: {
  cwd: string;
  message: string;
  authorName?: string;
  authorEmail?: string;
}): string => {
  const envFlags =
    options.authorName && options.authorEmail
      ? `-c "user.name=${options.authorName}" -c "user.email=${options.authorEmail}"`
      : '';

  // Suppress knowledge:sync pre-commit hooks in worktrees.
  const env = { CONTRACT_PIPELINE_WORKTREE: '1' };

  // Stage all changes including untracked files.
  runGit(`${envFlags} add -A`.trim(), { cwd: options.cwd, env });

  // Check if there's anything to commit.
  try {
    runGit(`${envFlags} diff --cached --quiet`.trim(), { cwd: options.cwd, env });
    return getGitHeadCommit(options.cwd);
  } catch {
    // Staged changes exist — proceed with commit.
  }

  const commitCmd =
    `${envFlags} commit --no-verify -m "${options.message.replace(/"/g, '\\"')}"`.trim();
  runGit(commitCmd, { cwd: options.cwd, env });
  return getGitHeadCommit(options.cwd);
};

/**
 * Push the worktree branch to origin and set upstream tracking.
 * Returns the branch name.
 */
export const pushBranch = (options: {
  cwd: string;
  branchName: string;
  setUpstream?: boolean;
  /** Push timeout in ms (default 180_000 — a stalled remote must not hang the caller). */
  timeoutMs?: number;
}): string => {
  const upstreamFlag = options.setUpstream !== false ? '-u' : '';
  runGit(`push ${upstreamFlag} origin ${options.branchName}`.trim(), {
    cwd: options.cwd,
    timeoutMs: options.timeoutMs ?? 180_000,
  });
  return options.branchName;
};

/**
 * Check if a branch exists on the remote.
 */
export const remoteBranchExists = (options: { branchName: string; repoRoot: string }): boolean => {
  try {
    const result = runGit(`ls-remote --heads origin refs/heads/${options.branchName}`, {
      cwd: options.repoRoot,
    });
    return result.length > 0;
  } catch {
    return false;
  }
};
