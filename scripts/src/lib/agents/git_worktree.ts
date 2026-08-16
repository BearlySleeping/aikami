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

import { execFileSync } from 'node:child_process';
import { reportInfraIssue } from '../ops/infra_report.ts';

// ── Constants ────────────────────────────────────────────────

export const MAX_BRANCH_NAME_LENGTH = 80;

// ── Helpers ──────────────────────────────────────────────────

interface GitExecError extends Error {
  stderr?: string;
}

const isGitExecError = (err: unknown): err is GitExecError => err instanceof Error;

/**
 * Split a git command string into an argv array, honoring the quoting style
 * every runGit caller uses: single-quoted paths (`'path with spaces'`),
 * double-quoted values (`-m "message"`, `--format="%H %s"`), `\"` escapes
 * inside double quotes, and the POSIX `'\''` single-quote escape (worktree.ts
 * branch names). No shell expansion is performed — callers interpolate values
 * into the string before runGit ever sees it.
 *
 * 🔴 WHY NOT `execSync`: on Windows it routes through cmd.exe, which treats
 * `'` as a literal character, so `git status -- 'code.ts'` silently never
 * matches the path — corrupting every quoted runGit call (e.g. contract_sync
 * `status --porcelain -- '<path>'`). Executing via `execFileSync` with a real
 * argv array skips the shell entirely and behaves identically on POSIX and
 * Windows. Values are pre-interpolated, so this reproduces the POSIX
 * `sh -c` path minus the quoting bugs.
 */
export const splitGitCommand = (command: string): string[] => {
  const args: string[] = [];
  let current = '';
  let i = 0;
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'") {
      // Single-quoted segment — everything literal until the closing quote.
      // `'\''` inside a single-quoted string escapes a literal quote.
      let end = i + 1;
      while (end < command.length) {
        if (command[end] === "'" && command[end + 1] === '\\' && command[end + 2] === "'") {
          current += "'";
          end += 3;
          continue;
        }
        if (command[end] === "'") {
          break;
        }
        current += command[end];
        end += 1;
      }
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      // Double-quoted segment — literal except `\"`.
      let end = i + 1;
      while (end < command.length) {
        if (command[end] === '\\' && command[end + 1] === '"') {
          current += '"';
          end += 2;
          continue;
        }
        if (command[end] === '"') {
          break;
        }
        current += command[end];
        end += 1;
      }
      i = end + 1;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (current !== '') {
        args.push(current);
        current = '';
      }
      i += 1;
      continue;
    }
    current += ch;
    i += 1;
  }
  if (current !== '') {
    args.push(current);
  }
  return args;
};

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
  const opts: {
    encoding: 'utf-8';
    stdio: ['pipe', 'pipe', 'pipe'];
    cwd?: string;
    env?: Record<string, string>;
    timeout?: number;
    // Windows: without windowsHide, git.exe spawns a visible console window
    // per call. No-op on POSIX.
    windowsHide?: boolean;
  } = {
    encoding: 'utf-8' as const,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
    cwd: options?.cwd,
    windowsHide: true,
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
      return execFileSync('git', splitGitCommand(command), opts).trim();
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
  /**
   * Paths that must never ride into a pipeline commit — workspace-local
   * state (direnv delegation, pi settings, shared progress docs). These are
   * normally kept out of `git add -A` by `git update-index --skip-worktree`
   * (see WORKTREE_SKIP_WORKTREE_PATHS in herdr/worktree.ts), but that is a
   * separate mechanism applied once at bootstrap time — if it ever fails
   * silently (missing index entry, a race, a git version quirk) `add -A`
   * stages the file anyway with no further warning.
   *
   * 🔴 This is the last-mile check: C-400 (763da4d6) merged a corrupted
   * `.envrc` to main this way — skip-worktree should have kept it out, but
   * something upstream let it through, and nothing downstream caught it
   * before the PR merged. This guard makes that class of failure impossible
   * to miss: any protected path found staged is unstaged and reported; if it
   * cannot be unstaged, the commit is refused outright rather than silently
   * carrying the leaked file forward.
   */
  protectedPaths?: string[];
}): string => {
  const envFlags =
    options.authorName && options.authorEmail
      ? `-c "user.name=${options.authorName}" -c "user.email=${options.authorEmail}"`
      : '';

  // Suppress knowledge:sync pre-commit hooks in worktrees.
  const env = { CONTRACT_PIPELINE_WORKTREE: '1' };

  // Stage all changes including untracked files.
  runGit(`${envFlags} add -A`.trim(), { cwd: options.cwd, env });

  if (options.protectedPaths && options.protectedPaths.length > 0) {
    unstageProtectedPaths({ cwd: options.cwd, env, protectedPaths: options.protectedPaths });
  }

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

const stagedPaths = (options: { cwd: string; env: Record<string, string> }): string[] => {
  try {
    return runGit('diff --cached --name-only', { cwd: options.cwd, env: options.env })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
};

/** See `commitAll`'s `protectedPaths` doc — the last-mile guard itself. */
const unstageProtectedPaths = (options: {
  cwd: string;
  env: Record<string, string>;
  protectedPaths: string[];
}): void => {
  const leaked = options.protectedPaths.filter((p) => stagedPaths(options).includes(p));
  if (leaked.length === 0) {
    return;
  }
  console.warn(
    `⚠️  Unstaging protected path(s) that leaked into the commit despite skip-worktree: ` +
      `${leaked.join(', ')}. skip-worktree failed to keep these out — investigate the worktree bootstrap.`,
  );
  reportInfraIssue({
    component: 'commit_all',
    operation: 'unstage protected paths that leaked past skip-worktree',
    error: new Error(leaked.join(', ')),
    context: { cwd: options.cwd },
  });
  for (const path of leaked) {
    try {
      runGit(`restore --staged -- '${path}'`, { cwd: options.cwd, env: options.env });
    } catch {
      // Fall through — the re-check below refuses the commit outright.
    }
  }
  const stillLeaked = options.protectedPaths.filter((p) => stagedPaths(options).includes(p));
  if (stillLeaked.length > 0) {
    throw new Error(
      `Refusing to commit: protected path(s) could not be unstaged: ${stillLeaked.join(', ')}.`,
    );
  }
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
