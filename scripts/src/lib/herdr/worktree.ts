// scripts/src/lib/herdr/worktree.ts
//
// Herdr-native Git Worktree lifecycle — THE single source of truth for
// task/contract worktree provisioning, bootstrapping, publishing, and cleanup.
//
// Why herdr-native instead of raw `git worktree add` (see git_worktree.ts):
//   - `herdr worktree create` makes a real git worktree AND opens it as a
//     herdr workspace, grouped with the parent repo (repo provenance tracked).
//   - Checkouts live in ~/.herdr/worktrees/<repo>/<slug> by default — OUTSIDE
//     the repo — so they never pollute root git state or .gitignore, and the
//     root checkout (possibly mid-refactor by another session) is untouched.
//   - `herdr worktree remove --workspace <id>` tears down herdr state + the
//     checkout together; branch deletion stays a separate git step (herdr
//     never deletes branches by design).
//
// Consumers:
//   1. scripts/src/lib/herdr/task.ts  → `bun herdr:task` CLI (parallel pi sessions)
//   2. contract pipeline (herdr_adapter.ts / orchestrator.ts)
//   3. pi extension tools (contract_workspace_reconcile, task_open_pr)
//
// The low-level git primitives (runGit, commitAll, pushBranch, ...) remain in
// scripts/src/lib/agents/git_worktree.ts — do not fork them.

