// scripts/src/lib/agents/jj.ts
//
// Shared jj (Jujutsu) utilities used by the contract pipeline orchestrator,
// herdr adapter, and Pi extensions. Single source of truth — do not fork.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ── Constants ────────────────────────────────────────────────

export const WORKSPACES_DIR = '.pi/workspaces';
export const MAX_WORKSPACE_NAME_LENGTH = 80;

// ── Identity ─────────────────────────────────────────────────

/** Headless identity flags for CI/sandbox/Nix containers. */
const JJ_IDENTITY_FLAGS = "--config 'user.name=Pi Agent' --config 'user.email=agent@pi.internal'";

// ── Helpers ──────────────────────────────────────────────────

interface JjExecError extends Error {
  stderr?: string;
}

const isJjExecError = (err: unknown): err is JjExecError => err instanceof Error;

/**
 * Run a jj command with headless identity and git-lock retry.
 *
 * Automatically retries on git index.lock contention (exponential
 * backoff: 100ms → 200ms → 400ms). Throws on any other failure.
 *
 * Uses `--ignore-working-copy` for read-only queries to prevent
 * jj from snapshotting the root working copy when running from
 * an isolated workspace.
 *
 * @param command  jj subcommand and args (e.g. `"log -r @ --no-graph -T change_id"`)
 * @param options  cwd, read-only mode
 */
export const runJj = (command: string, options?: { cwd?: string; readOnly?: boolean }): string => {
  const ignoreWorking = options?.readOnly ? '--ignore-working-copy ' : '';
  const cmd = `jj ${ignoreWorking}${JJ_IDENTITY_FLAGS} ${command}`;

  const opts = {
    encoding: 'utf-8' as const,
    stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
    cwd: options?.cwd,
  };

  const maxRetries = 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return execSync(cmd, opts).trim();
    } catch (err: unknown) {
      lastError = err;
      const message = isJjExecError(err) ? (err.stderr ?? err.message) : String(err);

      if (/index\.lock/i.test(message) && attempt < maxRetries - 1) {
        const delay = 100 * 2 ** attempt;
        const start = Date.now();
        while (Date.now() - start < delay) {
          // Busy-wait for sub-second retry delays
        }
        continue;
      }

      throw new Error(`jj ${command} failed: ${message}`);
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`jj ${command} failed after ${maxRetries} retries: ${message}`);
};

// ── Workspace utilities ──────────────────────────────────────

/** Sanitize a string for use as a jj workspace / bookmark name. */
export const sanitizeWorkspaceName = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_WORKSPACE_NAME_LENGTH);

/** Get the change ID of @ in the given working directory. */
export const getJjChangeId = (cwd: string): string => {
  const output = runJj('log -r @ --no-graph -T change_id', { cwd });
  return output.trim();
};

/** Check whether a directory is inside a jj repo. */
export const isJjRepo = (cwd?: string): boolean => {
  try {
    runJj('root', { cwd, readOnly: true });
    return true;
  } catch {
    return false;
  }
};

/**
 * Provision a jj workspace on top of the given base revision.
 *
 * Creates `{repoRoot}/.pi/workspaces/{sanitizedName}` as a co-located
 * workspace whose @ is parented on `baseRevision` (default `dev`).
 * The root working copy is left untouched.
 *
 * Returns the workspace path and change ID. Safe to call when the
 * workspace already exists — returns existing state.
 */
export const provisionJjWorkspace = (options: {
  repoRoot: string;
  name: string;
  baseRevision?: string;
}): { workspacePath: string; changeId: string } => {
  const sanitized = sanitizeWorkspaceName(options.name);
  const wsDir = join(options.repoRoot, WORKSPACES_DIR, sanitized);

  mkdirSync(join(options.repoRoot, WORKSPACES_DIR), { recursive: true });

  const alreadyExists = existsSync(join(wsDir, '.jj'));

  if (!alreadyExists) {
    const base = options.baseRevision ?? 'dev';
    runJj(`workspace add -r ${base} '${wsDir}'`, { cwd: options.repoRoot });
  }

  return {
    workspacePath: wsDir,
    changeId: getJjChangeId(wsDir),
  };
};

/**
 * Abandon a change and clean up its workspace directory.
 * Used for error recovery (Phase D) — does NOT delete history.
 */
export const abandonWorkspace = (options: {
  workspacePath: string;
  repoRoot: string;
  changeId?: string;
}): void => {
  if (options.changeId) {
    try {
      runJj(`abandon ${options.changeId}`, { cwd: options.repoRoot });
    } catch {
      // Change may already be abandoned.
    }
  }

  try {
    runJj(`workspace forget '${options.workspacePath}'`, { cwd: options.repoRoot });
  } catch {
    // Workspace may already be forgotten.
  }
};
