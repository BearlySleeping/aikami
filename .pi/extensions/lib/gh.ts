// .pi/extensions/lib/gh.ts
//
// The single `gh` wrapper for all extensions.
//
// 🔴 This replaces two divergent implementations that drifted apart:
//   - github_cli.ts had an async `runGh` on pi.exec with `resolvePrSelector`.
//   - code_rabbit.ts had a sync `gh`/`ghJson` on runSyncOrThrow with its own
//     `prNumber`, which matched TRAILING DIGITS — so the branch `feat/c-390`
//     resolved to PR "390". `resolvePrSelector` (kept below) is the correct
//     behaviour: URLs yield their number, bare numbers pass through, and
//     anything else is handed to gh as a branch name.
//
// Execution goes through process_runner's runCommand rather than pi.exec, so
// every gh call gets process-group kill on timeout and cannot deadlock on
// inherited stdio.

import { runCommand } from './process_runner.ts';

/** Default per-call timeout. gh is network-bound; 60s is generous but finite. */
const DEFAULT_TIMEOUT_MS = 60_000;

// ── Repo root ──────────────────────────────────────────────────────

let _repoRoot: string | undefined;

/**
 * Repository root — gh always runs from here, never from a worktree subdir.
 *
 * Running gh inside a contract-pipeline worktree makes Git raise "already
 * used by worktree" when gh resolves the target branch for merge operations.
 */
export const repoRoot = (): string => {
  if (_repoRoot) {
    return _repoRoot;
  }

  // Worktree paths look like `<root>/.pi/workspaces/run-xxx`; the main repo
  // root is the parent of `.pi/`. On Windows this env var is backslash-
  // separated, so search on a posix-normalized copy (same length as the
  // original, so the found index still slices the original path correctly).
  const workspacePath = process.env.CONTRACT_PIPELINE_WORKSPACE_PATH;
  const piIndex = workspacePath?.replace(/\\/g, '/').indexOf('/.pi/') ?? -1;
  _repoRoot = workspacePath && piIndex !== -1 ? workspacePath.slice(0, piIndex) : process.cwd();
  return _repoRoot;
};

/** Test seam — clears the memoised repo root. */
export const _resetRepoRootForTest = (): void => {
  _repoRoot = undefined;
};

// ── Selectors ──────────────────────────────────────────────────────

/**
 * Resolves a PR/issue identifier to a gh-compatible selector.
 *
 *   "42"                                      → "42"
 *   "https://github.com/o/r/pull/42"          → "42"
 *   "https://github.com/o/r/issues/42"        → "42"
 *   "feat/c-390"                              → "feat/c-390"  (branch, NOT 390)
 */
export const resolvePrSelector = (raw: string): string => {
  const urlMatch = raw.match(/\/(?:pull|issues)\/(\d+)/);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }
  if (/^\d+$/.test(raw)) {
    return raw;
  }
  return raw.trim();
};

/**
 * Splits a shell-ish argument string into argv, honouring single and double
 * quotes. Used by callers that build gh invocations as one string (jq
 * expressions contain spaces and must survive intact).
 */
export const tokenizeArgs = (input: string): string[] => {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | undefined;
  let started = false;
  let escaped = false;

  for (const char of input) {
    // A backslash escapes the next character everywhere except inside single
    // quotes, matching shell semantics. Needed for jq filters and PR bodies
    // that contain quotes.
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || current.length > 0) {
        tokens.push(current);
        current = '';
        started = false;
      }
      continue;
    }
    current += char;
  }

  if (started || current.length > 0) {
    tokens.push(current);
  }
  return tokens;
};

// ── Execution ──────────────────────────────────────────────────────

export type GhOptions = {
  timeoutMs?: number;
  cwd?: string;
  signal?: AbortSignal;
  /** Parse stdout as JSON into `json`. Non-JSON output is not an error. */
  parseJson?: boolean;
  /**
   * Exit codes not treated as failure. `gh pr checks` returns 1 for
   * "failures or no checks" and 8 for "pending" — both need handling rather
   * than a hard failure.
   */
  allowExitCodes?: number[];
};

export type GhResult = {
  success: boolean;
  /** stdout on success, stderr (falling back to stdout) on failure. */
  text: string;
  json?: unknown;
  code: number | null;
};

/** Runs `gh` with the given argv. Never throws — inspect `success`. */
export const runGh = async (args: string[], options: GhOptions = {}): Promise<GhResult> => {
  const result = await runCommand('gh', args, {
    cwd: options.cwd ?? repoRoot(),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: options.signal,
  });

  const allowed = options.allowExitCodes ?? [];
  const ok = result.code === 0 || (result.code !== null && allowed.includes(result.code));

  if (!ok) {
    return {
      success: false,
      text: result.stderr || result.stdout || `gh exited with code ${result.code}`,
      code: result.code,
    };
  }

  const text = result.stdout.trim();
  if (options.parseJson && text) {
    try {
      return { success: true, text, json: JSON.parse(text), code: result.code };
    } catch {
      // Non-JSON output is legitimate for some gh subcommands.
      return { success: true, text, code: result.code };
    }
  }

  return { success: true, text, code: result.code };
};

/** Convenience: runs gh from a single argument string and returns stdout ('' on failure). */
export const gh = async (argString: string, options: GhOptions = {}): Promise<string> => {
  const result = await runGh(tokenizeArgs(argString), options);
  return result.success ? result.text : '';
};

/** Convenience: runs gh and parses JSON, returning undefined on any failure. */
export const ghJson = async <T>(
  argString: string,
  options: GhOptions = {},
): Promise<T | undefined> => {
  const result = await runGh(tokenizeArgs(argString), { ...options, parseJson: true });
  return result.success && result.json !== undefined ? (result.json as T) : undefined;
};

// ── Repo checks ────────────────────────────────────────────────────

export type RepoCheck = {
  ok: boolean;
  reason?: string;
  owner?: string;
  repo?: string;
};

/** Verifies the cwd is a git repo whose `origin` points at GitHub. */
export const ensureGitHubRepo = async (options: GhOptions = {}): Promise<RepoCheck> => {
  const result = await runCommand('git', ['remote', 'get-url', 'origin'], {
    cwd: options.cwd ?? repoRoot(),
    timeoutMs: 10_000,
    signal: options.signal,
  });

  if (result.code !== 0) {
    return { ok: false, reason: 'Not a git repository, or no "origin" remote configured' };
  }

  const remote = result.stdout.trim();
  const match = remote.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/);
  if (!match) {
    return { ok: false, reason: `Remote 'origin' is not a GitHub repository: ${remote}` };
  }
  return { ok: true, owner: match[1], repo: match[2] };
};

/** Current git branch, falling back to the pipeline base branch name. */
export const currentBranch = async (fallback = 'main'): Promise<string> => {
  const result = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: repoRoot(),
    timeoutMs: 10_000,
  });
  const branch = result.stdout.trim();
  return result.code === 0 && branch ? branch : fallback;
};
