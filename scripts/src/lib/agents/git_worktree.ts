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

const DEFAULT_REMOTE = 'origin';
const SHA_REF_PATTERN = /^[0-9a-f]{4,64}$/i;
const FORBIDDEN_BRANCH_CHARACTERS = new Set(['~', '^', ':', '?', '*', '[', '\\']);
const SIMPLE_GIT_ARGUMENT_PATTERN = /^[A-Za-z0-9._/:@^~+-]+$/;
const REMOTE_REF_PATTERN = /^refs\/remotes\/([^/]+)\/(.+)$/;
const LOCAL_REF_PREFIX = 'refs/heads/';
const REMOTE_REF_PREFIX = 'refs/remotes/';

// ── Helpers ──────────────────────────────────────────────────

interface GitExecError extends Error {
  stderr?: string;
}

const isGitExecError = (err: unknown): err is GitExecError => err instanceof Error;

const SYMBOLIC_REF_PATTERN = /^HEAD(?:~[0-9]+|\^[0-9]*)?$/;

type ParsedBaseRef = {
  kind: 'branch' | 'commit' | 'symbolic';
  name: string;
  remoteName?: string;
  candidates: string[];
};

type RefPrefixState = {
  name: string;
  remoteName?: string;
};

const invalidBaseRef = (raw: string, reason: string): never => {
  throw new Error(`Invalid base ref "${raw}": ${reason}.`);
};

const hasForbiddenBranchCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x20 || codePoint === 0x7f || FORBIDDEN_BRANCH_CHARACTERS.has(character);
  });

