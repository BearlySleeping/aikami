// scripts/src/lib/agents/git_worktree.ts
//
// Git Worktree utilities used by the contract pipeline orchestrator,
// herdr adapter, and Pi extensions. Single source of truth — do not fork.
//
// Replaces the deprecated jj.ts (Jujutsu). Uses Git Worktrees for
// isolated agent workspaces — root repo stays untouched on dev/main.

import { execSync } from 'node:child_process';
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

// ── Constants ────────────────────────────────────────────────

export const WORKSPACES_DIR = '.pi/workspaces';
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
 * @param options  cwd, env
 */
export const runGit = (
  command: string,
  options?: { cwd?: string; env?: Record<string, string> },
): string => {
  const cmd = `git ${command}`;

  const opts: {
    encoding: 'utf-8';
    stdio: ['pipe', 'pipe', 'pipe'];
    cwd?: string;
    env?: Record<string, string>;
  } = {
    encoding: 'utf-8' as const,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
    cwd: options?.cwd,
  };
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

/** Check if a git branch exists (local or remote). */
const branchExistsLocal = (branch: string, cwd: string): boolean => {
  try {
    runGit(`rev-parse --verify refs/heads/${branch}`, { cwd });
    return true;
  } catch {
    return false;
  }
};

/**
 * Provision a Git Worktree on a new branch.
 *
 * Creates `{repoRoot}/.pi/workspaces/{sanitizedName}` as an isolated
 * worktree on a new branch derived from `baseRevision` (default `dev`).
 * The root working copy is left untouched.
 *
 * If the worktree directory already exists (from a prior partial run),
 * returns its existing state without recreating.
 *
 * Returns the workspace path, branch name, and HEAD commit hash.
 */
export const provisionGitWorktree = (options: {
  repoRoot: string;
  name: string;
  baseRevision?: string;
}): { workspacePath: string; branchName: string; headCommit: string } => {
  const sanitized = sanitizeBranchName(options.name);
  const wsDir = join(options.repoRoot, WORKSPACES_DIR, sanitized);
  const base = options.baseRevision ?? 'dev';

  mkdirSync(join(options.repoRoot, WORKSPACES_DIR), { recursive: true });

  // Check if the worktree already exists (directory present with .git file)
  const alreadyExists = existsSync(join(wsDir, '.git'));

  if (!alreadyExists) {
    // Clean up stale worktree references (directory deleted manually).
    try {
      runGit('worktree prune', { cwd: options.repoRoot });
    } catch {}
    // Generate a unique branch name. If sanitized already exists, append a
    // short token to avoid collision.
    let branchName = sanitized;
    if (branchExistsLocal(branchName, options.repoRoot)) {
      const token = Date.now().toString(36).slice(-6);
      branchName = `${sanitized}-${token}`;
    }

    // Fetch latest from remote so the base revision is current.
    try {
      runGit('fetch origin', { cwd: options.repoRoot });
    } catch {
      // Non-fatal — may not have a remote configured.
    }

    // Resolve the base revision to a commit-ish. Try origin/<base> first,
    // then <base> as a local ref.
    let baseRef = `origin/${base}`;
    try {
      runGit(`rev-parse --verify ${baseRef}`, { cwd: options.repoRoot });
    } catch {
      baseRef = base;
    }

    // Create the worktree on the new branch.
    runGit(`worktree add -b ${branchName} '${wsDir}' ${baseRef}`, {
      cwd: options.repoRoot,
    });

    // Install dependencies so dev servers and tests can run.
    try {
      execSync('bun install --frozen-lockfile', {
        cwd: wsDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 60_000,
      });
    } catch {
      // Non-fatal — implementer can run bun install manually.
    }
  }

  // Resolve the branch name of the worktree.
  let branchName: string;
  try {
    branchName = runGit('rev-parse --abbrev-ref HEAD', { cwd: wsDir });
  } catch {
    branchName = sanitized;
  }

  // Always ensure direnv is configured — even when recovering an existing
  // workspace. Nix Flake requires flake.nix to be Git-tracked, but
  // .pi/workspaces/ is gitignored. Replace .envrc with a source_env
  // pointing at the repo root.
  try {
    writeFileSync(
      join(wsDir, '.envrc'),
      `# Workspace direnv — delegate to repo root where flake.nix is Git-tracked
source_env ${options.repoRoot}
`,
    );
    execSync('direnv allow', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: wsDir,
      timeout: 5000,
    });
  } catch {
    // direnv may not be installed — not fatal.
  }

  // 🔴 Safety: mark workspace-local and auto-generated files as
  // skip-worktree so git ignores modifications. Git worktrees use
  // a `.git` FILE (not directory) so .git/info/exclude is unavailable.
  // skip-worktree is the ONLY reliable mechanism here.
  try {
    runGit(
      'update-index --skip-worktree .envrc .pi/settings.json .context/llms.txt docs/contracts/PROGRESS.md docs/contracts/PROMOTION.md',
      { cwd: wsDir },
    );
  } catch {
    // Non-fatal.
  }

  // Symlink .pi/npm from root so pi extensions are available.
  const workspaceNpmDir = join(wsDir, '.pi', 'npm');
  const rootNpmDir = join(options.repoRoot, '.pi', 'npm');
  if (existsSync(rootNpmDir)) {
    try {
      mkdirSync(join(wsDir, '.pi'), { recursive: true });
      execSync(`rm -f '${join(workspaceNpmDir, 'npm')}'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      });
      if (existsSync(workspaceNpmDir)) {
        const rm = join(rootNpmDir, 'node_modules');
        const wm = join(workspaceNpmDir, 'node_modules');
        if (existsSync(rm) && !existsSync(wm)) {
          execSync(`ln -sfn '${rm}' '${wm}'`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            timeout: 5000,
          });
        }
      } else {
        execSync(`ln -sfn '${rootNpmDir}' '${workspaceNpmDir}'`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 5000,
        });
      }
    } catch {
      /* fallback: pi auto-installs */
    }
  }

  // Copy Pi settings from root to workspace.
  const rootSettingsPath = join(options.repoRoot, '.pi', 'settings.json');
  const workspaceSettingsPath = join(wsDir, '.pi', 'settings.json');
  if (existsSync(rootSettingsPath)) {
    try {
      mkdirSync(join(wsDir, '.pi'), { recursive: true });
      copyFileSync(rootSettingsPath, workspaceSettingsPath);
    } catch {}
  }

  // Set env var so knowledge:sync scripts skip in worktrees.
  // PROGRESS.md and PROMOTION.md are shared files that cause merge
  // conflicts when modified in parallel contract branches.
  // Sync should only run on main (after PR merge).
  try {
    const envrcPath = join(wsDir, '.envrc');
    const existing = existsSync(envrcPath) ? readFileSync(envrcPath, 'utf-8') : '';
    if (!existing.includes('CONTRACT_PIPELINE_WORKTREE')) {
      appendFileSync(envrcPath, '\nexport CONTRACT_PIPELINE_WORKTREE=1\n');
    }
  } catch {
    // Non-fatal.
  }

  return {
    workspacePath: wsDir,
    branchName,
    headCommit: getGitHeadCommit(wsDir),
  };
};

/**
 * Remove a Git Worktree and optionally delete its remote branch.
 * Used for both successful completions and error recovery.
 *
 * Does NOT abandon commits — git history is preserved on the branch
 * (or orphaned if the branch was never pushed).
 */
export const removeWorktree = (options: {
  workspacePath: string;
  repoRoot: string;
  branchName?: string;
  deleteRemoteBranch?: boolean;
}): void => {
  // Remove the worktree (--force handles dirty state).
  try {
    runGit(`worktree remove '${options.workspacePath}' --force`, {
      cwd: options.repoRoot,
    });
  } catch {
    // Worktree may already be removed, or directory may not be a worktree.
    // Fall back to rm -rf if git worktree remove fails.
    try {
      execSync(`rm -rf '${options.workspacePath}'`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      });
    } catch {
      // Last resort — nothing to do.
    }
  }

  // Optionally delete the remote branch.
  if (options.deleteRemoteBranch && options.branchName) {
    try {
      runGit(`push origin --delete ${options.branchName}`, {
        cwd: options.repoRoot,
      });
    } catch {
      // Branch may not exist on remote.
    }
  }

  // Force-delete the local branch. git worktree remove prunes the branch
  // when it succeeds, but if the worktree was already deleted manually or
  // the remove failed, the local branch lingers. This is the safety net.
  if (options.branchName) {
    try {
      runGit(`branch -D ${options.branchName}`, {
        cwd: options.repoRoot,
      });
    } catch {
      // Branch may already be deleted.
    }
  }

  // Clean up the local branch reference (worktree remove may leave it).
  if (options.branchName) {
    try {
      runGit(`branch -D ${options.branchName}`, { cwd: options.repoRoot });
    } catch {
      // Branch may already be deleted.
    }
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
  // biome-ignore lint/style/useNamingConvention: env var name matches process.env key
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
}): string => {
  const upstreamFlag = options.setUpstream !== false ? '-u' : '';
  runGit(`push ${upstreamFlag} origin ${options.branchName}`.trim(), {
    cwd: options.cwd,
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