// biome-ignore-all lint/style/useNamingConvention: HerDr API response field names (snake_case) — must match external API contract
import { execSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import {
  commitAll,
  pushBranch,
  remoteBranchExists,
  runGit,
  sanitizeBranchName,
} from '../agents/git_worktree.ts';
import { findWorkspace, herdrJson } from './session.ts';

// ── Types ──────────────────────────────────────────────────

export type TaskWorktree = {
  /** Short human slug (task/<slug> → branch, aikami-task-<slug> → label). */
  slug: string;
  /** Git branch the worktree has checked out (e.g. task/my-feature). */
  branch: string;
  /** Absolute checkout path (~/.herdr/worktrees/<repo>/<dir>). */
  checkoutPath: string;
  /** herdr workspace id for the worktree ("" if not open). */
  workspaceId: string;
  /** Root pane id of the worktree workspace ("" if not open). */
  rootPaneId: string;
  /** Root tab id of the worktree workspace ("" if unknown). */
  tabId: string;
  /** Absolute path of the parent repo checkout (the main working copy). */
  repoRoot: string;
};

export type WorktreeEntry = {
  branch: string;
  path: string;
  label: string;
  openWorkspaceId?: string;
  isLinked: boolean;
  isDetached: boolean;
  isPrunable: boolean;
};

export type BootstrapOptions = {
  checkoutPath: string;
  repoRoot: string;
  /** Run `bun install --frozen-lockfile` (default true). */
  install?: boolean;
  /** Copy gitignored-but-required seed files (.env*, paraglide, .secrets). */
  seed?: boolean;
  /** Install timeout in ms (default 180_000 — cold worktrees are slow). */
  installTimeoutMs?: number;
};

export type RemoveWorktreeResult = {
  /** True when the checkout (and herdr state) was removed AND, when
   *  requested, the branch was deleted. False otherwise. */
  removed: boolean;
  /** Human-readable reason when `removed` is false. */
  reason?: string;
};

export type RemoveWorktreeOptions = {
  /** herdr workspace id (when the worktree is open as a workspace). */
  workspaceId?: string;
  /** Checkout path — used for fallback removal if no workspace id. */
  checkoutPath?: string;
  /** Branch to delete locally (and remotely when requested). */
  branch?: string;
  /** Also delete the remote branch (git push origin --delete). */
  deleteRemoteBranch?: boolean;
  /** Force removal (dirty checkout). */
  force?: boolean;
  repoRoot: string;
};

export type PublishOptions = {
  checkoutPath: string;
  repoRoot: string;
  /** Base branch for PR + collision-guard naming (default: current branch). */
  base?: string;
  /** Final commit message (default: descriptive generic). */
  message?: string;
  authorName?: string;
  authorEmail?: string;
};

export type PullRequestOptions = {
  headBranch: string;
  base: string;
  title: string;
  body?: string;
  draft?: boolean;
};

// ── Constants ──────────────────────────────────────────────

/**
 * Workspace label prefix for task worktrees. `parseWorkspaceName()`
 * in session.ts returns null for these, so listServices() correctly
 * ignores task workspaces in the dev-service listing.
 */
export const TASK_WORKSPACE_PREFIX = 'aikami-task-';
export const TASK_BRANCH_PREFIX = 'task/';

/**
 * Tracked files that must not be committed from a worktree. They are
 * workspace-local state (direnv delegation, pi settings, shared progress
 * docs) — `git add -A` would otherwise sweep them into every PR.
 * Marked skip-worktree during bootstrap (git worktrees use a .git FILE,
 * so .git/info/exclude is unavailable — skip-worktree is the only
 * reliable mechanism).
 */
export const WORKTREE_SKIP_WORKTREE_PATHS = [
  '.envrc',
  '.pi/settings.json',
  '.context/llms.txt',
  'docs/contracts/PROGRESS.md',
  'docs/contracts/PROMOTION.md',
];

/**
 * Gitignored-but-required files copied from the root checkout during
 * bootstrap. Without these, dev servers / typecheck / tests can't run
 * in a worktree (they are gitignored, so a fresh checkout lacks them).
 * Each entry: { from (relative to repoRoot), to (relative to checkout),
 * kind: 'file' | 'dir', optional: true }.
 */
export const WORKTREE_SEED_PATHS: Array<{
  from: string;
  to: string;
  kind: 'file' | 'dir';
  optional?: boolean;
}> = [
  // Root env files
  { from: '.env', to: '.env', kind: 'file', optional: true },
  { from: '.env.emulator', to: '.env.emulator', kind: 'file', optional: true },
  { from: '.env.local', to: '.env.local', kind: 'file', optional: true },
  // Client env files (SvelteKit dev servers need these)
  {
    from: 'apps/frontend/client/.env.emulator',
    to: 'apps/frontend/client/.env.emulator',
    kind: 'file',
    optional: true,
  },
  {
    from: 'apps/frontend/client/.env.local',
    to: 'apps/frontend/client/.env.local',
    kind: 'file',
    optional: true,
  },
  {
    from: 'apps/frontend/client/.env.staging',
    to: 'apps/frontend/client/.env.staging',
    kind: 'file',
    optional: true,
  },
  {
    from: 'apps/frontend/client/.env.production',
    to: 'apps/frontend/client/.env.production',
    kind: 'file',
    optional: true,
  },
  {
    from: 'apps/frontend/client/.env.testing',
    to: 'apps/frontend/client/.env.testing',
    kind: 'file',
    optional: true,
  },
  // Site + hub env files
  {
    from: 'apps/frontend/site/.env.local',
    to: 'apps/frontend/site/.env.local',
    kind: 'file',
    optional: true,
  },
  {
    from: 'apps/frontend/site/.env.staging',
    to: 'apps/frontend/site/.env.staging',
    kind: 'file',
    optional: true,
  },
  {
    from: 'apps/frontend/site/.env.production',
    to: 'apps/frontend/site/.env.production',
    kind: 'file',
    optional: true,
  },
  {
    from: 'apps/frontend/hub/.env.local',
    to: 'apps/frontend/hub/.env.local',
    kind: 'file',
    optional: true,
  },
  // Firebase function env files
  {
    from: 'apps/backend/firebase/.env.emulator',
    to: 'apps/backend/firebase/.env.emulator',
    kind: 'file',
    optional: true,
  },
  {
    from: 'apps/backend/firebase/.env.staging',
    to: 'apps/backend/firebase/.env.staging',
    kind: 'file',
    optional: true,
  },
  {
    from: 'apps/backend/firebase/.env.production',
    to: 'apps/backend/firebase/.env.production',
    kind: 'file',
    optional: true,
  },
  // E2E + scripts env
  { from: 'apps/e2e/.env', to: 'apps/e2e/.env', kind: 'file', optional: true },
  { from: 'scripts/.env', to: 'scripts/.env', kind: 'file', optional: true },
  // GCP service-account keys (needed by gcloud/firebase deploys)
  { from: '.secrets', to: '.secrets', kind: 'dir', optional: true },
  // Paraglide generated i18n files — gitignored, required for client
  // typecheck/build/dev (Vite re-generates them, but only when running).
  {
    from: 'apps/frontend/client/src/lib/paraglide',
    to: 'apps/frontend/client/src/lib/paraglide',
    kind: 'dir',
    optional: true,
  },
];

// ── Herdr CLI result shapes ────────────────────────────────

type WorktreeCreateResult = {
  result: {
    type: 'worktree_created';
    workspace: {
      workspace_id: string;
      label: string;
      worktree?: {
        checkout_path: string;
        repo_root: string;
      };
    };
    worktree: {
      branch: string;
      path: string;
      is_linked_worktree: boolean;
    };
    tab: { tab_id: string };
    root_pane: {
      pane_id: string;
    };
  };
};

type WorktreeListResult = {
  result: {
    worktrees: Array<{
      branch: string;
      path: string;
      label: string;
      open_workspace_id?: string;
      is_linked_worktree: boolean;
      is_detached: boolean;
      is_prunable: boolean;
    }>;
  };
};

type WorktreeRemoveResult = {
  result: {
    type: 'worktree_removed';
    path: string;
    workspace_id: string;
    forced: boolean;
  };
};

type WorktreeOpenResult = {
  result: {
    workspace: {
      workspace_id: string;
      label: string;
      worktree?: { checkout_path: string; repo_root: string };
    };
    worktree?: { branch: string; path: string };
    root_pane: { pane_id: string };
  };
};

// ── Helpers ────────────────────────────────────────────────

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

const ensureGitRepo = (repoRoot: string): void => {
  try {
    runGit('rev-parse --git-dir', { cwd: repoRoot });
  } catch {
    throw new Error(`Not a git repository: ${repoRoot}`);
  }
};

// ── Worktree lifecycle ─────────────────────────────────────

/**
 * Create a herdr-native Git Worktree.
 *
 * Branches from `origin/<base>` (fetched fresh) so the worktree NEVER
 * includes uncommitted work or unpushed commits from the root checkout —
 * critical when another session is refactoring on main concurrently.
 *
 * The worktree is automatically opened as a herdr workspace grouped with
 * the parent repo. Returns workspace id + checkout path + root pane id.
 */
export const createWorktree = async (options: {
  slug: string;
  /** Explicit branch name. Default: task/<slug>. */
  branch?: string;
  /** Base ref to branch from. Default: current branch of repo root. */
  base?: string;
  /** Workspace label. Default: aikami-task-<slug>. */
  label?: string;
  repoRoot: string;
  focus?: boolean;
}): Promise<TaskWorktree> => {
  ensureGitRepo(options.repoRoot);
  const slug = sanitizeBranchName(options.slug);
  if (!slug) {
    throw new Error('Worktree slug must be a non-empty identifier (a-z, 0-9, -).');
  }

  const currentBranch = runGit('rev-parse --abbrev-ref HEAD', { cwd: options.repoRoot });
  const base = options.base ?? (currentBranch === 'HEAD' ? 'main' : currentBranch);

  // Fetch the base ref so the worktree starts from origin, not a dirty local.
  try {
    runGit('fetch origin', { cwd: options.repoRoot });
  } catch {
    // Non-fatal — may not have a remote configured.
  }

  // Resolve origin/<base> first; fall back to the local ref.
  let baseRef = `origin/${base}`;
  try {
    runGit(`rev-parse --verify ${baseRef}`, { cwd: options.repoRoot });
  } catch {
    baseRef = base;
  }

  const branch = options.branch ?? `${TASK_BRANCH_PREFIX}${slug}`;
  const label = options.label ?? `${TASK_WORKSPACE_PREFIX}${slug}`;

  const args = ['worktree', 'create', '--branch', branch, '--base', baseRef, '--label', label];
  if (options.focus) {
    args.push('--focus');
  } else {
    args.push('--no-focus');
  }

  const r = await herdrJson<WorktreeCreateResult>(args);
  const checkoutPath = r?.result?.workspace?.worktree?.checkout_path ?? r?.result?.worktree?.path;
  if (!(r?.result?.workspace && checkoutPath)) {
    throw new Error(`herdr worktree create failed for slug "${slug}" (branch ${branch})`);
  }

  return {
    slug,
    branch: r.result.worktree?.branch ?? branch,
    checkoutPath,
    workspaceId: r.result.workspace.workspace_id,
    rootPaneId: r.result.root_pane?.pane_id ?? '',
    tabId: r.result.tab?.tab_id ?? '',
    repoRoot: options.repoRoot,
  };
};

/**
 * Re-open an existing worktree checkout as a herdr workspace.
 * Recovery path: the checkout survives but its herdr workspace was closed
 * (herdr `workspace close` closes state only).
 */
export const openWorktree = async (options: {
  checkoutPath: string;
  label?: string;
  repoRoot?: string;
  focus?: boolean;
}): Promise<TaskWorktree> => {
  if (!existsSync(join(options.checkoutPath, '.git'))) {
    throw new Error(`Not a git worktree: ${options.checkoutPath}`);
  }
  const root = options.repoRoot ?? worktreeRepoRoot(options.checkoutPath);
  const branch = runGit('rev-parse --abbrev-ref HEAD', { cwd: options.checkoutPath });

  const args = ['worktree', 'open', '--path', options.checkoutPath];
  if (options.label) {
    args.push('--label', options.label);
  }
  if (options.focus) {
    args.push('--focus');
  } else {
    args.push('--no-focus');
  }

  const r = await herdrJson<WorktreeOpenResult>(args);
  if (!r?.result?.workspace) {
    throw new Error(`herdr worktree open failed for ${options.checkoutPath}`);
  }

  return {
    slug: sanitizeBranchName(branch.replace(/^task\//, '')),
    branch,
    checkoutPath: options.checkoutPath,
    workspaceId: r.result.workspace.workspace_id,
    rootPaneId: r.result.root_pane?.pane_id ?? '',
    tabId: '',
    repoRoot: root,
  };
};

/** List all herdr-tracked worktrees for the repo (with provenance). */
export const listWorktrees = async (repoRoot?: string): Promise<WorktreeEntry[]> => {
  const args = repoRoot ? ['worktree', 'list', '--cwd', repoRoot] : ['worktree', 'list'];
  const r = await herdrJson<WorktreeListResult>(args);
  if (!r?.result?.worktrees) {
    return [];
  }
  return r.result.worktrees.map((w) => ({
    branch: w.branch,
    path: w.path,
    label: w.label,
    openWorkspaceId: w.open_workspace_id,
    isLinked: w.is_linked_worktree,
    isDetached: w.is_detached,
    isPrunable: w.is_prunable,
  }));
};

/** Find a worktree by branch name (herdr-native lookup, repo-scoped). */
export const findWorktreeByBranch = async (
  branch: string,
  repoRoot?: string,
): Promise<WorktreeEntry | null> => {
  const worktrees = await listWorktrees(repoRoot);
  return worktrees.find((w) => w.branch === branch) ?? null;
};

/**
 * Bootstrap a worktree checkout so pi, moon, bun, and dev servers work:
 *   1. .envrc delegating to the repo root (flake.nix is git-tracked there)
 *   2. skip-worktree for workspace-local tracked files (never in PRs)
 *   3. .pi/npm/node_modules symlink (pi extensions deps)
 *   4. seed gitignored-but-required files (.env*, paraglide, .secrets)
 *   5. bun install --frozen-lockfile
 */
export const bootstrapWorktree = async (
  options: BootstrapOptions,
): Promise<{ installed: boolean }> => {
  const { checkoutPath, repoRoot, seed = true } = options;
  if (!existsSync(checkoutPath)) {
    throw new Error(`Cannot bootstrap missing checkout: ${checkoutPath}`);
  }

  // ── 1. .envrc — delegate to repo root where flake.nix is git-tracked ──
  writeFileSync(
    join(checkoutPath, '.envrc'),
    `# Worktree direnv — delegate to repo root where flake.nix is Git-tracked
source_env ${repoRoot}
export CONTRACT_PIPELINE_WORKTREE=1
`,
  );
  try {
    execSync('direnv allow', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: checkoutPath,
      timeout: 5000,
    });
  } catch {
    // direnv may not be installed — not fatal.
  }

  // ── 2. skip-worktree — workspace-local tracked files stay local ──
  // Per path: `git update-index --skip-worktree` fails the WHOLE invocation
  // if any listed path is not in the index, so one missing file would
  // disable the bit for all of them.
  for (const path of WORKTREE_SKIP_WORKTREE_PATHS) {
    try {
      runGit(`update-index --skip-worktree '${path}'`, { cwd: checkoutPath });
    } catch {
      // Non-fatal — the file may not exist in older revisions.
    }
  }

  // ── 3. .pi deps — symlink node_modules so pi + extensions resolve deps ──
  // `.pi/node_modules` is bun's resolution path when loading extension files
  // from .pi/extensions/; `.pi/npm/node_modules` serves the pi-extensions
  // package. Both are gitignored and absent in a fresh checkout — link them
  // to the root copies (shared bun cache makes a local install unnecessary).
  mkdirSync(join(checkoutPath, '.pi'), { recursive: true });
  for (const rel of ['.pi/node_modules', '.pi/npm/node_modules']) {
    const src = join(repoRoot, rel);
    const dst = join(checkoutPath, rel);
    if (existsSync(src) && !existsSync(dst)) {
      try {
        symlinkSync(src, dst, 'dir');
      } catch {
        // Already exists or unsupported — fall through.
      }
    }
  }

  // ── 4. Seed gitignored-but-required files ──
  if (seed) {
    seedWorktreeFiles({ checkoutPath, repoRoot });
  }

  // ── 5. bun install ──
  let installed = false;
  if (options.install !== false) {
    const timeoutMs = options.installTimeoutMs ?? 180_000;
    try {
      execSync('bun install --frozen-lockfile', {
        cwd: checkoutPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: timeoutMs,
      });
      installed = true;
    } catch {
      // Report the failure — a worktree without deps is broken, but the
      // caller may choose to continue (e.g. docs-only tasks).
      console.warn(
        `⚠️  bun install failed in ${checkoutPath}. Run it manually: cd ${checkoutPath} && bun install`,
      );
    }
  }
  return { installed };
};

/** Copy gitignored-but-required files from the root checkout into the worktree. */
export const seedWorktreeFiles = (options: { checkoutPath: string; repoRoot: string }): void => {
  const { checkoutPath, repoRoot } = options;
  for (const entry of WORKTREE_SEED_PATHS) {
    const src = join(repoRoot, entry.from);
    const dst = join(checkoutPath, entry.to);
    if (!existsSync(src)) {
      if (!entry.optional) {
        console.warn(`⚠️  Required seed file missing in root: ${entry.from}`);
      }
      continue;
    }
    try {
      if (entry.kind === 'dir') {
        if (!existsSync(dst)) {
          cpSync(src, dst, { recursive: true });
        }
      } else {
        mkdirSync(join(dst, '..'), { recursive: true });
        if (!existsSync(dst)) {
          copyFileSync(src, dst);
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️  Could not seed ${entry.from} → ${entry.to}: ${message}`);
    }
  }
};

/**
 * Remove a worktree: herdr state + checkout together, then optionally the
 * local and/or remote branch. herdr `worktree remove` NEVER deletes the
 * branch — that is always a separate explicit git step here.
 */
export const removeWorktree = async (
  options: RemoveWorktreeOptions,
): Promise<RemoveWorktreeResult> => {
  const { repoRoot } = options;
  ensureGitRepo(repoRoot);

  let workspaceId = options.workspaceId;
  // If no workspace id given, resolve from the checkout path.
  if (!workspaceId && options.checkoutPath) {
    const entry = (await listWorktrees(repoRoot)).find((w) => w.path === options.checkoutPath);
    workspaceId = entry?.openWorkspaceId;
  }

  let checkoutRemoved = false;
  let reason: string | undefined;
  if (workspaceId) {
    const args = ['worktree', 'remove', '--workspace', workspaceId];
    if (options.force) {
      args.push('--force');
    }
    const r = await herdrJson<WorktreeRemoveResult>(args);
    if (r?.result) {
      checkoutRemoved = true;
    } else {
      reason = `herdr worktree remove returned no result for workspace ${workspaceId}`;
    }
  } else if (options.checkoutPath) {
    // herdr state is gone — fall back to raw git worktree remove.
    try {
      runGit(`worktree remove '${options.checkoutPath}' --force`, { cwd: repoRoot });
      checkoutRemoved = true;
    } catch (gitErr: unknown) {
      try {
        execSync(`rm -rf '${options.checkoutPath}'`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 30_000,
        });
        checkoutRemoved = true;
      } catch (rmErr: unknown) {
        const g = gitErr instanceof Error ? gitErr.message : String(gitErr);
        const r2 = rmErr instanceof Error ? rmErr.message : String(rmErr);
        reason = `git worktree remove failed (${g}); rm -rf failed (${r2})`;
      }
    }
  } else {
    reason = 'No workspace id or checkout path provided';
  }

  let branchDeleted = !options.branch;
  if (options.branch) {
    // Quote the branch — git refnames permit shell metacharacters.
    const quoted = `'${options.branch.replaceAll("'", "'\\''")}'`;
    if (options.deleteRemoteBranch) {
      try {
        runGit(`push origin --delete ${quoted}`, { cwd: repoRoot });
      } catch {
        // Branch may not exist on remote.
      }
    }
    try {
      runGit(`branch -D ${quoted}`, { cwd: repoRoot });
      branchDeleted = true;
    } catch {
      reason = reason ?? `local branch ${options.branch} could not be deleted`;
    }
  }

  const removed = checkoutRemoved && branchDeleted;
  return { removed, reason: removed ? undefined : (reason ?? 'removal incomplete') };
};

// ── Publishing ─────────────────────────────────────────────

/**
 * Publish a worktree: collision-guard the branch name, commit all changes,
 * push to origin with upstream tracking. Returns the final head branch.
 *
 * Mirrors the contract pipeline's reconcile step but operates on the
 * EXISTING worktree (no re-provisioning).
 */
export const publishWorktree = async (
  options: PublishOptions,
): Promise<{
  headBranch: string;
  headCommit: string;
  checkoutPath: string;
}> => {
  const { checkoutPath, repoRoot } = options;
  if (!existsSync(checkoutPath)) {
    throw new Error(`Cannot publish missing worktree: ${checkoutPath}`);
  }

  let headBranch = runGit('rev-parse --abbrev-ref HEAD', { cwd: checkoutPath });
  if (headBranch === 'HEAD' || headBranch.startsWith('(detached')) {
    // Detached — create a branch at the current commit so push can work.
    const short = runGit('rev-parse --short HEAD', { cwd: checkoutPath });
    headBranch = `task/${sanitizeBranchName(short)}`;
    try {
      runGit(`switch -c ${headBranch}`, { cwd: checkoutPath });
    } catch {
      // Fall through — push will fail loudly if the branch is unusable.
    }
  }

  // Idempotency guard: if the branch already exists on the remote, prefer
  // updating it when the remote ref is an ancestor of the local head (same
  // task, re-publish → the existing PR updates). Only create a new branch
  // on true divergence (rewritten history / unrelated push).
  if (remoteBranchExists({ branchName: headBranch, repoRoot })) {
    try {
      runGit(`fetch origin ${headBranch}`, { cwd: checkoutPath });
    } catch {
      // Non-fatal — ref may already be present locally.
    }
    let isAncestor = false;
    try {
      runGit(`merge-base --is-ancestor origin/${headBranch} HEAD`, { cwd: checkoutPath });
      isAncestor = true;
    } catch {
      // Not an ancestor → divergence.
    }
    if (!isAncestor) {
      const token = Date.now().toString(36).slice(-6);
      const renamed = `${headBranch}-${token}`;
      try {
        runGit(`branch -m ${headBranch} ${renamed}`, { cwd: checkoutPath });
        headBranch = renamed;
      } catch {
        // Rename failed — leave as-is; push will surface the real error.
      }
    }
  }

  const message =
    options.message ??
    `Feat: ${sanitizeBranchName(headBranch.replace(/^task\//, ''))} (${headBranch})`;
  const headCommit = commitAll({
    cwd: checkoutPath,
    message,
    authorName: options.authorName,
    authorEmail: options.authorEmail,
  });
  pushBranch({ cwd: checkoutPath, branchName: headBranch });

  return { headBranch, headCommit, checkoutPath };
};

/**
 * Open a GitHub PR (headBranch → base). Thin wrapper over `gh pr create`
 * so both the CLI and pi extension tools share one implementation.
 */
export const openPullRequest = async (
  options: PullRequestOptions,
): Promise<{ prUrl: string; prNumber: string }> => {
  const args = [
    'pr',
    'create',
    '--head',
    options.headBranch,
    '--base',
    options.base,
    '--title',
    options.title,
  ];
  if (options.body) {
    args.push('--body', options.body);
  }
  if (options.draft) {
    args.push('--draft');
  }
  const result = execSync(`gh ${args.map((a) => `'${a.replaceAll("'", "'\\''")}'`).join(' ')}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 30_000,
  }).trim();
  const m = result.match(/https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/);
  return { prUrl: m?.[0] ?? result, prNumber: m?.[1] ?? '' };
};

/** Convenience: publish + open PR in one call (used by task_open_pr tool). */
export const publishAndOpenPr = async (
  options: PublishOptions & Omit<PullRequestOptions, 'headBranch'>,
): Promise<{
  headBranch: string;
  headCommit: string;
  prUrl: string;
  prNumber: string;
}> => {
  const { headBranch, headCommit } = await publishWorktree(options);
  const { prUrl, prNumber } = await openPullRequest({
    headBranch,
    base: options.base,
    title: options.title,
    body: options.body,
    draft: options.draft,
  });
  return { headBranch, headCommit, prUrl, prNumber };
};

// ── Lookup helpers ─────────────────────────────────────────

/** Find an open task worktree by slug (workspace label aikami-task-<slug>). */
export const findTaskWorkspace = async (slug: string): Promise<string | null> => {
  return findWorkspace(`${TASK_WORKSPACE_PREFIX}${sanitizeBranchName(slug)}`);
};

/** Get a TaskWorktree for an open task workspace label (repo-scoped). */
export const getTaskWorktreeByLabel = async (
  label: string,
  repoRoot?: string,
): Promise<TaskWorktree | null> => {
  const wsId = await findWorkspace(label);
  if (!wsId) {
    return null;
  }
  const entry = (await listWorktrees(repoRoot)).find((w) => w.openWorkspaceId === wsId);
  if (!entry) {
    return null;
  }
  const branch = runGit('rev-parse --abbrev-ref HEAD', { cwd: entry.path });
  return {
    slug: sanitizeBranchName(label.replace(TASK_WORKSPACE_PREFIX, '')),
    branch,
    checkoutPath: entry.path,
    workspaceId: wsId,
    rootPaneId: '',
    tabId: '',
    repoRoot: worktreeRepoRoot(entry.path),
  };
};