const formatGitArgument = (value: string): string => {
  if (SIMPLE_GIT_ARGUMENT_PATTERN.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
};

const assertValidBranchName = (raw: string, name: string): void => {
  if (
    name.length === 0 ||
    name === '@' ||
    name.startsWith('-') ||
    name.startsWith('/') ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.split('/').some((component) => component.startsWith('.') || component.endsWith('.lock')) ||
    name.includes('..') ||
    name.includes('//') ||
    name.includes('@{') ||
    name.startsWith('origin/') ||
    name.startsWith('refs/') ||
    hasForbiddenBranchCharacter(name)
  ) {
    invalidBaseRef(raw, 'use a valid branch name, an origin/<branch>, or a commit SHA');
  }
};

const consumeRefPrefix = (raw: string, state: RefPrefixState): RefPrefixState => {
  if (state.name.startsWith(`${DEFAULT_REMOTE}/`)) {
    if (state.remoteName && state.remoteName !== DEFAULT_REMOTE) {
      invalidBaseRef(raw, 'remote prefixes must be consistent');
    }
    const remainder = state.name.slice(DEFAULT_REMOTE.length + 1);
    if (
      state.remoteName === DEFAULT_REMOTE &&
      !remainder.startsWith(LOCAL_REF_PREFIX) &&
      !remainder.startsWith(REMOTE_REF_PREFIX)
    ) {
      invalidBaseRef(raw, 'a remote cannot be prefixed twice');
    }
    return {
      name: remainder,
      remoteName: DEFAULT_REMOTE,
    };
  }
  if (state.name.startsWith(LOCAL_REF_PREFIX)) {
    return { name: state.name.slice(LOCAL_REF_PREFIX.length), remoteName: state.remoteName };
  }
  if (!state.name.startsWith(REMOTE_REF_PREFIX)) {
    return state;
  }

  const match = state.name.match(REMOTE_REF_PATTERN);
  const nextRemoteName = match?.[1] ?? '';
  const nextName = match?.[2] ?? '';
  if (!nextRemoteName || !nextName) {
    invalidBaseRef(raw, 'remote ref must include a remote and branch name');
  }
  if (state.remoteName && state.remoteName !== nextRemoteName) {
    invalidBaseRef(raw, 'remote prefixes must be consistent');
  }
  return { name: nextName, remoteName: nextRemoteName };
};

const stripRefPrefixes = (raw: string): RefPrefixState => {
  let state: RefPrefixState = { name: raw };
  while (true) {
    const next = consumeRefPrefix(raw, state);
    if (next.name === state.name && next.remoteName === state.remoteName) {
      return next;
    }
    state = next;
  }
};

const parseBaseRef = (raw: string): ParsedBaseRef => {
  const input = raw.trim();
  if (input.length === 0) {
    invalidBaseRef(raw, 'ref must not be empty');
  }
  if (SYMBOLIC_REF_PATTERN.test(input)) {
    return { kind: 'symbolic', name: input, candidates: [input] };
  }
  if (SHA_REF_PATTERN.test(input)) {
    return { kind: 'commit', name: input, candidates: [input] };
  }

  const { name, remoteName } = stripRefPrefixes(input);
  assertValidBranchName(raw, name);
  if (!remoteName) {
    return {
      kind: 'branch',
      name,
      candidates: [name, `${DEFAULT_REMOTE}/${name}`],
    };
  }
  assertValidBranchName(raw, remoteName);
  if (remoteName === DEFAULT_REMOTE && name === DEFAULT_REMOTE) {
    invalidBaseRef(raw, 'a remote cannot target a branch named origin');
  }
  return {
    kind: 'branch',
    name,
    remoteName,
    candidates: [
      remoteName === DEFAULT_REMOTE
        ? `${remoteName}/${name}`
        : `refs/remotes/${remoteName}/${name}`,
      name,
    ],
  };
};

const fullRefForCandidate = (ref: string, parsed: ParsedBaseRef): string => {
  if (parsed.kind !== 'branch') {
    return ref;
  }
  return ref === parsed.name
    ? `refs/heads/${parsed.name}`
    : `refs/remotes/${parsed.remoteName ?? DEFAULT_REMOTE}/${parsed.name}`;
};

/** Check whether a normalized branch, remote ref, symbolic ref, or SHA exists. */
export const gitRefExists = (ref: string, options: { cwd?: string } = {}): boolean => {
  if (!options.cwd) {
    return false;
  }
  try {
    const parsed = parseBaseRef(ref);
    if (parsed.kind === 'branch') {
      const fullRef = formatGitArgument(fullRefForCandidate(parsed.candidates[0], parsed));
      runGit(`show-ref --verify --quiet ${fullRef}`, { cwd: options.cwd });
    } else {
      const revision =
        parsed.kind === 'commit' ? `${parsed.candidates[0]}^{commit}` : parsed.candidates[0];
      runGit(`rev-parse --verify --quiet ${formatGitArgument(revision)}`, { cwd: options.cwd });
    }
    return true;
  } catch {
    return false;
  }
};

/** Injectable existence probe used by base-ref resolution. */
export type RefExists = (ref: string) => boolean;

/** Options controlling Git-aware base-ref resolution. */
export type ResolveBaseRefOptions = {
  /** Working directory used by the default Git existence probe. */
  cwd?: string;
  /** Override the existence probe, primarily for deterministic tests. */
  refExists?: RefExists;
};

/**
 * Normalize a base ref without consulting Git.
 *
 * Local names and SHA values remain local, while `origin/<name>` and
 * `refs/remotes/origin/<name>` remain explicitly remote. Namespace wrappers
 * such as `refs/heads/` and `refs/remotes/origin/` are removed so callers
 * never manufacture `origin/origin/...`. Non-origin remote refs retain their
 * full namespace so subsequent resolution cannot confuse them with local branches.
 */
export const normalizeBaseRef = (raw: string): string => parseBaseRef(raw).candidates[0];

/** Return the unqualified branch/name portion for APIs that require a branch name. */
export const baseRefName = (raw: string): string => parseBaseRef(raw).name;

/** Return a branch name for GitHub's PR API, rejecting commits and symbolic refs. */
export const branchBaseRefName = (raw: string): string => {
  const parsed = parseBaseRef(raw);
  if (parsed.kind !== 'branch') {
    invalidBaseRef(raw, 'pull request bases must be branch refs');
  }
  return parsed.name;
};

/** Resolve a branch against its remote-tracking ref for GitHub-style comparisons. */
export const resolveRemoteBaseRef = (raw: string, options: ResolveBaseRefOptions = {}): string => {
  const parsed = parseBaseRef(raw);
  if (parsed.kind !== 'branch') {
    invalidBaseRef(raw, 'comparison bases must be branch refs');
  }
  return resolveBaseRef(
    `refs/remotes/${parsed.remoteName ?? DEFAULT_REMOTE}/${parsed.name}`,
    options,
  );
};

/**
 * Resolve a base ref with local-first semantics for an unqualified name.
 * An explicit `origin/<name>` (or `refs/remotes/origin/<name>`) tries the
 * remote first; a bare name tries the local branch first and then origin. SHA
 * values are resolved only as commits. Without an injected probe, the current
 * working directory is used for the default Git existence check.
 */
export const resolveBaseRef = (raw: string, options: ResolveBaseRefOptions = {}): string => {
  const parsed = parseBaseRef(raw);
  const probe =
    options.refExists ??
    ((ref: string) =>
      gitRefExists(fullRefForCandidate(ref, parsed), { cwd: options.cwd ?? process.cwd() }));
  for (const candidate of parsed.candidates) {
    if (probe(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Unable to resolve base ref "${raw}": tried ${parsed.candidates.join(', ')}.`);
};

/** Inputs for a validated two-dot or three-dot Git range. */
export type RefRangeOptions = {
  base: string;
  head?: string;
  operator?: '..' | '...';
};

/** Build a validated Git comparison range without re-prefixing a remote ref. */
export const buildRefRange = (options: RefRangeOptions): string => {
  const base = normalizeBaseRef(options.base);
  const head = normalizeBaseRef(options.head ?? 'HEAD');
  return formatGitArgument(`${base}${options.operator ?? '...'}${head}`);
};

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
  /** Run configured Git hooks instead of using the pipeline checkpoint default. */
  verifyHooks?: boolean;
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

  const hookFlag = options.verifyHooks ? '' : '--no-verify';
  const commitCmd =
    `${envFlags} commit ${hookFlag} -m "${options.message.replace(/"/g, '\\"')}"`.trim();
  runGit(commitCmd, { cwd: options.cwd, env });
  return getGitHeadCommit(options.cwd);
};

const stagedPaths = (options: { cwd: string; env: Record<string, string> }): string[] => {
  // 🔴 No catch-and-return-[]: if the staged-path query fails, protection
  // validation cannot be completed, and unstageProtectedPaths must refuse
  // the commit rather than silently assume nothing is staged. Let the error
  // propagate so commitAll aborts on a protection check it could not run.
  return runGit('diff --cached --name-only', { cwd: options.cwd, env: options.env })
    .split('\n')
    .filter(Boolean);
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
